/**
 * 04_Match.gs — the three-way matching engine (A16, docs/01 §4).
 *
 * Matches PO price x QC-accepted quantity x invoice line. The accepted quantity — not the
 * delivered quantity — is what makes it impossible to pay for rejected goods.
 */

const Match = {

  tolerances() {
    return {
      pricePct: Config.num('PRICE_TOL_PCT', 2),
      priceAbs: Config.num('PRICE_TOL_ABS_THB', 200),
      amountAbs: Config.num('AMOUNT_TOL_ABS_THB', 500),
      fxPct: Config.num('FX_TOL_PCT', 1)
    };
  },

  /** Run the engine over every invoice waiting for a match. */
  runPending() {
    return safely_('Match.runPending', () => {
      const queue = Repo.readAll(SHEETS.INV_HEADER).filter(i =>
        [MATCH_STATUS.RECEIVED, MATCH_STATUS.MATCHING, MATCH_STATUS.NO_GRN].indexOf(i.match_status) >= 0);
      const results = [];
      queue.slice(0, Config.num('MATCH_BATCH_SIZE', 50)).forEach(inv => {
        try {
          results.push(this.runOne(inv.inv_internal_no));
        } catch (e) {
          ErrorLog.write({
            severity: 'ERROR', function_name: 'Match.runOne',
            entity_type: 'INVOICE', entity_no: inv.inv_internal_no,
            error_message: String(e.message || e)
          });
        }
      });
      return results;
    });
  },

  /**
   * Match a single invoice. Writes Match_Results evidence rows for every line on every run,
   * so an auditor can see what the engine saw at the time.
   */
  runOne(invNo) {
    return withLock_(() => {
      const inv = Repo.findOne(SHEETS.INV_HEADER, 'inv_internal_no', invNo);
      if (!inv) throw new AppError('NOT_FOUND', 'Invoice ' + invNo + ' not found.');

      // non-PO invoice types never go through 3-way match (imports: freight, duty, deposit)
      if (['FREIGHT', 'DUTY', 'SERVICE', 'DEPOSIT'].indexOf(inv.invoice_type) >= 0) {
        return this._routeNonPoInvoice(inv);
      }

      if (inv.match_status === MATCH_STATUS.RECEIVED || inv.match_status === MATCH_STATUS.NO_GRN) {
        StateMachine.fireAsSystem('INVOICE', invNo, 'RUN_MATCH');
      }

      const tol = this.tolerances();
      const runAt = Fmt.now();
      const lines = Repo.findAll(SHEETS.INV_LINES, 'inv_internal_no', invNo);
      if (!lines.length) throw new AppError('NO_LINES', 'Invoice ' + invNo + ' has no lines.');

      const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', inv.po_no);
      const exceptions = [];
      const evidence = [];
      let anyNoReceipt = false;

      // header-level checks first
      if (!po) {
        exceptions.push({ code: EXCEPTION.NO_PO, detail: 'PO ' + inv.po_no + ' not found' });
      } else if ([PO_STATUS.CANCELLED].indexOf(po.status) >= 0) {
        exceptions.push({ code: EXCEPTION.PO_CLOSED, detail: 'PO status is ' + po.status });
      }
      if (String(inv.qc_hold_flag).toUpperCase() === 'TRUE') {
        exceptions.push({ code: EXCEPTION.QC_REJECTED, detail: inv.qc_hold_reason || 'QC hold active' });
      }
      const taxEx = this._checkTax(inv);
      if (taxEx) exceptions.push(taxEx);
      const fxEx = this._checkFx(inv, tol);
      if (fxEx) exceptions.push(fxEx);
      const depEx = this._checkDeposit(inv);
      if (depEx) exceptions.push(depEx);

      const poLines = po ? Repo.findAll(SHEETS.PO_LINES, 'po_no', inv.po_no) : [];
      const poLineByNo = {};
      poLines.forEach(l => { poLineByNo[String(l.line_no)] = l; });

      const postedGrnNos = po ? Repo.findAll(SHEETS.GRN_HEADER, 'po_no', inv.po_no)
        .filter(g => [GRN_STATUS.POSTED, GRN_STATUS.PARTIALLY_POSTED].indexOf(g.status) >= 0)
        .map(g => g.grn_no) : [];
      const grnLines = postedGrnNos.reduce(
        (acc, no) => acc.concat(Repo.findAll(SHEETS.GRN_LINES, 'grn_no', no)), []);

      // other invoices already consuming the accepted quantity
      const otherInvLines = Repo.readAll(SHEETS.INV_LINES)
        .filter(l => l.po_no === inv.po_no && l.inv_internal_no !== invNo);
      const otherInvStatus = Repo.indexBy(SHEETS.INV_HEADER, 'inv_internal_no');

      lines.forEach(l => {
        const pl = poLineByNo[String(l.po_line_no)];
        const linePatch = {};
        let code = '';
        let detail = '';

        if (!pl) {
          code = EXCEPTION.NO_PO;
          detail = 'PO line ' + l.po_line_no + ' does not exist on ' + inv.po_no;
        }

        const mine = grnLines.filter(g => pl && String(g.po_line_no) === String(pl.line_no));
        const acceptedQty = mine.reduce((s, g) => s + Num.n(g.qty_accepted), 0);
        const alreadyInvoiced = otherInvLines
          .filter(o => pl && String(o.po_line_no) === String(pl.line_no))
          .filter(o => {
            const h = otherInvStatus[o.inv_internal_no];
            return h && [MATCH_STATUS.REJECTED].indexOf(h.match_status) < 0;
          })
          .reduce((s, o) => s + Num.n(o.qty_invoiced), 0);
        const matchable = Num.round(acceptedQty - alreadyInvoiced, 3);

        const invQty = Num.n(l.qty_invoiced);
        const invPrice = Num.n(l.unit_price);
        const poPrice = pl ? Num.n(pl.unit_price) : 0;
        const qtyVariance = Num.round(invQty - matchable, 3);
        const priceVariance = Num.round(invPrice - poPrice, 4);
        const priceVariancePct = poPrice ? Num.round((priceVariance / poPrice) * 100, 2) : 100;

        // deduction agreed on a concession reduces what we expect to pay
        const deductionPct = this._ncrDeductionPct(inv.po_no, l.item_code);
        const expectedAmount = Num.round(
          Math.min(invQty, Math.max(matchable, 0)) * poPrice * (1 - deductionPct / 100), 2);
        const amountVariance = Num.round(Num.n(l.line_amount) - expectedAmount, 2);

        // effective price tolerance: the LOWER of pct and absolute
        const priceTolValue = Math.min(poPrice * tol.pricePct / 100, tol.priceAbs);

        if (!code && pl) {
          if (acceptedQty <= 0) {
            code = EXCEPTION.QTY_NO_RECEIPT;
            detail = 'No posted receipt with accepted quantity for PO line ' + pl.line_no;
            anyNoReceipt = true;
          } else if (l.uom && pl.uom && String(l.uom) !== String(pl.uom)) {
            code = EXCEPTION.UOM_MISMATCH;
            detail = 'Invoice UOM ' + l.uom + ' vs PO UOM ' + pl.uom;
          } else if (qtyVariance > 0.001) {
            code = EXCEPTION.QTY_OVER;
            detail = 'Invoiced ' + invQty + ' but only ' + matchable + ' is accepted and uninvoiced';
          } else if (priceVariance > priceTolValue) {
            code = EXCEPTION.PRICE_OVER;
            detail = 'Invoice price ' + invPrice + ' vs PO ' + poPrice +
                     ' (+' + priceVariancePct + '%, tolerance ' + Num.round(priceTolValue, 2) + ')';
          } else if (-priceVariance > priceTolValue) {
            code = EXCEPTION.PRICE_UNDER;
            detail = 'Invoice price ' + invPrice + ' is below PO ' + poPrice +
                     ' (' + priceVariancePct + '%) — check the PO link';
          } else if (Math.abs(amountVariance) > tol.amountAbs) {
            code = EXCEPTION.PRICE_OVER;
            detail = 'Line amount variance ' + Fmt.money(amountVariance) + ' exceeds tolerance';
          }
        }

        const pass = !code;
        Object.assign(linePatch, {
          matched_qty: pass ? invQty : 0,
          matched_amount: pass ? Num.n(l.line_amount) : 0,
          qty_variance: qtyVariance, price_variance: priceVariance,
          amount_variance: amountVariance,
          match_result: pass ? 'PASS' : 'FAIL',
          exception_code: code
        });
        Repo.update(SHEETS.INV_LINES, l.inv_line_id, linePatch);

        evidence.push({
          match_id: Utilities.getUuid(), run_at: runAt, run_by: Auth.currentEmail(),
          inv_internal_no: invNo, inv_line_id: l.inv_line_id, po_no: inv.po_no,
          po_line_no: l.po_line_no, grn_nos: mine.map(g => g.grn_no).join(','),
          po_unit_price: poPrice, po_revision_used: pl ? pl.po_revision : '',
          grn_accepted_qty: acceptedQty, already_invoiced_qty: alreadyInvoiced,
          matchable_qty: matchable, inv_qty: invQty, inv_unit_price: invPrice,
          qty_variance: qtyVariance,
          qty_variance_pct: matchable ? Num.round((qtyVariance / matchable) * 100, 2) : '',
          price_variance: priceVariance, price_variance_pct: priceVariancePct,
          amount_variance: amountVariance, tolerance_applied: Num.round(priceTolValue, 2),
          ncr_deduction_pct: deductionPct, within_tolerance: pass ? 'TRUE' : 'FALSE',
          exception_code: code, exception_detail: detail,
          decision: pass ? 'AUTO_PASS' : (code === EXCEPTION.QTY_NO_RECEIPT ? 'BLOCKED' : 'MANUAL_REVIEW'),
          routed_to: code ? this._ownerEmailFor(code, inv) : ''
        });

        if (code) exceptions.push({ code: code, detail: 'Line ' + l.line_no + ': ' + detail });
      });

      Repo.insertMany(SHEETS.MATCH_RESULTS, evidence);

      const codes = exceptions.map(e => e.code).filter((v, i, a) => a.indexOf(v) === i);
      const isFirstRun = !inv.match_run_at;

      if (!codes.length) {
        Repo.update(SHEETS.INV_HEADER, inv.inv_id, {
          match_run_at: runAt, match_exception_codes: '',
          first_pass_match: isFirstRun ? 'TRUE' : String(inv.first_pass_match || 'FALSE')
        });
        StateMachine.fireAsSystem('INVOICE', invNo, 'MATCH_PASS');
        Notify.queue({
          template_id: 'INVOICE_APPROVAL_REQUEST',
          to: [Config.get('FIN_MGR_EMAIL', Props.get('ADMIN_EMAIL'))],
          entity_type: 'INVOICE', entity_no: invNo,
          vars: { inv_no: invNo, vendor: inv.vendor_code, amount: Fmt.money(inv.total_amount_thb) },
          dedupe_key: 'INV_APPROVE:' + invNo
        });
        return { invNo: invNo, status: MATCH_STATUS.MATCHED, exceptions: [] };
      }

      const onlyNoReceipt = codes.length === 1 && codes[0] === EXCEPTION.QTY_NO_RECEIPT;
      Repo.update(SHEETS.INV_HEADER, inv.inv_id, {
        match_run_at: runAt, match_exception_codes: codes.join(','),
        first_pass_match: isFirstRun ? 'FALSE' : String(inv.first_pass_match || 'FALSE')
      });

      if (onlyNoReceipt && anyNoReceipt) {
        StateMachine.fireAsSystem('INVOICE', invNo, 'MATCH_NO_RECEIPT');
        this._notifyException(inv, EXCEPTION.QTY_NO_RECEIPT,
          'Goods not yet received or GRN not posted for ' + inv.po_no);
        return { invNo: invNo, status: MATCH_STATUS.NO_GRN, exceptions: codes };
      }

      StateMachine.fireAsSystem('INVOICE', invNo, 'MATCH_EXCEPTION');
      exceptions.forEach(e => this._notifyException(inv, e.code, e.detail));
      return { invNo: invNo, status: MATCH_STATUS.EXCEPTION, exceptions: codes };
    });
  },

  /* ------------------------------------------------------- header-level checks */

  _checkTax(inv) {
    const taxCode = inv.tax_code ? Repo.findOne(SHEETS.TAX_CODES, 'tax_code', inv.tax_code) : null;
    if (!taxCode) return null;
    const base = Num.n(inv.subtotal_amount) - Num.n(inv.discount_amount) + Num.n(inv.other_charges);
    const expected = Num.round(base * Num.n(taxCode.vat_rate_pct) / 100, 2);
    if (Math.abs(expected - Num.n(inv.vat_amount)) > Config.num('AMOUNT_TOL_ABS_THB', 500)) {
      return { code: EXCEPTION.TAX_MISMATCH,
               detail: 'VAT ' + Fmt.money(inv.vat_amount) + ' vs expected ' + Fmt.money(expected) };
    }
    if (Num.n(inv.vat_amount) > 0 && !inv.tax_invoice_no) {
      return { code: EXCEPTION.TAX_MISMATCH, detail: 'VAT charged but no tax invoice number recorded' };
    }
    return null;
  },

  _checkFx(inv, tol) {
    if (!inv.currency || inv.currency === 'THB') return null;
    const rates = Repo.readAll(SHEETS.FX)
      .filter(r => r.currency === inv.currency && String(r.fx_date) <= String(inv.invoice_date))
      .sort((a, b) => String(b.fx_date).localeCompare(String(a.fx_date)));
    if (!rates.length) return { code: EXCEPTION.FX_MISMATCH, detail: 'No FX rate on file for ' + inv.currency };
    const ref = Num.n(rates[0].rate_to_thb);
    const used = Num.n(inv.fx_rate);
    if (!used) return { code: EXCEPTION.FX_MISMATCH, detail: 'No FX rate recorded on the invoice' };
    const pct = Math.abs((used - ref) / ref) * 100;
    if (pct > tol.fxPct) {
      return { code: EXCEPTION.FX_MISMATCH,
               detail: 'Rate ' + used + ' differs from reference ' + ref + ' by ' + Num.round(pct, 2) + '%' };
    }
    return null;
  },

  /** Edge case 12 — a goods invoice must net off any deposit already paid on the PO. */
  _checkDeposit(inv) {
    if (inv.invoice_type !== 'GOODS' || !inv.po_no) return null;
    const deposits = Repo.findAll(SHEETS.INV_HEADER, 'po_no', inv.po_no)
      .filter(i => i.invoice_type === 'DEPOSIT' && i.payment_status === 'PAID');
    if (!deposits.length) return null;
    const paid = deposits.reduce((s, d) => s + Num.n(d.paid_amount), 0);
    if (paid > 0 && Num.n(inv.deposit_applied_amount) <= 0) {
      return { code: EXCEPTION.DEPOSIT_UNAPPLIED,
               detail: 'Deposit of ' + Fmt.money(paid) + ' paid on ' + inv.po_no + ' is not applied' };
    }
    return null;
  },

  /** Agreed concession deduction reduces the expected payable amount (Q4). */
  _ncrDeductionPct(poNo, itemCode) {
    if (!poNo) return 0;
    const ncrs = Repo.findAll(SHEETS.NCR, 'po_no', poNo).filter(n =>
      n.item_code === itemCode &&
      n.disposition === 'PRICE_DEDUCTION' &&
      ['CLOSED', 'CANCELLED'].indexOf(n.status) < 0);
    if (!ncrs.length) return 0;
    const qc = ncrs[0].qc_no ? Repo.findOne(SHEETS.QC_HEADER, 'qc_no', ncrs[0].qc_no) : null;
    return qc ? Num.n(qc.conditional_deduction_pct) : 0;
  },

  _routeNonPoInvoice(inv) {
    Repo.update(SHEETS.INV_HEADER, inv.inv_id, {
      match_run_at: Fmt.now(),
      match_exception_codes: '',
      first_pass_match: 'TRUE'
    });
    if (inv.match_status === MATCH_STATUS.RECEIVED) {
      StateMachine.fireAsSystem('INVOICE', inv.inv_internal_no, 'RUN_MATCH');
    }
    StateMachine.fireAsSystem('INVOICE', inv.inv_internal_no, 'MATCH_PASS');
    Notify.queue({
      template_id: 'INVOICE_APPROVAL_REQUEST',
      to: [Config.get('FIN_MGR_EMAIL', Props.get('ADMIN_EMAIL'))],
      entity_type: 'INVOICE', entity_no: inv.inv_internal_no,
      vars: { inv_no: inv.inv_internal_no, vendor: inv.vendor_code,
              amount: Fmt.money(inv.total_amount_thb),
              note: inv.invoice_type + ' invoice — no three-way match applies' },
      dedupe_key: 'INV_APPROVE:' + inv.inv_internal_no
    });
    return { invNo: inv.inv_internal_no, status: MATCH_STATUS.MATCHED, exceptions: [], nonPo: true };
  },

  _ownerEmailFor(code, inv) {
    const role = EXCEPTION_OWNER[code] || ROLES.AP_OFFICER;
    if (role === ROLES.BUYER && inv.po_no) {
      const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', inv.po_no);
      if (po && po.buyer_email) return po.buyer_email;
    }
    const holder = Repo.readAll(SHEETS.USERS).filter(u =>
      String(u.is_active).toUpperCase() === 'TRUE' && String(u.role_codes).indexOf(role) >= 0)[0];
    return holder ? holder.email : Props.get('ADMIN_EMAIL');
  },

  _notifyException(inv, code, detail) {
    Notify.queue({
      template_id: 'INVOICE_EXCEPTION',
      to: [this._ownerEmailFor(code, inv)],
      cc: [inv.ap_owner_email || Config.get('AP_GROUP_EMAIL', Props.get('ADMIN_EMAIL'))],
      entity_type: 'INVOICE', entity_no: inv.inv_internal_no,
      vars: { inv_no: inv.inv_internal_no, vendor_invoice_no: inv.vendor_invoice_no,
              vendor: inv.vendor_code, po_no: inv.po_no,
              amount: Fmt.money(inv.total_amount_thb), exception: code, detail: detail },
      dedupe_key: 'INV_EXC:' + inv.inv_internal_no + ':' + code
    });
  },

  /** Register an invoice (A1/A17). Duplicate detection happens here, at entry. */
  registerInvoice(header, lines) {
    return safely_('Match.registerInvoice', () => withLock_(() => {
      Auth.require('INVOICE', 'CREATE');
      const hash = this.duplicateHash(header.vendor_code, header.vendor_invoice_no, header.total_amount);
      const dup = Repo.findOne(SHEETS.INV_HEADER, 'duplicate_check_hash', hash);
      if (dup) {
        throw new AppError('DUPLICATE',
          'This looks like a duplicate of ' + dup.inv_internal_no + ' (same vendor, invoice number and amount).');
      }
      const fuzzy = Repo.findAll(SHEETS.INV_HEADER, 'vendor_code', header.vendor_code).filter(i =>
        Math.abs(Num.n(i.total_amount) - Num.n(header.total_amount)) < 0.01 &&
        Math.abs((new Date(i.invoice_date) - new Date(header.invoice_date)) / 864e5) <= 5);
      if (fuzzy.length) {
        ErrorLog.write({
          severity: 'WARN', function_name: 'registerInvoice',
          entity_type: 'INVOICE', entity_no: header.vendor_invoice_no,
          error_message: 'Possible duplicate of ' + fuzzy.map(f => f.inv_internal_no).join(',')
        });
      }

      const invNo = Repo.nextDocNo('INVOICE');
      const term = header.payment_term_code
        ? Repo.findOne(SHEETS.PAYMENT_TERMS, 'term_code', header.payment_term_code) : null;
      const dueDate = term ? Fmt.date(Fmt.addDays(header.invoice_date, Num.n(term.net_days))) : '';

      const inv = Repo.insert(SHEETS.INV_HEADER, Object.assign({
        inv_internal_no: invNo, registered_at: Fmt.now(),
        match_status: MATCH_STATUS.RECEIVED, payment_status: 'UNPAID',
        qc_hold_flag: 'FALSE', due_date: dueDate,
        duplicate_check_hash: hash,
        ap_owner_email: Auth.currentEmail(),
        drive_folder_id: header.po_no ? DriveService.ensurePoSubfolder(header.po_no, '06_Invoice').getId() : ''
      }, header));

      Repo.insertMany(SHEETS.INV_LINES, (lines || []).map((l, i) =>
        Object.assign({ inv_internal_no: invNo, line_no: i + 1, match_result: 'PENDING' }, l)));

      History.log({
        entity_type: 'INVOICE', entity_no: invNo, entity_id: inv.inv_id,
        action: 'REGISTERED', to_status: MATCH_STATUS.RECEIVED
      });
      return inv;
    }), { entityType: 'INVOICE', entityNo: header.vendor_invoice_no });
  },

  duplicateHash(vendorCode, vendorInvoiceNo, amount) {
    const norm = String(vendorInvoiceNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const raw = [String(vendorCode || '').toUpperCase(), norm, Num.round(amount, 2)].join('|');
    return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw));
  }
};

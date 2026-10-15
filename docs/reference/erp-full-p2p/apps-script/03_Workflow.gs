/**
 * 03_Workflow.gs — the department hand-offs (docs/01 §3.2–3.4).
 *
 * These functions are the automations that remove manual work:
 *   A7  submitGrn()        Warehouse -> QC   (auto-creates inspections from the spec)
 *   A10 completeQc()       QC -> Accounting  (posts the GRN, rolls up to PO, notifies AP)
 *   A12 raiseNcr()         QC failure -> Purchasing + AP hold
 *
 * Judgement stays with people: nothing here decides a QC verdict or accepts a variance.
 */

const Workflow = {

  /* ------------------------------------------------------- Purchasing (P4) */

  validatePoForSubmit(po) {
    const lines = Repo.findAll(SHEETS.PO_LINES, 'po_no', po.po_no);
    if (!lines.length) throw new AppError('NO_LINES', 'Add at least one line before submitting.');

    const vendor = Repo.findOne(SHEETS.VENDORS, 'vendor_code', po.vendor_code);
    if (!vendor) throw new AppError('NO_VENDOR', 'Vendor ' + po.vendor_code + ' does not exist.');
    if (vendor.approved_status === 'BLACKLISTED') {
      throw new AppError('VENDOR_BLACKLISTED', vendor.vendor_name_en + ' is blacklisted.');
    }
    if (vendor.approved_status === 'SUSPENDED' && !Auth.hasRole(ROLES.PUR_MGR)) {
      throw new AppError('VENDOR_SUSPENDED',
        vendor.vendor_name_en + ' is suspended. A Purchasing Manager must approve the override.');
    }
    if (vendor.cert_expiry_earliest && String(vendor.cert_expiry_earliest) < Fmt.today() &&
        !Auth.hasRole(ROLES.PUR_MGR)) {
      throw new AppError('CERT_EXPIRED',
        'A vendor certificate expired on ' + vendor.cert_expiry_earliest + '.');
    }

    if (po.currency !== 'THB') {
      const fx = Repo.readAll(SHEETS.FX).filter(r =>
        r.currency === po.currency && String(r.fx_date) <= String(po.po_date));
      if (!fx.length) throw new AppError('NO_FX_RATE', 'No FX rate on file for ' + po.currency + '.');
    }

    const problems = [];
    lines.forEach(l => {
      if (Num.n(l.qty_ordered) <= 0) problems.push('Line ' + l.line_no + ': quantity must be positive');
      if (Num.n(l.unit_price) <= 0) problems.push('Line ' + l.line_no + ': price must be positive');
      const item = Repo.findOne(SHEETS.ITEMS, 'item_code', l.item_code);
      if (!item) problems.push('Line ' + l.line_no + ': unknown item ' + l.item_code);
      else if (String(item.is_active).toUpperCase() !== 'TRUE') {
        problems.push('Line ' + l.line_no + ': item ' + l.item_code + ' is inactive');
      }
    });
    if (problems.length) throw new AppError('VALIDATION', problems.join('; '));

    const recomputed = Num.round(lines.reduce((s, l) => s + Num.n(l.line_amount), 0), 2);
    if (Math.abs(recomputed - Num.n(po.subtotal_amount)) > 0.01) {
      throw new AppError('TOTAL_MISMATCH',
        'Stored subtotal ' + Fmt.money(po.subtotal_amount) + ' does not match the lines (' +
        Fmt.money(recomputed) + '). Reopen and save the PO.');
    }
    return true;
  },

  shortClosePoLines(po, reason) {
    Repo.findAll(SHEETS.PO_LINES, 'po_no', po.po_no)
      .filter(l => ['OPEN', 'PARTIAL'].indexOf(l.line_status) >= 0)
      .forEach(l => Repo.update(SHEETS.PO_LINES, l.po_line_id,
        { line_status: 'SHORT_CLOSED', qty_open: 0 }));
    Notify.queue({
      template_id: 'PO_SHORT_CLOSED', to: [Config.get('AP_GROUP_EMAIL', Props.get('ADMIN_EMAIL'))],
      entity_type: 'PO', entity_no: po.po_no, vars: { po_no: po.po_no, reason: reason }
    });
    return { short_close_reason: reason, closed_at: '' };
  },

  /* -------------------------------------------- Warehouse -> QC (W2/W3/A7) */

  validateGrnForSubmit(grn, ctx) {
    const lines = Repo.findAll(SHEETS.GRN_LINES, 'grn_no', grn.grn_no);
    if (!lines.length) throw new AppError('NO_LINES', 'Record at least one received line.');
    if (!grn.delivery_note_no) throw new AppError('NO_DELIVERY_NOTE', 'Delivery note number is required.');
    if (!grn.delivery_note_date) throw new AppError('NO_DELIVERY_NOTE', 'Delivery note date is required.');

    const photos = Repo.findAll(SHEETS.DOCUMENTS, 'entity_no', grn.grn_no)
      .filter(d => d.doc_type === 'GRN_PHOTO' || d.doc_type === 'DELIVERY_NOTE');
    if (!photos.length) throw new AppError('NO_PHOTO', 'Attach at least one photo or the delivery note.');

    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', grn.po_no);
    if (!po) throw new AppError('NO_PO', 'PO ' + grn.po_no + ' not found.');
    const poLines = Repo.groupBy(SHEETS.PO_LINES, 'po_no')[grn.po_no] || [];
    const poLineByNo = {};
    poLines.forEach(l => { poLineByNo[String(l.line_no)] = l; });

    const problems = [];
    lines.forEach(l => {
      const pl = poLineByNo[String(l.po_line_no)];
      if (!pl) { problems.push('Line ' + l.line_no + ': PO line ' + l.po_line_no + ' does not exist'); return; }
      const item = Repo.findOne(SHEETS.ITEMS, 'item_code', l.item_code) || {};

      if (Num.n(l.qty_received) <= 0) problems.push('Line ' + l.line_no + ': quantity must be positive');

      // lot + expiry for lot-tracked items
      if (String(item.lot_tracked).toUpperCase() === 'TRUE') {
        if (!l.lot_no) problems.push('Line ' + l.line_no + ': lot number is required');
        if (!l.expiry_date) problems.push('Line ' + l.line_no + ': expiry date is required');
      }

      // remaining shelf life (edge case 8)
      if (l.expiry_date && Num.n(item.shelf_life_days) > 0) {
        const remaining = Math.round((new Date(l.expiry_date) - new Date(grn.received_datetime || Fmt.now())) / 864e5);
        const minPct = Num.n(item.min_remaining_shelf_life_pct) || Config.num('MIN_SHELF_LIFE_PCT', 75);
        const pct = (remaining / Num.n(item.shelf_life_days)) * 100;
        Repo.update(SHEETS.GRN_LINES, l.grn_line_id, {
          remaining_shelf_life_days: remaining,
          shelf_life_ok: pct >= minPct ? 'TRUE' : 'FALSE'
        });
        if (pct < minPct && !ctx.shelfLifeOverrideBy) {
          problems.push('Line ' + l.line_no + ': remaining shelf life ' + Math.round(pct) +
                        '% is below the required ' + minPct + '% (QC Manager override needed)');
        }
      }

      // over-receipt tolerance (edge case 3)
      const tol = Num.n(pl.over_tolerance_pct) || Config.num('OVER_RECEIPT_TOL_PCT', 2);
      const open = Num.n(pl.qty_open);
      const variance = Num.n(l.qty_received) - open;
      const variancePct = open ? (variance / open) * 100 : 100;
      const overTol = variance > 0 && variancePct > tol;
      Repo.update(SHEETS.GRN_LINES, l.grn_line_id, {
        variance_qty: Num.round(variance, 3),
        variance_pct: Num.round(variancePct, 2),
        over_tolerance_flag: overTol ? 'TRUE' : 'FALSE',
        unit_price_snapshot: pl.unit_price
      });
      if (overTol && !l.over_tolerance_approved_by) {
        problems.push('Line ' + l.line_no + ': over-receipt ' + Num.round(variancePct, 1) +
                      '% exceeds the ' + tol + '% tolerance (supervisor approval needed)');
      }

      // temperature (cold chain)
      if (item.storage_temp_max_c !== '' && l.storage_temp_c !== '' &&
          Num.n(l.storage_temp_c) > Num.n(item.storage_temp_max_c)) {
        problems.push('Line ' + l.line_no + ': temperature ' + l.storage_temp_c +
                      '°C is above the maximum ' + item.storage_temp_max_c + '°C');
      }
    });

    if (problems.length) throw new AppError('VALIDATION', problems.join('; '));

    // A8 document completeness — recorded, and it gates QC PASS rather than the receipt
    const docs = this.checkDocumentCompleteness(grn, lines);
    Repo.update(SHEETS.GRN_HEADER, grn.grn_id, {
      doc_required_list: docs.required.join(','),
      doc_received_list: docs.received.join(','),
      doc_missing_list: docs.missing.join(','),
      doc_complete: docs.missing.length ? 'FALSE' : 'TRUE',
      total_lines: lines.length,
      total_qty_received: Num.round(lines.reduce((s, l) => s + Num.n(l.qty_received), 0), 3),
      total_qty_damaged: Num.round(lines.reduce((s, l) => s + Num.n(l.qty_damaged), 0), 3),
      po_revision_at_receipt: po.po_revision
    });
    if (docs.missing.length) {
      Notify.queue({
        template_id: 'DOC_MISSING',
        to: [po.buyer_email], entity_type: 'GRN', entity_no: grn.grn_no,
        vars: { grn_no: grn.grn_no, po_no: grn.po_no, missing: docs.missing.join(', ') },
        dedupe_key: 'DOC_MISSING:' + grn.grn_no
      });
    }
    return true;
  },

  checkDocumentCompleteness(grn, lines) {
    const required = {};
    lines.forEach(l => {
      const item = Repo.findOne(SHEETS.ITEMS, 'item_code', l.item_code);
      if (!item || !item.qc_spec_id) return;
      const spec = Repo.findOne(SHEETS.QC_SPECS, 'qc_spec_id', item.qc_spec_id);
      if (!spec || !spec.doc_requirements) return;
      String(spec.doc_requirements).split(',').map(s => s.trim()).filter(Boolean)
        .forEach(d => { required[d] = true; });
    });
    const have = {};
    Repo.findAll(SHEETS.DOCUMENTS, 'po_no', grn.po_no)
      .filter(d => String(d.is_current).toUpperCase() !== 'FALSE')
      .forEach(d => { have[d.doc_type] = true; });
    Repo.findAll(SHEETS.DOCUMENTS, 'entity_no', grn.grn_no).forEach(d => { have[d.doc_type] = true; });

    const req = Object.keys(required);
    return {
      required: req,
      received: req.filter(d => have[d]),
      missing: req.filter(d => !have[d])
    };
  },

  /**
   * A7 — the Warehouse → QC hand-off. Called after GRN SUBMIT succeeds.
   * Creates one QC_Header per (item, lot) and explodes QC_Lines from the current spec.
   */
  routeGrnToQc(grnNo) {
    return withLock_(() => {
      const grn = Repo.findOne(SHEETS.GRN_HEADER, 'grn_no', grnNo);
      const lines = Repo.findAll(SHEETS.GRN_LINES, 'grn_no', grnNo);
      const needQc = lines.filter(l => {
        const item = Repo.findOne(SHEETS.ITEMS, 'item_code', l.item_code) || {};
        return String(item.qc_required).toUpperCase() === 'TRUE';
      });

      if (!needQc.length) {
        // W4 — no QC required: auto-accept, log it, and post straight through
        lines.forEach(l => Repo.update(SHEETS.GRN_LINES, l.grn_line_id, {
          qty_accepted: l.qty_received, qty_rejected: 0, qty_on_hold: 0, line_status: 'ACCEPTED'
        }));
        Repo.update(SHEETS.GRN_HEADER, grn.grn_id, { qc_required: 'FALSE' });
        History.log({
          entity_type: 'GRN', entity_no: grnNo, action: 'AUTO_PASS_NO_QC_REQUIRED',
          reason: 'No line requires inspection', source: 'TRIGGER'
        });
        StateMachine.fireAsSystem('GRN', grnNo, 'AUTO_POST_NO_QC');
        this.postGrn(grnNo);
        return { qcCreated: [], autoPosted: true };
      }

      const created = [];
      const inspectors = this._activeInspectors();
      needQc.forEach((l, i) => {
        const item = Repo.findOne(SHEETS.ITEMS, 'item_code', l.item_code) || {};
        const spec = item.qc_spec_id ? Repo.findOne(SHEETS.QC_SPECS, 'qc_spec_id', item.qc_spec_id) : null;
        const labRequired = spec && String(spec.lab_required).toUpperCase() === 'TRUE';
        const slaHours = labRequired ? Config.num('QC_SLA_HOURS_LAB', 48) : Config.num('QC_SLA_HOURS', 24);
        const qcNo = Repo.nextDocNo('QC');

        const qc = Repo.insert(SHEETS.QC_HEADER, {
          qc_no: qcNo,
          grn_no: grnNo, grn_line_id: l.grn_line_id, po_no: grn.po_no, vendor_code: grn.vendor_code,
          item_id: l.item_id, item_code: l.item_code, lot_no: l.lot_no,
          qc_spec_id: spec ? spec.qc_spec_id : '', spec_version: spec ? spec.spec_version : '',
          inspection_type: 'INCOMING',
          assigned_to: inspectors.length ? inspectors[i % inspectors.length] : '',
          requested_at: Fmt.now(),
          sla_due_at: Fmt.addHours(Fmt.now(), slaHours),
          qty_submitted: l.qty_received, uom: l.uom,
          sample_size: this.aqlSampleSize(Num.n(l.qty_received), spec ? spec.aql_level : ''),
          aql_level: spec ? spec.aql_level : '',
          lab_required: labRequired ? 'TRUE' : 'FALSE',
          lab_name: labRequired && spec ? '' : '',
          result: QC_RESULT.PENDING,
          status: QC_STATUS.PENDING,
          drive_folder_id: DriveService.ensureQcFolder(grn.po_no, qcNo).getId()
        });

        // explode the spec parameters into inspection lines
        const params = spec ? Repo.findAll(SHEETS.QC_SPEC_PARAMS, 'qc_spec_id', spec.qc_spec_id)
                                  .filter(p => String(p.is_active).toUpperCase() !== 'FALSE') : [];
        if (params.length) {
          Repo.insertMany(SHEETS.QC_LINES, params
            .sort((a, b) => Num.n(a.seq) - Num.n(b.seq))
            .map(p => ({
              qc_no: qcNo, param_id: p.param_id, seq: p.seq, param_group: p.param_group,
              param_name: p.param_name, test_method: p.test_method, unit: p.unit,
              spec_min: p.spec_min, spec_max: p.spec_max, spec_text: p.spec_text,
              measured_value: '', measured_text: '', result: 'PENDING',
              defect_class: p.defect_class, is_critical: p.is_critical, defect_qty: 0
            })));
          Repo.update(SHEETS.QC_HEADER, qc.qc_id, { params_total: params.length });
        }

        Repo.update(SHEETS.GRN_LINES, l.grn_line_id, { qc_no: qcNo, line_status: 'PENDING_QC' });
        History.log({
          entity_type: 'QC', entity_no: qcNo, action: 'CREATED',
          to_status: QC_STATUS.PENDING, reason: 'Auto-created from ' + grnNo, source: 'TRIGGER'
        });
        created.push(qcNo);
      });

      Repo.update(SHEETS.GRN_HEADER, grn.grn_id, { qc_required: 'TRUE', qc_nos: created.join(',') });
      StateMachine.fireAsSystem('GRN', grnNo, 'ROUTE_TO_QC');

      Notify.queue({
        template_id: 'GRN_PENDING_QC',
        to: [Config.get('QC_GROUP_EMAIL', Props.get('ADMIN_EMAIL'))].concat(inspectors),
        entity_type: 'GRN', entity_no: grnNo,
        vars: { grn_no: grnNo, po_no: grn.po_no, vendor: grn.vendor_code,
                qc_count: created.length, qc_nos: created.join(', ') },
        dedupe_key: 'GRN_PENDING_QC:' + grnNo
      });

      return { qcCreated: created, autoPosted: false };
    });
  },

  _activeInspectors() {
    return Repo.readAll(SHEETS.USERS)
      .filter(u => String(u.is_active).toUpperCase() === 'TRUE' &&
                   String(u.role_codes).indexOf(ROLES.QC_INSPECTOR) >= 0)
      .map(u => u.email);
  },

  /** ISO 2859-1 general inspection level II, single sampling — code letter by lot size. */
  aqlSampleSize(lotQty, aqlLevel) {
    const bands = [
      [8, 2], [15, 3], [25, 5], [50, 8], [90, 13], [150, 20], [280, 32], [500, 50],
      [1200, 80], [3200, 125], [10000, 200], [35000, 315], [150000, 500], [500000, 800]
    ];
    for (let i = 0; i < bands.length; i++) if (lotQty <= bands[i][0]) return bands[i][1];
    return 1250;
  },

  /* ------------------------------------------------- QC completion (Q3–Q5) */

  validateQcCompletion(qc, ctx, intendedResult) {
    const lines = Repo.findAll(SHEETS.QC_LINES, 'qc_no', qc.qc_no);
    const accepted = Num.n(ctx.qty_accepted);
    const rejected = Num.n(ctx.qty_rejected);
    const onHold = Num.n(ctx.qty_on_hold);
    const submitted = Num.n(qc.qty_submitted);

    if (Math.abs(accepted + rejected + onHold - submitted) > 0.001) {
      throw new AppError('QTY_MISMATCH',
        'Accepted + rejected + on hold (' + (accepted + rejected + onHold) +
        ') must equal the submitted quantity (' + submitted + ').');
    }

    if (intendedResult === QC_RESULT.PASS) {
      const blank = lines.filter(l =>
        String(l.result) === 'PENDING' && String(l.measured_value) === '' && String(l.measured_text) === '');
      const mandatoryBlank = blank.filter(l => {
        const p = Repo.findOne(SHEETS.QC_SPEC_PARAMS, 'param_id', l.param_id);
        return !p || String(p.is_mandatory).toUpperCase() !== 'FALSE';
      });
      if (mandatoryBlank.length) {
        throw new AppError('INCOMPLETE',
          'Record a result for: ' + mandatoryBlank.map(l => l.param_name).join(', '));
      }
      const criticalFail = lines.filter(l =>
        l.result === 'FAIL' && String(l.is_critical).toUpperCase() === 'TRUE');
      if (criticalFail.length) {
        throw new AppError('CRITICAL_FAIL',
          'Cannot pass: critical parameter failed (' + criticalFail.map(l => l.param_name).join(', ') + ').');
      }
      const grn = Repo.findOne(SHEETS.GRN_HEADER, 'grn_no', qc.grn_no);
      if (grn && grn.doc_missing_list && String(grn.doc_complete).toUpperCase() === 'FALSE') {
        throw new AppError('DOC_MISSING',
          'Cannot pass while mandatory documents are missing: ' + grn.doc_missing_list +
          '. Record CONDITIONAL or FAIL instead.');
      }
      if (rejected > 0) {
        throw new AppError('RESULT_MISMATCH',
          'A rejected quantity means the result is FAIL or CONDITIONAL, not PASS.');
      }
    }

    if (intendedResult === QC_RESULT.FAIL && !(ctx.fail_reason_codes || '').length) {
      throw new AppError('REASON_REQUIRED', 'Select at least one failure reason code.');
    }
    return true;
  },

  /**
   * A10 — record the QC outcome and drive everything downstream.
   * @param {object} ctx { result, qty_accepted, qty_rejected, qty_on_hold, fail_reason_codes,
   *                       conditional_reason, conditional_deduction_pct, defects, remark }
   */
  completeQc(qcNo, ctx) {
    return safely_('completeQc', () => withLock_(() => {
      const qc = Repo.findOne(SHEETS.QC_HEADER, 'qc_no', qcNo);
      if (!qc) throw new AppError('NOT_FOUND', 'QC ' + qcNo + ' not found.');

      const action = ctx.result === QC_RESULT.PASS ? 'COMPLETE_PASS'
                   : ctx.result === QC_RESULT.FAIL ? 'COMPLETE_FAIL'
                   : 'PROPOSE_CONDITIONAL';
      StateMachine.fire('QC', qcNo, action, ctx);

      const completedAt = Fmt.now();
      Repo.update(SHEETS.QC_HEADER, qc.qc_id, {
        result: ctx.result,
        qty_accepted: Num.n(ctx.qty_accepted),
        qty_rejected: Num.n(ctx.qty_rejected),
        qty_conditional: Num.n(ctx.qty_on_hold),
        fail_reason_codes: ctx.fail_reason_codes || '',
        critical_defects: Num.n(ctx.critical_defects),
        major_defects: Num.n(ctx.major_defects),
        minor_defects: Num.n(ctx.minor_defects),
        completed_at: completedAt,
        turnaround_hours: Fmt.hoursBetween(qc.requested_at, completedAt),
        remark: ctx.remark || qc.remark
      });

      // GRN line acceptance follows the lot, not the delivery (edge case 2)
      const grnLine = Repo.findOne(SHEETS.GRN_LINES, 'grn_line_id', qc.grn_line_id);
      if (grnLine) {
        Repo.update(SHEETS.GRN_LINES, grnLine.grn_line_id, {
          qty_accepted: Num.n(ctx.qty_accepted),
          qty_rejected: Num.n(ctx.qty_rejected),
          qty_on_hold: Num.n(ctx.qty_on_hold),
          reject_reason_code: ctx.fail_reason_codes || '',
          line_status: Num.n(ctx.qty_rejected) === 0 ? 'ACCEPTED'
                     : Num.n(ctx.qty_accepted) === 0 ? 'REJECTED' : 'PARTIAL_ACCEPT'
        });
      }

      DocGen.generateQcReport(qcNo);

      if (ctx.result === QC_RESULT.FAIL) {
        const ncrNo = this.raiseNcr({
          source_type: 'QC', source_no: qcNo, qc_no: qcNo, grn_no: qc.grn_no, po_no: qc.po_no,
          vendor_code: qc.vendor_code, item_code: qc.item_code, lot_no: qc.lot_no,
          qty_affected: Num.n(ctx.qty_rejected), uom: qc.uom,
          defect_category: ctx.fail_reason_codes || '', defect_detail: ctx.remark || '',
          severity: Num.n(ctx.critical_defects) > 0 ? 'CRITICAL' : 'MAJOR',
          claim_target: ctx.claim_target || 'VENDOR', blocks_payment: 'TRUE'
        });
        StateMachine.fireAsSystem('GRN', qc.grn_no, 'QC_FAIL');
        StateMachine.fireAsSystem('GRN', qc.grn_no, 'QUARANTINE');
        this.applyApHold(qc.po_no, 'QC failure on ' + qcNo + ' / lot ' + qc.lot_no + ' (' + ncrNo + ')');

        // a partial acceptance still posts the good quantity
        if (Num.n(ctx.qty_accepted) > 0) {
          StateMachine.fireAsSystem('GRN', qc.grn_no, 'POST_ACCEPTED_PORTION');
          this.postGrn(qc.grn_no, { partial: true });
        }
        return { result: ctx.result, ncr_no: ncrNo };
      }

      if (ctx.result === QC_RESULT.CONDITIONAL) {
        // waits for QC Manager + buyer sign-off before posting (Q4)
        Notify.queue({
          template_id: 'QC_CONDITIONAL_APPROVAL',
          to: [Config.get('QC_MGR_EMAIL', Props.get('ADMIN_EMAIL')), this._buyerOf(qc.po_no)],
          entity_type: 'QC', entity_no: qcNo,
          vars: { qc_no: qcNo, item: qc.item_code, lot: qc.lot_no,
                  reason: ctx.conditional_reason, deduction: ctx.conditional_deduction_pct }
        });
        return { result: ctx.result, awaiting: 'QC_MGR_AND_BUYER' };
      }

      // PASS — the only fully automatic path
      if (this._allQcDoneFor(qc.grn_no)) {
        StateMachine.fireAsSystem('GRN', qc.grn_no, 'QC_PASS');
        StateMachine.fireAsSystem('GRN', qc.grn_no, 'POST');
        this.postGrn(qc.grn_no);
      }
      return { result: ctx.result };
    }), { entityType: 'QC', entityNo: qcNo });
  },

  /** Conditional accept approved by QC Manager: post, and record the agreed deduction. */
  approveConditional(qcNo) {
    return withLock_(() => {
      StateMachine.fire('QC', qcNo, 'APPROVE_CONDITIONAL', {});
      const qc = Repo.findOne(SHEETS.QC_HEADER, 'qc_no', qcNo);
      Repo.update(SHEETS.QC_HEADER, qc.qc_id, { result: QC_RESULT.CONDITIONAL });
      this.raiseNcr({
        source_type: 'QC', source_no: qcNo, qc_no: qcNo, grn_no: qc.grn_no, po_no: qc.po_no,
        vendor_code: qc.vendor_code, item_code: qc.item_code, lot_no: qc.lot_no,
        qty_affected: Num.n(qc.qty_submitted), uom: qc.uom,
        defect_category: 'SPEC_DEVIATION', defect_detail: qc.conditional_reason,
        severity: 'MINOR', claim_target: 'VENDOR',
        disposition: Num.n(qc.conditional_deduction_pct) > 0 ? 'PRICE_DEDUCTION' : 'CONCESSION',
        claim_type: Num.n(qc.conditional_deduction_pct) > 0 ? 'DEBIT_NOTE' : 'NONE',
        blocks_payment: 'FALSE'
      });
      if (this._allQcDoneFor(qc.grn_no)) {
        StateMachine.fireAsSystem('GRN', qc.grn_no, 'QC_CONDITIONAL');
        StateMachine.fireAsSystem('GRN', qc.grn_no, 'POST');
        this.postGrn(qc.grn_no);
      }
      return { ok: true };
    });
  },

  _allQcDoneFor(grnNo) {
    const all = Repo.findAll(SHEETS.QC_HEADER, 'grn_no', grnNo);
    return all.length > 0 && all.every(q => q.status === QC_STATUS.COMPLETED);
  },

  _buyerOf(poNo) {
    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
    return po ? po.buyer_email : Props.get('ADMIN_EMAIL');
  },

  /* -------------------------------------------- W6 — post GRN, roll up PO */

  postGrn(grnNo, opts) {
    opts = opts || {};
    const grn = Repo.findOne(SHEETS.GRN_HEADER, 'grn_no', grnNo);
    const lines = Repo.findAll(SHEETS.GRN_LINES, 'grn_no', grnNo);

    Repo.update(SHEETS.GRN_HEADER, grn.grn_id, {
      posted_at: Fmt.now(), posted_by: Auth.currentEmail(),
      qc_result_summary: Repo.findAll(SHEETS.QC_HEADER, 'grn_no', grnNo)
        .map(q => q.qc_no + ':' + q.result).join(',')
    });

    // optional stock ledger
    if (Config.bool('ENABLE_STOCK_LEDGER', 'FALSE')) {
      Repo.insertMany(SHEETS.STOCK_LEDGER, lines
        .filter(l => Num.n(l.qty_accepted) > 0)
        .map(l => ({
          txn_datetime: Fmt.now(), txn_type: 'GR', source_doc_type: 'GRN', source_doc_no: grnNo,
          warehouse_id: grn.warehouse_id, location_bin: l.location_bin, item_code: l.item_code,
          lot_no: l.lot_no, expiry_date: l.expiry_date, qty_in: l.qty_accepted, qty_out: 0,
          uom: l.uom, unit_cost: l.unit_price_snapshot,
          value_in: Num.round(Num.n(l.qty_accepted) * Num.n(l.unit_price_snapshot), 2), value_out: 0
        })));
    }

    this.recomputePo(grn.po_no);

    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', grn.po_no);
    Notify.queue({
      template_id: 'QC_PASSED',
      to: [po.buyer_email, Config.get('AP_GROUP_EMAIL', Props.get('ADMIN_EMAIL')),
           Config.get('WH_GROUP_EMAIL', Props.get('ADMIN_EMAIL'))],
      entity_type: 'GRN', entity_no: grnNo,
      vars: { grn_no: grnNo, po_no: grn.po_no, vendor: grn.vendor_code,
              partial: opts.partial ? 'YES' : 'NO',
              qty_accepted: lines.reduce((s, l) => s + Num.n(l.qty_accepted), 0) },
      dedupe_key: 'READY_TO_INVOICE:' + grnNo
    });

    // an invoice may already be parked waiting for this receipt (edge case 11)
    Repo.findAll(SHEETS.INV_HEADER, 'po_no', grn.po_no)
      .filter(i => i.match_status === MATCH_STATUS.NO_GRN)
      .forEach(i => StateMachine.fireAsSystem('INVOICE', i.inv_internal_no, 'RUN_MATCH'));

    return { posted: grnNo };
  },

  /** Roll GRN quantities up to PO lines and recompute the PO header status (P9). */
  recomputePo(poNo) {
    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
    if (!po) return;
    const poLines = Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo);

    const postedGrns = Repo.findAll(SHEETS.GRN_HEADER, 'po_no', poNo)
      .filter(g => [GRN_STATUS.POSTED, GRN_STATUS.PARTIALLY_POSTED].indexOf(g.status) >= 0)
      .map(g => g.grn_no);
    const grnLines = postedGrns.reduce(
      (acc, no) => acc.concat(Repo.findAll(SHEETS.GRN_LINES, 'grn_no', no)), []);
    const invLines = Repo.findAll(SHEETS.INV_LINES, 'po_no', poNo);

    poLines.forEach(pl => {
      const mine = grnLines.filter(g => String(g.po_line_no) === String(pl.line_no));
      const received = mine.reduce((s, g) => s + Num.n(g.qty_received), 0);
      const accepted = mine.reduce((s, g) => s + Num.n(g.qty_accepted), 0);
      const rejected = mine.reduce((s, g) => s + Num.n(g.qty_rejected), 0);
      const invoiced = invLines.filter(i => String(i.po_line_no) === String(pl.line_no))
        .reduce((s, i) => s + Num.n(i.qty_invoiced), 0);
      const ordered = Num.n(pl.qty_ordered);
      const open = Math.max(0, ordered - accepted);

      let status = pl.line_status;
      if (['CANCELLED', 'SHORT_CLOSED'].indexOf(status) < 0) {
        status = accepted <= 0 ? 'OPEN' : (open <= 0 ? 'RECEIVED' : 'PARTIAL');
      }
      Repo.update(SHEETS.PO_LINES, pl.po_line_id, {
        qty_received: Num.round(received, 3), qty_accepted: Num.round(accepted, 3),
        qty_rejected: Num.round(rejected, 3), qty_invoiced: Num.round(invoiced, 3),
        qty_open: Num.round(open, 3), line_status: status
      });
    });

    const fresh = Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo);
    const closedStates = ['RECEIVED', 'CLOSED', 'CANCELLED', 'SHORT_CLOSED'];
    const anyReceipt = fresh.some(l => Num.n(l.qty_received) > 0);
    const allClosed = fresh.every(l => closedStates.indexOf(l.line_status) >= 0);
    const overReceived = fresh.some(l => Num.n(l.qty_received) > Num.n(l.qty_ordered));
    const receiptStatus = !anyReceipt ? 'NONE' : overReceived ? 'OVER' : allClosed ? 'FULL' : 'PARTIAL';

    const totalOrdered = fresh.reduce((s, l) => s + Num.n(l.qty_ordered), 0);
    const totalInvoiced = fresh.reduce((s, l) => s + Num.n(l.qty_invoiced), 0);
    const invoiceStatus = totalInvoiced <= 0 ? 'NONE'
      : totalInvoiced >= totalOrdered ? 'FULL' : 'PARTIAL';

    const openNcrs = Repo.findAll(SHEETS.NCR, 'po_no', poNo)
      .filter(n => ['CLOSED', 'CANCELLED'].indexOf(n.status) < 0);

    Repo.update(SHEETS.PO_HEADER, po.po_id, {
      receipt_status: receiptStatus,
      invoice_status: invoiceStatus,
      has_open_ncr: openNcrs.length ? 'TRUE' : 'FALSE',
      open_ncr_nos: openNcrs.map(n => n.ncr_no).join(',')
    });

    // header status follows the lines, via the state machine so it stays audited
    const target = allClosed && anyReceipt ? PO_STATUS.FULLY_RECEIVED
                 : anyReceipt ? PO_STATUS.PARTIALLY_RECEIVED : null;
    if (target && po.status !== target) {
      try { StateMachine.fireAsSystem('PO', poNo, 'RECEIPT_POSTED'); }
      catch (e) { Logger.log('PO status recompute skipped for ' + poNo + ': ' + e.message); }
    }
  },

  reverseGrnEffect(grn, reason) {
    // Reversal is a new negative receipt, never an edit of history (edge case 17)
    const lines = Repo.findAll(SHEETS.GRN_LINES, 'grn_no', grn.grn_no);
    const revNo = Repo.nextDocNo('GRN');
    Repo.insert(SHEETS.GRN_HEADER, Object.assign({}, grn, {
      grn_id: '', grn_no: revNo, grn_date: Fmt.today(), received_datetime: Fmt.now(),
      status: GRN_STATUS.POSTED, reversal_of_grn_no: grn.grn_no,
      idempotency_key: 'REVERSAL:' + grn.grn_no, remark: 'Reversal: ' + reason,
      posted_at: Fmt.now(), posted_by: Auth.currentEmail(), row_version: ''
    }));
    Repo.insertMany(SHEETS.GRN_LINES, lines.map(l => Object.assign({}, l, {
      grn_line_id: '', grn_no: revNo,
      qty_received: -Num.n(l.qty_received), qty_accepted: -Num.n(l.qty_accepted),
      qty_rejected: -Num.n(l.qty_rejected), qty_on_hold: 0, line_status: 'ACCEPTED',
      notes: 'Reversal of ' + grn.grn_no
    })));
    this.recomputePo(grn.po_no);
    return { reversed_by_grn_no: revNo };
  },

  /* --------------------------------------------------- A12 — NCR and holds */

  raiseNcr(rec) {
    const ncrNo = Repo.nextDocNo('NCR');
    const poLine = rec.po_no ? Repo.findAll(SHEETS.PO_LINES, 'po_no', rec.po_no)
      .filter(l => l.item_code === rec.item_code)[0] : null;
    const unitPrice = poLine ? Num.n(poLine.unit_price) : 0;

    const ncr = Repo.insert(SHEETS.NCR, Object.assign({
      ncr_no: ncrNo, ncr_date: Fmt.today(), status: 'OPEN',
      owner_email: this._buyerOf(rec.po_no),
      unit_price: unitPrice,
      financial_impact_amount: Num.round(Num.n(rec.qty_affected) * unitPrice, 2),
      drive_folder_id: DriveService.ensureNcrFolder(rec.po_no, ncrNo).getId()
    }, rec));

    History.log({
      entity_type: 'NCR', entity_no: ncrNo, action: 'CREATED', to_status: 'OPEN',
      reason: 'Auto-created from ' + rec.source_no, source: 'TRIGGER'
    });

    DocGen.generateNcrReport(ncrNo);

    const vendor = Repo.findOne(SHEETS.VENDORS, 'vendor_code', rec.vendor_code);
    Notify.queue({
      template_id: 'QC_FAILED',
      to: [ncr.owner_email, Config.get('QC_MGR_EMAIL', Props.get('ADMIN_EMAIL')),
           Config.get('WH_GROUP_EMAIL', Props.get('ADMIN_EMAIL')),
           Config.get('AP_GROUP_EMAIL', Props.get('ADMIN_EMAIL'))],
      entity_type: 'NCR', entity_no: ncrNo,
      vars: { ncr_no: ncrNo, qc_no: rec.qc_no, grn_no: rec.grn_no, po_no: rec.po_no,
              item: rec.item_code, lot: rec.lot_no, qty: rec.qty_affected,
              defect: rec.defect_category, vendor: vendor ? vendor.vendor_name_en : rec.vendor_code }
    });
    if (vendor && vendor.contact_email) {
      Notify.queue({
        template_id: 'NCR_TO_VENDOR', to: [vendor.contact_email], cc: [ncr.owner_email],
        entity_type: 'NCR', entity_no: ncrNo,
        vars: { ncr_no: ncrNo, po_no: rec.po_no, item: rec.item_code, lot: rec.lot_no,
                qty: rec.qty_affected, defect: rec.defect_category }
      });
      Repo.update(SHEETS.NCR, ncr.ncr_id, { vendor_notified_at: Fmt.now(), status: 'VENDOR_NOTIFIED' });
    }

    if (rec.po_no) this.recomputePo(rec.po_no);
    return ncrNo;
  },

  /** A7 in doc 01 §3.4 — freeze payment on invoices for a PO whose lot failed QC. */
  applyApHold(poNo, reason) {
    Repo.findAll(SHEETS.INV_HEADER, 'po_no', poNo)
      .filter(i => [MATCH_STATUS.PAID, MATCH_STATUS.REJECTED].indexOf(i.match_status) < 0)
      .forEach(i => {
        Repo.update(SHEETS.INV_HEADER, i.inv_id, { qc_hold_flag: 'TRUE', qc_hold_reason: reason });
        if (i.match_status === MATCH_STATUS.MATCHED) {
          try { StateMachine.fireAsSystem('INVOICE', i.inv_internal_no, 'APPLY_QC_HOLD', { reason: reason }); }
          catch (e) { Logger.log('hold transition skipped: ' + e.message); }
        }
        Notify.queue({
          template_id: 'INVOICE_EXCEPTION',
          to: [i.ap_owner_email || Config.get('AP_GROUP_EMAIL', Props.get('ADMIN_EMAIL'))],
          entity_type: 'INVOICE', entity_no: i.inv_internal_no,
          vars: { inv_no: i.inv_internal_no, exception: 'QC_REJECTED', detail: reason },
          dedupe_key: 'QC_HOLD:' + i.inv_internal_no
        });
      });
  }
};

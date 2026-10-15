/**
 * 08_Api.gs — the web app entry points, request router, dashboards, and the AP helpers.
 *
 * Security model (docs/04 §8):
 *   - identity comes from the session, never the request body
 *   - authorisation is checked before any read, deny-by-default
 *   - responses are stripped of fields the caller's role may not see
 *   - the spreadsheet ID is never sent to the client
 */

function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p.action === 'decide') return ApprovalLinks.handle(p);

  if (p.api) {
    return ContentService
      .createTextOutput(JSON.stringify(Api.handle(p.api, p)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const tpl = HtmlService.createTemplateFromFile('index');
  tpl.bootstrap = JSON.stringify(safeCall_(() => Api.handle('bootstrap', p)));
  return tpl.evaluate()
    .setTitle('PU-ACC — Procure to Pay')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function doPost(e) {
  let payload = {};
  try {
    payload = e && e.postData ? JSON.parse(e.postData.contents) : {};
  } catch (err) {
    payload = {};
  }
  return ContentService
    .createTextOutput(JSON.stringify(Api.handle(payload.api, payload)))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Called from the HTML client via google.script.run. */
function apiCall(action, payload) {
  return Api.handle(action, payload || {});
}

function safeCall_(fn) {
  try { return { ok: true, data: fn() }; }
  catch (e) { return { ok: false, code: e.code || 'INTERNAL', error: e.message }; }
}

const Api = {

  /** action -> { module, permission, fn }. An action not listed here cannot be called. */
  routes() {
    return {
      // read
      bootstrap:        { module: 'REPORT', permission: 'VIEW', fn: p => Dashboard.bootstrap() },
      myQueue:          { module: 'REPORT', permission: 'VIEW', fn: p => Dashboard.queueFor(Auth.currentUser()) },
      bottleneck:       { module: 'REPORT', permission: 'VIEW', fn: p => Dashboard.bottleneck() },
      trace:            { module: 'REPORT', permission: 'VIEW', fn: p => Dashboard.trace(p.no) },
      search:           { module: 'REPORT', permission: 'VIEW', fn: p => Dashboard.search(p.q) },
      getRecord:        { module: 'REPORT', permission: 'VIEW', fn: p => Dashboard.record(p.entityType, p.no) },
      lookups:          { module: 'REPORT', permission: 'VIEW', fn: p => Dashboard.lookups(p.groups) },

      // purchasing
      savePo:           { module: 'PO', permission: 'CREATE', fn: p => PoService.save(p.header, p.lines) },
      submitPo:         { module: 'PO', permission: 'SUBMIT', fn: p => StateMachine.fire('PO', p.no, 'SUBMIT', p) },
      approvePo:        { module: 'PO', permission: 'APPROVE', fn: p => PoService.approve(p.no, p) },
      rejectPo:         { module: 'PO', permission: 'APPROVE', fn: p => StateMachine.fire('PO', p.no, 'REJECT', p) },
      generatePoPdf:    { module: 'PO', permission: 'EDIT', fn: p => DocGen.generatePoPdf(p.no) },
      sendPoToVendor:   { module: 'PO', permission: 'EDIT', fn: p => PoService.send(p.no) },
      revisePo:         { module: 'PO', permission: 'EDIT', fn: p => PoService.revise(p.no, p.changes, p.reason) },
      shortClosePo:     { module: 'PO', permission: 'EDIT', fn: p => StateMachine.fire('PO', p.no, 'SHORT_CLOSE', p) },

      // warehouse
      startGrn:         { module: 'GRN', permission: 'CREATE', fn: p => GrnService.start(p.po_no) },
      saveGrn:          { module: 'GRN', permission: 'CREATE', fn: p => GrnService.save(p.header, p.lines) },
      submitGrn:        { module: 'GRN', permission: 'SUBMIT', fn: p => GrnService.submit(p.no, p) },
      reverseGrn:       { module: 'GRN', permission: 'REVERSE', fn: p => StateMachine.fire('GRN', p.no, 'REVERSE', p) },

      // QC
      startQc:          { module: 'QC', permission: 'EDIT', fn: p => StateMachine.fire('QC', p.no, 'START', p) },
      saveQcLines:      { module: 'QC', permission: 'EDIT', fn: p => QcService.saveLines(p.no, p.lines) },
      sendQcToLab:      { module: 'QC', permission: 'EDIT', fn: p => StateMachine.fire('QC', p.no, 'SEND_TO_LAB', p) },
      completeQc:       { module: 'QC', permission: 'SUBMIT', fn: p => Workflow.completeQc(p.no, p) },
      approveConditional: { module: 'QC', permission: 'APPROVE', fn: p => Workflow.approveConditional(p.no) },

      // NCR
      updateNcr:        { module: 'NCR', permission: 'EDIT', fn: p => NcrService.update(p.no, p.patch) },
      approveDisposition: { module: 'NCR', permission: 'APPROVE', fn: p => NcrService.approveDisposition(p.no, p) },

      // accounting
      registerInvoice:  { module: 'INVOICE', permission: 'CREATE', fn: p => Match.registerInvoice(p.header, p.lines) },
      runMatch:         { module: 'INVOICE', permission: 'EDIT', fn: p => Match.runOne(p.no) },
      resolveException: { module: 'INVOICE', permission: 'EDIT', fn: p => ApService.resolveException(p.no, p) },
      approveInvoice:   { module: 'INVOICE', permission: 'APPROVE', fn: p => StateMachine.fire('INVOICE', p.no, 'APPROVE', p) },
      releaseQcHold:    { module: 'INVOICE', permission: 'APPROVE', fn: p => StateMachine.fire('INVOICE', p.no, 'RELEASE_QC_HOLD', p) },
      buildPayment:     { module: 'PAYMENT', permission: 'CREATE', fn: p => Payments.build(p.invoiceNos, p) },
      executePayment:   { module: 'PAYMENT', permission: 'APPROVE', fn: p => Payments.execute(p.no, p) },

      // documents
      uploadDocument:   { module: 'REPORT', permission: 'VIEW', fn: p => DriveService.upload(p) },
      listDocuments:    { module: 'REPORT', permission: 'VIEW', fn: p => DriveService.documentsForPo(p.po_no) }
    };
  },

  handle(action, payload) {
    const route = this.routes()[action];
    if (!route) return { ok: false, code: 'UNKNOWN_ACTION', error: 'Unknown action: ' + action };
    try {
      Auth.currentUser();                                   // registered + active
      Auth.require(route.module, route.permission);          // deny by default
      const data = route.fn(payload || {});
      return { ok: true, data: Redact.forRole(data) };
    } catch (e) {
      if (!(e instanceof AppError)) {
        ErrorLog.write({
          severity: 'ERROR', function_name: 'Api.' + action,
          error_message: String(e.message || e), stack: String(e.stack || '').slice(0, 2000),
          actor_email: Auth.currentEmail(), payload_json: Json.safe(payload, 2000)
        });
        Notify.alertAdmin('Api.' + action, e, '');
        return { ok: false, code: 'INTERNAL', error: 'Something went wrong. IT has been notified.' };
      }
      return { ok: false, code: e.code, error: e.message, requestId: e.requestId };
    }
  }
};

/** Strip fields the caller's role must not see — warehouse and QC never see money. */
const Redact = {
  MONEY_FIELDS: ['unit_price', 'line_amount', 'subtotal_amount', 'total_amount', 'total_amount_thb',
    'discount_amount', 'vat_amount', 'wht_amount', 'net_payable', 'standard_cost',
    'last_purchase_price', 'unit_price_snapshot', 'value_open_thb', 'financial_impact_amount',
    'claim_amount', 'bank_account_no', 'bank_swift'],

  forRole(data) {
    const roles = Auth.roles();
    const seesMoney = [ROLES.BUYER, ROLES.PUR_MGR, ROLES.AP_OFFICER, ROLES.FIN_MGR,
                       ROLES.MGMT_VIEW, ROLES.SYS_ADMIN].some(r => roles.indexOf(r) >= 0);
    if (seesMoney || Auth.isSystem()) return data;
    return this._strip(data);
  },

  _strip(v) {
    if (Array.isArray(v)) return v.map(x => this._strip(x));
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).forEach(k => {
        if (this.MONEY_FIELDS.indexOf(k) >= 0) return;
        out[k] = this._strip(v[k]);
      });
      return out;
    }
    return v;
  }
};

/* ------------------------------------------------------------------ dashboards */

const Dashboard = {

  bootstrap() {
    const u = Auth.currentUser();
    return {
      user: { email: u.email, name: u.full_name, department: u.department, roles: Auth.roles(u) },
      queue: this.queueFor(u),
      bottleneck: Auth.hasRole(ROLES.MGMT_VIEW) || Auth.hasRole(ROLES.SYS_ADMIN) ? this.bottleneck() : [],
      config: { company: Config.get('COMPANY_NAME', ''), env: Props.get('ENV', 'PROD') }
    };
  },

  /** "What needs me now" — the only thing a dashboard has to get right. */
  queueFor(user) {
    const roles = String(user.role_codes || '').split(',').map(s => s.trim());
    const email = user.email;
    const now = Fmt.now();
    const groups = [];
    const has = r => roles.indexOf(r) >= 0;

    if (has(ROLES.BUYER)) {
      groups.push({
        title: 'PRs to convert', rows: Repo.readAll(SHEETS.PR_HEADER)
          .filter(p => p.status === 'APPROVED')
          .map(p => ({ no: p.pr_no, summary: p.department + ' — ' + p.purpose }))
      });
      groups.push({
        title: 'My POs to fix or send', rows: Repo.readAll(SHEETS.PO_HEADER)
          .filter(p => p.buyer_email === email &&
                       [PO_STATUS.DRAFT, PO_STATUS.REJECTED, PO_STATUS.APPROVED].indexOf(p.status) >= 0)
          .map(p => ({ no: p.po_no, summary: p.vendor_name + ' — ' + p.status }))
      });
      groups.push({
        title: 'Exceptions assigned to me', rows: Repo.readAll(SHEETS.VW_AP_EXCEPTIONS)
          .filter(r => r.routed_to === email)
          .map(r => ({ no: r.inv_internal_no, summary: r.exception_code + ' — ' + r.vendor_code,
                       aging_hrs: r.aging_hrs }))
      });
      groups.push({
        title: 'QC failures needing disposition', rows: Repo.readAll(SHEETS.NCR)
          .filter(n => n.owner_email === email && ['OPEN', 'VENDOR_NOTIFIED', 'VENDOR_RESPONDED'].indexOf(n.status) >= 0)
          .map(n => ({ no: n.ncr_no, summary: n.item_code + ' lot ' + n.lot_no + ' — ' + n.defect_category }))
      });
    }

    if (has(ROLES.PUR_MGR) || has(ROLES.FIN_MGR)) {
      groups.push({
        title: 'Awaiting my approval', rows: []
          .concat(Repo.readAll(SHEETS.PO_HEADER)
            .filter(p => p.status === PO_STATUS.PENDING_APPROVAL)
            .map(p => ({ no: p.po_no, summary: 'PO ' + p.vendor_name,
                         aging_hrs: Fmt.hoursBetween(p.updated_at, now) })))
          .concat(has(ROLES.FIN_MGR) ? Repo.readAll(SHEETS.INV_HEADER)
            .filter(i => i.match_status === MATCH_STATUS.MATCHED)
            .map(i => ({ no: i.inv_internal_no, summary: 'Invoice ' + i.vendor_code,
                         aging_hrs: Fmt.hoursBetween(i.match_run_at, now) })) : [])
      });
    }

    if (has(ROLES.WH_OFFICER) || has(ROLES.WH_SUP)) {
      groups.push({
        title: 'Expected deliveries', rows: Repo.readAll(SHEETS.VW_OPEN_PO)
          .filter(r => Num.n(r.qty_open_lines) > 0)
          .map(r => ({ no: r.po_no, summary: r.vendor_name +
                       (Num.n(r.days_late) > 0 ? ' — overdue ' + r.days_late + 'd' : '') }))
      });
      groups.push({
        title: 'My draft receipts', rows: Repo.readAll(SHEETS.GRN_HEADER)
          .filter(g => g.status === GRN_STATUS.DRAFT && g.receiver_email === email)
          .map(g => ({ no: g.grn_no, summary: 'PO ' + g.po_no,
                       aging_hrs: Fmt.hoursBetween(g.created_at, now) }))
      });
      if (has(ROLES.WH_SUP)) {
        groups.push({
          title: 'Over-tolerance approvals', rows: Repo.readAll(SHEETS.GRN_LINES)
            .filter(l => String(l.over_tolerance_flag).toUpperCase() === 'TRUE' && !l.over_tolerance_approved_by)
            .map(l => ({ no: l.grn_no, summary: l.item_code + ' +' + l.variance_pct + '%' }))
        });
      }
    }

    if (has(ROLES.QC_INSPECTOR) || has(ROLES.QC_MGR)) {
      groups.push({
        title: 'Inspection queue', rows: Repo.readAll(SHEETS.VW_PENDING_QC)
          .filter(r => has(ROLES.QC_MGR) || !r.inspector_email || r.inspector_email === email)
          .map(r => ({ no: r.qc_no, summary: r.item_code + ' lot ' + r.lot_no + ' — ' + r.qty_submitted,
                       aging_hrs: r.aging_hrs }))
      });
      if (has(ROLES.QC_MGR)) {
        groups.push({
          title: 'Concessions to approve', rows: Repo.readAll(SHEETS.QC_HEADER)
            .filter(q => q.status === QC_STATUS.PENDING_APPROVAL)
            .map(q => ({ no: q.qc_no, summary: q.item_code + ' — ' + q.conditional_reason }))
        });
      }
    }

    if (has(ROLES.AP_OFFICER)) {
      groups.push({
        title: 'Ready to invoice', rows: Repo.readAll(SHEETS.GRN_HEADER)
          .filter(g => g.status === GRN_STATUS.POSTED)
          .filter(g => !Repo.findAll(SHEETS.INV_HEADER, 'po_no', g.po_no).length)
          .map(g => ({ no: g.grn_no, summary: 'PO ' + g.po_no + ' — ' + g.vendor_code }))
      });
      groups.push({
        title: 'Invoice exceptions', rows: Repo.readAll(SHEETS.VW_AP_EXCEPTIONS)
          .map(r => ({ no: r.inv_internal_no, summary: r.exception_code + ' — ' + r.vendor_code,
                       aging_hrs: r.aging_hrs }))
      });
    }

    return groups.filter(g => g.rows.length);
  },

  bottleneck() {
    return Repo.readAll(SHEETS.VW_BOTTLENECK)
      .sort((a, b) => Num.n(a.bottleneck_rank) - Num.n(b.bottleneck_rank));
  },

  /** Global search: any document number, a lot number, or a container number. */
  search(q) {
    if (!q || String(q).length < 3) return [];
    const needle = String(q).toUpperCase();
    const out = [];
    const push = (type, no, summary) => out.push({ entityType: type, no: no, summary: summary });

    Repo.readAll(SHEETS.PO_HEADER).forEach(r => {
      if (String(r.po_no).toUpperCase().indexOf(needle) >= 0)
        push('PO', r.po_no, r.vendor_name + ' — ' + r.status);
    });
    Repo.readAll(SHEETS.GRN_HEADER).forEach(r => {
      if ([r.grn_no, r.delivery_note_no, r.vehicle_or_container_no, r.bl_awb_no]
          .some(v => String(v || '').toUpperCase().indexOf(needle) >= 0))
        push('GRN', r.grn_no, 'PO ' + r.po_no + ' — ' + r.status);
    });
    Repo.readAll(SHEETS.GRN_LINES).forEach(r => {
      if (String(r.lot_no || '').toUpperCase().indexOf(needle) >= 0)
        push('GRN', r.grn_no, 'lot ' + r.lot_no + ' — ' + r.item_code);
    });
    Repo.readAll(SHEETS.QC_HEADER).forEach(r => {
      if ([r.qc_no, r.lot_no].some(v => String(v || '').toUpperCase().indexOf(needle) >= 0))
        push('QC', r.qc_no, r.item_code + ' — ' + r.result);
    });
    Repo.readAll(SHEETS.NCR).forEach(r => {
      if (String(r.ncr_no).toUpperCase().indexOf(needle) >= 0)
        push('NCR', r.ncr_no, r.item_code + ' — ' + r.status);
    });
    Repo.readAll(SHEETS.INV_HEADER).forEach(r => {
      if ([r.inv_internal_no, r.vendor_invoice_no, r.tax_invoice_no]
          .some(v => String(v || '').toUpperCase().indexOf(needle) >= 0))
        push('INVOICE', r.inv_internal_no, r.vendor_code + ' — ' + r.match_status);
    });
    return out.slice(0, 50);
  },

  /** The traceability view (docs/03 §6): one PO, everything hanging off it. */
  trace(no) {
    const poNo = this._resolvePo(no);
    if (!poNo) throw new AppError('NOT_FOUND', 'Nothing found for ' + no);
    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
    const grns = Repo.findAll(SHEETS.GRN_HEADER, 'po_no', poNo);
    const invoices = Repo.findAll(SHEETS.INV_HEADER, 'po_no', poNo);
    return {
      po: po,
      poLines: Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo),
      revisions: Repo.findAll(SHEETS.PO_REVISIONS, 'po_no', poNo),
      grns: grns.map(g => Object.assign({}, g, {
        lines: Repo.findAll(SHEETS.GRN_LINES, 'grn_no', g.grn_no)
      })),
      qcs: grns.reduce((acc, g) => acc.concat(Repo.findAll(SHEETS.QC_HEADER, 'grn_no', g.grn_no)), []),
      ncrs: Repo.findAll(SHEETS.NCR, 'po_no', poNo),
      invoices: invoices.map(i => Object.assign({}, i, {
        lines: Repo.findAll(SHEETS.INV_LINES, 'inv_internal_no', i.inv_internal_no),
        matches: Repo.findAll(SHEETS.MATCH_RESULTS, 'inv_internal_no', i.inv_internal_no)
      })),
      payments: invoices.reduce((acc, i) =>
        acc.concat(Repo.findAll(SHEETS.PAY_ALLOC, 'inv_internal_no', i.inv_internal_no)), []),
      documents: DriveService.documentsForPo(poNo),
      timeline: ['PO', 'GRN', 'QC', 'NCR', 'INVOICE'].reduce((acc, t) => {
        const nos = t === 'PO' ? [poNo]
          : t === 'GRN' ? grns.map(g => g.grn_no)
          : t === 'INVOICE' ? invoices.map(i => i.inv_internal_no)
          : t === 'NCR' ? Repo.findAll(SHEETS.NCR, 'po_no', poNo).map(n => n.ncr_no)
          : grns.reduce((a, g) => a.concat(Repo.findAll(SHEETS.QC_HEADER, 'grn_no', g.grn_no).map(q => q.qc_no)), []);
        return acc.concat(nos.reduce((a, n) => a.concat(History.timeline(t, n)), []));
      }, []).sort((a, b) => String(a.at_ts).localeCompare(String(b.at_ts)))
    };
  },

  _resolvePo(no) {
    const n = String(no || '');
    if (/^PO-/i.test(n)) return n;
    const finders = [
      [SHEETS.GRN_HEADER, 'grn_no'], [SHEETS.QC_HEADER, 'qc_no'],
      [SHEETS.NCR, 'ncr_no'], [SHEETS.INV_HEADER, 'inv_internal_no']
    ];
    for (let i = 0; i < finders.length; i++) {
      const rec = Repo.findOne(finders[i][0], finders[i][1], n);
      if (rec) return rec.po_no;
    }
    return null;
  },

  record(entityType, no) {
    const map = ENTITY_MAP[entityType];
    if (!map) throw new AppError('BAD_ENTITY', 'Unknown entity type');
    const rec = Repo.findOne(map.tab, map.noCol, no);
    if (!rec) throw new AppError('NOT_FOUND', entityType + ' ' + no + ' not found');
    return {
      record: rec,
      allowedActions: StateMachine.allowed(entityType, rec),
      timeline: History.timeline(entityType, no),
      documents: Repo.findAll(SHEETS.DOCUMENTS, 'entity_no', no)
    };
  },

  lookups(groups) {
    const want = groups ? String(groups).split(',') : null;
    const out = {};
    Repo.readAll(SHEETS.LOOKUPS)
      .filter(r => String(r.is_active).toUpperCase() !== 'FALSE')
      .filter(r => !want || want.indexOf(r.lookup_group) >= 0)
      .forEach(r => {
        (out[r.lookup_group] = out[r.lookup_group] || []).push({
          code: r.code, label: r.label_en, label_th: r.label_th
        });
      });
    return out;
  }
};

/* ------------------------------------------------------------ domain services */

const PoService = {

  save(header, lines) {
    return withLock_(() => {
      const isNew = !header.po_no;
      const poNo = header.po_no || Repo.nextDocNo('PO');
      const vendor = Repo.findOne(SHEETS.VENDORS, 'vendor_code', header.vendor_code) || {};

      const computed = (lines || []).map((l, i) => {
        const amount = Num.round(Num.n(l.qty_ordered) * Num.n(l.unit_price) *
          (1 - Num.n(l.discount_pct) / 100), 2);
        return Object.assign({}, l, { line_no: i + 1, po_no: poNo, line_amount: amount });
      });
      const subtotal = Num.round(computed.reduce((s, l) => s + Num.n(l.line_amount), 0), 2);
      const vat = Num.round(subtotal * Config.num('DEFAULT_VAT_PCT', 7) / 100, 2);
      const fxRate = Num.n(header.fx_rate) || 1;

      const patch = Object.assign({}, header, {
        po_no: poNo, vendor_name: vendor.vendor_name_en || header.vendor_name,
        buyer_email: header.buyer_email || Auth.currentEmail(),
        subtotal_amount: subtotal, vat_amount: vat,
        total_amount: Num.round(subtotal + vat + Num.n(header.other_charges) - Num.n(header.discount_amount), 2),
        total_amount_thb: Num.round((subtotal + vat) * fxRate, 2)
      });

      let po;
      if (isNew) {
        po = Repo.insert(SHEETS.PO_HEADER, Object.assign({
          po_revision: 0, po_date: Fmt.today(), status: PO_STATUS.DRAFT,
          receipt_status: 'NONE', invoice_status: 'NONE', has_open_ncr: 'FALSE',
          drive_folder_id: DriveService.ensurePoFolder(poNo).getId()
        }, patch));
        History.log({ entity_type: 'PO', entity_no: poNo, entity_id: po.po_id,
                      action: 'CREATED', to_status: PO_STATUS.DRAFT });
      } else {
        const existing = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
        if (existing.status !== PO_STATUS.DRAFT && existing.status !== PO_STATUS.REJECTED) {
          throw new AppError('LOCKED', 'An approved PO cannot be edited directly — create a revision.');
        }
        po = Repo.update(SHEETS.PO_HEADER, existing.po_id, patch, header.row_version);
        Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo)
          .forEach(l => Repo.update(SHEETS.PO_LINES, l.po_line_id, { line_status: 'CANCELLED' }));
      }

      Repo.insertMany(SHEETS.PO_LINES, computed.map(l => Object.assign({
        po_revision: po.po_revision, line_status: 'OPEN',
        qty_received: 0, qty_accepted: 0, qty_rejected: 0, qty_invoiced: 0,
        qty_open: Num.n(l.qty_ordered)
      }, l)));

      return { po_no: poNo, header: po, lines: computed };
    });
  },

  approve(poNo, ctx) {
    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
    Approvals.assertWithinLimit(Num.n(po.total_amount_thb));
    const levelsDone = Num.n(po.approval_level_current) + 1;
    const required = Num.n(po.approval_level_required) || 1;

    if (levelsDone < required) {
      // intermediate level: record and route on, do not change status yet
      Repo.update(SHEETS.PO_HEADER, po.po_id, { approval_level_current: levelsDone });
      History.log({ entity_type: 'PO', entity_no: poNo, action: 'APPROVE_LEVEL_' + levelsDone,
                    from_status: po.status, to_status: po.status });
      const next = Approvals.nextApprover('PO', Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo));
      this._queueApprovalMail(poNo, next);
      return { po_no: poNo, awaiting: next, level: levelsDone, of: required };
    }

    const updated = StateMachine.fire('PO', poNo, 'APPROVE', ctx);
    Repo.update(SHEETS.PO_HEADER, po.po_id, { approval_level_current: levelsDone });
    DocGen.generatePoPdf(poNo);
    Notify.queue({
      template_id: 'PO_APPROVED', to: [po.buyer_email], entity_type: 'PO', entity_no: poNo,
      vars: { po_no: poNo, approved_by: Auth.currentEmail() }
    });
    if (Config.bool('AUTO_SEND_PO_ON_APPROVAL', 'FALSE')) this.send(poNo);
    return updated;
  },

  send(poNo) {
    const updated = StateMachine.fire('PO', poNo, 'SEND_TO_VENDOR', {});
    Notify.sendPoToVendor(poNo);
    return updated;
  },

  /** P8 — revision with re-approval when the increase is material. */
  revise(poNo, changes, reason) {
    return withLock_(() => {
      if (!reason) throw new AppError('REASON_REQUIRED', 'A revision reason is required.');
      const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
      if (po.status === PO_STATUS.CLOSED || po.status === PO_STATUS.CANCELLED) {
        throw new AppError('LOCKED', 'A closed PO cannot be revised.');
      }
      const oldTotal = Num.n(po.total_amount_thb);
      const rev = Num.n(po.po_revision) + 1;

      (changes || []).forEach(ch => {
        Repo.insert(SHEETS.PO_REVISIONS, {
          po_no: poNo, revision: rev, revised_at: Fmt.now(), revised_by: Auth.currentEmail(),
          change_type: ch.change_type, line_no: ch.line_no || '', field_changed: ch.field,
          old_value: ch.old_value, new_value: ch.new_value, reason: reason
        });
        if (ch.line_no) {
          const line = Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo)
            .filter(l => String(l.line_no) === String(ch.line_no))[0];
          if (line) {
            const patch = {};
            patch[ch.field] = ch.new_value;
            if (ch.field === 'qty_ordered' || ch.field === 'unit_price') {
              const qty = ch.field === 'qty_ordered' ? Num.n(ch.new_value) : Num.n(line.qty_ordered);
              const price = ch.field === 'unit_price' ? Num.n(ch.new_value) : Num.n(line.unit_price);
              patch.line_amount = Num.round(qty * price, 2);
              patch.qty_open = Math.max(0, qty - Num.n(line.qty_accepted));
            }
            patch.po_revision = rev;
            Repo.update(SHEETS.PO_LINES, line.po_line_id, patch);
          }
        } else {
          const patch = {};
          patch[ch.field] = ch.new_value;
          Repo.update(SHEETS.PO_HEADER, po.po_id, patch);
        }
      });

      const lines = Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo)
        .filter(l => l.line_status !== 'CANCELLED');
      const subtotal = Num.round(lines.reduce((s, l) => s + Num.n(l.line_amount), 0), 2);
      const vat = Num.round(subtotal * Config.num('DEFAULT_VAT_PCT', 7) / 100, 2);
      const newTotalThb = Num.round((subtotal + vat) * (Num.n(po.fx_rate) || 1), 2);
      const increasePct = oldTotal ? ((newTotalThb - oldTotal) / oldTotal) * 100 : 0;
      const needsReapproval = increasePct > Config.num('PO_REAPPROVAL_INCREASE_PCT', 5);

      Repo.update(SHEETS.PO_HEADER, po.po_id, {
        po_revision: rev, revision_date: Fmt.today(),
        subtotal_amount: subtotal, vat_amount: vat,
        total_amount: Num.round(subtotal + vat, 2), total_amount_thb: newTotalThb,
        status: needsReapproval ? PO_STATUS.PENDING_APPROVAL : po.status,
        approval_level_current: needsReapproval ? 0 : po.approval_level_current
      });
      History.log({
        entity_type: 'PO', entity_no: poNo, action: 'REVISED_R' + rev,
        from_status: po.status, to_status: needsReapproval ? PO_STATUS.PENDING_APPROVAL : po.status,
        reason: reason, payload: { increasePct: Num.round(increasePct, 2) }
      });

      DocGen.generatePoPdf(poNo);
      if (needsReapproval) {
        this._queueApprovalMail(poNo, Approvals.nextApprover('PO', Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo)));
      } else {
        Notify.sendPoToVendor(poNo);
      }
      return { po_no: poNo, revision: rev, reapproval_required: needsReapproval };
    });
  },

  _queueApprovalMail(poNo, approverEmail) {
    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
    const links = ApprovalLinks.build('PO', poNo, approverEmail);
    Notify.queue({
      template_id: 'PO_APPROVAL_REQUEST', to: [approverEmail],
      entity_type: 'PO', entity_no: poNo,
      vars: { po_no: poNo, vendor: po.vendor_name, amount: Fmt.money(po.total_amount_thb),
              buyer: po.buyer_email, delivery_date: Fmt.date(po.requested_delivery_date),
              approveUrl: links.approveUrl, rejectUrl: links.rejectUrl },
      dedupe_key: 'PO_APPROVE:' + poNo + ':' + po.approval_level_current
    });
  }
};

const GrnService = {

  start(poNo) {
    return withLock_(() => {
      const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
      if (!po) throw new AppError('NOT_FOUND', 'PO ' + poNo + ' not found.');
      if ([PO_STATUS.SENT_TO_VENDOR, PO_STATUS.ACKNOWLEDGED, PO_STATUS.PARTIALLY_RECEIVED]
          .indexOf(po.status) < 0) {
        throw new AppError('PO_NOT_RECEIVABLE',
          'PO ' + poNo + ' is ' + po.status + ' and cannot be received against.');
      }
      const open = Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo).filter(l => Num.n(l.qty_open) > 0);
      if (!open.length) throw new AppError('NOTHING_OPEN', 'PO ' + poNo + ' has no open quantity.');

      const grnNo = Repo.nextDocNo('GRN');
      const grn = Repo.insert(SHEETS.GRN_HEADER, {
        grn_no: grnNo, grn_date: Fmt.today(), received_datetime: Fmt.now(),
        po_no: poNo, po_revision_at_receipt: po.po_revision, vendor_code: po.vendor_code,
        warehouse_id: po.warehouse_id, receiver_email: Auth.currentEmail(),
        status: GRN_STATUS.DRAFT, qc_required: 'FALSE',
        drive_folder_id: DriveService.ensureGrnFolder(poNo, grnNo).getId()
      });
      History.log({ entity_type: 'GRN', entity_no: grnNo, entity_id: grn.grn_id,
                    action: 'CREATED', to_status: GRN_STATUS.DRAFT });
      return {
        grn_no: grnNo, header: grn,
        prefill: open.map(l => ({
          po_line_no: l.line_no, item_id: l.item_id, item_code: l.item_code,
          description: l.description, uom: l.uom, qty_open: l.qty_open,
          lot_tracked: (Repo.findOne(SHEETS.ITEMS, 'item_code', l.item_code) || {}).lot_tracked
        }))
      };
    });
  },

  save(header, lines) {
    return withLock_(() => {
      const grn = Repo.findOne(SHEETS.GRN_HEADER, 'grn_no', header.grn_no);
      if (!grn) throw new AppError('NOT_FOUND', 'GRN ' + header.grn_no + ' not found.');
      if (grn.status !== GRN_STATUS.DRAFT) {
        throw new AppError('LOCKED', 'A submitted receipt cannot be edited. Ask your supervisor to reverse it.');
      }
      Repo.update(SHEETS.GRN_HEADER, grn.grn_id, header, header.row_version);
      Repo.findAll(SHEETS.GRN_LINES, 'grn_no', grn.grn_no)
        .forEach(l => Repo.update(SHEETS.GRN_LINES, l.grn_line_id, { line_status: 'CANCELLED' }));
      Repo.insertMany(SHEETS.GRN_LINES, (lines || []).map((l, i) => Object.assign({
        grn_no: grn.grn_no, line_no: i + 1, po_no: grn.po_no,
        qty_accepted: 0, qty_rejected: 0, qty_on_hold: 0, line_status: 'PENDING_QC'
      }, l)));
      return { grn_no: grn.grn_no };
    });
  },

  /** W2 + A7 — the Warehouse → QC hand-off, idempotent against duplicate mobile submits. */
  submit(grnNo, ctx) {
    return Repo.idempotent(ctx.idempotency_key, 'GrnService.submit', () => {
      StateMachine.fire('GRN', grnNo, 'SUBMIT', ctx);
      return Workflow.routeGrnToQc(grnNo);
    });
  }
};

const QcService = {
  saveLines(qcNo, lines) {
    return withLock_(() => {
      const qc = Repo.findOne(SHEETS.QC_HEADER, 'qc_no', qcNo);
      if (!qc) throw new AppError('NOT_FOUND', 'QC ' + qcNo + ' not found.');
      if (qc.status === QC_STATUS.COMPLETED) {
        throw new AppError('LOCKED',
          'A completed inspection cannot be edited. Create a re-inspection instead.');
      }
      let pass = 0, fail = 0;
      (lines || []).forEach(l => {
        const existing = Repo.findOne(SHEETS.QC_LINES, 'qc_line_id', l.qc_line_id);
        if (!existing) return;
        const result = this._evaluate(existing, l);
        if (result === 'PASS') pass++;
        if (result === 'FAIL') fail++;
        Repo.update(SHEETS.QC_LINES, l.qc_line_id, {
          measured_value: l.measured_value === undefined ? existing.measured_value : l.measured_value,
          measured_text: l.measured_text === undefined ? existing.measured_text : l.measured_text,
          result: result, defect_qty: Num.n(l.defect_qty),
          photo_file_ids: l.photo_file_ids || existing.photo_file_ids,
          tested_by: Auth.currentEmail(), tested_at: Fmt.now(),
          remark: l.remark || existing.remark
        });
      });
      Repo.update(SHEETS.QC_HEADER, qc.qc_id, { params_pass: pass, params_fail: fail });
      if (qc.status === QC_STATUS.SAMPLING) {
        StateMachine.fire('QC', qcNo, 'RECORD_RESULTS', {});
      }
      return { qc_no: qcNo, params_pass: pass, params_fail: fail };
    });
  },

  /** Numeric params are judged against the spec; text params carry the inspector's verdict. */
  _evaluate(specLine, input) {
    if (input.result) return input.result;
    const v = input.measured_value;
    if (v === '' || v === undefined || v === null) return 'PENDING';
    const n = Num.n(v);
    const min = specLine.spec_min === '' ? null : Num.n(specLine.spec_min);
    const max = specLine.spec_max === '' ? null : Num.n(specLine.spec_max);
    if (min === null && max === null) return 'PENDING';
    if (min !== null && n < min) return 'FAIL';
    if (max !== null && n > max) return 'FAIL';
    return 'PASS';
  }
};

const NcrService = {
  update(ncrNo, patch) {
    const ncr = Repo.findOne(SHEETS.NCR, 'ncr_no', ncrNo);
    if (!ncr) throw new AppError('NOT_FOUND', 'NCR ' + ncrNo + ' not found.');
    if (ncr.status === 'CLOSED') throw new AppError('LOCKED', 'This NCR is closed.');
    const updated = Repo.update(SHEETS.NCR, ncr.ncr_id, patch);
    History.log({ entity_type: 'NCR', entity_no: ncrNo, action: 'UPDATED',
                  changed_fields: Object.keys(patch) });
    return updated;
  },

  approveDisposition(ncrNo, ctx) {
    const ncr = Repo.findOne(SHEETS.NCR, 'ncr_no', ncrNo);
    if (!ncr.disposition) throw new AppError('NO_DISPOSITION', 'Record a disposition first.');
    Auth.requireNotSelf(ncr, 'disposition_proposed_by', 'approve a disposition on');
    const updated = Repo.update(SHEETS.NCR, ncr.ncr_id, {
      disposition_approved_by: Auth.currentEmail(), disposition_approved_at: Fmt.now(),
      status: 'DISPOSITION_APPROVED',
      claim_type: ctx.claim_type || ncr.claim_type,
      claim_amount: Num.n(ctx.claim_amount) || ncr.financial_impact_amount
    });
    History.log({ entity_type: 'NCR', entity_no: ncrNo, action: 'DISPOSITION_APPROVED',
                  from_status: ncr.status, to_status: 'DISPOSITION_APPROVED',
                  reason: ncr.disposition });
    if (ncr.po_no) Workflow.recomputePo(ncr.po_no);
    return updated;
  }
};

const ApService = {
  resolveException(invNo, ctx) {
    if (!ctx.reason) throw new AppError('REASON_REQUIRED', 'Record how the variance was resolved.');
    Repo.findAll(SHEETS.MATCH_RESULTS, 'inv_internal_no', invNo)
      .filter(m => m.within_tolerance === 'FALSE' && !m.resolved_at)
      .forEach(m => Repo.update(SHEETS.MATCH_RESULTS, m.match_id, {
        resolved_by: Auth.currentEmail(), resolved_at: Fmt.now(),
        resolution_action: ctx.action || 'ACCEPTED', resolution_note: ctx.reason
      }));
    StateMachine.fire('INVOICE', invNo, 'RESOLVE_AND_REMATCH', ctx);
    return Match.runOne(invNo);
  }
};

/* --------------------------------------------------------------- A18 payments */

const Payments = {

  /** Weekly proposal: everything approved and due inside the horizon. */
  buildProposal() {
    const horizon = Fmt.date(Fmt.addDays(Fmt.now(), Config.num('PAYMENT_HORIZON_DAYS', 7)));
    const due = Repo.readAll(SHEETS.INV_HEADER)
      .filter(i => i.match_status === MATCH_STATUS.APPROVED_FOR_PAYMENT &&
                   String(i.qc_hold_flag).toUpperCase() !== 'TRUE' &&
                   i.due_date && String(i.due_date) <= horizon);
    if (!due.length) return { proposals: 0 };

    const byVendor = {};
    due.forEach(i => { (byVendor[i.vendor_code + '|' + i.currency] = byVendor[i.vendor_code + '|' + i.currency] || []).push(i); });

    const summary = Object.keys(byVendor).map(k => ({
      vendor: k.split('|')[0], currency: k.split('|')[1],
      invoices: byVendor[k].map(i => i.inv_internal_no),
      gross: Num.round(byVendor[k].reduce((s, i) => s + Num.n(i.net_payable || i.total_amount), 0), 2)
    }));

    MailApp.sendEmail({
      to: Config.get('FIN_MGR_EMAIL', Props.get('ADMIN_EMAIL')),
      subject: '[PU-ACC] Payment proposal — ' + summary.length + ' vendor(s) due by ' + horizon,
      htmlBody: '<b>Payment proposal</b><br><br>' + summary.map(s =>
        s.vendor + ' — ' + s.currency + ' ' + Fmt.money(s.gross) +
        ' (' + s.invoices.length + ' invoice(s): ' + s.invoices.join(', ') + ')').join('<br>')
    });
    return { proposals: summary.length, summary: summary };
  },

  build(invoiceNos, ctx) {
    return withLock_(() => {
      const invoices = (invoiceNos || []).map(no => {
        const i = Repo.findOne(SHEETS.INV_HEADER, 'inv_internal_no', no);
        if (!i) throw new AppError('NOT_FOUND', 'Invoice ' + no + ' not found.');
        if (i.match_status !== MATCH_STATUS.APPROVED_FOR_PAYMENT) {
          throw new AppError('NOT_APPROVED', 'Invoice ' + no + ' is not approved for payment.');
        }
        if (String(i.qc_hold_flag).toUpperCase() === 'TRUE') {
          throw new AppError('QC_HOLD', 'Invoice ' + no + ' is on QC hold.');
        }
        return i;
      });
      if (!invoices.length) throw new AppError('NO_INVOICES', 'Select at least one invoice.');

      const vendors = invoices.map(i => i.vendor_code).filter((v, k, a) => a.indexOf(v) === k);
      if (vendors.length > 1) throw new AppError('MIXED_VENDORS', 'One payment per vendor.');

      const gross = Num.round(invoices.reduce((s, i) => s + Num.n(i.total_amount), 0), 2);
      const wht = Num.round(invoices.reduce((s, i) => s + Num.n(i.wht_amount), 0), 2);
      const deduction = Num.round(invoices.reduce((s, i) => s + Num.n(i.deduction_amount), 0), 2);
      const payNo = Repo.nextDocNo('PAYMENT');

      const payment = Repo.insert(SHEETS.PAYMENTS, {
        payment_no: payNo, payment_date: ctx.payment_date || Fmt.today(),
        vendor_code: vendors[0], payment_method: ctx.payment_method || 'LOCAL_TRANSFER',
        currency: invoices[0].currency, fx_rate: invoices[0].fx_rate,
        gross_amount: gross, wht_amount: wht, deduction_amount: deduction,
        net_amount: Num.round(gross - wht - deduction, 2),
        net_amount_thb: Num.round((gross - wht - deduction) * (Num.n(invoices[0].fx_rate) || 1), 2),
        invoice_count: invoices.length, status: 'PENDING_APPROVAL',
        prepared_by: Auth.currentEmail()
      });

      Repo.insertMany(SHEETS.PAY_ALLOC, invoices.map(i => ({
        payment_no: payNo, inv_internal_no: i.inv_internal_no,
        allocated_amount: Num.n(i.total_amount), wht_amount: Num.n(i.wht_amount),
        deduction_amount: Num.n(i.deduction_amount), residual_amount: 0
      })));

      invoices.forEach(i => StateMachine.fireAsSystem('INVOICE', i.inv_internal_no, 'SCHEDULE'));
      History.log({ entity_type: 'PAYMENT', entity_no: payNo, action: 'CREATED',
                    to_status: 'PENDING_APPROVAL' });
      return payment;
    });
  },

  execute(paymentNo, ctx) {
    return withLock_(() => {
      const p = Repo.findOne(SHEETS.PAYMENTS, 'payment_no', paymentNo);
      if (!p) throw new AppError('NOT_FOUND', 'Payment ' + paymentNo + ' not found.');
      Auth.requireNotSelf(p, 'prepared_by', 'approve a payment you prepared for');

      const dualThreshold = Config.num('DUAL_APPROVAL_PAYMENT_THB', 500000);
      if (Num.n(p.net_amount_thb) > dualThreshold && !p.approved_by) {
        Repo.update(SHEETS.PAYMENTS, p.payment_id, {
          approved_by: Auth.currentEmail(), approved_at: Fmt.now(), status: 'PENDING_APPROVAL'
        });
        History.log({ entity_type: 'PAYMENT', entity_no: paymentNo, action: 'APPROVE_LEVEL_1' });
        return { payment_no: paymentNo, awaiting: 'SECOND_APPROVER' };
      }
      if (Num.n(p.net_amount_thb) > dualThreshold) {
        Auth.requireNotSelf(p, 'approved_by', 'give the second approval on');
      }

      Repo.update(SHEETS.PAYMENTS, p.payment_id, {
        approved_by: p.approved_by || Auth.currentEmail(),
        approved_at: p.approved_at || Fmt.now(),
        second_approved_by: Num.n(p.net_amount_thb) > dualThreshold ? Auth.currentEmail() : '',
        executed_by: Auth.currentEmail(), executed_at: Fmt.now(),
        bank_ref_no: ctx.bank_ref_no || '', status: 'PAID'
      });

      const allocs = Repo.findAll(SHEETS.PAY_ALLOC, 'payment_no', paymentNo);
      allocs.forEach(a => {
        const inv = Repo.findOne(SHEETS.INV_HEADER, 'inv_internal_no', a.inv_internal_no);
        Repo.update(SHEETS.INV_HEADER, inv.inv_id, {
          payment_status: 'PAID', paid_amount: Num.n(a.allocated_amount), paid_at: Fmt.now(),
          payment_nos: [inv.payment_nos, paymentNo].filter(Boolean).join(',')
        });
        StateMachine.fireAsSystem('INVOICE', a.inv_internal_no, 'PAID');
        if (inv.po_no) Workflow.recomputePo(inv.po_no);
      });

      const vendor = Repo.findOne(SHEETS.VENDORS, 'vendor_code', p.vendor_code);
      if (vendor && vendor.contact_email) {
        Notify.queue({
          template_id: 'PAYMENT_ADVICE', to: [vendor.contact_email],
          entity_type: 'PAYMENT', entity_no: paymentNo,
          vars: { payment_no: paymentNo, payment_date: p.payment_date,
                  net_amount: Fmt.money(p.net_amount), currency: p.currency,
                  invoices: allocs.map(a => a.inv_internal_no).join(', ') }
        });
      }
      History.log({ entity_type: 'PAYMENT', entity_no: paymentNo, action: 'EXECUTED',
                    from_status: p.status, to_status: 'PAID' });
      return { payment_no: paymentNo, status: 'PAID' };
    });
  }
};

/* --------------------------------------------------- A15 invoice inbox parser */

const InvoiceInbox = {
  /**
   * Scans a Gmail label for vendor invoices, files the attachment, and pre-creates a RECEIVED
   * invoice for AP to confirm. It never posts or approves anything on its own.
   */
  scan() {
    const label = Config.get('INVOICE_GMAIL_LABEL', '');
    if (!label) return 0;
    const threads = GmailApp.search('label:' + label + ' has:attachment is:unread', 0, 10);
    let created = 0;
    threads.forEach(th => {
      th.getMessages().forEach(msg => {
        msg.getAttachments()
          .filter(a => a.getContentType() === 'application/pdf')
          .forEach(att => {
            const sender = msg.getFrom().replace(/.*<(.*)>.*/, '$1');
            const domain = sender.split('@')[1];
            const vendor = Repo.readAll(SHEETS.VENDORS)
              .filter(v => v.contact_email && v.contact_email.split('@')[1] === domain)[0];
            const folder = DriveService.path(DriveService.root(), ['00_System', 'Exports', 'Invoice_Inbox']);
            const file = folder.createFile(att.copyBlob());
            DriveService.register({
              doc_type: 'VENDOR_INVOICE', entity_type: 'INVOICE',
              entity_no: 'UNREGISTERED-' + file.getId().slice(0, 8),
              po_no: '', drive_file_id: file.getId(), file_name: file.getName(),
              file_url: file.getUrl(), mime_type: 'application/pdf', size_bytes: file.getSize(),
              folder_id: folder.getId(), source: 'EMAIL'
            });
            Notify.queue({
              template_id: 'INVOICE_EXCEPTION',
              to: [Config.get('AP_GROUP_EMAIL', Props.get('ADMIN_EMAIL'))],
              entity_type: 'INVOICE', entity_no: file.getName(),
              vars: { inv_no: '(unregistered)', vendor: vendor ? vendor.vendor_code : sender,
                      po_no: '', amount: '?', exception: 'NEEDS_REGISTRATION',
                      detail: 'Invoice received by email from ' + sender + ' — ' + file.getName() },
              dedupe_key: 'INBOX:' + file.getId()
            });
            created++;
          });
        msg.markRead();
      });
    });
    return created;
  }
};

/* ------------------------------------------------- A4 signed approval links */

const ApprovalLinks = {

  build(docType, docNo, approverEmail) {
    const base = Notify.appUrl();
    const mk = decision => {
      const payload = { d: docType, n: docNo, a: approverEmail, x: decision,
                        e: Date.now() + 7 * 864e5, j: Utilities.getUuid() };
      const json = JSON.stringify(payload);
      const sig = this._sign(json);
      return base + '?action=decide&p=' + Utilities.base64EncodeWebSafe(json) + '&s=' + sig;
    };
    return { approveUrl: mk('APPROVE'), rejectUrl: mk('REJECT') };
  },

  _sign(json) {
    return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
      json, Props.require('HMAC_SECRET')));
  },

  handle(p) {
    const html = msg => HtmlService.createHtmlOutput(
      '<div style="font-family:Arial;padding:40px;max-width:520px;margin:auto">' + msg + '</div>');
    try {
      const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(p.p)).getDataAsString();
      if (this._sign(json) !== p.s) throw new AppError('BAD_SIGNATURE', 'This link is not valid.');
      const d = JSON.parse(json);
      if (Date.now() > Num.n(d.e)) throw new AppError('EXPIRED', 'This approval link has expired.');

      const actor = Auth.currentEmail();
      if (String(actor).toLowerCase() !== String(d.a).toLowerCase() &&
          String(Auth.effectiveApprover(d.a)).toLowerCase() !== String(actor).toLowerCase()) {
        throw new AppError('WRONG_USER', 'This approval is addressed to ' + d.a + '.');
      }

      return Repo.idempotent('APPROVAL:' + d.j, 'ApprovalLinks.handle', () => {
        if (d.x === 'REJECT') {
          // a rejection without a reason just pushes the conversation back to email
          return html('<h3>Rejection needs a reason</h3><p>Open ' + d.n +
                      ' in PU-ACC and record why you are rejecting it.</p>' +
                      '<p><a href="' + Notify.link(d.d, d.n) + '">Open ' + d.n + '</a></p>');
        }
        const result = d.d === 'PO' ? PoService.approve(d.n, { source: 'EMAIL' })
                                    : StateMachine.fire(d.d, d.n, 'APPROVE', { source: 'EMAIL' });
        return html('<h3>' + d.n + ' approved</h3><p>Thank you. ' +
          (result && result.awaiting ? 'It now goes to ' + result.awaiting + ' for the next level.'
                                     : 'No further action is needed from you.') + '</p>');
      });
    } catch (e) {
      return html('<h3>Could not process this approval</h3><p>' + (e.message || e) + '</p>');
    }
  }
};

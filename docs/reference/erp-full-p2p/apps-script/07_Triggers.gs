/**
 * 07_Triggers.gs — trigger installation and the time-driven jobs (docs/04 §2).
 *
 * installTriggers() is idempotent: it removes existing project triggers first. Without that,
 * every redeploy silently doubles the job frequency and vendors receive duplicate emails.
 */

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processQueues_').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('processHourly_').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('dailyMorning_').timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('dailyFx_').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('nightlyIntegrity_').timeBased().atHour(1).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('nightlyBackup_').timeBased().atHour(2).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('weeklyPaymentProposal_').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9).inTimezone(TZ).create();

  // Re-validate writes that bypassed the API (AppSheet, manual edits).
  ScriptApp.newTrigger('guardAppSheetWrite_')
    .forSpreadsheet(Props.require('SPREADSHEET_ID')).onChange().create();

  return ScriptApp.getProjectTriggers().length + ' triggers installed';
}

/* --------------------------------------------------------------- job entry points */

function processQueues_() {
  safely_('processQueues_', () => {
    InvoiceInbox.scan();          // A15
    Match.runPending();           // A16
    Notify.drain();               // notification queue
  });
}

function processHourly_() {
  safely_('processHourly_', () => {
    Escalation.run();             // A5 + A14
  });
}

function dailyMorning_() {
  safely_('dailyMorning_', () => {
    Escalation.chaseLabResults(); // A13
    Compliance.checkExpiries();   // A24
    Notify.sendDailyDigests();    // A19
    Notify.drain();
  });
}

function dailyFx_() {
  safely_('dailyFx_', () => FxService.fetchDaily());   // A23
}

function nightlyIntegrity_() {
  safely_('nightlyIntegrity_', () => {
    Integrity.run();              // A20
    Scorecard.rebuild();          // A22
    Views.rebuildAll();           // A14 view materialisation
    Housekeeping.closeAndArchive(); // A25
  });
}

function nightlyBackup_() {
  safely_('nightlyBackup_', () => Housekeeping.backup());   // A21
}

function weeklyPaymentProposal_() {
  safely_('weeklyPaymentProposal_', () => Payments.buildProposal());   // A18
}

/* ------------------------------------------------------- AppSheet write guard */

/**
 * AppSheet writes to Sheets directly, bypassing Api.gs. Treat those writes as untrusted:
 * re-check them against the state machine and flag anything illegal.
 */
function guardAppSheetWrite_(e) {
  if (!e || e.changeType !== 'EDIT') return;
  safely_('guardAppSheetWrite_', () => {
    const checks = [
      { tab: SHEETS.GRN_HEADER, noCol: 'grn_no', entity: 'GRN', statusCol: 'status', valid: GRN_STATUS },
      { tab: SHEETS.QC_HEADER, noCol: 'qc_no', entity: 'QC', statusCol: 'status', valid: QC_STATUS }
    ];
    checks.forEach(chk => {
      Repo.readAll(chk.tab).slice(-40).forEach(rec => {   // only recent rows: 6-minute budget
        const status = rec[chk.statusCol];
        if (status && Object.keys(chk.valid).map(k => chk.valid[k]).indexOf(status) < 0) {
          ErrorLog.write({
            severity: 'ERROR', function_name: 'guardAppSheetWrite_',
            entity_type: chk.entity, entity_no: rec[chk.noCol],
            error_message: 'Invalid status "' + status + '" written outside the state machine'
          });
          Notify.alertAdmin('guardAppSheetWrite_',
            new Error(chk.entity + ' ' + rec[chk.noCol] + ' has invalid status ' + status), '');
        }
      });
    });
    // Quantities QC owns must never be written by a warehouse client.
    Repo.readAll(SHEETS.GRN_LINES).slice(-60).forEach(l => {
      const sum = Num.n(l.qty_accepted) + Num.n(l.qty_rejected) + Num.n(l.qty_on_hold);
      if (sum > 0 && Math.abs(sum - Num.n(l.qty_received)) > 0.001) {
        ErrorLog.write({
          severity: 'WARN', function_name: 'guardAppSheetWrite_',
          entity_type: 'GRN', entity_no: l.grn_no,
          error_message: 'Line ' + l.line_no + ': accepted+rejected+hold (' + sum +
                         ') != received (' + l.qty_received + ')'
        });
      }
    });
  });
}

/* -------------------------------------------------------------- A5 / A14 aging */

const Escalation = {

  /** Stage definitions for aging and SLA. Mirrors docs/01 §6. */
  stages() {
    return [
      { stage: 'PR approval', tab: SHEETS.PR_HEADER, noCol: 'pr_no', entity: 'PR',
        statusCol: 'status', open: ['PENDING_APPROVAL'], sla: Config.num('PR_APPROVAL_SLA_HOURS', 24),
        clock: 'updated_at', ownerRole: ROLES.PUR_MGR },
      { stage: 'PO approval', tab: SHEETS.PO_HEADER, noCol: 'po_no', entity: 'PO',
        statusCol: 'status', open: [PO_STATUS.PENDING_APPROVAL], sla: Config.num('PO_APPROVAL_SLA_HOURS', 24),
        clock: 'updated_at', ownerRole: ROLES.PUR_MGR },
      { stage: 'PO issue', tab: SHEETS.PO_HEADER, noCol: 'po_no', entity: 'PO',
        statusCol: 'status', open: [PO_STATUS.APPROVED], sla: 4,
        clock: 'approved_at', ownerRole: ROLES.BUYER },
      { stage: 'GR booking', tab: SHEETS.GRN_HEADER, noCol: 'grn_no', entity: 'GRN',
        statusCol: 'status', open: [GRN_STATUS.DRAFT], sla: Config.num('GR_BOOKING_SLA_HOURS', 4),
        clock: 'created_at', ownerRole: ROLES.WH_SUP },
      { stage: 'QC inspection', tab: SHEETS.QC_HEADER, noCol: 'qc_no', entity: 'QC',
        statusCol: 'status', open: [QC_STATUS.PENDING, QC_STATUS.ASSIGNED, QC_STATUS.SAMPLING, QC_STATUS.TESTING],
        sla: Config.num('QC_SLA_HOURS', 24), clock: 'requested_at', ownerRole: ROLES.QC_MGR },
      { stage: 'QC lab', tab: SHEETS.QC_HEADER, noCol: 'qc_no', entity: 'QC',
        statusCol: 'status', open: [QC_STATUS.PENDING_LAB], sla: Config.num('QC_SLA_HOURS_LAB', 48),
        clock: 'lab_sent_at', ownerRole: ROLES.QC_MGR },
      { stage: 'Concession approval', tab: SHEETS.QC_HEADER, noCol: 'qc_no', entity: 'QC',
        statusCol: 'status', open: [QC_STATUS.PENDING_APPROVAL], sla: 24,
        clock: 'updated_at', ownerRole: ROLES.QC_MGR },
      { stage: 'AP registration', tab: SHEETS.INV_HEADER, noCol: 'inv_internal_no', entity: 'INVOICE',
        statusCol: 'match_status', open: [MATCH_STATUS.RECEIVED], sla: Config.num('AP_REGISTER_SLA_HOURS', 24),
        clock: 'received_date', ownerRole: ROLES.AP_OFFICER },
      { stage: 'AP exceptions', tab: SHEETS.INV_HEADER, noCol: 'inv_internal_no', entity: 'INVOICE',
        statusCol: 'match_status', open: [MATCH_STATUS.EXCEPTION, MATCH_STATUS.DISPUTED],
        sla: Config.num('EXCEPTION_SLA_HOURS', 48), clock: 'match_run_at', ownerRole: ROLES.AP_OFFICER },
      { stage: 'Invoice parked (no GRN)', tab: SHEETS.INV_HEADER, noCol: 'inv_internal_no', entity: 'INVOICE',
        statusCol: 'match_status', open: [MATCH_STATUS.NO_GRN],
        sla: Config.num('NO_GRN_ESCALATION_DAYS', 7) * 24, clock: 'received_date', ownerRole: ROLES.BUYER },
      { stage: 'Payment approval', tab: SHEETS.INV_HEADER, noCol: 'inv_internal_no', entity: 'INVOICE',
        statusCol: 'match_status', open: [MATCH_STATUS.MATCHED],
        sla: Config.num('PAYMENT_APPROVAL_SLA_HOURS', 48), clock: 'match_run_at', ownerRole: ROLES.FIN_MGR }
    ];
  },

  openRecords(stage) {
    const now = Fmt.now();
    return Repo.readAll(stage.tab)
      .filter(r => stage.open.indexOf(r[stage.statusCol]) >= 0)
      .map(r => {
        const from = r[stage.clock] || r.created_at || now;
        return Object.assign({}, r, {
          __aging: Fmt.hoursBetween(from, now),
          __breached: Fmt.hoursBetween(from, now) > stage.sla
        });
      });
  },

  /** Reminders, then escalation to the stage owner's manager. */
  run() {
    this.stages().forEach(stage => {
      this.openRecords(stage).filter(r => r.__breached).forEach(r => {
        const owner = this._ownerOf(stage, r);
        const manager = this._managerOf(owner);
        Notify.queue({
          template_id: 'SLA_BREACH_ESCALATION',
          to: [manager || owner].filter(Boolean), cc: [owner],
          entity_type: stage.entity, entity_no: r[stage.noCol],
          vars: { entity_type: stage.entity, entity_no: r[stage.noCol],
                  status: r[stage.statusCol], aging: r.__aging, sla: stage.sla, owner: owner },
          // one escalation per record per day, not one per hour
          dedupe_key: 'SLA:' + stage.entity + ':' + r[stage.noCol] + ':' + Fmt.today()
        });
      });
    });
  },

  chaseLabResults() {
    const now = Fmt.now();
    Repo.readAll(SHEETS.QC_HEADER)
      .filter(q => q.status === QC_STATUS.PENDING_LAB && q.lab_due_at && String(q.lab_due_at) < now)
      .forEach(q => Notify.queue({
        template_id: 'LAB_OVERDUE',
        to: [Config.get('QC_MGR_EMAIL', Props.get('ADMIN_EMAIL')), q.inspector_email],
        entity_type: 'QC', entity_no: q.qc_no,
        vars: { qc_no: q.qc_no, lab: q.lab_name, sent_at: Fmt.date(q.lab_sent_at),
                due_at: Fmt.date(q.lab_due_at) },
        dedupe_key: 'LAB_OVERDUE:' + q.qc_no + ':' + Fmt.today()
      }));
  },

  _ownerOf(stage, rec) {
    if (stage.ownerRole === ROLES.BUYER) {
      if (rec.buyer_email) return rec.buyer_email;
      if (rec.po_no) {
        const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', rec.po_no);
        if (po) return po.buyer_email;
      }
    }
    if (stage.entity === 'QC' && rec.inspector_email) return rec.inspector_email;
    if (stage.entity === 'INVOICE' && rec.ap_owner_email) return rec.ap_owner_email;
    const holder = Repo.readAll(SHEETS.USERS).filter(u =>
      String(u.is_active).toUpperCase() === 'TRUE' &&
      String(u.role_codes).indexOf(stage.ownerRole) >= 0)[0];
    return holder ? holder.email : Props.get('ADMIN_EMAIL');
  },

  _managerOf(email) {
    const u = Repo.findOne(SHEETS.USERS, 'email', email);
    return u ? u.manager_email : '';
  }
};

/* -------------------------------------------------------- A14 view materialisation */

const Views = {

  rebuildAll() {
    this.bottleneck();
    this.openPo();
    this.pendingQc();
    this.apExceptions();
  },

  _write(tab, rows) {
    const sh = SpreadsheetApp.openById(Props.require('SPREADSHEET_ID')).getSheetByName(tab);
    const cols = schemaCols(tab);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).clearContent();
    if (!rows.length) return;
    sh.getRange(2, 1, rows.length, cols.length)
      .setValues(rows.map(r => cols.map(c => (r[c] === undefined ? '' : r[c]))));
  },

  bottleneck() {
    const now = Fmt.now();
    const rows = Escalation.stages().map(stage => {
      const open = Escalation.openRecords(stage);
      const agings = open.map(r => Num.n(r.__aging));
      const mean = agings.length ? Num.round(agings.reduce((a, b) => a + b, 0) / agings.length, 1) : 0;
      return {
        refreshed_at: now, stage: stage.stage, owner_role: stage.ownerRole,
        open_count: open.length, mean_aging_hrs: mean,
        max_aging_hrs: agings.length ? Num.round(Math.max.apply(null, agings), 1) : 0,
        breached_count: open.filter(r => r.__breached).length,
        bucket_0_24: agings.filter(a => a <= 24).length,
        bucket_24_48: agings.filter(a => a > 24 && a <= 48).length,
        bucket_48_72: agings.filter(a => a > 48 && a <= 72).length,
        bucket_over_72: agings.filter(a => a > 72).length,
        bottleneck_score: Num.round(open.length * mean, 1)
      };
    });
    rows.sort((a, b) => b.bottleneck_score - a.bottleneck_score);
    rows.forEach((r, i) => { r.bottleneck_rank = i + 1; });
    this._write(SHEETS.VW_BOTTLENECK, rows);
  },

  openPo() {
    const now = Fmt.now();
    const today = Fmt.today();
    const lines = Repo.groupBy(SHEETS.PO_LINES, 'po_no');
    const rows = Repo.readAll(SHEETS.PO_HEADER)
      .filter(po => [PO_STATUS.CLOSED, PO_STATUS.CANCELLED, PO_STATUS.DRAFT].indexOf(po.status) < 0)
      .map(po => {
        const ls = lines[po.po_no] || [];
        const openLines = ls.filter(l => Num.n(l.qty_open) > 0);
        const promised = po.promised_delivery_date || po.requested_delivery_date;
        return {
          refreshed_at: now, po_no: po.po_no, vendor_code: po.vendor_code,
          vendor_name: po.vendor_name, buyer_email: po.buyer_email, po_date: po.po_date,
          promised_delivery_date: promised,
          days_late: promised && String(promised) < today
            ? Math.round((new Date(today) - new Date(promised)) / 864e5) : 0,
          qty_open_lines: openLines.length,
          value_open_thb: Num.round(openLines.reduce((s, l) =>
            s + Num.n(l.qty_open) * Num.n(l.unit_price) * (Num.n(po.fx_rate) || 1), 0), 2),
          receipt_status: po.receipt_status, invoice_status: po.invoice_status, status: po.status
        };
      });
    this._write(SHEETS.VW_OPEN_PO, rows);
  },

  pendingQc() {
    const now = Fmt.now();
    const rows = Repo.readAll(SHEETS.QC_HEADER)
      .filter(q => q.status !== QC_STATUS.COMPLETED && q.status !== QC_STATUS.CANCELLED)
      .map(q => ({
        refreshed_at: now, qc_no: q.qc_no, grn_no: q.grn_no, item_code: q.item_code,
        lot_no: q.lot_no, qty_submitted: q.qty_submitted, requested_at: q.requested_at,
        aging_hrs: Fmt.hoursBetween(q.requested_at, now),
        sla_due_at: q.sla_due_at,
        sla_breached: q.sla_due_at && String(q.sla_due_at) < now ? 'TRUE' : 'FALSE',
        inspector_email: q.inspector_email || q.assigned_to,
        lab_required: q.lab_required, lab_due_at: q.lab_due_at, status: q.status
      }))
      .sort((a, b) => Num.n(b.aging_hrs) - Num.n(a.aging_hrs));
    this._write(SHEETS.VW_PENDING_QC, rows);
  },

  apExceptions() {
    const now = Fmt.now();
    const rows = Repo.readAll(SHEETS.INV_HEADER)
      .filter(i => [MATCH_STATUS.EXCEPTION, MATCH_STATUS.NO_GRN, MATCH_STATUS.QC_HOLD,
                    MATCH_STATUS.DISPUTED].indexOf(i.match_status) >= 0)
      .map(i => {
        const code = String(i.match_exception_codes || '').split(',')[0] || i.match_status;
        return {
          refreshed_at: now, inv_internal_no: i.inv_internal_no, vendor_code: i.vendor_code,
          total_amount_thb: i.total_amount_thb, exception_code: code,
          routed_to: Match._ownerEmailFor(code, i),
          aging_hrs: Fmt.hoursBetween(i.match_run_at || i.received_date, now),
          sla_breached: Fmt.hoursBetween(i.match_run_at || i.received_date, now) >
                        Config.num('EXCEPTION_SLA_HOURS', 48) ? 'TRUE' : 'FALSE',
          po_no: i.po_no, match_status: i.match_status
        };
      })
      .sort((a, b) => Num.n(b.aging_hrs) - Num.n(a.aging_hrs));
    this._write(SHEETS.VW_AP_EXCEPTIONS, rows);
  }
};

/* --------------------------------------------------------- A20 integrity checks */

const Integrity = {

  run() {
    const findings = []
      .concat(this._uniqueness())
      .concat(this._referential())
      .concat(this._arithmetic())
      .concat(this._neverExceed())
      .concat(this._stateConsistency());

    findings.forEach(f => ErrorLog.write({
      severity: f.severity, function_name: 'Integrity.' + f.check,
      entity_type: f.entity_type, entity_no: f.entity_no, error_message: f.message
    }));

    if (findings.length) {
      const body = findings.slice(0, 60)
        .map(f => '• [' + f.severity + '] ' + f.check + ' — ' + f.entity_no + ': ' + f.message)
        .join('<br>');
      MailApp.sendEmail({
        to: Props.get('ADMIN_EMAIL'),
        subject: '[PU-ACC] ' + findings.length + ' integrity finding(s) — ' + Fmt.today(),
        htmlBody: '<b>Nightly integrity check</b><br><br>' + body +
                  (findings.length > 60 ? '<br>… and ' + (findings.length - 60) + ' more in Error_Log' : '')
      });
    }
    return findings;
  },

  _uniqueness() {
    const out = [];
    Object.keys(SCHEMA).forEach(tab => {
      (SCHEMA[tab].unique || []).forEach(field => {
        const seen = {};
        Repo.readAll(tab).forEach(r => {
          const v = String(r[field] || '');
          if (!v) return;
          if (seen[v]) {
            out.push({ severity: 'ERROR', check: 'uniqueness', entity_type: tab, entity_no: v,
                       message: 'Duplicate ' + field + ' in ' + tab + ' (rows ' + seen[v] + ' and ' + r.__row + ')' });
          }
          seen[v] = r.__row;
        });
      });
    });
    return out;
  },

  _referential() {
    const out = [];
    const poLineKeys = {};
    Repo.readAll(SHEETS.PO_LINES).forEach(l => { poLineKeys[l.po_no + '#' + l.line_no] = true; });

    Repo.readAll(SHEETS.GRN_LINES).forEach(l => {
      if (l.po_no && !poLineKeys[l.po_no + '#' + l.po_line_no]) {
        out.push({ severity: 'ERROR', check: 'referential', entity_type: 'GRN', entity_no: l.grn_no,
                   message: 'Line ' + l.line_no + ' references missing PO line ' + l.po_no + '#' + l.po_line_no });
      }
    });
    Repo.readAll(SHEETS.INV_LINES).forEach(l => {
      if (l.po_no && !poLineKeys[l.po_no + '#' + l.po_line_no]) {
        out.push({ severity: 'ERROR', check: 'referential', entity_type: 'INVOICE',
                   entity_no: l.inv_internal_no,
                   message: 'Line ' + l.line_no + ' references missing PO line ' + l.po_no + '#' + l.po_line_no });
      }
    });
    const grnNos = Repo.indexBy(SHEETS.GRN_HEADER, 'grn_no');
    Repo.readAll(SHEETS.QC_HEADER).forEach(q => {
      if (q.grn_no && !grnNos[q.grn_no]) {
        out.push({ severity: 'ERROR', check: 'referential', entity_type: 'QC', entity_no: q.qc_no,
                   message: 'References missing GRN ' + q.grn_no });
      }
    });
    return out;
  },

  _arithmetic() {
    const out = [];
    Repo.readAll(SHEETS.GRN_LINES).forEach(l => {
      const sum = Num.n(l.qty_accepted) + Num.n(l.qty_rejected) + Num.n(l.qty_on_hold);
      if (sum > 0 && Math.abs(sum - Num.n(l.qty_received)) > 0.001) {
        out.push({ severity: 'ERROR', check: 'arithmetic', entity_type: 'GRN', entity_no: l.grn_no,
                   message: 'Line ' + l.line_no + ': accepted+rejected+hold=' + sum +
                            ' but received=' + l.qty_received });
      }
    });
    const invLines = Repo.groupBy(SHEETS.INV_LINES, 'inv_internal_no');
    Repo.readAll(SHEETS.INV_HEADER).forEach(i => {
      const ls = invLines[i.inv_internal_no] || [];
      if (!ls.length) return;
      const sum = Num.round(ls.reduce((s, l) => s + Num.n(l.line_amount), 0), 2);
      if (Math.abs(sum - Num.n(i.subtotal_amount)) > 0.01) {
        out.push({ severity: 'WARN', check: 'arithmetic', entity_type: 'INVOICE',
                   entity_no: i.inv_internal_no,
                   message: 'Line total ' + sum + ' != header subtotal ' + i.subtotal_amount });
      }
    });
    const alloc = Repo.groupBy(SHEETS.PAY_ALLOC, 'payment_no');
    Repo.readAll(SHEETS.PAYMENTS).forEach(p => {
      const as = alloc[p.payment_no] || [];
      if (!as.length) return;
      const sum = Num.round(as.reduce((s, a) => s + Num.n(a.allocated_amount), 0), 2);
      if (Math.abs(sum - Num.n(p.gross_amount)) > 0.01) {
        out.push({ severity: 'ERROR', check: 'arithmetic', entity_type: 'PAYMENT', entity_no: p.payment_no,
                   message: 'Allocations ' + sum + ' != gross amount ' + p.gross_amount });
      }
    });
    return out;
  },

  _neverExceed() {
    const out = [];
    Repo.readAll(SHEETS.PO_LINES).forEach(l => {
      if (Num.n(l.qty_invoiced) > Num.n(l.qty_accepted) + 0.001) {
        out.push({ severity: 'ERROR', check: 'never_exceed', entity_type: 'PO', entity_no: l.po_no,
                   message: 'Line ' + l.line_no + ': invoiced ' + l.qty_invoiced +
                            ' exceeds QC-accepted ' + l.qty_accepted });
      }
      const tol = Num.n(l.over_tolerance_pct) || Config.num('OVER_RECEIPT_TOL_PCT', 2);
      if (Num.n(l.qty_received) > Num.n(l.qty_ordered) * (1 + tol / 100) + 0.001) {
        out.push({ severity: 'WARN', check: 'never_exceed', entity_type: 'PO', entity_no: l.po_no,
                   message: 'Line ' + l.line_no + ': received ' + l.qty_received +
                            ' exceeds ordered ' + l.qty_ordered + ' + ' + tol + '% tolerance' });
      }
    });
    Repo.readAll(SHEETS.INV_HEADER).forEach(i => {
      if (Num.n(i.paid_amount) > Num.n(i.net_payable) + 0.01) {
        out.push({ severity: 'ERROR', check: 'never_exceed', entity_type: 'INVOICE',
                   entity_no: i.inv_internal_no,
                   message: 'Paid ' + i.paid_amount + ' exceeds net payable ' + i.net_payable });
      }
    });
    return out;
  },

  _stateConsistency() {
    const out = [];
    const qcByGrn = Repo.groupBy(SHEETS.QC_HEADER, 'grn_no');
    Repo.readAll(SHEETS.GRN_HEADER)
      .filter(g => g.status === GRN_STATUS.POSTED && String(g.qc_required).toUpperCase() === 'TRUE')
      .forEach(g => {
        const pending = (qcByGrn[g.grn_no] || []).filter(q => q.status !== QC_STATUS.COMPLETED);
        if (pending.length) {
          out.push({ severity: 'ERROR', check: 'state', entity_type: 'GRN', entity_no: g.grn_no,
                     message: 'Posted while ' + pending.length + ' inspection(s) are still open' });
        }
      });
    Repo.readAll(SHEETS.INV_HEADER)
      .filter(i => i.payment_status === 'PAID' && String(i.qc_hold_flag).toUpperCase() === 'TRUE')
      .forEach(i => out.push({ severity: 'ERROR', check: 'state', entity_type: 'INVOICE',
                               entity_no: i.inv_internal_no, message: 'Paid while a QC hold is active' }));
    Repo.readAll(SHEETS.PO_HEADER)
      .filter(p => p.status === PO_STATUS.CLOSED && String(p.has_open_ncr).toUpperCase() === 'TRUE')
      .forEach(p => out.push({ severity: 'WARN', check: 'state', entity_type: 'PO', entity_no: p.po_no,
                               message: 'Closed with open NCR ' + p.open_ncr_nos }));
    // orphan documents
    const knownEntities = {};
    [[SHEETS.PO_HEADER, 'po_no'], [SHEETS.GRN_HEADER, 'grn_no'], [SHEETS.QC_HEADER, 'qc_no'],
     [SHEETS.NCR, 'ncr_no'], [SHEETS.INV_HEADER, 'inv_internal_no']]
      .forEach(m => Repo.readAll(m[0]).forEach(r => { knownEntities[r[m[1]]] = true; }));
    Repo.readAll(SHEETS.DOCUMENTS).forEach(d => {
      if (d.entity_no && !knownEntities[d.entity_no] && ['VENDOR', 'ITEM'].indexOf(d.entity_type) < 0) {
        out.push({ severity: 'WARN', check: 'orphan_document', entity_type: d.entity_type,
                   entity_no: d.entity_no, message: 'Document ' + d.file_name + ' references a missing record' });
      }
    });
    return out;
  }
};

/* ---------------------------------------------- A22 scorecard, A24 compliance, A23 FX */

const Scorecard = {
  rebuild() {
    const now = Fmt.now();
    const period = Fmt.today().slice(0, 7);
    const grns = Repo.groupBy(SHEETS.GRN_HEADER, 'vendor_code');
    const qcs = Repo.groupBy(SHEETS.QC_HEADER, 'vendor_code');
    const ncrs = Repo.groupBy(SHEETS.NCR, 'vendor_code');
    const pos = Repo.groupBy(SHEETS.PO_HEADER, 'vendor_code');

    const rows = Repo.readAll(SHEETS.VENDORS)
      .filter(v => String(v.is_active).toUpperCase() === 'TRUE')
      .map(v => {
        const myPos = pos[v.vendor_code] || [];
        const myGrns = (grns[v.vendor_code] || []).filter(g => g.status !== GRN_STATUS.CANCELLED);
        const myQcs = (qcs[v.vendor_code] || []).filter(q => q.status === QC_STATUS.COMPLETED);
        const myNcrs = ncrs[v.vendor_code] || [];

        const onTime = myGrns.filter(g => {
          const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', g.po_no);
          const promised = po && (po.promised_delivery_date || po.requested_delivery_date);
          return promised && String(g.grn_date) <= String(promised);
        }).length;
        const submitted = myQcs.reduce((s, q) => s + Num.n(q.qty_submitted), 0);
        const accepted = myQcs.reduce((s, q) => s + Num.n(q.qty_accepted), 0);
        const onTimePct = myGrns.length ? Num.round((onTime / myGrns.length) * 100, 1) : 100;
        const qcPassPct = submitted ? Num.round((accepted / submitted) * 100, 1) : 100;
        const docErrorPct = myGrns.length
          ? Num.round((myGrns.filter(g => String(g.doc_complete).toUpperCase() === 'FALSE').length /
                       myGrns.length) * 100, 1) : 0;
        const overall = Num.round(0.4 * onTimePct + 0.4 * qcPassPct + 0.2 * (100 - docErrorPct), 1);

        Repo.update(SHEETS.VENDORS, v.vendor_id, {
          scorecard_quality: qcPassPct, scorecard_delivery: onTimePct, scorecard_overall: overall
        });

        return {
          refreshed_at: now, period: period, vendor_code: v.vendor_code, vendor_name: v.vendor_name_en,
          po_count: myPos.length, on_time_pct: onTimePct, qc_pass_pct: qcPassPct,
          ncr_count: myNcrs.length,
          claim_value_thb: Num.round(myNcrs.reduce((s, n) => s + Num.n(n.financial_impact_thb), 0), 2),
          avg_lead_time_days: v.lead_time_days, doc_error_pct: docErrorPct,
          overall_score: overall,
          grade: overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : 'D'
        };
      })
      .sort((a, b) => b.overall_score - a.overall_score);

    Views._write(SHEETS.VW_SCORECARD, rows);
  }
};

const Compliance = {
  checkExpiries() {
    const horizon = Fmt.date(Fmt.addDays(Fmt.now(), 30));
    const today = Fmt.today();
    const alerts = [];

    Repo.readAll(SHEETS.VENDORS)
      .filter(v => String(v.is_active).toUpperCase() === 'TRUE')
      .forEach(v => {
        if (v.cert_expiry_earliest && String(v.cert_expiry_earliest) <= horizon) {
          alerts.push('Vendor ' + v.vendor_code + ' certificate expires ' + v.cert_expiry_earliest);
        }
        if (v.approval_expiry_date && String(v.approval_expiry_date) <= horizon) {
          alerts.push('Vendor ' + v.vendor_code + ' approval expires ' + v.approval_expiry_date);
        }
      });

    Repo.readAll(SHEETS.DOCUMENTS)
      .filter(d => String(d.is_current).toUpperCase() === 'TRUE' && d.valid_to &&
                   String(d.valid_to) <= horizon)
      .forEach(d => alerts.push(d.doc_type + ' for ' + d.entity_no + ' expires ' + d.valid_to));

    // open POs for vendors that went bad mid-order (edge case 18)
    const badVendors = {};
    Repo.readAll(SHEETS.VENDORS)
      .filter(v => ['SUSPENDED', 'BLACKLISTED'].indexOf(v.approved_status) >= 0)
      .forEach(v => { badVendors[v.vendor_code] = v.approved_status; });
    Repo.readAll(SHEETS.PO_HEADER)
      .filter(p => [PO_STATUS.CLOSED, PO_STATUS.CANCELLED].indexOf(p.status) < 0)
      .filter(p => badVendors[p.vendor_code])
      .forEach(p => alerts.push('Open PO ' + p.po_no + ' with ' + badVendors[p.vendor_code] +
                                ' vendor ' + p.vendor_code));

    if (alerts.length) {
      MailApp.sendEmail({
        to: [Props.get('ADMIN_EMAIL'), Config.get('PUR_MGR_EMAIL', '')].filter(Boolean).join(','),
        subject: '[PU-ACC] ' + alerts.length + ' compliance alert(s) — ' + today,
        htmlBody: '<b>Expiring or non-compliant</b><br><br>• ' + alerts.join('<br>• ')
      });
    }
    return alerts;
  }
};

const FxService = {
  /** A23 — fetch reference rates. Configure FX_API_URL; falls back to a warning if unavailable. */
  fetchDaily() {
    const url = Config.get('FX_API_URL', '');
    const currencies = String(Config.get('FX_CURRENCIES', 'USD,EUR,CNY,JPY')).split(',');
    if (!url) {
      Logger.log('FX_API_URL not configured — rates must be entered manually.');
      return 0;
    }
    let inserted = 0;
    currencies.forEach(cur => {
      try {
        const res = UrlFetchApp.fetch(url.replace('{CURRENCY}', cur.trim()), { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
        const data = JSON.parse(res.getContentText());
        const rate = Num.n(data.rate || (data.rates && data.rates.THB));
        if (!rate) throw new Error('no rate in response');
        const today = Fmt.today();
        const existing = Repo.readAll(SHEETS.FX)
          .filter(r => r.currency === cur.trim() && String(r.fx_date) === today);
        if (!existing.length) {
          Repo.insert(SHEETS.FX, {
            fx_id: Utilities.getUuid(), fx_date: today, currency: cur.trim(),
            rate_to_thb: rate, rate_type: 'BOT_MID',
            source: Config.get('FX_SOURCE', 'BOT'), fetched_at: Fmt.now(), entered_by: 'SYSTEM'
          });
          inserted++;
        }
      } catch (e) {
        ErrorLog.write({
          severity: 'WARN', function_name: 'FxService.fetchDaily',
          entity_no: cur, error_message: 'FX fetch failed: ' + e.message
        });
      }
    });
    return inserted;
  }
};

/* --------------------------------------------------- A21 backup, A25 close/archive */

const Housekeeping = {

  backup() {
    const src = DriveApp.getFileById(Props.require('SPREADSHEET_ID'));
    const folder = DriveService.path(DriveService.root(),
      ['00_System', 'Backups', Fmt.today().slice(0, 4), Fmt.today().slice(5, 7)]);
    const copy = src.makeCopy('BACKUP_' + src.getName() + '_' + Fmt.stamp(), folder);

    const keepDays = Config.num('BACKUP_RETENTION_DAYS', 30);
    const cutoff = new Date(Date.now() - keepDays * 864e5);
    const parent = DriveService.path(DriveService.root(), ['00_System', 'Backups']);
    const stack = [parent];
    while (stack.length) {
      const f = stack.pop();
      const subs = f.getFolders();
      while (subs.hasNext()) stack.push(subs.next());
      const files = f.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        if (file.getDateCreated() < cutoff && file.getId() !== copy.getId()) file.setTrashed(true);
      }
    }
    return copy.getId();
  },

  /** A25 — close eligible POs and archive their folders. */
  closeAndArchive() {
    const closed = [];
    Repo.readAll(SHEETS.PO_HEADER)
      .filter(po => [PO_STATUS.INVOICED].indexOf(po.status) >= 0)
      .forEach(po => {
        const invoices = Repo.findAll(SHEETS.INV_HEADER, 'po_no', po.po_no)
          .filter(i => i.match_status !== MATCH_STATUS.REJECTED);
        const allPaid = invoices.length && invoices.every(i => i.payment_status === 'PAID');
        if (!allPaid) return;
        if (String(po.has_open_ncr).toUpperCase() === 'TRUE') return;
        try {
          StateMachine.fireAsSystem('PO', po.po_no, 'CLOSE');
          closed.push(po.po_no);
        } catch (e) {
          Logger.log('close skipped for ' + po.po_no + ': ' + e.message);
        }
      });

    const archiveAfter = Config.num('ARCHIVE_AFTER_DAYS_CLOSED', 30);
    const cutoff = Fmt.date(Fmt.addDays(Fmt.now(), -archiveAfter));
    Repo.readAll(SHEETS.PO_HEADER)
      .filter(po => po.status === PO_STATUS.CLOSED && po.closed_at &&
                    Fmt.date(po.closed_at) <= cutoff && po.drive_folder_id)
      .slice(0, 20)                                   // stay inside the execution budget
      .forEach(po => {
        try { DriveService.archivePo(po.po_no); }
        catch (e) { Logger.log('archive skipped for ' + po.po_no + ': ' + e.message); }
      });

    return closed;
  }
};

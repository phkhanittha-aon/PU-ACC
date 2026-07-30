/**
 * 02_StateMachine.gs — identity, authorisation, and the transition contract.
 *
 * The transition table here is the executable form of docs/01 §3. If a transition is not
 * declared, it cannot happen — including from AppSheet, which is re-validated by
 * guardAppSheetWrite_() in 07_Triggers.gs.
 */

/* --------------------------------------------------------------------- auth */

const Auth = {
  _user: null,

  /** Identity comes from the session, never from the request body. */
  currentEmail() {
    try {
      return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'SYSTEM';
    } catch (e) {
      return 'SYSTEM';
    }
  },

  currentUser() {
    if (this._user) return this._user;
    const email = this.currentEmail();
    if (email === 'SYSTEM') {
      this._user = { email: 'SYSTEM', full_name: 'System', role_codes: ROLES.SYS_ADMIN, is_active: 'TRUE' };
      return this._user;
    }
    const u = Repo.findOne(SHEETS.USERS, 'email', email);
    if (!u) throw new AppError('NOT_REGISTERED', email + ' is not a registered PU-ACC user. Contact IT.');
    if (String(u.is_active).toUpperCase() !== 'TRUE') {
      throw new AppError('INACTIVE_USER', 'Your PU-ACC account is inactive.');
    }
    this._user = u;
    return u;
  },

  roles(user) {
    const u = user || this.currentUser();
    return String(u.role_codes || '').split(',').map(s => s.trim()).filter(Boolean);
  },

  hasRole(role) { return this.roles().indexOf(role) >= 0; },

  isSystem() { return this.currentEmail() === 'SYSTEM'; },

  /** Deny by default: an (module, permission) pair not granted to any of the caller's roles fails. */
  require(module, permission) {
    if (this.isSystem()) return true;
    const roles = this.roles();
    const granted = Repo.readAll(SHEETS.ROLES).some(r =>
      String(r.is_active).toUpperCase() === 'TRUE' &&
      roles.indexOf(r.role_code) >= 0 &&
      r.module === module &&
      String(r.permission).split(',').map(s => s.trim()).indexOf(permission) >= 0);
    if (!granted) {
      History.log({
        entity_type: 'AUTH', entity_no: module + ':' + permission, action: 'DENIED',
        reason: 'role_codes=' + roles.join('|')
      });
      throw new AppError('FORBIDDEN', 'You do not have ' + permission + ' permission on ' + module + '.');
    }
    return true;
  },

  /** Segregation of duties: the actor must not be the person who created the record. */
  requireNotSelf(record, field, what) {
    const actor = this.currentEmail();
    if (String(record[field] || '').toLowerCase() === actor.toLowerCase()) {
      throw new AppError('SOD_VIOLATION',
        'Segregation of duties: you cannot ' + what + ' a record you created.');
    }
  },

  /** Resolve an approver, honouring active delegation. */
  effectiveApprover(email) {
    const u = Repo.findOne(SHEETS.USERS, 'email', email);
    if (!u) return email;
    if (u.delegate_email && u.delegate_until && String(u.delegate_until) >= Fmt.today()) {
      return u.delegate_email;
    }
    return email;
  }
};

/* --------------------------------------------------------- transition table */

/**
 * TRANSITIONS[entityType][fromStatus] = [{ to, action, roles, guard, effect }]
 *  roles  — who may fire it ('SYSTEM' = script only)
 *  guard  — (record, ctx) => void, throws AppError to refuse
 *  effect — (record, ctx) => patchObject, applied with the status change
 */
const TRANSITIONS = {

  PO: {
    DRAFT: [
      { to: PO_STATUS.PENDING_APPROVAL, action: 'SUBMIT', roles: [ROLES.BUYER],
        guard: (po, ctx) => Workflow.validatePoForSubmit(po),
        effect: (po) => ({
          approval_level_required: Approvals.levelsRequired('PO', po),
          approval_level_current: 0,
          sla_due_at: Fmt.addHours(Fmt.now(), Config.num('PO_APPROVAL_SLA_HOURS', 24))
        }) },
      { to: PO_STATUS.CANCELLED, action: 'CANCEL', roles: [ROLES.BUYER, ROLES.PUR_MGR] }
    ],
    PENDING_APPROVAL: [
      { to: PO_STATUS.APPROVED, action: 'APPROVE', roles: [ROLES.PUR_MGR, ROLES.FIN_MGR],
        guard: (po) => {
          Auth.requireNotSelf(po, 'created_by', 'approve');
          Approvals.assertIsCurrentApprover('PO', po);
        },
        effect: (po) => ({ approved_by: Auth.currentEmail(), approved_at: Fmt.now(), reject_reason: '' }) },
      { to: PO_STATUS.REJECTED, action: 'REJECT', roles: [ROLES.PUR_MGR, ROLES.FIN_MGR],
        guard: (po, ctx) => {
          if (!ctx.reason) throw new AppError('REASON_REQUIRED', 'A rejection reason is required.');
        },
        effect: (po, ctx) => ({ reject_reason: ctx.reason }) }
    ],
    REJECTED: [
      { to: PO_STATUS.DRAFT, action: 'REVISE', roles: [ROLES.BUYER] },
      { to: PO_STATUS.CANCELLED, action: 'CANCEL', roles: [ROLES.BUYER] }
    ],
    APPROVED: [
      { to: PO_STATUS.SENT_TO_VENDOR, action: 'SEND_TO_VENDOR', roles: [ROLES.BUYER],
        guard: (po) => {
          if (!po.pdf_file_id) throw new AppError('NO_PDF', 'Generate the PO PDF before sending.');
          const v = Repo.findOne(SHEETS.VENDORS, 'vendor_code', po.vendor_code);
          if (!v || !v.contact_email) throw new AppError('NO_VENDOR_EMAIL', 'Vendor has no contact email.');
        },
        effect: () => ({ sent_to_vendor_at: Fmt.now() }) },
      { to: PO_STATUS.CANCELLED, action: 'CANCEL', roles: [ROLES.BUYER, ROLES.PUR_MGR],
        guard: (po) => {
          if (po.receipt_status && po.receipt_status !== 'NONE') {
            throw new AppError('HAS_RECEIPT', 'This PO has receipts. Use Short Close instead of Cancel.');
          }
        } }
    ],
    SENT_TO_VENDOR: [
      { to: PO_STATUS.ACKNOWLEDGED, action: 'VENDOR_ACK', roles: [ROLES.BUYER],
        effect: (po, ctx) => ({ vendor_ack_at: Fmt.now(), vendor_ack_ref: ctx.ref || '' }) },
      { to: PO_STATUS.PARTIALLY_RECEIVED, action: 'RECEIPT_POSTED', roles: ['SYSTEM'] },
      { to: PO_STATUS.FULLY_RECEIVED, action: 'RECEIPT_POSTED', roles: ['SYSTEM'] },
      { to: PO_STATUS.CANCELLED, action: 'CANCEL', roles: [ROLES.BUYER, ROLES.PUR_MGR],
        guard: (po) => {
          if (po.receipt_status && po.receipt_status !== 'NONE') {
            throw new AppError('HAS_RECEIPT', 'This PO has receipts. Use Short Close instead of Cancel.');
          }
        } }
    ],
    ACKNOWLEDGED: [
      { to: PO_STATUS.PARTIALLY_RECEIVED, action: 'RECEIPT_POSTED', roles: ['SYSTEM'] },
      { to: PO_STATUS.FULLY_RECEIVED, action: 'RECEIPT_POSTED', roles: ['SYSTEM'] }
    ],
    PARTIALLY_RECEIVED: [
      { to: PO_STATUS.FULLY_RECEIVED, action: 'RECEIPT_POSTED', roles: ['SYSTEM'] },
      { to: PO_STATUS.ON_HOLD, action: 'HOLD', roles: [ROLES.PUR_MGR, ROLES.QC_MGR],
        effect: (po, ctx) => ({ remark: ctx.reason || 'On hold' }) },
      { to: PO_STATUS.SHORT_CLOSED, action: 'SHORT_CLOSE', roles: [ROLES.BUYER, ROLES.PUR_MGR],
        guard: (po, ctx) => {
          if (!ctx.reason) throw new AppError('REASON_REQUIRED', 'A short-close reason is required.');
        },
        effect: (po, ctx) => Workflow.shortClosePoLines(po, ctx.reason) }
    ],
    ON_HOLD: [
      { to: PO_STATUS.PARTIALLY_RECEIVED, action: 'RELEASE_HOLD', roles: [ROLES.PUR_MGR, ROLES.QC_MGR] }
    ],
    FULLY_RECEIVED: [
      { to: PO_STATUS.INVOICED, action: 'FULLY_INVOICED', roles: ['SYSTEM'] }
    ],
    SHORT_CLOSED: [
      { to: PO_STATUS.INVOICED, action: 'FULLY_INVOICED', roles: ['SYSTEM'] }
    ],
    INVOICED: [
      { to: PO_STATUS.CLOSED, action: 'CLOSE', roles: ['SYSTEM', ROLES.FIN_MGR],
        guard: (po) => {
          if (String(po.has_open_ncr).toUpperCase() === 'TRUE') {
            throw new AppError('OPEN_NCR', 'Cannot close: NCR ' + po.open_ncr_nos + ' is still open.');
          }
        },
        effect: () => ({ closed_at: Fmt.now() }) }
    ]
  },

  GRN: {
    DRAFT: [
      { to: GRN_STATUS.SUBMITTED, action: 'SUBMIT', roles: [ROLES.WH_OFFICER, ROLES.WH_SUP],
        guard: (grn, ctx) => Workflow.validateGrnForSubmit(grn, ctx),
        effect: () => ({}) },
      { to: GRN_STATUS.CANCELLED, action: 'CANCEL', roles: [ROLES.WH_OFFICER, ROLES.WH_SUP] }
    ],
    SUBMITTED: [
      { to: GRN_STATUS.PENDING_QC, action: 'ROUTE_TO_QC', roles: ['SYSTEM'] },
      { to: GRN_STATUS.POSTED, action: 'AUTO_POST_NO_QC', roles: ['SYSTEM'] }
    ],
    PENDING_QC: [
      { to: GRN_STATUS.QC_IN_PROGRESS, action: 'QC_STARTED', roles: ['SYSTEM', ROLES.QC_INSPECTOR] }
    ],
    QC_IN_PROGRESS: [
      { to: GRN_STATUS.QC_PENDING_LAB, action: 'SENT_TO_LAB', roles: ['SYSTEM', ROLES.QC_INSPECTOR] },
      { to: GRN_STATUS.QC_PASSED, action: 'QC_PASS', roles: ['SYSTEM'] },
      { to: GRN_STATUS.QC_CONDITIONAL, action: 'QC_CONDITIONAL', roles: ['SYSTEM'] },
      { to: GRN_STATUS.QC_FAILED, action: 'QC_FAIL', roles: ['SYSTEM'] }
    ],
    QC_PENDING_LAB: [
      { to: GRN_STATUS.QC_PASSED, action: 'QC_PASS', roles: ['SYSTEM'] },
      { to: GRN_STATUS.QC_FAILED, action: 'QC_FAIL', roles: ['SYSTEM'] }
    ],
    QC_PASSED: [
      { to: GRN_STATUS.POSTED, action: 'POST', roles: ['SYSTEM'] }
    ],
    QC_CONDITIONAL: [
      { to: GRN_STATUS.POSTED, action: 'POST', roles: ['SYSTEM'] }
    ],
    QC_FAILED: [
      { to: GRN_STATUS.QUARANTINE, action: 'QUARANTINE', roles: ['SYSTEM'] }
    ],
    QUARANTINE: [
      { to: GRN_STATUS.PARTIALLY_POSTED, action: 'POST_ACCEPTED_PORTION', roles: ['SYSTEM'] },
      { to: GRN_STATUS.RETURN_TO_VENDOR, action: 'RETURN', roles: [ROLES.WH_SUP, ROLES.QC_MGR] },
      { to: GRN_STATUS.SCRAPPED, action: 'SCRAP', roles: [ROLES.QC_MGR] }
    ],
    PARTIALLY_POSTED: [
      { to: GRN_STATUS.POSTED, action: 'POST', roles: ['SYSTEM'] },
      { to: GRN_STATUS.RETURN_TO_VENDOR, action: 'RETURN', roles: [ROLES.WH_SUP, ROLES.QC_MGR] }
    ],
    RETURN_TO_VENDOR: [
      { to: GRN_STATUS.CLOSED_RTV, action: 'RTV_COMPLETE', roles: [ROLES.WH_SUP] }
    ],
    POSTED: [
      { to: GRN_STATUS.REVERSED, action: 'REVERSE', roles: [ROLES.WH_SUP],
        guard: (grn, ctx) => {
          if (!ctx.reason) throw new AppError('REASON_REQUIRED', 'A reversal reason is required.');
          const invoiced = Repo.findAll(SHEETS.INV_LINES, 'grn_no', grn.grn_no);
          if (invoiced.length) {
            throw new AppError('GRN_INVOICED',
              'This receipt is already matched to an invoice. Ask Accounting for a credit/debit note instead.');
          }
        },
        effect: (grn, ctx) => Workflow.reverseGrnEffect(grn, ctx.reason) }
    ]
  },

  QC: {
    PENDING: [
      { to: QC_STATUS.ASSIGNED, action: 'ASSIGN', roles: [ROLES.QC_MGR, ROLES.QC_INSPECTOR],
        effect: (qc, ctx) => ({ assigned_to: ctx.assignTo || Auth.currentEmail() }) },
      { to: QC_STATUS.SAMPLING, action: 'START', roles: [ROLES.QC_INSPECTOR, ROLES.QC_MGR],
        effect: (qc) => ({ started_at: Fmt.now(), inspector_email: Auth.currentEmail() }) }
    ],
    ASSIGNED: [
      { to: QC_STATUS.SAMPLING, action: 'START', roles: [ROLES.QC_INSPECTOR, ROLES.QC_MGR],
        effect: () => ({ started_at: Fmt.now(), inspector_email: Auth.currentEmail() }) }
    ],
    SAMPLING: [
      { to: QC_STATUS.TESTING, action: 'RECORD_RESULTS', roles: [ROLES.QC_INSPECTOR] },
      { to: QC_STATUS.PENDING_LAB, action: 'SEND_TO_LAB', roles: [ROLES.QC_INSPECTOR],
        guard: (qc, ctx) => {
          if (!ctx.lab_name) throw new AppError('LAB_REQUIRED', 'Record the laboratory name.');
        },
        effect: (qc, ctx) => ({
          lab_name: ctx.lab_name, lab_sent_at: Fmt.now(),
          lab_due_at: Fmt.addDays(Fmt.now(), Num.n(ctx.turnaround_days) || 5)
        }) }
    ],
    TESTING: [
      { to: QC_STATUS.PENDING_LAB, action: 'SEND_TO_LAB', roles: [ROLES.QC_INSPECTOR] },
      { to: QC_STATUS.COMPLETED, action: 'COMPLETE_PASS', roles: [ROLES.QC_INSPECTOR, ROLES.QC_MGR],
        guard: (qc, ctx) => Workflow.validateQcCompletion(qc, ctx, QC_RESULT.PASS) },
      { to: QC_STATUS.COMPLETED, action: 'COMPLETE_FAIL', roles: [ROLES.QC_INSPECTOR, ROLES.QC_MGR],
        guard: (qc, ctx) => Workflow.validateQcCompletion(qc, ctx, QC_RESULT.FAIL) },
      { to: QC_STATUS.PENDING_APPROVAL, action: 'PROPOSE_CONDITIONAL', roles: [ROLES.QC_INSPECTOR],
        guard: (qc, ctx) => {
          if (!ctx.conditional_reason) {
            throw new AppError('REASON_REQUIRED', 'Explain the deviation you are accepting.');
          }
          Workflow.validateQcCompletion(qc, ctx, QC_RESULT.CONDITIONAL);
        },
        effect: (qc, ctx) => ({
          conditional_reason: ctx.conditional_reason,
          conditional_deduction_pct: Num.n(ctx.conditional_deduction_pct)
        }) }
    ],
    PENDING_LAB: [
      { to: QC_STATUS.TESTING, action: 'LAB_RESULT_RECEIVED', roles: [ROLES.QC_INSPECTOR, ROLES.QC_MGR],
        effect: () => ({ lab_result_received_at: Fmt.now() }) }
    ],
    PENDING_APPROVAL: [
      { to: QC_STATUS.COMPLETED, action: 'APPROVE_CONDITIONAL', roles: [ROLES.QC_MGR],
        guard: (qc) => Auth.requireNotSelf(qc, 'inspector_email', 'approve a concession on'),
        effect: () => ({ conditional_approved_by: Auth.currentEmail(), conditional_approved_at: Fmt.now() }) },
      { to: QC_STATUS.TESTING, action: 'REJECT_CONDITIONAL', roles: [ROLES.QC_MGR] }
    ]
  },

  INVOICE: {
    RECEIVED: [
      { to: MATCH_STATUS.MATCHING, action: 'RUN_MATCH', roles: ['SYSTEM', ROLES.AP_OFFICER] },
      { to: MATCH_STATUS.REJECTED, action: 'REJECT', roles: [ROLES.AP_OFFICER],
        guard: (inv, ctx) => {
          if (!ctx.reason) throw new AppError('REASON_REQUIRED', 'A rejection reason is required.');
        },
        effect: (inv, ctx) => ({ reject_reason: ctx.reason }) }
    ],
    MATCHING: [
      { to: MATCH_STATUS.MATCHED, action: 'MATCH_PASS', roles: ['SYSTEM'] },
      { to: MATCH_STATUS.EXCEPTION, action: 'MATCH_EXCEPTION', roles: ['SYSTEM'] },
      { to: MATCH_STATUS.NO_GRN, action: 'MATCH_NO_RECEIPT', roles: ['SYSTEM'] }
    ],
    NO_GRN: [
      { to: MATCH_STATUS.MATCHING, action: 'RUN_MATCH', roles: ['SYSTEM', ROLES.AP_OFFICER] }
    ],
    EXCEPTION: [
      { to: MATCH_STATUS.MATCHING, action: 'RESOLVE_AND_REMATCH', roles: [ROLES.AP_OFFICER, ROLES.BUYER],
        guard: (inv, ctx) => {
          if (!ctx.reason) throw new AppError('REASON_REQUIRED', 'Record how the variance was resolved.');
        } },
      { to: MATCH_STATUS.DISPUTED, action: 'DISPUTE', roles: [ROLES.AP_OFFICER, ROLES.BUYER],
        effect: (inv, ctx) => ({ dispute_reason: ctx.reason || '', dispute_owner: Auth.currentEmail() }) },
      { to: MATCH_STATUS.REJECTED, action: 'REJECT', roles: [ROLES.AP_OFFICER, ROLES.FIN_MGR],
        effect: (inv, ctx) => ({ reject_reason: ctx.reason || '' }) }
    ],
    DISPUTED: [
      { to: MATCH_STATUS.CREDIT_NOTE_PENDING, action: 'AWAIT_CREDIT_NOTE', roles: [ROLES.AP_OFFICER] },
      { to: MATCH_STATUS.MATCHING, action: 'RESOLVE_AND_REMATCH', roles: [ROLES.AP_OFFICER] }
    ],
    CREDIT_NOTE_PENDING: [
      { to: MATCH_STATUS.MATCHING, action: 'CREDIT_NOTE_RECEIVED', roles: [ROLES.AP_OFFICER] }
    ],
    QC_HOLD: [
      { to: MATCH_STATUS.MATCHING, action: 'RELEASE_QC_HOLD', roles: [ROLES.QC_MGR],
        effect: () => ({ qc_hold_flag: 'FALSE', hold_released_by: Auth.currentEmail(), hold_released_at: Fmt.now() }) }
    ],
    MATCHED: [
      { to: MATCH_STATUS.APPROVED_FOR_PAYMENT, action: 'APPROVE', roles: [ROLES.FIN_MGR],
        guard: (inv) => {
          Auth.requireNotSelf(inv, 'created_by', 'approve');
          if (String(inv.qc_hold_flag).toUpperCase() === 'TRUE') {
            throw new AppError('QC_HOLD', 'A QC hold is active on this invoice: ' + inv.qc_hold_reason);
          }
          Approvals.assertWithinLimit(Num.n(inv.total_amount_thb));
        },
        effect: () => ({ approved_by: Auth.currentEmail(), approved_at: Fmt.now() }) },
      { to: MATCH_STATUS.QC_HOLD, action: 'APPLY_QC_HOLD', roles: ['SYSTEM', ROLES.QC_MGR] },
      { to: MATCH_STATUS.EXCEPTION, action: 'REOPEN_EXCEPTION', roles: ['SYSTEM', ROLES.AP_OFFICER] }
    ],
    APPROVED_FOR_PAYMENT: [
      { to: MATCH_STATUS.SCHEDULED, action: 'SCHEDULE', roles: ['SYSTEM', ROLES.AP_OFFICER] }
    ],
    SCHEDULED: [
      { to: MATCH_STATUS.PAID, action: 'PAID', roles: ['SYSTEM', ROLES.FIN_MGR] },
      { to: MATCH_STATUS.APPROVED_FOR_PAYMENT, action: 'UNSCHEDULE', roles: [ROLES.AP_OFFICER] }
    ]
  }
};

/** Which tab and status column each entity type uses. */
const ENTITY_MAP = {
  PO:      { tab: SHEETS.PO_HEADER, statusCol: 'status', noCol: 'po_no', module: 'PO' },
  GRN:     { tab: SHEETS.GRN_HEADER, statusCol: 'status', noCol: 'grn_no', module: 'GRN' },
  QC:      { tab: SHEETS.QC_HEADER, statusCol: 'status', noCol: 'qc_no', module: 'QC' },
  INVOICE: { tab: SHEETS.INV_HEADER, statusCol: 'match_status', noCol: 'inv_internal_no', module: 'INVOICE' },
  PR:      { tab: SHEETS.PR_HEADER, statusCol: 'status', noCol: 'pr_no', module: 'PR' }
};

const StateMachine = {

  /** Transitions the caller may fire on this record right now — drives UI buttons. */
  allowed(entityType, record) {
    const map = ENTITY_MAP[entityType];
    const from = record[map.statusCol];
    const defs = (TRANSITIONS[entityType] || {})[from] || [];
    const roles = Auth.roles();
    return defs
      .filter(t => t.roles.some(r => r === 'SYSTEM' ? Auth.isSystem() : roles.indexOf(r) >= 0))
      .map(t => ({ action: t.action, to: t.to }));
  },

  /**
   * Fire a transition. This is the ONLY way a status changes.
   * @param {string} entityType  PO | GRN | QC | INVOICE | PR
   * @param {string} entityNo    document number
   * @param {string} action      action name from the table
   * @param {object} ctx         { reason, expectedVersion, source, ...action-specific }
   */
  fire(entityType, entityNo, action, ctx) {
    ctx = ctx || {};
    const map = ENTITY_MAP[entityType];
    if (!map) throw new AppError('BAD_ENTITY', 'Unknown entity type ' + entityType);

    return withLock_(() => {
      const record = Repo.findOne(map.tab, map.noCol, entityNo);
      if (!record) throw new AppError('NOT_FOUND', entityType + ' ' + entityNo + ' not found.');

      const from = record[map.statusCol];
      const defs = (TRANSITIONS[entityType] || {})[from] || [];
      const t = defs.filter(d => d.action === action)[0];
      if (!t) {
        throw new AppError('ILLEGAL_TRANSITION',
          entityType + ' ' + entityNo + ' is ' + from + '; "' + action + '" is not allowed from that state.');
      }

      const isSystemOnly = t.roles.length === 1 && t.roles[0] === 'SYSTEM';
      if (isSystemOnly && !Auth.isSystem()) {
        throw new AppError('SYSTEM_ONLY', action + ' is performed automatically by the system.');
      }
      if (!Auth.isSystem()) {
        const roles = Auth.roles();
        if (!t.roles.some(r => roles.indexOf(r) >= 0)) {
          throw new AppError('FORBIDDEN', 'Your role cannot ' + action + ' this ' + entityType + '.');
        }
      }

      if (t.guard) t.guard(record, ctx);
      const patch = Object.assign({}, t.effect ? (t.effect(record, ctx) || {}) : {});
      patch[map.statusCol] = t.to;

      const updated = Repo.update(map.tab, record[SCHEMA[map.tab].pk], patch, ctx.expectedVersion);

      History.log({
        entity_type: entityType, entity_no: entityNo, entity_id: record[SCHEMA[map.tab].pk],
        action: action, from_status: from, to_status: t.to,
        reason: ctx.reason || '', changed_fields: Object.keys(patch),
        sla_hours: record.sla_due_at ? Fmt.hoursBetween(record.created_at, record.sla_due_at) : '',
        sla_breached: record.sla_due_at ? (Fmt.now() > record.sla_due_at) : '',
        source: ctx.source || 'WEB', payload: ctx
      });

      return updated;
    });
  },

  /** Run a transition as the system (used by triggers and workflow chaining). */
  fireAsSystem(entityType, entityNo, action, ctx) {
    const realUser = Auth._user;
    Auth._user = { email: 'SYSTEM', role_codes: ROLES.SYS_ADMIN, is_active: 'TRUE' };
    try {
      return this.fire(entityType, entityNo, action, Object.assign({ source: 'TRIGGER' }, ctx || {}));
    } finally {
      Auth._user = realUser;
    }
  }
};

/* ---------------------------------------------------------------- approvals */

const Approvals = {

  rulesFor(docType, record) {
    const amount = Num.n(record.total_amount_thb || record.total_est_amount_thb || record.net_amount_thb);
    return Repo.readAll(SHEETS.APPROVAL_MATRIX)
      .filter(r => r.doc_type === docType && String(r.is_active).toUpperCase() === 'TRUE')
      .filter(r => !r.department || r.department === record.department)
      .filter(r => amount >= Num.n(r.amount_from_thb) &&
                   (Num.n(r.amount_to_thb) === 0 || amount <= Num.n(r.amount_to_thb)))
      .sort((a, b) => Num.n(a.level) - Num.n(b.level));
  },

  levelsRequired(docType, record) {
    return this.rulesFor(docType, record).length || 1;
  },

  /** Approver for the next pending level, with delegation applied. */
  nextApprover(docType, record) {
    const rules = this.rulesFor(docType, record);
    const nextLevel = Num.n(record.approval_level_current) + 1;
    const rule = rules.filter(r => Num.n(r.level) === nextLevel)[0] || rules[0];
    if (!rule) return Props.get('ADMIN_EMAIL');
    if (rule.resolve_by === 'REQUESTER_MANAGER') {
      const u = Repo.findOne(SHEETS.USERS, 'email', record.created_by || record.requester_email);
      return Auth.effectiveApprover(u ? u.manager_email : Props.get('ADMIN_EMAIL'));
    }
    if (rule.approver_email) return Auth.effectiveApprover(rule.approver_email);
    const holder = Repo.readAll(SHEETS.USERS).filter(u =>
      String(u.is_active).toUpperCase() === 'TRUE' &&
      String(u.role_codes).indexOf(rule.approver_role) >= 0)[0];
    return holder ? Auth.effectiveApprover(holder.email) : Props.get('ADMIN_EMAIL');
  },

  assertIsCurrentApprover(docType, record) {
    if (Auth.isSystem()) return;
    const expected = String(this.nextApprover(docType, record) || '').toLowerCase();
    const actor = Auth.currentEmail().toLowerCase();
    if (expected && expected !== actor && !Auth.hasRole(ROLES.SYS_ADMIN)) {
      throw new AppError('NOT_YOUR_APPROVAL', 'This approval is assigned to ' + expected + '.');
    }
  },

  assertWithinLimit(amountThb) {
    if (Auth.isSystem()) return;
    const limit = Num.n(Auth.currentUser().approval_limit_thb);
    if (limit && amountThb > limit) {
      throw new AppError('OVER_LIMIT',
        'Amount ' + Fmt.money(amountThb) + ' THB exceeds your approval limit of ' + Fmt.money(limit) + '.');
    }
  }
};

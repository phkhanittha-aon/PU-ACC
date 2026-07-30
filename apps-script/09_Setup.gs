/**
 * 09_Setup.gs — one-click bootstrap.
 *
 * setupWorkspace() creates the spreadsheet tabs, headers, formats, named ranges, data
 * validation, the Drive folder tree, counters, config, and lookups described in docs/02.
 * Safe to re-run: it adds what is missing and never deletes data.
 *
 * First-time order:
 *   1. Set script properties: SPREADSHEET_ID, DRIVE_ROOT_ID, ADMIN_EMAIL, HMAC_SECRET
 *   2. Run setupWorkspace()
 *   3. Run seedReferenceData()
 *   4. Load master data (Users, Vendors, Items, Approval_Matrix, QC_Specs)
 *   5. Create the Docs templates, set TPL_*_DOC_ID
 *   6. Run installTriggers()
 *   7. Deploy as a web app (execute as me, access: domain)
 */

function setupWorkspace() {
  const ss = SpreadsheetApp.openById(Props.require('SPREADSHEET_ID'));
  const created = [];

  schemaTabNames().forEach(tab => {
    if (OVERFLOW_TABS[tab] && Props.get(OVERFLOW_TABS[tab])) return;   // lives in another file
    let sh = ss.getSheetByName(tab);
    if (!sh) { sh = ss.insertSheet(tab); created.push(tab); }
    const cols = schemaCols(tab);

    // header row
    sh.getRange(1, 1, 1, cols.length).setValues([cols])
      .setFontWeight('bold').setBackground('#e8eaed').setFontSize(9)
      .setVerticalAlignment('middle').setWrap(true);
    sh.setFrozenRows(1);
    if (sh.getMaxColumns() > cols.length) {
      sh.deleteColumns(cols.length + 1, sh.getMaxColumns() - cols.length);
    }

    // narrow columns beat horizontal scrolling on 50-column tabs
    sh.setColumnWidths(1, cols.length, 110);
    ['description', 'remark', 'notes', 'reason', 'payload_json', 'error_message', 'stack']
      .forEach(wide => {
        const i = cols.indexOf(wide);
        if (i >= 0) sh.setColumnWidth(i + 1, 240);
      });

    if (SCHEMA[tab].view) sh.setTabColor('#9aa0a6');
    else if (tab.indexOf('VW_') === 0) sh.setTabColor('#9aa0a6');
  });

  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  ensureDriveTree();
  ensureCounters();
  ensureConfig();
  applyValidation();

  return 'Setup complete. Tabs created: ' + (created.length ? created.join(', ') : 'none (all existed)');
}

/** Drive skeleton from docs/02 §7. */
function ensureDriveTree() {
  const root = DriveService.root();
  [
    ['00_System', 'Database'], ['00_System', 'Templates'], ['00_System', 'Backups'],
    ['00_System', 'Exports'], ['00_System', 'Exports', 'Invoice_Inbox'],
    ['01_Vendors'], ['02_Transactions'], ['03_Archive']
  ].forEach(path => DriveService.path(root, path));
  return root.getId();
}

function ensureCounters() {
  const counters = [
    ['PR', 'PR', 4], ['PO', 'PO', 4], ['GRN', 'GR', 4], ['QC', 'QC', 4], ['NCR', 'NCR', 4],
    ['RTV', 'RTV', 4], ['INVOICE', 'AP', 4], ['PAYMENT', 'PAY', 4],
    ['DEBIT_NOTE', 'DN', 4], ['CREDIT_NOTE', 'CN', 4]
  ];
  const yy = Fmt.fiscalYY();
  counters.forEach(c => {
    if (!Repo.findOne(SHEETS.COUNTERS, 'counter_key', c[0])) {
      Repo.insert(SHEETS.COUNTERS, {
        counter_key: c[0], prefix: c[1], year: yy, last_number: 0, padding: c[2],
        format: '{PREFIX}-{YY}-{NNNN}', updated_at: Fmt.now()
      });
    }
  });
}

/** Config defaults from Appendix A §3. Existing values are never overwritten. */
function ensureConfig() {
  const defaults = [
    ['PRICE_TOL_PCT', '2', 'NUMBER', 'MATCH', 'Invoice price variance tolerance (%)'],
    ['PRICE_TOL_ABS_THB', '200', 'NUMBER', 'MATCH', 'Absolute price tolerance; lower of pct/abs applies'],
    ['AMOUNT_TOL_ABS_THB', '500', 'NUMBER', 'MATCH', 'Whole-invoice rounding tolerance'],
    ['FX_TOL_PCT', '1', 'NUMBER', 'MATCH', 'Invoice FX rate variance tolerance'],
    ['OVER_RECEIPT_TOL_PCT', '2', 'NUMBER', 'RECEIVING', 'Default over-delivery tolerance'],
    ['MIN_SHELF_LIFE_PCT', '75', 'NUMBER', 'RECEIVING', 'Minimum remaining shelf life at receipt'],
    ['PO_REAPPROVAL_INCREASE_PCT', '5', 'NUMBER', 'PURCHASING', 'Revision increase forcing re-approval'],
    ['PRICE_ALERT_PCT', '10', 'NUMBER', 'PURCHASING', 'Price rise vs last purchase needing justification'],
    ['DEFAULT_VAT_PCT', '7', 'NUMBER', 'TAX', 'Default VAT rate'],
    ['QC_SLA_HOURS', '24', 'NUMBER', 'SLA', 'Standard inspection SLA'],
    ['QC_SLA_HOURS_LAB', '48', 'NUMBER', 'SLA', 'SLA when lab testing is required'],
    ['PR_APPROVAL_SLA_HOURS', '24', 'NUMBER', 'SLA', ''],
    ['PO_APPROVAL_SLA_HOURS', '24', 'NUMBER', 'SLA', ''],
    ['GR_BOOKING_SLA_HOURS', '4', 'NUMBER', 'SLA', 'Arrival to GRN submitted'],
    ['AP_REGISTER_SLA_HOURS', '24', 'NUMBER', 'SLA', ''],
    ['EXCEPTION_SLA_HOURS', '48', 'NUMBER', 'SLA', ''],
    ['PAYMENT_APPROVAL_SLA_HOURS', '48', 'NUMBER', 'SLA', ''],
    ['NO_GRN_ESCALATION_DAYS', '7', 'NUMBER', 'SLA', 'Parked invoice escalation'],
    ['LAB_CHASE_AFTER_DAYS', '1', 'NUMBER', 'SLA', ''],
    ['ALLOW_CONDITIONAL_RELEASE', 'FALSE', 'BOOLEAN', 'QC', 'Release quarantined stock pending lab'],
    ['DUAL_APPROVAL_PAYMENT_THB', '500000', 'NUMBER', 'PAYMENT', 'Two approvers above this amount'],
    ['PAYMENT_HORIZON_DAYS', '7', 'NUMBER', 'PAYMENT', 'Payment proposal look-ahead'],
    ['MAX_UPLOAD_MB', '25', 'NUMBER', 'DOCUMENTS', ''],
    ['ALLOWED_MIME', 'application/pdf,image/jpeg,image/png,image/heic', 'TEXT', 'DOCUMENTS', ''],
    ['RETENTION_DAYS', '2555', 'NUMBER', 'DOCUMENTS', 'Statutory retention (7 years)'],
    ['ARCHIVE_AFTER_DAYS_CLOSED', '30', 'NUMBER', 'HOUSEKEEPING', ''],
    ['BACKUP_RETENTION_DAYS', '30', 'NUMBER', 'HOUSEKEEPING', ''],
    ['ENABLE_STOCK_LEDGER', 'FALSE', 'BOOLEAN', 'INVENTORY', 'Phase 6'],
    ['AUTO_SEND_PO_ON_APPROVAL', 'FALSE', 'BOOLEAN', 'PURCHASING', ''],
    ['MATCH_BATCH_SIZE', '50', 'NUMBER', 'SYSTEM', ''],
    ['NOTIFY_BATCH_SIZE', '40', 'NUMBER', 'SYSTEM', ''],
    ['DIGEST_SEND_HOUR', '8', 'NUMBER', 'SYSTEM', ''],
    ['FX_SOURCE', 'BOT', 'TEXT', 'FX', ''],
    ['FX_CURRENCIES', 'USD,EUR,CNY,JPY', 'TEXT', 'FX', ''],
    ['FX_API_URL', '', 'TEXT', 'FX', 'Leave blank for manual rate entry'],
    ['COMPANY_NAME', '', 'TEXT', 'GENERAL', ''],
    ['QC_GROUP_EMAIL', '', 'TEXT', 'GENERAL', ''],
    ['QC_MGR_EMAIL', '', 'TEXT', 'GENERAL', ''],
    ['WH_GROUP_EMAIL', '', 'TEXT', 'GENERAL', ''],
    ['AP_GROUP_EMAIL', '', 'TEXT', 'GENERAL', ''],
    ['FIN_MGR_EMAIL', '', 'TEXT', 'GENERAL', ''],
    ['PUR_MGR_EMAIL', '', 'TEXT', 'GENERAL', ''],
    ['INVOICE_GMAIL_LABEL', '', 'TEXT', 'GENERAL', 'Gmail label scanned by A15'],
    ['MAIL_FROM_NAME', 'PU-ACC System', 'TEXT', 'GENERAL', '']
  ];
  defaults.forEach(d => {
    if (!Repo.findOne(SHEETS.CONFIG, 'config_key', d[0])) {
      Repo.insert(SHEETS.CONFIG, {
        config_key: d[0], config_value: d[1], data_type: d[2], group: d[3],
        description: d[4], updated_by: 'SETUP', updated_at: Fmt.now()
      });
    }
  });
  Config.invalidate();
}

/** Lookup enumerations from Appendix A §2, plus named ranges for dropdowns. */
function seedReferenceData() {
  const L = {
    PR_STATUS: 'DRAFT,PENDING_APPROVAL,APPROVED,CONVERTED,REJECTED,CANCELLED',
    PO_STATUS: 'DRAFT,PENDING_APPROVAL,APPROVED,REJECTED,SENT_TO_VENDOR,ACKNOWLEDGED,PARTIALLY_RECEIVED,FULLY_RECEIVED,SHORT_CLOSED,INVOICED,ON_HOLD,CLOSED,CANCELLED',
    PO_LINE_STATUS: 'OPEN,PARTIAL,RECEIVED,CLOSED,SHORT_CLOSED,CANCELLED',
    RECEIPT_STATUS: 'NONE,PARTIAL,FULL,OVER',
    GRN_STATUS: 'DRAFT,SUBMITTED,PENDING_QC,QC_IN_PROGRESS,QC_PENDING_LAB,QC_PASSED,QC_CONDITIONAL,QC_FAILED,QUARANTINE,PARTIALLY_POSTED,POSTED,RETURN_TO_VENDOR,CLOSED_RTV,SCRAPPED,REVERSED,CANCELLED',
    GRN_LINE_STATUS: 'PENDING_QC,ACCEPTED,REJECTED,PARTIAL_ACCEPT,ON_HOLD,RETURNED,SCRAPPED',
    QC_STATUS: 'PENDING,ASSIGNED,SAMPLING,TESTING,PENDING_LAB,PENDING_APPROVAL,COMPLETED,CANCELLED',
    QC_RESULT: 'PENDING,PASS,FAIL,CONDITIONAL',
    QC_INSPECTION_TYPE: 'INCOMING,REWORK,RE_INSPECTION,LAB_ONLY,DOC_ONLY',
    QC_FAIL_REASON: 'SENSORY_FAIL,WEIGHT_SHORT,TEMP_ABUSE,MICRO_FAIL,CHEMICAL_FAIL,FOREIGN_MATTER,PACKAGING_DAMAGE,LABEL_INCORRECT,SHELF_LIFE_SHORT,DOC_MISSING,SPEC_DEVIATION,ELECTRICAL_FAIL,DIMENSION_OUT,WRONG_ITEM',
    DEFECT_CLASS: 'CRITICAL,MAJOR,MINOR',
    PARAM_GROUP: 'SENSORY,PHYSICAL,CHEMICAL,MICROBIOLOGICAL,PACKAGING,ELECTRICAL,DOCUMENT',
    NCR_STATUS: 'OPEN,VENDOR_NOTIFIED,VENDOR_RESPONDED,DISPOSITION_APPROVED,REMEDY_IN_PROGRESS,CLOSED,ESCALATED,CANCELLED',
    NCR_DISPOSITION: 'RETURN,REWORK,SCRAP,CONCESSION,PRICE_DEDUCTION,REPLACEMENT,USE_AS_IS',
    NCR_CLAIM_TARGET: 'VENDOR,CARRIER,INTERNAL,INSURANCE',
    CLAIM_TYPE: 'DEBIT_NOTE,CREDIT_NOTE_EXPECTED,REPLACEMENT,NONE',
    INVOICE_TYPE: 'GOODS,DEPOSIT,FREIGHT,DUTY,SERVICE,CREDIT_NOTE,DEBIT_NOTE',
    MATCH_STATUS: 'RECEIVED,MATCHING,MATCHED,EXCEPTION,NO_GRN,QC_HOLD,DISPUTED,CREDIT_NOTE_PENDING,APPROVED_FOR_PAYMENT,SCHEDULED,PAID,REJECTED',
    PAYMENT_STATUS_INV: 'UNPAID,PARTIALLY_PAID,PAID,VOID',
    EXCEPTION_CODE: 'PRICE_OVER,PRICE_UNDER,QTY_OVER,QTY_NO_RECEIPT,QC_REJECTED,DUP_INVOICE,TAX_MISMATCH,FX_MISMATCH,UOM_MISMATCH,PO_CLOSED,NO_PO,DEPOSIT_UNAPPLIED',
    PAYMENT_STATUS: 'DRAFT,PENDING_APPROVAL,APPROVED,SCHEDULED,EXECUTED,PAID,CANCELLED,FAILED',
    PAYMENT_METHOD: 'TT,LOCAL_TRANSFER,CHEQUE,LC,CASH',
    VENDOR_STATUS: 'PROSPECT,APPROVED,CONDITIONAL,SUSPENDED,BLACKLISTED',
    VENDOR_TYPE: 'LOCAL,IMPORT,SERVICE,FORWARDER,LAB',
    INCOTERM: 'EXW,FCA,FOB,CFR,CIF,CPT,CIP,DAP,DPU,DDP',
    UOM: 'KG,G,TON,PCS,BOX,CTN,PALLET,SET,M,M2,L,ROLL,BAG,SERVICE',
    STORAGE_CONDITION: 'AMBIENT,CHILLED,FROZEN,DRY',
    ITEM_GROUP: 'FOOD,SEAFOOD,SOLAR,MECHANICAL,PACKAGING,CONSUMABLE,SERVICE',
    ROLE: 'REQUESTER,BUYER,PUR_MGR,WH_OFFICER,WH_SUP,QC_INSPECTOR,QC_MGR,AP_OFFICER,FIN_MGR,MGMT_VIEW,SYS_ADMIN',
    DOC_TYPE: 'PO_PDF,PO_REV_PDF,VENDOR_QUOTE,PROFORMA_INVOICE,DELIVERY_NOTE,PACKING_LIST,BL_AWB,CO,HEALTH_CERT,COA,MSDS,GRN_PHOTO,GRN_SIGNATURE,QC_REPORT,LAB_REPORT,QC_PHOTO,NCR_REPORT,VENDOR_INVOICE,TAX_INVOICE,CREDIT_NOTE,DEBIT_NOTE,PAYMENT_ADVICE,WHT_CERT,CONTRACT,CERTIFICATE,OTHER',
    APPROVAL_DOC_TYPE: 'PR,PO,PO_REVISION,GRN_OVER_TOL,QC_CONDITIONAL,NCR_DISPOSITION,INVOICE,PAYMENT',
    PERMISSION: 'VIEW,CREATE,EDIT,SUBMIT,APPROVE,POST,REVERSE,EXPORT,ADMIN',
    MODULE: 'PR,PO,GRN,QC,NCR,INVOICE,PAYMENT,MASTER,REPORT'
  };

  const existing = {};
  Repo.readAll(SHEETS.LOOKUPS).forEach(r => { existing[r.lookup_group + '|' + r.code] = true; });

  const rows = [];
  Object.keys(L).forEach(group => {
    L[group].split(',').forEach((code, i) => {
      if (existing[group + '|' + code]) return;
      rows.push({
        lookup_group: group, code: code,
        label_en: code.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()),
        label_th: '', sort_order: i + 1, is_active: 'TRUE', meta_json: '', parent_code: ''
      });
    });
  });
  if (rows.length) Repo.insertMany(SHEETS.LOOKUPS, rows);

  seedRolePermissions();
  createNamedRanges();
  applyValidation();
  return rows.length + ' lookup values added';
}

/** Default permission matrix from docs/03 §7. Tune before go-live. */
function seedRolePermissions() {
  if (Repo.readAll(SHEETS.ROLES).length) return 'Roles already configured — not overwritten';
  const R = [
    // role, module, permissions, scope
    ['REQUESTER', 'PR', 'VIEW,CREATE,EDIT,SUBMIT', 'OWN_RECORD'],
    ['REQUESTER', 'REPORT', 'VIEW', 'OWN_RECORD'],
    ['BUYER', 'PR', 'VIEW,CREATE,EDIT,SUBMIT', 'ALL'],
    ['BUYER', 'PO', 'VIEW,CREATE,EDIT,SUBMIT', 'ALL'],
    ['BUYER', 'GRN', 'VIEW', 'ALL'],
    ['BUYER', 'QC', 'VIEW', 'ALL'],
    ['BUYER', 'NCR', 'VIEW,EDIT', 'ALL'],
    ['BUYER', 'INVOICE', 'VIEW,EDIT', 'ALL'],
    ['BUYER', 'MASTER', 'VIEW,CREATE,EDIT', 'ALL'],
    ['BUYER', 'REPORT', 'VIEW,EXPORT', 'OWN_DEPT'],
    ['PUR_MGR', 'PR', 'VIEW,APPROVE', 'ALL'],
    ['PUR_MGR', 'PO', 'VIEW,APPROVE', 'ALL'],
    ['PUR_MGR', 'NCR', 'VIEW,APPROVE', 'ALL'],
    ['PUR_MGR', 'GRN', 'VIEW', 'ALL'],
    ['PUR_MGR', 'QC', 'VIEW', 'ALL'],
    ['PUR_MGR', 'INVOICE', 'VIEW', 'ALL'],
    ['PUR_MGR', 'MASTER', 'VIEW,APPROVE', 'ALL'],
    ['PUR_MGR', 'REPORT', 'VIEW,EXPORT', 'OWN_DEPT'],
    ['WH_OFFICER', 'GRN', 'VIEW,CREATE,EDIT,SUBMIT', 'OWN_WAREHOUSE'],
    ['WH_OFFICER', 'PO', 'VIEW', 'ALL'],
    ['WH_OFFICER', 'QC', 'VIEW', 'ALL'],
    ['WH_OFFICER', 'REPORT', 'VIEW', 'OWN_WAREHOUSE'],
    ['WH_SUP', 'GRN', 'VIEW,CREATE,EDIT,SUBMIT,APPROVE,POST,REVERSE', 'OWN_WAREHOUSE'],
    ['WH_SUP', 'PO', 'VIEW', 'ALL'],
    ['WH_SUP', 'QC', 'VIEW', 'ALL'],
    ['WH_SUP', 'NCR', 'VIEW,CREATE', 'ALL'],
    ['WH_SUP', 'REPORT', 'VIEW,EXPORT', 'OWN_WAREHOUSE'],
    ['QC_INSPECTOR', 'QC', 'VIEW,CREATE,EDIT,SUBMIT', 'ALL'],
    ['QC_INSPECTOR', 'GRN', 'VIEW', 'ALL'],
    ['QC_INSPECTOR', 'PO', 'VIEW', 'ALL'],
    ['QC_INSPECTOR', 'NCR', 'VIEW,CREATE,EDIT,SUBMIT', 'ALL'],
    ['QC_INSPECTOR', 'REPORT', 'VIEW', 'ALL'],
    ['QC_MGR', 'QC', 'VIEW,CREATE,EDIT,SUBMIT,APPROVE,POST', 'ALL'],
    ['QC_MGR', 'NCR', 'VIEW,CREATE,EDIT,APPROVE,POST', 'ALL'],
    ['QC_MGR', 'GRN', 'VIEW', 'ALL'],
    ['QC_MGR', 'PO', 'VIEW', 'ALL'],
    ['QC_MGR', 'INVOICE', 'VIEW,APPROVE', 'ALL'],
    ['QC_MGR', 'MASTER', 'VIEW,EDIT', 'ALL'],
    ['QC_MGR', 'REPORT', 'VIEW,EXPORT', 'ALL'],
    ['AP_OFFICER', 'INVOICE', 'VIEW,CREATE,EDIT,SUBMIT', 'ALL'],
    ['AP_OFFICER', 'PAYMENT', 'VIEW,CREATE,SUBMIT', 'ALL'],
    ['AP_OFFICER', 'PO', 'VIEW', 'ALL'],
    ['AP_OFFICER', 'GRN', 'VIEW', 'ALL'],
    ['AP_OFFICER', 'QC', 'VIEW', 'ALL'],
    ['AP_OFFICER', 'NCR', 'VIEW', 'ALL'],
    ['AP_OFFICER', 'MASTER', 'VIEW,EDIT', 'ALL'],
    ['AP_OFFICER', 'REPORT', 'VIEW,EXPORT', 'ALL'],
    ['FIN_MGR', 'INVOICE', 'VIEW,APPROVE', 'ALL'],
    ['FIN_MGR', 'PAYMENT', 'VIEW,APPROVE', 'ALL'],
    ['FIN_MGR', 'PO', 'VIEW,APPROVE', 'ALL'],
    ['FIN_MGR', 'GRN', 'VIEW', 'ALL'],
    ['FIN_MGR', 'QC', 'VIEW', 'ALL'],
    ['FIN_MGR', 'NCR', 'VIEW,APPROVE', 'ALL'],
    ['FIN_MGR', 'MASTER', 'VIEW,APPROVE', 'ALL'],
    ['FIN_MGR', 'REPORT', 'VIEW,EXPORT', 'ALL'],
    ['MGMT_VIEW', 'PR', 'VIEW', 'ALL'], ['MGMT_VIEW', 'PO', 'VIEW', 'ALL'],
    ['MGMT_VIEW', 'GRN', 'VIEW', 'ALL'], ['MGMT_VIEW', 'QC', 'VIEW', 'ALL'],
    ['MGMT_VIEW', 'NCR', 'VIEW', 'ALL'], ['MGMT_VIEW', 'INVOICE', 'VIEW', 'ALL'],
    ['MGMT_VIEW', 'PAYMENT', 'VIEW', 'ALL'], ['MGMT_VIEW', 'REPORT', 'VIEW,EXPORT', 'ALL'],
    ['SYS_ADMIN', 'PR', 'ADMIN,VIEW,CREATE,EDIT', 'ALL'],
    ['SYS_ADMIN', 'PO', 'ADMIN,VIEW,CREATE,EDIT', 'ALL'],
    ['SYS_ADMIN', 'GRN', 'ADMIN,VIEW,CREATE,EDIT', 'ALL'],
    ['SYS_ADMIN', 'QC', 'ADMIN,VIEW,CREATE,EDIT', 'ALL'],
    ['SYS_ADMIN', 'NCR', 'ADMIN,VIEW,CREATE,EDIT', 'ALL'],
    ['SYS_ADMIN', 'INVOICE', 'ADMIN,VIEW,CREATE,EDIT', 'ALL'],
    ['SYS_ADMIN', 'PAYMENT', 'ADMIN,VIEW', 'ALL'],
    ['SYS_ADMIN', 'MASTER', 'ADMIN,VIEW,CREATE,EDIT', 'ALL'],
    ['SYS_ADMIN', 'REPORT', 'ADMIN,VIEW,EXPORT', 'ALL']
  ];
  const names = {
    REQUESTER: 'Requester', BUYER: 'Purchasing Officer', PUR_MGR: 'Purchasing Manager',
    WH_OFFICER: 'Warehouse Officer', WH_SUP: 'Warehouse Supervisor',
    QC_INSPECTOR: 'QC Inspector', QC_MGR: 'QC Manager', AP_OFFICER: 'AP Officer',
    FIN_MGR: 'Finance Manager', MGMT_VIEW: 'Management (read-only)', SYS_ADMIN: 'System Administrator'
  };
  Repo.insertMany(SHEETS.ROLES, R.map(r => ({
    role_code: r[0], role_name: names[r[0]] || r[0], module: r[1], permission: r[2],
    scope: r[3],
    // warehouse and QC never see money — enforced again server-side in Redact
    field_restrictions: ['WH_OFFICER', 'WH_SUP', 'QC_INSPECTOR'].indexOf(r[0]) >= 0
      ? 'unit_price,line_amount,total_amount,subtotal_amount' : '',
    is_active: 'TRUE', notes: ''
  })));
  return R.length + ' permission rows seeded';
}

/** Named ranges on Lookups so Sheets dropdowns and the client share one source. */
function createNamedRanges() {
  const ss = SpreadsheetApp.openById(Props.require('SPREADSHEET_ID'));
  const sh = ss.getSheetByName(SHEETS.LOOKUPS);
  const rows = Repo.readAll(SHEETS.LOOKUPS);
  const groups = {};
  rows.forEach(r => { (groups[r.lookup_group] = groups[r.lookup_group] || []).push(r.__row); });

  ss.getNamedRanges().filter(nr => nr.getName().indexOf('LK_') === 0)
    .forEach(nr => nr.remove());

  Object.keys(groups).forEach(g => {
    const rowsOf = groups[g].sort((a, b) => a - b);
    // named ranges need contiguity; the seed writes each group contiguously
    const first = rowsOf[0], last = rowsOf[rowsOf.length - 1];
    if (last - first + 1 !== rowsOf.length) return;
    ss.setNamedRange('LK_' + g, sh.getRange(first, 2, rowsOf.length, 1));
  });
  return Object.keys(groups).length + ' named ranges';
}

/** Dropdown validation on status and enum columns. Belt to the API's braces. */
function applyValidation() {
  const ss = SpreadsheetApp.openById(Props.require('SPREADSHEET_ID'));
  const bind = [
    [SHEETS.PO_HEADER, 'status', 'PO_STATUS'],
    [SHEETS.PO_HEADER, 'receipt_status', 'RECEIPT_STATUS'],
    [SHEETS.PO_HEADER, 'incoterm', 'INCOTERM'],
    [SHEETS.PO_LINES, 'line_status', 'PO_LINE_STATUS'],
    [SHEETS.PO_LINES, 'uom', 'UOM'],
    [SHEETS.GRN_HEADER, 'status', 'GRN_STATUS'],
    [SHEETS.GRN_LINES, 'line_status', 'GRN_LINE_STATUS'],
    [SHEETS.GRN_LINES, 'uom', 'UOM'],
    [SHEETS.QC_HEADER, 'status', 'QC_STATUS'],
    [SHEETS.QC_HEADER, 'result', 'QC_RESULT'],
    [SHEETS.QC_HEADER, 'inspection_type', 'QC_INSPECTION_TYPE'],
    [SHEETS.QC_LINES, 'result', 'QC_RESULT'],
    [SHEETS.QC_LINES, 'defect_class', 'DEFECT_CLASS'],
    [SHEETS.QC_SPEC_PARAMS, 'param_group', 'PARAM_GROUP'],
    [SHEETS.QC_SPEC_PARAMS, 'defect_class', 'DEFECT_CLASS'],
    [SHEETS.NCR, 'status', 'NCR_STATUS'],
    [SHEETS.NCR, 'disposition', 'NCR_DISPOSITION'],
    [SHEETS.NCR, 'claim_target', 'NCR_CLAIM_TARGET'],
    [SHEETS.NCR, 'claim_type', 'CLAIM_TYPE'],
    [SHEETS.NCR, 'severity', 'DEFECT_CLASS'],
    [SHEETS.INV_HEADER, 'match_status', 'MATCH_STATUS'],
    [SHEETS.INV_HEADER, 'invoice_type', 'INVOICE_TYPE'],
    [SHEETS.INV_HEADER, 'payment_status', 'PAYMENT_STATUS_INV'],
    [SHEETS.PAYMENTS, 'status', 'PAYMENT_STATUS'],
    [SHEETS.PAYMENTS, 'payment_method', 'PAYMENT_METHOD'],
    [SHEETS.VENDORS, 'approved_status', 'VENDOR_STATUS'],
    [SHEETS.VENDORS, 'vendor_type', 'VENDOR_TYPE'],
    [SHEETS.ITEMS, 'item_group', 'ITEM_GROUP'],
    [SHEETS.ITEMS, 'storage_condition', 'STORAGE_CONDITION'],
    [SHEETS.DOCUMENTS, 'doc_type', 'DOC_TYPE'],
    [SHEETS.APPROVAL_MATRIX, 'doc_type', 'APPROVAL_DOC_TYPE'],
    [SHEETS.APPROVAL_MATRIX, 'approver_role', 'ROLE'],
    [SHEETS.ROLES, 'module', 'MODULE']
  ];

  let applied = 0;
  bind.forEach(b => {
    const sh = ss.getSheetByName(b[0]);
    if (!sh) return;
    const col = schemaCols(b[0]).indexOf(b[1]) + 1;
    if (!col) return;
    let range;
    try { range = ss.getRangeByName('LK_' + b[2]); } catch (e) { return; }
    if (!range) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(range, true).setAllowInvalid(false)
      .setHelpText('Choose a value from ' + b[2]).build();
    sh.getRange(2, col, Math.max(1, sh.getMaxRows() - 1), 1).setDataValidation(rule);
    applied++;
  });
  return applied + ' validation rules applied';
}

/* --------------------------------------------------------------- admin menu */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PU-ACC Admin')
    .addItem('1. Setup workspace', 'setupWorkspace')
    .addItem('2. Seed reference data', 'seedReferenceData')
    .addItem('3. Install triggers', 'installTriggers')
    .addSeparator()
    .addItem('Run 3-way match now', 'menuRunMatch_')
    .addItem('Rebuild dashboards', 'menuRebuildViews_')
    .addItem('Run integrity check', 'menuIntegrity_')
    .addItem('Backup now', 'menuBackup_')
    .addSeparator()
    .addItem('Load demo data (DEV only)', 'seedDemoData')
    .addItem('Run unit tests', 'runUnitTests')
    .addToUi();
}

function menuRunMatch_() { _toast(JSON.stringify(Match.runPending().length) + ' invoice(s) processed'); }
function menuRebuildViews_() { Views.rebuildAll(); _toast('Dashboards rebuilt'); }
function menuIntegrity_() { _toast(Integrity.run().length + ' finding(s) — see Error_Log'); }
function menuBackup_() { Housekeeping.backup(); _toast('Backup created'); }
function _toast(msg) { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'PU-ACC', 8); }

/* ----------------------------------------------------------- test fixtures */

/**
 * DEV-only fixture covering the six regression scenarios in apps-script/README.md §5.
 * Refuses to run when ENV=PROD, because a demo PO in a live ledger is a real problem.
 */
function seedDemoData() {
  if (Props.get('ENV', 'PROD') === 'PROD') {
    throw new AppError('PROD_GUARD', 'Demo data cannot be loaded in PROD. Set ENV=DEV first.');
  }
  const admin = Props.require('ADMIN_EMAIL');

  if (!Repo.findOne(SHEETS.USERS, 'email', admin)) {
    Repo.insert(SHEETS.USERS, {
      user_id: Utilities.getUuid(), email: admin, full_name: 'Demo Admin',
      department: 'IT', role_codes: 'SYS_ADMIN,BUYER,PUR_MGR,WH_SUP,QC_MGR,AP_OFFICER,FIN_MGR',
      approval_limit_thb: 10000000, is_active: 'TRUE', digest_optin: 'FALSE'
    });
  }
  if (!Repo.findOne(SHEETS.VENDORS, 'vendor_code', 'V-DEMO-01')) {
    Repo.insert(SHEETS.VENDORS, {
      vendor_code: 'V-DEMO-01', vendor_name_en: 'Demo Frozen Foods Co Ltd',
      vendor_type: 'LOCAL', country: 'TH', contact_email: admin, contact_name: 'Demo Contact',
      default_currency: 'THB', payment_term_code: 'NET30', lead_time_days: 14,
      approved_status: 'APPROVED', is_active: 'TRUE', qc_required_default: 'TRUE'
    });
  }
  if (!Repo.findOne(SHEETS.PAYMENT_TERMS, 'term_code', 'NET30')) {
    Repo.insert(SHEETS.PAYMENT_TERMS, {
      term_code: 'NET30', description: 'Net 30 days from invoice date',
      base_event: 'INVOICE_DATE', net_days: 30, deposit_pct: 0, is_active: 'TRUE'
    });
  }
  if (!Repo.findOne(SHEETS.TAX_CODES, 'tax_code', 'VAT7')) {
    Repo.insert(SHEETS.TAX_CODES, {
      tax_code: 'VAT7', description: 'VAT 7%', vat_rate_pct: 7, wht_rate_pct: 0,
      is_reverse_charge: 'FALSE', is_active: 'TRUE'
    });
  }

  let spec = Repo.findOne(SHEETS.QC_SPECS, 'qc_spec_id', 'SPEC-DEMO-SHRIMP-V1');
  if (!spec) {
    spec = Repo.insert(SHEETS.QC_SPECS, {
      qc_spec_id: 'SPEC-DEMO-SHRIMP-V1', item_code: 'IT-DEMO-SHRIMP', spec_version: 1,
      effective_from: Fmt.today(), inspection_type: 'AQL_SAMPLING', aql_level: '2.5',
      critical_aql: 0, major_aql: 5, minor_aql: 7,
      doc_requirements: 'COA,HEALTH_CERT,PACKING_LIST',
      lab_required: 'FALSE', lab_turnaround_days: 5, is_current: 'TRUE'
    });
    Repo.insertMany(SHEETS.QC_SPEC_PARAMS, [
      { qc_spec_id: spec.qc_spec_id, seq: 1, param_group: 'SENSORY', param_name: 'Appearance',
        test_method: 'Visual', spec_text: 'No discoloration', is_critical: 'FALSE',
        defect_class: 'MAJOR', is_mandatory: 'TRUE', requires_photo: 'TRUE', is_active: 'TRUE' },
      { qc_spec_id: spec.qc_spec_id, seq: 2, param_group: 'PHYSICAL', param_name: 'Core temperature',
        test_method: 'Probe', unit: 'C', spec_max: -18, is_critical: 'TRUE',
        defect_class: 'CRITICAL', is_mandatory: 'TRUE', is_active: 'TRUE' },
      { qc_spec_id: spec.qc_spec_id, seq: 3, param_group: 'PHYSICAL', param_name: 'Net weight per pack',
        test_method: 'Scale', unit: 'kg', spec_min: 0.98, spec_max: 1.02, is_critical: 'FALSE',
        defect_class: 'MAJOR', is_mandatory: 'TRUE', is_active: 'TRUE' },
      { qc_spec_id: spec.qc_spec_id, seq: 4, param_group: 'PHYSICAL', param_name: 'Glazing',
        test_method: 'Gravimetric', unit: '%', spec_max: 15, is_critical: 'FALSE',
        defect_class: 'MINOR', is_mandatory: 'FALSE', is_active: 'TRUE' }
    ]);
  }
  if (!Repo.findOne(SHEETS.ITEMS, 'item_code', 'IT-DEMO-SHRIMP')) {
    Repo.insert(SHEETS.ITEMS, {
      item_code: 'IT-DEMO-SHRIMP', item_name_en: 'Frozen Shrimp 16/20', item_group: 'SEAFOOD',
      uom_base: 'KG', uom_purchase: 'KG', uom_conversion_factor: 1, is_food: 'TRUE',
      lot_tracked: 'TRUE', shelf_life_days: 730, min_remaining_shelf_life_pct: 75,
      storage_condition: 'FROZEN', storage_temp_max_c: -18, qc_required: 'TRUE',
      qc_spec_id: 'SPEC-DEMO-SHRIMP-V1', over_receipt_tolerance_pct: 2,
      standard_cost: 260, tax_code: 'VAT7', is_active: 'TRUE'
    });
  }
  if (!Repo.readAll(SHEETS.APPROVAL_MATRIX).length) {
    Repo.insertMany(SHEETS.APPROVAL_MATRIX, [
      { rule_id: 'AM-PO-1', doc_type: 'PO', amount_from_thb: 0, amount_to_thb: 50000, level: 1,
        approver_role: 'PUR_MGR', resolve_by: 'ROLE', sla_hours: 24, is_active: 'TRUE' },
      { rule_id: 'AM-PO-2', doc_type: 'PO', amount_from_thb: 50001, amount_to_thb: 500000, level: 1,
        approver_role: 'PUR_MGR', resolve_by: 'ROLE', sla_hours: 24, is_active: 'TRUE' },
      { rule_id: 'AM-PO-3', doc_type: 'PO', amount_from_thb: 50001, amount_to_thb: 500000, level: 2,
        approver_role: 'FIN_MGR', resolve_by: 'ROLE', sla_hours: 24, is_active: 'TRUE' },
      { rule_id: 'AM-INV-1', doc_type: 'INVOICE', amount_from_thb: 0, amount_to_thb: 500000, level: 1,
        approver_role: 'FIN_MGR', resolve_by: 'ROLE', sla_hours: 48, is_active: 'TRUE' }
    ]);
  }

  const po = PoService.save(
    { vendor_code: 'V-DEMO-01', currency: 'THB', fx_rate: 1, warehouse_id: 'WH-01',
      payment_term_code: 'NET30', requested_delivery_date: Fmt.date(Fmt.addDays(Fmt.now(), 14)),
      promised_delivery_date: Fmt.date(Fmt.addDays(Fmt.now(), 14)), department: 'PURCHASING' },
    [{ item_code: 'IT-DEMO-SHRIMP', description: 'Frozen Shrimp 16/20',
       qty_ordered: 500, uom: 'KG', unit_price: 260, tax_code: 'VAT7' }]);

  return 'Demo data loaded. PO created: ' + po.po_no +
         ' — submit, approve, send, then receive it to walk the full flow.';
}

/** Pure-function unit tests. No spreadsheet access, so they are fast and safe. */
function runUnitTests() {
  const results = [];
  const eq = (name, actual, expected) => results.push({
    name: name, pass: String(actual) === String(expected), actual: actual, expected: expected
  });

  eq('AQL sample size, lot 480', Workflow.aqlSampleSize(480), 50);
  eq('AQL sample size, lot 8', Workflow.aqlSampleSize(8), 2);
  eq('AQL sample size, huge lot', Workflow.aqlSampleSize(999999), 1250);

  eq('amountInWords integer', DocGen.amountInWords(1250, 'THB'),
     'ONE THOUSAND TWO HUNDRED FIFTY BAHT ONLY');
  eq('amountInWords with satang', DocGen.amountInWords(1250.5, 'THB'),
     'ONE THOUSAND TWO HUNDRED FIFTY BAHT AND FIFTY SATANG');

  eq('duplicate hash is normalised',
     Match.duplicateHash('V1', 'inv-2026/001', 100),
     Match.duplicateHash('v1', 'INV2026001', 100.00));
  eq('duplicate hash differs on amount',
     Match.duplicateHash('V1', 'INV001', 100) === Match.duplicateHash('V1', 'INV001', 101), false);

  eq('formula injection guarded', sanitizeCell_('=1+1'), "'=1+1");
  eq('plain text untouched', sanitizeCell_('hello'), 'hello');

  eq('hoursBetween', Fmt.hoursBetween('2026-07-30T00:00:00+07:00', '2026-07-30T06:00:00+07:00'), 6);
  eq('Num.round', Num.round(2.005, 2), 2.01);

  eq('redaction removes bank details',
     JSON.stringify(JSON.parse(Json.safe({ bank_account_no: '123', ok: 1 }))),
     JSON.stringify({ bank_account_no: '***REDACTED***', ok: 1 }));

  const failed = results.filter(r => !r.pass);
  Logger.log(results.map(r =>
    (r.pass ? 'PASS  ' : 'FAIL  ') + r.name +
    (r.pass ? '' : ' — got ' + r.actual + ', expected ' + r.expected)).join('\n'));
  return failed.length ? failed.length + ' test(s) FAILED — see the log' : results.length + ' tests passed';
}

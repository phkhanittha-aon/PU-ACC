/**
 * MGS Traceability & Recall — 00_Config.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * แหล่งความจริงเดียวของ: ค่าคอนฟิก · โครงตาราง (schema) · enum · สิทธิ์
 *
 * หลักการที่ห้ามละเมิด
 *   1. SAP Business One เป็น system of record — แอปนี้ "อ่านอย่างเดียว" ไม่เขียนกลับ
 *   2. ตาราง SAP_* ถูกทับทั้งชุดทุกรอบ sync — ห้ามเก็บข้อมูลที่คนกรอกไว้ในนั้น
 *   3. ตารางที่คนกรอก (Recall_*, Mock_*, Holds, Trace_Notes) ระบบ sync ไม่แตะ
 *   4. header แถวแรกคือสัญญา — โค้ดอ้างชื่อคอลัมน์เสมอ ไม่อ้างเลขคอลัมน์
 */

/** bump ทุกครั้งที่ deploy — แสดงที่ footer ของแอป ใช้ตอนผู้ใช้แจ้งปัญหา */
var APP_VERSION = '2026.08.22-1';

var CFG = {
  /** ID ของ Spreadsheet ฐานข้อมูล (ตั้งครั้งเดียวตอน setup — ดู 08_Setup.gs) */
  SS_ID: PropertiesService.getScriptProperties().getProperty('SS_ID') || '',

  /** โฟลเดอร์ Drive เก็บหลักฐาน (รูป ใบเคลม supplier notice) */
  DRIVE_ROOT_ID: PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_ID') || '',

  TZ: 'Asia/Bangkok',

  /** โดเมนบริษัท — กันคนนอกโดเมนหลุดเข้ามาแม้ deployment ตั้งผิด */
  ALLOWED_DOMAIN: 'mgs.co.th',

  LARK: {
    HOST: 'https://open.larksuite.com',      // tenant สากล; ถ้าใช้ Feishu จีนเปลี่ยนเป็น open.feishu.cn
    ENABLED: true
  },

  /** เวลาที่ยอมให้ mock recall ใช้ (นาที) — เกินนี้ถือว่าไม่ผ่าน */
  MOCK_RECALL_TARGET_MIN: 120,

  /** ความคลาดเคลื่อนจำนวนที่ยอมรับได้ตอนกระทบยอด (ชิ้น) — เกินนี้ต้องมีคำอธิบาย */
  RECONCILE_TOLERANCE_QTY: 0,

  /** ถือว่า sync ค้างเมื่อไม่มีข้อมูลใหม่เกินกี่นาที */
  SYNC_STALE_MIN: 90,

  /** จำนวนแถวสูงสุดที่ยอมให้ ingest ต่อ 1 คำขอ — กัน payload บวม */
  MAX_INGEST_ROWS: 5000
};

/* ══════════════════════════════════════════════════════════════════════════
   1. รายชื่อแท็บ
   ══════════════════════════════════════════════════════════════════════════ */
var TAB = {
  // ── กลุ่ม A: กระจกเงาของ SAP B1 (sync ทับทั้งชุด ระบบไม่แก้) ──
  ITEMS:      'SAP_Items',
  BP:         'SAP_BP',
  WHS:        'SAP_Warehouses',
  PO:         'SAP_PO_Lines',
  GRPO:       'SAP_GRPO_Lines',
  DELIVERY:   'SAP_Delivery_Lines',
  INVOICE:    'SAP_Invoice_Lines',
  RETURN:     'SAP_Return_Lines',
  LOTS:       'SAP_Lots',
  MOVES:      'SAP_Lot_Moves',
  STOCK:      'SAP_Lot_Stock',

  // ── กลุ่ม B: ข้อมูลที่ MGS เป็นเจ้าของ (แอปเขียน sync ไม่แตะ) ──
  TRACE_NOTES: 'Trace_Notes',
  CASES:       'Recall_Cases',
  SCOPE:       'Recall_Scope',
  TRACKING:    'Recall_Tracking',
  ACTIONS:     'Recall_Actions',
  HOLDS:       'Holds',
  MOCK:        'Mock_Recalls',
  MOCK_LINES:  'Mock_Recall_Lines',

  // ── กลุ่ม C: ระบบ ──
  USERS:    'Users',
  AUDIT:    'Audit_Log',
  SYNC_LOG: 'Sync_Log',
  SETTINGS: 'Settings'
};

/** แท็บที่รอบ sync มีสิทธิ์ทับได้ — ใช้เป็น allowlist ตอน ingest */
var SAP_TABS = [TAB.ITEMS, TAB.BP, TAB.WHS, TAB.PO, TAB.GRPO, TAB.DELIVERY,
                TAB.INVOICE, TAB.RETURN, TAB.LOTS, TAB.MOVES, TAB.STOCK];

/* ══════════════════════════════════════════════════════════════════════════
   2. โครงตาราง — header แถวแรกของแต่ละแท็บ
   ชื่อคอลัมน์ตั้งตามชื่อฟิลด์จริงของ B1 ตรงไหนตรงได้ เพื่อให้คนเขียน query
   ฝั่งออฟฟิศ map ได้โดยไม่ต้องเปิดเอกสาร
   ══════════════════════════════════════════════════════════════════════════ */
var SCHEMA = {};

/* ── A. กระจกเงา SAP ─────────────────────────────────────────────────────── */

// OITM
SCHEMA[TAB.ITEMS] = ['item_code', 'item_name', 'item_group', 'brand', 'product_type',
  'mng_method', 'uom', 'is_active', 'synced_at'];

// OCRD
SCHEMA[TAB.BP] = ['card_code', 'card_name', 'card_type', 'phone', 'email', 'contact_person',
  'is_active', 'synced_at'];

// OWHS
SCHEMA[TAB.WHS] = ['whs_code', 'whs_name', 'location_type', 'is_active', 'synced_at'];

// OPOR / POR1
SCHEMA[TAB.PO] = ['doc_entry', 'line_num', 'doc_num', 'doc_date', 'card_code', 'card_name',
  'item_code', 'dscription', 'quantity', 'open_qty', 'whs_code', 'num_at_card',
  'doc_status', 'project', 'synced_at'];

// OPDN / PDN1  (ใบรับสินค้า — ปลายทางของ backward trace)
SCHEMA[TAB.GRPO] = ['doc_entry', 'line_num', 'doc_num', 'doc_date', 'card_code', 'card_name',
  'item_code', 'dscription', 'quantity', 'whs_code', 'num_at_card',
  'base_entry', 'base_line', 'base_doc_num', 'project', 'synced_at'];

// ODLN / DLN1  (ใบส่งของ — ต้นทางของ forward trace)
SCHEMA[TAB.DELIVERY] = ['doc_entry', 'line_num', 'doc_num', 'doc_date', 'card_code', 'card_name',
  'item_code', 'dscription', 'quantity', 'whs_code', 'ship_to_code', 'address',
  'project', 'synced_at'];

// OINV / INV1
SCHEMA[TAB.INVOICE] = ['doc_entry', 'line_num', 'doc_num', 'doc_date', 'card_code', 'card_name',
  'item_code', 'quantity', 'base_entry', 'base_line', 'base_doc_num', 'project', 'synced_at'];

// ORDN/RDN1 (รับคืนจากลูกค้า) + ORPD/RPD1 (คืนผู้ขาย) — คอลัมน์ return_type แยกทิศ
SCHEMA[TAB.RETURN] = ['return_type', 'doc_entry', 'line_num', 'doc_num', 'doc_date',
  'card_code', 'card_name', 'item_code', 'quantity', 'whs_code',
  'base_entry', 'base_line', 'base_doc_num', 'reason', 'synced_at'];

// OBTN (batch) + OSRN (serial) รวมเป็นตารางเดียว — kind แยกชนิด
SCHEMA[TAB.LOTS] = ['lot_key', 'item_code', 'dist_number', 'kind', 'sys_number',
  'mnf_serial', 'supplier_lot', 'in_date', 'exp_date', 'notes', 'synced_at'];

// OITL + ITL1 (+ OBTL/OSRL) — กระดูกสันหลังของระบบทั้งหมด
SCHEMA[TAB.MOVES] = ['move_id', 'lot_key', 'item_code', 'dist_number', 'kind',
  'obj_type', 'doc_entry', 'doc_num', 'line_num', 'doc_date',
  'direction', 'quantity', 'whs_code', 'card_code', 'card_name',
  'project', 'synced_at'];

// OIBT (batch on-hand) + OSRI (serial on-hand)
SCHEMA[TAB.STOCK] = ['lot_key', 'item_code', 'dist_number', 'whs_code', 'quantity',
  'status', 'synced_at'];

/* ── B. ข้อมูลของ MGS ────────────────────────────────────────────────────── */

// หมายเหตุที่ QC ผูกกับ lot/SN — แยกจาก SAP_* เพื่อไม่ให้ sync ทับหาย
SCHEMA[TAB.TRACE_NOTES] = ['note_id', 'lot_key', 'item_code', 'dist_number',
  'mgs_receiving_lot', 'qc_status', 'note', 'evidence_file_ids',
  'created_by', 'created_at', 'updated_by', 'updated_at'];

// FM-QC-RC-01 ส่วนหัว + การประเมินความเสี่ยง + การตัดสินใจ
SCHEMA[TAB.CASES] = ['case_id', 'case_no', 'status', 'opened_at', 'opened_by', 'case_owner',
  'source', 'source_ref', 'product_type', 'brand', 'item_code', 'model',
  'problem', 'risk_class', 'immediate_action', 'escalated', 'escalated_at',
  'recall_required', 'field_action', 'customer_notify_required', 'supplier_claim_required',
  'qty_affected', 'qty_in_stock', 'qty_delivered', 'qty_unaccounted',
  'qty_returned', 'qty_replaced', 'qty_corrected', 'effectiveness_pct',
  'closed_at', 'closed_by', 'closure_note',
  'drive_folder_id', 'created_at', 'updated_by', 'updated_at', 'row_version'];

// ขอบเขตของเคส — 1 แถว = 1 lot หรือ 1 ช่วง SN ที่กระทบ
SCHEMA[TAB.SCOPE] = ['scope_id', 'case_no', 'item_code', 'kind', 'dist_number',
  'sn_from', 'sn_to', 'lot_key', 'qty_affected', 'added_by', 'added_at', 'note'];

// FM-QC-RC-02 — 1 แถว = 1 ปลายทาง (ลูกค้า/โครงการ/คลัง)
SCHEMA[TAB.TRACKING] = ['track_id', 'case_no', 'item_code', 'model', 'lot_key', 'dist_number',
  'sn_display', 'location_type', 'party_code', 'party_name', 'project',
  'doc_type', 'doc_num', 'doc_date', 'qty_affected',
  'contacted_at', 'contacted_by', 'required_action',
  'qty_returned', 'qty_replaced', 'qty_corrected', 'qty_pending',
  'status', 'evidence_file_ids', 'remark',
  'created_at', 'updated_by', 'updated_at', 'row_version'];

// การสอบสวน/CAPA + การตัดสินใจ — section_type แยกสองส่วนของฟอร์ม RC-01
SCHEMA[TAB.ACTIONS] = ['action_id', 'case_no', 'section_type', 'section', 'seq', 'details',
  'responsible', 'target_date', 'status', 'evidence_file_ids',
  'approved_by', 'approved_at', 'remark',
  'created_at', 'updated_by', 'updated_at', 'row_version'];

// การกักสินค้า — สร้างอัตโนมัติเมื่อเปิดเคส ปลดได้เฉพาะผู้มีสิทธิ์
SCHEMA[TAB.HOLDS] = ['hold_id', 'case_no', 'lot_key', 'item_code', 'dist_number', 'whs_code',
  'qty_hold', 'status', 'placed_by', 'placed_at',
  'released_by', 'released_at', 'release_reason', 'row_version'];

// FM-QC-TR-02 ส่วนหัว + ผลรวม
SCHEMA[TAB.MOCK] = ['test_id', 'test_no', 'test_date', 'conducted_by', 'reviewed_by',
  'item_code', 'model', 'lot_key', 'dist_number', 'test_type',
  'started_at', 'ended_at', 'duration_min', 'target_min',
  'qty_affected', 'qty_located', 'completion_pct', 'reconcile_pct',
  'result', 'gap_found', 'root_cause', 'corrective_action', 'capa_owner',
  'capa_due', 'capa_status', 'verified_by', 'verified_at', 'note',
  'created_at', 'updated_by', 'updated_at', 'row_version'];

// บรรทัดของ mock recall — ทั้ง backward และ forward
SCHEMA[TAB.MOCK_LINES] = ['line_id', 'test_no', 'leg', 'seq', 'party_or_location',
  'doc_type', 'doc_num', 'doc_date', 'project',
  'qty_expected', 'qty_located', 'result', 'evidence', 'remark'];

/* ── C. ระบบ ─────────────────────────────────────────────────────────────── */
SCHEMA[TAB.USERS] = ['email', 'full_name', 'dept', 'role', 'lark_user_id', 'is_active', 'note'];

SCHEMA[TAB.AUDIT] = ['at_ts', 'actor_email', 'action', 'entity', 'entity_id',
  'before_json', 'after_json', 'app_version', 'request_id'];

SCHEMA[TAB.SYNC_LOG] = ['at_ts', 'source', 'tab', 'rows_in', 'rows_written', 'status',
  'duration_ms', 'message', 'batch_id'];

SCHEMA[TAB.SETTINGS] = ['key', 'value', 'note'];

/* ══════════════════════════════════════════════════════════════════════════
   3. Enum — เขียนเป็น whitelist เพื่อให้ validate ฝั่งเซิร์ฟเวอร์ได้
   ══════════════════════════════════════════════════════════════════════════ */

/** ชนิดการจัดการสินค้าใน B1 */
var MNG = { SERIAL: 'SERIAL', BATCH: 'BATCH', NONE: 'NONE' };

/** ObjType ของ B1 -> ทิศทางสต๊อกและชื่อเอกสารที่คนอ่านรู้เรื่อง */
var OBJ = {
  '22': { name: 'ใบสั่งซื้อ (PO)',       dir: 'NONE', doc: 'PO' },
  '20': { name: 'ใบรับสินค้า (GRPO)',    dir: 'IN',   doc: 'GRPO' },
  '21': { name: 'ใบคืนผู้ขาย',           dir: 'OUT',  doc: 'GOODS_RETURN' },
  '15': { name: 'ใบส่งของ (DO)',         dir: 'OUT',  doc: 'DELIVERY' },
  '16': { name: 'ใบรับคืนจากลูกค้า',     dir: 'IN',   doc: 'RETURN' },
  '13': { name: 'ใบกำกับภาษีขาย',        dir: 'OUT',  doc: 'AR_INVOICE' },
  '14': { name: 'ใบลดหนี้ขาย',           dir: 'IN',   doc: 'AR_CREDIT' },
  '18': { name: 'ใบกำกับภาษีซื้อ',       dir: 'IN',   doc: 'AP_INVOICE' },
  '19': { name: 'ใบลดหนี้ซื้อ',          dir: 'OUT',  doc: 'AP_CREDIT' },
  '59': { name: 'รับเข้าอื่น ๆ',          dir: 'IN',   doc: 'GOODS_RECEIPT' },
  '60': { name: 'ตัดออกอื่น ๆ',           dir: 'OUT',  doc: 'GOODS_ISSUE' },
  '67': { name: 'โอนย้ายคลัง',           dir: 'BOTH', doc: 'TRANSFER' },
  '69': { name: 'ปรับปรุงต้นทุน',         dir: 'NONE', doc: 'LANDED_COST' },
  '10000071': { name: 'นับสต๊อก',         dir: 'BOTH', doc: 'STOCK_COUNT' }
};

/** เอกสารที่ถือว่า "ของออกไปหาลูกค้า" — ใช้เป็นเกณฑ์ forward trace */
var OUTBOUND_TO_CUSTOMER = ['15', '13'];

/** สถานะเคสเรียกคืน — forward-only ยกเว้นยกเลิก */
var CASE_STATUS = {
  DRAFT:      { th: 'ร่าง',           next: ['OPEN', 'CANCELLED'] },
  OPEN:       { th: 'เปิดเคส',        next: ['CONTAINED', 'CANCELLED'] },
  CONTAINED:  { th: 'กักของแล้ว',     next: ['TRACKING', 'CANCELLED'] },
  TRACKING:   { th: 'กำลังติดตาม',    next: ['VERIFYING'] },
  VERIFYING:  { th: 'ตรวจประสิทธิผล', next: ['CLOSED', 'TRACKING'] },
  CLOSED:     { th: 'ปิดเคส',         next: [] },
  CANCELLED:  { th: 'ยกเลิก',         next: [] }
};

/** สถานะแถวติดตาม */
var TRACK_STATUS = {
  PENDING:     'ยังไม่ติดต่อ',
  CONTACTED:   'ติดต่อแล้ว',
  IN_PROGRESS: 'กำลังดำเนินการ',
  COMPLETED:   'เสร็จสิ้น',
  NOT_REACHED: 'ติดต่อไม่ได้'
};

/** การกระทำที่ต้องทำกับของที่กระทบ */
var REQUIRED_ACTION = {
  HOLD:            'กักไว้ ห้ามจ่ายออก',
  RETURN:          'เรียกคืน',
  REPLACE:         'เปลี่ยนของใหม่',
  INSPECT_CORRECT: 'ตรวจ/แก้ไขหน้างาน',
  SCRAP:           'ทำลาย',
  NO_ACTION:       'ไม่ต้องดำเนินการ'
};

var RISK_CLASS = {
  CRITICAL: { th: 'วิกฤต — เสี่ยงต่อความปลอดภัย', escalate: true,  sla_hours: 4 },
  MAJOR:    { th: 'สูง — กระทบการใช้งาน',        escalate: true,  sla_hours: 24 },
  MINOR:    { th: 'ต่ำ — กระทบภาพลักษณ์',        escalate: false, sla_hours: 72 }
};

var CASE_SOURCE = {
  SUPPLIER_NOTICE: 'ผู้ขายแจ้ง',
  CUSTOMER_CLAIM:  'ลูกค้าร้องเรียน',
  INTERNAL_QC:     'QC ตรวจพบเอง',
  FIELD_FAILURE:   'พบปัญหาหน้างาน',
  REGULATOR:       'หน่วยงานกำกับแจ้ง'
};

/** ส่วนของการสอบสวน/CAPA ตามฟอร์ม RC-01 — สร้างครบทุกแถวตอนเปิดเคส */
var ACTION_SECTIONS = [
  { type: 'INVESTIGATION', key: 'INITIAL',     th: 'การสอบสวนเบื้องต้น' },
  { type: 'INVESTIGATION', key: 'SUPPLIER_8D', th: 'ข้อมูลจากผู้ขาย / 8D' },
  { type: 'INVESTIGATION', key: 'ROOT_CAUSE',  th: 'สาเหตุที่แท้จริง' },
  { type: 'INVESTIGATION', key: 'CORRECTION',  th: 'การแก้ไขเฉพาะหน้า' },
  { type: 'INVESTIGATION', key: 'CORRECTIVE',  th: 'การแก้ไขเชิงป้องกันการเกิดซ้ำ' },
  { type: 'INVESTIGATION', key: 'PREVENTIVE',  th: 'การป้องกันล่วงหน้า' },
  { type: 'DECISION', key: 'RECALL_REQUIRED', th: 'ต้องเรียกคืนหรือไม่' },
  { type: 'DECISION', key: 'FIELD_ACTION',    th: 'แก้ไข/เปลี่ยนหน้างาน' },
  { type: 'DECISION', key: 'CUSTOMER_NOTIFY', th: 'แจ้งลูกค้า' },
  { type: 'DECISION', key: 'SUPPLIER_CLAIM',  th: 'เคลมผู้ขาย' },
  { type: 'DECISION', key: 'CASE_CLOSURE',    th: 'ปิดเคส' }
];

/* ══════════════════════════════════════════════════════════════════════════
   4. สิทธิ์ — role ผูกกับ email ในแท็บ Users เท่านั้น
   หน้าจอซ่อนปุ่มคือ UX ไม่ใช่การกันสิทธิ์ ทุกฟังก์ชันต้องเช็คเองที่เซิร์ฟเวอร์
   ══════════════════════════════════════════════════════════════════════════ */
var ROLES = {
  QC:     'QC — เจ้าหน้าที่คุณภาพ',
  QCM:    'QCM — ผู้จัดการคุณภาพ',
  WH:     'WH — คลังสินค้า',
  SR:     'SR — จัดซื้อ',
  LS:     'LS — ขาย/โลจิสติกส์',
  GM:     'GM — ผู้บริหาร',
  ADMIN:  'ADMIN — ผู้ดูแลระบบ',
  VIEWER: 'VIEWER — ดูอย่างเดียว'
};

/** ฟังก์ชัน -> role ที่เรียกได้ (ไม่อยู่ในตารางนี้ = อ่านอย่างเดียว ทุก role เรียกได้) */
var PERM = {
  openCase:          ['QC', 'QCM', 'ADMIN'],
  updateCase:        ['QC', 'QCM', 'ADMIN'],
  addScope:          ['QC', 'QCM', 'ADMIN'],
  buildTracking:     ['QC', 'QCM', 'ADMIN'],
  updateTracking:    ['QC', 'QCM', 'WH', 'LS', 'SR', 'ADMIN'],
  updateAction:      ['QC', 'QCM', 'SR', 'ADMIN'],
  approveAction:     ['QCM', 'GM', 'ADMIN'],
  advanceCaseStatus: ['QC', 'QCM', 'ADMIN'],
  closeCase:         ['QCM', 'ADMIN'],
  cancelCase:        ['QCM', 'ADMIN'],
  placeHold:         ['QC', 'QCM', 'WH', 'ADMIN'],
  releaseHold:       ['QCM', 'ADMIN'],
  saveTraceNote:     ['QC', 'QCM', 'WH', 'ADMIN'],
  startMockRecall:   ['QC', 'QCM', 'ADMIN'],
  finishMockRecall:  ['QC', 'QCM', 'ADMIN'],
  reviewMockRecall:  ['QCM', 'ADMIN'],
  sapIngest:         ['ADMIN'],
  runSetup:          ['ADMIN']
};

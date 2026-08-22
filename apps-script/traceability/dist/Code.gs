/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MGS TRACEABILITY & RECALL — Code.gs
 *  ระบบทวนสอบสินค้าและเรียกคืน · เวอร์ชัน 2026.08.22-1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ⚠️  ไฟล์นี้ถูกสร้างอัตโนมัติ — อย่าแก้ที่นี่
 *      แก้ที่ apps-script/traceability/*.gs แล้วรัน:
 *          node tools/build-traceability-codegs.js
 *      รวมจาก 9 ไฟล์ เมื่อ 2026-08-22
 *
 *  ───────────────────────────────────────────────────────────────────────────
 *  โปรเจกต์ Apps Script นี้มีแค่ 2 ไฟล์
 *      Code.gs      ← ไฟล์นี้
 *      index.html   ← หน้าเว็บ (ต้องตั้งชื่อว่า index พอดี ไม่งั้น doGet หาไม่เจอ)
 *
 *  ขั้นตอนติดตั้ง (ทำครั้งเดียว)
 *      1. รัน  setupCreateWorkbook()      สร้างสเปรดชีตและ 23 แท็บ
 *      2. ใส่รายชื่อผู้ใช้ในแท็บ Users     (ต้องมี ADMIN อย่างน้อย 1 คน)
 *      3. รัน  setupGeneratePushSecret()  คัดลอกกุญแจไปใส่ตัวส่งข้อมูลในออฟฟิศ
 *      4. รัน  setupTriggers()            ตั้งตัวตั้งเวลา 4 ตัว
 *      5. รัน  runSelfTest()              ต้องผ่านทุกข้อก่อนไปต่อ
 *      6. Deploy > New deployment · Execute as: Me · Access: MGS domain
 *
 *  ทดลองใช้ก่อนเชื่อม SAP
 *      รัน  setupSeedDemoData()   ได้ข้อมูลตัวอย่างที่ตรงกับฟอร์ม QC เดิม
 *      ล้างทีหลังด้วย  setupWipeAllData("ลบข้อมูลทั้งหมด")
 *
 *  ⚠️  การกด Save ไม่ทำให้ผู้ใช้ได้โค้ดใหม่
 *      ต้อง Deploy > Manage deployments > แก้ > Version: New version ทุกครั้ง
 *
 *  ⚠️  ห้ามแชร์สเปรดชีตให้ผู้ใช้ทั่วไป
 *      ถ้าเปิดชีตตรงได้ กฎตรวจสอบ 13 ข้อและระบบสิทธิ์ทั้งหมดเป็นโมฆะทันที
 * ═══════════════════════════════════════════════════════════════════════════
 */


/* ════════════════════════════════════════════════════════ 00_Config.gs ════ */

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


/* ══════════════════════════════════════════════════════════ 01_Repo.gs ════ */

/**
 * MGS Traceability & Recall — 01_Repo.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * ชั้นเข้าถึงข้อมูล + ตัวตน + สิทธิ์ + audit + ตัวช่วยแปลงค่า
 * ทุกการอ่าน/เขียนชีตในระบบต้องผ่านไฟล์นี้ ไม่มีข้อยกเว้น
 */

/* ══════════════════════════════════════════════════════════════════════════
   1. ผลลัพธ์มาตรฐาน — ฝั่ง client ตรวจ res.ok เสมอ ไม่ต้องจับ exception
   ══════════════════════════════════════════════════════════════════════════ */
function ok_(data)      { return { ok: true, data: (data === undefined ? null : data) }; }
function err_(msg, code) { return { ok: false, error: String(msg), code: code || 'ERROR' }; }

/**
 * ครอบทุกฟังก์ชันฝั่งเซิร์ฟเวอร์ — ไม่มี exception หลุดไปถึง client
 * และทุกความล้มเหลวถูกบันทึกไว้เสมอ
 */
function guard_(fnName, fn) {
  try {
    return fn();
  } catch (e) {
    logError_(fnName, e);
    return err_(userMessage_(e));
  }
}

/** แปลง error ภายในเป็นข้อความที่ผู้ใช้อ่านแล้วรู้ว่าต้องทำอะไร */
function userMessage_(e) {
  var m = (e && e.message) ? String(e.message) : String(e);
  // ข้อความที่เราตั้งใจโยนเอง ขึ้นต้นด้วย [U] = แสดงให้ผู้ใช้เห็นตรง ๆ ได้
  if (m.indexOf('[U]') === 0) return m.slice(3).trim();
  if (/Service Spreadsheets|timed out|Timeout/i.test(m)) {
    return 'ระบบตอบช้ากว่าปกติ กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้แจ้งผู้ดูแลระบบ';
  }
  return 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังไม่ได้แจ้งผู้ดูแลระบบ (รหัส: ' + APP_VERSION + ')';
}

/** โยน error ที่ตั้งใจให้ผู้ใช้เห็นข้อความเต็ม */
function fail_(msg) { throw new Error('[U] ' + msg); }

/* ══════════════════════════════════════════════════════════════════════════
   2. ตัวตนและสิทธิ์ — มาจาก session ฝั่งเซิร์ฟเวอร์เท่านั้น
   ห้ามเชื่อ role ที่ client ส่งมา ไม่ว่ากรณีใด
   ══════════════════════════════════════════════════════════════════════════ */
function currentUser_() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }
  if (!email) {
    try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e2) { email = ''; }
  }
  if (!email) fail_('ไม่พบบัญชีผู้ใช้ กรุณาเปิดแอปด้วยบัญชีอีเมลของบริษัท');
  return String(email).toLowerCase().trim();
}

/** อ่านตาราง Users แล้ว cache ไว้ 10 นาที — ตารางนี้ถูกอ่านทุก request */
function userMap_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('user_map_v1');
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* cache เสีย อ่านใหม่ */ }
  }
  var map = {};
  var t = readTable_(TAB.USERS);
  t.rows.forEach(function (r) {
    var em = String(r.email || '').toLowerCase().trim();
    if (!em) return;
    map[em] = {
      email: em,
      name: String(r.full_name || em),
      dept: String(r.dept || ''),
      role: String(r.role || 'VIEWER').toUpperCase().trim(),
      lark: String(r.lark_user_id || ''),
      active: isTrue_(r.is_active)
    };
  });
  cache.put('user_map_v1', JSON.stringify(map), 600);
  return map;
}

function clearUserCache_() { CacheService.getScriptCache().remove('user_map_v1'); }

/** คืนโปรไฟล์ผู้ใช้ปัจจุบัน — คนที่ไม่อยู่ในตาราง Users ได้ VIEWER */
function me_() {
  var email = currentUser_();
  if (CFG.ALLOWED_DOMAIN && email.indexOf('@' + CFG.ALLOWED_DOMAIN) === -1) {
    // ยังปล่อยผ่านถ้ามีชื่อในตาราง Users (เผื่อที่ปรึกษาภายนอกที่อนุมัติแล้ว)
    var mm = userMap_()[email];
    if (!mm || !mm.active) fail_('บัญชี ' + email + ' ไม่มีสิทธิ์ใช้งานระบบนี้');
  }
  var u = userMap_()[email];
  if (!u) return { email: email, name: email, dept: '', role: 'VIEWER', lark: '', active: true, unlisted: true };
  if (!u.active) fail_('บัญชี ' + email + ' ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  return u;
}

/** เช็คสิทธิ์ตามชื่อฟังก์ชันใน PERM — คืนโปรไฟล์ผู้ใช้เมื่อผ่าน */
function requirePerm_(fnName) {
  var u = me_();
  var allowed = PERM[fnName];
  if (!allowed) return u;                       // ฟังก์ชันอ่านอย่างเดียว
  if (allowed.indexOf(u.role) === -1) {
    fail_('สิทธิ์ ' + u.role + ' ใช้งาน "' + fnName + '" ไม่ได้ — ต้องเป็น ' + allowed.join(' / '));
  }
  return u;
}

/* ══════════════════════════════════════════════════════════════════════════
   3. อ่าน/เขียนชีต
   ══════════════════════════════════════════════════════════════════════════ */
function ss_() {
  if (!CFG.SS_ID) fail_('ยังไม่ได้ตั้งค่า SS_ID — ให้ผู้ดูแลระบบรัน setupCreateWorkbook() ก่อน');
  return SpreadsheetApp.openById(CFG.SS_ID);
}

function sheet_(tabName) {
  var sh = ss_().getSheetByName(tabName);
  if (!sh) fail_('ไม่พบแท็บ "' + tabName + '" ในไฟล์ฐานข้อมูล');
  return sh;
}

/**
 * อ่านทั้งแท็บเป็น array ของ object
 * @param {string} tabName
 * @param {boolean} display  true = อ่านเป็นข้อความที่ผู้ใช้เห็น (กัน 007 กลายเป็น 7
 *                           และกันวันที่เพี้ยนจาก timezone) — ใช้กับตาราง SAP ทุกตัว
 */
function readTable_(tabName, display) {
  var sh = sheet_(tabName);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  var rng = sh.getRange(1, 1, lastRow, lastCol);
  var values = display ? rng.getDisplayValues() : rng.getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    var blank = true;
    for (var c = 0; c < raw.length; c++) { if (raw[c] !== '' && raw[c] !== null) { blank = false; break; } }
    if (blank) continue;
    var o = { _row: i + 1 };
    for (var k = 0; k < headers.length; k++) { if (headers[k]) o[headers[k]] = raw[k]; }
    rows.push(o);
  }
  return { headers: headers, rows: rows };
}

/** อ่านแบบ cache 5 นาที — ใช้กับตาราง SAP ที่ถูกอ่านซ้ำในหลายหน้าจอ */
function readTableCached_(tabName) {
  var key = 'tbl_' + tabName + '_v1';
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* ต่อไปอ่านใหม่ */ }
  }
  var t = readTable_(tabName, true);
  var json = JSON.stringify(t);
  if (json.length < 95000) cache.put(key, json, 300);   // CacheService จำกัด 100KB/key
  return t;
}

function clearTableCache_(tabName) {
  CacheService.getScriptCache().remove('tbl_' + tabName + '_v1');
}

/** แปลง object -> array ตามลำดับ header ของแท็บนั้น (พร้อมกัน formula injection) */
function toRow_(tabName, obj) {
  var headers = SCHEMA[tabName];
  if (!headers) fail_('ไม่รู้จักโครงตารางของแท็บ ' + tabName);
  return headers.map(function (h) { return sanitizeCell_(obj[h]); });
}

/**
 * กันสูตรฝังในเซลล์ — ข้อความที่ขึ้นต้นด้วย = + - @ ถูกนำหน้าด้วย '
 * ป้องกันทั้ง IMPORTRANGE ในชีต และการเปิดไฟล์ export ใน Excel
 */
function sanitizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v).replace(/ /g, ' ');
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) return "'" + s;
  return s;
}

/** เพิ่มหลายแถวในครั้งเดียว — ห้าม appendRow ในลูป */
function appendRows_(tabName, objs) {
  if (!objs || !objs.length) return 0;
  var sh = sheet_(tabName);
  var rows = objs.map(function (o) { return toRow_(tabName, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SCHEMA[tabName].length).setValues(rows);
  clearTableCache_(tabName);
  invalidateCtx_(tabName);
  return rows.length;
}

/** ต่อท้ายแท็บของ SAP — ใช้กับก้อนที่ 2 เป็นต้นไปของตารางใหญ่ที่ส่งมาหลายรอบ */
function appendSapRows_(tabName, objs) {
  if (SAP_TABS.indexOf(tabName) === -1) fail_('แท็บ ' + tabName + ' ไม่อนุญาตให้ sync');
  return appendRows_(tabName, objs);
}

/** หาแถวจาก business key — ห้ามจำเลขแถวข้ามคำขอ */
function findRow_(tabName, keyCol, keyVal) {
  var t = readTable_(tabName);
  var target = String(keyVal);
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][keyCol]) === target) return t.rows[i];
  }
  return null;
}

function findRows_(tabName, keyCol, keyVal) {
  var t = readTable_(tabName);
  var target = String(keyVal);
  return t.rows.filter(function (r) { return String(r[keyCol]) === target; });
}

/**
 * อัปเดตแถวเดียวแบบปลอดภัย: หาแถวจาก key ตอนจะเขียนจริง (ไม่ใช้ _row ที่ค้างจากก่อนหน้า)
 * ตรวจ row_version กันสองคนแก้ทับกัน แล้วเขียนทั้งแถวครั้งเดียว
 * ต้องเรียกภายใน withLock_() เสมอ
 */
function updateRow_(tabName, keyCol, keyVal, patch, expectedVersion) {
  var sh = sheet_(tabName);
  var headers = SCHEMA[tabName];
  var t = readTable_(tabName);
  var found = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][keyCol]) === String(keyVal)) { found = t.rows[i]; break; }
  }
  if (!found) fail_('ไม่พบรายการ ' + keyVal + ' (อาจถูกลบหรือแก้ไขไปแล้ว กรุณาโหลดหน้าใหม่)');

  if (headers.indexOf('row_version') !== -1 && expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '') {
    var cur = Number(found.row_version || 0);
    if (Number(expectedVersion) !== cur) {
      fail_('มีคนอื่นแก้ไขรายการนี้ไปแล้ว (เวอร์ชัน ' + cur + ') กรุณาโหลดหน้าใหม่แล้วทำอีกครั้ง');
    }
  }

  var before = {};
  headers.forEach(function (h) { before[h] = found[h]; });

  var after = {};
  headers.forEach(function (h) { after[h] = (patch[h] !== undefined) ? patch[h] : found[h]; });
  if (headers.indexOf('row_version') !== -1) after.row_version = Number(found.row_version || 0) + 1;

  sh.getRange(found._row, 1, 1, headers.length).setValues([toRow_(tabName, after)]);
  clearTableCache_(tabName);
  invalidateCtx_(tabName);
  return { before: before, after: after, row: found._row };
}

/**
 * ตรวจ row_version แยกจากการเขียน
 * ใช้เมื่อระบบต้องคำนวณยอดใหม่ก่อน (ซึ่งทำให้ version ขยับ) แล้วค่อยเขียนจริง
 * ถ้าไม่แยก ผู้ใช้จะโดนแจ้ง "มีคนอื่นแก้ไข" ทั้งที่คนที่แก้คือระบบเอง
 */
function assertVersion_(current, expected, what) {
  if (expected === undefined || expected === null || expected === '') return;
  if (Number(expected) !== Number(current || 0)) {
    fail_('มีคนอื่นแก้ไข' + (what || 'รายการนี้') + 'ไปแล้ว (เวอร์ชัน ' + Number(current || 0) +
          ') กรุณาโหลดหน้าใหม่แล้วทำอีกครั้ง');
  }
}

/**
 * ทับข้อมูลทั้งแท็บ (ใช้เฉพาะรอบ sync ของ SAP_*)
 * เขียน header + ข้อมูลใหม่ครั้งเดียว แล้วลบส่วนเกินท้ายตาราง
 */
function replaceTable_(tabName, objs) {
  if (SAP_TABS.indexOf(tabName) === -1) fail_('แท็บ ' + tabName + ' ไม่อนุญาตให้ sync ทับ');
  var sh = sheet_(tabName);
  var headers = SCHEMA[tabName];
  var rows = (objs || []).map(function (o) { return toRow_(tabName, o); });

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  var lastRow = sh.getMaxRows();
  var firstStale = 2 + rows.length;
  if (lastRow >= firstStale) {
    sh.getRange(firstStale, 1, lastRow - firstStale + 1, sh.getMaxColumns()).clearContent();
  }
  clearTableCache_(tabName);
  return rows.length;
}

/* ══════════════════════════════════════════════════════════════════════════
   4. ล็อกและกันบันทึกซ้ำ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ทุกการเขียนที่กระทบข้อมูลร่วมต้องอยู่ในนี้
 * รองรับการเรียกซ้อนกัน (เช่น updateTracking_ -> recomputeCase_) โดยนับชั้นเอง
 * ถ้าไม่นับชั้น ชั้นในจะปล่อยล็อกทิ้งทั้งที่ชั้นนอกยังเขียนไม่เสร็จ
 */
var LOCK_DEPTH_ = 0;

function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) {          // อยู่ในล็อกของ execution นี้อยู่แล้ว
    LOCK_DEPTH_++;
    try { return fn(); } finally { LOCK_DEPTH_--; }
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    fail_('ระบบกำลังบันทึกรายการอื่นอยู่ กรุณากดใหม่อีกครั้งใน 2–3 วินาที');
  }
  LOCK_DEPTH_ = 1;
  try {
    var r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    LOCK_DEPTH_ = 0;
    lock.releaseLock();
  }
}

/**
 * กันบันทึกซ้ำจากการกดสองครั้ง/กด refresh แล้วส่งใหม่
 * clientKey ถูกสร้าง 1 ครั้งต่อการกรอกฟอร์ม 1 รอบ (ไม่ใช่ต่อการคลิก)
 * คืนผลลัพธ์เดิมถ้าเคยทำสำเร็จแล้ว
 */
function idempotent_(clientKey, fn) {
  if (!clientKey) return fn();
  var cache = CacheService.getScriptCache();
  var k = 'idem_' + String(clientKey).slice(0, 200);
  var prev = cache.get(k);
  if (prev) {
    try {
      var p = JSON.parse(prev);
      p.duplicate = true;
      return p;
    } catch (e) { /* cache เสีย ทำใหม่ */ }
  }
  var res = fn();
  if (res && res.ok) {
    try { cache.put(k, JSON.stringify(res), 21600); } catch (e) {}   // 6 ชม.
  }
  return res;
}

/* ══════════════════════════════════════════════════════════════════════════
   5. Audit log — เขียนเพิ่มเท่านั้น
   ══════════════════════════════════════════════════════════════════════════ */
function logAudit_(action, entity, entityId, before, after, requestId) {
  try {
    var email = '';
    try { email = currentUser_(); } catch (e) { email = 'system'; }
    sheet_(TAB.AUDIT).appendRow([
      new Date(), email, action, entity, String(entityId || ''),
      JSON.stringify(before || {}).slice(0, 4000),
      JSON.stringify(after || {}).slice(0, 4000),
      APP_VERSION, String(requestId || '')
    ]);
  } catch (e) {
    console.error('logAudit_ failed', e && e.stack);   // audit ล้มต้องไม่ทำให้ธุรกรรมล้ม
  }
}

function logError_(fn, e, ctx) {
  console.error(fn, e && e.stack ? e.stack : e, JSON.stringify(ctx || {}).slice(0, 1500));
  var msg = (e && e.message) ? e.message : String(e);
  if (msg.indexOf('[U]') === 0) return;     // ข้อผิดพลาดที่ตั้งใจบอกผู้ใช้ ไม่ต้องปลุก Lark
  try { notifyLarkText_('⚠️ Traceability: ' + fn + ' ล้มเหลว — ' + msg); } catch (e2) {}
}

function logSync_(source, tab, rowsIn, rowsWritten, status, ms, message, batchId) {
  try {
    sheet_(TAB.SYNC_LOG).appendRow([new Date(), source, tab, rowsIn, rowsWritten,
      status, ms, String(message || '').slice(0, 500), String(batchId || '')]);
  } catch (e) { console.error('logSync_ failed', e && e.stack); }
}

/* ══════════════════════════════════════════════════════════════════════════
   6. ตัวช่วยแปลงค่า — จุดที่ข้อมูลเพี้ยนบ่อยที่สุด
   ══════════════════════════════════════════════════════════════════════════ */

/** จำนวน: ยอมรับ "1,250.00" / " 12 " / 12 — ค่าที่แปลงไม่ได้คือ error ไม่ใช่ 0 */
function parseQty_(v, fieldName) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') {
    if (!isFinite(v)) fail_('จำนวนใน "' + (fieldName || 'ช่องจำนวน') + '" ไม่ถูกต้อง');
    return v;
  }
  var s = String(v).replace(/ /g, '').replace(/,/g, '').trim();
  if (s === '') return 0;
  var n = Number(s);
  if (!isFinite(n)) fail_('จำนวนใน "' + (fieldName || 'ช่องจำนวน') + '" ต้องเป็นตัวเลข (ได้รับ: ' + v + ')');
  return n;
}

/** จำนวนที่ต้องไม่ติดลบ */
function parseQtyPos_(v, fieldName) {
  var n = parseQty_(v, fieldName);
  if (n < 0) fail_('จำนวนใน "' + (fieldName || 'ช่องจำนวน') + '" ติดลบไม่ได้');
  return n;
}

function isTrue_(v) {
  if (v === true) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1' || s === 'ใช่';
}

/** ข้อความจากผู้ใช้: ตัดช่องว่างแปลก จำกัดความยาว */
function str_(v, max) {
  var s = String(v === null || v === undefined ? '' : v).replace(/ /g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

function today_()      { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'); }
function nowStamp_()   { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function fmtDate_(d)   { return d ? Utilities.formatDate(new Date(d), CFG.TZ, 'yyyy-MM-dd') : ''; }

/** yyyy-MM-dd เท่านั้น — ไม่รับรูปแบบกำกวมอย่าง 01/02/2026 */
function parseDate_(s, fieldName) {
  if (!s) return '';
  var t = String(s).trim();
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) fail_('วันที่ใน "' + (fieldName || 'ช่องวันที่') + '" ต้องเป็นรูปแบบ ปี-เดือน-วัน (2026-08-22)');
  return m[1] + '-' + m[2] + '-' + m[3];
}

function uuid_() { return Utilities.getUuid(); }

/**
 * ออกเลขที่เอกสารแบบ PREFIX-YYYY-NNN โดยนับจากเลขสูงสุดที่มีอยู่จริงในชีต
 * ต้องเรียกภายใน withLock_() — ไม่งั้นสองคนกดพร้อมกันได้เลขซ้ำ
 */
function nextDocNo_(tabName, col, prefix) {
  var year = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy');
  var head = prefix + '-' + year + '-';
  var max = 0;
  readTable_(tabName, true).rows.forEach(function (r) {
    var v = String(r[col] || '');
    if (v.indexOf(head) !== 0) return;
    var n = parseInt(v.slice(head.length), 10);
    if (isFinite(n) && n > max) max = n;
  });
  var next = max + 1;
  return head + (next < 100 ? ('00' + next).slice(-3) : String(next));
}

/** ค่าตั้งค่าจากแท็บ Settings (cache 10 นาที) */
function setting_(key, fallback) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('settings_v1');
  var map;
  if (hit) {
    try { map = JSON.parse(hit); } catch (e) { map = null; }
  }
  if (!map) {
    map = {};
    readTable_(TAB.SETTINGS, true).rows.forEach(function (r) { map[String(r.key)] = r.value; });
    cache.put('settings_v1', JSON.stringify(map), 600);
  }
  return (map[key] === undefined || map[key] === '') ? fallback : map[key];
}

function secret_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) fail_('ยังไม่ได้ตั้งค่า Script Property: ' + key);
  return v;
}


/* ═════════════════════════════════════════════════════════ 02_Trace.gs ════ */

/**
 * MGS Traceability & Recall — 02_Trace.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * เครื่องมือทวนสอบ — หัวใจของระบบทั้งหมด
 *
 * กระดูกสันหลังคือ SAP_Lot_Moves (มาจาก OITL/ITL1 + OBTL/OSRL ของ B1)
 * 1 แถว = การเคลื่อนไหวของ lot/SN 1 ครั้ง บนเอกสาร 1 บรรทัด
 *   direction = IN  -> ของเข้า (รับซื้อ / รับคืนจากลูกค้า / โอนเข้า)
 *   direction = OUT -> ของออก (ส่งลูกค้า / คืนผู้ขาย / ตัดออก / โอนออก)
 *   quantity  เป็นค่าบวกเสมอ ทิศทางดูจาก direction ไม่ใช่จากเครื่องหมาย
 *
 * คำถาม 3 ข้อที่ระบบต้องตอบได้ภายในไม่กี่วินาที
 *   1. ของล็อตนี้มาจากไหน  (backward)  -> ผู้ขาย · PO · ใบรับ · ล็อตของผู้ขาย
 *   2. ของล็อตนี้ไปไหนบ้าง (forward)   -> ลูกค้า · โครงการ · DO · ที่ยังค้างในคลัง
 *   3. จำนวนครบไหม        (reconcile)  -> รับ = ส่งออก + คงคลัง + คืน (+ ที่หายไป)
 */

/** คีย์ยืนหมายเลขล็อต/ซีเรียล — ItemCode + DistNumber ตามหลักของ B1 */
function lotKey_(itemCode, distNumber) {
  return String(itemCode || '').trim() + '|' + String(distNumber || '').trim();
}

/* ══════════════════════════════════════════════════════════════════════════
   1. โหลดข้อมูลอ้างอิงเข้าหน่วยความจำครั้งเดียวต่อคำขอ
   อ่านทีละเซลล์ในลูปคือสาเหตุอันดับหนึ่งที่สคริปต์ timeout
   ══════════════════════════════════════════════════════════════════════════ */
function ctx_() {
  if (ctx_._c) return ctx_._c;

  var items = {}, bp = {}, whs = {}, lots = {};
  readTableCached_(TAB.ITEMS).rows.forEach(function (r) { items[String(r.item_code)] = r; });
  readTableCached_(TAB.BP).rows.forEach(function (r) { bp[String(r.card_code)] = r; });
  readTableCached_(TAB.WHS).rows.forEach(function (r) { whs[String(r.whs_code)] = r; });
  readTableCached_(TAB.LOTS).rows.forEach(function (r) { lots[String(r.lot_key)] = r; });

  var moves = readTable_(TAB.MOVES, true).rows;
  var byLot = {};
  moves.forEach(function (m) {
    var k = String(m.lot_key || lotKey_(m.item_code, m.dist_number));
    m.lot_key = k;
    m.quantity = parseQty_(m.quantity, 'quantity');
    (byLot[k] = byLot[k] || []).push(m);
  });
  Object.keys(byLot).forEach(function (k) {
    byLot[k].sort(function (a, b) { return String(a.doc_date).localeCompare(String(b.doc_date)); });
  });

  var stockByLot = {};
  readTable_(TAB.STOCK, true).rows.forEach(function (s) {
    var k = String(s.lot_key || lotKey_(s.item_code, s.dist_number));
    (stockByLot[k] = stockByLot[k] || []).push({
      whs_code: String(s.whs_code || ''),
      quantity: parseQty_(s.quantity, 'stock qty'),
      status: String(s.status || '')
    });
  });

  // ใบรับสินค้า: ใช้เชื่อมกลับไปหา PO และเลขใบกำกับของผู้ขาย
  var grpoByDoc = {};
  readTableCached_(TAB.GRPO).rows.forEach(function (g) {
    grpoByDoc[String(g.doc_entry) + '#' + String(g.item_code)] = g;
  });

  var poByEntry = {};
  readTableCached_(TAB.PO).rows.forEach(function (p) {
    poByEntry[String(p.doc_entry) + '#' + String(p.line_num)] = p;
  });

  ctx_._c = { items: items, bp: bp, whs: whs, lots: lots,
              movesByLot: byLot, stockByLot: stockByLot,
              grpoByDoc: grpoByDoc, poByEntry: poByEntry, allMoves: moves };
  return ctx_._c;
}
ctx_._c = null;

/**
 * ตารางฝั่ง MGS ที่ buildLotTrace_ ต้องใช้ — อ่านครั้งเดียวต่อ 1 คำขอ
 * ถ้าไม่ทำแบบนี้ การออกรายงาน 200 ล็อตจะอ่านชีต 600 ครั้งแล้ว timeout
 */
function mgsCtx_() {
  if (mgsCtx_._c) return mgsCtx_._c;
  var notes = {}, holds = {}, scopes = {};
  readTable_(TAB.TRACE_NOTES, true).rows.forEach(function (r) { notes[String(r.lot_key)] = r; });
  readTable_(TAB.HOLDS, true).rows.forEach(function (r) {
    if (String(r.status).toUpperCase() !== 'HOLD') return;
    (holds[String(r.lot_key)] = holds[String(r.lot_key)] || []).push(r);
  });
  readTable_(TAB.SCOPE, true).rows.forEach(function (r) {
    (scopes[String(r.lot_key)] = scopes[String(r.lot_key)] || []).push(r);
  });
  mgsCtx_._c = { notes: notes, holds: holds, scopes: scopes };
  return mgsCtx_._c;
}
mgsCtx_._c = null;

function resetCtx_() { ctx_._c = null; mgsCtx_._c = null; }

/** ล้างเฉพาะ cache ที่เกี่ยวข้องกับแท็บที่เพิ่งถูกเขียน */
function invalidateCtx_(tabName) {
  if (SAP_TABS.indexOf(tabName) !== -1) ctx_._c = null;
  if ([TAB.TRACE_NOTES, TAB.HOLDS, TAB.SCOPE].indexOf(tabName) !== -1) mgsCtx_._c = null;
}

function objInfo_(objType) {
  return OBJ[String(objType)] || { name: 'เอกสารอื่น (' + objType + ')', dir: 'NONE', doc: 'OTHER' };
}

function whsName_(code) {
  var c = ctx_(); var w = c.whs[String(code)];
  return w ? String(w.whs_name || code) : String(code || '');
}

function whsIsCustomerSite_(code) {
  var c = ctx_(); var w = c.whs[String(code)];
  return w ? String(w.location_type || '').toUpperCase() === 'CUSTOMER' : false;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. ตามรอยย้อนหลัง — ของล็อตนี้มาจากไหน
   ══════════════════════════════════════════════════════════════════════════ */
function traceBackward_(lotKey) {
  var c = ctx_();
  var moves = c.movesByLot[lotKey] || [];
  var out = [];

  moves.forEach(function (m) {
    if (String(m.direction).toUpperCase() !== 'IN') return;
    var info = objInfo_(m.obj_type);
    var rec = {
      obj_type: String(m.obj_type),
      doc_type: info.doc,
      doc_type_th: info.name,
      doc_num: String(m.doc_num || ''),
      doc_date: String(m.doc_date || ''),
      qty: m.quantity,
      whs_code: String(m.whs_code || ''),
      whs_name: whsName_(m.whs_code),
      party_code: String(m.card_code || ''),
      party_name: String(m.card_name || ''),
      supplier_po_no: '',
      supplier_invoice_no: '',
      project: String(m.project || '')
    };
    // ต่อสายกลับไปหา PO และใบกำกับผู้ขายผ่านใบรับสินค้า
    if (info.doc === 'GRPO') {
      var g = c.grpoByDoc[String(m.doc_entry) + '#' + String(m.item_code)];
      if (g) {
        rec.supplier_invoice_no = String(g.num_at_card || '');
        rec.supplier_po_no = String(g.base_doc_num || '');
        if (!rec.supplier_po_no && g.base_entry !== '' && g.base_entry !== null) {
          var p = c.poByEntry[String(g.base_entry) + '#' + String(g.base_line)];
          if (p) rec.supplier_po_no = String(p.doc_num || '');
        }
        if (!rec.project) rec.project = String(g.project || '');
      }
    }
    out.push(rec);
  });

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   3. ตามรอยไปข้างหน้า — ของล็อตนี้ไปอยู่ที่ไหนแล้วบ้าง
   ══════════════════════════════════════════════════════════════════════════ */
function traceForward_(lotKey) {
  var c = ctx_();
  var moves = c.movesByLot[lotKey] || [];
  var shipments = [];

  moves.forEach(function (m) {
    if (String(m.direction).toUpperCase() !== 'OUT') return;
    var info = objInfo_(m.obj_type);
    // ใบกำกับที่อ้างใบส่งของอยู่แล้วจะทำให้นับซ้ำ — ยึดใบส่งของเป็นหลัก
    // (ตัวส่งข้อมูลฝั่งออฟฟิศกรองใบกำกับที่มี base เป็นใบส่งของออกให้แล้ว)
    shipments.push({
      obj_type: String(m.obj_type),
      doc_type: info.doc,
      doc_type_th: info.name,
      doc_num: String(m.doc_num || ''),
      doc_date: String(m.doc_date || ''),
      qty: m.quantity,
      whs_code: String(m.whs_code || ''),
      whs_name: whsName_(m.whs_code),
      party_code: String(m.card_code || ''),
      party_name: String(m.card_name || ''),
      project: String(m.project || ''),
      to_customer: OUTBOUND_TO_CUSTOMER.indexOf(String(m.obj_type)) !== -1
    });
  });

  var onHand = (c.stockByLot[lotKey] || []).map(function (s) {
    return {
      whs_code: s.whs_code,
      whs_name: whsName_(s.whs_code),
      qty: s.quantity,
      status: s.status,
      is_customer_site: whsIsCustomerSite_(s.whs_code)
    };
  }).filter(function (s) { return s.qty !== 0; });

  return { shipments: shipments, on_hand: onHand };
}

/* ══════════════════════════════════════════════════════════════════════════
   4. กระทบยอด — ตัวเลขที่ FM-QC-TR-02 ใช้ตัดสิน PASS/FAIL
   ══════════════════════════════════════════════════════════════════════════ */
function reconcile_(lotKey) {
  var c = ctx_();
  var moves = c.movesByLot[lotKey] || [];
  var received = 0, returnedIn = 0, shippedOut = 0, returnedToSupplier = 0, otherOut = 0;

  moves.forEach(function (m) {
    var t = String(m.obj_type), d = String(m.direction).toUpperCase(), q = m.quantity;
    if (t === '67') return;                              // โอนย้ายคลังไม่เปลี่ยนยอดรวม
    if (d === 'IN') {
      if (t === '16' || t === '14') returnedIn += q;      // ลูกค้าคืนกลับมา
      else received += q;                                 // รับซื้อ / รับเข้าอื่น
    } else if (d === 'OUT') {
      if (OUTBOUND_TO_CUSTOMER.indexOf(t) !== -1) shippedOut += q;
      else if (t === '21' || t === '19') returnedToSupplier += q;
      else otherOut += q;                                 // ตัดออก/ทำลาย
    }
  });

  var onHand = 0;
  (c.stockByLot[lotKey] || []).forEach(function (s) { onHand += s.quantity; });

  // รับเข้า + รับคืน  =  ส่งออก + คืนผู้ขาย + ตัดออก + คงคลัง  (+ ส่วนต่างที่อธิบายไม่ได้)
  var accounted = shippedOut + returnedToSupplier + otherOut + onHand + returnedIn * 0;
  var unaccounted = round3_(received + returnedIn - shippedOut - returnedToSupplier - otherOut - onHand);

  var totalIn = received + returnedIn;
  var pct = totalIn > 0 ? round3_((totalIn - Math.abs(unaccounted)) / totalIn) : (accounted === 0 ? 1 : 0);

  return {
    received: round3_(received),
    returned_in: round3_(returnedIn),
    shipped_out: round3_(shippedOut),
    returned_to_supplier: round3_(returnedToSupplier),
    other_out: round3_(otherOut),
    on_hand: round3_(onHand),
    unaccounted: unaccounted,
    completion_pct: pct,
    pass: Math.abs(unaccounted) <= CFG.RECONCILE_TOLERANCE_QTY
  };
}

function round3_(n) { return Math.round(Number(n) * 1000) / 1000; }

/* ══════════════════════════════════════════════════════════════════════════
   5. ภาพรวมของ 1 ล็อต/ซีเรียล — สิ่งที่หน้าจอ "ทวนสอบ" แสดง
   ══════════════════════════════════════════════════════════════════════════ */
function buildLotTrace_(lotKey) {
  var c = ctx_();
  var lot = c.lots[lotKey];
  if (!lot) {
    // ยังไม่มีใน master แต่มีการเคลื่อนไหว = ข้อมูล sync ไม่ครบ ให้เห็นแทนที่จะเงียบ
    if (!c.movesByLot[lotKey]) fail_('ไม่พบล็อต/ซีเรียล: ' + lotKey.split('|').join(' / '));
    var first = c.movesByLot[lotKey][0];
    lot = { lot_key: lotKey, item_code: first.item_code, dist_number: first.dist_number,
            kind: first.kind, supplier_lot: '', in_date: '', exp_date: '',
            notes: 'ไม่พบใน SAP_Lots — ข้อมูล sync อาจไม่ครบ' };
  }
  var item = c.items[String(lot.item_code)] || {};
  var back = traceBackward_(lotKey);
  var fwd = traceForward_(lotKey);
  var rec = reconcile_(lotKey);

  var m = mgsCtx_();
  var note = m.notes[lotKey] || null;
  var holds = m.holds[lotKey] || [];
  var scopes = m.scopes[lotKey] || [];

  return {
    lot: {
      lot_key: lotKey,
      item_code: String(lot.item_code || ''),
      item_name: String(item.item_name || lot.item_code || ''),
      brand: String(item.brand || ''),
      product_type: String(item.product_type || ''),
      model: String(item.item_name || ''),
      uom: String(item.uom || ''),
      dist_number: String(lot.dist_number || ''),
      kind: String(lot.kind || item.mng_method || ''),
      supplier_lot: String(lot.supplier_lot || ''),
      mnf_serial: String(lot.mnf_serial || ''),
      in_date: String(lot.in_date || ''),
      exp_date: String(lot.exp_date || ''),
      notes: String(lot.notes || '')
    },
    backward: back,
    forward: fwd,
    reconcile: rec,
    mgs_note: note ? {
      mgs_receiving_lot: String(note.mgs_receiving_lot || ''),
      qc_status: String(note.qc_status || ''),
      note: String(note.note || ''),
      updated_by: String(note.updated_by || ''),
      updated_at: String(note.updated_at || '')
    } : null,
    holds: holds.map(function (h) {
      return { hold_id: String(h.hold_id), case_no: String(h.case_no),
               whs_code: String(h.whs_code), whs_name: whsName_(h.whs_code),
               qty_hold: parseQty_(h.qty_hold), placed_at: String(h.placed_at),
               placed_by: String(h.placed_by) };
    }),
    recall_cases: dedupe_(scopes.map(function (s) { return String(s.case_no); }))
  };
}

function dedupe_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   6. ค้นหา — คนหน้างานพิมพ์อะไรมาก็ต้องเจอ
   รองรับ: ซีเรียล · เลขล็อต · ล็อตของผู้ขาย · รหัส/ชื่อสินค้า
           เลข PO · เลขใบรับ · เลข DO · เลขใบกำกับ · ชื่อลูกค้า · ชื่อโครงการ
   ══════════════════════════════════════════════════════════════════════════ */
function searchLots_(q, limit) {
  var needle = normalize_(q);
  if (needle.length < 2) fail_('พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา');
  limit = limit || 200;

  var c = ctx_();
  var hits = {};   // lot_key -> เหตุผลที่แมตช์

  function hit(k, why) { if (!hits[k]) hits[k] = why; }

  // 1) แมตช์จาก master ของล็อต
  Object.keys(c.lots).forEach(function (k) {
    var l = c.lots[k];
    var item = c.items[String(l.item_code)] || {};
    if (normalize_(l.dist_number).indexOf(needle) !== -1) return hit(k, 'เลขล็อต/ซีเรียล');
    if (normalize_(l.supplier_lot).indexOf(needle) !== -1) return hit(k, 'ล็อตของผู้ขาย');
    if (normalize_(l.mnf_serial).indexOf(needle) !== -1) return hit(k, 'ซีเรียลผู้ผลิต');
    if (normalize_(l.item_code).indexOf(needle) !== -1) return hit(k, 'รหัสสินค้า');
    if (normalize_(item.item_name).indexOf(needle) !== -1) return hit(k, 'ชื่อสินค้า');
  });

  // 2) แมตช์จากเอกสารที่ล็อตนั้นเดินผ่าน
  c.allMoves.forEach(function (m) {
    var k = String(m.lot_key);
    if (hits[k]) return;
    if (normalize_(m.doc_num).indexOf(needle) !== -1) return hit(k, 'เลขที่เอกสาร ' + objInfo_(m.obj_type).name);
    if (normalize_(m.card_name).indexOf(needle) !== -1) return hit(k, 'ชื่อคู่ค้า');
    if (normalize_(m.card_code).indexOf(needle) !== -1) return hit(k, 'รหัสคู่ค้า');
    if (normalize_(m.project).indexOf(needle) !== -1) return hit(k, 'โครงการ');
  });

  // 3) แมตช์เลข PO ของผู้ขาย ผ่านใบรับสินค้า
  readTableCached_(TAB.GRPO).rows.forEach(function (g) {
    if (normalize_(g.base_doc_num).indexOf(needle) === -1 &&
        normalize_(g.num_at_card).indexOf(needle) === -1) return;
    c.allMoves.forEach(function (m) {
      if (String(m.obj_type) === '20' && String(m.doc_entry) === String(g.doc_entry) &&
          String(m.item_code) === String(g.item_code)) {
        hit(String(m.lot_key), 'เลข PO / ใบกำกับผู้ขาย');
      }
    });
  });

  var keys = Object.keys(hits).slice(0, limit);
  return {
    total: Object.keys(hits).length,
    shown: keys.length,
    results: keys.map(function (k) {
      var l = c.lots[k] || {};
      var item = c.items[String(l.item_code)] || {};
      var r = reconcile_(k);
      return {
        lot_key: k,
        item_code: String(l.item_code || k.split('|')[0]),
        item_name: String(item.item_name || ''),
        brand: String(item.brand || ''),
        dist_number: String(l.dist_number || k.split('|')[1]),
        kind: String(l.kind || ''),
        supplier_lot: String(l.supplier_lot || ''),
        received: r.received,
        shipped_out: r.shipped_out,
        on_hand: r.on_hand,
        unaccounted: r.unaccounted,
        matched_on: hits[k]
      };
    })
  };
}

/** ตัดช่องว่างและตัวคั่นออกก่อนเทียบ — คนพิมพ์ SN มีขีดบ้างไม่มีบ้าง */
function normalize_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/ /g, ' ').trim().toUpperCase().replace(/[\s\-_.]/g, '');
}

/* ══════════════════════════════════════════════════════════════════════════
   7. ทวนสอบจากฝั่งเอกสาร — ลูกค้าโทรมาพร้อมเลข DO
   "ใบส่งของใบนี้มีของล็อตไหนบ้าง" คือคำถามแรกเสมอเวลามีปัญหาหน้างาน
   ══════════════════════════════════════════════════════════════════════════ */
function traceFromDocument_(docNum) {
  var needle = normalize_(docNum);
  if (needle.length < 2) fail_('กรุณาระบุเลขที่เอกสาร');
  var c = ctx_();
  var lines = c.allMoves.filter(function (m) { return normalize_(m.doc_num) === needle; });
  if (!lines.length) fail_('ไม่พบเอกสารเลขที่ ' + docNum + ' ในข้อมูลที่ sync มาจาก SAP');

  var head = lines[0];
  var info = objInfo_(head.obj_type);
  return {
    doc: {
      doc_num: String(head.doc_num),
      doc_type: info.doc,
      doc_type_th: info.name,
      doc_date: String(head.doc_date || ''),
      party_code: String(head.card_code || ''),
      party_name: String(head.card_name || ''),
      project: String(head.project || ''),
      direction: String(head.direction || '')
    },
    lines: lines.map(function (m) {
      var item = c.items[String(m.item_code)] || {};
      return {
        lot_key: String(m.lot_key),
        item_code: String(m.item_code),
        item_name: String(item.item_name || ''),
        dist_number: String(m.dist_number || ''),
        kind: String(m.kind || ''),
        qty: m.quantity,
        whs_code: String(m.whs_code || ''),
        whs_name: whsName_(m.whs_code)
      };
    })
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   8. หาปลายทางทั้งหมดของหลายล็อตพร้อมกัน — ใช้ตอนเปิดเคสเรียกคืน
   รวมยอดต่อ (ปลายทาง + โครงการ + เอกสาร + สินค้า) ไม่ใช่ต่อซีเรียล
   เพราะการเรียกคืน 20 เครื่องจากลูกค้า 2 รายคือการโทร 2 สาย ไม่ใช่ 20 สาย
   — ตรงกับฟอร์ม FM-QC-RC-02 ที่เขียน "SG50R-A006–A012" ในแถวเดียว

   @param {Array<string>} lotKeys
   @param {Object<string,number>} shareByLot สัดส่วนที่กระทบของแต่ละล็อต (0–1)
          ล็อต 500 ชิ้นที่กระทบ 100 ชิ้น = 0.2 ไม่เรียกคืนทั้งล็อต
   ══════════════════════════════════════════════════════════════════════════ */
function destinationsForLots_(lotKeys, shareByLot) {
  var c = ctx_();
  var bucket = {};
  shareByLot = shareByLot || {};

  function slot(id, seed) {
    if (!bucket[id]) {
      seed.qty = 0;
      seed.lot_keys = [];
      seed.dist_numbers = [];
      bucket[id] = seed;
    }
    return bucket[id];
  }

  lotKeys.forEach(function (k) {
    var share = (shareByLot[k] === undefined) ? 1 : shareByLot[k];
    var parts = k.split('|');

    // ของที่ส่งออกไปหาลูกค้าแล้ว
    (c.movesByLot[k] || []).forEach(function (m) {
      if (String(m.direction).toUpperCase() !== 'OUT') return;
      if (OUTBOUND_TO_CUSTOMER.indexOf(String(m.obj_type)) === -1) return;
      var info = objInfo_(m.obj_type);
      var id = ['CUSTOMER', String(m.card_code), String(m.project || ''),
                String(m.doc_num), String(m.item_code)].join('~');
      var b = slot(id, {
        location_type: 'CUSTOMER',
        party_code: String(m.card_code || ''),
        party_name: String(m.card_name || ''),
        project: String(m.project || ''),
        doc_type: info.doc,
        doc_num: String(m.doc_num || ''),
        doc_date: String(m.doc_date || ''),
        item_code: String(m.item_code)
      });
      b.qty = round3_(b.qty + m.quantity * share);
      b.lot_keys.push(k);
      b.dist_numbers.push(String(m.dist_number || parts[1] || ''));
    });

    // ของที่ยังอยู่ในคลัง
    (c.stockByLot[k] || []).forEach(function (s) {
      if (!s.quantity) return;
      var isCust = whsIsCustomerSite_(s.whs_code);
      var id = ['STOCK', s.whs_code, '', '', parts[0]].join('~');
      var b = slot(id, {
        location_type: isCust ? 'CUSTOMER_SITE' : 'WAREHOUSE',
        party_code: s.whs_code,
        party_name: whsName_(s.whs_code),
        project: '',
        doc_type: 'STOCK',
        doc_num: '',
        doc_date: '',
        item_code: parts[0]
      });
      b.qty = round3_(b.qty + s.quantity * share);
      b.lot_keys.push(k);
      b.dist_numbers.push(parts[1] || '');
    });
  });

  return Object.keys(bucket).map(function (id) {
    var b = bucket[id];
    b.bucket_id = id;
    b.dist_numbers = dedupe_(b.dist_numbers);
    b.lot_keys = dedupe_(b.lot_keys);
    b.sn_display = summarizeSerials_(b.dist_numbers);
    return b;
  }).filter(function (b) { return b.qty > 0; })
    .sort(function (a, b) {
      // ของในคลังขึ้นก่อน — กักได้ทันที ไม่ต้องรอใคร
      if (a.location_type !== b.location_type) return a.location_type === 'WAREHOUSE' ? -1 : 1;
      return b.qty - a.qty;
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   9. ขยายช่วงซีเรียล — "SG50R-A001 – SG50R-A020" ที่คนเขียนในฟอร์มกระดาษ
   คืนเฉพาะซีเรียลที่ "มีอยู่จริงใน SAP" เท่านั้น ไม่เดาเลขที่ไม่มีตัวตน
   ══════════════════════════════════════════════════════════════════════════ */
function expandSerialRange_(itemCode, snFrom, snTo) {
  var c = ctx_();
  var from = String(snFrom || '').trim(), to = String(snTo || '').trim();
  if (!from) fail_('กรุณาระบุซีเรียลเริ่มต้น');
  if (!to) to = from;

  var all = [];
  Object.keys(c.lots).forEach(function (k) {
    var l = c.lots[k];
    if (String(l.item_code) !== String(itemCode)) return;
    all.push(String(l.dist_number));
  });
  if (!all.length) fail_('ไม่พบซีเรียลของสินค้า ' + itemCode + ' ในข้อมูลจาก SAP');

  all.sort(function (a, b) { return a.localeCompare(b, 'en', { numeric: true }); });

  var lo = from.localeCompare(to, 'en', { numeric: true }) <= 0 ? from : to;
  var hi = lo === from ? to : from;

  var picked = all.filter(function (sn) {
    return sn.localeCompare(lo, 'en', { numeric: true }) >= 0 &&
           sn.localeCompare(hi, 'en', { numeric: true }) <= 0;
  });
  if (!picked.length) {
    fail_('ไม่พบซีเรียลในช่วง ' + lo + ' ถึง ' + hi + ' — ตรวจสอบว่าพิมพ์ตรงกับที่บันทึกใน SAP');
  }
  return picked;
}

/** ย่อรายการซีเรียลให้อ่านง่ายในรายงาน: A001–A005 (5 หน่วย) */
function summarizeSerials_(serials) {
  if (!serials || !serials.length) return '';
  if (serials.length === 1) return serials[0];
  var s = serials.slice().sort(function (a, b) { return a.localeCompare(b, 'en', { numeric: true }); });
  return s[0] + '–' + s[s.length - 1] + ' (' + s.length + ' หน่วย)';
}


/* ════════════════════════════════════════════════════════ 03_Recall.gs ════ */

/**
 * MGS Traceability & Recall — 03_Recall.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * วงจรชีวิตของเคสเรียกคืน (FM-QC-RC-01 + FM-QC-RC-02)
 *
 *   DRAFT ──► OPEN ──► CONTAINED ──► TRACKING ──► VERIFYING ──► CLOSED
 *                └──────────┴──► CANCELLED
 *
 * สิ่งที่ระบบทำให้แทนคน (ต่างจากฟอร์ม Excel เดิม)
 *   · คำนวณ "ของกระทบทั้งหมด / อยู่ในคลัง / ส่งไปแล้ว / หายไป" จาก SAP ไม่ใช่ให้คนคีย์
 *   · สร้างแถวติดตามลูกค้า-โครงการ-คลัง ครบทุกปลายทางอัตโนมัติ ไม่ต้องไล่หาเอง
 *   · กักของในคลังทันทีที่เปิดเคส และปลดได้เฉพาะผู้จัดการคุณภาพ
 *   · คำนวณ % ประสิทธิผลใหม่ทุกครั้งที่มีคนอัปเดตแถวติดตาม
 */

/* ══════════════════════════════════════════════════════════════════════════
   1. เปิดเคส
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * @param {{clientKey:string, source:string, source_ref:string, item_code:string,
 *          problem:string, risk_class:string, immediate_action:string,
 *          case_owner:string, scope:Array<{kind:string, dist_number:string,
 *          sn_from:string, sn_to:string, qty_affected:number}>}} p
 */
function openCase_(p, user) {
  var itemCode = str_(p.item_code, 60);
  if (!itemCode) fail_('กรุณาเลือกสินค้า');
  if (!CASE_SOURCE[p.source]) fail_('ที่มาของเคสไม่ถูกต้อง');
  if (!RISK_CLASS[p.risk_class]) fail_('ระดับความเสี่ยงไม่ถูกต้อง');
  var problem = str_(p.problem, 2000);
  if (problem.length < 10) fail_('กรุณาอธิบายปัญหาอย่างน้อย 10 ตัวอักษร — ข้อความนี้จะถูกส่งให้ทุกแผนกที่เกี่ยวข้อง');
  if (!p.scope || !p.scope.length) fail_('กรุณาระบุล็อตหรือช่วงซีเรียลที่ได้รับผลกระทบอย่างน้อย 1 รายการ');
  if (p.scope.length > 200) fail_('ระบุขอบเขตได้ไม่เกิน 200 รายการต่อเคส');

  var c = ctx_();
  var item = c.items[itemCode];
  if (!item) fail_('ไม่พบรหัสสินค้า ' + itemCode + ' ในข้อมูลจาก SAP');

  // แปลงขอบเขตที่ผู้ใช้ระบุ -> รายการ lot_key จริงที่มีอยู่ใน SAP
  var scopeRows = [];
  p.scope.forEach(function (s) {
    var kind = String(s.kind || item.mng_method || '').toUpperCase();
    if (kind === MNG.SERIAL) {
      var serials = expandSerialRange_(itemCode, s.sn_from, s.sn_to);
      serials.forEach(function (sn) {
        scopeRows.push({ kind: MNG.SERIAL, dist_number: sn, lot_key: lotKey_(itemCode, sn),
                         sn_from: sn, sn_to: sn, qty: 1 });
      });
    } else {
      var dn = str_(s.dist_number, 60);
      if (!dn) fail_('กรุณาระบุเลขล็อต');
      var k = lotKey_(itemCode, dn);
      if (!c.lots[k] && !c.movesByLot[k]) fail_('ไม่พบล็อต ' + dn + ' ของสินค้า ' + itemCode + ' ใน SAP');
      var q = (s.qty_affected === '' || s.qty_affected === undefined || s.qty_affected === null)
        ? reconcile_(k).received
        : parseQtyPos_(s.qty_affected, 'จำนวนที่กระทบ');
      if (q <= 0) fail_('จำนวนที่กระทบของล็อต ' + dn + ' ต้องมากกว่า 0');
      scopeRows.push({ kind: MNG.BATCH, dist_number: dn, lot_key: k,
                       sn_from: '', sn_to: '', qty: q });
    }
  });

  // ตัดล็อตซ้ำ — ผู้ใช้ระบุช่วงซีเรียลทับกันได้ง่าย
  var seen = {}, uniq = [];
  scopeRows.forEach(function (r) { if (!seen[r.lot_key]) { seen[r.lot_key] = 1; uniq.push(r); } });
  scopeRows = uniq;

  // ช่วงซีเรียลกว้างมากทำให้คำขอเดียวต้องเขียนหลายพันแถว แล้วชนเพดาน 6 นาทีของ Apps Script
  // ตัดตั้งแต่ต้นดีกว่าปล่อยให้เขียนไปครึ่งทางแล้วตาย — เคสที่เปิดค้างครึ่ง ๆ กลาง ๆ แก้ยากที่สุด
  if (scopeRows.length > 1000) {
    fail_('ขอบเขตกว้างเกินไป (' + scopeRows.length + ' ล็อต/ซีเรียล) — ระบบรับได้ครั้งละไม่เกิน 1,000 รายการ\n' +
          'ให้แบ่งเปิดเป็นหลายเคสตามช่วงซีเรียล หรือระบุเป็นเลขล็อตแทนการไล่ทีละซีเรียล');
  }

  var caseNo = nextDocNo_(TAB.CASES, 'case_no', 'RC');
  var now = nowStamp_();
  var folderId = createCaseFolder_(caseNo);

  var totals = computeScopeTotals_(scopeRows);
  var risk = RISK_CLASS[p.risk_class];

  var row = {
    case_id: uuid_(),
    case_no: caseNo,
    status: 'OPEN',
    opened_at: now,
    opened_by: user.email,
    case_owner: str_(p.case_owner, 120) || user.email,
    source: p.source,
    source_ref: str_(p.source_ref, 200),
    product_type: str_(item.product_type, 60),
    brand: str_(item.brand, 60),
    item_code: itemCode,
    model: str_(item.item_name, 120),
    problem: problem,
    risk_class: p.risk_class,
    immediate_action: str_(p.immediate_action, 500) || 'กักของที่ยังอยู่ในคลัง และตามหาของที่ส่งออกไปแล้ว',
    escalated: risk.escalate ? 'TRUE' : 'FALSE',
    escalated_at: risk.escalate ? now : '',
    recall_required: '',
    field_action: '',
    customer_notify_required: '',
    supplier_claim_required: '',
    qty_affected: totals.affected,
    qty_in_stock: totals.in_stock,
    qty_delivered: totals.delivered,
    qty_unaccounted: totals.unaccounted,
    qty_returned: 0,
    qty_replaced: 0,
    qty_corrected: 0,
    effectiveness_pct: 0,
    closed_at: '', closed_by: '', closure_note: '',
    drive_folder_id: folderId,
    created_at: now,
    updated_by: user.email,
    updated_at: now,
    row_version: 1
  };

  appendRows_(TAB.CASES, [row]);

  appendRows_(TAB.SCOPE, scopeRows.map(function (s) {
    return { scope_id: uuid_(), case_no: caseNo, item_code: itemCode, kind: s.kind,
             dist_number: s.dist_number, sn_from: s.sn_from, sn_to: s.sn_to,
             lot_key: s.lot_key, qty_affected: s.qty, added_by: user.email,
             added_at: now, note: '' };
  }));

  // สร้างช่องการสอบสวน/CAPA/การตัดสินใจ ครบทุกหัวข้อตามฟอร์ม RC-01
  appendRows_(TAB.ACTIONS, ACTION_SECTIONS.map(function (s, i) {
    return { action_id: uuid_(), case_no: caseNo, section_type: s.type, section: s.key,
             seq: i + 1, details: '', responsible: '', target_date: '', status: 'OPEN',
             evidence_file_ids: '', approved_by: '', approved_at: '', remark: '',
             created_at: now, updated_by: user.email, updated_at: now, row_version: 1 };
  }));

  // กักของในคลังทันที — นี่คือสิ่งที่ต้องเกิดก่อนอย่างอื่นทั้งหมด
  var holds = placeHoldsForScope_(caseNo, scopeRows, user, now);

  // สร้างแถวติดตามทุกปลายทาง
  var tracks = buildTrackingRows_(caseNo, scopeRows, user, now);

  logAudit_('OPEN_CASE', 'Recall_Cases', caseNo, null,
            { qty_affected: totals.affected, lots: scopeRows.length, holds: holds, tracks: tracks },
            p.clientKey);

  notifyCaseOpened_(row, totals, holds, tracks);

  return ok_({ case_no: caseNo, holds: holds, tracking_rows: tracks, totals: totals });
}

/** ยอดรวมของขอบเขต — คิดจาก SAP ไม่ใช่จากที่คนกรอก */
function computeScopeTotals_(scopeRows) {
  var affected = 0, inStock = 0, delivered = 0, other = 0;
  scopeRows.forEach(function (s) {
    var r = reconcile_(s.lot_key);
    var qty = Number(s.qty_affected !== undefined ? s.qty_affected : s.qty) || 0;
    affected += qty;
    // สัดส่วนที่กระทบเทียบกับล็อตทั้งหมด — ล็อตใหญ่ที่กระทบบางส่วนต้องไม่นับเกินจริง
    var share = r.received > 0 ? Math.min(1, qty / r.received) : 1;
    inStock   += r.on_hand * share;
    delivered += r.shipped_out * share;
    other     += (r.returned_to_supplier + r.other_out) * share;
  });
  affected = round3_(affected);
  inStock = round3_(inStock);
  delivered = round3_(delivered);
  other = round3_(other);
  return {
    affected: affected,
    in_stock: inStock,
    delivered: delivered,
    other_out: other,
    unaccounted: round3_(Math.max(affected - inStock - delivered - other, 0))
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2. กักของ
   ══════════════════════════════════════════════════════════════════════════ */
function placeHoldsForScope_(caseNo, scopeRows, user, now) {
  var c = ctx_();
  var rows = [];
  scopeRows.forEach(function (s) {
    (c.stockByLot[s.lot_key] || []).forEach(function (st) {
      if (!st.quantity || st.quantity <= 0) return;
      var parts = s.lot_key.split('|');
      rows.push({
        hold_id: uuid_(), case_no: caseNo, lot_key: s.lot_key,
        item_code: parts[0], dist_number: parts[1] || '',
        whs_code: st.whs_code, qty_hold: st.quantity, status: 'HOLD',
        placed_by: user.email, placed_at: now,
        released_by: '', released_at: '', release_reason: '', row_version: 1
      });
    });
  });
  appendRows_(TAB.HOLDS, rows);
  return rows.length;
}

function releaseHold_(p, user) {
  var holdId = str_(p.hold_id, 60);
  var reason = str_(p.reason, 500);
  if (reason.length < 5) fail_('กรุณาระบุเหตุผลที่ปลดการกัก — ข้อความนี้ถูกบันทึกถาวรและใช้ตอนตรวจสอบ');
  var h = findRow_(TAB.HOLDS, 'hold_id', holdId);
  if (!h) fail_('ไม่พบรายการกักนี้');
  if (String(h.status).toUpperCase() !== 'HOLD') fail_('รายการนี้ถูกปลดไปแล้วเมื่อ ' + h.released_at);

  var r = updateRow_(TAB.HOLDS, 'hold_id', holdId, {
    status: 'RELEASED', released_by: user.email, released_at: nowStamp_(), release_reason: reason
  }, p.row_version);

  logAudit_('RELEASE_HOLD', 'Holds', holdId, r.before, r.after, p.clientKey);
  notifyLarkText_('🔓 ปลดการกักสินค้า ' + h.item_code + ' / ' + h.dist_number +
                  ' คลัง ' + h.whs_code + ' จำนวน ' + h.qty_hold +
                  '\nเคส ' + h.case_no + ' · โดย ' + user.email + '\nเหตุผล: ' + reason);
  return ok_({ hold_id: holdId });
}

/* ══════════════════════════════════════════════════════════════════════════
   3. สร้างแถวติดตาม — หัวใจของ FM-QC-RC-02
   ══════════════════════════════════════════════════════════════════════════ */
function buildTrackingRows_(caseNo, scopeRows, user, now) {
  var c = ctx_();
  var lotKeys = scopeRows.map(function (s) { return s.lot_key; });

  // สัดส่วนที่กระทบต่อล็อต — ล็อตที่กระทบบางส่วนต้องไม่เรียกคืนทั้งล็อต
  var shareByLot = {};
  scopeRows.forEach(function (s) {
    var r = reconcile_(s.lot_key);
    var qty = Number(s.qty_affected !== undefined ? s.qty_affected : s.qty) || 0;
    shareByLot[s.lot_key] = r.received > 0 ? Math.min(1, qty / r.received) : 1;
  });

  var dests = destinationsForLots_(lotKeys, shareByLot);

  // แถวที่มีอยู่แล้วของเคสนี้ — กันการสร้างซ้ำเมื่อกด "สร้างรายการติดตามใหม่"
  var existing = {};
  findRows_(TAB.TRACKING, 'case_no', caseNo).forEach(function (t) {
    existing[[String(t.location_type), String(t.party_code), String(t.project),
              String(t.doc_num), String(t.item_code)].join('~')] = true;
  });

  var rows = [];
  dests.forEach(function (d) {
    var dedupeKey = [d.location_type === 'CUSTOMER' ? 'CUSTOMER' : d.location_type,
                     d.party_code, d.project, d.doc_num, d.item_code].join('~');
    if (existing[dedupeKey]) return;
    if (d.qty <= 0) return;
    var item = c.items[String(d.item_code)] || {};
    var inWarehouse = d.location_type === 'WAREHOUSE';
    rows.push({
      track_id: uuid_(), case_no: caseNo,
      item_code: d.item_code, model: str_(item.item_name, 120),
      lot_key: d.lot_keys.length === 1 ? d.lot_keys[0] : '',
      dist_number: d.dist_numbers.length === 1 ? d.dist_numbers[0] : '',
      sn_display: d.sn_display,
      location_type: d.location_type, party_code: d.party_code, party_name: d.party_name,
      project: d.project, doc_type: d.doc_type, doc_num: d.doc_num, doc_date: d.doc_date,
      qty_affected: d.qty,
      contacted_at: '', contacted_by: '',
      // ของในคลังกักได้ทันทีเอง ของที่ส่งไปแล้วต้องให้คนตัดสินใจว่าจะคืน เปลี่ยน หรือแก้หน้างาน
      required_action: inWarehouse ? 'HOLD' : 'INSPECT_CORRECT',
      qty_returned: 0, qty_replaced: 0, qty_corrected: 0, qty_pending: d.qty,
      status: inWarehouse ? 'IN_PROGRESS' : 'PENDING',
      evidence_file_ids: '', remark: '',
      created_at: now, updated_by: user.email, updated_at: now, row_version: 1
    });
  });

  appendRows_(TAB.TRACKING, rows);
  return rows.length;
}

/** เรียกสร้างแถวติดตามใหม่ (ใช้เมื่อ sync ข้อมูล SAP มาแล้วเจอปลายทางเพิ่ม) */
function rebuildTracking_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var cs = requireOpenCase_(caseNo);
  var scopeRows = findRows_(TAB.SCOPE, 'case_no', caseNo).map(function (s) {
    return { lot_key: String(s.lot_key), kind: String(s.kind),
             dist_number: String(s.dist_number), qty_affected: parseQty_(s.qty_affected) };
  });
  if (!scopeRows.length) fail_('เคสนี้ยังไม่มีขอบเขต');
  var added = buildTrackingRows_(caseNo, scopeRows, user, nowStamp_());
  var holds = placeHoldsForScopeIfNew_(caseNo, scopeRows, user);
  recomputeCase_(caseNo, user);
  logAudit_('REBUILD_TRACKING', 'Recall_Cases', caseNo, null, { added: added, holds: holds }, p.clientKey);
  return ok_({ added: added, holds_added: holds, case_status: cs.status });
}

function placeHoldsForScopeIfNew_(caseNo, scopeRows, user) {
  var have = {};
  findRows_(TAB.HOLDS, 'case_no', caseNo).forEach(function (h) {
    have[String(h.lot_key) + '|' + String(h.whs_code)] = true;
  });
  var fresh = [];
  var c = ctx_();
  scopeRows.forEach(function (s) {
    (c.stockByLot[s.lot_key] || []).forEach(function (st) {
      if (!st.quantity || st.quantity <= 0) return;
      if (have[s.lot_key + '|' + st.whs_code]) return;
      fresh.push(s);
    });
  });
  if (!fresh.length) return 0;
  return placeHoldsForScope_(caseNo, fresh, user, nowStamp_());
}

/* ══════════════════════════════════════════════════════════════════════════
   4. อัปเดตแถวติดตาม — งานประจำวันของ QC/คลัง/ขาย
   ══════════════════════════════════════════════════════════════════════════ */
function updateTracking_(p, user) {
  var trackId = str_(p.track_id, 60);
  var t = findRow_(TAB.TRACKING, 'track_id', trackId);
  if (!t) fail_('ไม่พบรายการติดตามนี้');
  var cs = findRow_(TAB.CASES, 'case_no', String(t.case_no));
  if (!cs) fail_('ไม่พบเคส ' + t.case_no);
  if (['CLOSED', 'CANCELLED'].indexOf(String(cs.status)) !== -1) {
    fail_('เคส ' + t.case_no + ' ปิดแล้ว แก้ไขรายการติดตามไม่ได้');
  }

  var affected = parseQty_(t.qty_affected, 'จำนวนที่กระทบ');
  var ret = parseQtyPos_(pick_(p.qty_returned,  t.qty_returned),  'จำนวนที่รับคืน');
  var rep = parseQtyPos_(pick_(p.qty_replaced,  t.qty_replaced),  'จำนวนที่เปลี่ยนใหม่');
  var cor = parseQtyPos_(pick_(p.qty_corrected, t.qty_corrected), 'จำนวนที่แก้ไข/ตรวจแล้ว');

  var done = round3_(ret + rep + cor);
  if (done > affected + 0.0001) {
    fail_('จำนวนที่ดำเนินการแล้ว (' + done + ') มากกว่าจำนวนที่กระทบ (' + affected + ') — กรุณาตรวจสอบตัวเลข');
  }

  var action = p.required_action !== undefined ? String(p.required_action) : String(t.required_action);
  if (!REQUIRED_ACTION[action]) fail_('การดำเนินการที่ระบุไม่ถูกต้อง');

  var status = p.status !== undefined ? String(p.status) : String(t.status);
  if (!TRACK_STATUS[status]) fail_('สถานะที่ระบุไม่ถูกต้อง');

  var pending = round3_(affected - done);
  // ปิดแถวได้ก็ต่อเมื่อจำนวนครบจริง — กันการติ๊ก "เสร็จสิ้น" ทั้งที่ของยังค้าง
  if (status === 'COMPLETED' && pending > CFG.RECONCILE_TOLERANCE_QTY) {
    fail_('ยังเหลือ ' + pending + ' หน่วยที่ยังไม่ได้รับคืน/เปลี่ยน/แก้ไข — ปิดรายการนี้ไม่ได้');
  }
  if (status !== 'COMPLETED' && pending <= 0 && done > 0) status = 'COMPLETED';

  var contactedAt = String(t.contacted_at || '');
  var contactedBy = String(t.contacted_by || '');
  if (!contactedAt && ['CONTACTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_REACHED'].indexOf(status) !== -1) {
    contactedAt = nowStamp_();
    contactedBy = user.email;
  }

  var res = withLock_(function () {
    return updateRow_(TAB.TRACKING, 'track_id', trackId, {
      required_action: action,
      qty_returned: ret, qty_replaced: rep, qty_corrected: cor, qty_pending: pending,
      status: status,
      contacted_at: contactedAt, contacted_by: contactedBy,
      evidence_file_ids: str_(pick_(p.evidence_file_ids, t.evidence_file_ids), 1000),
      remark: str_(pick_(p.remark, t.remark), 1000),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  var totals = recomputeCase_(String(t.case_no), user);
  logAudit_('UPDATE_TRACKING', 'Recall_Tracking', trackId, res.before, res.after, p.clientKey);
  return ok_({ track_id: trackId, case_totals: totals, row_version: res.after.row_version });
}

function pick_(a, b) { return (a === undefined || a === null) ? b : a; }

/* ══════════════════════════════════════════════════════════════════════════
   5. คำนวณยอดรวมและ % ประสิทธิผลของเคสใหม่
   ══════════════════════════════════════════════════════════════════════════ */
function recomputeCase_(caseNo, user) {
  var tracks = findRows_(TAB.TRACKING, 'case_no', caseNo);
  var ret = 0, rep = 0, cor = 0, aff = 0;
  tracks.forEach(function (t) {
    aff += parseQty_(t.qty_affected);
    ret += parseQty_(t.qty_returned);
    rep += parseQty_(t.qty_replaced);
    cor += parseQty_(t.qty_corrected);
  });
  var scopeRows = findRows_(TAB.SCOPE, 'case_no', caseNo).map(function (s) {
    return { lot_key: String(s.lot_key), qty_affected: parseQty_(s.qty_affected) };
  });
  var totals = computeScopeTotals_(scopeRows);
  var done = round3_(ret + rep + cor);
  var pct = aff > 0 ? round3_(done / aff) : 0;

  withLock_(function () {
    updateRow_(TAB.CASES, 'case_no', caseNo, {
      qty_affected: totals.affected,
      qty_in_stock: totals.in_stock,
      qty_delivered: totals.delivered,
      qty_unaccounted: totals.unaccounted,
      qty_returned: round3_(ret), qty_replaced: round3_(rep), qty_corrected: round3_(cor),
      effectiveness_pct: pct,
      updated_by: user ? user.email : 'system', updated_at: nowStamp_()
    }, null);
  });

  return { affected: totals.affected, in_stock: totals.in_stock, delivered: totals.delivered,
           unaccounted: totals.unaccounted, returned: round3_(ret), replaced: round3_(rep),
           corrected: round3_(cor), effectiveness_pct: pct,
           tracked_total: round3_(aff), tracked_done: done };
}

/* ══════════════════════════════════════════════════════════════════════════
   6. เปลี่ยนสถานะเคส — เดินหน้าอย่างเดียว ตรวจเงื่อนไขทุกครั้ง
   ══════════════════════════════════════════════════════════════════════════ */
function advanceCase_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var to = String(p.to_status || '').toUpperCase();
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  var from = String(cs.status).toUpperCase();
  assertTransition_(from, to);

  // เงื่อนไขก่อนเข้าสถานะใหม่ — เขียนไว้ที่เดียว
  if (to === 'CONTAINED') {
    var open = findRows_(TAB.HOLDS, 'case_no', caseNo).filter(function (h) {
      return String(h.status).toUpperCase() === 'HOLD';
    });
    var stockQty = parseQty_(cs.qty_in_stock);
    if (stockQty > 0 && !open.length) {
      fail_('ยังมีของในคลัง ' + stockQty + ' หน่วยที่ยังไม่ถูกกัก — กดสร้างรายการกักก่อน');
    }
  }
  if (to === 'VERIFYING') {
    var pend = findRows_(TAB.TRACKING, 'case_no', caseNo).filter(function (t) {
      return ['COMPLETED', 'NOT_REACHED'].indexOf(String(t.status).toUpperCase()) === -1;
    });
    if (pend.length) fail_('ยังมีรายการติดตามค้างอยู่ ' + pend.length + ' รายการ — ปิดให้ครบก่อนตรวจประสิทธิผล');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.CASES, 'case_no', caseNo, {
      status: to, updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  logAudit_('CASE_STATUS', 'Recall_Cases', caseNo, { status: from }, { status: to }, p.clientKey);
  notifyLarkText_('📋 เคส ' + caseNo + ' เปลี่ยนสถานะ ' + statusTh_(from) + ' → ' + statusTh_(to) +
                  '\nโดย ' + user.email);
  return ok_({ case_no: caseNo, status: to, row_version: res.after.row_version });
}

function assertTransition_(from, to) {
  var def = CASE_STATUS[from];
  if (!def) fail_('สถานะปัจจุบันของเคสไม่ถูกต้อง: ' + from);
  if (def.next.indexOf(to) === -1) {
    fail_('เปลี่ยนสถานะจาก "' + statusTh_(from) + '" ไปเป็น "' + statusTh_(to) + '" ไม่ได้');
  }
}

function statusTh_(s) { return (CASE_STATUS[s] && CASE_STATUS[s].th) || s; }

function requireOpenCase_(caseNo) {
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  if (['CLOSED', 'CANCELLED'].indexOf(String(cs.status).toUpperCase()) !== -1) {
    fail_('เคส ' + caseNo + ' อยู่ในสถานะ ' + statusTh_(String(cs.status)) + ' แก้ไขไม่ได้');
  }
  return cs;
}

/* ══════════════════════════════════════════════════════════════════════════
   7. ปิดเคส / ยกเลิกเคส
   ══════════════════════════════════════════════════════════════════════════ */
function closeCase_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var note = str_(p.closure_note, 2000);
  if (note.length < 10) fail_('กรุณาสรุปผลการปิดเคสอย่างน้อย 10 ตัวอักษร');
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  assertTransition_(String(cs.status).toUpperCase(), 'CLOSED');
  assertVersion_(cs.row_version, p.row_version, 'เคส ' + caseNo);

  // ห้ามปิดถ้ายังมีของค้าง หรือยังมีการกักที่ไม่ได้ตัดสินใจ
  // recomputeCase_ ขยับ row_version เอง จึงตรวจเวอร์ชันไปแล้วข้างบน แล้วเขียนด้วย null
  var totals = recomputeCase_(caseNo, user);
  if (totals.tracked_total - totals.tracked_done > CFG.RECONCILE_TOLERANCE_QTY) {
    fail_('ยังเหลือของที่ยังไม่จบ ' + round3_(totals.tracked_total - totals.tracked_done) +
          ' หน่วย — ปิดเคสไม่ได้');
  }
  var stillHeld = findRows_(TAB.HOLDS, 'case_no', caseNo).filter(function (h) {
    return String(h.status).toUpperCase() === 'HOLD';
  });
  if (stillHeld.length) {
    fail_('ยังมีของถูกกักอยู่ ' + stillHeld.length + ' รายการ — ต้องปลดการกักหรือบันทึกการทำลายก่อนปิดเคส');
  }
  var openDecisions = findRows_(TAB.ACTIONS, 'case_no', caseNo).filter(function (a) {
    return String(a.section_type) === 'DECISION' && String(a.status).toUpperCase() === 'OPEN';
  });
  if (openDecisions.length) {
    fail_('ยังมีหัวข้อการตัดสินใจที่ยังไม่สรุป ' + openDecisions.length + ' หัวข้อ');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.CASES, 'case_no', caseNo, {
      status: 'CLOSED', closed_at: nowStamp_(), closed_by: user.email, closure_note: note,
      updated_by: user.email, updated_at: nowStamp_()
    }, null);
  });

  logAudit_('CLOSE_CASE', 'Recall_Cases', caseNo, { status: cs.status }, res.after, p.clientKey);
  notifyLarkText_('✅ ปิดเคสเรียกคืน ' + caseNo + ' แล้ว\nประสิทธิผล ' +
                  Math.round(totals.effectiveness_pct * 100) + '%\nสรุป: ' + note);
  return ok_({ case_no: caseNo, status: 'CLOSED' });
}

function cancelCase_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var reason = str_(p.reason, 1000);
  if (reason.length < 10) fail_('กรุณาระบุเหตุผลที่ยกเลิกอย่างน้อย 10 ตัวอักษร');
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  assertTransition_(String(cs.status).toUpperCase(), 'CANCELLED');

  var res = withLock_(function () {
    var r = updateRow_(TAB.CASES, 'case_no', caseNo, {
      status: 'CANCELLED', closed_at: nowStamp_(), closed_by: user.email,
      closure_note: 'ยกเลิก: ' + reason, updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
    // ปลดการกักทั้งหมดของเคสที่ยกเลิก — ของไม่ควรค้างอยู่ในสถานะกักโดยไม่มีเจ้าของ
    findRows_(TAB.HOLDS, 'case_no', caseNo).forEach(function (h) {
      if (String(h.status).toUpperCase() !== 'HOLD') return;
      updateRow_(TAB.HOLDS, 'hold_id', String(h.hold_id), {
        status: 'RELEASED', released_by: user.email, released_at: nowStamp_(),
        release_reason: 'ยกเลิกเคส: ' + reason
      }, null);
    });
    return r;
  });

  logAudit_('CANCEL_CASE', 'Recall_Cases', caseNo, { status: cs.status }, res.after, p.clientKey);
  notifyLarkText_('🚫 ยกเลิกเคส ' + caseNo + ' และปลดการกักทั้งหมด\nเหตุผล: ' + reason);
  return ok_({ case_no: caseNo, status: 'CANCELLED' });
}

/* ══════════════════════════════════════════════════════════════════════════
   8. การสอบสวน / CAPA / การตัดสินใจ
   ══════════════════════════════════════════════════════════════════════════ */
function updateAction_(p, user) {
  var actionId = str_(p.action_id, 60);
  var a = findRow_(TAB.ACTIONS, 'action_id', actionId);
  if (!a) fail_('ไม่พบหัวข้อนี้');
  requireOpenCase_(String(a.case_no));

  var status = p.status !== undefined ? String(p.status).toUpperCase() : String(a.status).toUpperCase();
  if (['OPEN', 'IN_PROGRESS', 'DONE', 'NA'].indexOf(status) === -1) fail_('สถานะไม่ถูกต้อง');
  var details = str_(pick_(p.details, a.details), 4000);
  if (status === 'DONE' && details.length < 5) fail_('ต้องกรอกรายละเอียดก่อนตั้งสถานะเป็น "เสร็จ"');

  var res = withLock_(function () {
    return updateRow_(TAB.ACTIONS, 'action_id', actionId, {
      details: details,
      responsible: str_(pick_(p.responsible, a.responsible), 120),
      target_date: p.target_date ? parseDate_(p.target_date, 'วันที่กำหนดเสร็จ') : String(a.target_date || ''),
      status: status,
      evidence_file_ids: str_(pick_(p.evidence_file_ids, a.evidence_file_ids), 1000),
      remark: str_(pick_(p.remark, a.remark), 1000),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  syncCaseDecisionFlags_(String(a.case_no), user);
  logAudit_('UPDATE_ACTION', 'Recall_Actions', actionId, res.before, res.after, p.clientKey);
  return ok_({ action_id: actionId, row_version: res.after.row_version });
}

function approveAction_(p, user) {
  var actionId = str_(p.action_id, 60);
  var a = findRow_(TAB.ACTIONS, 'action_id', actionId);
  if (!a) fail_('ไม่พบหัวข้อนี้');
  requireOpenCase_(String(a.case_no));
  if (String(a.status).toUpperCase() !== 'DONE') fail_('อนุมัติได้เฉพาะหัวข้อที่สถานะเป็น "เสร็จ" แล้ว');
  if (String(a.approved_by || '')) fail_('หัวข้อนี้อนุมัติไปแล้วโดย ' + a.approved_by);
  if (String(a.updated_by || '').toLowerCase() === user.email) {
    fail_('ผู้กรอกกับผู้อนุมัติต้องเป็นคนละคน');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.ACTIONS, 'action_id', actionId, {
      approved_by: user.email, approved_at: nowStamp_(),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  logAudit_('APPROVE_ACTION', 'Recall_Actions', actionId, res.before, res.after, p.clientKey);
  return ok_({ action_id: actionId, approved_by: user.email });
}

/** สะท้อนผลการตัดสินใจ 4 ข้อขึ้นไปที่หัวเคส เพื่อให้รายงานอ่านได้ในแถวเดียว */
function syncCaseDecisionFlags_(caseNo, user) {
  var map = {};
  findRows_(TAB.ACTIONS, 'case_no', caseNo).forEach(function (a) {
    if (String(a.section_type) !== 'DECISION') return;
    map[String(a.section)] = { status: String(a.status), details: String(a.details || '') };
  });
  var f = function (k) { return map[k] ? map[k].details : ''; };
  withLock_(function () {
    updateRow_(TAB.CASES, 'case_no', caseNo, {
      recall_required: f('RECALL_REQUIRED'),
      field_action: f('FIELD_ACTION'),
      customer_notify_required: f('CUSTOMER_NOTIFY'),
      supplier_claim_required: f('SUPPLIER_CLAIM'),
      updated_by: user ? user.email : 'system', updated_at: nowStamp_()
    }, null);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   9. โฟลเดอร์หลักฐานของเคส
   ══════════════════════════════════════════════════════════════════════════ */
function createCaseFolder_(caseNo) {
  try {
    if (!CFG.DRIVE_ROOT_ID) return '';
    var root = DriveApp.getFolderById(CFG.DRIVE_ROOT_ID);
    var it = root.getFoldersByName(caseNo);
    if (it.hasNext()) return it.next().getId();
    return root.createFolder(caseNo).getId();
  } catch (e) {
    console.error('createCaseFolder_ failed', e && e.stack);
    return '';    // สร้างโฟลเดอร์ไม่ได้ต้องไม่ทำให้เปิดเคสไม่ได้
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   10. อ่านเคสสำหรับหน้าจอ
   ══════════════════════════════════════════════════════════════════════════ */
function getCase_(caseNo) {
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  var c = ctx_();

  var scope = findRows_(TAB.SCOPE, 'case_no', caseNo);
  var tracking = findRows_(TAB.TRACKING, 'case_no', caseNo);
  var actions = findRows_(TAB.ACTIONS, 'case_no', caseNo);
  var holds = findRows_(TAB.HOLDS, 'case_no', caseNo);

  var sectionTh = {};
  ACTION_SECTIONS.forEach(function (s) { sectionTh[s.key] = s.th; });

  return {
    header: {
      case_no: String(cs.case_no), status: String(cs.status), status_th: statusTh_(String(cs.status)),
      next_status: (CASE_STATUS[String(cs.status)] || { next: [] }).next,
      opened_at: String(cs.opened_at), opened_by: String(cs.opened_by),
      case_owner: String(cs.case_owner),
      source: String(cs.source), source_th: CASE_SOURCE[String(cs.source)] || String(cs.source),
      source_ref: String(cs.source_ref || ''),
      product_type: String(cs.product_type || ''), brand: String(cs.brand || ''),
      item_code: String(cs.item_code), model: String(cs.model || ''),
      problem: String(cs.problem || ''),
      risk_class: String(cs.risk_class),
      risk_th: (RISK_CLASS[String(cs.risk_class)] || {}).th || String(cs.risk_class),
      immediate_action: String(cs.immediate_action || ''),
      escalated: isTrue_(cs.escalated),
      qty_affected: parseQty_(cs.qty_affected), qty_in_stock: parseQty_(cs.qty_in_stock),
      qty_delivered: parseQty_(cs.qty_delivered), qty_unaccounted: parseQty_(cs.qty_unaccounted),
      qty_returned: parseQty_(cs.qty_returned), qty_replaced: parseQty_(cs.qty_replaced),
      qty_corrected: parseQty_(cs.qty_corrected),
      effectiveness_pct: parseQty_(cs.effectiveness_pct),
      closed_at: String(cs.closed_at || ''), closed_by: String(cs.closed_by || ''),
      closure_note: String(cs.closure_note || ''),
      drive_folder_id: String(cs.drive_folder_id || ''),
      row_version: parseQty_(cs.row_version)
    },
    scope: scope.map(function (s) {
      return { scope_id: String(s.scope_id), kind: String(s.kind),
               dist_number: String(s.dist_number), lot_key: String(s.lot_key),
               qty_affected: parseQty_(s.qty_affected), note: String(s.note || '') };
    }),
    tracking: tracking.map(function (t) {
      return {
        track_id: String(t.track_id), item_code: String(t.item_code), model: String(t.model || ''),
        dist_number: String(t.dist_number || ''), sn_display: String(t.sn_display || ''),
        location_type: String(t.location_type), party_code: String(t.party_code || ''),
        party_name: String(t.party_name || ''), project: String(t.project || ''),
        doc_type: String(t.doc_type || ''), doc_num: String(t.doc_num || ''),
        doc_date: String(t.doc_date || ''),
        qty_affected: parseQty_(t.qty_affected),
        qty_returned: parseQty_(t.qty_returned), qty_replaced: parseQty_(t.qty_replaced),
        qty_corrected: parseQty_(t.qty_corrected), qty_pending: parseQty_(t.qty_pending),
        required_action: String(t.required_action), required_action_th: REQUIRED_ACTION[String(t.required_action)] || '',
        status: String(t.status), status_th: TRACK_STATUS[String(t.status)] || String(t.status),
        contacted_at: String(t.contacted_at || ''), remark: String(t.remark || ''),
        row_version: parseQty_(t.row_version)
      };
    }),
    actions: actions.map(function (a) {
      return { action_id: String(a.action_id), section_type: String(a.section_type),
               section: String(a.section), section_th: sectionTh[String(a.section)] || String(a.section),
               seq: parseQty_(a.seq), details: String(a.details || ''),
               responsible: String(a.responsible || ''), target_date: String(a.target_date || ''),
               status: String(a.status), approved_by: String(a.approved_by || ''),
               approved_at: String(a.approved_at || ''), remark: String(a.remark || ''),
               row_version: parseQty_(a.row_version) };
    }).sort(function (x, y) { return x.seq - y.seq; }),
    holds: holds.map(function (h) {
      return { hold_id: String(h.hold_id), lot_key: String(h.lot_key),
               item_code: String(h.item_code), dist_number: String(h.dist_number || ''),
               whs_code: String(h.whs_code), whs_name: whsName_(h.whs_code),
               qty_hold: parseQty_(h.qty_hold), status: String(h.status),
               placed_at: String(h.placed_at), placed_by: String(h.placed_by),
               released_at: String(h.released_at || ''), released_by: String(h.released_by || ''),
               release_reason: String(h.release_reason || ''),
               row_version: parseQty_(h.row_version) };
    })
  };
}

function listCases_(filter) {
  var rows = readTable_(TAB.CASES, true).rows;
  var f = String(filter || 'ACTIVE').toUpperCase();
  return rows.filter(function (r) {
    var st = String(r.status).toUpperCase();
    if (f === 'ALL') return true;
    if (f === 'ACTIVE') return ['CLOSED', 'CANCELLED'].indexOf(st) === -1;
    if (f === 'CLOSED') return st === 'CLOSED';
    return st === f;
  }).map(function (r) {
    return {
      case_no: String(r.case_no), status: String(r.status), status_th: statusTh_(String(r.status)),
      opened_at: String(r.opened_at), case_owner: String(r.case_owner),
      item_code: String(r.item_code), model: String(r.model || ''), brand: String(r.brand || ''),
      risk_class: String(r.risk_class),
      risk_th: (RISK_CLASS[String(r.risk_class)] || {}).th || String(r.risk_class),
      problem: String(r.problem || '').slice(0, 160),
      qty_affected: parseQty_(r.qty_affected), qty_unaccounted: parseQty_(r.qty_unaccounted),
      effectiveness_pct: parseQty_(r.effectiveness_pct)
    };
  }).sort(function (a, b) {
    var rank = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };
    var ra = rank[a.risk_class] === undefined ? 9 : rank[a.risk_class];
    var rb = rank[b.risk_class] === undefined ? 9 : rank[b.risk_class];
    if (ra !== rb) return ra - rb;
    return String(b.opened_at).localeCompare(String(a.opened_at));
  });
}


/* ════════════════════════════════════════════════════ 04_MockRecall.gs ════ */

/**
 * MGS Traceability & Recall — 04_MockRecall.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * การทดสอบทวนสอบย้อนกลับ (FM-QC-TR-02)
 *
 * แนวคิด: ระบบสร้าง "รายการที่ควรหาเจอ" จาก SAP ให้ก่อน แล้วผู้ทดสอบต้องไป
 * ยืนยันของจริงว่าหาเจอกี่หน่วย พร้อมหลักฐาน — ไม่ใช่ให้ระบบตอบเองทั้งหมด
 * ถ้าระบบตอบเองหมด การทดสอบก็ไม่ได้พิสูจน์อะไรเลย
 *
 * เกณฑ์ผ่าน (ทั้ง 3 ข้อต้องผ่านพร้อมกัน)
 *   1. หาเจอครบ 100% ของจำนวนที่คาดไว้
 *   2. กระทบยอดได้ 100% (รับเข้า = ส่งออก + คงคลัง + คืน)
 *   3. ใช้เวลาไม่เกินเป้าหมาย (ค่าตั้งต้น 120 นาที)
 */

function startMockRecall_(p, user) {
  var itemCode = str_(p.item_code, 60);
  var distNumber = str_(p.dist_number, 60);
  if (!itemCode || !distNumber) fail_('กรุณาเลือกสินค้าและเลขล็อต/ซีเรียลที่จะทดสอบ');

  var key = lotKey_(itemCode, distNumber);
  var trace = buildLotTrace_(key);      // โยน error เองถ้าไม่มีล็อตนี้

  var testType = String(p.test_type || 'BOTH').toUpperCase();
  if (['BACKWARD', 'FORWARD', 'BOTH'].indexOf(testType) === -1) fail_('ชนิดการทดสอบไม่ถูกต้อง');

  var now = nowStamp_();
  var testNo = nextDocNo_(TAB.MOCK, 'test_no', 'MR');
  var targetMin = parseQtyPos_(p.target_min || setting_('mock_recall_target_min', CFG.MOCK_RECALL_TARGET_MIN), 'เวลาเป้าหมาย');

  var lines = [];
  var seq = 0;

  if (testType === 'BACKWARD' || testType === 'BOTH') {
    trace.backward.forEach(function (b) {
      lines.push({
        line_id: uuid_(), test_no: testNo, leg: 'BACKWARD', seq: ++seq,
        party_or_location: b.party_name || b.whs_name || b.party_code,
        doc_type: b.doc_type_th, doc_num: b.doc_num, doc_date: b.doc_date,
        project: [b.supplier_po_no, b.supplier_invoice_no].filter(String).join(' / '),
        qty_expected: b.qty, qty_located: '', result: 'PENDING', evidence: '', remark: ''
      });
    });
  }

  if (testType === 'FORWARD' || testType === 'BOTH') {
    trace.forward.on_hand.forEach(function (s) {
      lines.push({
        line_id: uuid_(), test_no: testNo, leg: 'FORWARD', seq: ++seq,
        party_or_location: s.whs_name + ' (' + s.whs_code + ')',
        doc_type: 'คงคลัง', doc_num: '', doc_date: '', project: '',
        qty_expected: s.qty, qty_located: '', result: 'PENDING', evidence: '', remark: ''
      });
    });
    trace.forward.shipments.forEach(function (sh) {
      lines.push({
        line_id: uuid_(), test_no: testNo, leg: 'FORWARD', seq: ++seq,
        party_or_location: sh.party_name || sh.party_code || sh.whs_name,
        doc_type: sh.doc_type_th, doc_num: sh.doc_num, doc_date: sh.doc_date,
        project: sh.project,
        qty_expected: sh.qty, qty_located: '', result: 'PENDING', evidence: '', remark: ''
      });
    });
  }

  if (!lines.length) fail_('ล็อตนี้ยังไม่มีการเคลื่อนไหวใน SAP จึงทดสอบไม่ได้ — เลือกล็อตที่มีทั้งรับเข้าและส่งออก');

  var item = ctx_().items[itemCode] || {};
  appendRows_(TAB.MOCK, [{
    test_id: uuid_(), test_no: testNo, test_date: today_(),
    conducted_by: user.email, reviewed_by: '',
    item_code: itemCode, model: str_(item.item_name, 120),
    lot_key: key, dist_number: distNumber, test_type: testType,
    started_at: now, ended_at: '', duration_min: '', target_min: targetMin,
    qty_affected: '', qty_located: '', completion_pct: '', reconcile_pct: '',
    result: 'IN_PROGRESS',
    gap_found: '', root_cause: '', corrective_action: '', capa_owner: '',
    capa_due: '', capa_status: '', verified_by: '', verified_at: '',
    note: str_(p.note, 1000),
    created_at: now, updated_by: user.email, updated_at: now, row_version: 1
  }]);
  appendRows_(TAB.MOCK_LINES, lines);

  logAudit_('START_MOCK_RECALL', 'Mock_Recalls', testNo, null,
            { lot_key: key, lines: lines.length }, p.clientKey);

  return ok_({ test_no: testNo, lines: lines.length, started_at: now, target_min: targetMin });
}

/** ผู้ทดสอบบันทึกว่าหาเจอกี่หน่วย พร้อมหลักฐาน */
function updateMockLine_(p, user) {
  var lineId = str_(p.line_id, 60);
  var t = readTable_(TAB.MOCK_LINES);
  var found = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].line_id) === lineId) { found = t.rows[i]; break; }
  }
  if (!found) fail_('ไม่พบบรรทัดนี้');

  var head = findRow_(TAB.MOCK, 'test_no', String(found.test_no));
  if (!head) fail_('ไม่พบการทดสอบ ' + found.test_no);
  if (String(head.result).toUpperCase() !== 'IN_PROGRESS') {
    fail_('การทดสอบ ' + found.test_no + ' ปิดผลไปแล้ว แก้ไขไม่ได้');
  }

  var expected = parseQty_(found.qty_expected, 'จำนวนที่คาดไว้');
  var located = parseQtyPos_(p.qty_located, 'จำนวนที่หาเจอ');
  if (located > expected + 0.0001) {
    fail_('จำนวนที่หาเจอ (' + located + ') มากกว่าจำนวนที่คาดไว้ (' + expected + ') — ตรวจสอบอีกครั้ง');
  }
  var evidence = str_(p.evidence, 500);
  if (located > 0 && !evidence) fail_('ต้องระบุหลักฐานที่ใช้ยืนยัน เช่น เลขใบส่งของ รายการซีเรียล หรือรูปถ่าย');

  var result = located >= expected ? 'PASS' : (located > 0 ? 'PARTIAL' : 'FAIL');

  withLock_(function () {
    var sh = sheet_(TAB.MOCK_LINES);
    var fresh = readTable_(TAB.MOCK_LINES);
    var row = null;
    for (var j = 0; j < fresh.rows.length; j++) {
      if (String(fresh.rows[j].line_id) === lineId) { row = fresh.rows[j]; break; }
    }
    if (!row) fail_('ไม่พบบรรทัดนี้ (อาจถูกลบไปแล้ว)');
    var after = {};
    SCHEMA[TAB.MOCK_LINES].forEach(function (h) { after[h] = row[h]; });
    after.qty_located = located;
    after.result = result;
    after.evidence = evidence;
    after.remark = str_(p.remark, 500);
    sh.getRange(row._row, 1, 1, SCHEMA[TAB.MOCK_LINES].length)
      .setValues([toRow_(TAB.MOCK_LINES, after)]);
  });

  logAudit_('UPDATE_MOCK_LINE', 'Mock_Recall_Lines', lineId,
            { located: found.qty_located }, { located: located, result: result }, p.clientKey);
  return ok_({ line_id: lineId, result: result });
}

/** ปิดผลการทดสอบและคำนวณเกณฑ์ผ่าน */
function finishMockRecall_(p, user) {
  var testNo = str_(p.test_no, 40);
  var head = findRow_(TAB.MOCK, 'test_no', testNo);
  if (!head) fail_('ไม่พบการทดสอบ ' + testNo);
  if (String(head.result).toUpperCase() !== 'IN_PROGRESS') fail_('การทดสอบนี้ปิดผลไปแล้ว');

  var lines = findRows_(TAB.MOCK_LINES, 'test_no', testNo);
  var pending = lines.filter(function (l) { return String(l.result).toUpperCase() === 'PENDING'; });
  if (pending.length) fail_('ยังมี ' + pending.length + ' บรรทัดที่ยังไม่ได้บันทึกผล');

  var expected = 0, located = 0, anyFail = false;
  lines.forEach(function (l) {
    expected += parseQty_(l.qty_expected);
    located += parseQty_(l.qty_located);
    if (String(l.result).toUpperCase() === 'FAIL') anyFail = true;
  });

  var rec = reconcile_(String(head.lot_key));
  var endedAt = nowStamp_();
  var durationMin = diffMinutes_(String(head.started_at), endedAt);
  var targetMin = parseQty_(head.target_min) || CFG.MOCK_RECALL_TARGET_MIN;

  var completion = expected > 0 ? round3_(located / expected) : 0;
  var reconcilePct = rec.completion_pct;

  var pass = (completion >= 1) && rec.pass && !anyFail && (durationMin <= targetMin);
  var reasons = [];
  if (completion < 1) reasons.push('หาของไม่ครบ (' + Math.round(completion * 100) + '%)');
  if (!rec.pass) reasons.push('กระทบยอดไม่ลง ต่างอยู่ ' + rec.unaccounted + ' หน่วย');
  if (anyFail) reasons.push('มีบรรทัดที่หาไม่เจอเลย');
  if (durationMin > targetMin) reasons.push('ใช้เวลา ' + durationMin + ' นาที เกินเป้า ' + targetMin + ' นาที');

  var gap = pass ? '' : reasons.join(' · ');

  var res = withLock_(function () {
    return updateRow_(TAB.MOCK, 'test_no', testNo, {
      ended_at: endedAt, duration_min: durationMin,
      qty_affected: round3_(expected), qty_located: round3_(located),
      completion_pct: completion, reconcile_pct: reconcilePct,
      result: pass ? 'PASS' : 'FAIL',
      gap_found: gap,
      capa_status: pass ? 'NA' : 'OPEN',
      updated_by: user.email, updated_at: endedAt
    }, p.row_version);
  });

  logAudit_('FINISH_MOCK_RECALL', 'Mock_Recalls', testNo, null,
            { result: pass ? 'PASS' : 'FAIL', duration_min: durationMin, completion: completion },
            p.clientKey);

  notifyLarkText_((pass ? '✅' : '❌') + ' ทดสอบทวนสอบ ' + testNo + ' — ' + (pass ? 'ผ่าน' : 'ไม่ผ่าน') +
    '\nสินค้า ' + head.item_code + ' ล็อต ' + head.dist_number +
    '\nหาเจอ ' + Math.round(completion * 100) + '% · ใช้เวลา ' + durationMin + '/' + targetMin + ' นาที' +
    (gap ? '\nสาเหตุ: ' + gap : ''));

  return ok_({ test_no: testNo, result: pass ? 'PASS' : 'FAIL', duration_min: durationMin,
               completion_pct: completion, reconcile_pct: reconcilePct, gap_found: gap,
               row_version: res.after.row_version });
}

/** ผู้จัดการคุณภาพทบทวนผล + บันทึก CAPA เมื่อไม่ผ่าน */
function reviewMockRecall_(p, user) {
  var testNo = str_(p.test_no, 40);
  var head = findRow_(TAB.MOCK, 'test_no', testNo);
  if (!head) fail_('ไม่พบการทดสอบ ' + testNo);
  if (String(head.result).toUpperCase() === 'IN_PROGRESS') fail_('ต้องปิดผลการทดสอบก่อนจึงทบทวนได้');
  if (String(head.conducted_by || '').toLowerCase() === user.email) {
    fail_('ผู้ทดสอบกับผู้ทบทวนต้องเป็นคนละคน');
  }

  var failed = String(head.result).toUpperCase() === 'FAIL';
  var rootCause = str_(p.root_cause, 2000);
  var capa = str_(p.corrective_action, 2000);
  if (failed) {
    if (rootCause.length < 10) fail_('การทดสอบไม่ผ่าน ต้องระบุสาเหตุที่แท้จริงอย่างน้อย 10 ตัวอักษร');
    if (capa.length < 10) fail_('การทดสอบไม่ผ่าน ต้องระบุการแก้ไขอย่างน้อย 10 ตัวอักษร');
    if (!str_(p.capa_owner, 120)) fail_('ต้องระบุผู้รับผิดชอบการแก้ไข');
    if (!p.capa_due) fail_('ต้องระบุวันที่กำหนดแล้วเสร็จ');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.MOCK, 'test_no', testNo, {
      reviewed_by: user.email,
      root_cause: rootCause, corrective_action: capa,
      capa_owner: str_(p.capa_owner, 120),
      capa_due: p.capa_due ? parseDate_(p.capa_due, 'วันที่กำหนดแล้วเสร็จ') : '',
      capa_status: failed ? 'OPEN' : 'NA',
      verified_by: user.email, verified_at: nowStamp_(),
      note: str_(pick_(p.note, head.note), 1000),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  logAudit_('REVIEW_MOCK_RECALL', 'Mock_Recalls', testNo, res.before, res.after, p.clientKey);
  return ok_({ test_no: testNo, reviewed_by: user.email });
}

function getMockRecall_(testNo) {
  var head = findRow_(TAB.MOCK, 'test_no', testNo);
  if (!head) fail_('ไม่พบการทดสอบ ' + testNo);
  var lines = findRows_(TAB.MOCK_LINES, 'test_no', testNo);
  return {
    header: {
      test_no: String(head.test_no), test_date: String(head.test_date),
      conducted_by: String(head.conducted_by), reviewed_by: String(head.reviewed_by || ''),
      item_code: String(head.item_code), model: String(head.model || ''),
      lot_key: String(head.lot_key), dist_number: String(head.dist_number),
      test_type: String(head.test_type),
      started_at: String(head.started_at), ended_at: String(head.ended_at || ''),
      duration_min: parseQty_(head.duration_min), target_min: parseQty_(head.target_min),
      qty_affected: parseQty_(head.qty_affected), qty_located: parseQty_(head.qty_located),
      completion_pct: parseQty_(head.completion_pct), reconcile_pct: parseQty_(head.reconcile_pct),
      result: String(head.result),
      gap_found: String(head.gap_found || ''), root_cause: String(head.root_cause || ''),
      corrective_action: String(head.corrective_action || ''),
      capa_owner: String(head.capa_owner || ''), capa_due: String(head.capa_due || ''),
      capa_status: String(head.capa_status || ''),
      note: String(head.note || ''), row_version: parseQty_(head.row_version)
    },
    lines: lines.map(function (l) {
      return { line_id: String(l.line_id), leg: String(l.leg), seq: parseQty_(l.seq),
               party_or_location: String(l.party_or_location || ''),
               doc_type: String(l.doc_type || ''), doc_num: String(l.doc_num || ''),
               doc_date: String(l.doc_date || ''), project: String(l.project || ''),
               qty_expected: parseQty_(l.qty_expected),
               qty_located: l.qty_located === '' ? '' : parseQty_(l.qty_located),
               result: String(l.result), evidence: String(l.evidence || ''),
               remark: String(l.remark || '') };
    }).sort(function (a, b) { return a.seq - b.seq; })
  };
}

function listMockRecalls_() {
  return readTable_(TAB.MOCK, true).rows.map(function (r) {
    return { test_no: String(r.test_no), test_date: String(r.test_date),
             item_code: String(r.item_code), dist_number: String(r.dist_number),
             test_type: String(r.test_type), result: String(r.result),
             duration_min: parseQty_(r.duration_min), target_min: parseQty_(r.target_min),
             completion_pct: parseQty_(r.completion_pct),
             conducted_by: String(r.conducted_by), reviewed_by: String(r.reviewed_by || ''),
             capa_status: String(r.capa_status || '') };
  }).sort(function (a, b) { return String(b.test_date).localeCompare(String(a.test_date)); });
}

/** ต่างเวลาเป็นนาที จากสตริง yyyy-MM-dd HH:mm:ss (เขตเวลาเดียวกันทั้งคู่) */
function diffMinutes_(from, to) {
  var a = parseStamp_(from), b = parseStamp_(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

function parseStamp_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                  Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
}


/* ═══════════════════════════════════════════════════════════ 05_Sap.gs ════ */

/**
 * MGS Traceability & Recall — 05_Sap.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * รับข้อมูลจาก SAP Business One
 *
 * ทิศทางเดียว:  SAP B1 ──► Google Sheets     (ไม่มีการเขียนกลับเข้า SAP เลย)
 *
 * B1 อยู่ในวงแลนของออฟฟิศ ส่วน Apps Script อยู่บนคลาวด์ของ Google
 * คลาวด์เรียกเข้าออฟฟิศไม่ได้ จึงใช้แบบ "ผลักออก": ตัวส่งข้อมูลรันในออฟฟิศ
 * อ่าน B1 แล้วยิง HTTPS ขาออกมาที่ endpoint นี้ทุก 30 นาที
 * ผลคือ ไม่ต้องเปิดพอร์ตขาเข้าใด ๆ ที่ไฟร์วอลล์
 *
 *   ┌─ ในออฟฟิศ (หลังไฟร์วอลล์) ─────────┐        ┌─ Google ──────────┐
 *   │  SAP B1 ──อ่านอย่างเดียว── ตัวส่ง  │──HTTPS─►│  doPost -> Sheets │
 *   │  (SQL read-only / Service Layer)    │  ขาออก  │                   │
 *   └─────────────────────────────────────┘        └───────────────────┘
 *
 * ความปลอดภัยของ endpoint
 *   · ทุก request ต้องมีลายเซ็น HMAC-SHA256 ของ body ด้วย SAP_PUSH_SECRET
 *   · ทุก request ต้องมี timestamp ที่ต่างจากเวลาปัจจุบันไม่เกิน 5 นาที (กัน replay)
 *   · เขียนได้เฉพาะแท็บใน SAP_TABS เท่านั้น
 *   · ห้ามใส่ secret ในซอร์ส — อยู่ใน Script Properties
 *
 * หมายเหตุการ deploy: endpoint นี้ต้อง "เข้าถึงได้โดยทุกคน" ซึ่งต่างจากเว็บแอปหลัก
 * ที่จำกัดเฉพาะโดเมนบริษัท จึงต้อง deploy เป็น "โปรเจกต์ Apps Script แยกอีกตัว"
 * ที่ผูกกับสเปรดชีตเดียวกัน — ห้ามเปิดเว็บแอปหลักให้คนนอกเข้าถึงเด็ดขาด
 * (ทางเลือกที่ปลอดภัยกว่าและแนะนำ: ให้ตัวส่งเขียนลงชีตตรงผ่าน service account
 *  แล้วไม่ต้องมี endpoint สาธารณะเลย — ดู docs/16 §7.3)
 */

/* ══════════════════════════════════════════════════════════════════════════
   1. Endpoint รับข้อมูล
   ══════════════════════════════════════════════════════════════════════════ */
function doPost(e) {
  var started = Date.now();
  var batchId = '';
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, error: 'empty body' });
    }
    var raw = e.postData.contents;
    if (raw.length > 9000000) return jsonOut_({ ok: false, error: 'payload too large' });

    var sig = (e.parameter && e.parameter.sig) || '';
    var ts  = (e.parameter && e.parameter.ts) || '';
    verifyPushSignature_(raw, sig, ts);

    var body = JSON.parse(raw);
    batchId = String(body.batch_id || uuid_());
    var result = ingestBatch_(body, 'PUSH', batchId);
    return jsonOut_({ ok: true, batch_id: batchId, result: result, ms: Date.now() - started });

  } catch (err) {
    var msg = (err && err.message) ? String(err.message).replace('[U] ', '') : String(err);
    console.error('doPost failed', err && err.stack);
    logSync_('PUSH', '-', 0, 0, 'ERROR', Date.now() - started, msg, batchId);
    try { notifyLarkText_('⚠️ รับข้อมูลจาก SAP ล้มเหลว: ' + msg); } catch (e2) {}
    return jsonOut_({ ok: false, error: msg });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ตรวจลายเซ็นและอายุของคำขอ — ผิดข้อใดข้อหนึ่งคือปฏิเสธ */
function verifyPushSignature_(raw, sig, ts) {
  var secret = secret_('SAP_PUSH_SECRET');
  if (!sig || !ts) fail_('missing signature');

  var age = Math.abs(Date.now() - Number(ts));
  if (!isFinite(age) || age > 5 * 60 * 1000) fail_('stale or invalid timestamp');

  var bytes = Utilities.computeHmacSha256Signature(String(ts) + '.' + raw, secret);
  var hex = bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');

  if (!timingSafeEqual_(hex, String(sig).toLowerCase())) fail_('bad signature');
}

/** เทียบสตริงโดยไม่ให้เวลาที่ใช้บอกใบ้ว่าตรงกันถึงตัวไหน */
function timingSafeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. เขียนข้อมูลลงแท็บ
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * @param {{batch_id:string, tables:Object<string, (Array|{mode:string, rows:Array})>}} body
 *        key ของ tables คือชื่อแท็บใน SAP_TABS เช่น "SAP_Lot_Moves"
 *
 *        ค่าของแต่ละ key เป็นได้ 2 แบบ
 *          · array ตรง ๆ                  = ทับทั้งแท็บ (ใช้กับตารางเล็ก)
 *          · {mode:'REPLACE', rows:[...]} = ทับทั้งแท็บ แล้วเริ่มชุดใหม่
 *          · {mode:'APPEND',  rows:[...]} = ต่อท้ายชุดที่เพิ่งทับไป
 *
 *        ตารางใหญ่อย่าง SAP_Lot_Moves ส่งครั้งเดียวไม่ไหว (payload บวมและชนเพดาน 6 นาที)
 *        ตัวส่งจึงแบ่งเป็นก้อนละ MAX_INGEST_ROWS แถว: ก้อนแรก REPLACE ที่เหลือ APPEND
 *
 *        ทำไมต้องทับทั้งชุดไม่ใช่ส่งเฉพาะส่วนต่าง: การส่งส่วนต่างทำให้แถวที่ถูกลบ
 *        หรือแก้ไขใน B1 ค้างอยู่ในชีตตลอดไป แล้วยอดกระทบจะเพี้ยนโดยไม่มีใครรู้
 */
function ingestBatch_(body, source, batchId) {
  if (!body || !body.tables) fail_('no tables in payload');
  var names = Object.keys(body.tables);
  if (!names.length) fail_('no tables in payload');

  var summary = {};
  names.forEach(function (tab) {
    var started = Date.now();
    if (SAP_TABS.indexOf(tab) === -1) {
      logSync_(source, tab, 0, 0, 'REJECTED', 0, 'ไม่อยู่ในรายการแท็บที่อนุญาต', batchId);
      summary[tab] = { ok: false, error: 'tab not allowed' };
      return;
    }
    var payload = body.tables[tab];
    var mode = 'REPLACE', rows;
    if (Array.isArray(payload)) {
      rows = payload;
    } else if (payload && Array.isArray(payload.rows)) {
      rows = payload.rows;
      mode = String(payload.mode || 'REPLACE').toUpperCase();
      if (mode !== 'REPLACE' && mode !== 'APPEND') {
        summary[tab] = { ok: false, error: 'unknown mode: ' + mode };
        return;
      }
    } else {
      summary[tab] = { ok: false, error: 'expected an array or {mode, rows}' };
      return;
    }
    if (rows.length > CFG.MAX_INGEST_ROWS) {
      logSync_(source, tab, rows.length, 0, 'REJECTED', 0,
               'เกิน ' + CFG.MAX_INGEST_ROWS + ' แถวต่อรอบ — ให้ตัวส่งแบ่งเป็นหลายรอบ', batchId);
      summary[tab] = { ok: false, error: 'too many rows' };
      return;
    }

    try {
      // แปลงและตรวจทุกแถวให้จบก่อน แล้วค่อยเขียน — ถ้าแถวไหนผิด ต้องไม่มีอะไรถูกเขียนเลย
      var prepared = rows.map(function (r, i) { return prepareSapRow_(tab, r, i); });
      var written = withLock_(function () {
        return mode === 'APPEND' ? appendSapRows_(tab, prepared) : replaceTable_(tab, prepared);
      });
      logSync_(source, tab, rows.length, written, 'OK', Date.now() - started, mode, batchId);
      summary[tab] = { ok: true, rows: written, mode: mode };
    } catch (e) {
      var msg = String(e && e.message || e).replace('[U] ', '');
      logSync_(source, tab, rows.length, 0, 'ERROR', Date.now() - started, msg, batchId);
      summary[tab] = { ok: false, error: msg };
    }
  });

  resetCtx_();
  SAP_TABS.forEach(clearTableCache_);
  PropertiesService.getScriptProperties().setProperty('LAST_SYNC_AT', nowStamp_());
  return summary;
}

/** เติมค่าเริ่มต้น ตรวจฟิลด์บังคับ และคำนวณคีย์ที่ระบบใช้ */
function prepareSapRow_(tab, r, idx) {
  var o = {};
  SCHEMA[tab].forEach(function (h) { o[h] = (r[h] === undefined || r[h] === null) ? '' : r[h]; });
  o.synced_at = nowStamp_();

  function need(field) {
    if (String(o[field]) === '') fail_(tab + ' แถวที่ ' + (idx + 1) + ': ขาดค่าในช่อง ' + field);
  }

  if (tab === TAB.LOTS || tab === TAB.MOVES || tab === TAB.STOCK) {
    need('item_code');
    need('dist_number');
    o.lot_key = lotKey_(o.item_code, o.dist_number);
  }

  if (tab === TAB.MOVES) {
    need('obj_type');
    o.obj_type = String(o.obj_type);
    var dir = String(o.direction || '').toUpperCase();
    if (dir !== 'IN' && dir !== 'OUT') {
      // ถ้าตัวส่งไม่ได้ระบุ ให้เดาจากชนิดเอกสาร แล้วบันทึกไว้ว่าเดามา
      var info = OBJ[o.obj_type];
      if (!info || info.dir === 'BOTH' || info.dir === 'NONE') {
        fail_(tab + ' แถวที่ ' + (idx + 1) + ': ต้องระบุ direction เป็น IN หรือ OUT สำหรับเอกสารชนิด ' + o.obj_type);
      }
      dir = info.dir;
    }
    o.direction = dir;
    var q = parseQty_(o.quantity, 'quantity');
    o.quantity = Math.abs(q);                       // ทิศทางอยู่ที่ direction ไม่ใช่เครื่องหมาย
    if (!o.move_id) {
      o.move_id = [o.obj_type, o.doc_entry, o.line_num, o.lot_key, dir].join('~');
    }
  }

  if (tab === TAB.STOCK) {
    o.quantity = parseQty_(o.quantity, 'quantity');
  }

  if (tab === TAB.ITEMS) {
    need('item_code');
    var mng = String(o.mng_method || '').toUpperCase();
    o.mng_method = MNG[mng] ? mng : MNG.NONE;
  }

  if (tab === TAB.BP)  need('card_code');
  if (tab === TAB.WHS) need('whs_code');

  return o;
}

/* ══════════════════════════════════════════════════════════════════════════
   3. สุขภาพของการ sync — แถบเตือนบนหน้าจอดึงจากตรงนี้
   ══════════════════════════════════════════════════════════════════════════ */
function syncHealth_() {
  var last = PropertiesService.getScriptProperties().getProperty('LAST_SYNC_AT') || '';
  var ageMin = last ? diffMinutes_(last, nowStamp_()) : -1;
  var stale = (ageMin < 0) || (ageMin > CFG.SYNC_STALE_MIN);

  var recent = readTable_(TAB.SYNC_LOG, true).rows.slice(-30);
  var errors = recent.filter(function (r) { return String(r.status) !== 'OK'; });

  var counts = {};
  SAP_TABS.forEach(function (t) {
    try { counts[t] = Math.max(0, sheet_(t).getLastRow() - 1); } catch (e) { counts[t] = -1; }
  });

  return {
    last_sync_at: last,
    age_min: ageMin,
    stale: stale,
    message: stale
      ? (last ? 'ข้อมูลจาก SAP ล่าสุด ' + last + ' (' + ageMin + ' นาทีที่แล้ว) — ตัวเลขอาจไม่ทันปัจจุบัน'
              : 'ยังไม่เคยรับข้อมูลจาก SAP — ให้ผู้ดูแลระบบตรวจตัวส่งข้อมูลในออฟฟิศ')
      : 'ข้อมูลจาก SAP ล่าสุด ' + last,
    recent_errors: errors.slice(-5).map(function (r) {
      return { at: String(r.at_ts), tab: String(r.tab), message: String(r.message) };
    }),
    row_counts: counts
  };
}

/** ตรวจ sync ทุกชั่วโมง — ค้างนานเกินกำหนดให้เตือน Lark ครั้งเดียว ไม่รบกวนซ้ำ */
function checkSyncHealthJob() {
  try {
    var h = syncHealth_();
    var props = PropertiesService.getScriptProperties();
    var warned = props.getProperty('SYNC_WARNED') === '1';
    if (h.stale && !warned) {
      notifyLarkText_('⚠️ ข้อมูล SAP ค้าง — ' + h.message + '\nกรุณาตรวจตัวส่งข้อมูลบนเครื่องในออฟฟิศ');
      props.setProperty('SYNC_WARNED', '1');
    } else if (!h.stale && warned) {
      notifyLarkText_('✅ ข้อมูล SAP กลับมาปกติแล้ว (' + h.last_sync_at + ')');
      props.setProperty('SYNC_WARNED', '0');
    }
  } catch (e) {
    logError_('checkSyncHealthJob', e);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4. คำสั่ง SQL ที่ตัวส่งข้อมูลฝั่งออฟฟิศใช้ (SAP B1 บน MS SQL Server)
   คัดลอกไปให้ผู้ดูแล B1 ตรวจได้เลย — ทุกคำสั่งเป็นการอ่านล้วน
   ตารางเหล่านี้คือชุดเดียวกับที่ Crystal Reports ของ B1 ใช้อยู่แล้ว
   ══════════════════════════════════════════════════════════════════════════ */
var SAP_QUERIES = {

  /* สินค้า — OITM */
  'SAP_Items':
    "SELECT T0.ItemCode AS item_code, T0.ItemName AS item_name, T1.ItmsGrpNam AS item_group,\n" +
    "       T0.U_Brand AS brand, T0.U_ProductType AS product_type,\n" +
    "       CASE WHEN T0.ManSerNum='Y' THEN 'SERIAL'\n" +
    "            WHEN T0.ManBtchNum='Y' THEN 'BATCH' ELSE 'NONE' END AS mng_method,\n" +
    "       T0.InvntryUom AS uom,\n" +
    "       CASE WHEN T0.validFor='Y' THEN 'TRUE' ELSE 'FALSE' END AS is_active\n" +
    "FROM OITM T0 LEFT JOIN OITB T1 ON T1.ItmsGrpCod = T0.ItmsGrpCod",

  /* คู่ค้า — OCRD */
  'SAP_BP':
    "SELECT CardCode AS card_code, CardName AS card_name, CardType AS card_type,\n" +
    "       Phone1 AS phone, E_Mail AS email, CntctPrsn AS contact_person,\n" +
    "       CASE WHEN validFor='Y' THEN 'TRUE' ELSE 'FALSE' END AS is_active\n" +
    "FROM OCRD WHERE CardType IN ('S','C')",

  /* คลัง — OWHS (U_LocationType ให้ระบุ CUSTOMER สำหรับคลังหน้างานลูกค้า) */
  'SAP_Warehouses':
    "SELECT WhsCode AS whs_code, WhsName AS whs_name,\n" +
    "       ISNULL(U_LocationType,'INTERNAL') AS location_type,\n" +
    "       CASE WHEN Inactive='N' THEN 'TRUE' ELSE 'FALSE' END AS is_active\n" +
    "FROM OWHS",

  /* ใบสั่งซื้อ — OPOR/POR1 */
  'SAP_PO_Lines':
    "SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,\n" +
    "       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,\n" +
    "       T0.CardCode AS card_code, T0.CardName AS card_name,\n" +
    "       T1.ItemCode AS item_code, T1.Dscription AS dscription,\n" +
    "       T1.Quantity AS quantity, T1.OpenQty AS open_qty, T1.WhsCode AS whs_code,\n" +
    "       T0.NumAtCard AS num_at_card, T0.DocStatus AS doc_status,\n" +
    "       ISNULL(T2.PrjName,'') AS project\n" +
    "FROM OPOR T0 INNER JOIN POR1 T1 ON T1.DocEntry=T0.DocEntry\n" +
    "     LEFT JOIN OPRJ T2 ON T2.PrjCode=T0.Project\n" +
    "WHERE T0.DocDate >= DATEADD(year,-3,GETDATE())",

  /* ใบรับสินค้า — OPDN/PDN1 (base_* ชี้กลับไปที่ PO) */
  'SAP_GRPO_Lines':
    "SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,\n" +
    "       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,\n" +
    "       T0.CardCode AS card_code, T0.CardName AS card_name,\n" +
    "       T1.ItemCode AS item_code, T1.Dscription AS dscription,\n" +
    "       T1.Quantity AS quantity, T1.WhsCode AS whs_code, T0.NumAtCard AS num_at_card,\n" +
    "       T1.BaseEntry AS base_entry, T1.BaseLine AS base_line,\n" +
    "       ISNULL(T2.DocNum,'') AS base_doc_num, ISNULL(T3.PrjName,'') AS project\n" +
    "FROM OPDN T0 INNER JOIN PDN1 T1 ON T1.DocEntry=T0.DocEntry\n" +
    "     LEFT JOIN OPOR T2 ON T2.DocEntry=T1.BaseEntry AND T1.BaseType=22\n" +
    "     LEFT JOIN OPRJ T3 ON T3.PrjCode=T0.Project\n" +
    "WHERE T0.DocDate >= DATEADD(year,-3,GETDATE())",

  /* ใบส่งของ — ODLN/DLN1 */
  'SAP_Delivery_Lines':
    "SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,\n" +
    "       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,\n" +
    "       T0.CardCode AS card_code, T0.CardName AS card_name,\n" +
    "       T1.ItemCode AS item_code, T1.Dscription AS dscription,\n" +
    "       T1.Quantity AS quantity, T1.WhsCode AS whs_code,\n" +
    "       T0.ShipToCode AS ship_to_code, T0.Address2 AS address,\n" +
    "       ISNULL(T2.PrjName,'') AS project\n" +
    "FROM ODLN T0 INNER JOIN DLN1 T1 ON T1.DocEntry=T0.DocEntry\n" +
    "     LEFT JOIN OPRJ T2 ON T2.PrjCode=T0.Project\n" +
    "WHERE T0.DocDate >= DATEADD(year,-3,GETDATE())",

  /* ใบกำกับขาย — OINV/INV1 (เก็บไว้อ้างอิงเลขที่ใบกำกับของลูกค้า) */
  'SAP_Invoice_Lines':
    "SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,\n" +
    "       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,\n" +
    "       T0.CardCode AS card_code, T0.CardName AS card_name,\n" +
    "       T1.ItemCode AS item_code, T1.Quantity AS quantity,\n" +
    "       T1.BaseEntry AS base_entry, T1.BaseLine AS base_line,\n" +
    "       ISNULL(T2.DocNum,'') AS base_doc_num, ISNULL(T3.PrjName,'') AS project\n" +
    "FROM OINV T0 INNER JOIN INV1 T1 ON T1.DocEntry=T0.DocEntry\n" +
    "     LEFT JOIN ODLN T2 ON T2.DocEntry=T1.BaseEntry AND T1.BaseType=15\n" +
    "     LEFT JOIN OPRJ T3 ON T3.PrjCode=T0.Project\n" +
    "WHERE T0.DocDate >= DATEADD(year,-3,GETDATE())",

  /* การคืน — ORDN/RDN1 (ลูกค้าคืนเรา) + ORPD/RPD1 (เราคืนผู้ขาย) */
  'SAP_Return_Lines':
    "SELECT 'CUSTOMER_RETURN' AS return_type, T0.DocEntry AS doc_entry, T1.LineNum AS line_num,\n" +
    "       T0.DocNum AS doc_num, CONVERT(varchar(10),T0.DocDate,120) AS doc_date,\n" +
    "       T0.CardCode AS card_code, T0.CardName AS card_name, T1.ItemCode AS item_code,\n" +
    "       T1.Quantity AS quantity, T1.WhsCode AS whs_code,\n" +
    "       T1.BaseEntry AS base_entry, T1.BaseLine AS base_line, '' AS base_doc_num,\n" +
    "       ISNULL(T0.Comments,'') AS reason\n" +
    "FROM ORDN T0 INNER JOIN RDN1 T1 ON T1.DocEntry=T0.DocEntry\n" +
    "WHERE T0.DocDate >= DATEADD(year,-3,GETDATE())\n" +
    "UNION ALL\n" +
    "SELECT 'SUPPLIER_RETURN', T0.DocEntry, T1.LineNum, T0.DocNum,\n" +
    "       CONVERT(varchar(10),T0.DocDate,120), T0.CardCode, T0.CardName, T1.ItemCode,\n" +
    "       T1.Quantity, T1.WhsCode, T1.BaseEntry, T1.BaseLine, '', ISNULL(T0.Comments,'')\n" +
    "FROM ORPD T0 INNER JOIN RPD1 T1 ON T1.DocEntry=T0.DocEntry\n" +
    "WHERE T0.DocDate >= DATEADD(year,-3,GETDATE())",

  /* ทะเบียนล็อตและซีเรียล — OBTN (batch) + OSRN (serial) */
  'SAP_Lots':
    "SELECT T0.ItemCode AS item_code, T0.DistNumber AS dist_number, 'BATCH' AS kind,\n" +
    "       T0.AbsEntry AS sys_number, ISNULL(T0.MnfSerial,'') AS mnf_serial,\n" +
    "       ISNULL(T0.LotNumber,'') AS supplier_lot,\n" +
    "       CONVERT(varchar(10),T0.InDate,120) AS in_date,\n" +
    "       CONVERT(varchar(10),T0.ExpDate,120) AS exp_date, ISNULL(T0.Notes,'') AS notes\n" +
    "FROM OBTN T0\n" +
    "UNION ALL\n" +
    "SELECT T1.ItemCode, T1.DistNumber, 'SERIAL', T1.AbsEntry, ISNULL(T1.MnfSerial,''),\n" +
    "       ISNULL(T1.LotNumber,''), CONVERT(varchar(10),T1.InDate,120),\n" +
    "       CONVERT(varchar(10),T1.ExpDate,120), ISNULL(T1.Notes,'')\n" +
    "FROM OSRN T1",

  /* ★ กระดูกสันหลัง — การเดินของล็อต/ซีเรียลทุกครั้ง (OITL + ITL1)
     Direction ของ B1: 0 = เข้า, 1 = ออก */
  'SAP_Lot_Moves':
    "SELECT CAST(T0.ApplyType AS varchar(20)) AS obj_type,\n" +
    "       T0.ApplyEntry AS doc_entry, T0.ApplyLine AS line_num,\n" +
    "       T0.DocNum AS doc_num, CONVERT(varchar(10),T0.DocDate,120) AS doc_date,\n" +
    "       T0.ItemCode AS item_code, ISNULL(T2.DistNumber,T3.DistNumber) AS dist_number,\n" +
    "       CASE WHEN T2.DistNumber IS NOT NULL THEN 'BATCH' ELSE 'SERIAL' END AS kind,\n" +
    "       CASE WHEN T0.Direction = 0 THEN 'IN' ELSE 'OUT' END AS direction,\n" +
    "       ABS(T1.Quantity) AS quantity, T0.LocCode AS whs_code,\n" +
    "       ISNULL(T0.CardCode,'') AS card_code, ISNULL(T4.CardName,'') AS card_name,\n" +
    "       '' AS project\n" +
    "FROM OITL T0\n" +
    "  INNER JOIN ITL1 T1 ON T1.LogEntry = T0.LogEntry\n" +
    "  LEFT JOIN OBTN T2 ON T2.AbsEntry = T1.MdAbsEntry AND T1.SysNumber >= 0\n" +
    "  LEFT JOIN OSRN T3 ON T3.AbsEntry = T1.MdAbsEntry AND T1.SysNumber >= 0\n" +
    "  LEFT JOIN OCRD T4 ON T4.CardCode = T0.CardCode\n" +
    "WHERE T0.DocDate >= DATEADD(year,-3,GETDATE())\n" +
    "  AND ISNULL(T2.DistNumber,T3.DistNumber) IS NOT NULL",

  /* คงคลังแยกล็อต — OIBT (batch) + OSRI (serial ที่ยังอยู่ในคลัง) */
  'SAP_Lot_Stock':
    "SELECT T0.ItemCode AS item_code, T0.BatchNum AS dist_number, T0.WhsCode AS whs_code,\n" +
    "       T0.Quantity AS quantity, 'AVAILABLE' AS status\n" +
    "FROM OIBT T0 WHERE T0.Quantity <> 0\n" +
    "UNION ALL\n" +
    "SELECT T1.ItemCode, T2.DistNumber, T1.WhsCode, 1, 'AVAILABLE'\n" +
    "FROM OSRI T1 INNER JOIN OSRN T2 ON T2.AbsEntry = T1.SysSerial AND T2.ItemCode = T1.ItemCode\n" +
    "WHERE T1.Status = 0"
};

/** พิมพ์ SQL ทั้งชุดจาก Apps Script editor เพื่อส่งให้ผู้ดูแล B1 */
function printSapQueries() {
  var out = [];
  Object.keys(SAP_QUERIES).forEach(function (k) {
    out.push('/* ===== ' + k + ' ===== */\n' + SAP_QUERIES[k] + ';\n');
  });
  console.log(out.join('\n'));
  return out.join('\n');
}


/* ════════════════════════════════════════════════════════ 06_Notify.gs ════ */

/**
 * MGS Traceability & Recall — 06_Notify.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * แจ้งเตือนผ่าน Lark
 *
 * กฎเหล็ก: การแจ้งเตือนล้มเหลว ต้องไม่ทำให้การบันทึกข้อมูลล้มเหลวตาม
 * บันทึกรายการก่อน แล้วค่อยแจ้ง — ถ้าแจ้งไม่ได้ให้บันทึกไว้ ไม่ใช่โยน error
 *
 * Lark คืน HTTP 200 พร้อม code != 0 เวลาผิดพลาด ถ้าไม่เช็ค body จะเห็นเป็นสำเร็จหมด
 */

function larkEnabled_() {
  if (!CFG.LARK.ENABLED) return false;
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('LARK_WEBHOOK') || (p.getProperty('LARK_APP_ID') && p.getProperty('LARK_APP_SECRET')));
}

/** ข้อความธรรมดา — ใช้ webhook ถ้ามี ไม่งั้นใช้ Bot API */
function notifyLarkText_(text) {
  try {
    if (!larkEnabled_()) { console.log('[lark disabled] ' + text); return false; }
    var hook = PropertiesService.getScriptProperties().getProperty('LARK_WEBHOOK');
    if (hook) return larkPost_(hook, { msg_type: 'text', content: { text: String(text) } });
    return larkSendToChat_(String(text));
  } catch (e) {
    console.error('notifyLarkText_ failed', e && e.stack);
    return false;
  }
}

function larkPost_(url, payload) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { code: -1, msg: res.getContentText() }; }
  if (body.code !== 0 && body.StatusCode !== 0) {
    console.error('Lark error', res.getResponseCode(), res.getContentText().slice(0, 500));
    return false;
  }
  return true;
}

function larkToken_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('lark_tat');
  if (hit) return hit;
  var res = UrlFetchApp.fetch(CFG.LARK.HOST + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ app_id: secret_('LARK_APP_ID'), app_secret: secret_('LARK_APP_SECRET') })
  });
  var body = JSON.parse(res.getContentText());
  if (body.code !== 0) throw new Error('Lark auth failed: ' + body.msg);
  cache.put('lark_tat', body.tenant_access_token, 6000);   // token อายุ ~2 ชม. cache 100 นาที
  return body.tenant_access_token;
}

function larkSendToChat_(text, chatId) {
  var target = chatId || PropertiesService.getScriptProperties().getProperty('LARK_CHAT_QC');
  if (!target) { console.log('[no lark chat] ' + text); return false; }
  var res = UrlFetchApp.fetch(CFG.LARK.HOST + '/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + larkToken_() },
    payload: JSON.stringify({
      receive_id: target, msg_type: 'text',
      content: JSON.stringify({ text: String(text) })
    })
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { code: -1 }; }
  if (body.code !== 0) {
    console.error('Lark send failed', res.getContentText().slice(0, 500));
    return false;
  }
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
   ข้อความสำเร็จรูป — เขียนไว้ที่เดียวเพื่อให้ถ้อยคำเหมือนกันทั้งระบบ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * แจ้งเปิดเคส — ข้อความนี้คือสิ่งที่หัวหน้าอ่านบนมือถือตอนตี 2
 * ต้องตอบได้ในหน้าจอเดียวว่า อะไรเสีย กระทบเท่าไหร่ ของอยู่ที่ไหน ใครต้องทำอะไร
 */
function notifyCaseOpened_(caseRow, totals, holds, tracks) {
  var risk = RISK_CLASS[String(caseRow.risk_class)] || {};
  var icon = String(caseRow.risk_class) === 'CRITICAL' ? '🔴'
           : String(caseRow.risk_class) === 'MAJOR' ? '🟠' : '🟡';

  var lines = [
    icon + ' เปิดเคสเรียกคืน ' + caseRow.case_no + ' — ' + (risk.th || caseRow.risk_class),
    '',
    'สินค้า: ' + caseRow.item_code + ' ' + (caseRow.model || ''),
    'ปัญหา: ' + String(caseRow.problem).slice(0, 300),
    'ที่มา: ' + (CASE_SOURCE[String(caseRow.source)] || caseRow.source) +
      (caseRow.source_ref ? ' (' + caseRow.source_ref + ')' : ''),
    '',
    'จำนวนที่กระทบทั้งหมด: ' + totals.affected,
    '  · อยู่ในคลัง: ' + totals.in_stock + ' (กักแล้ว ' + holds + ' รายการ)',
    '  · ส่งลูกค้าไปแล้ว: ' + totals.delivered,
    '  · ยังระบุที่อยู่ไม่ได้: ' + totals.unaccounted,
    '',
    'ปลายทางที่ต้องติดตาม: ' + tracks + ' รายการ',
    'ดำเนินการทันที: ' + caseRow.immediate_action,
    'ผู้รับผิดชอบเคส: ' + caseRow.case_owner
  ];

  if (totals.unaccounted > 0) {
    lines.push('', '⚠️ มีของ ' + totals.unaccounted + ' หน่วยที่ระบบระบุปลายทางไม่ได้ — ต้องตามด้วยมือ');
  }
  if (risk.escalate) {
    lines.push('', '‼️ ระดับความเสี่ยงนี้ต้องแจ้งผู้บริหารภายใน ' + risk.sla_hours + ' ชั่วโมง');
  }

  notifyLarkText_(lines.join('\n'));
}

/** เตือนเคสที่ค้างเกิน SLA — รันวันละครั้ง */
function checkCaseSlaJob() {
  try {
    var overdue = [];
    var now = new Date().getTime();
    readTable_(TAB.CASES, true).rows.forEach(function (r) {
      var st = String(r.status).toUpperCase();
      if (['CLOSED', 'CANCELLED'].indexOf(st) !== -1) return;
      var risk = RISK_CLASS[String(r.risk_class)];
      if (!risk) return;
      var opened = parseStamp_(String(r.opened_at));
      if (!opened) return;
      var ageHours = (now - opened) / 3600000;
      if (ageHours > risk.sla_hours) {
        overdue.push({ case_no: String(r.case_no), risk: String(r.risk_class),
                       hours: Math.round(ageHours), sla: risk.sla_hours,
                       owner: String(r.case_owner), status: statusTh_(st),
                       pending: parseQty_(r.qty_affected) -
                                (parseQty_(r.qty_returned) + parseQty_(r.qty_replaced) + parseQty_(r.qty_corrected)) });
      }
    });
    if (!overdue.length) return;

    overdue.sort(function (a, b) { return (b.hours / b.sla) - (a.hours / a.sla); });
    var msg = ['⏰ เคสเรียกคืนที่เกินกำหนด ' + overdue.length + ' เคส', ''];
    overdue.slice(0, 10).forEach(function (o) {
      msg.push('· ' + o.case_no + ' (' + o.risk + ') เปิดมาแล้ว ' + o.hours + ' ชม. เกินเป้า ' + o.sla + ' ชม.');
      msg.push('   สถานะ ' + o.status + ' · ค้างอีก ' + round3_(o.pending) + ' หน่วย · ' + o.owner);
    });
    notifyLarkText_(msg.join('\n'));
  } catch (e) {
    logError_('checkCaseSlaJob', e);
  }
}

/** เตือนให้ทำ mock recall เมื่อไม่ได้ทำมานานเกินกำหนด — รันเดือนละครั้ง */
function checkMockRecallDueJob() {
  try {
    var everyDays = Number(setting_('mock_recall_every_days', 180));
    var rows = readTable_(TAB.MOCK, true).rows.filter(function (r) {
      return String(r.result).toUpperCase() !== 'IN_PROGRESS';
    });
    var last = '';
    rows.forEach(function (r) { if (String(r.test_date) > last) last = String(r.test_date); });

    if (!last) {
      notifyLarkText_('📋 ยังไม่เคยมีการทดสอบทวนสอบย้อนกลับ (Mock Recall) ในระบบ — ควรทำครั้งแรกภายในเดือนนี้');
      return;
    }
    var days = Math.round((new Date().getTime() - parseStamp_(last + ' 00:00:00')) / 86400000);
    if (days > everyDays) {
      notifyLarkText_('📋 ครบกำหนดทดสอบทวนสอบย้อนกลับแล้ว\nครั้งล่าสุด ' + last +
                      ' (' + days + ' วันที่แล้ว · กำหนดทุก ' + everyDays + ' วัน)');
    }
  } catch (e) {
    logError_('checkMockRecallDueJob', e);
  }
}


/* ═══════════════════════════════════════════════════════════ 07_Api.gs ════ */

/**
 * MGS Traceability & Recall — 07_Api.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * ฟังก์ชันที่หน้าเว็บเรียกผ่าน google.script.run เท่านั้น
 *
 * กติกาของทุกฟังก์ชันในไฟล์นี้
 *   · คืน {ok:true,data} หรือ {ok:false,error} เสมอ — ไม่มี exception หลุดถึง client
 *   · เช็คสิทธิ์จาก session ฝั่งเซิร์ฟเวอร์เอง ไม่เชื่อ role ที่ client ส่งมา
 *   · ฟังก์ชันที่เขียนข้อมูลต้องรับ clientKey เพื่อกันบันทึกซ้ำ
 */

/* ══════════════════════════════════════════════════════════════════════════
   หน้าเว็บ
   ══════════════════════════════════════════════════════════════════════════ */
var SAFE_PAGES = { index: 'index' };

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
  var file = SAFE_PAGES[page] || 'index';        // whitelist — ห้ามเอา parameter ไปต่อเป็นชื่อไฟล์
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle('MGS ทวนสอบสินค้าและเรียกคืน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ══════════════════════════════════════════════════════════════════════════
   1. เปิดแอป
   ══════════════════════════════════════════════════════════════════════════ */
function apiBootstrap() {
  return guard_('apiBootstrap', function () {
    var u = me_();
    var health = syncHealth_();
    var c = ctx_();

    var items = Object.keys(c.items).map(function (k) {
      var i = c.items[k];
      return { item_code: k, item_name: String(i.item_name || ''), brand: String(i.brand || ''),
               product_type: String(i.product_type || ''), mng_method: String(i.mng_method || ''),
               uom: String(i.uom || '') };
    }).filter(function (i) { return i.mng_method !== MNG.NONE; })
      .sort(function (a, b) { return a.item_code.localeCompare(b.item_code, 'th'); });

    return ok_({
      app_version: APP_VERSION,
      user: { email: u.email, name: u.name, dept: u.dept, role: u.role,
              role_th: ROLES[u.role] || u.role, unlisted: !!u.unlisted },
      perm: permsFor_(u.role),
      sync: health,
      items: items.slice(0, 2000),
      enums: {
        case_status: CASE_STATUS, track_status: TRACK_STATUS,
        required_action: REQUIRED_ACTION, risk_class: RISK_CLASS,
        case_source: CASE_SOURCE, action_sections: ACTION_SECTIONS
      }
    });
  });
}

/** บอกหน้าจอว่าปุ่มไหนควรแสดง — ยังต้องเช็คซ้ำที่เซิร์ฟเวอร์อยู่ดี */
function permsFor_(role) {
  var out = {};
  Object.keys(PERM).forEach(function (fn) { out[fn] = PERM[fn].indexOf(role) !== -1; });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. ทวนสอบ
   ══════════════════════════════════════════════════════════════════════════ */
function apiSearch(q) {
  return guard_('apiSearch', function () {
    me_();
    return ok_(searchLots_(str_(q, 100), 200));
  });
}

function apiTraceLot(lotKey) {
  return guard_('apiTraceLot', function () {
    me_();
    return ok_(buildLotTrace_(String(lotKey)));
  });
}

function apiTraceDocument(docNum) {
  return guard_('apiTraceDocument', function () {
    me_();
    return ok_(traceFromDocument_(str_(docNum, 60)));
  });
}

/** ตัวอย่างช่วงซีเรียลที่จะถูกดึงเข้าเคส — ให้ผู้ใช้เห็นก่อนกดเปิดเคสจริง */
function apiPreviewScope(itemCode, kind, distNumber, snFrom, snTo) {
  return guard_('apiPreviewScope', function () {
    me_();
    var code = str_(itemCode, 60);
    if (String(kind).toUpperCase() === MNG.SERIAL) {
      var serials = expandSerialRange_(code, snFrom, snTo);
      var total = 0, inStock = 0, delivered = 0;
      serials.forEach(function (sn) {
        var r = reconcile_(lotKey_(code, sn));
        total += 1; inStock += r.on_hand; delivered += r.shipped_out;
      });
      return ok_({ kind: MNG.SERIAL, count: serials.length, sample: serials.slice(0, 50),
                   display: summarizeSerials_(serials),
                   qty_affected: total, qty_in_stock: round3_(inStock), qty_delivered: round3_(delivered) });
    }
    var k = lotKey_(code, str_(distNumber, 60));
    var rec = reconcile_(k);
    return ok_({ kind: MNG.BATCH, count: 1, sample: [str_(distNumber, 60)],
                 display: str_(distNumber, 60),
                 qty_affected: rec.received, qty_in_stock: rec.on_hand, qty_delivered: rec.shipped_out,
                 unaccounted: rec.unaccounted });
  });
}

function apiSaveTraceNote(p) {
  return guard_('apiSaveTraceNote', function () {
    var u = requirePerm_('saveTraceNote');
    p = p || {};
    var lotKey = str_(p.lot_key, 140);
    if (!lotKey || lotKey.indexOf('|') === -1) fail_('ไม่พบล็อตที่จะบันทึกหมายเหตุ');
    var parts = lotKey.split('|');
    var now = nowStamp_();

    return idempotent_(p.clientKey, function () {
      return withLock_(function () {
        var existing = findRow_(TAB.TRACE_NOTES, 'lot_key', lotKey);
        if (existing) {
          var r = updateRow_(TAB.TRACE_NOTES, 'lot_key', lotKey, {
            mgs_receiving_lot: str_(p.mgs_receiving_lot, 60),
            qc_status: str_(p.qc_status, 40),
            note: str_(p.note, 2000),
            evidence_file_ids: str_(p.evidence_file_ids, 1000),
            updated_by: u.email, updated_at: now
          }, null);
          logAudit_('SAVE_TRACE_NOTE', 'Trace_Notes', lotKey, r.before, r.after, p.clientKey);
        } else {
          appendRows_(TAB.TRACE_NOTES, [{
            note_id: uuid_(), lot_key: lotKey, item_code: parts[0], dist_number: parts[1] || '',
            mgs_receiving_lot: str_(p.mgs_receiving_lot, 60), qc_status: str_(p.qc_status, 40),
            note: str_(p.note, 2000), evidence_file_ids: str_(p.evidence_file_ids, 1000),
            created_by: u.email, created_at: now, updated_by: u.email, updated_at: now
          }]);
          logAudit_('SAVE_TRACE_NOTE', 'Trace_Notes', lotKey, null, { note: str_(p.note, 200) }, p.clientKey);
        }
        return ok_({ lot_key: lotKey });
      });
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3. เคสเรียกคืน
   ══════════════════════════════════════════════════════════════════════════ */
function apiListCases(filter) {
  return guard_('apiListCases', function () {
    me_();
    return ok_(listCases_(filter));
  });
}

function apiGetCase(caseNo) {
  return guard_('apiGetCase', function () {
    me_();
    return ok_(getCase_(str_(caseNo, 40)));
  });
}

function apiOpenCase(p) {
  return guard_('apiOpenCase', function () {
    var u = requirePerm_('openCase');
    p = p || {};
    return idempotent_(p.clientKey, function () {
      return withLock_(function () { return openCase_(p, u); });
    });
  });
}

function apiRebuildTracking(p) {
  return guard_('apiRebuildTracking', function () {
    var u = requirePerm_('buildTracking');
    return idempotent_((p || {}).clientKey, function () {
      return withLock_(function () { return rebuildTracking_(p || {}, u); });
    });
  });
}

function apiUpdateTracking(p) {
  return guard_('apiUpdateTracking', function () {
    var u = requirePerm_('updateTracking');
    return idempotent_((p || {}).clientKey, function () { return updateTracking_(p || {}, u); });
  });
}

function apiUpdateAction(p) {
  return guard_('apiUpdateAction', function () {
    var u = requirePerm_('updateAction');
    return idempotent_((p || {}).clientKey, function () { return updateAction_(p || {}, u); });
  });
}

function apiApproveAction(p) {
  return guard_('apiApproveAction', function () {
    var u = requirePerm_('approveAction');
    return idempotent_((p || {}).clientKey, function () { return approveAction_(p || {}, u); });
  });
}

function apiAdvanceCase(p) {
  return guard_('apiAdvanceCase', function () {
    var u = requirePerm_('advanceCaseStatus');
    return idempotent_((p || {}).clientKey, function () { return advanceCase_(p || {}, u); });
  });
}

function apiCloseCase(p) {
  return guard_('apiCloseCase', function () {
    var u = requirePerm_('closeCase');
    return idempotent_((p || {}).clientKey, function () { return closeCase_(p || {}, u); });
  });
}

function apiCancelCase(p) {
  return guard_('apiCancelCase', function () {
    var u = requirePerm_('cancelCase');
    return idempotent_((p || {}).clientKey, function () { return cancelCase_(p || {}, u); });
  });
}

function apiReleaseHold(p) {
  return guard_('apiReleaseHold', function () {
    var u = requirePerm_('releaseHold');
    return idempotent_((p || {}).clientKey, function () {
      return withLock_(function () { return releaseHold_(p || {}, u); });
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   4. ทดสอบทวนสอบย้อนกลับ
   ══════════════════════════════════════════════════════════════════════════ */
function apiListMockRecalls() {
  return guard_('apiListMockRecalls', function () { me_(); return ok_(listMockRecalls_()); });
}

function apiGetMockRecall(testNo) {
  return guard_('apiGetMockRecall', function () { me_(); return ok_(getMockRecall_(str_(testNo, 40))); });
}

function apiStartMockRecall(p) {
  return guard_('apiStartMockRecall', function () {
    var u = requirePerm_('startMockRecall');
    return idempotent_((p || {}).clientKey, function () {
      return withLock_(function () { return startMockRecall_(p || {}, u); });
    });
  });
}

function apiUpdateMockLine(p) {
  return guard_('apiUpdateMockLine', function () {
    var u = requirePerm_('startMockRecall');
    return idempotent_((p || {}).clientKey, function () { return updateMockLine_(p || {}, u); });
  });
}

function apiFinishMockRecall(p) {
  return guard_('apiFinishMockRecall', function () {
    var u = requirePerm_('finishMockRecall');
    return idempotent_((p || {}).clientKey, function () { return finishMockRecall_(p || {}, u); });
  });
}

function apiReviewMockRecall(p) {
  return guard_('apiReviewMockRecall', function () {
    var u = requirePerm_('reviewMockRecall');
    return idempotent_((p || {}).clientKey, function () { return reviewMockRecall_(p || {}, u); });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   5. หน้ารวม — สิ่งที่ต้องเห็นก่อนเลื่อนจอ
   ══════════════════════════════════════════════════════════════════════════ */
function apiDashboard() {
  return guard_('apiDashboard', function () {
    var u = me_();
    var cases = listCases_('ACTIVE');

    // อ่านตารางติดตามครั้งเดียวแล้วจัดกลุ่ม — อ่านต่อเคสจะทำให้ 30 เคสอ่านชีต 30 รอบ
    var trackByCase = {};
    readTable_(TAB.TRACKING, true).rows.forEach(function (t) {
      (trackByCase[String(t.case_no)] = trackByCase[String(t.case_no)] || []).push(t);
    });

    var myTasks = [];
    cases.forEach(function (cs) {
      (trackByCase[cs.case_no] || []).forEach(function (t) {
        var st = String(t.status).toUpperCase();
        if (st === 'COMPLETED' || st === 'NOT_REACHED') return;
        myTasks.push({
          case_no: cs.case_no, track_id: String(t.track_id),
          risk_class: cs.risk_class,
          party_name: String(t.party_name || ''), project: String(t.project || ''),
          location_type: String(t.location_type),
          qty_pending: parseQty_(t.qty_pending),
          required_action: String(t.required_action),
          required_action_th: REQUIRED_ACTION[String(t.required_action)] || '',
          status: st, status_th: TRACK_STATUS[st] || st,
          doc_num: String(t.doc_num || '')
        });
      });
    });
    myTasks.sort(function (a, b) {
      var rank = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };
      var ra = rank[a.risk_class] === undefined ? 9 : rank[a.risk_class];
      var rb = rank[b.risk_class] === undefined ? 9 : rank[b.risk_class];
      if (ra !== rb) return ra - rb;
      return b.qty_pending - a.qty_pending;
    });

    var heldQty = 0, heldRows = 0;
    readTable_(TAB.HOLDS, true).rows.forEach(function (h) {
      if (String(h.status).toUpperCase() !== 'HOLD') return;
      heldRows++; heldQty += parseQty_(h.qty_hold);
    });

    var mocks = listMockRecalls_();
    var lastMock = mocks.filter(function (m) { return m.result !== 'IN_PROGRESS'; })[0] || null;
    var openMock = mocks.filter(function (m) { return m.result === 'IN_PROGRESS'; });

    return ok_({
      user_role: u.role,
      sync: syncHealth_(),
      counts: {
        cases_active: cases.length,
        cases_critical: cases.filter(function (c) { return c.risk_class === 'CRITICAL'; }).length,
        tasks_pending: myTasks.length,
        qty_unaccounted: round3_(cases.reduce(function (s, c) { return s + c.qty_unaccounted; }, 0)),
        held_rows: heldRows, held_qty: round3_(heldQty)
      },
      cases: cases.slice(0, 50),
      tasks: myTasks.slice(0, 100),
      last_mock: lastMock,
      open_mocks: openMock
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   6. แนบหลักฐาน
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * @param {{case_no:string, name:string, mime:string, b64:string}} p
 * ไฟล์ถูกบีบขนาดฝั่ง client แล้ว — ที่นี่กันไว้อีกชั้นไม่ให้เกิน 5MB
 */
function apiUploadEvidence(p) {
  return guard_('apiUploadEvidence', function () {
    var u = me_();
    p = p || {};
    if (!p.b64) fail_('ไม่พบไฟล์');
    if (String(p.b64).length > 7000000) fail_('ไฟล์ใหญ่เกินไป — กรุณาถ่ายใหม่หรือย่อขนาดก่อน (ไม่เกิน 5 MB)');
    var mime = String(p.mime || 'application/octet-stream');
    if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(mime)) {
      fail_('รองรับเฉพาะรูปภาพและไฟล์ PDF');
    }
    if (!CFG.DRIVE_ROOT_ID) fail_('ยังไม่ได้ตั้งค่าโฟลเดอร์เก็บหลักฐาน');

    var caseNo = str_(p.case_no, 40);
    var folderId = '';
    if (caseNo) {
      var cs = findRow_(TAB.CASES, 'case_no', caseNo);
      if (!cs) fail_('ไม่พบเคส ' + caseNo);
      folderId = String(cs.drive_folder_id || '') || createCaseFolder_(caseNo);
    }
    var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getFolderById(CFG.DRIVE_ROOT_ID);

    var safeName = str_(p.name, 120).replace(/[\\\/:*?"<>|]/g, '_') || 'evidence';
    var stamped = Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd-HHmmss') + '_' + safeName;
    var blob = Utilities.newBlob(Utilities.base64Decode(p.b64), mime, stamped);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

    logAudit_('UPLOAD_EVIDENCE', 'Drive', file.getId(), null,
              { name: stamped, case_no: caseNo, by: u.email }, p.clientKey);
    return ok_({ file_id: file.getId(), name: stamped,
                 url: 'https://drive.google.com/file/d/' + file.getId() + '/view' });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   7. รายงานตามแบบฟอร์ม QC — ส่งออกเป็นแท็บใน Google Sheets ให้เซ็นได้
   ══════════════════════════════════════════════════════════════════════════ */
/** สร้าง/อัปเดตแท็บ "FM-QC-TR-01 Traceability Master" ตามล็อตที่เลือก */
function apiExportTraceMaster(lotKeys) {
  return guard_('apiExportTraceMaster', function () {
    var u = me_();
    var keys = (lotKeys || []).map(String);
    if (!keys.length) fail_('กรุณาเลือกล็อตที่จะออกรายงานอย่างน้อย 1 รายการ');
    if (keys.length > 200) fail_('ออกรายงานได้ครั้งละไม่เกิน 200 ล็อต — กรองให้แคบลงก่อน');

    var head = ['Record No.', 'Product Type', 'Brand', 'Item Code', 'Product / Description',
      'Model / Part No.', 'Supplier', 'Supplier PO', 'Supplier Invoice / Shipment',
      'Supplier Lot / Batch', 'Serial Number', 'Receiving Date', 'MGS Receiving Lot',
      'Qty Received', 'Warehouse Location', 'DO / Invoice', 'Delivery Date', 'Customer',
      'Project / Site', 'Qty Delivered', 'Current Status', 'Recall Case No.', 'Remark'];

    var rows = [], n = 0;
    keys.forEach(function (k) {
      var t = buildLotTrace_(k);
      var back = t.backward[0] || {};
      var note = t.mgs_note || {};
      var recall = t.recall_cases.join(', ') || '-';
      var isSerial = String(t.lot.kind).toUpperCase() === MNG.SERIAL;

      var ships = t.forward.shipments.filter(function (s) { return s.to_customer; });
      if (!ships.length) ships = [null];

      ships.forEach(function (s) {
        n++;
        rows.push([
          'TR-' + ('0000' + n).slice(-4),
          t.lot.product_type, t.lot.brand, t.lot.item_code, t.lot.item_name, t.lot.model,
          back.party_name || '', back.supplier_po_no || '', back.supplier_invoice_no || '',
          isSerial ? (t.lot.supplier_lot || '') : t.lot.dist_number,
          isSerial ? t.lot.dist_number : '',
          back.doc_date || t.lot.in_date || '',
          note.mgs_receiving_lot || '',
          t.reconcile.received,
          s ? s.whs_name : (t.forward.on_hand.map(function (o) { return o.whs_name; }).join(', ') || ''),
          s ? s.doc_num : '', s ? s.doc_date : '', s ? s.party_name : '', s ? s.project : '',
          s ? s.qty : 0,
          statusOfLot_(t),
          recall,
          note.note || ''
        ]);
      });
    });

    var name = 'FM-QC-TR-01 Master ' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd-HHmm');
    var sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    sh.setFrozenRows(1);

    logAudit_('EXPORT_TRACE_MASTER', 'Report', name, null, { lots: keys.length, rows: rows.length }, '');
    return ok_({ sheet_name: name, rows: rows.length,
                 url: ss_().getUrl() + '#gid=' + sh.getSheetId() });
  });
}

function statusOfLot_(t) {
  if (t.holds.length) return 'HOLD';
  if (t.reconcile.on_hand > 0 && t.reconcile.shipped_out > 0) return 'Partially Delivered';
  if (t.reconcile.on_hand > 0) return 'In Stock';
  if (t.reconcile.shipped_out > 0) return 'Delivered';
  return 'No Stock';
}


/* ═════════════════════════════════════════════════════════ 08_Setup.gs ════ */

/**
 * MGS Traceability & Recall — 08_Setup.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * ติดตั้งครั้งแรก · ตรวจสุขภาพระบบ · ตัวตั้งเวลา · สำรองข้อมูล
 * ฟังก์ชันในไฟล์นี้รันจาก Apps Script editor ไม่ได้เรียกจากหน้าเว็บ
 *
 * ลำดับการติดตั้ง (ทำครั้งเดียว)
 *   1. setupCreateWorkbook()      สร้างสเปรดชีตและแท็บทั้งหมด
 *   2. ใส่รายชื่อผู้ใช้ในแท็บ Users
 *   3. setupScriptProperties()    ดูว่ายังขาดค่าอะไร
 *   4. setupTriggers()            ตั้งตัวตั้งเวลา
 *   5. runSelfTest()              ตรวจว่าโครงตารางตรงกับโค้ด
 *   6. Deploy > New deployment    (Execute as: Me · Access: MGS domain)
 */

/* ══════════════════════════════════════════════════════════════════════════
   1. สร้างไฟล์ฐานข้อมูล
   ══════════════════════════════════════════════════════════════════════════ */
function setupCreateWorkbook() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('SS_ID');
  var ss;

  if (existing) {
    ss = SpreadsheetApp.openById(existing);
    console.log('ใช้ไฟล์เดิม: ' + ss.getUrl());
  } else {
    ss = SpreadsheetApp.create('MGS-TRACEABILITY-' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyy'));
    ss.setSpreadsheetTimeZone(CFG.TZ);
    props.setProperty('SS_ID', ss.getId());
    CFG.SS_ID = ss.getId();          // CFG อ่านค่าตอนโหลดสคริปต์ ต้องอัปเดตให้ execution นี้ใช้ต่อได้
    console.log('สร้างไฟล์ใหม่: ' + ss.getUrl());
  }

  var created = [], kept = [];
  Object.keys(SCHEMA).forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    if (!sh) {
      sh = ss.insertSheet(tab);
      created.push(tab);
    } else {
      kept.push(tab);
    }
    var headers = SCHEMA[tab];
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#eaece9');
    sh.setFrozenRows(1);
    if (sh.getMaxColumns() > headers.length) {
      sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
    }
  });

  // ลบแท็บเปล่าที่ Google สร้างมาให้ตอนสร้างไฟล์
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  seedSettings_(ss);
  seedDriveFolder_();

  console.log('สร้างแท็บใหม่: ' + (created.join(', ') || '(ไม่มี)'));
  console.log('แท็บที่มีอยู่แล้ว: ' + (kept.join(', ') || '(ไม่มี)'));
  console.log('\n★ ขั้นต่อไป: ใส่รายชื่อผู้ใช้ในแท็บ Users แล้วรัน setupTriggers()');
  console.log('★ อย่าแชร์ไฟล์นี้ให้ผู้ใช้ทั่วไป — ทุกคนต้องเข้าผ่านเว็บแอปเท่านั้น');
  return ss.getUrl();
}

function seedSettings_(ss) {
  var sh = ss.getSheetByName(TAB.SETTINGS);
  if (sh.getLastRow() > 1) return;
  var rows = [
    ['mock_recall_target_min', 120, 'เวลาเป้าหมายของการทดสอบทวนสอบ (นาที)'],
    ['mock_recall_every_days', 180, 'ต้องทดสอบทวนสอบทุกกี่วัน'],
    ['reconcile_tolerance_qty', 0, 'ส่วนต่างจำนวนที่ยอมรับได้ตอนกระทบยอด'],
    ['sync_stale_min', 90, 'ถือว่าข้อมูล SAP ค้างเมื่อไม่มีข้อมูลใหม่เกินกี่นาที'],
    ['company_name', 'M Global Sourcing Co., Ltd.', 'ชื่อบริษัทที่แสดงบนรายงาน']
  ];
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

function seedDriveFolder_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DRIVE_ROOT_ID')) return;
  var name = 'MGS Traceability Evidence';
  var it = DriveApp.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  props.setProperty('DRIVE_ROOT_ID', folder.getId());
  CFG.DRIVE_ROOT_ID = folder.getId();
  console.log('โฟลเดอร์หลักฐาน: ' + folder.getUrl());
}

/* ══════════════════════════════════════════════════════════════════════════
   2. ค่าที่ต้องตั้งใน Script Properties
   ══════════════════════════════════════════════════════════════════════════ */
function setupScriptProperties() {
  var props = PropertiesService.getScriptProperties();
  var required = [
    ['SS_ID', 'ID ของสเปรดชีตฐานข้อมูล (setupCreateWorkbook ตั้งให้อัตโนมัติ)', true],
    ['DRIVE_ROOT_ID', 'ID โฟลเดอร์เก็บหลักฐาน (setupCreateWorkbook ตั้งให้อัตโนมัติ)', true],
    ['SAP_PUSH_SECRET', 'กุญแจลับสำหรับเซ็น payload จากตัวส่งข้อมูลในออฟฟิศ', true],
    ['LARK_WEBHOOK', 'URL webhook ของกลุ่ม Lark (ใช้แบบข้อความอย่างเดียว)', false],
    ['LARK_APP_ID', 'App ID ของ Lark bot (ใช้เมื่อต้องส่งไฟล์/การ์ด)', false],
    ['LARK_APP_SECRET', 'App Secret ของ Lark bot', false],
    ['LARK_CHAT_QC', 'chat_id ของกลุ่ม QC (ใช้คู่กับ Bot API)', false]
  ];
  var lines = [];
  required.forEach(function (r) {
    var v = props.getProperty(r[0]);
    lines.push((v ? '  ✅ ' : (r[2] ? '  ❌ ' : '  ⬜ ')) + r[0] + ' — ' + r[1]);
  });
  console.log('สถานะค่าตั้งค่า (ตั้งที่ Project Settings > Script Properties):\n' + lines.join('\n'));
  return lines.join('\n');
}

/** สร้างกุญแจลับสำหรับตัวส่งข้อมูล — รันครั้งเดียวแล้วคัดลอกไปใส่ในตัวส่ง */
function setupGeneratePushSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SAP_PUSH_SECRET')) {
    console.log('มีกุญแจอยู่แล้ว — ถ้าจะเปลี่ยนให้ลบค่าเดิมทิ้งก่อน (ตัวส่งข้อมูลจะใช้ไม่ได้ทันที)');
    return null;
  }
  var secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('SAP_PUSH_SECRET', secret);
  console.log('SAP_PUSH_SECRET = ' + secret + '\n★ คัดลอกไปใส่ในตัวส่งข้อมูลฝั่งออฟฟิศ แล้วอย่าเก็บไว้ที่อื่น');
  return secret;
}

/* ══════════════════════════════════════════════════════════════════════════
   3. ตัวตั้งเวลา — ลบของเดิมก่อนเสมอ ไม่งั้นสะสมจนงานเดียวยิงห้ารอบ
   ══════════════════════════════════════════════════════════════════════════ */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('checkSyncHealthJob').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkCaseSlaJob').timeBased().atHour(8).everyDays(1)
    .inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('checkMockRecallDueJob').timeBased().onMonthDay(1).atHour(9)
    .inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('weeklyBackupJob').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2).inTimezone(CFG.TZ).create();

  console.log('ตั้งตัวตั้งเวลาแล้ว 4 ตัว:\n' +
    '  · checkSyncHealthJob      ทุกชั่วโมง — เตือนเมื่อข้อมูล SAP ค้าง\n' +
    '  · checkCaseSlaJob         ทุกวัน 08:00 — เตือนเคสเกินกำหนด\n' +
    '  · checkMockRecallDueJob   ทุกวันที่ 1 09:00 — เตือนให้ทดสอบทวนสอบ\n' +
    '  · weeklyBackupJob         อาทิตย์ 02:00 — สำรองข้อมูล');
}

/* ══════════════════════════════════════════════════════════════════════════
   4. สำรองข้อมูล — เก็บย้อนหลัง 12 สัปดาห์
   ประวัติเวอร์ชันของ Sheets กันการแก้ผิดได้ แต่ไม่กันสคริปต์ที่เขียนทับ
   4,000 แถวอย่างแนบเนียน จึงต้องมีสำเนาแยกไฟล์
   ══════════════════════════════════════════════════════════════════════════ */
function weeklyBackupJob() {
  try {
    var src = ss_();
    var stamp = Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd');
    var folderName = 'MGS Traceability Backups';
    var it = DriveApp.getFoldersByName(folderName);
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);

    var copy = DriveApp.getFileById(src.getId()).makeCopy('BACKUP-' + stamp + '-' + src.getName(), folder);

    // ลบสำเนาที่เก่ากว่า 12 สัปดาห์
    var cutoff = new Date().getTime() - 84 * 86400000;
    var files = folder.getFiles(), removed = 0;
    while (files.hasNext()) {
      var f = files.next();
      if (f.getId() !== copy.getId() && f.getDateCreated().getTime() < cutoff) {
        f.setTrashed(true); removed++;
      }
    }
    logSync_('BACKUP', '-', 0, 0, 'OK', 0, 'สำรองข้อมูลแล้ว ลบของเก่า ' + removed + ' ไฟล์', stamp);
    console.log('สำรองข้อมูลเรียบร้อย: ' + copy.getUrl());
  } catch (e) {
    logError_('weeklyBackupJob', e);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5. ตรวจสุขภาพระบบ — รันก่อนและหลัง deploy ทุกครั้ง
   ══════════════════════════════════════════════════════════════════════════ */
function runSelfTest() {
  var results = [];
  function t(name, fn) {
    try { fn(); results.push('PASS  ' + name); }
    catch (e) { results.push('FAIL  ' + name + ' — ' + String(e && e.message || e).replace('[U] ', '')); }
  }

  t('ตั้งค่า SS_ID แล้ว', function () {
    if (!CFG.SS_ID) throw new Error('ยังไม่ได้ตั้ง SS_ID');
    ss_();
  });

  t('แท็บครบทุกตาราง', function () {
    var missing = Object.keys(SCHEMA).filter(function (tab) {
      return !ss_().getSheetByName(tab);
    });
    if (missing.length) throw new Error('ขาดแท็บ: ' + missing.join(', '));
  });

  t('header ตรงกับโค้ดทุกแท็บ', function () {
    var bad = [];
    Object.keys(SCHEMA).forEach(function (tab) {
      var sh = ss_().getSheetByName(tab);
      if (!sh) return;
      var want = SCHEMA[tab];
      var got = sh.getRange(1, 1, 1, want.length).getValues()[0].map(function (h) { return String(h).trim(); });
      for (var i = 0; i < want.length; i++) {
        if (got[i] !== want[i]) { bad.push(tab + ' คอลัมน์ ' + (i + 1) + ': ควรเป็น "' + want[i] + '" แต่เป็น "' + got[i] + '"'); break; }
      }
    });
    if (bad.length) throw new Error(bad.join(' | '));
  });

  t('มีผู้ใช้สิทธิ์ ADMIN อย่างน้อย 1 คน', function () {
    var admins = readTable_(TAB.USERS).rows.filter(function (r) {
      return String(r.role).toUpperCase() === 'ADMIN' && isTrue_(r.is_active);
    });
    if (!admins.length) throw new Error('ยังไม่มี ADMIN ในแท็บ Users');
  });

  t('SAP_PUSH_SECRET ถูกตั้งแล้ว', function () { secret_('SAP_PUSH_SECRET'); });

  t('ตัวแปลงจำนวนทำงานถูก', function () {
    if (parseQty_('1,250.50') !== 1250.5) throw new Error('ลูกน้ำ');
    if (parseQty_(' 12 ') !== 12) throw new Error('ช่องว่าง');
    if (parseQty_('') !== 0) throw new Error('ค่าว่าง');
    var threw = false;
    try { parseQty_('abc'); } catch (e) { threw = true; }
    if (!threw) throw new Error('ค่าที่ไม่ใช่ตัวเลขต้องเป็น error ไม่ใช่ 0');
  });

  t('ตัวกันสูตรฝังในเซลล์ทำงาน', function () {
    if (sanitizeCell_('=IMPORTRANGE("x","y")') !== "'=IMPORTRANGE(\"x\",\"y\")") throw new Error('ไม่ได้ใส่ prefix');
    if (sanitizeCell_('-5') !== '-5') throw new Error('เลขติดลบไม่ควรถูกแตะ');
  });

  t('ตารางสถานะเคสเดินหน้าอย่างเดียว', function () {
    assertTransition_('OPEN', 'CONTAINED');
    var threw = false;
    try { assertTransition_('CLOSED', 'OPEN'); } catch (e) { threw = true; }
    if (!threw) throw new Error('ปิดแล้วต้องเปิดใหม่ไม่ได้');
  });

  t('คำนวณเวลาการทดสอบถูกต้อง', function () {
    if (diffMinutes_('2026-08-22 09:00:00', '2026-08-22 11:30:00') !== 150) throw new Error('ผลไม่ตรง');
  });

  t('การกระทบยอดคำนวณได้', function () {
    var lots = readTable_(TAB.LOTS).rows;
    if (!lots.length) { results.push('SKIP  ยังไม่มีข้อมูล SAP ให้ทดสอบการกระทบยอด'); return; }
    reconcile_(String(lots[0].lot_key));
  });

  t('ข้อมูล SAP ไม่ค้าง', function () {
    var h = syncHealth_();
    if (h.stale) throw new Error(h.message);
  });

  var out = results.join('\n');
  console.log(out);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   6. ข้อมูลตัวอย่างสำหรับทดลองใช้ — ห้ามรันบนไฟล์จริง
   ตัวเลขชุดนี้ตรงกับตัวอย่างในฟอร์ม QC ที่ทีมใช้อยู่ เพื่อให้เทียบผลกันได้
   ══════════════════════════════════════════════════════════════════════════ */
function setupSeedDemoData() {
  var counts = {};
  SAP_TABS.forEach(function (t) { counts[t] = sheet_(t).getLastRow() - 1; });
  var total = 0;
  Object.keys(counts).forEach(function (k) { total += Math.max(0, counts[k]); });
  if (total > 0) {
    console.log('❌ มีข้อมูลอยู่แล้ว ' + total + ' แถว — ไม่เติมข้อมูลตัวอย่างทับ');
    return;
  }

  var now = nowStamp_();
  var serials = [];
  for (var i = 1; i <= 20; i++) serials.push('SG50R-A' + ('00' + i).slice(-3));

  replaceTable_(TAB.ITEMS, [
    { item_code: 'INV-SG5RS', item_name: 'SG5.0RS', item_group: 'Inverter', brand: 'Sungrow',
      product_type: 'Inverter', mng_method: 'SERIAL', uom: 'PCS', is_active: 'TRUE', synced_at: now },
    { item_code: 'RAIL-4200', item_name: 'EPR-R01N-4200', item_group: 'Mounting', brand: 'EMPERY',
      product_type: 'Rail', mng_method: 'BATCH', uom: 'PCS', is_active: 'TRUE', synced_at: now }
  ]);

  replaceTable_(TAB.BP, [
    { card_code: 'S0001', card_name: 'Supplier A', card_type: 'S', is_active: 'TRUE', synced_at: now },
    { card_code: 'S0002', card_name: 'Supplier B (EMPERY)', card_type: 'S', is_active: 'TRUE', synced_at: now },
    { card_code: 'C0001', card_name: 'Customer A', card_type: 'C', is_active: 'TRUE', synced_at: now },
    { card_code: 'C0002', card_name: 'Customer B', card_type: 'C', is_active: 'TRUE', synced_at: now }
  ]);

  replaceTable_(TAB.WHS, [
    { whs_code: 'CHOD-WH', whs_name: 'คลังฉะเชิงเทรา', location_type: 'INTERNAL', is_active: 'TRUE', synced_at: now },
    { whs_code: 'WH-A01', whs_name: 'คลังกลาง A01', location_type: 'INTERNAL', is_active: 'TRUE', synced_at: now }
  ]);

  replaceTable_(TAB.PO, [
    { doc_entry: 101, line_num: 0, doc_num: 'PO-260801', doc_date: '2026-08-01', card_code: 'S0001',
      card_name: 'Supplier A', item_code: 'INV-SG5RS', dscription: 'Solar Inverter SG5.0RS',
      quantity: 20, open_qty: 0, whs_code: 'CHOD-WH', num_at_card: '', doc_status: 'C', project: '', synced_at: now },
    { doc_entry: 102, line_num: 0, doc_num: 'PO-260802', doc_date: '2026-08-02', card_code: 'S0002',
      card_name: 'Supplier B (EMPERY)', item_code: 'RAIL-4200', dscription: 'Aluminium Rail 4200 mm',
      quantity: 500, open_qty: 0, whs_code: 'CHOD-WH', num_at_card: '', doc_status: 'C', project: '', synced_at: now }
  ]);

  replaceTable_(TAB.GRPO, [
    { doc_entry: 201, line_num: 0, doc_num: 'GR-260807-1', doc_date: '2026-08-07', card_code: 'S0001',
      card_name: 'Supplier A', item_code: 'INV-SG5RS', dscription: 'Solar Inverter SG5.0RS',
      quantity: 20, whs_code: 'CHOD-WH', num_at_card: 'INV-260801',
      base_entry: 101, base_line: 0, base_doc_num: 'PO-260801', project: '', synced_at: now },
    { doc_entry: 202, line_num: 0, doc_num: 'GR-260807-2', doc_date: '2026-08-07', card_code: 'S0002',
      card_name: 'Supplier B (EMPERY)', item_code: 'RAIL-4200', dscription: 'Aluminium Rail 4200 mm',
      quantity: 500, whs_code: 'CHOD-WH', num_at_card: 'INV-260802',
      base_entry: 102, base_line: 0, base_doc_num: 'PO-260802', project: '', synced_at: now }
  ]);

  replaceTable_(TAB.DELIVERY, [
    { doc_entry: 301, line_num: 0, doc_num: 'DO-260812', doc_date: '2026-08-12', card_code: 'C0001',
      card_name: 'Customer A', item_code: 'INV-SG5RS', dscription: 'Solar Inverter SG5.0RS',
      quantity: 7, whs_code: 'CHOD-WH', ship_to_code: '', address: '', project: 'Project A', synced_at: now },
    { doc_entry: 302, line_num: 0, doc_num: 'DO-260815', doc_date: '2026-08-15', card_code: 'C0002',
      card_name: 'Customer B', item_code: 'INV-SG5RS', dscription: 'Solar Inverter SG5.0RS',
      quantity: 8, whs_code: 'CHOD-WH', ship_to_code: '', address: '', project: 'Project B', synced_at: now },
    { doc_entry: 303, line_num: 0, doc_num: 'DO-260815-2', doc_date: '2026-08-15', card_code: 'C0002',
      card_name: 'Customer B', item_code: 'RAIL-4200', dscription: 'Aluminium Rail 4200 mm',
      quantity: 320, whs_code: 'CHOD-WH', ship_to_code: '', address: '', project: 'Project B', synced_at: now }
  ]);

  var lots = [], moves = [], stock = [];
  serials.forEach(function (sn) {
    lots.push({ item_code: 'INV-SG5RS', dist_number: sn, kind: 'SERIAL', sys_number: '',
                mnf_serial: sn, supplier_lot: 'LOT-2607-A', in_date: '2026-08-07',
                exp_date: '', notes: '', synced_at: now, lot_key: lotKey_('INV-SG5RS', sn) });
    moves.push({ lot_key: lotKey_('INV-SG5RS', sn), item_code: 'INV-SG5RS', dist_number: sn, kind: 'SERIAL',
                 obj_type: '20', doc_entry: 201, doc_num: 'GR-260807-1', line_num: 0, doc_date: '2026-08-07',
                 direction: 'IN', quantity: 1, whs_code: 'CHOD-WH', card_code: 'S0001',
                 card_name: 'Supplier A', project: '', synced_at: now });
  });
  // A001–A005 ยังอยู่ในคลัง · A006–A012 ส่ง Customer A · A013–A020 ส่ง Customer B
  serials.forEach(function (sn, idx) {
    if (idx < 5) {
      stock.push({ item_code: 'INV-SG5RS', dist_number: sn, whs_code: 'CHOD-WH',
                   quantity: 1, status: 'AVAILABLE', synced_at: now, lot_key: lotKey_('INV-SG5RS', sn) });
    } else if (idx < 12) {
      moves.push({ lot_key: lotKey_('INV-SG5RS', sn), item_code: 'INV-SG5RS', dist_number: sn, kind: 'SERIAL',
                   obj_type: '15', doc_entry: 301, doc_num: 'DO-260812', line_num: 0, doc_date: '2026-08-12',
                   direction: 'OUT', quantity: 1, whs_code: 'CHOD-WH', card_code: 'C0001',
                   card_name: 'Customer A', project: 'Project A', synced_at: now });
    } else {
      moves.push({ lot_key: lotKey_('INV-SG5RS', sn), item_code: 'INV-SG5RS', dist_number: sn, kind: 'SERIAL',
                   obj_type: '15', doc_entry: 302, doc_num: 'DO-260815', line_num: 0, doc_date: '2026-08-15',
                   direction: 'OUT', quantity: 1, whs_code: 'CHOD-WH', card_code: 'C0002',
                   card_name: 'Customer B', project: 'Project B', synced_at: now });
    }
  });

  lots.push({ item_code: 'RAIL-4200', dist_number: 'SUP-260705-A', kind: 'BATCH', sys_number: '',
              mnf_serial: '', supplier_lot: 'SUP-260705-A', in_date: '2026-08-07', exp_date: '',
              notes: '', synced_at: now, lot_key: lotKey_('RAIL-4200', 'SUP-260705-A') });
  moves.push({ lot_key: lotKey_('RAIL-4200', 'SUP-260705-A'), item_code: 'RAIL-4200',
               dist_number: 'SUP-260705-A', kind: 'BATCH', obj_type: '20', doc_entry: 202,
               doc_num: 'GR-260807-2', line_num: 0, doc_date: '2026-08-07', direction: 'IN',
               quantity: 500, whs_code: 'CHOD-WH', card_code: 'S0002',
               card_name: 'Supplier B (EMPERY)', project: '', synced_at: now });
  moves.push({ lot_key: lotKey_('RAIL-4200', 'SUP-260705-A'), item_code: 'RAIL-4200',
               dist_number: 'SUP-260705-A', kind: 'BATCH', obj_type: '15', doc_entry: 303,
               doc_num: 'DO-260815-2', line_num: 0, doc_date: '2026-08-15', direction: 'OUT',
               quantity: 320, whs_code: 'CHOD-WH', card_code: 'C0002',
               card_name: 'Customer B', project: 'Project B', synced_at: now });
  stock.push({ item_code: 'RAIL-4200', dist_number: 'SUP-260705-A', whs_code: 'CHOD-WH',
               quantity: 180, status: 'AVAILABLE', synced_at: now,
               lot_key: lotKey_('RAIL-4200', 'SUP-260705-A') });

  replaceTable_(TAB.LOTS, lots);
  replaceTable_(TAB.MOVES, moves.map(function (m, i) {
    m.move_id = [m.obj_type, m.doc_entry, m.line_num, m.lot_key, m.direction].join('~');
    return m;
  }));
  replaceTable_(TAB.STOCK, stock);
  replaceTable_(TAB.INVOICE, []);
  replaceTable_(TAB.RETURN, []);

  PropertiesService.getScriptProperties().setProperty('LAST_SYNC_AT', now);
  resetCtx_();

  console.log('เติมข้อมูลตัวอย่างแล้ว: ซีเรียล 20 · ล็อตราง 1 · การเคลื่อนไหว ' + moves.length + ' รายการ');
  console.log('ลองค้นด้วย SG50R-A001 หรือ DO-260812 หรือ SUP-260705-A');
}

/** ล้างข้อมูลทดลองทั้งหมด (ยกเว้น Users และ Settings) — ยืนยันด้วยการพิมพ์ค่าที่กำหนด */
function setupWipeAllData(confirmText) {
  if (confirmText !== 'ลบข้อมูลทั้งหมด') {
    console.log('ต้องเรียกแบบ setupWipeAllData("ลบข้อมูลทั้งหมด") เพื่อยืนยัน');
    return;
  }
  var skip = [TAB.USERS, TAB.SETTINGS];
  var wiped = [];
  Object.keys(SCHEMA).forEach(function (tab) {
    if (skip.indexOf(tab) !== -1) return;
    var sh = ss_().getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearContent();
    wiped.push(tab);
  });
  resetCtx_();
  CacheService.getScriptCache().removeAll(['user_map_v1', 'settings_v1']);
  console.log('ล้างแล้ว: ' + wiped.join(', '));
}

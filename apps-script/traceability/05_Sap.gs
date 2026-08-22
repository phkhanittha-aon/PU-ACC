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

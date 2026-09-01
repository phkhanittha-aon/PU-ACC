/**
 * Config.gs — ค่าตั้งต้น ตัวช่วย และการจัดการข้อผิดพลาด
 * ==========================================================================
 * ไม่มีอะไรที่ผูกกับเครื่องใดเครื่องหนึ่งอยู่ในโค้ด — รหัสและไอดีอยู่ใน Script Properties
 * ตั้งค่าที่ Project Settings → Script properties (ดู docs/19-phase1-pilot-runbook.md)
 *
 *   SPREADSHEET_ID     ไอดีของ Google Sheet ที่เป็นฐานข้อมูล
 *   DRIVE_ROOT_ID      ไอดีโฟลเดอร์เอกสารใน Shared drive
 *   ADMIN_EMAIL        คนที่จะได้รับแจ้งเมื่อระบบมีปัญหา
 *   LARK_APP_ID        จาก Lark Admin
 *   LARK_APP_SECRET    จาก Lark Admin — *ห้ามใส่ในโค้ดหรือขึ้น Git*
 *   LARK_GROUP_CHAT_ID กลุ่มที่จะส่งแจ้งเตือนรวม
 *   LARK_HOST          open.larksuite.com (สากล) หรือ open.feishu.cn (จีน)
 *   ENV                PILOT | PROD
 */

var TZ = 'Asia/Bangkok';

/** ข้อผิดพลาดที่คาดไว้แล้ว — ผู้ใช้อ่านรู้เรื่อง ไม่ใช่เหตุขัดข้องของระบบ */
function AppError(code, message) {
  var e = new Error(message);
  e.name = 'AppError';
  e.code = code;
  return e;
}
function isAppError_(e) { return e && e.name === 'AppError'; }

var Props = {
  get: function (key, fallback) {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    return (v === null || v === '') ? fallback : v;
  },
  set: function (key, value) {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
  },
  require: function (key) {
    var v = this.get(key);
    if (!v) throw AppError('CONFIG_MISSING', 'ยังไม่ได้ตั้งค่า Script Property: ' + key);
    return v;
  }
};

/* ค่าที่ปรับได้โดยไม่ต้องแก้โค้ด — อยู่ในแท็บ Config ของชีต แคชไว้ 6 ชม. */
var Config = {
  _key: 'CFG_MAP_V1',
  all: function () {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(this._key);
    if (hit) return JSON.parse(hit);
    var map = {};
    Repo.readAll(SHEETS.CONFIG).forEach(function (r) { map[r.config_key] = r.config_value; });
    cache.put(this._key, JSON.stringify(map), 21600);
    return map;
  },
  get: function (key, fallback) {
    var v = this.all()[key];
    return (v === undefined || v === '') ? fallback : v;
  },
  num: function (key, fallback) {
    var v = Num.parse(this.get(key, ''));
    return v === null ? fallback : v;
  },
  bust: function () { CacheService.getScriptCache().remove(this._key); }
};

/* ค่าตั้งต้นของแท็บ Config — ใช้ตอนติดตั้งครั้งแรก */
var CONFIG_DEFAULTS = [
  ['CASH_LIMIT',     '50000',  'วงเงินซื้อเงินสดต่อรายการ (บาท) — เกินกว่านี้ต้องเปิด PO'],
  ['DRIVE_KEEP_DAYS','90',     'เก็บไฟล์ต้นฉบับหลังรวมเล่มกี่วันก่อนลบ'],
  ['SLA_WARN_PCT',   '80',     'เตือนเมื่อใช้เวลาไปกี่ % ของ SLA'],
  ['DIGEST_HOUR',    '8',      'ส่งสรุปคิวงานตอนเช้ากี่โมง'],
  ['PILOT_ONLY',     'TRUE',   'TRUE = แก้ไขได้เฉพาะรายการที่อยู่ในแท็บ Pilot_Scope'],
  ['LARK_ON',        'TRUE',   'FALSE = ปิดการส่ง Lark ชั่วคราว (ใช้ตอนทดสอบ)'],
  ['IMPORT_START_STAGE', '8', 'รายการที่นำเข้าจาก Costing เริ่มที่ขั้นไหน (8 = จัดซื้อแนบ PO ที่เซ็นแล้ว)']
];

var Fmt = {
  date: function (d) {
    if (!d) return '';
    var v = (d instanceof Date) ? d : new Date(d);
    return isNaN(v.getTime()) ? String(d) : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  },
  stamp: function (d) {
    return Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  },
  /* วันที่แบบที่คนไทยอ่าน — ใช้แสดงผลเท่านั้น ห้ามเอาไปเก็บ */
  th: function (d) {
    if (!d) return '';
    var v = (d instanceof Date) ? d : new Date(d);
    return isNaN(v.getTime()) ? String(d) : Utilities.formatDate(v, TZ, 'dd/MM/yyyy');
  }
};

var Num = {
  /* ตัวเลขจากไฟล์ ERP มาเป็นข้อความได้ทุกแบบ — "1,250.00" / " 12 " / ""
     อ่านไม่ออกต้องคืน null ให้ผู้เรียกตัดสินใจ ไม่ใช่แปลงเป็น 0 เงียบ ๆ
     ยอดเงินที่กลายเป็น 0 โดยไม่มีใครรู้ คือวิธีที่เงินหาย */
  parse: function (v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/ /g, ' ').replace(/,/g, '').trim();
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  },
  money: function (n) {
    return '฿' + (Number(n) || 0).toLocaleString('en-US');
  }
};

var Json = {
  parse: function (s, fallback) {
    if (s === null || s === undefined || s === '') return fallback;
    try { return JSON.parse(s); } catch (e) { return fallback; }
  },
  stringify: function (o) { try { return JSON.stringify(o); } catch (e) { return ''; } }
};

/* กันสูตรแปลกปลอม — ข้อความที่ขึ้นต้นด้วย = + - @ ถูก Sheets ตีความเป็นสูตร
   ผู้ใช้พิมพ์ =IMPORTXML(...) ลงช่องหมายเหตุแล้วดูดข้อมูลออกไปได้จริง */
function sanitizeCell_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/* ---------- การล็อกและการจับข้อผิดพลาด ---------- */
var __lockDepth = 0;

/** ทุกการเขียนที่สำคัญต้องผ่านตัวนี้ — สองคนกดพร้อมกันต้องไม่ทับกัน */
function withLock_(fn, timeoutMs) {
  if (__lockDepth > 0) return fn();           // ล็อกซ้อนกันไม่ได้ ปล่อยผ่านชั้นใน
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 20000))
    throw AppError('BUSY', 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณากดใหม่อีกครั้งใน 2-3 วินาที');
  __lockDepth++;
  try { return fn(); } finally { __lockDepth--; lock.releaseLock(); }
}

/**
 * ห่อทุกฟังก์ชันที่หน้าจอเรียก — คืนผลแบบมีโครงสร้างเสมอ ไม่โยน exception ข้ามฝั่ง
 * ผลลัพธ์: {ok:true, data:...} หรือ {ok:false, code:..., error:'ข้อความที่ผู้ใช้อ่านรู้เรื่อง'}
 */
function safely_(name, fn) {
  try {
    return {ok:true, data:fn()};
  } catch (e) {
    if (isAppError_(e)) return {ok:false, code:e.code, error:String(e.message)};
    ErrorLog.write(name, e);
    return {ok:false, code:'INTERNAL',
            error:'ระบบขัดข้องระหว่าง "' + name + '" — แจ้ง IT แล้ว กรุณาลองใหม่อีกครั้ง'};
  }
}

var ErrorLog = {
  write: function (where, err) {
    var msg = (err && err.stack) ? err.stack : String(err);
    try {
      Repo.insert(SHEETS.ERRORS, {
        ts: new Date(), who: Session.getActiveUser().getEmail() || '(ไม่ทราบ)',
        where: where, message: String(msg).slice(0, 2000)
      });
    } catch (e2) { /* จดไม่ได้ก็ต้องไม่ทำให้พังซ้ำ */ }
    try { Logger.log('[' + where + '] ' + msg); } catch (e3) {}
    try { Lark.alertAdmin('ระบบขัดข้องที่ ' + where + '\n' + String(msg).slice(0, 500)); } catch (e4) {}
  }
};

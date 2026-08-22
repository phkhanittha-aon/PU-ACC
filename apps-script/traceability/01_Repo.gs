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

/** อีเมลเจ้าของสคริปต์ — คนที่กด deploy ระบบนี้ */
function ownerEmail_() {
  if (ownerEmail_._v !== undefined) return ownerEmail_._v;
  var v = '';
  try { v = String(Session.getEffectiveUser().getEmail() || '').toLowerCase().trim(); } catch (e) { v = ''; }
  ownerEmail_._v = v;
  return v;
}
ownerEmail_._v = undefined;

/**
 * เช็คว่าเป็นอีเมลของบริษัทหรือไม่ — ต้องลงท้ายด้วย @โดเมน พอดี
 * ห้ามใช้ indexOf: 'a@mglobalsourcing.net.evil.com' จะผ่านทันที
 */
function isCompanyEmail_(email) {
  var d = String(CFG.ALLOWED_DOMAIN || '').toLowerCase().trim();
  if (!d) return true;                       // ไม่ได้ตั้งโดเมน = ไม่กรอง
  var suffix = '@' + d;
  var e = String(email || '').toLowerCase();
  return e.length > suffix.length && e.slice(-suffix.length) === suffix;
}

/**
 * คืนโปรไฟล์ผู้ใช้ปัจจุบัน
 *
 * ลำดับการตัดสิน
 *   1. เจ้าของสคริปต์  -> ADMIN เสมอ
 *   2. มีชื่อในตาราง Users -> ใช้บทบาทตามที่ระบุ (ใช้ได้แม้อยู่นอกโดเมน เช่น ที่ปรึกษา)
 *   3. อยู่ในโดเมนบริษัทแต่ยังไม่ลงทะเบียน -> VIEWER ดูได้อย่างเดียว
 *   4. นอกเหนือจากนั้น -> ปฏิเสธ
 *
 * ข้อ 1 มีไว้กันไม่ให้ระบบล็อกคนติดตั้งออกจากระบบตัวเองตอนตาราง Users ยังว่าง
 * ไม่ได้เพิ่มอำนาจให้ใคร เพราะเจ้าของสคริปต์แก้สเปรดชีตตรงได้อยู่แล้ว
 */
function me_() {
  var email = currentUser_();
  var listed = userMap_()[email];

  if (email && email === ownerEmail_()) {
    if (listed && listed.active) return listed;
    return {
      email: email,
      name: listed ? listed.name : email,
      dept: listed ? listed.dept : 'IT',
      role: 'ADMIN', lark: '', active: true, owner: true
    };
  }

  if (listed) {
    if (!listed.active) fail_('บัญชี ' + email + ' ถูกปิดการใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ');
    return listed;
  }

  if (!isCompanyEmail_(email)) {
    fail_('บัญชี ' + email + ' ไม่มีสิทธิ์ใช้งานระบบนี้\n' +
          'ระบบรับเฉพาะอีเมลที่ลงท้ายด้วย @' + CFG.ALLOWED_DOMAIN + ' หรือคนที่มีชื่อในตาราง Users\n' +
          'ถ้าโดเมนของบริษัทไม่ใช่ @' + CFG.ALLOWED_DOMAIN + ' ให้ผู้ดูแลระบบไปที่ ' +
          'Project Settings > Script Properties แล้วตั้งค่า ALLOWED_DOMAIN เป็นโดเมนที่ถูกต้อง ' +
          'จากนั้น Deploy เวอร์ชันใหม่');
  }

  return { email: email, name: email, dept: '', role: 'VIEWER', lark: '', active: true, unlisted: true };
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

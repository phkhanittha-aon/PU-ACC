/**
 * Dashboard ตั้งเบิกทำจ่าย จากไฟล์ Costing Mech
 * ------------------------------------------------------------------
 * วิธีใช้ของผู้ใช้ (ทั้งหมดที่ต้องทำ)
 *   1. เอาไฟล์ Costing ใหม่ทับไฟล์เดิมในโฟลเดอร์ที่ตั้งไว้ (ชื่อไฟล์เดิม)
 *   2. เปิดสเปรดชีตนี้ แล้วกดเมนู  ตั้งเบิกทำจ่าย > อัพเดท Dashboard
 *
 * ไม่ต้องก๊อปวาง ไม่ต้องลบชีตเก่า ไม่ต้องแตะสูตร
 *
 * กติกาการประมวลผล (ตรงกับ tools/costing-extract.py ทุกข้อ)
 *   1. อ่านชีตแรกสุดของไฟล์เท่านั้น
 *   2. PO Payment Term ว่าง -> "UNKNOWN"
 *   3. ตัดแถวที่เงื่อนไขจ่ายมี LC / L/C ออก (ไม่สนตัวพิมพ์)
 *   4. ครบ 4 ฟิลด์ PO Number · Supplier · Price · Due Date -> 🟢  ไม่ครบ -> 🔴 พร้อมชื่อฟิลด์ที่ขาด
 *   5. ออก 7 คอลัมน์ + ธงยอดศูนย์
 *
 * หลักที่ยึด: ไฟล์เพี้ยนได้ แต่สคริปต์ต้องไม่ตายกลางคัน
 * คอลัมน์หายก็ขึ้นกล่องบอกว่าหายอะไร ไม่ใช่ error ยาว ๆ ที่ผู้ใช้อ่านไม่ออก
 */

/** ตั้งค่าที่แก้ได้ — แก้ตรงนี้ที่เดียว ไม่ต้องไล่แก้ในโค้ด */
var CFG = {
  SOURCE_FILE_NAME: 'Costing Mech.xlsx',   // ชื่อไฟล์ที่ผู้ใช้เอามาทับ
  SOURCE_FOLDER_ID: '',                    // ว่าง = ค้นทั้งไดรฟ์ · ใส่ id โฟลเดอร์จะเร็วและแม่นกว่า
  SHEET_DATA:  'Dashboard',                // ชีตผลลัพธ์ (ถูกเขียนทับทุกครั้ง)
  SHEET_LOG:   'Log',                      // ประวัติการอัพเดท
  KEEP_LOG:    200                         // เก็บ log กี่บรรทัด
};

var OUT_COLS  = ['PO Number', 'Supplier', 'PO Payment Term', 'Price', 'Currency',
                 'Due Date', 'Payment_Status'];
var KEY_FIELDS = ['PO Number', 'Supplier', 'Price', 'Due Date'];
var LC_RE = /l\s*\/?\s*c/i;
var UNKNOWN = 'UNKNOWN';

/** ชื่อคอลัมน์ที่ยอมรับได้ เผื่อไฟล์รอบหน้าเปลี่ยนหัวคอลัมน์เล็กน้อย */
var ALIASES = {
  'PO Number':       ['po number', 'po no', 'po_no'],
  'Supplier':        ['supplier', 'vendor'],
  'PO Payment Term': ['po payment term', 'payment term', 'term'],
  'Price':           ['price', 'unit price'],
  'Currency':        ['currency', 'cur'],
  'Due Date':        ['due date', 'duedate']
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ตั้งเบิกทำจ่าย')
    .addItem('อัพเดท Dashboard', 'updateDashboard')
    .addSeparator()
    .addItem('ตรวจไฟล์ต้นทางที่จะใช้', 'showSourceInfo')
    .addToUi();
}

/* ================= ตัวหลัก ================= */

function updateDashboard() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('มีคนกำลังอัพเดทอยู่ ลองใหม่อีกครั้งในสักครู่'); return; }
  try {
    var t0 = new Date();
    var file = findSourceFile_();
    if (!file.ok) { ui.alert('อัพเดทไม่ได้', file.msg, ui.ButtonSet.OK); return; }

    var grid = readFirstSheet_(file.id);
    if (!grid.ok) { ui.alert('อัพเดทไม่ได้', grid.msg, ui.ButtonSet.OK); return; }

    var res = transform_(grid.values);
    if (!res.ok) { ui.alert('อัพเดทไม่ได้', res.msg, ui.ButtonSet.OK); return; }

    writeDashboard_(res);
    var secs = ((new Date()) - t0) / 1000;
    log_(['อัพเดทสำเร็จ', file.name, file.updated, res.stats.read, res.stats.excluded_lc,
          res.rows.length, res.stats.complete, res.stats.incomplete, res.stats.zero_price,
          secs.toFixed(1) + ' วิ']);

    ui.alert('อัพเดท Dashboard แล้ว',
      'ไฟล์: ' + file.name + '\n' +
      'แก้ไขล่าสุด: ' + file.updated + '\n\n' +
      'อ่านมา ' + res.stats.read + ' แถว\n' +
      'ตัด LC ออก ' + res.stats.excluded_lc + ' แถว\n' +
      'เหลือเข้ากระบวนการ ' + res.rows.length + ' แถว\n' +
      '  🟢 พร้อมทำจ่าย ' + res.stats.complete + '\n' +
      '  🔴 ข้อมูลไม่ครบ ' + res.stats.incomplete + '\n\n' +
      'เงื่อนไขจ่ายว่าง (นับเป็น UNKNOWN) ' + res.stats.unknown_term + '\n' +
      '⚠️ ยอดเป็นศูนย์ ' + res.stats.zero_price + ' แถว — ตรวจก่อนตั้งเบิก',
      ui.ButtonSet.OK);
  } catch (e) {
    log_(['ผิดพลาด', String(e && e.message || e)]);
    SpreadsheetApp.getUi().alert('อัพเดทไม่สำเร็จ', String(e && e.message || e),
      SpreadsheetApp.getUi().ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function showSourceInfo() {
  var f = findSourceFile_(), ui = SpreadsheetApp.getUi();
  ui.alert('ไฟล์ต้นทาง', f.ok
    ? 'ชื่อ: ' + f.name + '\nแก้ไขล่าสุด: ' + f.updated + '\nขนาด: ' + f.size + '\nid: ' + f.id
    : f.msg, ui.ButtonSet.OK);
}

/* ================= อ่านไฟล์ ================= */

function findSourceFile_() {
  var it = CFG.SOURCE_FOLDER_ID
    ? DriveApp.getFolderById(CFG.SOURCE_FOLDER_ID).getFilesByName(CFG.SOURCE_FILE_NAME)
    : DriveApp.getFilesByName(CFG.SOURCE_FILE_NAME);
  var found = [];
  while (it.hasNext()) found.push(it.next());
  if (!found.length)
    return {ok: false, msg: 'ไม่พบไฟล์ชื่อ "' + CFG.SOURCE_FILE_NAME + '"\n\n' +
      'ตรวจว่าเอาไฟล์วางไว้ในโฟลเดอร์ที่ตั้งไว้แล้ว และชื่อไฟล์ตรงกันทุกตัวอักษร'};
  // เจอหลายไฟล์ชื่อเดียวกัน = ใช้ไฟล์ที่แก้ล่าสุด แต่บอกใน log ไว้ให้ตามได้
  found.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  if (found.length > 1) log_(['เตือน', 'พบไฟล์ชื่อซ้ำ ' + found.length + ' ไฟล์ — ใช้ไฟล์ที่แก้ล่าสุด']);
  var f = found[0];
  return {ok: true, id: f.getId(), name: f.getName(), size: f.getSize() + ' bytes',
          updated: Utilities.formatDate(f.getLastUpdated(),
            Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')};
}

/** แปลง .xlsx เป็นสเปรดชีตชั่วคราว อ่านชีตแรก แล้วลบทิ้ง — ไม่แตะไฟล์ต้นฉบับของผู้ใช้ */
function readFirstSheet_(fileId) {
  var tmpId = null;
  try {
    var res = Drive.Files.copy({title: '__tmp_costing_' + Date.now(),
      mimeType: MimeType.GOOGLE_SHEETS}, fileId);
    tmpId = res.id;
    var sheets = SpreadsheetApp.openById(tmpId).getSheets();
    if (!sheets.length) return {ok: false, msg: 'ไฟล์นี้ไม่มีชีตข้อมูลเลย'};
    return {ok: true, values: sheets[0].getDataRange().getValues(), sheet: sheets[0].getName()};
  } catch (e) {
    return {ok: false, msg: 'อ่านไฟล์ไม่ได้: ' + (e && e.message || e) +
      '\n\nถ้าเป็นครั้งแรก ให้เปิด Advanced Drive Service ในโปรเจกต์สคริปต์ก่อน'};
  } finally {
    if (tmpId) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e2) {} }
  }
}

/* ================= ประมวลผล ================= */

function norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
function isBlank_(v) {
  var s = norm_(v);
  return s === '' || s === 'nan' || s === 'none' || s === 'null' || s === '-';
}

function transform_(values) {
  if (!values || values.length < 2) return {ok: false, msg: 'ชีตแรกไม่มีข้อมูล'};

  var head = values[0], seen = {}, idx = {}, missing = [];
  for (var i = 0; i < head.length; i++) {
    var k = norm_(head[i]);
    if (k && !(k in seen)) seen[k] = i;      // ชื่อคอลัมน์ซ้ำ ใช้คอลัมน์แรก
  }
  Object.keys(ALIASES).forEach(function (want) {
    var names = [norm_(want)].concat(ALIASES[want]);
    for (var j = 0; j < names.length; j++)
      if (names[j] in seen) { idx[want] = seen[names[j]]; return; }
    missing.push(want);
  });
  if (missing.length)
    return {ok: false, msg: 'ไฟล์นี้ไม่มีคอลัมน์ที่ต้องใช้: ' + missing.join(', ') +
      '\n\nหัวคอลัมน์ที่เจอ: ' + head.filter(String).slice(0, 25).join(' | ')};

  var rows = [], st = {read: 0, excluded_lc: 0, complete: 0, incomplete: 0,
                       unknown_term: 0, zero_price: 0};

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(isBlank_)) continue;                       // แถวว่างล้วน = ท้ายตาราง
    st.read++;

    var termRaw = row[idx['PO Payment Term']];
    var term = isBlank_(termRaw) ? UNKNOWN : String(termRaw).trim();   // กฎ 2
    if (term === UNKNOWN) st.unknown_term++;
    if (LC_RE.test(term)) { st.excluded_lc++; continue; }              // กฎ 3

    var miss = KEY_FIELDS.filter(function (f) { return isBlank_(row[idx[f]]); });   // กฎ 4
    var status = miss.length
      ? '🔴 ข้อมูลไม่ครบ (' + miss.join(', ') + ')'
      : '🟢 พร้อมทำจ่าย (Complete)';
    if (miss.length) st.incomplete++; else st.complete++;

    var price = toNum_(row[idx['Price']]);
    var zero = price !== null && price === 0;
    if (zero) st.zero_price++;

    rows.push({
      'PO Number':       isBlank_(row[idx['PO Number']]) ? '' : String(row[idx['PO Number']]).trim(),
      'Supplier':        isBlank_(row[idx['Supplier']]) ? '' : String(row[idx['Supplier']]).trim(),
      'PO Payment Term': term,
      'Price':           price === null ? '' : price,
      'Currency':        isBlank_(row[idx['Currency']]) ? '' : String(row[idx['Currency']]).trim(),
      'Due Date':        fmtDate_(row[idx['Due Date']]),
      'Payment_Status':  status,
      '_zero':           zero
    });
  }
  return {ok: true, rows: rows, stats: st};
}

function toNum_(v) {
  if (v === '' || v == null) return null;
  var n = Number(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
}

function fmtDate_(v) {
  if (v instanceof Date)
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  return isBlank_(v) ? '' : String(v).trim();
}

/* ================= เขียนผล ================= */

function writeDashboard_(res) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.SHEET_DATA) || ss.insertSheet(CFG.SHEET_DATA);
  sh.clear();
  sh.clearConditionalFormatRules();

  var head = OUT_COLS.concat(['⚠️ ตรวจก่อนเบิก']);
  var body = res.rows.map(function (x) {
    return OUT_COLS.map(function (c) { return x[c]; })
      .concat([x._zero ? '⚠️ ยอดเป็นศูนย์' : '']);
  });

  // แถบสรุปด้านบน — เปิดมาเห็นตัวเลขก่อน ไม่ต้องเลื่อนหา
  var s = res.stats;
  sh.getRange(1, 1).setValue('Dashboard ตั้งเบิกทำจ่าย · อัพเดทเมื่อ ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
  sh.getRange(1, 1, 1, head.length).merge().setFontWeight('bold').setFontSize(12);
  sh.getRange(2, 1).setValue(
    'อ่านมา ' + s.read + ' แถว · ตัด LC ' + s.excluded_lc + ' · เหลือ ' + res.rows.length +
    '   |   🟢 ' + s.complete + '   🔴 ' + s.incomplete +
    '   |   UNKNOWN ' + s.unknown_term + '   ⚠️ ยอดศูนย์ ' + s.zero_price);
  sh.getRange(2, 1, 1, head.length).merge().setFontColor('#5f6368');

  sh.getRange(3, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#17211d').setFontColor('#ffffff');
  if (body.length) sh.getRange(4, 1, body.length, head.length).setValues(body);

  sh.setFrozenRows(3);
  sh.getRange(3, 1, Math.max(1, body.length + 1), head.length)
    .createFilter();                                       // ค้นหา/กรองด้วยตัวกรองของ Sheets
  sh.getRange(4, 4, Math.max(1, body.length), 1).setNumberFormat('#,##0.000');
  head.forEach(function (_, i) { sh.autoResizeColumn(i + 1); });
  sh.getRange(3, 3).setNote('เงื่อนไขจ่ายที่มีคำว่า LC ถูกตัดออกแล้ว — จ่ายผ่านธนาคาร ไม่เข้ากระบวนการนี้');

  if (body.length) {
    var rng = sh.getRange(4, 1, body.length, head.length);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()          // แถวข้อมูลไม่ครบ
        .whenFormulaSatisfied('=LEFT($G4,2)="🔴"')
        .setBackground('#fdeaea').setRanges([rng]).build(),
      SpreadsheetApp.newConditionalFormatRule()          // แถวยอดศูนย์
        .whenFormulaSatisfied('=$H4<>""')
        .setBackground('#fbefe4').setRanges([rng]).build()
    ]);
  }
}

function log_(cells) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CFG.SHEET_LOG);
    if (!sh) {
      sh = ss.insertSheet(CFG.SHEET_LOG);
      sh.appendRow(['เวลา', 'ผล', 'ไฟล์', 'ไฟล์แก้ล่าสุด', 'อ่านมา', 'ตัด LC',
                    'เหลือ', '🟢', '🔴', 'ยอดศูนย์', 'ใช้เวลา']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date()].concat(cells));
    var extra = sh.getLastRow() - 1 - CFG.KEEP_LOG;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) { /* log พังต้องไม่ทำให้การอัพเดทพัง */ }
}

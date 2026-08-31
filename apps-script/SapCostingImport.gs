/**
 * ตัวนำเข้าข้อมูล Costing จาก SAP เข้า MGS Document Center
 * ------------------------------------------------------------------
 * *** นี่ไม่ใช่ระบบที่สอง *** — ระบบมีอันเดียวคือ MGS Document Center
 * ไฟล์นี้ทำหน้าที่เดียว: อ่านรายงาน Costing ที่ออกจาก SAP แล้วเขียนลงตารางของ MGS Document Center
 * ไม่มีหน้าจอของตัวเอง ไม่มี Dashboard ของตัวเอง คนใช้เห็นผลที่ MGS Document Center ที่เดียว
 *
 * ไฟล์ Costing เป็นรายงานที่ออกจาก SAP ไม่ใช่ไฟล์ที่คนพิมพ์เอง
 * และบริษัทมี PO ทั้งฝั่ง Mech และ Food จึงมีไฟล์คนละใบ — กฎเดียวกันทั้งคู่
 * เพิ่มสายสินค้าใหม่ = เพิ่มแถวใน CFG.SOURCES ไม่ต้องแก้โค้ด
 *
 * วิธีใช้ของผู้ใช้ (ทั้งหมดที่ต้องทำ)
 *   1. เอาไฟล์ Costing ใหม่ทับไฟล์เดิมในโฟลเดอร์ที่ตั้งไว้ (ชื่อไฟล์เดิม) — ทีละสายหรือทั้งสองสาย
 *   2. กดเมนู  นำเข้าจาก SAP > นำเข้ารายการใหม่เข้า Document Hub
 *
 * ไม่ต้องก๊อปวาง ไม่ต้องลบชีตเก่า ไม่ต้องแตะสูตร
 *
 * ชีตในไฟล์นี้
 *   Staging   ผลการอ่านไฟล์ล่าสุด ไว้ตรวจก่อนนำเข้า — สร้างใหม่ทับได้ ลบได้
 *   Log       ประวัติการนำเข้า — ลบได้
 *   Ledger    จดว่าแถวไหนนำเข้า MGS Document Center ไปแล้ว — *ห้ามลบ* ลบแล้วจะตั้งเบิกซ้ำ
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
  // แหล่งข้อมูล — หนึ่งแถวต่อหนึ่งสายสินค้า เพิ่มสายใหม่ = เพิ่มแถว
  SOURCES: [
    {module: 'MECH', name: 'เครื่องจักร & โซลาร์', file: 'Costing Mech.xlsx', folderId: ''},
    {module: 'FOOD', name: 'อาหาร',                file: 'Costing Food.xlsx', folderId: ''}
  ],
  SKIP_MISSING: true,                      // ไฟล์สายไหนยังไม่มีก็ข้ามไป ไม่ทำให้ทั้งงานล้ม
  SHEET_DATA:   'Staging',                 // ผลการอ่านไฟล์ล่าสุด ไว้ตรวจก่อนนำเข้า (เขียนทับทุกครั้ง)
  SHEET_LOG:    'Log',                     // ประวัติการอัพเดท
  SHEET_LEDGER: 'Ledger',                  // จดว่าแถวไหนนำเข้า MGS Document Center ไปแล้ว — ห้ามลบ
  KEEP_LOG:     200,                       // เก็บ log กี่บรรทัด
  HUB_URL:      '',                        // ลิงก์ Document Hub · ว่าง = ไม่ทำคอลัมน์ลิงก์
  HUB_ENDPOINT: '',                        // ปลายทางของ MGS Document Center · ว่าง = จดใน Ledger อย่างเดียว ไม่ยิงออก
  HUB_KEY_PROP: 'HUB_KEY'                  // ชื่อ Script Property ที่เก็บกุญแจลับร่วม
};

var OUT_COLS  = ['PO Number', 'Supplier', 'PO Payment Term', 'Price', 'Currency',
                 'Due Date', 'Payment_Status'];
/* เลข PO แต่ละชุดขึ้นต้นต่างกัน (จากไฟล์จริงและใบตรวจ QC: PO-M2… / PO-F1… / PO-O3…)
   ใช้ตรวจว่าไฟล์ที่วางมาเป็นของสายที่ตั้งไว้จริงหรือเปล่า — วางสลับไฟล์กันจะได้รู้
   OTHER มาจากของจริง: ไฟล์ Mech มีแถวค่าเดินทาง/ค่าบริการ PO-O3… ปนอยู่ */
var PO_PREFIX = {'M': 'MECH', 'F': 'FOOD', 'O': 'OTHER'};
var MOD_NAME  = {MECH: 'เครื่องจักร & โซลาร์', FOOD: 'อาหาร', OTHER: 'ค่าใช้จ่ายอื่น'};
/* ลายนิ้วมือแถว — ใช้กันส่งซ้ำเข้า P2P
   ต้องไม่อิงลำดับแถวในไฟล์ เพราะไฟล์ใหม่แต่ละรอบเรียงไม่เหมือนเดิม
   PO + รายการ + ยอด + วันครบกำหนด คือชุดที่ระบุงวดจ่ายหนึ่งงวดได้จริง */
function fingerprint_(r) {
  return [r._module || '', r['PO Number'], r['_item'], r['Price'], r['Due Date']].join('|');
}
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
/** คอลัมน์เสริม — ไม่มีก็ทำงานต่อได้ ใช้ทำลายนิ้วมือแถวให้แม่นขึ้นเท่านั้น */
var OPTIONAL = {'_item': ['product description', 'description', 'item', 'รายการ']};

/* เมนูของไฟล์นี้ถูกยุบไปรวมกับเมนูหลักใน Setup.gs แล้ว
   Apps Script ใช้ global scope เดียวกันทั้งโปรเจกต์ — มี onOpen สองที่
   ตัวหลังจะทับตัวแรกเงียบ ๆ แล้วเมนูหนึ่งชุดจะหายไปโดยไม่มีใครรู้ว่าทำไม */

/* ================= ตัวหลัก ================= */

function updateDashboard() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('มีคนกำลังอัพเดทอยู่ ลองใหม่อีกครั้งในสักครู่'); return; }
  try {
    var t0 = new Date();
    var res = readAllSources_();
    if (!res.ok) { ui.alert('อัพเดทไม่ได้', res.msg, ui.ButtonSet.OK); return; }

    writeDashboard_(res);
    var secs = ((new Date()) - t0) / 1000;
    res.files.forEach(function (f) {
      log_(['อัพเดทสำเร็จ (' + f.module + ')', f.file, f.updated, f.stats.read,
            f.stats.excluded_lc, f.rows, f.stats.complete, f.stats.incomplete,
            f.stats.zero_price, secs.toFixed(1) + ' วิ']);
    });
    res.problems.forEach(function (p) { log_(['เตือน', p]); });

    ui.alert('อัพเดท Dashboard แล้ว',
      res.files.map(function (f) {
        return f.name + ' — ' + f.file + '\n  แก้ไขล่าสุด ' + f.updated +
               ' · เหลือเข้ากระบวนการ ' + f.rows + ' แถว';
      }).join('\n') + '\n\n' +
      'รวมทุกสาย\n' +
      'อ่านมา ' + res.stats.read + ' แถว\n' +
      'ตัด LC ออก ' + res.stats.excluded_lc + ' แถว\n' +
      'เหลือเข้ากระบวนการ ' + res.rows.length + ' แถว\n' +
      '  🟢 พร้อมทำจ่าย ' + res.stats.complete + '\n' +
      '  🔴 ข้อมูลไม่ครบ ' + res.stats.incomplete + '\n\n' +
      'เงื่อนไขจ่ายว่าง (นับเป็น UNKNOWN) ' + res.stats.unknown_term + '\n' +
      '⚠️ ยอดเป็นศูนย์ ' + res.stats.zero_price + ' แถว — ตรวจก่อนตั้งเบิก' +
      (res.problems.length ? '\n\nสิ่งที่ต้องดู\n· ' + res.problems.join('\n· ') : ''),
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
  var ui = SpreadsheetApp.getUi();
  var lines = CFG.SOURCES.map(function (src) {
    var f = findSourceFile_(src);
    return src.name + ' (' + src.module + ')\n  ' + (f.ok
      ? f.name + '\n  แก้ไขล่าสุด ' + f.updated + ' · ' + f.size
      : 'ยังไม่มีไฟล์ "' + src.file + '"');
  });
  ui.alert('ไฟล์ต้นทางของแต่ละสาย', lines.join('\n\n'), ui.ButtonSet.OK);
}

/* ================= อ่านไฟล์ ================= */

/** โฟลเดอร์ที่ให้วางไฟล์ Costing — ตั้งครั้งเดียวใน Script Property ไม่ต้องแก้โค้ด */
function costingFolderId_() {
  return PropertiesService.getScriptProperties().getProperty('COSTING_FOLDER_ID') || '';
}

function findSourceFile_(src) {
  var folderId = src.folderId || costingFolderId_();
  /* ไม่ระบุโฟลเดอร์ = ค้นทั้งไดรฟ์ของคนที่กด ซึ่งอันตรายกับข้อมูลเงิน
     ไฟล์ชื่อเดียวกันที่ค้างอยู่ในโฟลเดอร์ดาวน์โหลดของใครสักคนจะถูกหยิบมาใช้ได้
     จึงบอกให้ตั้งโฟลเดอร์ก่อน แทนที่จะเดาแล้วเงียบ */
  if (!folderId)
    return {ok: false, msg: 'ยังไม่ได้ตั้งโฟลเดอร์ที่วางไฟล์ Costing\n\n' +
      'ให้ IT ตั้ง Script Property ชื่อ COSTING_FOLDER_ID เป็นไอดีโฟลเดอร์ที่จะวางไฟล์\n' +
      '(เอาจาก URL ของโฟลเดอร์: drive.google.com/drive/folders/<ไอดี>)\n\n' +
      'ไม่ตั้งแล้วระบบจะต้องค้นทั้งไดรฟ์ ซึ่งอาจหยิบไฟล์เก่าที่ค้างอยู่ที่อื่นมาใช้'};

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return {ok: false, msg: 'เปิดโฟลเดอร์ตาม COSTING_FOLDER_ID ไม่ได้\n\n' +
      'ตรวจว่าไอดีถูกต้องและบัญชีที่รันมีสิทธิ์เข้าถึงโฟลเดอร์นั้น'};
  }
  var it = folder.getFilesByName(src.file);
  var found = [];
  while (it.hasNext()) found.push(it.next());
  if (!found.length)
    return {ok: false, msg: 'ไม่พบไฟล์ชื่อ "' + src.file + '" (สาย ' + src.name + ')\n\n' +
      'ในโฟลเดอร์ "' + folder.getName() + '"\n' +
      'ตรวจว่าวางไฟล์ถูกโฟลเดอร์แล้ว และชื่อไฟล์ตรงกันทุกตัวอักษร (รวมนามสกุล .xlsx)'};
  // เจอหลายไฟล์ชื่อเดียวกัน = ใช้ไฟล์ที่แก้ล่าสุด แต่บอกใน log ไว้ให้ตามได้
  found.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  if (found.length > 1)
    log_(['เตือน', 'พบไฟล์ "' + src.file + '" ซ้ำ ' + found.length + ' ไฟล์ — ใช้ไฟล์ที่แก้ล่าสุด']);
  var f = found[0];
  return {ok: true, id: f.getId(), name: f.getName(), size: f.getSize() + ' bytes',
          module: src.module, srcName: src.name,
          updated: Utilities.formatDate(f.getLastUpdated(),
            Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')};
}

/** อ่านทุกสายที่ตั้งไว้ แล้วรวมเป็นชุดเดียว — สายไหนไฟล์ยังไม่มีก็ข้ามไป ไม่ทำให้ทั้งงานล้ม */
function readAllSources_() {
  var rows = [], stats = {read: 0, excluded_lc: 0, complete: 0, incomplete: 0,
                          unknown_term: 0, zero_price: 0};
  var files = [], problems = [];
  CFG.SOURCES.forEach(function (src) {
    var f = findSourceFile_(src);
    if (!f.ok) {
      if (CFG.SKIP_MISSING) problems.push(src.name + ': ยังไม่มีไฟล์');
      else problems.push(f.msg);
      return;
    }
    var grid = readFirstSheet_(f.id);
    if (!grid.ok) { problems.push(src.name + ': ' + grid.msg); return; }
    var res = transform_(grid.values);
    if (!res.ok) { problems.push(src.name + ': ' + res.msg); return; }

    // ไฟล์ที่วางมาเป็นของสายนี้จริงไหม — ดูจากเลข PO ไม่ใช่เชื่อชื่อไฟล์อย่างเดียว
    var mismatch = poMismatch_(res.rows, src.module);
    if (mismatch) problems.push(src.name + ': ' + mismatch);

    // สายของแต่ละแถวยึดเลข PO จริงก่อน — ไฟล์ Mech มีแถวค่าใช้จ่ายอื่น (PO-O…) ปนมาได้
    res.rows.forEach(function (r) {
      var m = String(r['PO Number'] || '').toUpperCase().match(/^PO-([A-Z])/);
      r._module = (m && PO_PREFIX[m[1]]) ? PO_PREFIX[m[1]] : src.module;
      r._moduleName = (r._module === src.module) ? src.name : MOD_NAME[r._module] || r._module;
    });
    rows = rows.concat(res.rows);
    Object.keys(stats).forEach(function (k) { stats[k] += (res.stats[k] || 0); });
    files.push({module: src.module, name: src.name, file: f.name,
                updated: f.updated, rows: res.rows.length, stats: res.stats});
  });
  return {ok: files.length > 0, rows: rows, stats: stats, files: files, problems: problems,
          msg: files.length ? '' : ('อ่านไฟล์ Costing ไม่ได้สักไฟล์\n\n' + problems.join('\n'))};
}

/** เลข PO ในไฟล์ตรงกับสายที่ตั้งไว้ไหม — วางไฟล์สลับสายกันจะได้รู้ตั้งแต่ต้น */
function poMismatch_(rows, want) {
  var votes = {}, total = 0;
  rows.forEach(function (r) {
    var m = String(r['PO Number'] || '').toUpperCase().match(/^PO-([A-Z])/);
    if (!m || !PO_PREFIX[m[1]]) return;
    var mod = PO_PREFIX[m[1]];
    votes[mod] = (votes[mod] || 0) + 1;
    total++;
  });
  if (!total) return '';
  var top = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0];
  return top === want ? ''
    : 'เลข PO ในไฟล์ส่วนใหญ่เป็นของสาย ' + top + ' แต่ตั้งไว้ว่าเป็นสาย ' + want +
      ' — ตรวจว่าวางไฟล์สลับกันหรือเปล่า';
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
  Object.keys(OPTIONAL).forEach(function (want) {      // ขาดได้ ไม่ถือว่าไฟล์ผิด
    OPTIONAL[want].forEach(function (a) { if (!(want in idx) && a in seen) idx[want] = seen[a]; });
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
      '_zero':           zero,
      '_item':           ('_item' in idx && !isBlank_(row[idx['_item']]))
                           ? String(row[idx['_item']]).trim() : ''
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

/* ================= เชื่อมกับระบบเอกสาร Procure-to-Pay =================
   หัวใจไม่ใช่ปุ่มลิงก์ แต่คือ "กันส่งซ้ำ"
   ไฟล์ Costing ถูกเอาของใหม่ทับทุกรอบ ถ้าไม่จดว่าแถวไหนส่งไปแล้ว
   รอบหน้าแถวเดิมจะกลับมาเป็น 🟢 พร้อมทำจ่ายอีกครั้ง แล้วตั้งเบิกซ้ำ
   ชีต Ledger จึงเป็นชีตเดียวในไฟล์นี้ที่ห้ามลบ — Dashboard สร้างใหม่ได้เสมอ แต่ Ledger สร้างใหม่ไม่ได้ */

function ledgerSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.SHEET_LEDGER);
  if (!sh) {
    sh = ss.insertSheet(CFG.SHEET_LEDGER);
    sh.appendRow(['ลายนิ้วมือแถว', 'สาย', 'PO Number', 'Supplier', 'Price', 'Currency',
                  'Due Date', 'ส่งเมื่อ', 'ส่งโดย', 'ผลการส่ง']);
    sh.setFrozenRows(1);
    sh.getRange('A1:J1').setFontWeight('bold').setBackground('#17211d').setFontColor('#ffffff');
  }
  return sh;
}

function ledgerMap_() {
  var sh = ledgerSheet_(), last = sh.getLastRow(), m = {};
  if (last < 2) return m;
  sh.getRange(2, 1, last - 1, 8).getValues().forEach(function (r) {
    if (r[0]) m[String(r[0])] = r[7];       // ลายนิ้วมือ -> วันที่ส่ง
  });
  return m;
}

/** ส่งรายการที่ 🟢 และยังไม่เคยส่ง เข้าระบบเอกสาร P2P */
function sendReadyToHub() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('มีคนกำลังทำงานอยู่ ลองใหม่อีกครั้ง'); return; }
  try {
    var res = readAllSources_();
    if (!res.ok) { ui.alert('ส่งไม่ได้', res.msg, ui.ButtonSet.OK); return; }

    var seen = ledgerMap_();
    // ส่งเฉพาะแถวที่ข้อมูลครบ — แถว 🔴 ส่งไปปลายทางก็ตั้งเรื่องไม่ได้อยู่ดี
    var todo = res.rows.filter(function (r) {
      return r.Payment_Status.indexOf('🟢') === 0 && !seen[fingerprint_(r)];
    });
    if (!todo.length) {
      ui.alert('ไม่มีอะไรต้องส่ง',
        'รายการที่พร้อมทำจ่ายถูกส่งเข้าระบบ P2P ครบแล้ว\n\n' +
        'ถ้าคาดว่าควรมีรายการใหม่ ให้กด "อัพเดท Dashboard" ก่อน แล้วลองอีกครั้ง',
        ui.ButtonSet.OK);
      return;
    }
    var ans = ui.alert('ส่งเข้าระบบ P2P',
      'จะส่ง ' + todo.length + ' รายการที่พร้อมทำจ่ายและยังไม่เคยส่ง\n' +
      'รวม ' + countPO_(todo) + ' ใบ PO\n\n' +
      'รายการที่ส่งแล้วจะไม่ถูกส่งซ้ำอีก แม้เอาไฟล์ใหม่มาทับ',
      ui.ButtonSet.OK_CANCEL);
    if (ans !== ui.Button.OK) return;

    var who = Session.getActiveUser().getEmail() || 'ไม่ทราบผู้ใช้';
    var stamp = new Date();
    var sent = 0, failed = 0, rowsOut = [];
    todo.forEach(function (r) {
      var out = postToHub_(r);
      if (out.ok) sent++; else failed++;
      rowsOut.push([fingerprint_(r), r._module || '', r['PO Number'], r.Supplier, r.Price,
                    r.Currency, r['Due Date'], stamp, who, out.note]);
    });
    // จดลง Ledger ทีเดียว — เขียนทีละแถวช้าและมีโอกาสค้างกลางทาง
    if (rowsOut.length) {
      var sh = ledgerSheet_();
      sh.getRange(sh.getLastRow() + 1, 1, rowsOut.length, 10).setValues(rowsOut);
    }
    log_(['ส่งเข้า P2P', res.files.map(function (f) { return f.module; }).join('+'),
          '', '', '', todo.length, sent, failed, '', '']);
    updateDashboard_quiet_();
    ui.alert('ส่งเข้าระบบ P2P แล้ว',
      'ส่งสำเร็จ ' + sent + ' รายการ' + (failed ? '\nส่งไม่สำเร็จ ' + failed +
        ' รายการ — ดูเหตุผลรายแถวในชีต ' + CFG.SHEET_LEDGER : '') +
      '\n\nจดไว้ในชีต ' + CFG.SHEET_LEDGER + ' แล้ว — รอบหน้าจะไม่ส่งซ้ำ',
      ui.ButtonSet.OK);
  } catch (e) {
    log_(['ผิดพลาดตอนส่งเข้า P2P', String(e && e.message || e)]);
    SpreadsheetApp.getUi().alert('ส่งไม่สำเร็จ', String(e && e.message || e),
      SpreadsheetApp.getUi().ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function countPO_(rows) {
  var s = {};
  rows.forEach(function (r) { s[r['PO Number']] = 1; });
  return Object.keys(s).length;
}

/** ยิงงวดจ่ายหนึ่งงวดไปที่ระบบเอกสาร — ยังไม่ได้ตั้งปลายทางก็จดใน Ledger อย่างเดียว
    ไม่ใช่ error เพราะ Ledger คือสิ่งที่กันจ่ายซ้ำจริง ๆ ส่วนการยิงเป็นแค่ความสะดวก */
function postToHub_(r) {
  if (!CFG.HUB_ENDPOINT) return {ok: true, note: 'จดไว้ (ยังไม่ได้ตั้งปลายทาง)'};
  var body = JSON.stringify({
    source:    'COSTING_' + (r._module || 'UNSET'),
    module:    r._module || '',
    ref:       fingerprint_(r),          // ปลายทางใช้กันซ้ำอีกชั้น
    poNumber:  r['PO Number'],
    supplier:  r.Supplier,
    term:      r['PO Payment Term'],
    amount:    r.Price,
    currency:  r.Currency,
    dueDate:   r['Due Date'],
    item:      r._item,
    zeroPrice: !!r._zero,                // ปลายทางเตือนต่อได้ ไม่ต้องคำนวณเอง
    sentAt:    new Date().toISOString()
  });
  var key = PropertiesService.getScriptProperties().getProperty(CFG.HUB_KEY_PROP) || '';
  var sig = key ? Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(body, key)) : '';
  try {
    var res = UrlFetchApp.fetch(CFG.HUB_ENDPOINT, {
      method: 'post', contentType: 'application/json', payload: body,
      headers: {'X-MGS-Signature': sig}, muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return code === 200 ? {ok: true, note: 'ส่งสำเร็จ'}
                        : {ok: false, note: 'ปลายทางตอบ ' + code};
  } catch (e) {
    return {ok: false, note: 'ส่งไม่ถึง: ' + (e && e.message || e)};
  }
}

/** อัพเดทชีตใหม่เงียบ ๆ หลังส่ง เพื่อให้คอลัมน์สถานะตรงกับ Ledger ทันที */
function updateDashboard_quiet_() {
  var res = readAllSources_();
  if (res.ok) writeDashboard_(res);
}

function writeDashboard_(res) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.SHEET_DATA) || ss.insertSheet(CFG.SHEET_DATA);
  sh.clear();
  sh.clearConditionalFormatRules();

  var seen = ledgerMap_();
  var head = ['สาย'].concat(OUT_COLS).concat(['⚠️ ตรวจก่อนเบิก', 'ในระบบ P2P']);
  var body = res.rows.map(function (x) {
    var when = seen[fingerprint_(x)];
    var p2p = when
      ? 'ส่งแล้ว ' + Utilities.formatDate(new Date(when), Session.getScriptTimeZone(), 'dd/MM/yyyy')
      : (x.Payment_Status.indexOf('🟢') === 0 ? 'ยังไม่ส่ง' : 'ส่งไม่ได้ — ข้อมูลไม่ครบ');
    if (when && CFG.HUB_URL)
      p2p = '=HYPERLINK("' + CFG.HUB_URL + '#po/' + encodeURIComponent(x['PO Number']) +
            '","' + p2p + ' ↗")';
    return [x._moduleName || x._module || ''].concat(OUT_COLS.map(function (c) { return x[c]; }))
      .concat([x._zero ? '⚠️ ยอดเป็นศูนย์' : '', p2p]);
  });

  // แถบสรุปด้านบน — เปิดมาเห็นตัวเลขก่อน ไม่ต้องเลื่อนหา
  var s = res.stats;
  sh.getRange(1, 1).setValue('Dashboard ตั้งเบิกทำจ่าย · อัพเดทเมื่อ ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
  sh.getRange(1, 1, 1, head.length).merge().setFontWeight('bold').setFontSize(12);
  var nSent = res.rows.filter(function (x) { return !!seen[fingerprint_(x)]; }).length;
  var perMod = (res.files || []).map(function (f) {
    return f.name + ' ' + f.rows; }).join(' · ');
  sh.getRange(2, 1).setValue(
    (perMod ? perMod + '   |   ' : '') +
    'อ่านมา ' + s.read + ' แถว · ตัด LC ' + s.excluded_lc + ' · เหลือ ' + res.rows.length +
    '   |   🟢 ' + s.complete + '   🔴 ' + s.incomplete +
    '   |   UNKNOWN ' + s.unknown_term + '   ⚠️ ยอดศูนย์ ' + s.zero_price +
    '   |   ส่งเข้า P2P แล้ว ' + nSent + ' · ยังไม่ส่ง ' + (s.complete - nSent));
  sh.getRange(2, 1, 1, head.length).merge().setFontColor('#5f6368');

  sh.getRange(3, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#17211d').setFontColor('#ffffff');
  if (body.length) sh.getRange(4, 1, body.length, head.length).setValues(body);

  sh.setFrozenRows(3);
  sh.getRange(3, 1, Math.max(1, body.length + 1), head.length)
    .createFilter();                                       // ค้นหา/กรองด้วยตัวกรองของ Sheets
  sh.getRange(4, 5, Math.max(1, body.length), 1).setNumberFormat('#,##0.000');   // คอลัมน์ Price
  head.forEach(function (_, i) { sh.autoResizeColumn(i + 1); });
  sh.getRange(3, 1).setNote('บริษัทมี PO ทั้งฝั่ง Mech และ Food · ไฟล์คนละใบ กฎเดียวกัน\n' +
    'เพิ่มสายใหม่ = เพิ่มแถวใน CFG.SOURCES ไม่ต้องแก้โค้ด');
  sh.getRange(3, 4).setNote('เงื่อนไขจ่ายที่มีคำว่า LC ถูกตัดออกแล้ว — จ่ายผ่านธนาคาร ไม่เข้ากระบวนการนี้');
  sh.getRange(3, head.length).setNote(
    'สถานะมาจากชีต ' + CFG.SHEET_LEDGER + ' ซึ่งจดว่าแถวไหนถูกส่งเข้าระบบเอกสารไปแล้ว\n' +
    'ชีตนี้สร้างใหม่ได้ทุกเมื่อ แต่ชีต ' + CFG.SHEET_LEDGER + ' ห้ามลบ — ' +
    'ลบแล้วรายการเดิมจะถูกส่งซ้ำและตั้งเบิกซ้ำ');

  if (body.length) {
    var rng = sh.getRange(4, 1, body.length, head.length);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()          // แถวข้อมูลไม่ครบ
        .whenFormulaSatisfied('=LEFT($H4,2)="🔴"')
        .setBackground('#fdeaea').setRanges([rng]).build(),
      SpreadsheetApp.newConditionalFormatRule()          // แถวยอดศูนย์
        .whenFormulaSatisfied('=$I4<>""')
        .setBackground('#fbefe4').setRanges([rng]).build(),
      SpreadsheetApp.newConditionalFormatRule()          // ส่งเข้า P2P แล้ว = จบงานฝั่งนี้
        .whenFormulaSatisfied('=LEFT($J4,8)="ส่งแล้ว "')
        .setBackground('#e6f0ec').setFontColor('#276456').setRanges([rng]).build()
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

/**
 * MGS Traceability & Recall — 08_Setup.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * ติดตั้งครั้งแรก · ตรวจสุขภาพระบบ · ตัวตั้งเวลา · สำรองข้อมูล
 * ฟังก์ชันในไฟล์นี้รันจาก Apps Script editor ไม่ได้เรียกจากหน้าเว็บ
 *
 * ลำดับการติดตั้ง (ทำครั้งเดียว)
 *   1. setupCreateWorkbook()      สร้างสเปรดชีตและแท็บทั้งหมด
 *   2. setupAddUser(...)          เพิ่มผู้ใช้ (เจ้าของสคริปต์ถูกใส่เป็น ADMIN ให้แล้ว)
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
  seedOwnerAsAdmin_(ss);

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

/**
 * ใส่เจ้าของสคริปต์เป็น ADMIN คนแรกเมื่อตาราง Users ยังว่าง
 * กันปัญหาไก่กับไข่: ไม่มี ADMIN -> ตั้งค่าอะไรผ่านแอปไม่ได้ -> ต้องไปแก้ชีตด้วยมือ
 */
function seedOwnerAsAdmin_(ss) {
  var sh = ss.getSheetByName(TAB.USERS);
  if (!sh || sh.getLastRow() > 1) return;
  var email = '';
  try { email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase().trim(); } catch (e) {}
  if (!email) return;
  sh.getRange(2, 1, 1, SCHEMA[TAB.USERS].length).setValues([[
    email, email, 'IT', 'ADMIN', '', 'TRUE', 'เจ้าของสคริปต์ — ระบบเติมให้ตอนติดตั้ง'
  ]]);
  clearUserCache_();
  console.log('เพิ่ม ' + email + ' เป็น ADMIN คนแรกในตาราง Users');
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
    ['ALLOWED_DOMAIN', 'โดเมนบริษัทที่ยอมให้เข้าใช้ เช่น mglobalsourcing.net (ไม่ตั้ง = ใช้ค่าในโค้ด)', false],
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
   2.5 เครื่องมือแก้ปัญหาสิทธิ์ — ใช้ตอนผู้ใช้เปิดแอปแล้วถูกปฏิเสธ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ตอบคำถาม "ทำไมเข้าไม่ได้" ในการรันครั้งเดียว
 * รันจากตัวแก้ไข Apps Script แล้วดูผลใน Execution log
 */
function setupWhoAmI() {
  var active = '', effective = '';
  try { active = Session.getActiveUser().getEmail() || '(ว่าง)'; } catch (e) { active = '(เรียกไม่ได้: ' + e.message + ')'; }
  try { effective = Session.getEffectiveUser().getEmail() || '(ว่าง)'; } catch (e) { effective = '(เรียกไม่ได้)'; }

  var lines = [
    'บัญชีที่กำลังใช้งาน (active user)   : ' + active,
    'บัญชีเจ้าของสคริปต์ (effective user) : ' + effective,
    'โดเมนที่ระบบยอมรับ (ALLOWED_DOMAIN) : ' + CFG.ALLOWED_DOMAIN,
    'ตั้งทับที่ Script Property หรือยัง   : ' +
      (PropertiesService.getScriptProperties().getProperty('ALLOWED_DOMAIN') ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง (ใช้ค่าในโค้ด)'),
    ''
  ];

  try {
    var u = me_();
    lines.push('ผลการตรวจสิทธิ์ : ผ่าน');
    lines.push('  บทบาท        : ' + u.role + (u.owner ? '  (ได้เพราะเป็นเจ้าของสคริปต์)' : ''));
    lines.push('  ชื่อที่แสดง   : ' + u.name);
    if (u.unlisted) lines.push('  ⚠️ ยังไม่มีชื่อในตาราง Users จึงได้ VIEWER — ดูได้อย่างเดียว');
  } catch (e) {
    lines.push('ผลการตรวจสิทธิ์ : ไม่ผ่าน');
    lines.push('  เหตุผล : ' + String(e.message).replace('[U] ', ''));
  }

  lines.push('');
  try {
    var users = readTable_(TAB.USERS).rows;
    lines.push('ผู้ใช้ในตาราง Users : ' + users.length + ' คน');
    users.forEach(function (r) {
      lines.push('  ' + String(r.email) + '  ' + String(r.role) +
                 (isTrue_(r.is_active) ? '' : '  (ปิดใช้งาน)'));
    });
    if (!users.length) lines.push('  (ยังไม่มีใครเลย — รัน setupAddUser() เพื่อเพิ่ม)');
  } catch (e) {
    lines.push('อ่านตาราง Users ไม่ได้ : ' + String(e.message).replace('[U] ', ''));
  }

  var out = lines.join('\n');
  console.log(out);
  return out;
}

/**
 * เพิ่มหรือแก้ผู้ใช้ 1 คน โดยไม่ต้องเปิดสเปรดชีต
 * ตัวอย่าง: setupAddUser('somchai@mglobalsourcing.net', 'สมชาย', 'QC', 'QC')
 */
function setupAddUser(email, fullName, dept, role) {
  email = String(email || '').toLowerCase().trim();
  if (!email || email.indexOf('@') === -1) throw new Error('ต้องระบุอีเมลให้ถูกต้อง');
  role = String(role || 'VIEWER').toUpperCase().trim();
  if (!ROLES[role]) throw new Error('บทบาทไม่ถูกต้อง — ใช้ได้: ' + Object.keys(ROLES).join(' / '));

  var existing = findRow_(TAB.USERS, 'email', email);
  if (existing) {
    updateRow_(TAB.USERS, 'email', email, {
      full_name: String(fullName || existing.full_name || email),
      dept: String(dept || existing.dept || ''),
      role: role, is_active: 'TRUE'
    }, null);
    clearUserCache_();
    console.log('อัปเดต ' + email + ' เป็นบทบาท ' + role + ' แล้ว');
    return 'updated';
  }

  appendRows_(TAB.USERS, [{
    email: email, full_name: String(fullName || email), dept: String(dept || ''),
    role: role, lark_user_id: '', is_active: 'TRUE', note: ''
  }]);
  clearUserCache_();
  console.log('เพิ่ม ' + email + ' บทบาท ' + role + ' แล้ว');
  return 'added';
}

/** ปิดการใช้งานผู้ใช้ (ใช้ตอนพนักงานลาออก) — ไม่ลบแถวเพื่อให้ประวัติยังอ่านได้ */
function setupDeactivateUser(email) {
  email = String(email || '').toLowerCase().trim();
  if (!findRow_(TAB.USERS, 'email', email)) throw new Error('ไม่พบผู้ใช้ ' + email);
  updateRow_(TAB.USERS, 'email', email, { is_active: 'FALSE' }, null);
  clearUserCache_();
  console.log('ปิดการใช้งาน ' + email + ' แล้ว');
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
    if (!admins.length) throw new Error('ยังไม่มี ADMIN ในแท็บ Users — รัน setupAddUser(อีเมล, ชื่อ, แผนก, "ADMIN")');
  });

  t('โดเมนที่ตั้งไว้ตรงกับโดเมนของเจ้าของสคริปต์', function () {
    var owner = ownerEmail_();
    if (!owner) throw new Error('อ่านอีเมลเจ้าของสคริปต์ไม่ได้');
    if (!isCompanyEmail_(owner)) {
      throw new Error('เจ้าของสคริปต์คือ ' + owner + ' แต่ ALLOWED_DOMAIN ตั้งไว้เป็น @' +
        CFG.ALLOWED_DOMAIN + ' — ผู้ใช้ในบริษัทจะเข้าไม่ได้ทั้งหมด ' +
        'ให้ตั้ง Script Property ชื่อ ALLOWED_DOMAIN เป็นโดเมนที่ถูกต้อง');
    }
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

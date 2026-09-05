/**
 * Setup.gs — ติดตั้งระบบครั้งแรก และเมนูผู้ดูแล
 * ==========================================================================
 * รันครั้งเดียวตอนเริ่ม: สร้างแท็บทั้งหมด · ใส่หัวคอลัมน์ · สร้างโฟลเดอร์ Drive ·
 * เตรียมตารางผู้ใช้ให้หัวหน้าแผนกกรอกอีเมลจริง · ติดตั้งทริกเกอร์
 *
 * รันซ้ำได้ปลอดภัย — แท็บที่มีอยู่แล้วจะไม่ถูกลบและข้อมูลไม่หาย
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MGS Document Center')
    .addItem('1. ติดตั้งระบบ (รันซ้ำได้)', 'setupWorkspace')
    .addItem('2. ตรวจความพร้อมก่อนเปิดใช้', 'healthCheck')
    .addSeparator()
    .addItem('เพิ่มผู้ใช้จากอีเมล...', 'promptAddUser')
    .addItem('ตรวจตารางผู้ใช้', 'checkUsers')
    .addSeparator()
    .addItem('อ่านไฟล์ Costing (ดูผลก่อนนำเข้า)', 'updateDashboard')
    .addItem('ตรวจไฟล์ต้นทางที่จะใช้', 'showSourceInfo')
    .addItem('นำเข้ารายการใหม่จาก SAP Costing', 'importFromCosting')
    .addItem('หา chat_id ของกลุ่ม Lark', 'listLarkGroups')
    .addItem('ทดสอบส่ง Lark', 'testLark')
    .addToUi();
}

/** สร้างทุกแท็บพร้อมหัวคอลัมน์ — ไม่แตะแท็บที่มีข้อมูลอยู่แล้ว */
function setupWorkspace() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Props.set('SPREADSHEET_ID', ss.getId());

  var made = [], kept = [];
  Object.keys(COLS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]);
      made.push(name);
    } else {
      // แท็บมีอยู่แล้ว — เติมเฉพาะคอลัมน์ที่ยังไม่มี ไม่ลบของเดิม
      var have = sh.getLastColumn() > 0
        ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
      var add = COLS[name].filter(function (c) { return have.indexOf(c) < 0; });
      if (add.length) sh.getRange(1, have.length + 1, 1, add.length).setValues([add]);
      kept.push(name + (add.length ? ' (+' + add.length + ' คอลัมน์)' : ''));
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn())
      .setFontWeight('bold').setBackground('#F5EBD2').setFontColor('#6B520F');
  });

  seedConfig_();
  seedUserTemplate_();
  seedAssignments_();
  var drive = ensureDriveRoot_();
  installTriggers_();

  var msg = 'ติดตั้งเรียบร้อย\n\n' +
    (made.length ? 'สร้างใหม่: ' + made.join(', ') + '\n\n' : '') +
    (kept.length ? 'มีอยู่แล้ว: ' + kept.join(', ') + '\n\n' : '') +
    'โฟลเดอร์เอกสาร: ' + drive.name + '\n' +
    (drive.warn ? '\n⚠ ' + drive.warn + '\n' : '') +
    '\nขั้นต่อไป\n' +
    '1. เปิดแท็บ Users แล้วกรอกอีเมลบริษัทของพนักงานแต่ละแผนก\n' +
    '2. ตั้งค่า Script Properties (LARK_APP_ID, LARK_APP_SECRET, LARK_GROUP_CHAT_ID)\n' +
    '   หา chat_id ได้จากเมนู "หา chat_id ของกลุ่ม Lark"\n' +
    '3. กดเมนู "ตรวจความพร้อมก่อนเปิดใช้"';
  SpreadsheetApp.getUi().alert(msg);
}

function seedConfig_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  if (sh.getLastRow() > 1) return;                        // มีค่าอยู่แล้วไม่ทับ
  sh.getRange(2, 1, CONFIG_DEFAULTS.length, 3).setValues(CONFIG_DEFAULTS);
}

/**
 * เตรียมตารางผู้ใช้ — ใส่แถวตัวอย่างของ "ทุกแผนก" ไว้ให้เห็นโครงชัด ๆ
 * หัวหน้าแผนกแก้อีเมลกับชื่อทับแถวของแผนกตัวเองได้เลย ไม่ต้องเดาว่าต้องกรอกอะไร
 *
 * จงใจไม่ใส่อีเมลจริง — ระบบจะไม่ให้ใครเข้าจนกว่าจะมีคนกรอกอีเมลจริง
 * ปลอดภัยกว่าใส่อีเมลมั่วไว้แล้วลืมลบ
 */
function seedUserTemplate_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.USERS);
  if (sh.getLastRow() > 1) return;                        // มีคนกรอกแล้วไม่ทับ

  /* ตั้งแถวเปล่าไว้ให้ครบทุกแผนกที่ระบบรู้จัก รวมทีมย่อยด้วย
     ไล่จาก ROLES โดยตรง เพิ่มทีมใหม่ใน Flow.gs แล้วแถวตั้งต้นตามมาเอง
     ทีมย่อย (จัดซื้ออาหาร/เครื่องจักร · บัญชีต่างประเทศ/ในประเทศ) คือแถวที่ต้องกรอกจริง
     ส่วนแถวแผนกแม่ปล่อยว่างไว้ได้ ใช้เฉพาะคนที่ต้องดูแทนทั้งสองทีม */
  var rows = [];
  var hasTeams = {};        // แผนกที่มีทีมย่อยอยู่ข้างใต้ — แถวของตัวมันเองไม่จำเป็นต้องมีคน
  Object.keys(DEPT_FAMILY).forEach(function (k) { hasTeams[DEPT_FAMILY[k]] = true; });
  Object.keys(ROLES).forEach(function (d) {
    var hint = hasTeams[d]
      ? 'กรอกเฉพาะคนที่ต้องดูแทนได้ทุกทีมใน' + ROLES[d].name + ' — ปกติเว้นว่างไว้ได้'
      : 'กรอกอีเมลบริษัทและชื่อ-นามสกุลของ' + ROLES[d].name;
    rows.push(['', '', d, ROLES[d].name, '', '', '', '', 'TRUE',
      hint + ' — ลบแถวนี้ได้ถ้าไม่ใช้']);
  });
  sh.getRange(2, 1, rows.length, COLS.Users.length).setValues(rows);

  // แผนกต้องเลือกจากรายการ พิมพ์เองแล้วสะกดผิดจะเข้าระบบไม่ได้
  sh.getRange(2, 3, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(Object.keys(ROLES), true)
      .setAllowInvalid(false)
      .setHelpText('เลือกแผนกจากรายการ')
      .build());
  sh.getRange(2, 9, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['TRUE', 'FALSE'], true).setAllowInvalid(false).build());
  sh.setColumnWidth(1, 240).setColumnWidth(2, 170).setColumnWidth(10, 380);
}

/**
 * ตารางเจ้าของงาน — กลุ่มสินค้าไหน จัดซื้อคนไหนดูแล
 * ใส่แถวของทุกกลุ่มไว้ให้ แล้วให้หัวหน้าจัดซื้อกรอกอีเมลทับ
 * ปล่อยว่างได้ ระบบจะแจ้งทั้งแผนกแทน — ดีกว่าเดาว่าเป็นของใคร
 */
function seedAssignments_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ASSIGN);
  if (sh.getLastRow() > 1) return;
  var rows = Object.keys(MODULES).map(function (m) {
    return [m, MODULES[m].n, '', 'กรอกอีเมลจัดซื้อที่ดูแลกลุ่มนี้ — ว่างไว้ = แจ้งทั้งแผนก'];
  });
  sh.getRange(2, 1, rows.length, COLS.Assignments.length).setValues(rows);
  sh.setColumnWidth(3, 240).setColumnWidth(4, 380);
}

/** เพิ่มผู้ใช้ทีละคนจากเมนู — สะดวกกว่าพิมพ์ในชีตเมื่อเพิ่มคนเดียว */
function promptAddUser() {
  var ui = SpreadsheetApp.getUi();
  var e = ui.prompt('เพิ่มผู้ใช้', 'อีเมลบริษัท:', ui.ButtonSet.OK_CANCEL);
  if (e.getSelectedButton() !== ui.Button.OK) return;
  var email = String(e.getResponseText() || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { ui.alert('อีเมลไม่ถูกต้อง'); return; }

  var n = ui.prompt('เพิ่มผู้ใช้', 'ชื่อ-นามสกุล:', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;

  var d = ui.prompt('เพิ่มผู้ใช้',
    'แผนก (' + Object.keys(ROLES).join(' / ') + '):', ui.ButtonSet.OK_CANCEL);
  if (d.getSelectedButton() !== ui.Button.OK) return;
  var dept = String(d.getResponseText() || '').trim().toUpperCase();
  if (!ROLES[dept]) { ui.alert('ไม่รู้จักแผนก "' + dept + '"'); return; }

  if (Repo.findBy(SHEETS.USERS, 'email', email)) { ui.alert('อีเมลนี้มีในระบบแล้ว'); return; }
  Repo.insert(SHEETS.USERS, {
    email: email, full_name: n.getResponseText(), dept: dept,
    title: ROLES[dept].name, is_active: 'TRUE'
  });
  History.log(Session.getActiveUser().getEmail(), 'USER_ADD', 'Users', email, null,
    {email: email, dept: dept});
  ui.alert('เพิ่ม ' + email + ' เป็น' + ROLES[dept].name + ' แล้ว');
}

/** ตรวจตารางผู้ใช้ว่าพร้อมเปิดใช้ไหม — บอกเป็นข้อ ๆ ว่าขาดอะไร */
function checkUsers() {
  SpreadsheetApp.getUi().alert(usersReport_().join('\n'));
}

function usersReport_() {
  var users = Repo.readAll(SHEETS.USERS).filter(function (u) {
    return String(u.email).trim() !== '';
  });
  var out = ['ตารางผู้ใช้ — ' + users.length + ' คน', ''];
  var byDept = {};
  users.forEach(function (u) {
    var d = String(u.dept).trim().toUpperCase();
    (byDept[d] = byDept[d] || []).push(u);
  });
  /* แผนกที่มีทีมย่อยไม่จำเป็นต้องมีคนในแถวของตัวเอง ถ้าทีมย่อยมีคนครบแล้ว
     ถ้าไม่แยกกรณีนี้ รายงานจะขึ้นกากบาทที่ "จัดซื้อ" กับ "บัญชี" ตลอดเวลา
     แล้วคนอ่านจะไล่แก้ปัญหาที่ไม่มีอยู่จริง จนเลิกเชื่อรายงานนี้ไปเลย */
  var teamsOf = {};
  Object.keys(DEPT_FAMILY).forEach(function (k) {
    (teamsOf[DEPT_FAMILY[k]] = teamsOf[DEPT_FAMILY[k]] || []).push(k);
  });
  var activeIn = function (d) {
    return (byDept[d] || []).filter(function (u) {
      return String(u.is_active).toUpperCase() !== 'FALSE';
    });
  };
  Object.keys(ROLES).forEach(function (d) {
    var active = activeIn(d);
    var teams = teamsOf[d] || [];
    var names = active.map(function (u) { return u.full_name || u.email; }).join(', ');
    if (active.length) { out.push('✓ ' + ROLES[d].name + ' (' + d + '): ' + names); return; }

    if (teams.length) {
      // ไม่มีคนในแถวแม่ — ดูว่าทีมย่อยครบไหม ถ้าครบก็ไม่ใช่ปัญหา
      var empty = teams.filter(function (t) { return !activeIn(t).length; });
      out.push((empty.length ? '✗ ' : '✓ ') + ROLES[d].name + ' (' + d + '): ' +
        (empty.length
          ? 'ทีมย่อยยังไม่มีคน: ' + empty.map(function (t) { return ROLES[t].name; }).join(', ')
          : 'ไม่มีคนดูแทนส่วนกลาง แต่ทีมย่อยมีคนครบแล้ว — ใช้งานได้'));
      return;
    }
    out.push('✗ ' + ROLES[d].name + ' (' + d + '): ยังไม่มีใคร — แผนกนี้จะเข้าระบบไม่ได้');
  });

  var bad = users.filter(function (u) {
    return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(u.email).trim());
  });
  if (bad.length) {
    out.push('', 'อีเมลผิดรูปแบบ ' + bad.length + ' แถว:');
    bad.forEach(function (u) { out.push('  - "' + u.email + '"'); });
  }
  var dup = {}, dups = [];
  users.forEach(function (u) {
    var k = String(u.email).trim().toLowerCase();
    if (dup[k]) dups.push(k); else dup[k] = 1;
  });
  if (dups.length) out.push('', 'อีเมลซ้ำ: ' + dups.join(', '));
  var noLark = users.filter(function (u) { return !String(u.lark_user_id).trim(); });
  if (noLark.length)
    out.push('', 'ยังไม่มี lark_user_id ' + noLark.length + ' คน — คนเหล่านี้จะได้แจ้งเตือน' +
      'เฉพาะในกลุ่ม ไม่ได้รับข้อความส่วนตัว');
  return out;
}

/** ตรวจความพร้อมทั้งระบบก่อนเปิดให้พนักงานใช้ */
function healthCheck() {
  var out = ['ความพร้อมของระบบ', ''];
  var need = ['SPREADSHEET_ID', 'DRIVE_ROOT_ID', 'ADMIN_EMAIL'];
  var lark = ['LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_GROUP_CHAT_ID'];
  need.forEach(function (k) {
    out.push((Props.get(k) ? '✓ ' : '✗ ') + k + (Props.get(k) ? '' : ' — ยังไม่ได้ตั้ง'));
  });
  lark.forEach(function (k) {
    out.push((Props.get(k) ? '✓ ' : '✗ ') + k +
      (Props.get(k) ? '' : ' — ยังไม่ได้ตั้ง (แจ้งเตือน Lark จะไม่ทำงาน)'));
  });
  out.push('');
  Object.keys(COLS).forEach(function (n) {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n);
    if (!sh) out.push('✗ ไม่มีแท็บ ' + n);
  });
  out.push('');
  out = out.concat(usersReport_());
  out.push('', 'รายการในช่วงทดลอง: ' + Repo.readAll(SHEETS.PILOT).length + ' ใบ');
  out.push('รายการทั้งหมด: ' + Repo.readAll(SHEETS.DEALS).length + ' ใบ');
  SpreadsheetApp.getUi().alert(out.join('\n'));
}

/**
 * โฟลเดอร์เก็บเอกสาร — ต้องอยู่ใน Shared drive
 *
 * ถ้ายังไม่ได้ตั้ง DRIVE_ROOT_ID ระบบสร้างให้ได้ แต่จะไปอยู่ใน "ไดรฟ์ของฉัน" ของคนที่กดติดตั้ง
 * ซึ่งแปลว่าเอกสารของทั้งบริษัทไปอยู่ในไดรฟ์ส่วนตัวของคนคนเดียว
 * วันที่คนนั้นลาออกแล้วบัญชีถูกปิด ไฟล์หายไปพร้อมกัน — และไม่มีใครรู้จนกว่าจะสาย
 * จึงต้องบอกให้ชัดว่าไปอยู่ที่ไหน ไม่ใช่สร้างเงียบ ๆ แล้วถือว่าเรียบร้อย
 */
function ensureDriveRoot_() {
  var id = Props.get('DRIVE_ROOT_ID');
  if (id) {
    try {
      var f0 = DriveApp.getFolderById(id);
      return {id: id, name: f0.getName(), created: false, warn: ''};
    } catch (e) {
      return {id: id, name: '(เปิดไม่ได้)', created: false,
              warn: 'DRIVE_ROOT_ID ที่ตั้งไว้เปิดไม่ได้ — ตรวจว่าไอดีถูกและมีสิทธิ์เข้าถึง'};
    }
  }
  var f = DriveApp.createFolder('MGS-Documents');
  Props.set('DRIVE_ROOT_ID', f.getId());
  return {id: f.getId(), name: f.getName(), created: true,
          warn: 'สร้างโฟลเดอร์ "MGS-Documents" ให้แล้วใน *ไดรฟ์ของฉัน* ของคุณ\n' +
                'ควรย้ายไปไว้ใน Shared drive แล้วแก้ DRIVE_ROOT_ID ให้ตรงกับโฟลเดอร์ใหม่\n' +
                'ถ้าปล่อยไว้ เอกสารของทั้งบริษัทจะอยู่ในไดรฟ์ส่วนตัวของคุณคนเดียว'};
}

function installTriggers_() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('jobSlaSweep') < 0)
    ScriptApp.newTrigger('jobSlaSweep').timeBased().everyHours(2).create();
  if (have.indexOf('jobMorningDigest') < 0)
    ScriptApp.newTrigger('jobMorningDigest').timeBased().atHour(
      Number(Config.get('DIGEST_HOUR', 8))).everyDays(1).create();
  if (have.indexOf('jobFlushNotifications') < 0)
    ScriptApp.newTrigger('jobFlushNotifications').timeBased().everyMinutes(10).create();
}

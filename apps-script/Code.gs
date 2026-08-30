/**
 * Code.gs — ประตูเข้าออกของเว็บแอป
 * ==========================================================================
 * ทุกฟังก์ชันที่หน้าจอเรียกได้ต้องอยู่ในไฟล์นี้ และต้อง
 *   1. หา "ผู้ใช้จริง" จาก session ด้วย Auth.me() เป็นอย่างแรก
 *   2. ห่อด้วย safely_() เพื่อคืนผลแบบมีโครงสร้างเสมอ ไม่โยน exception ข้ามฝั่ง
 *
 * หน้าจอส่ง "บทบาท" มาบอกไม่ได้ ส่งมาก็ไม่มีใครอ่าน
 */

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('index');
  t.bootJson = '';                       // ข้อมูลเริ่มต้นดึงหลังหน้าโหลด กันหน้าค้างถ้าชีตช้า
  return t.evaluate()
    .setTitle('MGS Document Center')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ---------- ข้อมูลตั้งต้นของหน้าจอ ---------- */

/**
 * เรียกครั้งเดียวตอนเปิดแอป — ส่งทั้งตัวตน สิทธิ์ และ "นิยามกระบวนการ"
 * หน้าจอไม่ถือสำเนากระบวนการของตัวเอง รับจากที่นี่ที่เดียว (ดูเหตุผลใน Flow.gs)
 */
function apiBoot() {
  return safely_('เปิดระบบ', function () {
    var me = Auth.me();
    return {
      me: {email: me.email, name: me.name, dept: me.dept, roleName: me.roleName,
           money: me.money, isMgr: me.isMgr, isAdmin: me.isAdmin,
           initials: Auth.initials(me.name)},
      flow: {
        STAGES: STAGES, DOCS: DOCS, PHASES: PHASES, MODULES: MODULES,
        ROLES: ROLES, PAY_ST: PAY_ST, BILLDOC: BILLDOC, WHT: WHT,
        HAND: HAND, NEEDS: NEEDS, PAY_APPROVER: PAY_APPROVER
      },
      can: Object.keys(Auth.CAN).filter(function (c) {
        return Auth.CAN[c].indexOf(me.dept) >= 0;
      }),
      cfg: {
        cashLimit: Config.num('CASH_LIMIT', 50000),
        pilotOnly: String(Config.get('PILOT_ONLY', 'TRUE')).toUpperCase() === 'TRUE',
        env: Props.get('ENV', 'PILOT')
      }
    };
  });
}

function apiListDeals() {
  return safely_('ดึงรายการ', function () {
    var me = Auth.me();
    Auth.require(me, 'list');
    return Domain.listDeals(me);
  });
}

function apiGetDeal(dealNo) {
  return safely_('เปิดรายการ', function () {
    var me = Auth.me();
    Auth.require(me, 'get');
    return Domain.getDeal(me, String(dealNo));
  });
}

/* ---------- เดินงาน ---------- */

function apiSaveHandoff(dealNo, payload) {
  return safely_('บันทึกข้อมูลส่งต่อ', function () {
    return Domain.saveHandoff(Auth.me(), String(dealNo), payload || {});
  });
}

function apiAdvanceStage(dealNo, note) {
  return safely_('ส่งต่อขั้นถัดไป', function () {
    return Domain.advanceStage(Auth.me(), String(dealNo), String(note || ''));
  });
}

/* ---------- เรื่องเงิน ---------- */

function apiRequestPayment(dealNo, seq, data) {
  return safely_('ตั้งเรื่องขอจ่าย', function () {
    return Domain.requestPayment(Auth.me(), String(dealNo), Number(seq), data || {});
  });
}

function apiApprovePayment(dealNo, seq) {
  return safely_('อนุมัติจ่าย', function () {
    return Domain.approvePayment(Auth.me(), String(dealNo), Number(seq));
  });
}

function apiRecordPayment(dealNo, seq, data) {
  return safely_('บันทึกการจ่าย', function () {
    return Domain.recordPayment(Auth.me(), String(dealNo), Number(seq), data || {});
  });
}

/* ---------- เอกสาร ---------- */

/**
 * อัพโหลดไฟล์ — หน้าจอส่ง base64 มา
 * ตั้งชื่อไฟล์และเลือกโฟลเดอร์ให้เอง ผู้ใช้ไม่ต้องคิดว่าจะเก็บที่ไหน
 */
function apiUploadDoc(dealNo, docCode, fileName, base64, mimeType) {
  return safely_('อัพโหลดเอกสาร', function () {
    var me = Auth.me();
    Auth.require(me, 'doc.upload');
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      Domain.assertEditable_(d);

      var spec = DOCS.filter(function (x) { return x.c === docCode; })[0];
      if (!spec) throw AppError('BAD_DOC', 'ไม่รู้จักเอกสารประเภท ' + docCode);

      var bytes = Utilities.base64Decode(base64);
      if (bytes.length > 20 * 1024 * 1024)
        throw AppError('TOO_BIG', 'ไฟล์ใหญ่เกิน 20 MB — ย่อไฟล์ก่อนอัพโหลด');

      var root = DriveApp.getFolderById(Props.require('DRIVE_ROOT_ID'));
      var yearFolder = folder_(root, d.entry === 'CASH' ? 'CASH' : 'PO');
      var dealFolder = folder_(yearFolder, String(dealNo));

      var ext = String(fileName).indexOf('.') > 0 ? String(fileName).split('.').pop() : 'pdf';
      var ver = Repo.where(SHEETS.DOCUMENTS, function (x) {
        return String(x.deal_no).trim() === String(dealNo).trim() && x.doc_code === docCode;
      }).length + 1;
      var name = dealNo + '_' + docCode + (ver > 1 ? '_v' + ver : '') + '.' + ext;

      var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', name);
      var file = dealFolder.createFile(blob);

      var docId = 'D' + new Date().getTime();
      Repo.insert(SHEETS.DOCUMENTS, {
        doc_id: docId, deal_no: dealNo, doc_code: docCode, doc_name: spec.n,
        file_id: file.getId(), file_name: name, version: ver,
        uploaded_at: new Date(), uploaded_by: me.email
      });
      History.log(me.email, 'แนบ ' + spec.n + ' (' + name + ')', 'Documents', dealNo, null,
        {doc: docCode, file: name});
      return {docId: docId, fileName: name, version: ver};
    });
  });
}

function folder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ---------- ความเห็นจากผู้ใช้ ---------- */

function apiSendFeedback(data) {
  return safely_('ส่งความเห็น', function () {
    return Domain.sendFeedback(Auth.me(), data || {});
  });
}

function apiListFeedback() {
  return safely_('ดูความเห็นทั้งหมด', function () {
    var me = Auth.me();
    Auth.require(me, 'feedback.list');
    return Repo.readAll(SHEETS.FEEDBACK).reverse();
  });
}

/* ---------- ผู้ดูแล ---------- */

function apiListUsers() {
  return safely_('ดูตารางผู้ใช้', function () {
    var me = Auth.me();
    Auth.require(me, 'admin.users');
    return Repo.readAll(SHEETS.USERS).map(function (u) {
      return {email: u.email, full_name: u.full_name, dept: u.dept,
              is_active: u.is_active, has_lark: !!String(u.lark_user_id).trim()};
    });
  });
}

function apiAddToPilot(dealNo, note) {
  return safely_('เพิ่มเข้าช่วงทดลอง', function () {
    var me = Auth.me();
    Auth.require(me, 'admin.pilot');
    return withLock_(function () {
      if (Repo.findBy(SHEETS.PILOT, 'deal_no', dealNo))
        throw AppError('DUP', 'รายการนี้อยู่ในช่วงทดลองแล้ว');
      Repo.insert(SHEETS.PILOT, {deal_no: dealNo, added_at: new Date(),
                                 added_by: me.email, note: note || ''});
      History.log(me.email, 'เพิ่ม ' + dealNo + ' เข้าช่วงทดลอง', 'Pilot_Scope', dealNo, null, null);
      return {ok: true};
    });
  });
}

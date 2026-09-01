/**
 * Auth.gs — ผู้ใช้ สิทธิ์ และการตัดข้อมูลก่อนส่งออก
 * ==========================================================================
 * *** นี่คือชั้นที่บังคับกติกาจริง ***
 * ในตัวอย่างที่ใช้นำเสนอ กติกาบังคับที่หน้าจอได้เพราะข้อมูลอยู่ในเบราว์เซอร์ทั้งก้อน
 * พอมีเซิร์ฟเวอร์จริง การซ่อนที่หน้าจอไม่ใช่การกัน — เปิด DevTools ก็เห็นข้อมูลที่ส่งไป
 *
 * กติกาสามข้อที่บังคับที่นี่และที่นี่เท่านั้น
 *   1. บทบาทมาจากตาราง Users ตามอีเมลใน session — หน้าจอส่งบทบาทมาบอกไม่ได้
 *   2. ยอดเงินถูกตัดออกจากข้อมูล "ก่อนส่ง" ให้ QC / โลจิสติกส์ / คลัง — ไม่ใช่ส่งไปแล้วซ่อน
 *   3. ผู้ขอ ≠ ผู้อนุมัติ ≠ ผู้บันทึกจ่าย เช็คด้วยอีเมลจริง ไม่ใช่ชื่อที่พิมพ์มา
 */

var Auth = {
  /** ผู้ใช้ที่กำลังเรียกอยู่ — ไม่มีในตาราง Users = ไม่ให้เข้า */
  me: function () {
    var email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!email)
      throw AppError('NO_SESSION',
        'ระบบอ่านบัญชีของคุณไม่ได้ — กรุณาเปิดด้วยบัญชี Google ของบริษัท');

    var u = null;
    Repo.readAll(SHEETS.USERS).forEach(function (r) {
      if (String(r.email).trim().toLowerCase() === email) u = r;
    });
    if (!u)
      throw AppError('NOT_REGISTERED',
        'อีเมล ' + email + ' ยังไม่มีในระบบ — แจ้งหัวหน้าแผนกให้เพิ่มชื่อคุณในตารางผู้ใช้');
    if (String(u.is_active).toUpperCase() === 'FALSE')
      throw AppError('INACTIVE', 'บัญชีของคุณถูกปิดการใช้งาน — ติดต่อ IT');

    var dept = String(u.dept || '').trim().toUpperCase();
    if (!ROLES[dept])
      throw AppError('BAD_DEPT',
        'แผนก "' + u.dept + '" ของคุณไม่ตรงกับที่ระบบรู้จัก — ให้ IT แก้ในตารางผู้ใช้ ' +
        '(ใช้ได้: ' + Object.keys(ROLES).join(', ') + ')');

    return {
      email: email,
      name: String(u.full_name || email),
      dept: dept,
      roleName: ROLES[dept].name,
      money: !!ROLES[dept].money,
      isMgr: ROLES[dept].lvl === 'mgr',
      isAdmin: ROLES[dept].lvl === 'admin',
      larkId: String(u.lark_user_id || ''),
      manager: String(u.manager_email || '').toLowerCase()
    };
  },

  /** ตัวย่อชื่อสำหรับวงกลมในแถบบน — ใช้ตัวอักษรแรกของคำ */
  initials: function (name) {
    var parts = String(name || '').replace(/^(นาย|นาง|นางสาว|คุณ)/, '').trim().split(/\s+/);
    return (parts[0] || '?').slice(0, 2);
  },

  /* ---------- สิทธิ์ระดับคำสั่ง ----------
     deny by default: คำสั่งที่ไม่ได้เขียนไว้ในตารางนี้ ไม่มีใครเรียกได้ */
  CAN: {
    // ดูข้อมูล — ทุกแผนกดูรายการได้ (ยอดเงินถูกตัดตามบทบาทอยู่แล้ว)
    'list':          ['SR','QC','LS','WH','AC','AC_FN','AC_TH','ACH','GM','IT'],
    'get':           ['SR','QC','LS','WH','AC','ACH','GM','IT'],
    'feedback.send': ['SR','QC','LS','WH','AC','ACH','GM','IT'],
    'feedback.list': ['SR','AC','AC_FN','AC_TH','ACH','GM','IT'],

    // เดินงาน — เช็คเพิ่มอีกชั้นว่าเป็นเจ้าของขั้นนั้นจริงไหม (ดู assertStageOwner)
    'stage.advance': ['SR','QC','LS','WH','AC','AC_FN','AC_TH','ACH','GM'],
    'handoff.save':  ['SR','QC','LS','WH','AC','AC_FN','AC_TH','ACH','GM'],
    'doc.upload':    ['SR','QC','LS','WH','AC','AC_FN','AC_TH','ACH','GM'],

    // เรื่องเงิน — เฉพาะแผนกที่มีสิทธิ์เห็นเงิน
    'pay.request':   ['SR','AC','AC_FN','AC_TH'],
    'pay.approve':   ['ACH','GM'],
    'pay.record':    ['AC','AC_FN','AC_TH'],

    // ตั้งค่าระบบ — ทะเบียนซื้อเงินสดมียอดเงินอยู่ข้างใน
    'admin.read':    ['SR','AC','AC_FN','AC_TH','ACH','GM','IT'],
    'admin.users':   ['IT','GM'],
    'admin.pilot':   ['SR','AC','AC_FN','AC_TH','IT','GM'],
    'sap.import':    ['SR','AC','AC_FN','AC_TH','IT']
  },

  /** ปฏิเสธคำสั่งที่บทบาทนี้ไม่มีสิทธิ์ — เรียกก่อนทำงานทุกครั้ง */
  require: function (me, cmd) {
    var allow = this.CAN[cmd];
    if (!allow)
      throw AppError('UNKNOWN_CMD', 'ไม่รู้จักคำสั่ง "' + cmd + '"');
    if (allow.indexOf(me.dept) < 0)
      throw AppError('FORBIDDEN',
        'แผนก' + me.roleName + 'ไม่มีสิทธิ์ทำรายการนี้ (' + cmd + ')');
    return true;
  },

  /** ขั้นนี้เป็นของแผนกคุณจริงไหม — กันคนกดปิดขั้นของแผนกอื่น */
  assertStageOwner: function (me, deal) {
    var st = STAGES[Number(deal.stage)];
    if (!st) throw AppError('BAD_STAGE', 'รายการนี้ไม่มีขั้นที่ต้องทำแล้ว');
    // ขั้นของบัญชีแตกเป็นต่างประเทศ/ในประเทศตามสกุลเงินของใบนี้
    var want = ownerDeptOf(Number(deal.stage), deal);
    if (!deptCovers(me.dept, want))
      throw AppError('NOT_YOUR_STAGE',
        'ขั้น "' + st.n + '" ของใบนี้เป็นงานของ' + (ROLES[want] ? ROLES[want].name : want) +
        ' ไม่ใช่ของคุณ' +
        (want === 'AC_FN' || want === 'AC_TH'
          ? ' (แยกตามสกุลเงิน — ใบนี้เป็น ' + (deal.currency || 'THB') + ')' : ''));
    return st;
  },

  /* ---------- ตัดข้อมูลก่อนส่งออก ----------
     กติกาใน docs/03: QC · โลจิสติกส์ · คลัง ไม่เห็นยอดเงิน
     เพื่อให้ผลตรวจไม่ถูกกดดันด้วยมูลค่าของล็อต */

  /** ฟิลด์ที่เป็นเรื่องเงินในรายการหนึ่งใบ */
  MONEY_DEAL_FIELDS: ['amount', 'currency', 'payment_term', 'term_name'],

  /* ฟิลด์ที่ระบบใช้ภายใน ไม่มีใครควรได้รับ ไม่ว่าบทบาทไหน
     fingerprint คือลายนิ้วมือกันนำเข้าซ้ำ ประกอบด้วย สาย|PO|รายการ|**ยอดเงิน**|วันครบกำหนด
     ส่งออกไปแปลว่ายอดเงินหลุดไปกับมันด้วย ทั้งที่ตัดคอลัมน์ amount ออกไปแล้ว
     เจอตอนทดสอบเดินทั้งกระบวนการจริง — เครื่องตรวจเดิมไม่เจอเพราะข้อมูลทดสอบไม่มีค่านี้ */
  INTERNAL_DEAL_FIELDS: ['fingerprint'],

  /** ตัดยอดเงินและฟิลด์ภายในออกจากรายการเดียว */
  scrubDeal: function (me, deal) {
    var out = {};
    Object.keys(deal).forEach(function (k) {
      if (Auth.INTERNAL_DEAL_FIELDS.indexOf(k) >= 0) return;
      if (!me.money && Auth.MONEY_DEAL_FIELDS.indexOf(k) >= 0) return;
      out[k] = deal[k];
    });
    if (!me.money) out._moneyHidden = true;
    return out;
  },

  /** ตัดยอดเงินออกจากค่าที่ขั้นก่อนหน้าส่งมา (เช่น ยอดในใบแจ้งหนี้) */
  scrubHandoff: function (me, payload) {
    if (me.money) return payload;
    var money = moneyFieldKeys(), out = {};
    Object.keys(payload || {}).forEach(function (k) {
      if (money.indexOf(k) < 0) out[k] = payload[k];
    });
    return out;
  },

  /** งวดจ่ายทั้งชุด — บทบาทที่ไม่มีสิทธิ์เห็นเงินไม่ได้รับเลยแม้แต่แถวเดียว */
  scrubPayments: function (me, payments) {
    return me.money ? payments : [];
  },

  /** บรรทัดประวัติ — ตัดยอดที่ฝังกลางประโยคออก (ดูวิธีห่อใน Domain.gs) */
  scrubHistoryLine: function (me, text) {
    var s = String(text || '');
    if (me.money) return s.split('⁢').join('');
    return s.split('⁢').filter(function (x, i) { return i % 2 === 0; })
            .join('').replace(/\s{2,}/g, ' ').replace(/\s+·/g, ' ·').trim();
  }
};

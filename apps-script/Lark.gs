/**
 * Lark.gs — แจ้งเตือนผ่าน Lark Bot API และเนื้อหาข้อความ
 * ==========================================================================
 * ใช้ Bot API (ไม่ใช่ webhook) เพราะต้องส่งหาคนเป็นรายคนได้ ไม่ใช่แค่กลุ่มเดียว
 *
 * หลักที่ยึด
 *   - Lark ตอบ HTTP 200 พร้อมรหัสข้อผิดพลาดข้างใน ต้องเช็ค body.code เสมอ
 *     ถ้าไม่เช็ค ความล้มเหลวจะดูเหมือนสำเร็จ
 *   - การแจ้งเตือนล้มเหลว *ห้าม* ทำให้การบันทึกงานล้มตาม
 *     บันทึกงานให้เสร็จก่อน แล้วค่อยเข้าคิวส่ง ส่งไม่ได้ก็จดไว้ว่าส่งไม่ได้
 *   - ยอดเงินไม่ส่งเข้ากลุ่มรวม — กลุ่มมีคนจากทุกแผนกรวมถึง QC/คลัง
 */

var Lark = {
  host: function () { return Props.get('LARK_HOST', 'open.larksuite.com'); },
  on: function () {
    return String(Config.get('LARK_ON', 'TRUE')).toUpperCase() === 'TRUE' &&
           !!Props.get('LARK_APP_ID') && !!Props.get('LARK_APP_SECRET');
  },

  /** token อายุ ~2 ชม. — แคชไว้ 100 นาที ไม่ต้องขอใหม่ทุกครั้ง */
  token_: function () {
    var cache = CacheService.getScriptCache();
    var hit = cache.get('lark_tat');
    if (hit) return hit;
    var res = UrlFetchApp.fetch(
      'https://' + this.host() + '/open-apis/auth/v3/tenant_access_token/internal',
      {method: 'post', contentType: 'application/json', muteHttpExceptions: true,
       payload: Json.stringify({app_id: Props.require('LARK_APP_ID'),
                                app_secret: Props.require('LARK_APP_SECRET')})});
    var body = Json.parse(res.getContentText(), {});
    if (body.code !== 0)
      throw AppError('LARK_AUTH', 'Lark ปฏิเสธการยืนยันตัวตน: ' + (body.msg || '(ไม่มีข้อความ)'));
    cache.put('lark_tat', body.tenant_access_token, 6000);
    return body.tenant_access_token;
  },

  /** ส่งข้อความจริง — ใช้ภายใน ผู้เรียกทั่วไปใช้ queue() */
  send_: function (receiveId, idType, text) {
    var res = UrlFetchApp.fetch(
      'https://' + this.host() + '/open-apis/im/v1/messages?receive_id_type=' + idType,
      {method: 'post', contentType: 'application/json', muteHttpExceptions: true,
       headers: {Authorization: 'Bearer ' + this.token_()},
       payload: Json.stringify({receive_id: receiveId, msg_type: 'text',
                                content: Json.stringify({text: text})})});
    var body = Json.parse(res.getContentText(), {});
    if (body.code !== 0)
      throw AppError('LARK_SEND', 'Lark ส่งไม่สำเร็จ (' + body.code + '): ' + (body.msg || ''));
    return true;
  },

  /**
   * เข้าคิวแจ้งเตือน — บันทึกลงชีตก่อนเสมอ แล้วพยายามส่งทันที
   * ส่งไม่ได้ก็ยังมีแถวค้างไว้ให้ทริกเกอร์มาส่งซ้ำ ไม่หายไปเฉย ๆ
   */
  queue: function (toEmail, title, body, dealNo, level) {
    var row = {
      notif_id: 'N' + new Date().getTime() + Math.floor(Math.random() * 1000),
      created_at: new Date(), to_email: toEmail || '(กลุ่ม)', channel: 'LARK',
      title: title, body: body, deal_no: dealNo || '', level: level || 'info',
      send_status: 'QUEUED'
    };
    try { Repo.insert(SHEETS.NOTIFS, row); } catch (e) { return; }
    try { this.flushOne_(row); } catch (e) { /* ทริกเกอร์จะมาส่งซ้ำ */ }
  },

  flushOne_: function (row) {
    if (!this.on()) {
      this.mark_(row.notif_id, 'OFF', 'ปิดการส่ง Lark อยู่ (Config.LARK_ON)');
      return;
    }
    var text = row.title + '\n' + row.body;
    try {
      if (row.to_email && row.to_email !== '(กลุ่ม)') {
        var u = Repo.findBy(SHEETS.USERS, 'email', row.to_email);
        var lid = u ? String(u.lark_user_id || '').trim() : '';
        if (lid) this.send_(lid, 'user_id', text);
        else {
          // ไม่มี lark_user_id ก็ส่งเข้ากลุ่มแทน ดีกว่าเงียบ
          this.send_(Props.require('LARK_GROUP_CHAT_ID'), 'chat_id',
            '[ถึง ' + row.to_email + ']\n' + text);
          this.mark_(row.notif_id, 'SENT_GROUP', 'ผู้รับยังไม่มี lark_user_id ส่งเข้ากลุ่มแทน');
          return;
        }
      } else {
        this.send_(Props.require('LARK_GROUP_CHAT_ID'), 'chat_id', text);
      }
      this.mark_(row.notif_id, 'SENT', '');
    } catch (e) {
      this.mark_(row.notif_id, 'FAILED', String(e.message || e).slice(0, 500));
      throw e;
    }
  },

  mark_: function (id, status, err) {
    try {
      Repo.update(SHEETS.NOTIFS, 'notif_id', id,
        {send_status: status, sent_at: new Date(), error: err});
    } catch (e) {}
  },

  alertAdmin: function (text) {
    var to = Props.get('ADMIN_EMAIL', '');
    if (!to) return;
    try { MailApp.sendEmail(to, '[MGS Document Center] ระบบขัดข้อง', text); } catch (e) {}
  }
};

/* ---------- เนื้อหาการแจ้งเตือน ----------
   หนึ่งเหตุการณ์ = หนึ่งฟังก์ชัน · ข้อความบอกว่า "ต้องทำอะไรต่อ" ไม่ใช่แค่ "มีอะไรเกิดขึ้น" */
var Notify = {
  link_: function (dealNo) {
    var u = Props.get('WEBAPP_URL', '');
    return u ? '\nเปิดดู: ' + u + '#po/' + encodeURIComponent(dealNo) : '';
  },

  /** งานเข้าคิวของแผนกถัดไป — ส่งหาทุกคนในแผนกนั้น */
  stageArrived: function (dealNo, stageIdx) {
    try {
      var st = STAGES[stageIdx];
      if (!st) return;
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo) || {};
      var want = ownerDeptOf(stageIdx, d);
      var body = 'รายการ ' + dealNo + ' · ' + (d.supplier || '') + '\n' +
        (d.item || '') + '\nกำหนดเสร็จภายใน ' + st.sla + ' ชม.' + this.link_(dealNo);

      /* ถ้าใบนี้มีเจ้าของงานระบุไว้ และเจ้าของอยู่แผนกที่ถือขั้นนี้ ส่งหาเจ้าของคนเดียวพอ
         ไม่ต้องยิงทั้งแผนก — คนอื่นจะได้ไม่ต้องอ่านงานที่ไม่ใช่ของตัวเอง */
      var owner = String(d.owner_email || '').trim().toLowerCase();
      if (owner) {
        var ou = Repo.findBy(SHEETS.USERS, 'email', owner);
        if (ou && deptCovers(String(ou.dept).trim().toUpperCase(), want) &&
            String(ou.is_active).toUpperCase() !== 'FALSE') {
          Lark.queue(owner, '[ถึงคิวคุณ] ' + st.n, body, dealNo, 'act');
          return;
        }
      }
      Repo.where(SHEETS.USERS, function (u) {
        return deptCovers(String(u.dept).trim().toUpperCase(), want) &&
               String(u.is_active).toUpperCase() !== 'FALSE' && String(u.email).trim();
      }).forEach(function (u) {
        Lark.queue(u.email, '[ถึงคิวคุณ] ' + st.n, body, dealNo, 'act');
      });
    } catch (e) { ErrorLog.write('Notify.stageArrived', e); }
  },

  /** คนในแผนกหนึ่ง ๆ ที่ยังใช้งานอยู่ (ตัดคนที่ระบุออกได้) */
  deptUsers_: function (dept, exceptEmail) {
    return Repo.where(SHEETS.USERS, function (u) {
      return deptCovers(String(u.dept).trim().toUpperCase(), dept) &&
             String(u.is_active).toUpperCase() !== 'FALSE' &&
             String(u.email).trim() &&
             String(u.email).trim().toLowerCase() !== String(exceptEmail || '').toLowerCase();
    });
  },

  /** ฝั่งบัญชีที่ต้องดูใบนี้ — ต่างประเทศหรือในประเทศ ตามสกุลเงิน */
  acSideOf_: function (dealNo) {
    var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo) || {};
    return isForeign(d) ? 'AC_FN' : 'AC_TH';
  },

  /** จัดซื้อตั้งเรื่อง → บัญชีต้องตรวจ (ยอดเงินอยู่ในข้อความส่วนตัวได้ ไม่เข้ากลุ่ม) */
  payRequested: function (dealNo, seq, reqNo, amt, me, isResubmit) {
    try {
      var head = isResubmit ? '[แก้แล้วส่งใหม่ รอตรวจ] ' : '[รอบัญชีตรวจสอบ] ';
      var body = 'รายการ ' + dealNo + ' งวดที่ ' + seq + '\nยอด ' + Num.money(amt) +
        '\nผู้ขอ: ' + me.name + this.link_(dealNo);
      this.deptUsers_(this.acSideOf_(dealNo), me.email).forEach(function (u) {
        Lark.queue(u.email, head + reqNo, body, dealNo, 'act');
      });
    } catch (e) { ErrorLog.write('Notify.payRequested', e); }
  },

  /** บัญชีตรวจผ่าน → หัวหน้าบัญชีต้องอนุมัติ */
  payChecked: function (dealNo, seq, reqNo, me) {
    try {
      var body = 'รายการ ' + dealNo + ' งวดที่ ' + seq +
        '\nบัญชีตรวจเอกสารแล้วโดย ' + me.name + this.link_(dealNo);
      this.deptUsers_(PAY_APPROVER, me.email).forEach(function (u) {
        Lark.queue(u.email, '[รออนุมัติจ่าย] ' + reqNo, body, dealNo, 'act');
      });
    } catch (e) { ErrorLog.write('Notify.payChecked', e); }
  },

  /**
   * ตีกลับ — ต้องถึงมือผู้ขอให้ได้ เพราะเขาคือคนที่ต้องลงมือแก้
   * ส่งหาผู้ขอเป็นรายคนก่อน แล้วค่อยแจ้งจัดซื้อทั้งแผนกให้รู้ว่ามีของค้าง
   */
  payRejected: function (dealNo, seq, reqNo, why, me, reqBy) {
    try {
      var body = 'รายการ ' + dealNo + ' งวดที่ ' + seq + ' (' + (reqNo || '—') + ')\n' +
        'ผู้ตีกลับ: ' + me.name + ' (' + me.roleName + ')\n' +
        'เหตุผล: ' + why + '\n' +
        'แก้แล้วกดส่งใหม่ได้ที่ใบเดิม ใช้เลขคำขอเดิม' + this.link_(dealNo);

      var to = String(reqBy || '').trim().toLowerCase();
      var sent = {};
      if (to) { Lark.queue(to, '[ถูกตีกลับ ต้องแก้] ' + dealNo, body, dealNo, 'warn'); sent[to] = 1; }
      // แจ้งจัดซื้อคนอื่นด้วย เผื่อผู้ขอลาหรือย้ายงาน เรื่องจะได้ไม่ค้าง
      this.deptUsers_('SR').forEach(function (u) {
        var e = String(u.email).trim().toLowerCase();
        if (sent[e]) return;
        Lark.queue(e, '[คำขอจ่ายถูกตีกลับ] ' + dealNo, body, dealNo, 'warn');
      });
    } catch (e) { ErrorLog.write('Notify.payRejected', e); }
  },

  payApproved: function (dealNo, seq, reqNo, me) {
    try {
      var body = 'รายการ ' + dealNo + ' งวดที่ ' + seq + '\nอนุมัติโดย ' + me.name +
        '\nขั้นต่อไป: บัญชีบันทึกการจ่าย (ต้องเป็นคนละคนกับผู้อนุมัติ)' + this.link_(dealNo);
      this.deptUsers_(this.acSideOf_(dealNo), me.email).forEach(function (u) {
        Lark.queue(u.email, '[อนุมัติแล้ว รอทำจ่าย] ' + reqNo, body, dealNo, 'act');
      });
    } catch (e) { ErrorLog.write('Notify.payApproved', e); }
  },

  /** จ่ายแล้ว — เข้ากลุ่มได้ แต่ไม่ใส่ยอดเงิน เพราะกลุ่มมี QC/คลังอยู่ด้วย */
  payPaid: function (dealNo, seq, amt, me) {
    try {
      Lark.queue('', '[จ่ายแล้ว] ' + dealNo,
        'งวดที่ ' + seq + ' บันทึกการจ่ายเรียบร้อย โดย ' + me.name + this.link_(dealNo),
        dealNo, 'info');
    } catch (e) { ErrorLog.write('Notify.payPaid', e); }
  },

  /** ยอมรับของขาดแล้วปิดใบ — ต้องให้ทุกฝ่ายรู้ เพราะกระทบยอดที่จะจ่าย */
  shortClose: function (dealNo, vr, why, me) {
    try {
      Lark.queue('', '[จบ PO ทั้งที่รับไม่ครบ] ' + dealNo,
        'ขาด ' + Math.abs(vr.diff) + ' ' + vr.unit +
        ' (' + Math.abs(vr.pct) + '%)\nผู้ยืนยัน: ' + me.name + ' (' + me.roleName + ')' +
        '\nเหตุผล: ' + why + this.link_(dealNo), dealNo, 'warn');
    } catch (e) { ErrorLog.write('Notify.shortClose', e); }
  },

  dealClosed: function (dealNo) {
    try {
      Lark.queue('', '[ปิดรายการ] ' + dealNo,
        'เดินครบทุกขั้นแล้ว เอกสารครบ ปิดบัญชีเรียบร้อย', dealNo, 'info');
    } catch (e) { ErrorLog.write('Notify.dealClosed', e); }
  },

  /** ความเห็นจากผู้ใช้ — เข้ากลุ่มทันที เพราะช่วงทดลองต้องเห็นปัญหาเร็วที่สุด */
  feedback: function (id, me, sev, msg, page) {
    try {
      var tag = {BLOCKER: '[ทำงานต่อไม่ได้]', WRONG: '[ผลลัพธ์ผิด]', SUGGEST: '[ข้อเสนอแนะ]'};
      Lark.queue('', (tag[sev] || '[ความเห็น]') + ' ' + id,
        me.name + ' (' + me.roleName + ')\nหน้า: ' + (page || '-') + '\n' + msg,
        '', sev === 'BLOCKER' ? 'warn' : 'info');
    } catch (e) { ErrorLog.write('Notify.feedback', e); }
  }
};

/* ---------- งานตามเวลา ---------- */

/** ส่งซ้ำรายการที่ค้างคิว — ทุก 10 นาที */
function jobFlushNotifications() {
  var pend = Repo.where(SHEETS.NOTIFS, function (n) {
    return ['QUEUED', 'FAILED'].indexOf(String(n.send_status)) >= 0;
  }).slice(0, 50);
  pend.forEach(function (n) {
    try { Lark.flushOne_(n); } catch (e) { /* ครั้งหน้าค่อยลองใหม่ */ }
  });
}

/** เตือนงานที่เลยกำหนด — ทุก 2 ชม. */
function jobSlaSweep() {
  safely_('jobSlaSweep', function () {
    var now = new Date();
    var open = Repo.where(SHEETS.STAGES, function (s) {
      return String(s.done_at).trim() === '';
    });
    open.forEach(function (s) {
      var ent = s.entered_at instanceof Date ? s.entered_at : null;
      if (!ent) return;
      var hrs = (now - ent) / 36e5;
      var sla = Number(s.sla_hours) || 0;
      if (!sla || hrs <= sla) return;
      if (String(s.note || '').indexOf('เตือนแล้ว') >= 0) return;   // เตือนครั้งเดียวพอ
      Repo.where(SHEETS.USERS, function (u) {
        return String(u.dept).trim().toUpperCase() === String(s.owner_dept).trim().toUpperCase() &&
               String(u.is_active).toUpperCase() !== 'FALSE';
      }).forEach(function (u) {
        Lark.queue(u.email, '[เลยกำหนด] ' + s.deal_no,
          'ขั้น ' + s.stage_code + ' ค้างมาแล้ว ' + Math.round(hrs) +
          ' ชม. (กำหนด ' + sla + ' ชม.)', s.deal_no, 'warn');
      });
      try {
        Repo.updateBy2(SHEETS.STAGES, 'deal_no', s.deal_no, 'seq', s.seq,
          {note: String(s.note || '') + ' เตือนแล้ว ' + Fmt.stamp(now)});
      } catch (e) {}
    });
    return true;
  });
}

/** สรุปคิวงานตอนเช้า — ส่งหาแต่ละคนเฉพาะงานของแผนกตัวเอง */
function jobMorningDigest() {
  safely_('jobMorningDigest', function () {
    var byDept = {};
    Repo.where(SHEETS.STAGES, function (s) {
      return String(s.done_at).trim() === '';
    }).forEach(function (s) {
      var d = String(s.owner_dept).trim().toUpperCase();
      (byDept[d] = byDept[d] || []).push(s);
    });
    Repo.where(SHEETS.USERS, function (u) {
      return String(u.is_active).toUpperCase() !== 'FALSE' && String(u.email).trim();
    }).forEach(function (u) {
      var list = byDept[String(u.dept).trim().toUpperCase()] || [];
      if (!list.length) return;
      var lines = list.slice(0, 15).map(function (s) {
        return '· ' + s.deal_no + ' — ' + s.stage_code;
      });
      Lark.queue(u.email, 'คิวงานเช้านี้ ' + list.length + ' รายการ',
        lines.join('\n') + (list.length > 15 ? '\n(และอีก ' + (list.length - 15) + ')' : ''),
        '', 'info');
    });
    return true;
  });
}

/**
 * หา chat_id ของกลุ่มที่ bot อยู่ — ค่าที่หายากที่สุดในบรรดา Script Properties
 * ปกติต้องไปเรียก API เอง คนติดตั้งจึงติดตรงนี้กันมาก
 *
 * ต้องเชิญ bot เข้ากลุ่มก่อน ไม่งั้นจะไม่เห็นกลุ่มนั้น
 */
function listLarkGroups() {
  var r = safely_('หา chat_id ของกลุ่ม Lark', function () {
    var res = UrlFetchApp.fetch(
      'https://' + Lark.host() + '/open-apis/im/v1/chats?page_size=50',
      {method: 'get', muteHttpExceptions: true,
       headers: {Authorization: 'Bearer ' + Lark.token_()}});
    var body = Json.parse(res.getContentText(), {});
    if (body.code !== 0)
      throw AppError('LARK_LIST',
        'Lark ปฏิเสธ (' + body.code + '): ' + (body.msg || '') +
        '\n\nมักเป็นเพราะ app ยังไม่ได้สิทธิ์ im:chat:readonly หรือยังไม่ได้เผยแพร่เวอร์ชัน');
    return (body.data && body.data.items) || [];
  });

  if (!r.ok) { SpreadsheetApp.getUi().alert('หาไม่สำเร็จ\n\n' + r.error); return; }
  if (!r.data.length) {
    SpreadsheetApp.getUi().alert(
      'ไม่พบกลุ่มที่ bot อยู่\n\n' +
      'ให้เชิญ bot เข้ากลุ่มที่ต้องการก่อน แล้วกดเมนูนี้อีกครั้ง');
    return;
  }
  var lines = r.data.map(function (c) {
    return '· ' + (c.name || '(ไม่มีชื่อ)') + '\n   ' + c.chat_id;
  });
  SpreadsheetApp.getUi().alert(
    'กลุ่มที่ bot อยู่ ' + r.data.length + ' กลุ่ม\n\n' + lines.join('\n\n') +
    '\n\nคัดลอกค่าที่ขึ้นต้นด้วย oc_ ของกลุ่มที่ต้องการ ' +
    'ไปใส่ใน Script Property ชื่อ LARK_GROUP_CHAT_ID');
}

function testLark() {
  var r = safely_('testLark', function () {
    Lark.send_(Props.require('LARK_GROUP_CHAT_ID'), 'chat_id',
      'ทดสอบจาก MGS Document Center — ถ้าเห็นข้อความนี้แปลว่าตั้งค่าถูกแล้ว');
    return true;
  });
  SpreadsheetApp.getUi().alert(r.ok ? 'ส่งสำเร็จ — ดูในกลุ่ม Lark' : 'ส่งไม่สำเร็จ:\n' + r.error);
}

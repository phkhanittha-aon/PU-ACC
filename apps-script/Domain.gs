/**
 * Domain.gs — ตรรกะทางธุรกิจ
 * ==========================================================================
 * ทุกฟังก์ชันที่เขียนข้อมูลต้อง
 *   1. เช็คสิทธิ์จาก me (ที่มาจาก session) ไม่ใช่จากค่าที่หน้าจอส่งมา
 *   2. อยู่ใน withLock_ เพื่อกันสองคนเขียนทับกัน
 *   3. กันกดซ้ำ — กดสองครั้งต้องได้หนึ่งแถว
 *   4. บันทึก History ค่าเดิม→ค่าใหม่
 */

/* ยอดเงินที่ต้องฝังกลางประโยคของบรรทัดประวัติ ห่อด้วยตัวคั่นที่มองไม่เห็น
   ผู้อ่านที่ไม่มีสิทธิ์เห็นเงินจะถูกตัดทั้งก้อนออก (ดู Auth.scrubHistoryLine) */
var MK = '⁢';
function bahtIn_(n) { return MK + Num.money(n) + MK; }

var Domain = {

  /* ---------- อ่าน ---------- */

  /** รายการทั้งหมดที่ผู้ใช้คนนี้เห็นได้ — ยอดเงินถูกตัดตามบทบาทก่อนส่งออก */
  listDeals: function (me) {
    var pilot = this.pilotSet_();
    var pilotOnly = String(Config.get('PILOT_ONLY', 'TRUE')).toUpperCase() === 'TRUE';
    return Repo.readAll(SHEETS.DEALS).map(function (d) {
      var out = Auth.scrubDeal(me, d);
      out.stage = Number(d.stage);
      out.inPilot = pilot[String(d.deal_no)] === true;
      out.editable = out.inPilot || !pilotOnly;
      out.owner_dept = ownerDeptOf(out.stage, d) || '';
      out.stage_name = (STAGES[out.stage] || {}).n || '';
      return out;
    });
  },

  pilotSet_: function () {
    var set = {};
    Repo.readAll(SHEETS.PILOT).forEach(function (r) { set[String(r.deal_no).trim()] = true; });
    return set;
  },

  /** รายการหนึ่งใบพร้อมทุกอย่างที่หน้าจอต้องใช้ */
  getDeal: function (me, dealNo) {
    var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
    if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);

    var hand = {};
    Repo.where(SHEETS.HANDOFF, function (h) {
      return String(h.deal_no).trim() === String(dealNo).trim();
    }).forEach(function (h) {
      hand[h.stage_code] = Json.parse(h.payload_json, {});
    });
    // รวมค่าที่ทุกขั้นส่งมาไว้ก้อนเดียว แล้วค่อยตัดเรื่องเงินออกตามบทบาท
    var flat = {};
    Object.keys(hand).forEach(function (sc) {
      Object.keys(hand[sc]).forEach(function (k) { flat[k] = hand[sc][k]; });
    });

    var pays = Repo.where(SHEETS.PAYMENTS, function (p) {
      return String(p.deal_no).trim() === String(dealNo).trim();
    }).sort(function (a, b) { return Number(a.seq) - Number(b.seq); });

    var docs = Repo.where(SHEETS.DOCUMENTS, function (x) {
      return String(x.deal_no).trim() === String(dealNo).trim();
    });

    var stages = Repo.where(SHEETS.STAGES, function (s) {
      return String(s.deal_no).trim() === String(dealNo).trim();
    }).sort(function (a, b) { return Number(a.seq) - Number(b.seq); });

    var hist = Repo.where(SHEETS.HISTORY, function (h) {
      return String(h.entity_id).trim() === String(dealNo).trim();
    }).slice(-40).map(function (h) {
      return {ts: Fmt.stamp(h.ts), actor: h.actor,
              text: Auth.scrubHistoryLine(me, h.action)};
    }).reverse();

    var out = Auth.scrubDeal(me, d);
    out.stage = Number(d.stage);
    out.skip = skipOf(d);
    out.handoff = Auth.scrubHandoff(me, flat);
    out.payments = Auth.scrubPayments(me, pays);
    out.documents = docs;
    out.stageLog = stages;
    out.history = hist;
    out.inPilot = this.pilotSet_()[String(dealNo)] === true;
    // ส่วนต่างจำนวนของ — ให้หน้าจอแสดงได้โดยไม่ต้องคำนวณเอง (กติกาอยู่ที่เซิร์ฟเวอร์ที่เดียว)
    out.qtyVar = this.qtyVarianceOf_(dealNo);
    return out;
  },

  /* ---------- เขียน ---------- */

  /** ต้องอยู่ในช่วงทดลองถึงจะแก้ได้ — นอกรายการเปิดให้ดูอย่างเดียว */
  assertEditable_: function (deal) {
    if (String(Config.get('PILOT_ONLY', 'TRUE')).toUpperCase() !== 'TRUE') return;
    if (!this.pilotSet_()[String(deal.deal_no).trim()])
      throw AppError('NOT_IN_PILOT',
        'รายการ ' + deal.deal_no + ' ยังไม่อยู่ในช่วงทดลอง — ทำตามขั้นตอนเดิมไปก่อน ' +
        '(ถ้าต้องการเพิ่ม ให้จัดซื้อหรือบัญชีเพิ่มเลขนี้ในแท็บ Pilot_Scope)');
  },

  /** บันทึกค่าที่ขั้นนี้ส่งต่อให้ขั้นถัดไป */
  saveHandoff: function (me, dealNo, payload) {
    Auth.require(me, 'handoff.save');
    var self = this;
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      var st = Auth.assertStageOwner(me, d);
      var spec = handOf(st.c, d);
      if (!spec) throw AppError('NO_HANDOFF', 'ขั้นนี้ไม่มีข้อมูลที่ต้องส่งต่อ');

      // ตรวจช่องบังคับที่ฝั่งเซิร์ฟเวอร์ด้วย ไม่ใช่เชื่อหน้าจออย่างเดียว
      var missing = spec.f.filter(function (f) {
        return f.req && String(payload[f.k] === undefined ? '' : payload[f.k]).trim() === '';
      }).map(function (f) { return f.lb; });
      if (missing.length)
        throw AppError('REQUIRED', 'ยังไม่ได้กรอก: ' + missing.join(' · '));

      // ช่องเงิน: บทบาทที่ไม่มีสิทธิ์เห็นเงินส่งค่าเงินมาไม่ได้
      if (!me.money) {
        var money = moneyFieldKeys();
        var bad = Object.keys(payload).filter(function (k) { return money.indexOf(k) >= 0; });
        if (bad.length)
          throw AppError('FORBIDDEN_FIELD',
            'แผนก' + me.roleName + 'ไม่มีสิทธิ์กรอกช่องเกี่ยวกับยอดเงิน');
      }

      var clean = {};
      spec.f.forEach(function (f) {
        if (payload[f.k] !== undefined) clean[f.k] = payload[f.k];
      });

      var exist = Repo.where(SHEETS.HANDOFF, function (h) {
        return String(h.deal_no).trim() === String(dealNo).trim() && h.stage_code === st.c;
      });
      if (exist.length) {
        Repo.updateBy2(SHEETS.HANDOFF, 'deal_no', dealNo, 'stage_code', st.c, {
          payload_json: Json.stringify(clean), saved_at: new Date(), saved_by: me.email
        });
      } else {
        Repo.insert(SHEETS.HANDOFF, {
          deal_no: dealNo, stage_code: st.c, payload_json: Json.stringify(clean),
          saved_at: new Date(), saved_by: me.email
        });
      }
      History.log(me.email, 'บันทึกข้อมูลส่งต่อขั้น ' + st.n, 'Deals', dealNo, null, clean);
      return {saved: Object.keys(clean).length};
    });
  },

  /** ปิดขั้นปัจจุบันแล้วเดินไปขั้นถัดไป */
  advanceStage: function (me, dealNo, note) {
    Auth.require(me, 'stage.advance');
    var self = this;
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      if (String(d.status) !== 'ACTIVE')
        throw AppError('NOT_ACTIVE', 'รายการนี้ปิดไปแล้ว เดินขั้นต่อไม่ได้');
      var st = Auth.assertStageOwner(me, d);

      // ข้อมูลที่ขั้นนี้ต้องส่งต่อ ต้องครบก่อนถึงจะปิดขั้นได้
      var spec = handOf(st.c, d);
      if (spec) {
        var saved = Repo.where(SHEETS.HANDOFF, function (h) {
          return String(h.deal_no).trim() === String(dealNo).trim() && h.stage_code === st.c;
        });
        var got = saved.length ? Json.parse(saved[0].payload_json, {}) : {};
        var missing = spec.f.filter(function (f) {
          return f.req && String(got[f.k] === undefined ? '' : got[f.k]).trim() === '';
        }).map(function (f) { return f.lb; });
        if (missing.length)
          throw AppError('REQUIRED',
            'ยังส่งต่อไม่ได้ ต้องกรอกก่อน: ' + missing.join(' · '));
      }

      // เอกสารบังคับของขั้นนี้ต้องมีไฟล์แล้ว
      var needDoc = DOCS.filter(function (dc) { return dc.at === Number(d.stage) && dc.req; });
      if (needDoc.length) {
        var have = {};
        Repo.where(SHEETS.DOCUMENTS, function (x) {
          return String(x.deal_no).trim() === String(dealNo).trim();
        }).forEach(function (x) { have[x.doc_code] = true; });
        var lack = needDoc.filter(function (dc) { return !have[dc.c]; });
        if (lack.length)
          throw AppError('NEED_DOC', 'ยังไม่ได้แนบเอกสาร: ' +
            lack.map(function (x) { return x.n; }).join(' · '));
      }

      /* รับของไม่ครบแล้วจะปิดใบ ต้องมีคนกดยืนยันพร้อมเหตุผลก่อน
         ปิดเงียบ ๆ ทั้งที่ของขาด แปลว่าจ่ายเต็มให้ของที่ไม่ได้รับเต็ม
         และไม่มีร่องรอยว่าใครเป็นคนตัดสินใจ */
      if (st.c === 'AC_CLOSE') {
        var vr = self.qtyVarianceOf_(dealNo);
        if (vr.ok && vr.short && !String(d.short_closed_by || '').trim())
          throw AppError('QTY_SHORT',
            'รับของไม่ครบ — ได้ ' + vr.actual + ' จาก ' + vr.expected + ' ' + vr.unit +
            ' (ขาด ' + Math.abs(vr.diff) + ' ' + vr.unit + ' / ' + Math.abs(vr.pct) + '%)\n' +
            'ต้องกดยืนยันจบ PO พร้อมระบุเหตุผลก่อน จึงจะปิดใบได้');
      }

      var nxt = nextStage(d);
      var now = new Date();

      // ปิดบรรทัดขั้นปัจจุบัน
      var open = Repo.where(SHEETS.STAGES, function (s) {
        return String(s.deal_no).trim() === String(dealNo).trim() &&
               Number(s.seq) === Number(d.stage) && String(s.done_at).trim() === '';
      });
      if (open.length) {
        var entered = open[0].entered_at instanceof Date ? open[0].entered_at : now;
        var hrs = Math.round((now - entered) / 36e5 * 10) / 10;
        Repo.updateBy2(SHEETS.STAGES, 'deal_no', dealNo, 'seq', d.stage, {
          done_at: now, done_by: me.email, hours_used: hrs,
          sla_breached: hrs > Number(open[0].sla_hours || 0) ? 'TRUE' : 'FALSE',
          note: note || ''
        });
      }

      var patch = {updated_at: now};
      if (nxt < 0) {
        patch.status = 'COMPLETED';
        patch.stage = d.stage;
      } else {
        patch.stage = nxt;
        Repo.insert(SHEETS.STAGES, {
          deal_no: dealNo, seq: nxt, stage_code: STAGES[nxt].c,
          owner_dept: ownerDeptOf(nxt, d),        // บัญชีแยกสองฝั่งตามสกุลเงิน
          entered_at: now, sla_hours: STAGES[nxt].sla
        });
      }
      var res = Repo.update(SHEETS.DEALS, 'deal_no', dealNo, patch);
      History.log(me.email, 'ปิดขั้น ' + st.n + (note ? ' — ' + note : ''),
        'Deals', dealNo, {stage: d.stage}, {stage: patch.stage});

      // แจ้งเตือนต้องไม่ทำให้การบันทึกล้ม — บันทึกสำเร็จแล้วค่อยส่ง
      if (nxt >= 0) Notify.stageArrived(dealNo, nxt);
      else Notify.dealClosed(dealNo);

      return {stage: patch.stage, done: nxt < 0};
    });
  },

  /* ---------- เรื่องเงิน — แยกหน้าที่บังคับที่เซิร์ฟเวอร์ ---------- */

  /** ตั้งเรื่องขอทำจ่ายงวดหนึ่ง */
  requestPayment: function (me, dealNo, seq, data) {
    Auth.require(me, 'pay.request');
    var self = this;
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      var p = self.payment_(dealNo, seq);

      if (isLC(p))
        throw AppError('LC', 'งวดนี้ชำระผ่าน LC ธนาคารจ่ายตามเอกสาร ไม่ต้องตั้งเบิกในระบบนี้');
      /* ตั้งเรื่องได้จากยังไม่ตั้ง หรือจากที่ถูกตีกลับมาให้แก้
         ถ้าตีกลับแล้วส่งใหม่ไม่ได้ คนจะไปส่งกันนอกระบบแทน */
      if (['PENDING', 'REJECTED'].indexOf(String(p.status)) < 0)
        throw AppError('BAD_STATUS',
          'งวดนี้อยู่สถานะ "' + (PAY_ST[p.status] || {}).t + '" ตั้งเรื่องซ้ำไม่ได้');
      var isResubmit = String(p.status) === 'REJECTED';

      var amt = Num.parse(data.amount);
      if (amt === null || amt <= 0) throw AppError('BAD_AMOUNT', 'ยอดที่ขอต้องเป็นตัวเลขมากกว่า 0');
      if (!String(data.billNo || '').trim())
        throw AppError('NEED_BILL', 'ต้องระบุเลขเอกสารเรียกเก็บของงวดนี้');

      /* จ่ายซ้ำด้วยใบเรียกเก็บใบเดิม — ตรวจที่เซิร์ฟเวอร์เพราะเป็นเรื่องเงิน
         ตรวจก่อนเพดานยอด เพราะใบซ้ำมักทำให้ยอดคงเหลือหมดไปแล้วด้วย
         ถ้าตอบว่า "เกินยอดคงเหลือ" คนกรอกจะไปแก้ยอดให้น้อยลง แทนที่จะรู้ว่าหยิบใบผิด */
      var dupe = Repo.where(SHEETS.PAYMENTS, function (x) {
        return String(x.deal_no).trim() === String(dealNo).trim() &&
               Number(x.seq) !== Number(seq) &&
               String(x.bill_no || '').trim().toLowerCase() ===
                 String(data.billNo).trim().toLowerCase() &&
               ['VOID', 'CANCELLED'].indexOf(String(x.status)) < 0;
      });
      if (dupe.length)
        throw AppError('DUP_BILL',
          'เอกสาร ' + data.billNo + ' ถูกใช้ตั้งเบิกในงวดที่ ' + dupe[0].seq + ' แล้ว');

      /* เพดานที่ 1 — ยอดคงเหลือของใบนี้
         พิมพ์เลขศูนย์เกินมาตัวเดียวแล้วไม่มีอะไรทัก คือวิธีที่เงินออกเกิน
         ตัวอย่างที่ใช้นำเสนอมีการตรวจข้อนี้ (S2) แต่ตอนย้ายมาระบบจริงตกหล่นไป */
      var remain = self.remainOf_(dealNo, seq);
      if (amt > remain + 1)
        throw AppError('OVER_PO',
          'ยอดที่ขอ ' + Num.money(amt) + ' เกินยอดคงเหลือของใบนี้ (' + Num.money(remain) + ')');

      /* เพดานที่ 2 — ยอดในเอกสารเรียกเก็บของงวดนั้น (S11) */
      var bamt = Num.parse(data.billAmt);
      if (bamt !== null && bamt > 0 && amt > bamt + 1)
        throw AppError('OVER_BILL',
          'ยอดที่ขอ ' + Num.money(amt) + ' เกินยอดในเอกสารเรียกเก็บ (' + Num.money(bamt) + ')');

      // ส่งใหม่ให้ใช้เลขคำขอเดิม จะได้ตามเรื่องเดียวกันต่อได้ ไม่ใช่เรื่องใหม่
      var reqNo = isResubmit && p.req_no ? String(p.req_no)
                                        : Repo.nextNo('PRQ', SHEETS.PAYMENTS, 'req_no');
      var r = Repo.updateBy2(SHEETS.PAYMENTS, 'deal_no', dealNo, 'seq', seq, {
        status: 'REQUESTED', amount: amt, req_no: reqNo, req_by: me.email,
        req_at: new Date(), bill_no: data.billNo, bill_kind: data.billKind || '',
        bill_amt: Num.parse(data.billAmt) || '', due: data.due || p.due,
        chk_by: '', chk_at: ''            // ส่งใหม่ต้องให้บัญชีตรวจใหม่
      });
      History.log(me.email,
        (isResubmit ? 'แก้แล้วส่งใหม่ งวดที่ ' : 'ตั้งเรื่องขอจ่ายงวดที่ ') + seq + ' ' +
        bahtIn_(amt) + ' ตาม ' + data.billNo, 'Payments', dealNo, r.before, r.after);
      Notify.payRequested(dealNo, seq, reqNo, amt, me, isResubmit);
      return {reqNo: reqNo, resubmit: isResubmit};
    });
  },

  /**
   * บัญชีตรวจเอกสารของคำขอ — ด่านก่อนถึงหัวหน้าบัญชี
   * ตรวจว่าเอกสารเรียกเก็บถูกต้องครบถ้วนไหม ก่อนกินเวลาหัวหน้า
   */
  checkPayment: function (me, dealNo, seq, note) {
    Auth.require(me, 'pay.check');
    var self = this;
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      var p = self.payment_(dealNo, seq);
      if (String(p.status) !== 'REQUESTED')
        throw AppError('BAD_STATUS',
          'งวดนี้อยู่สถานะ "' + (PAY_ST[p.status] || {}).t + '" ตรวจสอบไม่ได้');

      // ผู้ตรวจต้องไม่ใช่ผู้ตั้งเรื่อง — ตรวจงานตัวเองไม่ใช่การตรวจ
      if (String(p.req_by).trim().toLowerCase() === me.email)
        throw AppError('SOD', 'คุณเป็นผู้ตั้งเรื่องงวดนี้เอง จะตรวจสอบเองไม่ได้');

      var r = Repo.updateBy2(SHEETS.PAYMENTS, 'deal_no', dealNo, 'seq', seq, {
        status: 'CHECKED', chk_by: me.email, chk_at: new Date(),
        note: note || p.note || ''
      });
      History.log(me.email, 'บัญชีตรวจเอกสารงวดที่ ' + seq + ' ผ่าน' +
        (note ? ' — ' + note : ''), 'Payments', dealNo, r.before, r.after);
      Notify.payChecked(dealNo, seq, p.req_no, me);
      return {ok: true};
    });
  },

  /**
   * ตีกลับคำขอพร้อมเหตุผล — ใช้ได้ทั้งด่านตรวจของบัญชีและด่านอนุมัติของหัวหน้า
   * บังคับให้เขียนเหตุผล เพราะ "ตีกลับเฉย ๆ" ทำให้ผู้ขอต้องเดาว่าต้องแก้อะไร
   * แล้วก็จะไปถามกันในไลน์อยู่ดี ซึ่งคือปัญหาที่ระบบนี้ตั้งใจแก้
   */
  rejectPayment: function (me, dealNo, seq, reason) {
    Auth.require(me, 'pay.reject');
    var self = this;
    var why = String(reason || '').trim();
    if (why.length < 5)
      throw AppError('NEED_REASON',
        'ต้องเขียนเหตุผลที่ตีกลับอย่างน้อย 5 ตัวอักษร — ผู้ขอจะได้รู้ว่าต้องแก้อะไร');

    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      var p = self.payment_(dealNo, seq);
      if (['REQUESTED', 'CHECKED'].indexOf(String(p.status)) < 0)
        throw AppError('BAD_STATUS',
          'งวดนี้อยู่สถานะ "' + (PAY_ST[p.status] || {}).t + '" ตีกลับไม่ได้');

      var r = Repo.updateBy2(SHEETS.PAYMENTS, 'deal_no', dealNo, 'seq', seq, {
        status: 'REJECTED', rej_by: me.email, rej_at: new Date(), rej_note: why,
        rej_count: (Num.parse(p.rej_count) || 0) + 1
      });
      History.log(me.email, 'ตีกลับคำขอจ่ายงวดที่ ' + seq + ' — ' + why,
        'Payments', dealNo, r.before, r.after);
      Notify.payRejected(dealNo, seq, p.req_no, why, me, p.req_by);
      return {ok: true};
    });
  },

  /** อนุมัติจ่าย — ต้องผ่านการตรวจของบัญชีก่อน และผู้อนุมัติต้องไม่ใช่ผู้ขอ/ผู้ตรวจ */
  approvePayment: function (me, dealNo, seq) {
    Auth.require(me, 'pay.approve');
    var self = this;
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      var p = self.payment_(dealNo, seq);
      if (String(p.status) === 'REQUESTED')
        throw AppError('NEED_CHECK',
          'งวดนี้ยังไม่ผ่านการตรวจของบัญชี — ให้บัญชีตรวจเอกสารก่อน');
      if (String(p.status) !== 'CHECKED')
        throw AppError('BAD_STATUS',
          'งวดนี้อยู่สถานะ "' + (PAY_ST[p.status] || {}).t + '" อนุมัติไม่ได้');

      // P12 — คนขอกับคนอนุมัติต้องไม่ใช่คนเดียวกัน เทียบด้วยอีเมลจริง
      if (String(p.req_by).trim().toLowerCase() === me.email)
        throw AppError('SOD',
          'คุณเป็นผู้ตั้งเรื่องงวดนี้เอง จะอนุมัติเองไม่ได้ — ต้องให้' +
          ROLES[PAY_APPROVER].name + 'คนอื่นอนุมัติ');
      // ผู้ตรวจกับผู้อนุมัติก็ต้องคนละคน ไม่งั้นด่านตรวจกับด่านอนุมัติเป็นด่านเดียวกัน
      if (String(p.chk_by).trim().toLowerCase() === me.email)
        throw AppError('SOD', 'คุณเป็นผู้ตรวจเอกสารงวดนี้เอง จะอนุมัติเองไม่ได้');

      var r = Repo.updateBy2(SHEETS.PAYMENTS, 'deal_no', dealNo, 'seq', seq, {
        status: 'APPROVED', apv_by: me.email, apv_at: new Date()
      });
      History.log(me.email, 'อนุมัติ ' + p.req_no + ' งวดที่ ' + seq + ' ' +
        bahtIn_(Num.parse(p.amount) || 0), 'Payments', dealNo, r.before, r.after);
      Notify.payApproved(dealNo, seq, p.req_no, me);
      return {ok: true};
    });
  },

  /** บันทึกการจ่าย — ผู้บันทึกต้องไม่ใช่ผู้อนุมัติ */
  recordPayment: function (me, dealNo, seq, data) {
    Auth.require(me, 'pay.record');
    var self = this;
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      var p = self.payment_(dealNo, seq);
      if (String(p.status) !== 'APPROVED')
        throw AppError('BAD_STATUS', 'งวดนี้ยังไม่ได้รับอนุมัติ บันทึกจ่ายไม่ได้');

      // P13 — ผู้อนุมัติบันทึกการจ่ายเองไม่ได้ ผิดหลักแยกหน้าที่ระดับคน
      if (String(p.apv_by).trim().toLowerCase() === me.email)
        throw AppError('SOD',
          'คุณเป็นผู้อนุมัติงวดนี้เอง จะบันทึกการจ่ายเองไม่ได้ — ต้องให้บัญชีคนอื่นบันทึก');

      var paid = Num.parse(data.paidAmt);
      if (paid === null || paid <= 0) throw AppError('BAD_AMOUNT', 'ยอดที่จ่ายจริงไม่ถูกต้อง');
      if (!String(data.ref || '').trim())
        throw AppError('NEED_REF', 'ต้องระบุเลขอ้างอิงจากธนาคาร');
      if (!data.slipFileId)
        throw AppError('NEED_SLIP', 'ต้องแนบสลิปก่อนบันทึกการจ่าย');

      var r = Repo.updateBy2(SHEETS.PAYMENTS, 'deal_no', dealNo, 'seq', seq, {
        status: 'PAID', paid_by: me.email, paid_at: new Date(),
        method: data.method || '', bank: data.bank || '', ref: data.ref,
        wht_type: data.whtType || 'GOODS', wht: Num.parse(data.wht) || 0,
        fee: Num.parse(data.fee) || 0, fee_by: data.feeBy || 'OUR',
        paid_amt: paid, slip_file_id: data.slipFileId, note: data.note || ''
      });
      History.log(me.email, 'บันทึกจ่ายงวดที่ ' + seq + ' ' + bahtIn_(paid) +
        ' · อ้างอิง ' + data.ref, 'Payments', dealNo, r.before, r.after);
      Notify.payPaid(dealNo, seq, paid, me);
      return {ok: true};
    });
  },

  /** ยอดคงเหลือของใบ = มูลค่าใบ − งวดอื่นที่กันไว้แล้ว (ขอ/ตรวจ/อนุมัติ/จ่าย/LC) */
  remainOf_: function (dealNo, exceptSeq) {
    var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo) || {};
    var total = Num.parse(d.amount) || 0;
    var used = 0;
    Repo.where(SHEETS.PAYMENTS, function (x) {
      return String(x.deal_no).trim() === String(dealNo).trim();
    }).forEach(function (x) {
      if (Number(x.seq) === Number(exceptSeq)) return;
      if (['VOID', 'CANCELLED', 'REJECTED', 'PENDING'].indexOf(String(x.status)) >= 0) return;
      used += Num.parse(x.status === 'PAID' ? (x.paid_amt || x.amount) : x.amount) || 0;
    });
    return Math.round((total - used) * 100) / 100;
  },

  /** ค่าที่ทุกขั้นส่งต่อกันมา รวมเป็นก้อนเดียว (ไม่ตัดอะไรออก — ใช้ภายในเท่านั้น) */
  handoffAll_: function (dealNo) {
    var flat = {};
    Repo.where(SHEETS.HANDOFF, function (h) {
      return String(h.deal_no).trim() === String(dealNo).trim();
    }).forEach(function (h) {
      var o = Json.parse(h.payload_json, {});
      Object.keys(o).forEach(function (k) { flat[k] = o[k]; });
    });
    return flat;
  },

  /**
   * ส่วนต่างจำนวนของใบนี้ — เทียบจำนวนที่รับเข้าคลังจริงกับจำนวนตามใบแจ้งหนี้
   * ฝั่งอาหารรับเกินรับขาดได้เป็นปกติ ระบบไม่ตัดสินว่าผิด แต่ต้องทำให้เห็น
   */
  qtyVarianceOf_: function (dealNo) {
    var h = this.handoffAll_(dealNo);
    if (!h.qtyIn || !h.invQty) return {ok: false, why: 'ยังไม่มีจำนวนให้เทียบ'};
    return qtyDiff(h.qtyIn, h.invQty);
  },

  payment_: function (dealNo, seq) {
    var hit = Repo.where(SHEETS.PAYMENTS, function (x) {
      return String(x.deal_no).trim() === String(dealNo).trim() &&
             Number(x.seq) === Number(seq);
    });
    if (!hit.length) throw AppError('NOT_FOUND', 'ไม่พบงวดที่ ' + seq + ' ของ ' + dealNo);
    return hit[0];
  },

  /**
   * ยืนยันจบ PO ทั้งที่รับของไม่ครบ
   * ใช้เมื่อผู้ขายส่งไม่ครบแล้วตกลงกันว่าไม่ส่งเพิ่ม — ปิดใบไปเลย
   * บังคับเขียนเหตุผลและจดชื่อคนตัดสินใจ เพราะนี่คือการยอมรับของที่ขาด
   */
  confirmShortClose: function (me, dealNo, reason) {
    Auth.require(me, 'deal.closeshort');
    var self = this;
    var why = String(reason || '').trim();
    if (why.length < 5)
      throw AppError('NEED_REASON',
        'ต้องเขียนเหตุผลที่จบ PO ทั้งที่รับไม่ครบ อย่างน้อย 5 ตัวอักษร');
    return withLock_(function () {
      var d = Repo.findBy(SHEETS.DEALS, 'deal_no', dealNo);
      if (!d) throw AppError('NOT_FOUND', 'ไม่พบรายการ ' + dealNo);
      self.assertEditable_(d);
      var vr = self.qtyVarianceOf_(dealNo);
      if (!vr.ok)
        throw AppError('NO_VARIANCE', 'เทียบจำนวนไม่ได้: ' + vr.why);
      if (!vr.short)
        throw AppError('NOT_SHORT', 'ใบนี้ไม่ได้รับของขาด ไม่ต้องยืนยัน');

      var r = Repo.update(SHEETS.DEALS, 'deal_no', dealNo, {
        short_closed_by: me.email, short_closed_at: new Date(),
        short_note: why, short_qty: vr.diff + ' ' + vr.unit
      });
      History.log(me.email, 'ยืนยันจบ PO ทั้งที่รับของขาด ' +
        Math.abs(vr.diff) + ' ' + vr.unit + ' — ' + why, 'Deals', dealNo, r.before, r.after);
      Notify.shortClose(dealNo, vr, why, me);
      return {ok: true, diff: vr.diff, unit: vr.unit};
    });
  },

  /* ---------- ความเห็นจากผู้ใช้ — หัวใจของช่วงทดลอง ---------- */
  sendFeedback: function (me, data) {
    Auth.require(me, 'feedback.send');
    var msg = String(data.message || '').trim();
    if (msg.length < 5)
      throw AppError('TOO_SHORT', 'ช่วยเขียนอธิบายสั้น ๆ ว่าติดตรงไหน อย่างน้อย 5 ตัวอักษร');
    return withLock_(function () {
      var id = Repo.nextNo('FB', SHEETS.FEEDBACK, 'fb_id');
      Repo.insert(SHEETS.FEEDBACK, {
        fb_id: id, created_at: new Date(), who: me.email, dept: me.dept,
        severity: data.severity || 'SUGGEST', page: data.page || '',
        deal_no: data.dealNo || '', message: msg, status: 'NEW'
      });
      Notify.feedback(id, me, data.severity || 'SUGGEST', msg, data.page);
      return {id: id};
    });
  }
};

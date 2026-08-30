/**
 * Intake.gs — สร้างรายการจริงจากไฟล์ Costing ของ SAP
 * ==========================================================================
 * เชื่อม SapCostingImport.gs (ตัวอ่านไฟล์) เข้ากับตาราง Deals/Payments (ตัวระบบจริง)
 * อยู่โปรเจกต์เดียวกันแล้วจึงเรียกกันตรง ๆ ไม่ต้องยิง HTTP ไม่ต้องมีกุญแจ
 *
 * กันซ้ำสองชั้น
 *   1. ลายนิ้วมือแถว (สาย+PO+รายการ+ยอด+วันครบกำหนด) — ไฟล์รอบใหม่เรียงแถวไม่เหมือนเดิม
 *      จึงห้ามใช้เลขแถวเป็นตัวระบุ
 *   2. เลขรายการ (deal_no) ซ้ำ = ข้าม
 */

/** เรียกจากเมนู — อ่านไฟล์ Costing ทุกสาย แล้วสร้างรายการที่ยังไม่เคยเข้าระบบ */
function importFromCosting() {
  var ui = SpreadsheetApp.getUi();
  var src = readAllSources_();
  if (!src.ok) { ui.alert('นำเข้าไม่ได้\n\n' + src.msg); return; }

  var res = safely_('นำเข้าจาก SAP Costing', function () {
    var me = Auth.me();
    Auth.require(me, 'sap.import');
    return Intake.run(me, src.rows);
  });
  if (!res.ok) { ui.alert('นำเข้าไม่สำเร็จ\n\n' + res.error); return; }

  var d = res.data;
  ui.alert('นำเข้าเรียบร้อย\n\n' +
    'อ่านจากไฟล์: ' + src.rows.length + ' แถว\n' +
    'สร้างรายการใหม่: ' + d.created + '\n' +
    'มีอยู่แล้ว ข้ามไป: ' + d.skipped + '\n' +
    (d.problems.length ? '\nข้อมูลไม่ครบ ' + d.problems.length + ' แถว:\n' +
       d.problems.slice(0, 10).join('\n') : '') +
    (src.problems.length ? '\n\nหมายเหตุจากไฟล์:\n' + src.problems.join('\n') : '') +
    '\n\nรายการใหม่ยัง *ไม่* อยู่ในช่วงทดลอง — เพิ่มเลขที่ต้องการลงแท็บ Pilot_Scope ก่อน');
}

var Intake = {
  run: function (me, rows) {
    return withLock_(function () {
      var have = {}, haveNo = {};
      Repo.readAll(SHEETS.DEALS).forEach(function (d) {
        if (d.fingerprint) have[String(d.fingerprint)] = true;
        haveNo[String(d.deal_no).trim()] = true;
      });

      var created = 0, skipped = 0, problems = [];
      var newDeals = [], newPays = [], newStages = [];
      var now = new Date();

      rows.forEach(function (r) {
        var fp = fingerprint_(r);
        var no = String(r['PO Number'] || '').trim();
        if (!no) { problems.push('(ไม่มีเลข PO) ' + (r.Supplier || '')); return; }
        if (have[fp] || haveNo[no]) { skipped++; return; }

        var amt = Num.parse(r.Price);
        if (amt === null) {
          // ยอดอ่านไม่ออกต้องบอก ไม่ใช่ตั้งเป็น 0 เงียบ ๆ แล้วให้คนไปเจอทีหลังตอนตั้งเบิก
          problems.push(no + ': อ่านยอดเงินไม่ได้ ("' + r.Price + '")');
          return;
        }

        var mod = r._module || 'FOOD';
        var term = r['PO Payment Term'] || 'UNKNOWN';
        var tp = termPlan(term);
        var deal = {
          deal_no: no, entry: 'PO', module: mod, supplier: r.Supplier || '',
          item: r._item || '', amount: amt, currency: r.Currency || 'THB',
          payment_term: term, term_name: tp.n, due_date: r['Due Date'] || '',
          stage: 12, status: 'ACTIVE', owner_email: '',
          created_at: now, created_by: me.email, updated_at: now, fingerprint: fp
        };
        /* เริ่มที่ขั้น "รับใบแจ้งหนี้" (12) โดยตั้งใจ
           ไฟล์ Costing คือรายการที่ SAP ออก PO ไปแล้วและกำลังรอจ่าย
           ไม่ใช่รายการที่เพิ่งเริ่มขอราคา — เริ่มที่ขั้น 0 จะให้คนเดินย้อนขั้นที่ทำไปแล้ว */

        newDeals.push(deal);
        haveNo[no] = true;
        have[fp] = true;

        buildPayments(amt, term, r['Due Date']).forEach(function (p) {
          newPays.push({
            deal_no: no, seq: p.seq, type: p.type, pct: p.pct, amount: p.amount,
            due: p.due, status: p.status, is_lc: p.lc ? 'TRUE' : 'FALSE', note: p.note
          });
        });
        newStages.push({
          deal_no: no, seq: 12, stage_code: STAGES[12].c, owner_dept: STAGES[12].o,
          entered_at: now, sla_hours: STAGES[12].sla
        });
        created++;
      });

      // เขียนทีเดียวเป็นก้อน — เขียนทีละแถวช้าและมีโอกาสค้างกลางทางจนได้ข้อมูลครึ่ง ๆ
      Repo.insertMany(SHEETS.DEALS, newDeals);
      Repo.insertMany(SHEETS.PAYMENTS, newPays);
      Repo.insertMany(SHEETS.STAGES, newStages);
      newDeals.forEach(function (d) {
        History.log(me.email, 'นำเข้าจากไฟล์ Costing ของ SAP', 'Deals', d.deal_no, null,
          {supplier: d.supplier, term: d.term_name});
      });
      return {created: created, skipped: skipped, problems: problems};
    });
  }
};

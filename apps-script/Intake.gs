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
    '\n\nรายการใหม่เริ่มที่ขั้น "' + STAGES[d.startStage].n + '" — เจ้าของขั้นคือ' +
    ROLES[STAGES[d.startStage].o].name + '\n' +
    (d.changed.length
      ? '\n⚠ PO ที่มีอยู่แล้วแต่ยอดในไฟล์ไม่ตรงกับในระบบ ' + d.changed.length + ' ใบ:\n' +
        d.changed.slice(0, 10).map(function (x) { return '   · ' + x; }).join('\n') +
        '\n   ระบบไม่แก้ยอดให้เอง — ตรวจกับ SAP แล้วแก้ในแท็บ Deals เองถ้าจำเป็น\n'
      : '') +
    (d.inProgress.length
      ? '\n· PO ที่ข้ามเพราะดำเนินเอกสารไปแล้ว ' + d.inProgress.length + ' ใบ:\n' +
        d.inProgress.slice(0, 10).map(function (x) { return '   · ' + x; }).join('\n') + '\n'
      : '') +
    (Object.keys(d.noOwner).length
      ? '\n⚠ กลุ่มที่ยังไม่ได้ระบุเจ้าของงานในแท็บ Assignments:\n' +
        Object.keys(d.noOwner).map(function (g) {
          return '   · ' + ((MODULES[g] && MODULES[g].n) || g) + ' — ' + d.noOwner[g] + ' ใบ';
        }).join('\n') + '\n   รายการเหล่านี้จะแจ้งเตือนทั้งแผนกแทนการแจ้งเจ้าของคนเดียว\n'
      : '') +
    (d.skippedDocs.length
      ? '\n⚠ เอกสารที่จะไม่มีใครแนบ เพราะข้ามขั้นนั้นไปแล้ว:\n' +
        d.skippedDocs.map(function (x) { return '   · ' + x.n; }).join('\n') +
        '\n   ถ้าจำเป็นต้องเก็บ ให้ลด IMPORT_START_STAGE ในแท็บ Config\n'
      : '') +
    '\nรายการใหม่ยัง *ไม่* อยู่ในช่วงทดลอง — เพิ่มเลขที่ต้องการลงแท็บ Pilot_Scope ก่อน');
}

var Intake = {
  run: function (me, rows) {
    /* รายการที่นำเข้ามาต้องเริ่มที่ขั้นที่ "จัดซื้อแนบ PO ที่เซ็นแล้ว" (ขั้นที่ 8)
       ไม่ใช่ขั้นรับใบแจ้งหนี้

       รอบแรกผมตั้งไว้ที่ขั้นรับใบแจ้งหนี้ ด้วยเหตุผลว่าไฟล์ Costing คือ PO ที่ SAP
       ออกไปแล้วและกำลังรอจ่าย — ซึ่งจริงในแง่ของ SAP แต่ผิดในแง่ของระบบนี้
       เพราะระบบนี้มีไว้เก็บเอกสาร การข้ามไปขั้น 12 ทำให้ไม่มีใครแนบเอกสาร 4 ใบนี้เลย
       PI · PO ที่เซ็นครบ · ผลตรวจรับ QC · ใบรับสินค้า
       แล้วตอนตรวจ 3 ทางก่อนปิดบัญชีจะไม่มี PO ให้เทียบ

       ปรับได้ที่แท็บ Config คีย์ IMPORT_START_STAGE โดยไม่ต้องแก้โค้ด */
    var startStage = Config.num('IMPORT_START_STAGE', 8);
    if (!STAGES[startStage])
      throw AppError('BAD_CONFIG',
        'ค่า IMPORT_START_STAGE = ' + startStage + ' ไม่ใช่ขั้นที่มีอยู่จริง (0-' +
        (STAGES.length - 1) + ')');

    /* เริ่มกลางทางแปลว่าเอกสารของขั้นก่อนหน้าจะไม่มีใครแนบ
       ต้องบอกให้เห็นตอนนำเข้า ไม่ใช่ไปเจอตอนตรวจ 3 ทางแล้วปิดบัญชีไม่ได้ */
    var skippedDocs = DOCS.filter(function (d) { return d.req && d.at < startStage; });

    /* เจ้าของงานรายใบ — แบ่งตามกลุ่มสินค้าตามที่ทีมทำงานกันจริง
       ตาราง Assignments: กลุ่ม → อีเมลจัดซื้อที่ดูแลกลุ่มนั้น
       ไม่มีในตาราง = ปล่อยว่าง แล้วแจ้งทั้งแผนกแทน ไม่ใช่เดาว่าเป็นของใคร */
    var ownerOfGroup = {};
    Repo.readAll(SHEETS.ASSIGN).forEach(function (a) {
      var g = String(a.group_code || '').trim().toUpperCase();
      var e = String(a.sr_email || '').trim().toLowerCase();
      if (g && e) ownerOfGroup[g] = e;
    });
    var noOwner = {};

    return withLock_(function () {
      var have = {}, haveNo = {};
      Repo.readAll(SHEETS.DEALS).forEach(function (d) {
        if (d.fingerprint) have[String(d.fingerprint)] = true;
        haveNo[String(d.deal_no).trim()] = d;      // เก็บใบเดิมไว้เทียบ ไม่ใช่แค่ true
      });
      var changed = [], inProgress = [];

      var created = 0, skipped = 0, problems = [];
      var newDeals = [], newPays = [], newStages = [];
      var now = new Date();

      rows.forEach(function (r) {
        var fp = fingerprint_(r);
        var no = String(r['PO Number'] || '').trim();
        if (!no) { problems.push('(ไม่มีเลข PO) ' + (r.Supplier || '')); return; }

        var amt = Num.parse(r.Price);
        if (amt === null) {
          // ยอดอ่านไม่ออกต้องบอก ไม่ใช่ตั้งเป็น 0 เงียบ ๆ แล้วให้คนไปเจอทีหลังตอนตั้งเบิก
          problems.push(no + ': อ่านยอดเงินไม่ได้ ("' + r.Price + '")');
          return;
        }

        /* PO ที่อยู่ในระบบแล้วต้องไม่ขึ้นซ้ำ — แต่ต้องบอกว่าทำไมถึงข้าม
           กรณีอันตรายคือ SAP ส่งไฟล์ใหม่ที่ยอดของ PO เดิม *เปลี่ยนไป*
           ลายนิ้วมือจะไม่ตรงแต่เลข PO ตรง ถ้าข้ามเงียบ ๆ ระบบจะยังถือยอดเก่า
           แล้วตั้งเบิกตามยอดที่ไม่ตรงกับ SAP โดยไม่มีใครรู้
           (ต้องอยู่หลังอ่านยอด ไม่งั้นเทียบกับค่าที่ยังไม่มี) */
        var prev = haveNo[no];
        if (prev) {
          var prevAmt = Num.parse(prev.amount);
          if (prevAmt !== null && Math.abs(prevAmt - amt) > 0.5)
            changed.push(no + ': ในระบบ ' + Num.money(prevAmt) + ' · ในไฟล์ ' + Num.money(amt));
          if (String(prev.status) === 'ACTIVE')
            inProgress.push(no + ' — ค้างที่ขั้น ' +
              ((STAGES[Number(prev.stage)] || {}).n || prev.stage));
          skipped++;
          return;
        }
        if (have[fp]) { skipped++; return; }

        var mod = r._module || 'FOOD';
        var term = r['PO Payment Term'] || 'UNKNOWN';
        var tp = termPlan(term);
        var deal = {
          deal_no: no, entry: 'PO', module: mod, supplier: r.Supplier || '',
          item: r._item || '', amount: amt, currency: r.Currency || 'THB',
          payment_term: term, term_name: tp.n, due_date: r['Due Date'] || '',
          stage: startStage, status: 'ACTIVE', owner_email: ownerOfGroup[mod] || '',
          created_at: now, created_by: me.email, updated_at: now, fingerprint: fp
        };

        if (!ownerOfGroup[mod]) noOwner[mod] = (noOwner[mod] || 0) + 1;
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
          deal_no: no, seq: startStage, stage_code: STAGES[startStage].c,
          owner_dept: STAGES[startStage].o, entered_at: now,
          sla_hours: STAGES[startStage].sla
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
      return {created: created, skipped: skipped, problems: problems,
              startStage: startStage, skippedDocs: skippedDocs, noOwner: noOwner,
              changed: changed, inProgress: inProgress};
    });
  }
};

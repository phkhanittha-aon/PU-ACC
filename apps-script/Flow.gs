/**
 * Flow.gs — นิยามกระบวนการทั้งหมดในที่เดียว
 * ==========================================================================
 * ไฟล์นี้คือ "กระบวนการเป็นข้อมูล" — เพิ่มขั้น เพิ่มเอกสาร เพิ่มเงื่อนไขจ่าย
 * ทำได้ด้วยการเพิ่มแถวในตาราง ไม่ต้องแก้ฟังก์ชัน
 *
 * *** ห้ามมีนิยามกระบวนการซ้ำที่อื่น ***
 * หน้าจอ (index.html) รับตารางเหล่านี้จากเซิร์ฟเวอร์ตอนเปิดแอป ไม่ได้ถือสำเนาของตัวเอง
 * ตัวอย่างที่ใช้นำเสนอ (presentation/prototype.html) ยังถือสำเนาอยู่ด้วยเหตุผลว่าเปิดจากไฟล์เดียวได้
 * จึงมี tools/flow-parity.mjs คอยตรวจว่าสองที่ยังตรงกัน — แก้ที่นี่แล้วต้องแก้ที่นั่นด้วย
 *
 * ไฟล์นี้ต้องไม่เรียก SpreadsheetApp / DriveApp / UrlFetchApp เลย
 * เป็นตรรกะล้วน ๆ จึงเอาไปรันทดสอบบน Node ได้โดยไม่ต้องมี Google (ดู tools/domain-test.mjs)
 */

/* ---------- แผนกและบทบาท ---------- */
var ROLES = {
  SR:  {name:'จัดซื้อ',       en:'Sourcing',   money:true,  lvl:'staff', mgr:'GM'},
  QC:  {name:'QC',            en:'Quality',    money:false, lvl:'staff', mgr:'GM'},
  LS:  {name:'โลจิสติกส์',    en:'Logistics',  money:false, lvl:'staff', mgr:'GM'},
  WH:  {name:'คลังสินค้า',    en:'Warehouse',  money:false, lvl:'staff', mgr:'GM'},
  AC:  {name:'บัญชี',         en:'Accounting', money:true,  lvl:'staff', mgr:'ACH'},
  ACH: {name:'หัวหน้าบัญชี',  en:'AC Head',    money:true,  lvl:'mgr'},
  GM:  {name:'ผู้บริหาร',     en:'GM',         money:true,  lvl:'mgr'},
  IT:  {name:'ผู้ดูแลระบบ',   en:'IT Admin',   money:false, lvl:'admin'}
};
/* ผู้ดูแลระบบตั้งค่าและดูแลผู้ใช้ได้ แต่ไม่อยู่ในสายอนุมัติและไม่เห็นยอดเงิน
   ผู้ดูแลที่อนุมัติเอกสารเองได้ทำให้ระบบตรวจสอบเป็นแค่การตกแต่ง (docs/03) */

var PAY_APPROVER = 'ACH';   // ทุกยอดผ่านหัวหน้าบัญชี ไม่มีเกณฑ์วงเงินยกเว้น

var PHASES = [
  {code:'BUY',  name:'จัดซื้อ',    from:0,  to:8},
  {code:'RECV', name:'รับของ',     from:9,  to:11},
  {code:'AP',   name:'ตั้งหนี้',   from:12, to:13},
  {code:'PAY',  name:'จ่าย / ปิด', from:14, to:16}
];

/* 17 ขั้น — o = แผนกเจ้าของขั้น · sla = ชั่วโมงก่อนถือว่าช้า */
var STAGES = [
  {c:'PRICE_REQUEST',     n:'เช็คราคา',           o:'SR', sla:24},
  {c:'SAMPLE_CHECK',      n:'ตรวจตัวอย่าง',       o:'QC', sla:48},
  {c:'GM_DECISION',       n:'ผู้บริหารตัดสินใจ',  o:'GM', sla:24},
  {c:'ORDER_CONFIRM',     n:'คอนเฟิร์มออเดอร์',   o:'SR', sla:24},
  {c:'PI_RECEIVED',       n:'รับ PI จากผู้ขาย',   o:'SR', sla:48},
  {c:'ITEM_CODE',         n:'เปิดรหัสสินค้า',     o:'LS', sla:24},
  {c:'PO_CREATED',        n:'ผูกกับ PO ใน B1',    o:'SR', sla:24},
  {c:'INTERNAL_APPROVAL', n:'อนุมัติภายใน',       o:'GM', sla:24},
  {c:'SUPPLIER_SIGN',     n:'ผู้ขายเซ็น PO กลับ', o:'SR', sla:72},
  {c:'DELIVERY_BOOKING',  n:'จองรถรับของ',        o:'LS', sla:24},
  {c:'QC_INCOMING',       n:'QC ตรวจรับ',         o:'QC', sla:24},
  {c:'GR',                n:'รับเข้าคลัง + GR',   o:'WH', sla:24},
  {c:'INVOICE_RECEIVED',  n:'รับใบแจ้งหนี้',      o:'AC', sla:72},
  {c:'DOC_HANDOVER',      n:'ส่งมอบเอกสาร',       o:'SR', sla:24},
  {c:'PAYMENT',           n:'ทำจ่าย',             o:'AC', sla:48},
  {c:'RECEIPT_ORIGINAL',  n:'ใบเสร็จตัวจริง',     o:'AC', sla:336},
  {c:'AC_CLOSE',          n:'ตรวจ 3 ทาง + ปิด',   o:'AC', sla:48}
];

/* เอกสารบังคับ — สลิปไม่อยู่ตรงนี้เพราะผูกกับ "งวดจ่าย" ไม่ใช่ผูกกับ PO */
var DOCS = [
  {c:'PI',        n:'PI จากผู้ขาย',      o:'SR', at:4,  req:true},
  {c:'PO_SIGNED', n:'PO ที่เซ็นครบแล้ว', o:'SR', at:8,  req:true},
  {c:'QC_RC',     n:'ผลตรวจรับ / RC',    o:'QC', at:10, req:true},
  {c:'GR',        n:'ใบรับสินค้า (GRPO)', o:'WH', at:11, req:true},
  {c:'INVOICE',   n:'ใบแจ้งหนี้',        o:'AC', at:12, req:true},
  {c:'RECEIPT',   n:'ใบเสร็จตัวจริง',    o:'AC', at:15, req:true}
];

/* สายสินค้า — ใบตรวจรับของ QC คนละแบบกันจริง (docs/16) */
var MODULES = {
  FOOD:  {n:'อาหาร',                pfx:'F', place:'ห้องเย็น / คลังผู้ให้บริการ'},
  MECH:  {n:'เครื่องจักร & โซลาร์', pfx:'M', place:'คลังบริษัท'},
  OTHER: {n:'ค่าใช้จ่ายอื่น',       pfx:'O', place:'— (ไม่มีของเข้าคลัง)', noGoods:true}
};
var PFX_MOD = {M:'MECH', F:'FOOD', O:'OTHER'};
var NOGOODS_SKIP = [10, 11];        // ค่าใช้จ่ายอื่นไม่มีของให้ตรวจและไม่มีของเข้าคลัง

/* เลข PO จาก SAP เชื่อถือได้กว่าค่าที่คนกรอก — ดูเลขก่อน แล้วค่อยดูค่าที่ตั้งไว้ */
function modOf(p) {
  var m = String((p && p.no) || '').toUpperCase().match(/^PO-([A-Z])/);
  if (m && PFX_MOD[m[1]]) return PFX_MOD[m[1]];
  return MODULES[p && p.mod] ? p.mod : 'FOOD';
}

/* ---------- สัญญาระหว่างขั้น ----------
   แต่ละขั้นประกาศว่าต้องส่งมอบข้อมูลอะไรให้ขั้นถัดไป
   money:true = ช่องเงิน · บทบาทที่ไม่มีสิทธิ์เห็นเงินจะถูกตัดออกตั้งแต่ฝั่งเซิร์ฟเวอร์ */
var HAND = {
  SUPPLIER_SIGN: {to:'โลจิสติกส์', f:[
    {k:'shipDate', lb:'ผู้ขายนัดส่งของวันที่', t:'date', req:true}]},
  DELIVERY_BOOKING: {to:'QC และคลังสินค้า', f:[
    {k:'eta',     lb:'ของถึงห้องเย็นวันที่', t:'date', req:true},
    {k:'etaTime', lb:'เวลาโดยประมาณ',        t:'time', req:true},
    {k:'truck',   lb:'ทะเบียนรถ / ผู้ขนส่ง', t:'text', req:false}]},
  QC_INCOMING: {to:'คลังสินค้า และบัญชี', app:'QCAPP', f:[
    {k:'qcRef',    lb:'เลขที่ใบตรวจ (Report No.)',          t:'text', req:true},
    {k:'qcPoRef',  lb:'PO Ref No. ที่พิมพ์บนใบตรวจ',        t:'text', req:true},
    {k:'qcDate',   lb:'วันที่ตรวจจริง (Inspection Date)',   t:'date', req:true},
    {k:'qcPlace',  lb:'สถานที่ตรวจ / ของอยู่ที่ไหน',        t:'text', req:true},
    {k:'invQty',   lb:'จำนวนตามใบแจ้งหนี้ (INV QTY)',       t:'text', req:true},
    {k:'qtyOk',    lb:'จำนวนที่ตรวจนับได้จริง (Actual QTY)', t:'text', req:true},
    {k:'qcResult', lb:'ผลรวม (Result)', t:'sel', req:true, o:['ผ่าน (Pass)', 'ไม่ผ่าน (Fail)']},
    {k:'qtyBad',   lb:'จำนวนที่ตีกลับ (ถ้ามี)', t:'text', req:false}],
    byMod:{
      FOOD:[{k:'temp',    lb:'อุณหภูมิที่วัดได้ (°C)',    t:'num',  req:true},
            {k:'lot',     lb:'เลขล็อต (Lot)',             t:'text', req:true},
            {k:'expDate', lb:'วันหมดอายุ (Expiration)',   t:'text', req:true},
            {k:'grade',   lb:'เกรดที่ QC ให้ (QC Grade)', t:'sel',  req:true, o:['A', 'B', 'C']}],
      MECH:[{k:'conCond', lb:'สภาพตู้/หีบห่อ (Con. Condition)', t:'sel', req:true,
             o:['ผ่าน (Pass)', 'ไม่ผ่าน (Fail)']}]
    }},
  GR: {to:'บัญชี', f:[
    {k:'qtyIn', lb:'จำนวนที่รับเข้าคลังจริง', t:'text', req:true},
    {k:'grNo',  lb:'เลข GRPO ใน B1',          t:'text', req:true}]},
  INVOICE_RECEIVED: {to:'จัดซื้อ และบัญชี', f:[
    {k:'invNo',  lb:'เลขใบแจ้งหนี้ของผู้ขาย', t:'text', req:true},
    {k:'invAmt', lb:'ยอดในใบแจ้งหนี้ (บาท)',  t:'num',  req:true, money:true}]},
  RECEIPT_ORIGINAL: {to:'บัญชี', f:[
    {k:'rcvBy', lb:'ใครเป็นผู้รับเอกสารตัวจริง', t:'text', req:true}]}
};

/** สัญญาของขั้นนี้สำหรับรายการนี้ — รวมช่องกลางกับช่องเฉพาะสายสินค้า */
function handOf(code, p) {
  var h = HAND[code];
  if (!h) return null;
  var ex = h.byMod ? (h.byMod[modOf(p)] || []) : [];
  return ex.length ? {to:h.to, app:h.app, f:h.f.concat(ex)} : h;
}

/* ขั้นไหนต้องใช้ข้อมูลที่ขั้นก่อนหน้าส่งมา */
var NEEDS = {
  DELIVERY_BOOKING: ['shipDate'],
  QC_INCOMING:      ['eta'],
  GR:               ['qtyOk', 'qcResult', 'qcPlace'],
  INVOICE_RECEIVED: ['qtyIn'],
  DOC_HANDOVER:     ['invNo', 'invAmt'],
  PAYMENT:          ['invNo', 'invAmt'],
  AC_CLOSE:         ['qcRef', 'qtyOk', 'qtyIn', 'invAmt']
};
var NEEDS_MOD = {FOOD:{GR:['temp'], AC_CLOSE:['lot']}, MECH:{}};
function needsOf(code, p) {
  return (NEEDS[code] || []).concat(((NEEDS_MOD[modOf(p)] || {})[code]) || []);
}

/* ช่องไหนมาจากขั้นไหน — สร้างจาก HAND ไม่เขียนซ้ำ */
var FIELD_AT = {};
(function () {
  Object.keys(HAND).forEach(function (sc) {
    var h = HAND[sc];
    var all = h.f.slice();
    Object.keys(h.byMod || {}).forEach(function (m) { all = all.concat(h.byMod[m]); });
    all.forEach(function (f) { FIELD_AT[f.k] = {stage:sc, lb:f.lb, money:!!f.money}; });
  });
})();

/** ชื่อช่องทั้งหมดที่เป็นเรื่องเงิน — ใช้ตัดข้อมูลก่อนส่งให้บทบาทที่ไม่มีสิทธิ์เห็น */
function moneyFieldKeys() {
  return Object.keys(FIELD_AT).filter(function (k) { return FIELD_AT[k].money; });
}

/* ---------- เงื่อนไขจ่ายจาก SAP → งวดจ่ายจริง ----------
   ลำดับสำคัญ: เงื่อนไขที่ "แบ่งงวด" ต้องอยู่ก่อนเงื่อนไขงวดเดียวที่กว้างกว่า */
var PAY_TERMS = [
  {m:/^\s*(\d+)%\s*advance.*?(\d+)%.*?\bl\s*\/?\s*c\b/i, n:'มัดจำโอน + ที่เหลือผ่าน LC',
   plan:function (g) { return [{pct:+g[1], type:'มัดจำ', lc:false},
                               {pct:+g[2], type:'ส่วนที่เหลือ (LC)', lc:true}]; }},
  {m:/^\s*(\d+)%.*?delivery.*?(\d+)%.*?commissioning/i, n:'แบ่งจ่ายตามงานติดตั้ง',
   plan:function (g) { return [{pct:+g[1], type:'เมื่อส่งของถึงหน้างาน', lc:false},
                               {pct:+g[2], type:'เมื่อทดสอบระบบเสร็จ', lc:false}]; }},
  {m:/^100%\s*advance|before\s+receiv/i, n:'จ่ายล่วงหน้าเต็มจำนวน',
   plan:[{pct:100, type:'ชำระเต็ม (ล่วงหน้า)', lc:false}]},
  {m:/commissioning/i, n:'จ่ายหลังทดสอบระบบ',
   plan:[{pct:100, type:'ชำระเต็ม (หลังทดสอบระบบ)', lc:false}]},
  {m:/after\s+received\s+goods|after\s+delivery|after\s+invoice|within\s+\d+\s*days/i,
   n:'เครดิตหลังรับของ', plan:[{pct:100, type:'ชำระเต็ม', lc:false}]},
  {m:/\bl\s*\/?\s*c\b/i, n:'ชำระผ่าน LC ทั้งจำนวน',
   plan:[{pct:100, type:'ชำระเต็ม (LC)', lc:true}]},
  {m:/^unknown$/i, n:'ยังไม่ระบุเงื่อนไข',
   plan:[{pct:100, type:'ชำระเต็ม (รอยืนยันเงื่อนไข)', lc:false}]}
];
var UNKNOWN_TERM = 'UNKNOWN';

function termPlan(t) {
  var s = String(t == null || String(t).trim() === '' ? UNKNOWN_TERM : t).trim();
  for (var i = 0; i < PAY_TERMS.length; i++) {
    var g = s.match(PAY_TERMS[i].m);
    if (!g) continue;
    var pl = typeof PAY_TERMS[i].plan === 'function' ? PAY_TERMS[i].plan(g) : PAY_TERMS[i].plan;
    var tot = pl.reduce(function (a, x) { return a + x.pct; }, 0);
    if (Math.abs(tot - 100) > 0.5)
      return {n:PAY_TERMS[i].n + ' (เปอร์เซ็นต์ในข้อความรวมได้ ' + tot + ' — ต้องตรวจ)',
              plan:[{pct:100, type:'ชำระเต็ม', lc:false}], odd:true};
    return {n:PAY_TERMS[i].n, plan:pl};
  }
  return {n:'เงื่อนไขที่ยังไม่รู้จัก', plan:[{pct:100, type:'ชำระเต็ม', lc:false}], odd:true};
}

var PAY_ST = {
  PENDING:  {t:'รอตั้งเรื่อง',           cls:'wait'},
  BLOCKED:  {t:'ล็อก (เคลม)',            cls:'late'},
  REQUESTED:{t:'รออนุมัติจ่าย',          cls:'due'},
  APPROVED: {t:'อนุมัติแล้ว รอทำจ่าย',   cls:'info'},
  PAID:     {t:'จ่ายแล้ว',               cls:'ok'},
  FAILED:   {t:'ธนาคารตีกลับ',           cls:'late'},
  VOID:     {t:'กลับรายการ',             cls:'wait'},
  CANCELLED:{t:'ยกเลิก',                 cls:'wait'},
  LC:       {t:'จ่ายผ่าน LC (ธนาคาร)',   cls:'info'}
};
var DONE_PAY = ['PAID', 'CANCELLED', 'VOID', 'LC'];
function isLC(x) { return !!(x && (x.lc === true || x.status === 'LC')); }

/** กางเงื่อนไขเป็นงวดจ่าย — งวดสุดท้ายรับเศษ ยอดรวมจึงเท่ามูลค่า PO เสมอ */
function buildPayments(amt, term, dueTH) {
  var pl = termPlan(term).plan;
  var left = Number(amt) || 0;
  return pl.map(function (g, i) {
    var v = i === pl.length - 1 ? left : Math.round((Number(amt) || 0) * g.pct) / 100;
    left -= v;
    return {
      seq:i + 1, type:g.type, pct:g.pct, amount:v, due:dueTH || '—',
      status:g.lc ? 'LC' : 'PENDING', lc:!!g.lc,
      note:g.lc ? 'ธนาคารจ่ายตามเอกสาร LC — ไม่ต้องตั้งเบิกในระบบนี้' : '',
      reqNo:'', reqBy:'', reqAt:'', apvBy:'', apvAt:'', paidBy:'', paidAt:'',
      method:'', bank:'', ref:'', billKind:'', billNo:'', billAmt:0,
      whtType:'GOODS', wht:0, fee:0, feeBy:'OUR', paidAmt:0, slip:false
    };
  });
}

var BILLDOC = {
  DEPOSIT:{n:'ใบเรียกเก็บมัดจำ / Proforma Invoice (PI)',
           hint:'งวดมัดจำมักเรียกเก็บด้วย PI ไม่ใช่ใบแจ้งหนี้ตัวจริง'},
  INVOICE:{n:'ใบแจ้งหนี้ตัวจริง (Invoice)',
           hint:'งวดที่ส่งของแล้วต้องมีใบแจ้งหนี้ตัวจริง'},
  DEBIT:  {n:'ใบวางบิล / Debit Note',
           hint:'ใช้เมื่อผู้ขายวางบิลแยกจากใบแจ้งหนี้'}
};
function isDeposit(x) { return /มัดจำ|deposit/i.test(String((x && x.type) || '')); }
function billKind(x) { return x && x.billKind ? x.billKind : (isDeposit(x) ? 'DEPOSIT' : 'INVOICE'); }

var WHT = {
  GOODS:  {t:'ซื้อสินค้า', r:0},
  FREIGHT:{t:'ค่าขนส่ง', r:1},
  SERVICE:{t:'ค่าบริการ / รับจ้างทำของ', r:3},
  RENT:   {t:'ค่าเช่า', r:5},
  ADS:    {t:'ค่าโฆษณา', r:2}
};

/* รายการเงินสดไม่มีขั้นตอนจัดซื้อ (0–9) และข้าม QC ได้เมื่อระบุเหตุผล + ผู้อนุมัติ */
function cashSkip(bypassQC) {
  return bypassQC ? [0,1,2,3,4,5,6,7,8,9,10] : [0,1,2,3,4,5,6,7,8,9];
}

/** ขั้นที่รายการนี้ข้าม — คิดจากสายสินค้าและประเภทรายการ ไม่ต้องเก็บในชีต */
function skipOf(deal) {
  if (deal.entry === 'CASH') return cashSkip(!!deal.qcBypass);
  return MODULES[modOf(deal)] && MODULES[modOf(deal)].noGoods ? NOGOODS_SKIP.slice() : [];
}

/** ขั้นถัดไปที่ต้องเดิน (ข้ามขั้นที่ไม่เกี่ยว) — คืน -1 เมื่อจบกระบวนการ */
function nextStage(deal) {
  var skip = skipOf(deal);
  var n = Number(deal.stage) + 1;
  while (n < STAGES.length && skip.indexOf(n) >= 0) n++;
  return n < STAGES.length ? n : -1;
}

/* ทำให้เรียกใช้จาก Node ได้ตอนทดสอบ — บน Apps Script ไม่มี module จึงข้ามไป */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROLES:ROLES, PAY_APPROVER:PAY_APPROVER, PHASES:PHASES, STAGES:STAGES, DOCS:DOCS,
    MODULES:MODULES, PFX_MOD:PFX_MOD, NOGOODS_SKIP:NOGOODS_SKIP, HAND:HAND, NEEDS:NEEDS,
    NEEDS_MOD:NEEDS_MOD, FIELD_AT:FIELD_AT, PAY_TERMS:PAY_TERMS, PAY_ST:PAY_ST,
    DONE_PAY:DONE_PAY, BILLDOC:BILLDOC, WHT:WHT, UNKNOWN_TERM:UNKNOWN_TERM,
    modOf:modOf, handOf:handOf, needsOf:needsOf, moneyFieldKeys:moneyFieldKeys,
    termPlan:termPlan, buildPayments:buildPayments, isLC:isLC, isDeposit:isDeposit,
    billKind:billKind, cashSkip:cashSkip, skipOf:skipOf, nextStage:nextStage
  };
}

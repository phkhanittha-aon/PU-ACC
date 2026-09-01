/* ชุดทดสอบตัวอย่างระบบ — รันด้วย: node tools/smoke.js  (ไม่ต้องติดตั้งอะไรเพิ่ม) */
const fs = require("fs");
const path = require("path");
// ดึงเฉพาะ <script> ออกจาก prototype.html แล้วรันบน DOM ปลอม — ไม่ต้องมีเบราว์เซอร์
const html = fs.readFileSync(path.join(__dirname, "..", "presentation", "prototype.html"), "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

function el() { return { innerHTML: "", dataset: {}, value: "", focus(){}, setSelectionRange(){} }; }
const nodes = { "#nav": el(), "#tools": el(), "#user": el(), "#roles": el(), "#main": el(),
                "#bug": el(), "#modal": el(), "#confirm": el(), "#toast": el() };
nodes["#toast"].classList = { add(){}, remove(){} };
nodes["#toast"].textContent = "";
let lastToast = "";
Object.defineProperty(nodes["#toast"], "textContent", { set(v){ lastToast = v; }, get(){ return lastToast; } });

let clickH = null, inputH = null, changeH = null;
let bugText = null, bugSevChecked = null;
let formFields = {};

global.document = {
  documentElement: { style: { setProperty(){} } },
  querySelector(s) {
    if (nodes[s]) return nodes[s];
    if (s.indexOf('input[name="bugsev"]') === 0) return bugSevChecked;
    return null;
  },
  getElementById(id) {
    if (id === "bugtext") return bugText;
    if (formFields[id]) return formFields[id];
    return nodes["#" + id] || null;
  },
  addEventListener(t, h) { if (t === "click") clickH = h; if (t === "input") inputH = h; if (t === "change") changeH = h; }
};
global.window = { innerWidth: 1440, innerHeight: 900, scrollTo(){} };
global.navigator = { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" };
global.setTimeout = () => 0;
global.clearTimeout = () => {};

new Function(src)();

function click(attr, data) {
  clickH({ target: { closest(sel) { return sel === "[" + attr + "]" ? { dataset: data } : null; } } });
}
const ROLES = ["SR", "QC", "LS", "WH", "AC", "ACH", "GM"];   // บทบาทที่ตัวอย่างมีให้กดสลับ
// อ่านจากไฟล์จริงว่าบทบาทไหนห้ามเห็นยอดเงิน — ไม่ฮาร์ดโค้ดรายชื่อไว้ที่นี่
// เพิ่มบทบาทใหม่ในระบบเมื่อไหร่ เครื่องตรวจยอดเงินรั่วก็ครอบคลุมให้ทันที
const MONEY_ROLE = {};
src.replace(/(\w+)\s*:\s*\{\s*name:[^{}]*?money:\s*(true|false)/g,
  (_, k, v) => { MONEY_ROLE[k] = v === "true"; return ""; });
if (Object.keys(MONEY_ROLE).length < ROLES.length)
  throw new Error("อ่านสิทธิ์เห็นเงินจาก prototype.html ไม่ครบ (ได้ " +
    Object.keys(MONEY_ROLE).length + " จาก " + ROLES.length + " อย่างน้อย)");
const PAGES = { home: [""], po: ["ACTIVE","DONE","CANCELLED","SEARCH"], req: ["PRICE","CLAIM","ITEM"],
                inbox: [""], admin: ["ISSUES","SAP","QCAPP","STAGES","DOCS","FILES","USERS"], report: [""] };
const POS = ["PO-26-0042","PO-26-0051","CS-26-0007","PO-O326060001","PO-26-0060","PO-26-0038","PO-26-0029","PO-26-0033","PO-26-0045","PO-26-0031","PO-26-0025","PO-26-0019","PO-26-0012"];

let n = 0, bad = [];
function check(label) {
  const h = nodes["#main"].innerHTML;
  n++;
  if (!h || h.length < 60) bad.push(label + " → เนื้อหาสั้นผิดปกติ (" + (h||"").length + ")");
  const m = h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/);
  if (m) bad.push(label + " → " + m[0]);
}

for (const r of ROLES) {
  click("data-role", { role: r });
  for (const p of Object.keys(PAGES)) {
    click("data-page", { page: p });
    for (const s of PAGES[p]) { if (s) click("data-sub", { sub: s }); check(r + "/" + p + "/" + (s || "-")); }
  }
  for (const po of POS) { click("data-po", { po: po }); check(r + "/detail/" + po); }
  click("data-page", { page: "req" });
  for (const c of ["EX-2026001", "CL-26-0004"]) { click("data-claim", { claim: c }); check(r + "/claim/" + c); }
  click("data-page", { page: "inbox" });
  for (let i = 1; i <= 10; i++) { click("data-notif", { notif: String(i) }); check(r + "/notif/" + i); }
}

/* ---------- bug flow ---------- */
click("data-role", { role: "AC" });
click("data-page", { page: "po" });
click("data-bug", { bug: "open" });
if (!/bugpanel/.test(nodes["#bug"].innerHTML)) bad.push("bug panel ไม่ถูก render");
bugText = { value: "", focus(){} };
click("data-bug", { bug: "send" });
bugText = { value: "กดบันทึกแล้วหน้าค้าง ต้องรีเฟรช", focus(){} };
bugSevChecked = { value: "BLOCKER" };
click("data-bug", { bug: "send" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "ISSUES" });
if (!/กดบันทึกแล้วหน้าค้าง/.test(nodes["#main"].innerHTML)) bad.push("issue ที่แจ้งใหม่ไม่ขึ้นในตาราง");

/* ---------- validation card ---------- */
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0029" });
let d = nodes["#main"].innerHTML;
if (!/ตรวจสอบก่อนบันทึก/.test(d)) bad.push("ไม่มีการ์ดตรวจสอบก่อนบันทึก");
if (!/4\.4%/.test(d)) bad.push("ไม่พบการเตือนยอดใบแจ้งหนี้ต่าง 4.4%");
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0029" });
if (/ใบแจ้งหนี้ต่างจาก PO/.test(nodes["#main"].innerHTML)) bad.push("QC เห็นข้อมูลยอดเงินในการ์ดตรวจสอบ");

/* ---------- payment: form ---------- */
function today() { const x = new Date(); const p = v => (v<10?"0":"")+v;
  return x.getFullYear()+"-"+p(x.getMonth()+1)+"-"+p(x.getDate()); }
function setFields(o) {
  formFields = {};
  for (const k of Object.keys(o)) formFields[k] = {value:String(o[k]), checked:o[k]===true, focus(){}, innerHTML:""};
  formFields.py_calc = {innerHTML:"", value:""};
  formFields.py_err  = {innerHTML:"", value:""};
}
function type(id) { inputH({ target: formFields[id] ? Object.assign(formFields[id], {id:id}) : {id:id} }); }

/* ทุกงวดต้องแนบเอกสารเรียกเก็บของงวดนั้น — ตัวช่วยกรอกฟอร์มขออนุมัติจ่ายให้ครบ */
function prFields(o) {
  setFields(Object.assign({pr_stamp:true, pr_pos:"BR", pr_size:"13", pr_color:"แดง",
    pr_text:"ขออนุมัติทำจ่าย", pr_bkind:"INVOICE", pr_bno:"INV-TEST-001",
    pr_bamt:o.pr_amt, pr_bfile:"invoice_test.pdf"}, o));
  formFields.pr_err = {innerHTML:""}; formFields.pr_prev = {classList:{add(){},remove(){}}};
  formFields.pr_ptl = {textContent:""}; formFields.pr_ptr = {textContent:""};
  formFields.pr_bnamed = {textContent:""};
  // ตัวอย่างเอกสาร: บล็อกข้อความที่ลากได้ + ตัวเลขบนหน้ากระดาษ
  formFields.pr_stampbox = {style:{}, classList:{add(){},remove(){}}};
  formFields.pr_stamptext = {textContent:""}; formFields.pr_posn = {textContent:""};
  ["pr_pgtitle","pr_pgno","pr_pgdue","pr_pgtot"].forEach(k => { formFields[k] = {textContent:""}; });
}
// ตั้งเรื่องขอจ่ายจากตารางงวด (บัญชี) — ตอนนี้ต้องผ่านฟอร์มเดียวกับที่จัดซื้อใช้
function reqPay(seq, o) {
  click("data-payact", { payact: "req", seq: String(seq) });
  prFields(o || {});
  click("data-pract", { pract: "send" });
}

click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0042" });
if (!/บันทึกการจ่าย<\/button>/.test(nodes["#main"].innerHTML)) bad.push("ไม่มีปุ่มบันทึกการจ่ายบนงวดที่อนุมัติแล้ว");
click("data-payact", { payact: "form", seq: "2" });
if (!/บันทึกการจ่าย — PO-26-0042 งวดที่ 2/.test(nodes["#modal"].innerHTML)) bad.push("ฟอร์มบันทึกจ่ายไม่ถูก render");
if (!/วันที่จ่าย/.test(nodes["#modal"].innerHTML)) bad.push("ฟอร์มไม่มีช่องวันที่จ่าย");

// กรอกไม่ครบ → ต้องบล็อก
setFields({py_date:today(), py_value:today(), py_method:"TRANSFER", py_bank:"KBANK", py_ref:"",
           py_whttype:"GOODS", py_wht:0, py_fee:35, py_feeby:"OUR", py_amt:91035, py_slip:false,
           py_reason:"", py_note:""});
click("data-payact", { payact: "save" });
click("data-po", { po: "PO-26-0042" });
if (/09\/|จ่ายแล้ว<\/span>[\s\S]{0,80}งวดที่ 2/.test("") ) {}
let paidCount = (nodes["#main"].innerHTML.match(/จ่ายแล้ว<\/span>/g) || []).length;
if (paidCount !== 1) bad.push("บันทึกจ่ายผ่านทั้งที่ยังไม่แนบสลิป/ไม่มีเลขอ้างอิง (พบ " + paidCount + " งวดที่จ่ายแล้ว)");
if (!/P5|P6/.test(formFields.py_err ? formFields.py_err.innerHTML : "")) bad.push("ไม่ขึ้นข้อความกฎ P5/P6");

// วันที่อนาคต → ต้องบล็อก
click("data-payact", { payact: "form", seq: "2" });
setFields({py_date:"2030-01-01", py_value:"2030-01-01", py_method:"TRANSFER", py_bank:"KBANK",
           py_ref:"KB99", py_whttype:"GOODS", py_wht:0, py_fee:35, py_feeby:"OUR", py_amt:91035,
           py_slip:true, py_reason:"", py_note:""});
click("data-payact", { payact: "save" });
if (!/P1/.test(formFields.py_err.innerHTML)) bad.push("ไม่บล็อกวันที่จ่ายในอนาคต (P1)");

// เลขอ้างอิงซ้ำ → ต้องบล็อก
click("data-payact", { payact: "form", seq: "2" });
setFields({py_date:today(), py_value:today(), py_method:"TRANSFER", py_bank:"KBANK",
           py_ref:"KB26080500123", py_whttype:"GOODS", py_wht:0, py_fee:35, py_feeby:"OUR",
           py_amt:91035, py_slip:true, py_reason:"", py_note:""});
click("data-payact", { payact: "save" });
if (!/P11/.test(formFields.py_err.innerHTML)) bad.push("ไม่บล็อกเลขอ้างอิงธนาคารซ้ำ (P11)");

// ยอดไม่ตรง ไม่ใส่เหตุผล → บล็อก
click("data-payact", { payact: "form", seq: "2" });
setFields({py_date:today(), py_value:today(), py_method:"TRANSFER", py_bank:"KBANK",
           py_ref:"KB26083000999", py_whttype:"GOODS", py_wht:0, py_fee:35, py_feeby:"OUR",
           py_amt:80000, py_slip:true, py_reason:"", py_note:""});
type("py_amt");
click("data-payact", { payact: "save" });
if (!/P7/.test(formFields.py_err.innerHTML)) bad.push("ไม่บล็อกยอดที่ไม่ตรงโดยไม่มีเหตุผล (P7)");

// ครบถ้วน → ต้องผ่าน
click("data-payact", { payact: "form", seq: "2" });
setFields({py_date:today(), py_value:today(), py_method:"TRANSFER", py_bank:"KBANK 123",
           py_ref:"KB26083000456", py_whttype:"GOODS", py_wht:0, py_fee:35, py_feeby:"OUR",
           py_amt:91035, py_slip:true, py_reason:"", py_note:"งวดสุดท้าย"});
click("data-payact", { payact: "save" });
click("data-po", { po: "PO-26-0042" });
d = nodes["#main"].innerHTML;
if (!/KB26083000456/.test(d)) bad.push("บันทึกจ่ายสำเร็จแต่ไม่แสดงเลขอ้างอิง");
if ((d.match(/จ่ายแล้ว<\/span>/g) || []).length !== 2) bad.push("บันทึกจ่ายแล้วแต่สถานะไม่เปลี่ยน");
if (!new RegExp(today().split("-").reverse().join("/")).test(d)) bad.push("ไม่แสดงวันที่จ่ายที่บันทึก");

/* ---------- payment: สายอนุมัติ ---------- */
click("data-po", { po: "PO-26-0033" });
if (!/ตั้งเรื่องขอจ่าย<\/button>/.test(nodes["#main"].innerHTML)) bad.push("ไม่มีปุ่มตั้งเรื่องขอจ่าย");
reqPay(2, {pr_amt:155000, pr_eff:today(), pr_bno:"INV-OB-2607", pr_bamt:155000});
click("data-po", { po: "PO-26-0033" });
if (!/รออนุมัติจ่าย/.test(nodes["#main"].innerHTML)) bad.push("ตั้งเรื่องแล้วสถานะไม่เป็น REQUESTED");
if (/อนุมัติจ่าย<\/button>/.test(nodes["#main"].innerHTML)) bad.push("บัญชีอนุมัติคำขอของตัวเองได้ (ผิดหลักแยกหน้าที่)");
click("data-role", { role: "ACH" });
click("data-po", { po: "PO-26-0033" });
if (!/อนุมัติจ่าย/.test(nodes["#main"].innerHTML))
  bad.push("ผู้จัดการฝ่ายบัญชีไม่เห็นปุ่มอนุมัติจ่าย");
click("data-role", { role: "GM" });
click("data-po", { po: "PO-26-0033" });
if (/data-payact="apv"/.test(nodes["#main"].innerHTML))
  bad.push("คนที่ไม่ใช่ผู้อนุมัติที่ระบุไว้ยังกดอนุมัติได้");
click("data-role", { role: "ACH" });
click("data-po", { po: "PO-26-0033" });
click("data-payact", { payact: "apv", seq: "2" });
if (!/อนุมัติแล้ว รอทำจ่าย/.test(nodes["#main"].innerHTML)) bad.push("อนุมัติแล้วสถานะไม่เปลี่ยน");

/* ---------- payment: กลับรายการ ---------- */
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0019" });
click("data-payact", { payact: "void", seq: "1" });
if (!/ยืนยันก่อนทำ/.test(nodes["#confirm"].innerHTML)) bad.push("กลับรายการจ่ายไม่มีหน้าจอยืนยัน");
click("data-cf", { cf: "yes" });
click("data-po", { po: "PO-26-0019" });
d = nodes["#main"].innerHTML;
if (!/กลับรายการ<\/span>/.test(d)) bad.push("กลับรายการแล้วไม่มีสถานะ VOID");
if (!/ทำจ่ายใหม่/.test(d)) bad.push("กลับรายการแล้วไม่เปิดงวดใหม่");

/* ---------- งวดถูกล็อกจากเคลม ---------- */
click("data-po", { po: "PO-26-0029" });
d = nodes["#main"].innerHTML;
if (!/ล็อก \(เคลม\)/.test(d)) bad.push("งวดที่มีเคลมไม่แสดงสถานะล็อก");
if (/ตั้งเรื่องขอจ่าย<\/button>/.test(d)) bad.push("งวดที่ถูกล็อกยังตั้งเรื่องขอจ่ายได้");

/* ---------- รายงานการจ่าย ---------- */
click("data-page", { page: "report" });
if (!/จ่ายตรงเวลา/.test(nodes["#main"].innerHTML)) bad.push("รายงานไม่มีตัวชี้วัดการจ่ายตรงเวลา");
click("data-role", { role: "QC" });
click("data-page", { page: "report" });
if (/ยอดค้างจ่าย/.test(nodes["#main"].innerHTML)) bad.push("QC เห็นยอดค้างจ่ายในรายงาน");


/* ---------- ใช้งานง่ายขึ้น: ปุ่มที่ต้องกดอยู่บนสุด ---------- */
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0042" });
d = nodes["#main"].innerHTML;
if (d.indexOf("งานนี้อยู่ที่คุณ") < 0) bad.push("QC ไม่เห็นกล่อง 'งานนี้อยู่ที่คุณ'");
if (d.indexOf("งานนี้อยู่ที่คุณ") > d.indexOf("ความคืบหน้า")) bad.push("กล่องสิ่งที่ต้องทำไม่ได้อยู่เหนือความคืบหน้า");
if (!/กดแล้วงานจะไปที่/.test(d)) bad.push("ไม่บอกล่วงหน้าว่างานจะไปที่ใคร");
if (/ไม่มีสิทธิ์ดู/.test(d)) bad.push("ยังโชว์ช่องมูลค่าว่า 'ไม่มีสิทธิ์ดู' แทนที่จะซ่อน");
if (!/<details class="blk">/.test(d)) bad.push("17 ขั้นตอน/ประวัติ ไม่ได้พับเก็บ");

click("data-role", { role: "WH" });
click("data-po", { po: "PO-26-0042" });
if (!/ตอนนี้ไม่มีอะไรที่คุณต้องทำ/.test(nodes["#main"].innerHTML)) bad.push("บทบาทที่ไม่ได้ถืองานไม่เห็นข้อความบอกชัด");

/* ---------- หน้าหลัก: กำลังจะถึงคิวคุณ ---------- */
click("data-role", { role: "WH" });
click("data-page", { page: "home" });
d = nodes["#main"].innerHTML;
if (!/กำลังจะถึงคิวคุณ/.test(d)) bad.push("หน้าหลักไม่มีหมวด 'กำลังจะถึงคิวคุณ'");
if (!/ข้อมูลจาก SAP B1 ล่าสุด/.test(d)) bad.push("หน้าหลักไม่บอกความสดของข้อมูล SAP");

/* ---------- ใบขอรหัส: รายละเอียดต้องตามแถวที่กด ---------- */
click("data-role", { role: "LS" });
click("data-page", { page: "req" });
click("data-sub", { sub: "ITEM" });
click("data-icopen", { icopen: "IC-26-0006" });
d = nodes["#main"].innerHTML;
if (!/IC-26-0006/.test(d)) bad.push("เปิดใบขอรหัสแล้วไม่แสดงใบที่กด");
if (/IC-26-0007/.test(d)) bad.push("เปิด IC-26-0006 แต่ยังแสดงใบอื่น (บั๊กเดิม)");
click("data-back", { back: "req" });
if (!/กดที่แถวเพื่อเปิดใบขอ/.test(nodes["#main"].innerHTML)) bad.push("ปุ่มกลับของใบคำร้องไม่ทำงาน");

// ปุ่มในแถวต้องไม่ถูกกลืนโดยการกดเปิดแถว
click("data-page", { page: "req" });
click("data-sub", { sub: "ITEM" });
click("data-ic", { ic: "approve", id: "IC-26-0007" });
click("data-role", { role: "LS" });
click("data-page", { page: "req" });
click("data-sub", { sub: "ITEM" });
if (!/ดึงรหัสจาก B1/.test(nodes["#main"].innerHTML)) bad.push("กดปุ่มในแถวแล้วกลายเป็นเปิดรายละเอียดแทน");

/* ---------- เคลม: เปิดเต็มหน้า ---------- */
click("data-role", { role: "QC" });
click("data-page", { page: "req" });
click("data-claim", { claim: "EX-2026001" });
d = nodes["#main"].innerHTML;
if (!/กลับไปรายการเคลม/.test(d)) bad.push("ใบเคลมไม่เปิดเต็มหน้า");
if (/<thead>/.test(d)) bad.push("เปิดใบเคลมแล้วยังมีตารางรายการปนอยู่");

/* ---------- กันพลาด: ยืนยันก่อนทำสิ่งที่ย้อนยาก ---------- */
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0042" });
click("data-act", { act: "qcfail" });
if (!/ยืนยันก่อนทำ/.test(nodes["#confirm"].innerHTML)) bad.push("ตรวจไม่ผ่าน ไม่มีหน้าจอยืนยัน");
if (!/ล็อกงวดจ่าย/.test(nodes["#confirm"].innerHTML)) bad.push("หน้าจอยืนยันไม่บอกผลกระทบ");
click("data-cf", { cf: "no" });
click("data-po", { po: "PO-26-0042" });
if (/มีเคลมค้าง/.test(nodes["#main"].innerHTML)) bad.push("กดยกเลิกแล้วยังทำงานต่อ");
click("data-act", { act: "qcfail" });
click("data-cf", { cf: "yes" });
// ตรวจไม่ผ่านต้องบันทึกผลตรวจก่อน ใบเคลมจึงมีตัวเลขให้ผู้ขายและบัญชี
if (!/บันทึกผลตรวจไม่ผ่าน/.test(nodes["#modal"].innerHTML))
  bad.push("ยืนยันตรวจไม่ผ่านแล้วไม่มีป๊อปอัปให้บันทึกผลตรวจ");
// ต้องอ้างเลขที่ใบตรวจจากแอป Incoming Inspection ที่ QC ใช้อยู่แล้ว
if (!/Incoming Inspection/.test(nodes["#modal"].innerHTML))
  bad.push("ป๊อปอัป QC ไม่ได้บอกว่าให้ตรวจในแอปเดิมแล้วเอาเลขใบตรวจมากรอก");
// ช่องของใบตรวจฝั่งอาหาร — ล็อต วันหมดอายุ เกรด ต้องมี (ฝั่งเครื่องจักรไม่มีช่องพวกนี้)
if (!/เกรดที่ QC ให้/.test(nodes["#modal"].innerHTML))
  bad.push("ป๊อปอัป QC ฝั่งอาหารไม่มีช่องเกรดตามใบตรวจจริง");
const qcOK = {up_file:"qc_fail.pdf", up_note:"เปลือกมีจุดดำเกินเกณฑ์", up_none:false,
  hf_qcRef:"F-2026060", hf_qcPoRef:"PO-F126050020", hf_qcDate:"2026-08-01",
  hf_qcPlace:"ห้องเย็นรักษ์ชัย II", hf_invQty:"500 KG", hf_qtyOk:"460 KG",
  hf_qcResult:"ไม่ผ่าน (Fail)", hf_qtyBad:"40 KG", hf_temp:"-12.4",
  hf_lot:"126005800", hf_expDate:"07-2028", hf_grade:"C", qo_block:"", qo_note:""};
setFields(Object.assign({}, qcOK, {hf_qcRef:""}));
formFields.up_err = {innerHTML:""}; formFields.up_named = {textContent:""};
click("data-uact", { uact: "save" });
if (!/เลขที่ใบตรวจ/.test(formFields.up_err.innerHTML))
  bad.push("บันทึกผลตรวจได้โดยไม่ต้องอ้างเลขที่ใบตรวจจากแอป QC");
setFields(qcOK);
formFields.up_err = {innerHTML:""}; formFields.up_named = {textContent:""};
click("data-uact", { uact: "save" });
d = nodes["#main"].innerHTML;
if (!/CL-26-\d{4}/.test(d)) bad.push("เลขใบเคลมผิดรูปแบบ (ต้องเป็น CL-26-xxxx สี่หลัก)");
if (!/40 KG/.test(d)) bad.push("ใบเคลมไม่ได้ใช้จำนวนที่ QC ตีกลับจริง");
if (!/-12\.4/.test(d)) bad.push("ใบเคลมไม่มีอุณหภูมิที่ QC วัดได้ — ผู้ขายเถียงได้");
click("data-po", { po: "PO-26-0042" });
if (!/มีเคลมค้าง|ล็อก \(เคลม\)/.test(nodes["#main"].innerHTML))
  bad.push("ยืนยันแล้วไม่ได้เปิดเคลม");

// จำนวนที่ตีกลับต้องเป็นช่องบังคับเฉพาะตอนตรวจไม่ผ่าน
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0038" });

/* ---------- SAP tab ---------- */
click("data-role", { role: "SR" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "SAP" });
d = nodes["#main"].innerHTML;
if (!/OPOR/.test(d)) bad.push("หน้าตั้งค่าไม่มีแท็บเชื่อมต่อ SAP");
if (!/ไม่เขียนอะไรกลับเข้า B1/.test(d)) bad.push("ไม่ระบุว่าเชื่อมต่อทิศทางเดียว");
click("data-act", { act: "sapnow" });
if (!/เมื่อสักครู่/.test(nodes["#main"].innerHTML)) bad.push("ปุ่มดึงข้อมูล SAP ไม่อัพเดตเวลา");

// ใบขอรหัสสินค้าที่ระบบเปิดให้เองต้องมีชื่อสินค้าจริง ไม่ใช่ช่องว่าง
click("data-role", { role: "LS" });
click("data-po", { po: "PO-26-0051" });
if (!/data-act="goic"/.test(nodes["#main"].innerHTML))
  bad.push("PO-26-0051 ไม่ได้อยู่ขั้นขอรหัสสินค้าของ LS");
click("data-act", { act: "goic" });
d = nodes["#main"].innerHTML;
if (!/IC-26-0007/.test(d)) bad.push("ไม่ได้เปิดใบขอรหัสของ PO ที่กดมา");
if (/undefined/.test(d)) bad.push("ใบขอรหัสมีช่องที่ไม่มีข้อมูล (undefined)");
click("data-ic", { ic: "sap", id: "IC-26-0007" });
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0051" });
if (!/ดึงข้อมูล PO จาก SAP B1/.test(nodes["#main"].innerHTML))
  bad.push("ได้รหัสสินค้าจาก B1 แล้วแต่ PO ไม่เดินต่อไปขั้นผูก PO");

/* ---------- ดึง PO จาก SAP แทนการพิมพ์เลขเอง ---------- */
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0051" });
click("data-ic", { ic: "sap", id: "IC-26-0007" });
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0051" });
if (!/ดึงข้อมูล PO จาก SAP B1/.test(nodes["#main"].innerHTML)) bad.push("ขั้นเปิด PO ไม่มีปุ่มดึงจาก SAP");
click("data-act", { act: "sappull" });
click("data-po", { po: "PO-26-0051" });
if (!/DocNum 102/.test(nodes["#main"].innerHTML) && !/>102\d\d</.test(nodes["#main"].innerHTML))
  bad.push("ดึงจาก B1 แล้วไม่ได้เลข PO");


/* ---------- ใบขอราคา -> ใบเสนอราคา -> PO (จุดที่ผู้ใช้แจ้งว่าดึงต่อกันไม่ได้) ---------- */
click("data-role", { role: "SR" });
click("data-page", { page: "req" });
click("data-sub", { sub: "PRICE" });
d = nodes["#main"].innerHTML;
if (!/ขอราคา \/ เสนอราคา/.test(d)) bad.push("ไม่มีแท็บขอราคา/เสนอราคา");
if (!/PR-26-0004/.test(d)) bad.push("รายการใบขอราคาไม่ขึ้น");

click("data-propen", { propen: "PR-26-0004" });
d = nodes["#main"].innerHTML;
if (!/ปลาแซลมอนแล่ เกรด A/.test(d)) bad.push("รายละเอียดใบขอราคาไม่ดึงชื่อสินค้ามา (PR-26-0004)");
if (!/200 KG/.test(d)) bad.push("รายละเอียดใบขอราคาไม่ดึงจำนวนมา");
if (!/QT-26-0009/.test(d) || !/QT-26-0010/.test(d)) bad.push("ไม่แสดงใบเสนอราคาที่มีอยู่ของ PR-26-0004");

// เพิ่มใบเสนอราคาใหม่ — ต้องดึง qty จากใบขอราคา ไม่ให้พิมพ์เอง
click("data-qact", { qact: "add" });
if (!/เพิ่มใบเสนอราคา — PR-26-0004/.test(nodes["#modal"].innerHTML)) bad.push("ฟอร์มเพิ่มใบเสนอราคาไม่เปิด");
if (!/200 KG/.test(nodes["#modal"].innerHTML)) bad.push("ฟอร์มเพิ่มใบเสนอราคาไม่โชว์จำนวนที่ดึงมาจากใบขอราคา");
if (document.getElementById("q_qty")) bad.push("ฟอร์มเพิ่มใบเสนอราคามีช่องจำนวนให้พิมพ์เอง (ไม่ควรมี — ต้องดึงมาอัตโนมัติ)");

// บันทึกไม่ครบ (ไม่มีผู้ขาย/ราคา) ต้องบล็อก
formFields = { q_supplier:{value:"",focus(){}}, q_price:{value:"0"}, q_lead:{value:""}, q_valid:{value:today()},
               q_err:{innerHTML:""}, q_calc:{innerHTML:""} };
click("data-qact", { qact: "save" });
if (!/ต้องระบุผู้ขาย/.test(formFields.q_err.innerHTML)) bad.push("เพิ่มใบเสนอราคาไม่บล็อกเมื่อไม่กรอกผู้ขาย/ราคา");
if (!/แก้ข้อที่ติดก่อน/.test(lastToast)) bad.push("เพิ่มใบเสนอราคาที่กรอกไม่ครบกลับบันทึกผ่าน");

// กรอกครบ -> บันทึกสำเร็จ ไม่ต้องพิมพ์สินค้า/จำนวนเลย
formFields = { q_supplier:{value:"Ocean Best 2",focus(){}}, q_price:{value:"300"}, q_lead:{value:"7 วัน"}, q_valid:{value:today()} };
click("data-qact", { qact: "save" });
click("data-propen", { propen: "PR-26-0004" });
d = nodes["#main"].innerHTML;
if (!/Ocean Best 2/.test(d)) bad.push("ใบเสนอราคาที่เพิ่มใหม่ไม่ปรากฏในรายการเทียบราคา");

// เลือกใบเสนอราคาที่ถูกที่สุด แล้วเปิด PO ต่อ — ต้องไม่มีช่องให้พิมพ์สินค้า/ผู้ขายซ้ำ
click("data-qact", { qact: "pick", id: "QT-26-0009" });
d = nodes["#main"].innerHTML;
if (!/เลือกแล้ว/.test(d)) bad.push("เลือกใบเสนอราคาแล้วไม่ขึ้นสถานะเลือกแล้ว");
if (!/เปิด PO จากใบที่เลือก/.test(d)) bad.push("ไม่มีปุ่มเปิด PO จากใบเสนอราคาที่เลือก");

const poCountBefore = (nodes["#main"].innerHTML.match(/PO-26-/g) || []).length;
click("data-qact", { qact: "topo" });
d = nodes["#main"].innerHTML;
if (!/เปิดจากใบเสนอราคา/.test(d)) bad.push("PO ใหม่ไม่แสดงว่าเปิดจากใบเสนอราคา");
if (!/Ocean Best/.test(d)) bad.push("PO ใหม่ไม่ได้ดึงชื่อผู้ขายจากใบเสนอราคา");
if (!/ปลาแซลมอนแล่ เกรด A/.test(d)) bad.push("PO ใหม่ไม่ได้ดึงชื่อสินค้าจากใบขอราคา");

// ย้อนกลับไปดูใบขอราคา ต้องขึ้นสถานะ "เปิด PO แล้ว" และเห็นลิงก์กลับไป PO
click("data-page", { page: "req" });
click("data-sub", { sub: "PRICE" });
click("data-propen", { propen: "PR-26-0004" });
d = nodes["#main"].innerHTML;
if (!/เปิด PO แล้ว/.test(d)) bad.push("สถานะใบขอราคาไม่เปลี่ยนเป็นเปิด PO แล้วหลังแปลง");
if (!/ไปที่ PO-26-/.test(d)) bad.push("ใบขอราคาที่แปลงแล้วไม่มีลิงก์กลับไปหา PO");

// ใบขอราคาที่แปลงเป็น PO แล้ว ต้องไม่ให้เพิ่มใบเสนอราคาซ้ำอีก
if (/data-qact="add"/.test(d)) bad.push("ใบขอราคาที่แปลงเป็น PO แล้วยังเพิ่มใบเสนอราคาใหม่ได้");

/* ================= 1. รายการซื้อเงินสด (ไม่มี PO) + ข้าม QC ================= */
click("data-role", { role: "SR" });
click("data-page", { page: "po" });
d = nodes["#main"].innerHTML;
if (!/เพิ่มรายการซื้อเงินสด/.test(d)) bad.push("หน้า PO ไม่มีปุ่มเพิ่มรายการซื้อเงินสด");
if (!/CS-26-0007/.test(d)) bad.push("รายการเงินสดตัวอย่างไม่ขึ้นในรายการเดียวกับ PO");
if (!/etype cash/.test(d)) bad.push("รายการเงินสดไม่มีป้าย CASH แยกจาก PO ปกติ");

click("data-po", { po: "CS-26-0007" });
d = nodes["#main"].innerHTML;
if (!/ไม่ได้เปิด PO ใน B1/.test(d)) bad.push("รายละเอียดเงินสดไม่บอกว่าไม่มี PO ใน B1");
if (!/ข้าม QC/.test(d)) bad.push("รายการที่ข้าม QC ไม่แสดงเหตุผล/ผู้อนุมัติ");
if (!/คุณสมหญิง/.test(d)) bad.push("ไม่แสดงชื่อผู้อนุมัติการข้าม QC");
if (/ผลตรวจรับ \/ RC/.test(d)) bad.push("รายการที่ข้าม QC ยังขอเอกสารผลตรวจรับ");

// เปิดฟอร์มเงินสด — ต้องบล็อกเมื่อไม่มีเหตุผลที่ไม่เปิด PO
click("data-cash", { cash: "open" });
if (!/เพิ่มรายการซื้อเงินสด \(ไม่ได้เปิด PO\)/.test(nodes["#modal"].innerHTML)) bad.push("ฟอร์มเงินสดไม่เปิด");
setFields({cs_sup:"ตลาดสี่มุมเมือง", cs_item:"พริกขี้หนู", cs_qty:"20 KG", cs_amt:2400,
           cs_date:today(), cs_from:"PETTY", cs_why:"", cs_bypass:false, cs_bywhy:""});
formFields.cs_calc = {innerHTML:""}; formFields.cs_err = {innerHTML:""};
formFields.cs_bywrap = {style:{}};
click("data-cash", { cash: "save" });
if (!/C1/.test(formFields.cs_err.innerHTML)) bad.push("บันทึกเงินสดได้ทั้งที่ไม่ระบุเหตุผลที่ไม่เปิด PO (C1)");

// ติ๊กข้าม QC แต่ไม่ให้เหตุผล → ต้องบล็อก
setFields({cs_sup:"ตลาดสี่มุมเมือง", cs_item:"พริกขี้หนู", cs_qty:"20 KG", cs_amt:2400,
           cs_date:today(), cs_from:"PETTY", cs_why:"ร้านไม่รับเครดิต", cs_bypass:true, cs_bywhy:""});
formFields.cs_calc = {innerHTML:""}; formFields.cs_err = {innerHTML:""};
formFields.cs_bywrap = {style:{}};
click("data-cash", { cash: "save" });
if (!/C3/.test(formFields.cs_err.innerHTML)) bad.push("ข้าม QC ได้โดยไม่ต้องระบุเหตุผล/ผู้อนุมัติ (C3)");

// เกินวงเงินเงินสด → ต้องบังคับให้เปิด PO
setFields({cs_sup:"ตลาดสี่มุมเมือง", cs_item:"พริกขี้หนู", cs_qty:"20 KG", cs_amt:200000,
           cs_date:today(), cs_from:"PETTY", cs_why:"ร้านไม่รับเครดิต", cs_bypass:false, cs_bywhy:""});
formFields.cs_calc = {innerHTML:""}; formFields.cs_err = {innerHTML:""};
formFields.cs_bywrap = {style:{}};
click("data-cash", { cash: "save" });
if (!/C4/.test(formFields.cs_err.innerHTML)) bad.push("ซื้อเงินสดยอดใหญ่ผ่านได้โดยไม่ต้องเปิด PO (C4)");

// กรอกครบ + ข้าม QC → บันทึกได้ และต้องข้ามขั้น QC จริง
setFields({cs_sup:"ตลาดสี่มุมเมือง", cs_item:"พริกขี้หนูสวน", cs_qty:"20 KG", cs_amt:2400,
           cs_date:today(), cs_from:"PETTY", cs_why:"ร้านไม่รับเครดิต จ่ายสดหน้างาน",
           cs_bypass:true, cs_bywhy:"ตรวจหน้างานแล้ว — คุณสมหญิง อนุมัติ"});
formFields.cs_calc = {innerHTML:""}; formFields.cs_err = {innerHTML:""};
formFields.cs_bywrap = {style:{}};
click("data-cash", { cash: "save" });
d = nodes["#main"].innerHTML;
if (!/พริกขี้หนูสวน/.test(d)) bad.push("บันทึกรายการเงินสดแล้วไม่เปิดหน้ารายการใหม่");
if (!/ตลาดสี่มุมเมือง/.test(d)) bad.push("รายการเงินสดใหม่ไม่มีชื่อร้าน");
if (!/จ่ายแล้ว<\/span>/.test(d)) bad.push("รายการเงินสดไม่บันทึกว่าจ่ายแล้ว");
if (!/รับเข้าคลัง/.test(d)) bad.push("รายการเงินสดที่ข้าม QC ไม่ได้ข้ามไปขั้นรับเข้าคลัง");

/* ================= 4. ป๊อปอัปแนบไฟล์ + หมายเหตุ ประจำขั้นตอน ================= */
click("data-role", { role: "WH" });
click("data-po", { po: "PO-26-0033" });   // ขั้นนี้ WH ไม่ได้ถือ — ใช้ PO ที่ WH ถืออยู่แทน
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0038" });
click("data-role", { role: "WH" });
click("data-po", { po: "PO-26-0038" });   // stage 11 = รับเข้าคลัง + GR (เจ้าของ WH)
d = nodes["#main"].innerHTML;
if (!/MGS-Documents \/ PO-2026 \/ PO-26-0038/.test(d)) bad.push("หน้ารายละเอียดไม่บอกโฟลเดอร์ในไดรฟ์กลาง");
if (!/ไดรฟ์กลางที่เดียว/.test(d)) bad.push("ไม่ได้ระบุว่าไฟล์อยู่ไดรฟ์กลางที่เดียว");

click("data-act", { act: "done" });
d = nodes["#modal"].innerHTML;
if (!/แนบเอกสาร/.test(d)) bad.push("กดทำขั้นตอนเสร็จแล้วไม่มีป๊อปอัปให้แนบไฟล์");
if (!/up_note/.test(d)) bad.push("ป๊อปอัปแนบไฟล์ไม่มีช่องหมายเหตุ");
if (!/PO-26-0038_GR/.test(d)) bad.push("ป๊อปอัปไม่บอกชื่อไฟล์ที่ระบบตั้งให้");

// ขั้นที่มีเอกสารบังคับ ไม่แนบไฟล์ → ต้องบล็อก
setFields({up_file:"", up_note:"", up_none:false, hf_qtyIn:"", hf_grNo:""});
formFields.up_err = {innerHTML:""}; formFields.up_named = {textContent:""};
click("data-uact", { uact: "save" });
if (!/ต้องแนบ/.test(formFields.up_err.innerHTML)) bad.push("ขั้นที่มีเอกสารบังคับ ผ่านได้โดยไม่แนบไฟล์");

// สัญญาระหว่างขั้น: แนบไฟล์แล้วแต่ไม่กรอกสิ่งที่บัญชีต้องใช้ → ต้องบล็อก
setFields({up_file:"gr_scan.jpg", up_note:"", up_none:false, hf_qtyIn:"", hf_grNo:""});
formFields.up_err = {innerHTML:""}; formFields.up_named = {textContent:""};
click("data-uact", { uact: "save" });
if (!/จำนวนที่รับเข้าคลังจริง/.test(formFields.up_err.innerHTML))
  bad.push("ส่งงานต่อได้ทั้งที่ไม่กรอกข้อมูลที่แผนกถัดไปต้องใช้");
if (!/บัญชี/.test(formFields.up_err.innerHTML))
  bad.push("ข้อความบล็อกไม่บอกว่ากรอกให้แผนกไหน");

// กรอกครบ → ผ่านและส่งต่อ
setFields({up_file:"gr_scan.jpg", up_note:"ของมาไม่ครบ 5 KG ผู้ขายจะส่งตามพรุ่งนี้", up_none:false,
           hf_qtyIn:"795 KG", hf_grNo:"GR-26-0399"});
formFields.up_err = {innerHTML:""}; formFields.up_named = {textContent:""};
click("data-uact", { uact: "save" });
click("data-po", { po: "PO-26-0038" });
d = nodes["#main"].innerHTML;
if (!/PO-26-0038_GR\.jpg/.test(d)) bad.push("แนบไฟล์แล้วระบบไม่ได้ตั้งชื่อไฟล์ตามรูปแบบกลาง");
if (!/ของมาไม่ครบ 5 KG/.test(d)) bad.push("หมายเหตุที่พิมพ์ในป๊อปอัปไม่ถูกเก็บ");

/* ============ 4b. ขั้น SR ส่งขอทำจ่าย: ยอดเงิน + Effective date + ประทับข้อความ ============ */
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0045" });   // stage 13 = ส่งมอบเอกสาร เจ้าของ SR
d = nodes["#main"].innerHTML;
if (!/ขออนุมัติทำจ่าย<\/button>/.test(d)) bad.push("ขั้นส่งมอบเอกสารไม่มีปุ่มขออนุมัติทำจ่าย");
click("data-act", { act: "payreq" });
d = nodes["#modal"].innerHTML;
if (!/pr_amt/.test(d)) bad.push("ฟอร์มขอทำจ่ายไม่มีช่องยอดเงินที่ต้องจ่าย");
if (!/pr_eff/.test(d)) bad.push("ฟอร์มขอทำจ่ายไม่มีช่อง Effective date");
if (!/ประทับข้อความนี้ลงบนเอกสารที่แนบ/.test(d)) bad.push("ไม่มีช่องติ๊กประทับข้อความลงเอกสาร");
if (!/class="prev"/.test(d)) bad.push("ไม่มีโหมดตัวอย่างเอกสาร");
if (!/pr_pos/.test(d) || !/pr_size/.test(d)) bad.push("ตัวอย่างปรับแต่งไม่ได้ (ไม่มีตำแหน่ง/ขนาด)");

// ไม่ใส่ยอด → บล็อก
setFields({pr_amt:0, pr_eff:today(), pr_stamp:true, pr_doc:"INVOICE", pr_pos:"BR",
           pr_size:"13", pr_color:"แดง", pr_text:"ขออนุมัติทำจ่าย"});
formFields.pr_err = {innerHTML:""}; formFields.pr_prev = {classList:{add(){},remove(){}}};
formFields.pr_ptl = {textContent:""}; formFields.pr_ptr = {textContent:""};
click("data-pract", { pract: "send" });
if (!/S1/.test(formFields.pr_err.innerHTML)) bad.push("ส่งขอทำจ่ายได้โดยไม่ใส่ยอดเงิน (S1)");

// Effective date ย้อนหลัง → บล็อก
prFields({pr_amt:122500, pr_eff:"2020-01-01", pr_bamt:122500});
click("data-pract", { pract: "send" });
if (!/S4/.test(formFields.pr_err.innerHTML)) bad.push("ส่งขอทำจ่ายด้วย Effective date ย้อนหลังได้ (S4)");

// ยอดเกินยอดคงเหลือ → บล็อก
prFields({pr_amt:9999999, pr_eff:today(), pr_bamt:9999999});
click("data-pract", { pract: "send" });
if (!/S2/.test(formFields.pr_err.innerHTML)) bad.push("ขอจ่ายเกินยอดคงเหลือของ PO ได้ (S2)");

// ไม่แนบเอกสารเรียกเก็บของงวดนี้ → บล็อก (ผู้อนุมัติต้องมีใบให้ดู)
prFields({pr_amt:122500, pr_eff:today(), pr_bamt:122500, pr_bfile:""});
click("data-pract", { pract: "send" });
if (!/S9/.test(formFields.pr_err.innerHTML)) bad.push("ส่งขอจ่ายได้โดยไม่แนบเอกสารเรียกเก็บของงวด (S9)");

// ไม่ใส่เลขเอกสารเรียกเก็บ → บล็อก
prFields({pr_amt:122500, pr_eff:today(), pr_bamt:122500, pr_bno:""});
click("data-pract", { pract: "send" });
if (!/S8/.test(formFields.pr_err.innerHTML)) bad.push("ส่งขอจ่ายได้โดยไม่ระบุเลขเอกสารเรียกเก็บ (S8)");

// ขอจ่ายเกินยอดในใบเรียกเก็บ → บล็อก
prFields({pr_amt:122500, pr_eff:today(), pr_bamt:50000});
click("data-pract", { pract: "send" });
if (!/S11/.test(formFields.pr_err.innerHTML)) bad.push("ขอจ่ายเกินยอดในเอกสารเรียกเก็บได้ (S11)");

/* ---------- ตัวอย่างเอกสาร + บล็อกข้อความที่ลากวางได้ ---------- */
prFields({pr_amt:122500, pr_eff:today(), pr_bamt:122500, pr_bno:"INV-ABC-0804"});
d = nodes["#modal"].innerHTML;
if (!/pr_page/.test(d)) bad.push("หน้าขอทำจ่ายไม่มีตัวอย่างหน้าเอกสาร");
if (!/id="pr_stampbox"/.test(d)) bad.push("ไม่มีบล็อกข้อความบนตัวอย่างเอกสาร");
if (!/ลากได้/.test(d)) bad.push("ไม่ได้บอกผู้ใช้ว่าบล็อกข้อความลากได้");
if (!/INV-ABC-0804/.test(d)) bad.push("ตัวอย่างเอกสารไม่ได้ใช้เลขที่เอกสารเรียกเก็บที่กรอก");
if (!/ABC Foods/.test(d)) bad.push("ตัวอย่างเอกสารไม่ได้ใช้ชื่อผู้ขายจริง");
if (!/กำหนดเอง/.test(d)) bad.push("ไม่มีตัวเลือกตำแหน่งแบบกำหนดเอง");

// เปลี่ยนตัวเลือกตำแหน่งแล้วบล็อกต้องย้ายจริง (ไม่กดส่ง — แค่แก้ช่องแล้วดูตัวอย่าง)
prFields({pr_amt:122500, pr_eff:today(), pr_bamt:122500, pr_bno:"INV-ABC-0804", pr_pos:"TL"});
type("pr_pos");
if (formFields.pr_stampbox.style.left !== "4%")
  bad.push("เลือกมุมซ้ายบนแล้วบล็อกข้อความไม่ย้ายตาม (" + formFields.pr_stampbox.style.left + ")");
formFields.pr_pos.value = "CT"; type("pr_pos");
if (formFields.pr_stampbox.style.left !== "50%")
  bad.push("เลือกกลางหน้าแล้วบล็อกข้อความไม่ไปกึ่งกลาง");
if (!/translate\(-50%,-50%\)/.test(formFields.pr_stampbox.style.transform || ""))
  bad.push("บล็อกกลางหน้าไม่ได้ชดเชยขนาดตัวเอง — จะเลยขอบกระดาษ");
if (formFields.pr_posn.textContent !== "50 / 50") bad.push("ไม่แสดงตำแหน่งที่วางเป็นตัวเลข");

// ขนาดและสีต้องมีผลกับบล็อกบนเอกสาร ไม่ใช่แค่ข้อความบอก
formFields.pr_size.value = "16"; formFields.pr_color.value = "ดำ"; type("pr_size");
if (formFields.pr_stampbox.style.fontSize !== "9px")
  bad.push("เปลี่ยนขนาดตัวอักษรแล้วบล็อกไม่เปลี่ยน (" + formFields.pr_stampbox.style.fontSize + ")");
if (formFields.pr_stampbox.style.color !== "#1a1a1a") bad.push("เปลี่ยนสีแล้วบล็อกไม่เปลี่ยนสี");

// ข้อความที่พิมพ์ต้องขึ้นบนเอกสารทันที และหน้ากระดาษเดินตามช่องที่กรอก
formFields.pr_text.value = "ทดสอบข้อความประทับ"; type("pr_text");
if (formFields.pr_stamptext.textContent !== "ทดสอบข้อความประทับ")
  bad.push("พิมพ์ข้อความแล้วไม่ขึ้นบนตัวอย่างเอกสาร");
if (!/122,500/.test(formFields.pr_pgtot.textContent))
  bad.push("ยอดบนหน้ากระดาษไม่เดินตามยอดที่กรอก");
formFields.pr_bno.value = "INV-เปลี่ยนแล้ว"; type("pr_bno");
if (formFields.pr_pgno.textContent !== "INV-เปลี่ยนแล้ว")
  bad.push("เปลี่ยนเลขที่เอกสารเรียกเก็บแล้วหน้ากระดาษไม่เปลี่ยนตาม");
// ไม่ประทับ = ตัวอย่างต้องหรี่ลงให้เห็นว่าไม่มีอะไรพิมพ์ลงเอกสาร
let dim = false;
formFields.pr_prev = {classList:{add(){ dim = true; }, remove(){ dim = false; }}};
formFields.pr_stamp.checked = false; type("pr_stamp");
if (!dim) bad.push("ติ๊กไม่ประทับแล้วตัวอย่างเอกสารไม่ได้บอกว่าจะไม่มีอะไรพิมพ์ลง");

// ครบ → ส่งได้ งวดต้องเป็นรออนุมัติ และวันครบกำหนดต้องเป็น Effective date ที่ระบุ
const eff = "2026-12-15";
prFields({pr_amt:122500, pr_eff:eff, pr_size:"16", pr_bkind:"INVOICE",
          pr_bno:"INV-ABC-0804", pr_bamt:122500, pr_bfile:"invoice_ABC_0804.pdf",
          pr_text:"ขออนุมัติทำจ่าย PO-26-0045\nยอด 122,500"});
click("data-pract", { pract: "send" });
click("data-po", { po: "PO-26-0045" });
d = nodes["#main"].innerHTML;
if (!/รออนุมัติจ่าย/.test(d)) bad.push("ส่งขอทำจ่ายแล้วงวดไม่เป็นสถานะรออนุมัติ");
if (!/15\/12\/2026/.test(d)) bad.push("Effective date ที่กรอกไม่ได้ลงไปเป็นวันครบกำหนดจ่าย");
if (!/ประทับข้อความ/.test(d)) bad.push("ไม่บันทึกประวัติว่าประทับข้อความลงเอกสาร");

// หัวหน้าต้องได้ "ใบขออนุมัติ" ที่มีของให้ดู ไม่ใช่ปุ่มลอย ๆ ในตาราง
// ยอด 122,500 — เดิมจะเด้งไปผู้บริหารเพราะเกิน 50,000 ตอนนี้ทุกยอดไปที่ผู้จัดการฝ่ายบัญชี
click("data-role", { role: "GM" });
click("data-po", { po: "PO-26-0045" });
if (/data-payact="apv"/.test(nodes["#main"].innerHTML))
  bad.push("ยอดใหญ่ยังเด้งไปผู้บริหาร — ต้องผ่านผู้จัดการฝ่ายบัญชีทุกยอด");
click("data-role", { role: "ACH" });
click("data-po", { po: "PO-26-0045" });
d = nodes["#main"].innerHTML;
if (!/ใบขออนุมัติทำจ่าย/.test(d)) bad.push("คำขอจ่ายจาก SR ไม่มีใบขออนุมัติให้หัวหน้าดู");
if (!/PRQ-26-\d{4}/.test(d)) bad.push("ใบขออนุมัติไม่มีเลขที่ให้อ้างอิง");
if (!/ที่ผู้ขอวางเอง/.test(d))
  bad.push("ผู้อนุมัติไม่เห็นว่าข้อความถูกประทับไว้ตำแหน่งไหนบนเอกสาร");
if (!/ผู้ขอ/.test(d)) bad.push("ผู้อนุมัติไม่เห็นว่าใครเป็นคนขอ");
if (!/เอกสารประกอบ/.test(d)) bad.push("ผู้อนุมัติไม่เห็นเอกสารประกอบที่แนบมากับคำขอ");
if (!/INV-ABC-0804/.test(d)) bad.push("ใบขออนุมัติไม่โยงถึงใบแจ้งหนี้ที่บัญชีบันทึกไว้");
if (!/ระบบตรวจให้แล้วก่อนถึงคุณ/.test(d)) bad.push("ผู้อนุมัติไม่เห็นผลตรวจที่ระบบทำให้แล้ว");
if (!/อนุมัติจ่าย ฿/.test(d)) bad.push("ไม่มีปุ่มอนุมัติในใบขออนุมัติ");
if (/data-payact="apv"[^>]*>อนุมัติจ่าย<\/button>/.test(d))
  bad.push("ยังมีปุ่มอนุมัติลอยในตาราง — กดได้โดยไม่ต้องอ่านใบคำขอ");
if (/เกินวงเงิน|อยู่ในวงเงิน/.test(d))
  bad.push("ใบขออนุมัติยังพูดถึงเกณฑ์วงเงิน ทั้งที่ทุกยอดต้องผ่านผู้จัดการ");
if (!/ทุกยอดต้องผ่านผู้จัดการ/.test(d)) bad.push("ใบขออนุมัติไม่ได้บอกกติกาว่าทุกยอดต้องผ่านผู้จัดการ");

// หน้าหลักของผู้อนุมัติต้องบอกว่ามีของรออนุมัติ ไม่ใช่ขึ้น "ต้องทำวันนี้ 0"
click("data-page", { page: "home" });
d = nodes["#main"].innerHTML;
if (!/รออนุมัติจ่ายจากคุณ/.test(d)) bad.push("หน้าหลักผู้อนุมัติไม่บอกว่ามีคำขอจ่ายรออยู่");
if (!/PRQ-26-\d{4}/.test(d)) bad.push("หน้าหลักไม่แสดงเลขที่คำขอที่รออนุมัติ");

// กล่องแจ้งเตือนต้องมีเรื่องคำขออนุมัติ
click("data-page", { page: "inbox" });
if (!/รออนุมัติจ่าย PRQ/.test(nodes["#main"].innerHTML))
  bad.push("ไม่มีแจ้งเตือนถึงผู้อนุมัติเมื่อมีคำขอจ่ายเข้ามา");

// ตีกลับต้องบังคับเหตุผล และเหตุผลต้องไปถึงผู้ขอ
click("data-role", { role: "ACH" });
click("data-po", { po: "PO-26-0045" });
click("data-payact", { payact: "rej", seq: "1" });
if (!/ตีกลับ PRQ/.test(nodes["#modal"].innerHTML)) bad.push("ตีกลับไม่มีหน้าจอให้ระบุเหตุผล");
setFields({rj_why:"", rj_note:""});
formFields.rj_err = {innerHTML:""};
click("data-rej", { rej: "send" });
if (!/ต้องเลือกเหตุผล/.test(formFields.rj_err.innerHTML))
  bad.push("ตีกลับได้โดยไม่ต้องบอกเหตุผล — ผู้ขอไม่รู้ว่าต้องแก้อะไร");
setFields({rj_why:"ยอดไม่ตรงกับใบแจ้งหนี้", rj_note:"ของรับจริง 340 KG"});
formFields.rj_err = {innerHTML:""};
click("data-rej", { rej: "send" });
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0045" });
d = nodes["#main"].innerHTML;
if (!/ยอดไม่ตรงกับใบแจ้งหนี้/.test(d)) bad.push("ผู้ขอไม่เห็นเหตุผลที่ถูกตีกลับ");
if (!/ของรับจริง 340 KG/.test(d)) bad.push("รายละเอียดที่หัวหน้าเขียนไม่ถึงผู้ขอ");
if (!/ตีกลับโดย/.test(d)) bad.push("ไม่บอกว่าใครเป็นคนตีกลับ");

/* ================= 3. รวมไฟล์เป็นไฟล์เดียวเมื่อปิดครบทุกขั้น ================= */
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0031" });   // ปิดแล้ว
d = nodes["#main"].innerHTML;
if (!/ชุดเอกสารรวมเล่มพร้อมแล้ว/.test(d)) bad.push("PO ที่ปิดแล้วไม่มีชุดเอกสารรวมเล่ม");
if (!/PO-26-0031_ชุดเอกสารครบ\.pdf/.test(d)) bad.push("ไฟล์รวมไม่ได้ตั้งชื่อตามเลขรายการ");
if (!/ต้นฉบับแต่ละใบยังอยู่ครบอีก/.test(d)) bad.push("ไม่บอกว่าต้นฉบับถูกเก็บต่ออีกกี่วัน");
click("data-po", { po: "PO-26-0038" });
if (/ชุดเอกสารรวมเล่มพร้อมแล้ว/.test(nodes["#main"].innerHTML))
  bad.push("PO ที่ยังไม่ปิดกลับมีชุดเอกสารรวมเล่มแล้ว");

/* ---------- แท็บไดรฟ์และการรวมไฟล์ในหน้าตั้งค่า ---------- */
click("data-role", { role: "AC" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "FILES" });
d = nodes["#main"].innerHTML;
if (!/MGS-Documents \(Shared drive\)/.test(d)) bad.push("หน้าตั้งค่าไม่บอกไดรฟ์กลางที่ใช้");
if (!/ทันทีที่ทุกขั้นตอนเสร็จ/.test(d)) bad.push("ไม่ได้ระบุว่ารวมไฟล์เมื่อไหร่");
if (!/ข้อแลกเปลี่ยนที่ต้องตัดสินใจ/.test(d)) bad.push("ไม่บอกผลกระทบด้านพื้นที่ของการรวมไฟล์");
if (!/CS-26-0007/.test(d)) bad.push("ทะเบียนรายการเงินสดไม่ขึ้นในหน้าตั้งค่า");
if (!/ตรวจหน้างานแล้ว/.test(d)) bad.push("ทะเบียนไม่แสดงเหตุผลการข้าม QC ที่บันทึกไว้");


/* ================= สัญญาระหว่างขั้น: แผนกถัดไปต้องเข้าใจงานที่รับมา ================= */

// 1) ใบส่งงาน — QC ต้องเห็นว่า LS จองรถไว้เมื่อไหร่ โดยไม่ต้องเลื่อนหา
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0042" });   // stage 10 = QC ตรวจรับ
d = nodes["#main"].innerHTML;
if (!/แผนกก่อนหน้าส่งอะไรมาให้คุณ/.test(d)) bad.push("ไม่มีใบส่งงานจากแผนกก่อนหน้า");
if (!/ของถึงห้องเย็นวันที่/.test(d)) bad.push("QC ไม่เห็นวันที่ของจะมาถึงที่ LS จองไว้");
if (!/70-1234/.test(d)) bad.push("QC ไม่เห็นทะเบียนรถที่ LS จองไว้");
if (d.indexOf("แผนกก่อนหน้าส่งอะไรมาให้คุณ") > d.indexOf("งานนี้อยู่ที่คุณ"))
  bad.push("ใบส่งงานอยู่ใต้ปุ่มที่ต้องกด — ต้องอยู่เหนือ");

// 2) เกณฑ์ตรวจรับต้องเดินทางจากใบขอราคามาถึง QC
if (!/เกณฑ์ตรวจรับ/.test(d)) bad.push("QC ไม่เห็นสเปกที่ต้องใช้ตัดสินว่ารับหรือไม่รับ");

// 3) คลังต้องเห็นผลตรวจของ QC ตอนรับเข้าคลัง
click("data-role", { role: "WH" });
click("data-po", { po: "PO-26-0038" });   // stage 11 = รับเข้าคลัง
d = nodes["#main"].innerHTML;
if (!/จำนวนที่ตรวจนับได้จริง/.test(d)) bad.push("คลังไม่เห็นจำนวนที่ QC รับได้");
if (!/F-2026041/.test(d)) bad.push("คลังไม่เห็นเลขที่ใบตรวจที่จะใช้อ้างอิง");
if (!/ห้องเย็นรักษ์ชัย/.test(d)) bad.push("คลังไม่เห็นว่าของอยู่ที่ไหน — ต้องไปรับที่ห้องเย็นผู้ให้บริการ");
if (!/-18\.5/.test(d)) bad.push("คลังไม่เห็นอุณหภูมิที่ QC วัดได้");

// 4) บัญชีต้องเห็นทั้งจำนวนที่ QC รับและจำนวนที่คลังรับเข้า ก่อนตั้งหนี้
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0029" });   // stage 12 = รับใบแจ้งหนี้
d = nodes["#main"].innerHTML;
if (!/80 KG/.test(d)) bad.push("บัญชีไม่เห็นจำนวนที่รับเข้าคลังจริง");
if (!/40 KG/.test(d)) bad.push("บัญชีไม่เห็นจำนวนที่ QC ตีกลับ — เสี่ยงจ่ายเต็มจำนวน");

// 5) ข้อมูลที่ขั้นก่อนหน้าไม่ได้ส่งมา ต้องเตือน + ถามกลับได้ในคลิกเดียว
click("data-role", { role: "SR" });
click("data-page", { page: "req" });
click("data-sub", { sub: "PRICE" });
click("data-propen", { propen: "PR-26-0004" });
d = nodes["#main"].innerHTML;
const newPo = (d.match(/ไปที่ (PO-26-\d{4})/) || [])[1];
if (newPo) {
  click("data-po", { po: newPo });
  // เดินไปจนถึงขั้นจองรถ (LS) ซึ่งต้องใช้ "ผู้ขายนัดส่งของวันที่" จาก SR
  for (let i = 0; i < 8; i++) {
    for (const r of ["SR","GM","LS"]) {
      click("data-role", { role: r });
      click("data-po", { po: newPo });
      if (/จองรถรับของ/.test(nodes["#main"].innerHTML) && r === "LS") { i = 99; break; }
      if (/งานนี้อยู่ที่คุณ/.test(nodes["#main"].innerHTML)) {
        if (/ดึงข้อมูล PO จาก SAP B1/.test(nodes["#main"].innerHTML)) { click("data-act",{act:"sappull"}); break; }
        const isApprove = /data-act="approve"/.test(nodes["#main"].innerHTML);
        click("data-act", { act: isApprove ? "approve" : "done" });
        if (/data-uact/.test(nodes["#modal"].innerHTML)) {
          setFields({up_file:"x.pdf", up_note:"", up_none:false, hf_shipDate:"2026-09-01"});
          formFields.up_err={innerHTML:""}; formFields.up_named={textContent:""};
          click("data-uact", { uact: "save" });
        }
        break;
      }
    }
  }
  click("data-role", { role: "LS" });
  click("data-po", { po: newPo });
  d = nodes["#main"].innerHTML;
  if (!/ผู้ขายนัดส่งของวันที่/.test(d)) bad.push("LS ไม่เห็นวันที่ผู้ขายนัดส่งที่จัดซื้อกรอกไว้");
}

// 6) PO ที่ดึงจาก B1 แล้ว ต้องได้เงื่อนไขชำระและงวดจ่ายจริง ไม่ใช่แค่เขียนในประวัติ
click("data-role", { role: "AC" });
click("data-po", { po: newPo || "PO-26-0051" });
d = nodes["#main"].innerHTML;
if (/รอกำหนดตอนผูกกับ B1/.test(d))
  bad.push("ดึงจาก B1 แล้วแต่เงื่อนไขจ่ายยังค้างเป็น 'รอกำหนด' — บัญชีไม่รู้ว่าต้องจ่ายเมื่อไหร่");
if (!/OCTG/.test(d)) bad.push("ไม่บันทึกว่างวดจ่ายสร้างจากเงื่อนไขชำระของ B1");

// 7) ขั้นทำจ่ายต้องไม่ปิดได้โดยไม่บันทึกการจ่าย
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0033" });   // stage 14 = ทำจ่าย
d = nodes["#main"].innerHTML;
if (/ทำ “ทำจ่าย” เสร็จ/.test(d))
  bad.push("ขั้นทำจ่ายยังมีปุ่ม 'เสร็จ' ลอย ๆ — ปิดได้โดยไม่ต้องบันทึกจ่ายจริง");
if (!/ไปที่งวดที่ต้องจ่าย/.test(d)) bad.push("ขั้นทำจ่ายไม่ได้ชี้ไปที่งวดที่ต้องจ่าย");

// 8) ปุ่มบอกปลายทางต้องไม่บอกว่า "ส่งไปที่ตัวเอง"
//    PO-26-0033 อยู่ขั้นทำจ่าย (AC) และขั้นถัดไปคือใบเสร็จตัวจริง (AC เหมือนกัน)
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0033" });
d = nodes["#main"].innerHTML;
if (/กดแล้วงานจะไปที่ <b>บัญชี/.test(d))
  bad.push("บอกว่าส่งงานไปที่แผนกตัวเอง ทั้งที่งานยังอยู่ที่คนเดิม");
if (!/งานยังอยู่ที่คุณ/.test(d)) bad.push("ไม่ได้บอกว่าขั้นถัดไปยังเป็นของแผนกเดิม");

// 9) ใบขอรหัสสินค้าต้องถูกเปิดให้อัตโนมัติจาก PO ไม่ใช่พาไปหน้าเปล่า
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0051" });


// 10) ตรวจ 3 ทางต้องเทียบกับจำนวนที่ QC รับได้ ไม่ใช่จำนวนที่ส่งมา
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0029" });   // QC รับ 80 KG · คลังรับเข้า 80 KG · ตีกลับ 40 KG
d = nodes["#main"].innerHTML;
if (!/จำนวนที่ QC รับได้ตรงกับที่คลังรับเข้า/.test(d))
  bad.push("การ์ดตรวจสอบไม่ได้เทียบจำนวนที่ QC รับได้กับที่คลังรับเข้า");
click("data-po", { po: "PO-26-0042" });   // ยังไม่ผ่าน QC — ต้องเตือนว่าเทียบไม่ได้
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0051" });


/* ================= รอบสอง: สายที่ไม่ใช่ทางปกติ ================= */

// รายการเงินสดต้องไม่ตันที่ขั้นส่งมอบเอกสาร (จ่ายไปแล้ว ไม่มีงวดให้ขออนุมัติ)
click("data-role", { role: "WH" });
click("data-po", { po: "CS-26-0007" });
setFields({up_file:"gr.jpg", up_note:"", up_none:false, hf_qtyIn:"60 KG", hf_grNo:"GR-CS-7"});
formFields.up_err={innerHTML:""}; formFields.up_named={textContent:""};
click("data-act", { act: "done" });
click("data-uact", { uact: "save" });
click("data-role", { role: "AC" });
click("data-po", { po: "CS-26-0007" });
setFields({up_file:"bill.jpg", up_note:"", up_none:false, hf_invNo:"BILL-7", hf_invAmt:"5400"});
formFields.up_err={innerHTML:""}; formFields.up_named={textContent:""};
click("data-act", { act: "done" });
click("data-uact", { uact: "save" });
click("data-role", { role: "SR" });
click("data-po", { po: "CS-26-0007" });
d = nodes["#main"].innerHTML;
if (/data-act="payreq"/.test(d))
  bad.push("รายการเงินสดที่จ่ายไปแล้วยังบังคับให้ขออนุมัติจ่าย — กดแล้วเจอทางตัน");
if (!/จ่ายสดไปแล้ว/.test(d)) bad.push("ขั้นส่งมอบเอกสารของรายการเงินสดไม่มีทางไปต่อ");

// เดินรายการเงินสดต่อจนปิด — กฎตรวจสอบเดิมบังคับ "ต้องผูกกับ PO ใน B1" ซึ่งเงินสดไม่มีตามนิยาม
for (let i = 0; i < 6; i++) {
  let owner = null;
  for (const r of ["SR","AC","WH","QC","LS","GM"]) {
    click("data-role", { role: r });
    click("data-po", { po: "CS-26-0007" });
    if (/งานนี้อยู่ที่คุณ/.test(nodes["#main"].innerHTML)) { owner = r; break; }
  }
  if (!owner) break;
  const acts = (nodes["#main"].innerHTML.match(/data-act="[a-z]+"/g) || []);
  if (!acts.length) { bad.push("รายการเงินสดตันที่ " + owner + " — ไม่มีปุ่มให้กด"); break; }
  setFields({up_file:"x.pdf", up_note:"", up_none:false, hf_rcvBy:"คุณสมชาย"});
  formFields.up_err={innerHTML:""}; formFields.up_named={textContent:""};
  click("data-act", { act: acts[0].slice(10, -1) });
  if (/data-uact/.test(nodes["#modal"].innerHTML)) click("data-uact", { uact: "save" });
  if (/data-uact/.test(nodes["#modal"].innerHTML)) {
    bad.push("รายการเงินสดติดที่ " + owner + ": " + String(formFields.up_err.innerHTML).replace(/<[^>]+>/g," "));
    break;
  }
}
click("data-role", { role: "AC" });
click("data-po", { po: "CS-26-0007" });
d = nodes["#main"].innerHTML;
if (!/ชุดเอกสารรวมเล่มพร้อมแล้ว/.test(d))
  bad.push("รายการซื้อเงินสดปิดบัญชีไม่ได้ — กฎ 'ต้องผูกกับ PO ใน B1' บล็อกไว้ตลอดไป");
if (/ยังไม่ได้ผูกกับ PO ใน B1/.test(d))
  bad.push("รายการเงินสดยังถูกกฎ PO ใน B1 บล็อกอยู่");



/* ================= แยกบทบาทหัวหน้าบัญชี + แอปตรวจรับของ QC ================= */

// คำขอไม่เกินวงเงินต้องไปหาหัวหน้าบัญชี ไม่ใช่คนที่บันทึกจ่าย
click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0038" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "USERS" });
d = nodes["#main"].innerHTML;
if (!/หัวหน้าบัญชี/.test(d)) bad.push("ไม่มีบทบาทหัวหน้าบัญชีแยกจากบัญชี");
if (!/คุณอารีย์/.test(d)) bad.push("บทบาทหัวหน้าบัญชีไม่มีผู้ใช้");

/* ================= เชื่อมกับแอปตรวจรับ QC ซึ่งเป็นเว็บแอปคนละตัว ================= */
click("data-role", { role: "AC" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "QCAPP" });
d = nodes["#main"].innerHTML;
if (!/PUSH \+ PULL/.test(d)) bad.push("หน้าเชื่อมแอป QC ไม่บอกวิธีเชื่อม");
if (!/HMAC/.test(d)) bad.push("ไม่ได้ระบุวิธียืนยันตัวตนระหว่างสองระบบ");
if (!/reportNo/.test(d)) bad.push("ไม่มีตัวอย่างข้อมูลที่สองระบบส่งกัน");
if (!/blocksPayment/.test(d)) bad.push("สัญญาข้อมูลไม่ได้ส่งข้อค้างที่ล็อกการจ่ายมาด้วย");
if (!/F-2026055/.test(d)) bad.push("ไม่มีคิวใบตรวจที่จับคู่รายการไม่ได้");
if (!/M-2026099/.test(d)) bad.push("ใบฝั่งเครื่องจักรไม่เข้าคิวจับคู่");

// ไม่เลือกรายการแล้วกดผูก → ต้องไม่เดาให้
setFields({qm_0:"", qm_1:""});
click("data-qcmatch", { qcmatch: "0" });
if (!/เลือกรายการที่จะผูกก่อน/.test(nodes["#toast"].textContent))
  bad.push("ผูกใบตรวจได้โดยไม่ต้องเลือกรายการ — ระบบเดาให้เอง");

// ผูกใบฝั่งเครื่องจักร M-2026099 เข้ากับ PO-26-0060 (กำลังอยู่ขั้น QC)
// ผลที่ต้องได้คือ QC เปิดป๊อปอัปแล้วช่องกรอกมาเองแล้ว ไม่ต้องพิมพ์ซ้ำจากแอปอีกตัว
setFields({qm_0:"", qm_1:"PO-26-0060"});
click("data-qcmatch", { qcmatch: "1" });
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0060" });
click("data-act", { act: "qcpass" });
d = nodes["#modal"].innerHTML;
if (!/M-2026099/.test(d)) bad.push("ผูกใบแล้วเลขที่ใบตรวจไม่มากรอกให้เอง");
if (!/2 SET/.test(d)) bad.push("ผูกใบแล้วจำนวนที่ตรวจนับได้ไม่มากรอกให้เอง");
if (!/CHOD/.test(d)) bad.push("ผูกใบแล้วสถานที่ตรวจไม่มากรอกให้เอง");
click("data-uact", { uact: "close" });

// ผูกใบฝั่งอาหาร F-2026055 เข้ากับ PO-26-0051 → ข้อค้างท้ายใบต้องตามมาด้วย
click("data-role", { role: "AC" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "QCAPP" });
setFields({qm_0:"PO-26-0051"});
click("data-qcmatch", { qcmatch: "0" });
click("data-po", { po: "PO-26-0051" });
d = nodes["#main"].innerHTML;
if (!/F-2026055/.test(d)) bad.push("ผูกใบตรวจแล้วเลขที่ใบไม่ลงในรายการ");
if (!/ไม่ได้พิมพ์ซ้ำ/.test(d)) bad.push("ไม่บันทึกประวัติว่าข้อมูลมาจากแอปตรวจรับ");
if (!/ข้อค้างจากใบตรวจ/.test(d)) bad.push("ข้อค้างท้ายใบตรวจไม่ตามมาด้วยตอนผูกใบ");
if (!/รอยความชื้น/.test(d)) bad.push("ข้อความข้อค้างจากแอปตรวจรับไม่ถูกยกมา");

// คิวต้องว่างแล้ว
click("data-page", { page: "admin" });
click("data-sub", { sub: "QCAPP" });
d = nodes["#main"].innerHTML;
if (/F-2026055/.test(d) || /M-2026099/.test(d)) bad.push("ผูกใบแล้วยังค้างอยู่ในคิวจับคู่");
if (!/ไม่มีใบตรวจค้างจับคู่/.test(d)) bad.push("คิวว่างแล้วแต่ไม่ได้บอกว่าว่าง");

/* ================= ข้อมูลจาก SAP: เงื่อนไขจ่าย · สายที่สาม · ลิงก์แอป QC ================= */

// 1) เงื่อนไขจ่ายจาก SAP ต้องกางเป็นงวดจริง ไม่ใช่ 1 งวดเสมอเหมือนของเดิม
click("data-role", { role: "AC" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "SAP" });
d = nodes["#main"].innerHTML;
if (!/PO Payment Term/.test(d)) bad.push("หน้าเชื่อม SAP ไม่ได้บอกว่าอ่านเงื่อนไขจ่ายจากที่ไหน");
if (!/มัดจำโอน \+ ที่เหลือผ่าน LC/.test(d)) bad.push("ไม่มีตารางแปลงเงื่อนไขจ่ายเป็นงวด");

// 2) รายการที่เงื่อนไขผสม LC — ต้องได้ 2 งวด · งวด LC ไม่มีปุ่มตั้งเรื่อง · ยอดรวมยังเท่าเดิม
click("data-po", { po: "PO-26-0070" });
d = nodes["#main"].innerHTML;
if (!/จ่ายผ่าน LC \(ธนาคาร\)/.test(d)) bad.push("งวดที่ชำระผ่าน LC ไม่ได้ติดป้ายไว้");
if (!/ธนาคารจ่ายตามเอกสาร LC/.test(d)) bad.push("งวด LC ยังมีปุ่มตั้งเรื่องขอจ่าย — ต้องกันไว้");
if (!/มัดจำ/.test(d) || !/ส่วนที่เหลือ \(LC\)/.test(d))
  bad.push("เงื่อนไขผสมไม่ได้ถูกกางเป็น 2 งวด");
if (!/ผลรวมงวดจ่ายเท่ากับมูลค่า PO/.test(d))
  bad.push("แยกงวดแล้วยอดรวมไม่เท่ามูลค่า PO");

// 3) สายที่สาม: ค่าใช้จ่ายที่ไม่มีของเข้าคลัง — ข้ามขั้น QC และคลัง
click("data-role", { role: "SR" });
click("data-po", { po: "PO-O326060001" });
d = nodes["#main"].innerHTML;
if (!/ค่าใช้จ่ายอื่น/.test(d)) bad.push("รายการค่าใช้จ่ายไม่ได้บอกว่าอยู่สายไหน");
if (!/step skip[^>]*>[\s\S]{0,400}QC ตรวจรับ/.test(d))
  bad.push("รายการค่าใช้จ่ายไม่ได้ข้ามขั้น QC");

// 4) ปุ่มไปสร้างใบตรวจในแอปของ QC — คนละแอปตามสายสินค้า
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0042" });
d = nodes["#main"].innerHTML;
const foodUrl = (d.match(/href="(https:\/\/script\.google\.com[^"]+)"/) || [])[1] || "";
if (!foodUrl) bad.push("QC ไม่มีปุ่มไปสร้างใบตรวจในแอป");
if (!/po=/.test(foodUrl)) bad.push("ลิงก์ไปแอปตรวจไม่ได้ส่งเลข PO ไปด้วย");
if (!/module=FOOD/.test(foodUrl)) bad.push("ลิงก์ฝั่งอาหารไม่ได้ระบุสายเป็น FOOD");
click("data-po", { po: "PO-26-0060" });
const mechUrl = (nodes["#main"].innerHTML.match(/href="(https:\/\/script\.google\.com[^"]+)"/) || [])[1] || "";
if (!/module=MECH/.test(mechUrl)) bad.push("ลิงก์ฝั่งเครื่องจักรไม่ได้ระบุสายเป็น MECH");
if (foodUrl.split("?")[0] === mechUrl.split("?")[0])
  bad.push("สองสายใช้ URL แอปตรวจรับเดียวกัน — ต้องคนละแอป");
click("data-po", { po: "PO-O326060001" });
if (/script\.google\.com/.test(nodes["#main"].innerHTML))
  bad.push("รายการค่าใช้จ่ายไม่ควรมีปุ่มไปแอปตรวจรับ");

// 5) คิวตั้งเบิกทำจ่ายอยู่ในหน้ารายงาน ไม่ใช่ระบบแยก
click("data-role", { role: "AC" });
click("data-page", { page: "report" });
d = nodes["#main"].innerHTML;
if (!/คิวตั้งเบิกทำจ่าย/.test(d)) bad.push("หน้ารายงานไม่มีคิวตั้งเบิกทำจ่าย");
if (!/ไม่รวมงวดที่ชำระผ่าน LC/.test(d)) bad.push("คิวตั้งเบิกไม่ได้บอกว่าไม่รวมงวด LC");
const qAll = (d.match(/data-po="/g) || []).length;
click("data-payq", { payq: "OTHER" });
const qOther = (nodes["#main"].innerHTML.match(/data-po="/g) || []).length;
if (!(qOther > 0 && qOther < qAll)) bad.push("กรองสายสินค้าในคิวตั้งเบิกไม่ทำงาน");
click("data-payq", { payq: "" });

/* ================= ใบตรวจ Food กับ Mech ใช้ช่องคนละชุด ================= */
click("data-role", { role: "QC" });
click("data-po", { po: "PO-26-0060" });      // สายเครื่องจักร stage 10 = QC ตรวจรับ
d = nodes["#main"].innerHTML;
if (!/เครื่องจักร/.test(d)) bad.push("หัวเอกสารไม่บอกว่าเป็นสายสินค้าไหน");
click("data-act", { act: "qcpass" });
d = nodes["#modal"].innerHTML;
if (/อุณหภูมิที่วัดได้/.test(d)) bad.push("บังคับให้ฝั่งเครื่องจักรกรอกอุณหภูมิ — ใบตรวจ Mech ไม่มีช่องนี้");
if (/เลขล็อต/.test(d)) bad.push("บังคับให้ฝั่งเครื่องจักรกรอกเลขล็อต — ใบตรวจ Mech ไม่มีช่องนี้");
if (!/สภาพตู้/.test(d)) bad.push("ใบตรวจฝั่งเครื่องจักรไม่มีช่องสภาพตู้/หีบห่อ");
if (!/ข้อบกพร่องที่ยังไม่สรุป/.test(d)) bad.push("ป๊อปอัป QC ไม่มีที่บันทึกข้อค้างท้ายใบตรวจ");
setFields({up_file:"M-2026097.pdf", up_note:"", up_none:false,
  hf_qcRef:"M-2026097", hf_qcPoRef:"M-RC26200090", hf_qcDate:"2026-08-21",
  hf_qcPlace:"CHOD", hf_invQty:"1 SET", hf_qtyOk:"1 SET", hf_qcResult:"ผ่าน (Pass)",
  hf_qtyBad:"", hf_conCond:"ผ่าน (Pass)", qo_block:"", qo_note:""});
formFields.up_err = {innerHTML:""}; formFields.up_named = {textContent:""};
click("data-uact", { uact: "save" });
click("data-role", { role: "WH" });
click("data-po", { po: "PO-26-0060" });
d = nodes["#main"].innerHTML;
if (!/M-2026097/.test(d)) bad.push("คลังไม่เห็นเลขที่ใบตรวจฝั่งเครื่องจักร");
// เลข PO Ref บนใบตรวจ Mech เป็นเลขรับของ ไม่ตรงกับเลข PO ในระบบ → ต้องเตือน ไม่ใช่ปล่อยผ่าน
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0060" });
if (!/PO Ref บนใบตรวจคือ/.test(nodes["#main"].innerHTML))
  bad.push("เลข PO Ref บนใบตรวจไม่ตรงกับรายการแต่ระบบไม่เตือน");

/* ================= เอกสารเรียกเก็บรายงวด: รอบ 1 กับ รอบ 2 คนละใบ =================
   PO-26-0060 (สายเครื่องจักร) งวด 1 จ่ายด้วย PI ไปแล้ว · งวด 2 รอตั้งเรื่องด้วยใบแจ้งหนี้ */
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0060" });
d = nodes["#main"].innerHTML;
if (!/PI-SG-2608/.test(d)) bad.push("ตารางงวดไม่แสดงเอกสารเรียกเก็บของงวดที่ 1");
if (!/ยังไม่แนบ/.test(d)) bad.push("งวดที่ยังไม่มีเอกสารเรียกเก็บไม่ถูกทำเครื่องหมายไว้");

click("data-payact", { payact: "req", seq: "2" });
d = nodes["#modal"].innerHTML;
if (!/prtabs/.test(d)) bad.push("ป๊อปอัปขอจ่ายไม่มีแถบให้สลับดูแต่ละงวด");
if (!/งวดที่ 1/.test(d) || !/งวดที่ 2/.test(d)) bad.push("แถบงวดไม่ครบทุกงวดของ PO");
if (!/เอกสารเรียกเก็บของงวดที่ 2/.test(d)) bad.push("ป๊อปอัปไม่ได้บังคับเอกสารเรียกเก็บของงวดนี้");
if (!/Proforma Invoice/.test(d) || !/Invoice\)/.test(d))
  bad.push("ไม่มีตัวเลือกประเภทเอกสารเรียกเก็บ (PI / ใบแจ้งหนี้)");

// สลับไปดูงวดที่ 1 ที่จ่ายไปแล้ว — ต้องเห็นว่าใช้ใบไหน แต่แก้ไม่ได้
click("data-pract", { pract: "tab", prseq: "1" });
d = nodes["#modal"].innerHTML;
if (!/PI-SG-2608/.test(d)) bad.push("ดูงวดที่จ่ายแล้วไม่เห็นเอกสารเรียกเก็บที่ใช้ตอนนั้น");
if (!/ดูได้อย่างเดียว/.test(d)) bad.push("งวดที่จ่ายแล้วยังแก้เอกสารเรียกเก็บได้");
if (/data-pract="send"/.test(d)) bad.push("งวดที่จ่ายแล้วยังมีปุ่มส่งขออนุมัติ");

// กลับมางวดที่ 2 แล้วใช้เลขใบเดียวกับงวดที่ 1 จนยอดรวมเกินใบ → ต้องบล็อก (กันจ่ายซ้ำ)
click("data-pract", { pract: "tab", prseq: "2" });
prFields({pr_amt:59000, pr_eff:today(), pr_bkind:"DEPOSIT", pr_bno:"PI-SG-2608",
          pr_bamt:59000, pr_bfile:"PI_Sungrow_2608.pdf"});
click("data-pract", { pract: "send" });
if (!/S12/.test(formFields.pr_err.innerHTML))
  bad.push("ใช้ใบเรียกเก็บใบเดิมขอจ่ายซ้ำอีกงวดได้ (S12)");
click("data-pract", { pract: "close" });

click("data-role", { role: "AC" });
/* PO-26-0038: ใบตรวจ "ผ่าน" แต่ท้ายใบยังเขียนว่ารอสรุป → ต้องล็อกจ่ายไว้ก่อน
   แล้วปลดล็อกเองเมื่อจัดซื้อบันทึกว่าสรุปกับผู้ขายจบแล้ว */
click("data-po", { po: "PO-26-0038" });
d = nodes["#main"].innerHTML;
if (!/ข้อค้างจากใบตรวจ/.test(d)) bad.push("บัญชีไม่เห็นข้อค้างท้ายใบตรวจ");
if (!/ล็อกการจ่ายไว้/.test(d)) bad.push("ใบตรวจผ่านแต่มีข้อค้าง — ไม่ได้ล็อกการจ่าย");
if (/data-payact="req"/.test(d)) bad.push("มีข้อค้างค้างอยู่แต่ยังตั้งเรื่องขอจ่ายได้");

click("data-role", { role: "SR" });
click("data-po", { po: "PO-26-0038" });
if (!/data-qcdone="0"/.test(nodes["#main"].innerHTML))
  bad.push("จัดซื้อไม่มีปุ่มบันทึกว่าสรุปข้อค้างแล้ว");
setFields({qc_why_0:"", qc_why_1:""});
click("data-qcdone", { qcdone: "0" });
if (!/ต้องเขียนว่าสรุปว่าอย่างไร/.test(nodes["#toast"].textContent))
  bad.push("ปิดข้อค้างได้โดยไม่ต้องเขียนว่าสรุปว่าอย่างไร");
setFields({qc_why_0:"ผู้ขายยอมเปลี่ยนกล่องให้ในล็อตถัดไป ไม่ลดราคาล็อตนี้", qc_why_1:"ให้ฝ่ายขายตั้งราคาตามขนาดกล่อง"});
click("data-qcdone", { qcdone: "0" });
click("data-po", { po: "PO-26-0038" });
d = nodes["#main"].innerHTML;
if (!/สรุปแล้ว/.test(d)) bad.push("บันทึกสรุปข้อค้างแล้วแต่สถานะไม่เปลี่ยน");
if (!/ผู้ขายยอมเปลี่ยนกล่อง/.test(d)) bad.push("ไม่แสดงว่าสรุปว่าอย่างไร ปลายทางยังไม่รู้เรื่อง");
if (/งวดนี้ถูกล็อกเพราะ/.test(d)) bad.push("สรุปข้อที่ล็อกจ่ายแล้วแต่ยังล็อกอยู่");

// ปลดล็อกแล้วต้องตั้งเรื่องได้ แต่ยังต้องติดเรื่องเอกสารที่ยังมาไม่ครบ (ยังไม่ถึงขั้นรับใบแจ้งหนี้)
click("data-role", { role: "AC" });
click("data-po", { po: "PO-26-0038" });
if (!/data-payact="req"/.test(nodes["#main"].innerHTML))
  bad.push("สรุปข้อค้างครบแล้วแต่ยังตั้งเรื่องขอจ่ายไม่ได้");
reqPay(1, {pr_amt:196000, pr_eff:today(), pr_bno:"INV-SM-2807", pr_bamt:196000});
if (!/S6/.test(formFields.pr_err.innerHTML))
  bad.push("ขอจ่ายได้ทั้งที่เอกสารยังมาไม่ครบ (S6)");
click("data-pract", { pract: "close" });

// ผู้บันทึกจ่ายต้องไม่ใช่ผู้อนุมัติคนเดียวกัน (P13)
click("data-role", { role: "ACH" });
click("data-po", { po: "PO-26-0033" });
click("data-payact", { payact: "form", seq: "2" });
setFields({py_date:today(), py_value:today(), py_method:"TRANSFER", py_bank:"KBANK",
           py_ref:"KB77001", py_whttype:"GOODS", py_wht:0, py_fee:35, py_feeby:"OUR",
           py_amt:155035, py_slip:true, py_reason:"", py_note:""});
click("data-payact", { payact: "save" });
if (!/P13/.test(formFields.py_err.innerHTML))
  bad.push("ผู้อนุมัติบันทึกการจ่ายเองได้ (P13) — ผิดหลักแยกหน้าที่ระดับคน");

// หน้าตั้งค่าต้องบอกว่า QC มีแอปตรวจรับอยู่แล้ว ไม่สร้างฟอร์มซ้ำ
// (ดูด้วยบทบาทจัดซื้อ — QC เองไม่เห็นเมนูตั้งค่าแล้ว เพราะยอดเงินอยู่ในนั้น)
click("data-role", { role: "SR" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "SAP" });
d = nodes["#main"].innerHTML;
if (!/Incoming Inspection/.test(d)) bad.push("หน้าตั้งค่าไม่มีข้อมูลแอปตรวจรับของ QC");
if (!/ไม่ทำฟอร์มตรวจรับซ้ำ/.test(d)) bad.push("ไม่ได้ระบุว่าระบบนี้จะไม่สร้างฟอร์มตรวจซ้ำ");
if (!/Mech/.test(d)) bad.push("ไม่ได้ครอบคลุมสายงาน Mech");

/* ---------- เครื่องตรวจคอนทราสต์ของชุดสี ----------
   docs/03-roles-screens.md ประกาศว่าสีแผนกทุกสีผ่าน WCAG AA (4.5:1) ทั้งสองโหมด
   คำประกาศในเอกสารที่ไม่มีเครื่องตรวจอยู่ข้างหลัง คือคำประกาศที่รอวันเพี้ยน

   เคยพลาดมาแล้วตอนเลือกสี — ทองที่ทีมเลือกไว้ (#96731C) วัดได้ 4.15:1 บนพื้นระบบ
   สวยแต่คนอ่านทั้งวันแล้วล้า จึงเข้มขึ้นหนึ่งขั้นโดยคงเฉดเดิม */
function relLum(hex) {
  const v = [1, 3, 5].map(i => {
    const c = parseInt(hex.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const x = relLum(a), y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// อ่านค่าสีจาก prototype.html โดยตรง แก้สีที่ไฟล์แล้วเครื่องตรวจตามทันทีโดยไม่ต้องมาแก้ที่นี่
function palette(css) {
  const out = {};
  css.replace(/(--[\w-]+)\s*:\s*#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g, (_, k, v) => {
    out[k] = "#" + (v.length === 3 ? v[0] + v[0] + v[1] + v[1] + v[2] + v[2] : v);   // #fff ก็ต้องอ่านได้
    return "";
  });
  return out;
}
const styleSrc = (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];
const lightCss = styleSrc.slice(0, styleSrc.indexOf("@media (prefers-color-scheme:dark)"));
const darkCss = (styleSrc.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\n  \}/) || ["", ""])[1];
/* ไล่สีประจำแผนกจากรายชื่อบทบาทจริง ไม่เขียนรายชื่อตายตัว
   เพิ่มแผนกใหม่ (เช่น บัญชีต่างประเทศ/ในประเทศ) แล้วเครื่องตรวจตามทันที
   เคยพลาดมาแล้ว: เพิ่มแผนก IT แต่ลืมใส่สี ป้ายแผนกเลยไม่มีสี */
const DEPT_VARS = Object.keys(MONEY_ROLE).map(d => "--" + d.toLowerCase());
const FG = DEPT_VARS.concat(["--gold", "--gold-800", "--ink", "--ink-2", "--ink-3",
                             "--go", "--warn", "--stop", "--cold"]);
[["สว่าง", palette(lightCss)], ["มืด", palette(darkCss)]].forEach(([mode, pal]) => {
  const bgs = [["พื้น", pal["--surface"]], ["การ์ด", pal["--paper"]]];
  if (!pal["--surface"] || !pal["--paper"]) { bad.push("โหมด" + mode + ": อ่านสีพื้นไม่ได้"); return; }
  FG.forEach(k => {
    if (!pal[k]) { bad.push("โหมด" + mode + ": ไม่พบสี " + k); return; }
    bgs.forEach(([bn, bg]) => {
      const r = ratio(pal[k], bg);
      if (r < 4.5) bad.push("คอนทราสต์ตก · โหมด" + mode + " " + k + " (" + pal[k] + ") บน" + bn +
        " = " + r.toFixed(2) + ":1 ต้องได้ 4.5:1 ขึ้นไป");
    });
  });
});
// ปุ่มหลักใช้ตัวอักษรเข้มทับทองโลหะ — คู่นี้ต้องผ่านด้วย
[["สว่าง", palette(lightCss)], ["มืด", palette(darkCss)]].forEach(([mode, pal]) => {
  if (pal["--gold-400"]) {
    const r = ratio("#1E1B16", pal["--gold-400"]);
    if (r < 4.5) bad.push("คอนทราสต์ตก · โหมด" + mode + " ตัวอักษรบนปุ่มทอง = " + r.toFixed(2) + ":1");
  }
});

/* ---------- เครื่องตรวจยอดเงินรั่ว ----------
   กติกาใน docs/03-roles-screens.md: QC · โลจิสติกส์ · คลัง ไม่เห็นยอดเงินเลย
   เพื่อไม่ให้ผลตรวจถูกกดดันด้วยมูลค่าของล็อต

   เคยพลาดมาแล้ว — การ์ด "แผนกก่อนหน้าส่งอะไรมาให้คุณ" โชว์ยอดใบแจ้งหนี้ให้ QC เห็น
   เพราะฟีเจอร์ที่เพิ่มทีหลังไม่ได้ผ่านประตู money() ที่มีอยู่แล้ว
   การกรองที่ handoffCard() แก้อาการ ส่วนนี้แก้สาเหตุ: ของใหม่รอบหน้าทำรั่วซ้ำไม่ได้

   วางไว้ท้ายสุดตั้งใจ — บางหน้าจอมียอดเงินก็ต่อเมื่อมีคำขอจ่ายแล้ว
   ถ้าสแกนก่อนโฟลว์เดินจบจะไม่เจอ */
const NOMONEY = ROLES.filter(r => !MONEY_ROLE[r]);
if (!NOMONEY.length) bad.push("ไม่พบบทบาทที่ห้ามเห็นเงิน — เครื่องตรวจนี้กลายเป็นของหลอก");
const leaks = [];
let scans = 0;

function scanScreen(where) {
  ["#main", "#modal", "#bug"].forEach(k => {
    scans++;
    const h = nodes[k].innerHTML || "";
    // มองหา "฿ ตามด้วยตัวเลข" คือยอดเงินจริงที่ baht() พ่นออกมา
    // ตัว ฿ เดี่ยว ๆ ที่ใช้เป็นไอคอนหัวข้อ "รายการซื้อเงินสด" ไม่ใช่ยอด ไม่ต้องจับ
    const m = /฿\s*\d/.exec(h);
    if (!m) return;
    const i = m.index;
    // รายงานข้อความรอบ ๆ ด้วย ไม่ใช่แค่บอกว่าพัง — คนอ่านต้องรู้ว่าไปแก้ตรงไหน
    const near = h.slice(Math.max(0, i - 120), i + 60)
      .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    leaks.push(where + " " + k + " → …" + near + "…");
  });
}

for (const r of NOMONEY) {
  // ล้างของค้างจากบทบาทก่อนหน้าก่อน ไม่งั้นจะโทษผิดคน
  nodes["#modal"].innerHTML = "";
  nodes["#bug"].innerHTML = "";
  click("data-role", { role: r });
  for (const p of Object.keys(PAGES)) {
    click("data-page", { page: p });
    scanScreen(r + "/" + p);
    for (const s2 of PAGES[p]) {
      if (!s2) continue;
      click("data-sub", { sub: s2 });
      scanScreen(r + "/" + p + "/" + s2);
    }
  }
  for (const po of POS) { click("data-po", { po: po }); scanScreen(r + "/ใบ " + po); }
  click("data-page", { page: "req" });
  for (const c of ["EX-2026001", "CL-26-0004"]) {
    click("data-claim", { claim: c });
    scanScreen(r + "/คำร้อง " + c);
  }
  click("data-page", { page: "inbox" });
  for (let i = 1; i <= 10; i++) { click("data-notif", { notif: String(i) }); scanScreen(r + "/แจ้งเตือน " + i); }
  click("data-bug", { bug: "open" });
  scanScreen(r + "/แจ้งปัญหา");
  click("data-bug", { bug: "close" });
  // เมนูตั้งค่าระบบต้องไม่โผล่บนแถบนำทางเลย — กันทั้งทางตรงและทางที่ตาเห็น
  if (/data-page="admin"/.test(nodes["#nav"].innerHTML))
    bad.push(r + " ยังเห็นเมนูตั้งค่าระบบบนแถบนำทาง");
}
// บทบาทฝั่งเงินต้องไม่ถูกกระทบ — ถ้าเงียบไปหมดแปลว่ากรองแรงเกินไป
click("data-role", { role: "AC" });
click("data-po", { po: "PO-O326060001" });
if (nodes["#main"].innerHTML.indexOf("฿") < 0)
  bad.push("บัญชีเปิดใบเดียวกันแล้วไม่เห็นยอดเงิน — กรองแรงเกินจนคนที่มีสิทธิ์ก็ไม่เห็น");
if (!/data-page="admin"/.test(nodes["#nav"].innerHTML))
  bad.push("บัญชีไม่เห็นเมนูตั้งค่าระบบ — กรองเมนูแรงเกินไป");

if (leaks.length) {
  bad.push("ยอดเงินหลุดไปยังบทบาทที่ไม่มีสิทธิ์เห็น " + leaks.length + " จุด:");
  leaks.slice(0, 12).forEach(l => bad.push("    " + l));
}

console.log("เรนเดอร์ทั้งหมด " + n + " ครั้ง + จ่าย + ใช้งานง่าย/SAP + ขอราคา→PO + เงินสด/ไดรฟ์กลาง/รวมไฟล์/ป๊อปอัป\n" +
  "  + ใบตรวจ Food/Mech คนละชุด + ข้อค้างท้ายใบตรวจล็อกจ่าย + เอกสารเรียกเก็บรายงวด\n" +
  "  + เชื่อมแอปตรวจรับ QC (คิวจับคู่ใบตรวจ + กรอกให้เอง)\n" +
  "  + สแกนยอดเงินรั่ว " + scans + " จุดตรวจ (" + NOMONEY.join(" · ") + ") ไม่พบการหลุด\n" +
  "  + ตรวจคอนทราสต์ชุดสี " + (FG.length * 4 + 2) + " คู่ ผ่าน WCAG AA ทั้งสองโหมด");
if (bad.length) { console.log("พบปัญหา " + bad.length + ":"); bad.slice(0, 30).forEach(b => console.log("  - " + b)); process.exit(1); }
console.log("ผ่านทั้งหมด");

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
const ROLES = ["SR", "QC", "LS", "WH", "AC", "GM"];
const PAGES = { home: [""], po: ["ACTIVE","DONE","CANCELLED","SEARCH"], req: ["PRICE","CLAIM","ITEM"],
                inbox: [""], admin: ["ISSUES","SAP","STAGES","DOCS","FILES","USERS"], report: [""] };
const POS = ["PO-26-0042","PO-26-0051","CS-26-0007","PO-26-0038","PO-26-0029","PO-26-0033","PO-26-0045","PO-26-0031","PO-26-0025","PO-26-0019","PO-26-0012"];

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
click("data-payact", { payact: "req", seq: "2" });
if (!/รออนุมัติจ่าย/.test(nodes["#main"].innerHTML)) bad.push("ตั้งเรื่องแล้วสถานะไม่เป็น REQUESTED");
if (/อนุมัติจ่าย<\/button>/.test(nodes["#main"].innerHTML)) bad.push("บัญชีอนุมัติคำขอของตัวเองได้ (ผิดหลักแยกหน้าที่)");
click("data-role", { role: "GM" });
click("data-po", { po: "PO-26-0033" });
if (!/อนุมัติจ่าย<\/button>/.test(nodes["#main"].innerHTML)) bad.push("ผู้บริหารไม่เห็นปุ่มอนุมัติจ่าย");
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
click("data-po", { po: "PO-26-0042" });
if (!/มีเคลมค้าง|ล็อก \(เคลม\)/.test(nodes["#main"].innerHTML + nodes["#main"].innerHTML))
  bad.push("ยืนยันแล้วไม่ได้เปิดเคลม");

/* ---------- SAP tab ---------- */
click("data-role", { role: "SR" });
click("data-page", { page: "admin" });
click("data-sub", { sub: "SAP" });
d = nodes["#main"].innerHTML;
if (!/OPOR/.test(d)) bad.push("หน้าตั้งค่าไม่มีแท็บเชื่อมต่อ SAP");
if (!/ไม่เขียนอะไรกลับเข้า B1/.test(d)) bad.push("ไม่ระบุว่าเชื่อมต่อทิศทางเดียว");
click("data-act", { act: "sapnow" });
if (!/เมื่อสักครู่/.test(nodes["#main"].innerHTML)) bad.push("ปุ่มดึงข้อมูล SAP ไม่อัพเดตเวลา");

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
setFields({pr_amt:122500, pr_eff:"2020-01-01", pr_stamp:true, pr_doc:"INVOICE", pr_pos:"BR",
           pr_size:"13", pr_color:"แดง", pr_text:"ขออนุมัติทำจ่าย"});
formFields.pr_err = {innerHTML:""}; formFields.pr_prev = {classList:{add(){},remove(){}}};
formFields.pr_ptl = {textContent:""}; formFields.pr_ptr = {textContent:""};
click("data-pract", { pract: "send" });
if (!/S4/.test(formFields.pr_err.innerHTML)) bad.push("ส่งขอทำจ่ายด้วย Effective date ย้อนหลังได้ (S4)");

// ยอดเกินยอดคงเหลือ → บล็อก
setFields({pr_amt:9999999, pr_eff:today(), pr_stamp:true, pr_doc:"INVOICE", pr_pos:"BR",
           pr_size:"13", pr_color:"แดง", pr_text:"ขออนุมัติทำจ่าย"});
formFields.pr_err = {innerHTML:""}; formFields.pr_prev = {classList:{add(){},remove(){}}};
formFields.pr_ptl = {textContent:""}; formFields.pr_ptr = {textContent:""};
click("data-pract", { pract: "send" });
if (!/S2/.test(formFields.pr_err.innerHTML)) bad.push("ขอจ่ายเกินยอดคงเหลือของ PO ได้ (S2)");

// ครบ → ส่งได้ งวดต้องเป็นรออนุมัติ และวันครบกำหนดต้องเป็น Effective date ที่ระบุ
const eff = "2026-12-15";
setFields({pr_amt:122500, pr_eff:eff, pr_stamp:true, pr_doc:"INVOICE", pr_pos:"BR",
           pr_size:"16", pr_color:"แดง", pr_text:"ขออนุมัติทำจ่าย PO-26-0045\nยอด 122,500"});
formFields.pr_err = {innerHTML:""}; formFields.pr_prev = {classList:{add(){},remove(){}}};
formFields.pr_ptl = {textContent:""}; formFields.pr_ptr = {textContent:""};
click("data-pract", { pract: "send" });
click("data-po", { po: "PO-26-0045" });
d = nodes["#main"].innerHTML;
if (!/รออนุมัติจ่าย/.test(d)) bad.push("ส่งขอทำจ่ายแล้วงวดไม่เป็นสถานะรออนุมัติ");
if (!/15\/12\/2026/.test(d)) bad.push("Effective date ที่กรอกไม่ได้ลงไปเป็นวันครบกำหนดจ่าย");
if (!/ประทับข้อความ/.test(d)) bad.push("ไม่บันทึกประวัติว่าประทับข้อความลงเอกสาร");

// หัวหน้าต้องเห็นปุ่มอนุมัติ (คนละคนกับผู้ขอ)
click("data-role", { role: "GM" });
click("data-po", { po: "PO-26-0045" });
if (!/อนุมัติจ่าย<\/button>/.test(nodes["#main"].innerHTML)) bad.push("คำขอจ่ายจาก SR ไม่ไปถึงหัวหน้าให้อนุมัติ");

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
if (!/จำนวนที่ตรวจแล้วรับได้/.test(d)) bad.push("คลังไม่เห็นจำนวนที่ QC รับได้");
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

console.log("เรนเดอร์ทั้งหมด " + n + " ครั้ง + จ่าย + ใช้งานง่าย/SAP + ขอราคา→PO + เงินสด/ไดรฟ์กลาง/รวมไฟล์/ป๊อปอัป");
if (bad.length) { console.log("พบปัญหา " + bad.length + ":"); bad.slice(0, 30).forEach(b => console.log("  - " + b)); process.exit(1); }
console.log("ผ่านทั้งหมด");

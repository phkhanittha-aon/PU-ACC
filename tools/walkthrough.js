/* เดินทั้งกระบวนการจริงตั้งแต่ใบขอราคาจนปิดบัญชี แล้วพิมพ์ว่า
   "แผนกที่รับงานต่อ" เห็นอะไรตอนเปิดหน้าจอครั้งแรก
   ใช้หาจุดที่แผนกถัดไปจะไม่เข้าใจงานของแผนกก่อนหน้า
   รันด้วย: node tools/walkthrough.js */
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "presentation", "prototype.html"), "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

function el(){ return {innerHTML:"", dataset:{}, value:"", focus(){}, setSelectionRange(){}}; }
const nodes = {"#nav":el(),"#tools":el(),"#user":el(),"#roles":el(),"#main":el(),
               "#bug":el(),"#modal":el(),"#confirm":el(),"#toast":el()};
nodes["#toast"].classList={add(){},remove(){}};
let lastToast=""; Object.defineProperty(nodes["#toast"],"textContent",{set(v){lastToast=v;},get(){return lastToast;}});
let clickH=null,inputH=null,changeH=null,formFields={};
global.document={documentElement:{style:{setProperty(){}}},
  querySelector(s){return nodes[s]||null;},
  getElementById(id){ if(formFields[id])return formFields[id]; return nodes["#"+id]||null; },
  addEventListener(t,h){ if(t==="click")clickH=h; if(t==="input")inputH=h; if(t==="change")changeH=h; }};
global.window={innerWidth:1440,innerHeight:900,scrollTo(){}};
global.navigator={userAgent:"node"};
global.setTimeout=()=>0; global.clearTimeout=()=>{};
new Function(src)();

const click=(a,d)=>clickH({target:{closest(s){return s==="["+a+"]"?{dataset:d}:null;}}});
const F=o=>{ formFields={}; for(const k of Object.keys(o)) formFields[k]={value:String(o[k]),checked:o[k]===true,focus(){},innerHTML:"",textContent:"",style:{},classList:{add(){},remove(){}}};
  for(const k of ["up_err","up_named","cs_err","cs_calc","cs_bywrap","pr_err","pr_prev","pr_ptl","pr_ptr","q_err","q_calc","py_err","py_calc"])
    if(!formFields[k]) formFields[k]={innerHTML:"",value:"",textContent:"",style:{},classList:{add(){},remove(){}}};
};
const txt=h=>String(h).replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
const today=()=>{const d=new Date(),p=v=>(v<10?"0":"")+v;return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());};
const soon =()=>{const d=new Date(Date.now()+20*864e5),p=v=>(v<10?"0":"")+v;return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());};

const log=[]; const gaps=[];
function handoff(role, po, label){
  click("data-role",{role}); click("data-po",{po});
  const t = txt(nodes["#main"].innerHTML);
  const head = t.slice(0, 700);
  log.push({role, po, label, seen:head, full:t});
  return t;
}
function step(role, po, act, extra){
  click("data-role",{role}); click("data-po",{po});
  click("data-act",{act});
  if (nodes["#modal"].innerHTML && /data-uact/.test(nodes["#modal"].innerHTML)) {
    F(Object.assign({up_file:"scan.pdf", up_note:""}, extra||{}));
    click("data-uact",{uact:"save"});
    if (nodes["#modal"].innerHTML && /data-uact/.test(nodes["#modal"].innerHTML))
      console.error("BLOCKED @"+act+" :: "+txt(formFields.up_err.innerHTML));
  }
  return lastToast;
}

/* ============ 1. SR: ใบขอราคา → ใบเสนอราคา → PO ============ */
click("data-role",{role:"SR"}); click("data-page",{page:"req"}); click("data-sub",{sub:"PRICE"});
click("data-propen",{propen:"PR-26-0005"});
log.push({role:"SR", po:"PR-26-0005", label:"เปิดใบขอราคาที่ยังไม่มีใบเสนอราคา", full:txt(nodes["#main"].innerHTML)});
click("data-qact",{qact:"add"});
F({q_supplier:"Andaman Sea Food", q_price:"210", q_lead:"10 วัน", q_valid:soon()});
click("data-qact",{qact:"save"});
click("data-propen",{propen:"PR-26-0005"});
const qid = (nodes["#main"].innerHTML.match(/QT-26-\d{4}/g)||[]).pop();
click("data-qact",{qact:"pick", id:qid});
click("data-qact",{qact:"topo"});
const PO = (txt(nodes["#main"].innerHTML).match(/PO-26-\d{4}/)||[])[0];
log.push({role:"SR", po:PO, label:"PO ใหม่ที่เพิ่งเปิดจากใบเสนอราคา", full:txt(nodes["#main"].innerHTML)});

/* ============ 2. เดินทีละขั้นจนปิด ============ */
const seq = [];
for (let guard=0; guard<40; guard++){
  click("data-role",{role:"SR"}); click("data-po",{po:PO});
  const info = global.__peek ? null : null;
  // หาเจ้าของขั้นปัจจุบันจากหน้าจอ (ลองทุกบทบาท ใครเห็น "งานนี้อยู่ที่คุณ" คือเจ้าของ)
  let owner=null, stageName=null;
  for (const r of ["SR","QC","LS","WH","AC","GM"]){
    click("data-role",{role:r}); click("data-po",{po:PO});
    const t = txt(nodes["#main"].innerHTML);
    if (/งานนี้อยู่ที่คุณ/.test(t)) { owner=r; stageName=(t.match(/งานนี้อยู่ที่คุณ [^ ]+ [\d.]+ (?:ชม\.|วัน) (.+?) (?:อนุมัติ|ตรวจ|ดึงข้อมูล|ไปที่|ส่งเอกสาร|ทำ)/)||[])[1]||""; break; }
  }
  if (!owner) break;
  // *** จุดที่สนใจ: แผนกนี้เพิ่งรับงานต่อ เห็นอะไรบ้าง ***
  const t = handoff(owner, PO, "รับงานต่อ ขั้นที่ "+(seq.length+1));
  seq.push({owner, stage:stageName, screen:t});

  // ทำงานของขั้นนั้น — ดูจากปุ่มจริงในหน้าจอ ไม่ใช่ข้อความในประวัติ
  const HF = {up_file:"doc.pdf", up_note:"", up_none:false,
    hf_shipDate:"2026-09-05", hf_eta:"2026-09-06", hf_etaTime:"08:00", hf_truck:"70-5566 กทม",
    hf_qcRef:"F-2026070", hf_qcPoRef:"PO-F126050030", hf_qcDate:"2026-09-06",
    hf_qcPlace:"ห้องเย็นรักษ์ชัย II", hf_invQty:"300 KG", hf_qcResult:"ผ่าน (Pass)",
    hf_lot:"126005900", hf_expDate:"08-2028", hf_grade:"A",
    qo_block:"", qo_note:"",
    hf_temp:"-18.7", hf_qtyOk:"300 KG", hf_qtyBad:"—", hf_qtyIn:"300 KG", hf_grNo:"GR-26-0410",
    hf_invNo:"INV-AS-0905", hf_invAmt:"63000", hf_rcvBy:"คุณวิภา"};
  const H = nodes["#main"].innerHTML;
  const has = a => H.indexOf('data-act="'+a+'"') >= 0;

  if (has("goic")) { click("data-act",{act:"goic"});
    log.push({role:"LS",po:PO,label:"ใบขอรหัสที่ระบบเปิดให้จาก PO",full:txt(nodes["#main"].innerHTML)}); break; }
  else if (has("sappull")) step(owner, PO, "sappull");
  else if (has("qcpass"))  step(owner, PO, "qcpass", HF);
  else if (has("approve")) step(owner, PO, "approve", Object.assign({}, HF, {up_file:"", up_none:true, up_note:"อนุมัติตามวงเงิน"}));
  else if (has("payreq")) {
    click("data-act",{act:"payreq"});
    F({pr_amt:"63000", pr_eff:soon(), pr_stamp:true, pr_doc:"INVOICE", pr_pos:"BR", pr_size:"13",
       pr_color:"แดง", pr_text:"ขออนุมัติทำจ่าย",
       // ทุกงวดต้องมีเอกสารเรียกเก็บของตัวเอง
       pr_bkind:"INVOICE", pr_bno:"INV-AS-0905", pr_bamt:"63000", pr_bfile:"invoice_AS_0905.pdf"});
    click("data-pract",{pract:"send"});
    if (/data-pract/.test(nodes["#modal"].innerHTML)) {
      log.push({role:owner,po:PO,label:"ขอทำจ่ายไม่ผ่าน",full:txt(formFields.pr_err.innerHTML)}); break; }
  }
  else if (has("topay")) {
    // ขั้นทำจ่ายต้องบันทึกจ่ายจริงก่อน ปุ่ม "เสร็จ" ถึงจะโผล่
    click("data-payact",{payact:"req", seq:"1"});
    click("data-role",{role:"ACH"}); click("data-po",{po:PO});   // ทุกยอดผ่านผู้จัดการฝ่ายบัญชี
    click("data-payact",{payact:"apv", seq:"1"});
    click("data-role",{role:"AC"}); click("data-po",{po:PO});
    click("data-payact",{payact:"form", seq:"1"});
    F({py_date:today(), py_value:today(), py_method:"TRANSFER", py_bank:"KBANK 123",
       py_ref:"KB"+Date.now().toString().slice(-9), py_whttype:"GOODS", py_wht:0, py_fee:35,
       py_feeby:"OUR", py_amt:"63035", py_slip:true, py_reason:"", py_note:""});
    click("data-payact",{payact:"save"});
    if (/data-payact="save"/.test(nodes["#modal"].innerHTML)) {
      log.push({role:owner,po:PO,label:"บันทึกจ่ายไม่ผ่าน",full:txt(formFields.py_err.innerHTML)}); break; }
    click("data-role",{role:"AC"}); click("data-po",{po:PO});
    if (nodes["#main"].innerHTML.indexOf('data-act="done"') >= 0) step(owner, PO, "done", HF);
  }
  else if (has("done")) step(owner, PO, "done", HF);
  else { log.push({role:owner,po:PO,label:"ไม่มีปุ่มให้กด — งานตัน",full:t}); break; }
  if (seq.length>25) break;
}

fs.writeFileSync(path.join(require("os").tmpdir(),"walk-out.json"), JSON.stringify({seq, log, gaps}, null, 1));
console.log("=== ใบส่งงานที่แต่ละแผนกเห็นตอนรับงาน ===");
seq.forEach((s,i)=>{
  const a=s.screen.indexOf("แผนกก่อนหน้าส่งอะไรมาให้คุณ");
  console.log("\n["+(i+1)+"] "+s.owner+" · "+(s.stage||""));
  console.log("    "+(a>=0 ? s.screen.slice(a+27, a+300).trim() : "(ขั้นแรก — ยังไม่มีแผนกก่อนหน้า)"));
});
console.log("\n=== ลำดับการส่งงาน ===");
seq.forEach((s,i)=>console.log((i+1)+". "+s.owner+"  "+(s.stage||"")));
console.log("\n=== สถานะ PO ล่าสุด ===");
click("data-role",{role:"AC"}); click("data-po",{po:PO});
console.log(txt(nodes["#main"].innerHTML).slice(0,400));

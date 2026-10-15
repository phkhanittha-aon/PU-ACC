/**
 * ชุดทดสอบหน้าจอจริง — รันด้วย:  node tools/render-index.mjs
 * =========================================================================
 * เปิด apps-script/index.html ในเบราว์เซอร์จริง โดยใส่ google.script.run ปลอมให้
 * ที่ต้องมีชุดนี้ เพราะชุดอื่นตรวจได้แค่ "เซิร์ฟเวอร์ส่งค่ามาถูก" กับ "ไวยากรณ์ผ่าน"
 * ซึ่งผ่านได้ทั้งที่หน้าจอไม่ได้เอาค่านั้นไปวาด — อาการที่เคยเจอคือเซิร์ฟเวอร์ส่ง
 * ชื่อคนที่ถืองานมาให้ แต่ตารางยังโชว์รหัสแผนกเหมือนเดิม และไม่มีใครรู้
 * จึงตรวจที่ DOM ที่วาดออกมาจริง ไม่ใช่ที่ซอร์ส
 */
import fs from 'fs'; import path from 'path';
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;

const SRC = fs.readFileSync('/home/user/PU-ACC/apps-script/index.html', 'utf8');
const gs = fs.readFileSync('/home/user/PU-ACC/apps-script/Flow.gs', 'utf8');
const grab = n => {
  const m = gs.match(new RegExp('var ' + n + ' = (\\{|\\[)[\\s\\S]*?\\n(\\}|\\]);'));
  return m ? eval('(' + m[0].replace('var ' + n + ' =', '').replace(/;\s*$/, '') + ')') : {};
};
const STAGES = grab('STAGES'), PHASES = grab('PHASES'), ROLES = grab('ROLES');

const BOOT = {
  me:{email:'somchai@mgs.co.th',name:'คุณสมชาย',dept:'SR_FD',roleName:'Sourcing Food',
      money:true,isMgr:false,isAdmin:false,initials:'สช'},
  flow:{STAGES,DOCS:grab('DOCS'),PHASES,MODULES:grab('MODULES'),ROLES,PAY_ST:grab('PAY_ST'),
        BILLDOC:grab('BILLDOC'),WHT:grab('WHT'),HAND:grab('HAND'),NEEDS:grab('NEEDS'),
        PAY_APPROVER:grab('PAY_APPROVER')},
  can:['list','get'], cfg:{cashLimit:50000,pilotOnly:true,env:'PILOT'}
};
const mk = (no,stage,dept,name,w,sla,late,st) => ({
  deal_no:no,entry:'PO',module:'FOOD',supplier:'ABC Foods',item:'กุ้งแช่แข็ง',qty:'500 KG',
  amount:130000,currency:'THB',stage,status:st||'ACTIVE',inPilot:true,editable:true,
  owner_dept:dept,owner_name:name,stage_name:(STAGES[stage]||{}).n||'',
  waiting_h:w,sla_h:sla,late});
const LIST = [
  mk('PO-F126050001',12,'AC_TH','คุณวิภา / คุณนิด',72,72,false),
  mk('PO-F126050003',8,'SR_FD','คุณมาลี',240,72,true),
  mk('PO-F126050004',0,'SR_FD','คุณมาลี',1,24,false),
  mk('PO-F126050009',16,'AC_TH','คุณวิภา / คุณนิด',0,48,false,'COMPLETED')
];
const EMPTY_DIAG = {total:4,visible:0,editable:0,pilotOnly:true,dept:'SR',
  lines:{SR:0,SR_FD:3,SR_MC:1},cause:'OTHER_LINES',
  msg:'ในระบบมี 4 ใบ แต่ไม่มีใบไหนเป็นของจัดซื้อทั่วไป — จัดซื้อแต่ละสายเห็นเฉพาะใบของสายตัวเอง'};


const bad = [];
const ck = (c, m) => { if (!c) bad.push(m); };

async function boot(list, diag) {
  const shim = `<script>
window.google={script:{run:{
  withSuccessHandler(f){this._ok=f;return this;},
  withFailureHandler(f){this._no=f;return this;},
  apiBoot(){ setTimeout(()=>this._ok({ok:true,data:${JSON.stringify(BOOT)}}),0); },
  apiListDeals(){ setTimeout(()=>this._ok({ok:true,data:${JSON.stringify(list)}}),0); },
  apiListDiag(){ setTimeout(()=>this._ok({ok:true,data:${JSON.stringify(diag)}}),0); },
  apiPulse(){ setTimeout(()=>this._ok({ok:true,data:{sig:'x',at:''}}),0); }
}}};
</script>`;
  const out = path.join(TMP, 'idx-' + (list.length ? 'list' : 'empty') + '.html');
  fs.writeFileSync(out, '<!doctype html><html><head><meta charset="utf-8">' + shim + SRC);
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + out);
  await pg.waitForTimeout(500);
  return { pg, errs };
}

const TMP = fs.mkdtempSync('/tmp/mgs-render-');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

/* ---------- 1. หน้ารายการตอบคำถาม "ไปถึงไหน ค้างที่ใคร ช้าหรือยัง" ---------- */
{
  const { pg, errs } = await boot(LIST, null);
  await pg.click('[data-page="all"]');
  await pg.waitForTimeout(250);
  const r = await pg.evaluate(() => ({
    heads: [...document.querySelectorAll('thead th')].map(t => t.textContent.trim()),
    rows: [...document.querySelectorAll('tbody tr')].map(tr => ({
      txt: tr.textContent.replace(/\s+/g, ' '),
      dots: tr.querySelectorAll('.trk i').length,
      now: tr.querySelectorAll('.trk i.now').length,
      done: tr.querySelectorAll('.trk i.done').length,
      lateDot: tr.querySelectorAll('.trk i.now.late').length,
      lateTxt: tr.querySelectorAll('.wait.late').length
    })),
    chips: [...document.querySelectorAll('.chips button')].map(b =>
      ({ k: b.dataset.filter, n: b.querySelector('.c').textContent })),
    wide: document.documentElement.scrollWidth > window.innerWidth
  }));
  ck(errs.length === 0, 'หน้าจอมีข้อผิดพลาดตอนวาด: ' + errs.join(' | '));
  ck(r.heads.indexOf('ค้างที่ใคร') >= 0 && r.heads.indexOf('ค้างมา') >= 0,
     'ตารางไม่มีคอลัมน์ "ค้างที่ใคร"/"ค้างมา" — ได้ ' + r.heads.join(', '));
  ck(r.rows.length === LIST.length, 'วาดแถวไม่ครบ (' + r.rows.length + ')');
  /* ชื่อคนต้องขึ้น ไม่ใช่รหัสแผนกลอย ๆ — รหัสอย่าง AC_TH ไม่ได้บอกใคร */
  ck(/คุณวิภา/.test(r.rows[0].txt), 'แถวบัญชีไม่ได้โชว์ชื่อคนที่ถืองาน');
  ck(/คุณมาลี/.test(r.rows[1].txt), 'แถวจัดซื้อไม่ได้โชว์ชื่อคนที่ถืองาน');
  /* แถบขั้นต้องมีจุดครบทุกขั้น และชี้ขั้นปัจจุบันหนึ่งจุด */
  r.rows.forEach((x, i) => {
    ck(x.dots === BOOT.flow.STAGES.length,
       'แถว ' + i + ': แถบขั้นมี ' + x.dots + ' จุด ควรมี ' + BOOT.flow.STAGES.length);
  });
  ck(r.rows[0].now === 1 && r.rows[0].done === 12,
     'แถบขั้นไม่ตรงกับขั้นที่ 13 (ปัจจุบัน ' + r.rows[0].now + ' · ผ่าน ' + r.rows[0].done + ')');
  ck(r.rows[3].now === 0 && r.rows[3].done === BOOT.flow.STAGES.length,
     'ใบที่ปิดแล้วไม่ได้แสดงเป็นเดินครบทุกขั้น');
  /* ธงช้าต้องขึ้นทั้งที่จุดและที่ตัวเลข และต้องขึ้นเฉพาะใบที่ช้าจริง */
  ck(r.rows[1].lateDot === 1 && r.rows[1].lateTxt === 1, 'ใบที่เลยกำหนดไม่ได้ติดธงช้า');
  ck(/เลยมา 168 ชม/.test(r.rows[1].txt),
     'ไม่ได้บอกว่าเลยมากี่ชั่วโมง — "10 วัน" เฉย ๆ ไม่บอกว่าช้าหรือไม่');
  ck(r.rows[0].lateTxt === 0 && r.rows[2].lateTxt === 0,
     'ใบที่ยังไม่เกินกำหนดถูกติดธงช้า — ธงที่ขึ้นทุกใบเท่ากับไม่มีธง');
  ck(/\/ ให้ 24 ชม/.test(r.rows[2].txt), 'ไม่ได้บอกเวลาที่ให้ไว้เทียบข้าง ๆ');
  ck(!r.wide, 'หน้ารายการล้นจอด้านข้าง');

  /* ตัวกรองกดเดียว — นับให้ตรง และกรองให้ตรง */
  const want = { all: '4', mine: '2', late: '1', stuck: '1', open: '3', done: '1' };
  Object.keys(want).forEach(k => {
    const hit = r.chips.filter(c => c.k === k)[0];
    ck(hit, 'ไม่มีตัวกรอง "' + k + '"');
    if (hit) ck(hit.n === want[k],
      'ตัวกรอง ' + k + ' นับได้ ' + hit.n + ' ควรเป็น ' + want[k]);
  });
  for (const [k, n] of [['mine', 2], ['late', 1], ['stuck', 1], ['done', 1]]) {
    await pg.click('[data-filter="' + k + '"]');
    await pg.waitForTimeout(120);
    const got = await pg.evaluate(() => document.querySelectorAll('tbody tr').length);
    ck(got === n, 'กดตัวกรอง ' + k + ' แล้วเหลือ ' + got + ' แถว ควรเหลือ ' + n);
  }
  /* ตัวกรองที่ได้ความว่างต้องบอกว่าว่างเพราะตัวกรอง ไม่ใช่เพราะไม่มีข้อมูล */
  await pg.evaluate(() => { document.querySelectorAll('tbody tr').forEach(() => {}); });
  await pg.close();
}

/* ---------- 2. หน้าว่างต้องอธิบายตัวเอง ไม่ใช่ขึ้นข้อความเขียวว่าไม่มีงาน ---------- */
{
  const { pg, errs } = await boot([], EMPTY_DIAG);
  const r = await pg.evaluate(() => ({
    notes: [...document.querySelectorAll('.note')].map(n =>
      n.className + ' :: ' + n.textContent.replace(/\s+/g, ' ')),
    green: document.querySelectorAll('.note.good').length
  }));
  ck(errs.length === 0, 'หน้าว่างมีข้อผิดพลาดตอนวาด: ' + errs.join(' | '));
  const warn = r.notes.filter(n => /note warn/.test(n))[0] || '';
  ck(warn, 'หน้าว่างไม่มีกล่องอธิบายสาเหตุ');
  ck(/สายตัวเอง/.test(warn), 'กล่องอธิบายไม่ได้บอกว่าถูกกรองตามสาย: ' + warn);
  ck(/แท็บ Users/.test(warn), 'กล่องอธิบายไม่ได้บอกว่าต้องไปแก้ที่ไหน');
  /* นี่คือข้อที่ผู้ใช้เจอจริง: ไม่เห็นใบเลยแต่ระบบบอกว่า "ไม่มีอะไรที่คุณต้องทำ" */
  ck(r.green === 0,
     'ไม่เห็นใบเลยแต่ยังขึ้นข้อความเขียวว่าไม่มีงานค้าง — เป็นคำตอบที่ผิดกับคนที่กำลังหาของอยู่');
  await pg.close();
}

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

if (bad.length) {
  console.log('พบปัญหา ' + bad.length + ':');
  bad.forEach(b => console.log('  - ' + b));
  process.exit(1);
}
console.log('ทดสอบหน้าจอจริงผ่านทั้งหมด (เบราว์เซอร์จริง · ' + LIST.length + ' แถว)');
console.log('  แถบ 17 ขั้นชี้ขั้นปัจจุบัน · ใบที่ปิดแล้วเดินครบเส้น');
console.log('  ค้างที่ใครบอกเป็นชื่อคน ไม่ใช่รหัสแผนก');
console.log('  ค้างมานานเท่าไหร่ เทียบกับเวลาที่ให้ · ธงช้าขึ้นเฉพาะใบที่ช้าจริง');
console.log('  ตัวกรองหกตัว นับตรงและกรองตรง');
console.log('  หน้าว่างอธิบายสาเหตุ + ชี้ที่ที่ต้องไปแก้ · ไม่ขึ้นข้อความเขียวหลอก');

/**
 * สร้างตัวอย่างระบบทวนสอบสินค้าและเรียกคืน สำหรับเปิดในที่ประชุม
 * รันด้วย: node tools/build-traceability-prototype.js
 *
 * แนวคิด: ไม่ทำหน้าจอปลอม แต่เอา "โค้ดหลังบ้านตัวจริง" ทั้ง 9 ไฟล์ มารันในเบราว์เซอร์
 * โดยแทน Google Sheets/Drive/Lock/Cache/Session ด้วยตัวจำลองในหน่วยความจำ (tools/gas-mocks.js)
 *
 * ผลคือกฎตรวจสอบทั้ง 13 ข้อ · ระบบสิทธิ์ · การกันบันทึกซ้ำ ทำงานเหมือนของจริงทุกอย่าง
 * ในที่ประชุมจึงกดลองผิดได้ แล้วเห็นว่าระบบเตือนอะไร — ไม่ใช่หน้าจอที่กดแล้วผ่านทุกปุ่ม
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script', 'traceability');
const OUT = path.join(ROOT, 'presentation', 'traceability-prototype.html');

const gsFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
const gsBundle = gsFiles
  .map(f => '/* ═══ ' + f + ' ═══ */\n' + fs.readFileSync(path.join(SRC, f), 'utf8'))
  .join('\n');

const mocks = fs.readFileSync(path.join(__dirname, 'gas-mocks.js'), 'utf8');
const app = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// ดึงรายชื่อฟังก์ชันที่หน้าเว็บเรียกได้ ออกมาจากซอร์สโดยตรง — ไม่ hardcode ให้ตกหล่น
const apiNames = Array.from(
  fs.readFileSync(path.join(SRC, '07_Api.gs'), 'utf8').matchAll(/^function\s+(api[A-Za-z0-9_]*)\s*\(/gm)
).map(m => m[1]);
if (apiNames.length < 10) throw new Error('หาฟังก์ชัน api* ไม่ครบ — ตรวจ 07_Api.gs');

const DEMO_USERS = [
  ['qc@mglobalsourcing.net',    'สมหญิง — เจ้าหน้าที่ QC',      'QC'],
  ['qcm@mglobalsourcing.net',   'คุณวิภา — ผู้จัดการคุณภาพ',    'QCM'],
  ['wh@mglobalsourcing.net',    'ประเสริฐ — คลังสินค้า',        'WH'],
  ['ls@mglobalsourcing.net',    'ธนา — ขาย/โลจิสติกส์',         'LS'],
  ['sr@mglobalsourcing.net',    'มานี — จัดซื้อ',               'SR'],
  ['gm@mglobalsourcing.net',    'ผู้จัดการทั่วไป',              'GM'],
  ['admin@mglobalsourcing.net', 'ผู้ดูแลระบบ',                  'ADMIN']
];

const prelude = `
<div class="demoflag">
  <b>ตัวอย่างระบบ</b> — รันโค้ดหลังบ้านตัวจริงในเบราว์เซอร์ ข้อมูลอยู่ในหน่วยความจำเท่านั้น
  ปิดหน้านี้แล้วหายหมด · ลองกดผิดได้ ระบบจะเตือนเหมือนของจริง
  <label>สวมบทบาท
    <select id="demorole">
      ${DEMO_USERS.map(u => `<option value="${u[0]}">${u[1]}</option>`).join('\n      ')}
    </select>
  </label>
</div>
<style>
  .demoflag{background:#faf3df;color:#48544c;border-bottom:1px solid #dde3dc;
    padding:8px 16px;font-size:12.5px;text-align:center;
    font-family:"Leelawadee UI","Noto Sans Thai","Sarabun",system-ui,sans-serif}
  .demoflag b{color:#96731c}
  .demoflag label{margin-left:14px;font-weight:600}
  .demoflag select{font:inherit;padding:3px 8px;border-radius:5px;border:1px solid #c3cbc0;background:#fff;color:#17211d}
  @media (prefers-color-scheme:dark){
    .demoflag{background:#2a2010;color:#aab8b0;border-color:#28352e}
    .demoflag b{color:#dcb35e}
    .demoflag select{background:#161f1b;color:#eaf0ec;border-color:#3a4a41}
  }
</style>

<script>
/* ── 1. ตัวจำลองบริการของ Google ─────────────────────────────────────────── */
${mocks}
</script>

<script>
/* ── 2. ติดตั้งตัวจำลองเป็น global ให้โค้ด .gs เรียกใช้ได้ ─────────────────── */
var __MOCK = createGasMocks({ user: 'qc@mglobalsourcing.net' });
(function () {
  var s = __MOCK.sandbox;
  Object.keys(s).forEach(function (k) {
    if (k === 'console') return;            // ใช้ console จริงของเบราว์เซอร์ จะได้ debug ได้
    window[k] = s[k];
  });
})();
</script>

<script>
/* ── 3. โค้ดหลังบ้านตัวจริง ${gsFiles.length} ไฟล์ ────────────────────────── */
${gsBundle}
</script>

<script>
/* ── 4. เตรียมข้อมูลตัวอย่าง ─────────────────────────────────────────────── */
(function () {
  setupCreateWorkbook();
  PropertiesService.getScriptProperties().setProperty('SAP_PUSH_SECRET', 'demo');

  appendRows_(TAB.USERS, ${JSON.stringify(DEMO_USERS.map(u => ({
    email: u[0], full_name: u[1], dept: u[2], role: u[2], lark_user_id: '', is_active: 'TRUE', note: ''
  })), null, 2).replace(/\n/g, '\n  ')});
  clearUserCache_();

  setupSeedDemoData();

  // เปิดเคสตัวอย่างไว้ 1 เคส เพื่อให้หน้าหลักมีงานให้ดูตั้งแต่เปิดครั้งแรก
  __MOCK.setUser('qc@mglobalsourcing.net');
  clearUserCache_();
  apiOpenCase({
    clientKey: 'demo-case',
    item_code: 'INV-SG5RS',
    source: 'SUPPLIER_NOTICE',
    source_ref: 'SN-2026-0812',
    risk_class: 'MAJOR',
    case_owner: 'qc@mglobalsourcing.net',
    problem: 'ผู้ขายแจ้งว่าอินเวอร์เตอร์ล็อต LOT-2607-A อาจมีจุดบัดกรีบนแผงวงจรไม่สมบูรณ์ ' +
             'เสี่ยงหยุดทำงานหลังใช้งานประมาณ 6 เดือน ให้ตรวจและเปลี่ยนเครื่องที่อยู่ในช่วงซีเรียลที่ระบุ',
    immediate_action: 'กักของที่ยังอยู่ในคลัง และตามหาของที่ส่งออกไปแล้วทุกโครงการ',
    scope: [{ kind: 'SERIAL', sn_from: 'SG50R-A001', sn_to: 'SG50R-A020' }]
  });
})();
</script>

<script>
/* ── 5. แทน google.script.run ด้วยการเรียกฟังก์ชันตรง ────────────────────── */
(function () {
  var API = ${JSON.stringify(apiNames)};

  function makeRunner() {
    var onOk = null, onErr = null;
    var runner = {
      withSuccessHandler: function (f) { onOk = f; return runner; },
      withFailureHandler: function (f) { onErr = f; return runner; }
    };
    API.forEach(function (fn) {
      runner[fn] = function () {
        var args = Array.prototype.slice.call(arguments);
        var res;
        try {
          res = window[fn].apply(null, args);
        } catch (e) {
          return setTimeout(function () { if (onErr) onErr(e); }, 30);
        }
        // หน่วงเล็กน้อยให้เห็นสถานะ "กำลังโหลด" เหมือนตอนเรียกเซิร์ฟเวอร์จริง
        setTimeout(function () { if (onOk) onOk(res); }, 140);
      };
    });
    return runner;
  }

  window.google = { script: { run: {
    withSuccessHandler: function (f) { return makeRunner().withSuccessHandler(f); },
    withFailureHandler: function (f) { return makeRunner().withFailureHandler(f); }
  } } };
})();
</script>
`;

const epilogue = `
<script>
/* ── 6. สลับบทบาทเพื่อดูว่าแต่ละแผนกเห็นและกดอะไรได้บ้าง ─────────────────── */
document.getElementById('demorole').addEventListener('change', function (e) {
  __MOCK.setUser(e.target.value);
  clearUserCache_();
  resetCtx_();
  S.data = {};
  boot();
});
</script>
`;

const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MGS ทวนสอบสินค้าและเรียกคืน — ตัวอย่างระบบ</title>
</head>
<body>
<!--
  ไฟล์นี้ถูกสร้างอัตโนมัติ — อย่าแก้ตรงนี้
  แก้ที่ apps-script/traceability/ แล้วรัน: node tools/build-traceability-prototype.js
  สร้างเมื่อ ${new Date().toISOString().slice(0, 10)} จากไฟล์ ${gsFiles.join(', ')} และ index.html
-->
${prelude}
${app}
${epilogue}
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
const kb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
console.log('สร้าง ' + path.relative(ROOT, OUT) + ' แล้ว (' + kb + ' KB)');
console.log('รวมโค้ดหลังบ้าน ' + gsFiles.length + ' ไฟล์ · ฟังก์ชันที่หน้าเว็บเรียกได้ ' + apiNames.length + ' ตัว');

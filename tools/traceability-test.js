/**
 * ชุดทดสอบระบบทวนสอบสินค้าและเรียกคืน — รันด้วย: node tools/traceability-test.js
 *
 * ทำไมต้องมี: Apps Script ไม่มี test runner และการทดสอบบนของจริงหมายถึง
 * เขียนทับข้อมูลในชีตจริง ไฟล์นี้จึงจำลอง Sheets/Drive/Lock/Cache/Session
 * ขึ้นในหน่วยความจำ แล้วโหลดโค้ด .gs ทั้งชุดมารันตรง ๆ
 * ตรรกะการทวนสอบ การกระทบยอด สิทธิ์ และการกันบันทึกซ้ำ จึงทดสอบได้จริงก่อนขึ้นระบบ
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, '..', 'apps-script', 'traceability');

/* ═════════════════════════════════════════════════════════════════════════
   1. จำลองบริการของ Google
   ═════════════════════════════════════════════════════════════════════════ */
const { createGasMocks } = require('./gas-mocks');

const M = createGasMocks({ user: 'admin@mgs.co.th' });
const sandbox = M.sandbox;
const store = M.store;

vm.createContext(sandbox);
// ปกติทดสอบจากไฟล์แยก 9 ไฟล์ · ตั้ง TRACE_SRC=dist เพื่อทดสอบไฟล์ Code.gs ที่รวมแล้ว
// (ต้องทดสอบทั้งสองแบบ เพราะสิ่งที่ผู้ใช้เอาไปวางจริงคือไฟล์รวม)
const USE_DIST = process.env.TRACE_SRC === 'dist';
const FILES = USE_DIST
  ? ['dist/Code.gs']
  : fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.gs')).sort();
const bundle = FILES.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).join('\n');
vm.runInContext(bundle, sandbox, { filename: 'traceability-bundle.js' });

const G = sandbox;   // ทุกฟังก์ชันของแอปเป็น global ใน sandbox

/* ═════════════════════════════════════════════════════════════════════════
   2. เครื่องมือทดสอบ
   ═════════════════════════════════════════════════════════════════════════ */
let pass = 0, fail = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    fail++;
    failures.push({ name, message: e.message, stack: e.stack });
    console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + e.message);
  }
}
function group(title) { console.log('\n\x1b[1m' + title + '\x1b[0m'); }
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || 'ค่า') + ': ได้ ' + JSON.stringify(actual) + ' แต่ควรเป็น ' + JSON.stringify(expected));
  }
}
function near(actual, expected, what) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.001) {
    throw new Error((what || 'ค่า') + ': ได้ ' + actual + ' แต่ควรเป็น ' + expected);
  }
}
function truthy(v, what) { if (!v) throw new Error((what || 'เงื่อนไข') + ' ไม่เป็นจริง'); }
function throws(fn, needle, what) {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e.message || e); }
  if (msg === null) throw new Error((what || 'ฟังก์ชัน') + ' ควรโยน error แต่ทำงานผ่าน');
  if (needle && msg.indexOf(needle) === -1) {
    throw new Error((what || 'error') + ' ควรมีข้อความ "' + needle + '" แต่ได้ "' + msg + '"');
  }
}
function rejects(res, needle, what) {
  truthy(res && res.ok === false, (what || 'คำสั่ง') + ' ควรถูกปฏิเสธ แต่ได้ ok=' + (res && res.ok));
  if (needle && String(res.error).indexOf(needle) === -1) {
    throw new Error((what || 'ข้อความ') + ' ควรมี "' + needle + '" แต่ได้ "' + res.error + '"');
  }
}
function accepts(res, what) {
  truthy(res && res.ok === true, (what || 'คำสั่ง') + ' ควรสำเร็จ แต่ได้: ' + (res && res.error));
  return res.data;
}
function as(email) { M.setUser(email); G.clearUserCache_(); }
function rows(tab) { return G.readTable_(tab, true).rows; }

/* ═════════════════════════════════════════════════════════════════════════
   3. การทดสอบ
   ═════════════════════════════════════════════════════════════════════════ */
console.log('\n\x1b[1mชุดทดสอบระบบทวนสอบสินค้าและเรียกคืน\x1b[0m');
console.log('โหลดไฟล์: ' + FILES.join(', '));

/* ── A. ติดตั้ง ─────────────────────────────────────────────────────── */
group('A. ติดตั้งระบบ');

t('setupCreateWorkbook สร้างแท็บครบทุกตาราง', () => {
  G.setupCreateWorkbook();
  const missing = Object.keys(G.SCHEMA).filter(tab => !store.ss.getSheetByName(tab));
  eq(missing.length, 0, 'แท็บที่ขาด ' + missing.join(','));
});

t('header ของทุกแท็บตรงกับ SCHEMA', () => {
  Object.keys(G.SCHEMA).forEach(tab => {
    const want = G.SCHEMA[tab];
    const got = store.ss.getSheetByName(tab).getRange(1, 1, 1, want.length).getValues()[0];
    want.forEach((h, i) => eq(String(got[i]), h, tab + ' คอลัมน์ ' + (i + 1)));
  });
});

t('เพิ่มผู้ใช้ 5 บทบาท', () => {
  G.appendRows_(G.TAB.USERS, [
    { email: 'admin@mgs.co.th', full_name: 'ผู้ดูแลระบบ', dept: 'IT', role: 'ADMIN', is_active: 'TRUE' },
    { email: 'qc@mgs.co.th', full_name: 'สมหญิง (QC)', dept: 'QC', role: 'QC', is_active: 'TRUE' },
    { email: 'qcm@mgs.co.th', full_name: 'หัวหน้า QC', dept: 'QC', role: 'QCM', is_active: 'TRUE' },
    { email: 'wh@mgs.co.th', full_name: 'ประเสริฐ (คลัง)', dept: 'WH', role: 'WH', is_active: 'TRUE' },
    { email: 'view@mgs.co.th', full_name: 'ผู้ดูอย่างเดียว', dept: 'SR', role: 'VIEWER', is_active: 'TRUE' },
    { email: 'off@mgs.co.th', full_name: 'ลาออกแล้ว', dept: 'QC', role: 'QC', is_active: 'FALSE' }
  ]);
  G.clearUserCache_();
  eq(rows(G.TAB.USERS).length, 6, 'จำนวนผู้ใช้');
});

t('เติมข้อมูลตัวอย่างจาก SAP', () => {
  store.props.SAP_PUSH_SECRET = 'test-secret';
  store.props.LARK_WEBHOOK = 'https://open.larksuite.com/test-hook';
  G.setupSeedDemoData();
  eq(rows(G.TAB.LOTS).length, 21, 'จำนวนล็อต (ซีเรียล 20 + ล็อตราง 1)');
  truthy(rows(G.TAB.MOVES).length >= 22, 'จำนวนการเคลื่อนไหว');
});

t('เติมข้อมูลตัวอย่างซ้ำไม่ทับของเดิม', () => {
  const before = rows(G.TAB.MOVES).length;
  G.setupSeedDemoData();
  eq(rows(G.TAB.MOVES).length, before, 'จำนวนการเคลื่อนไหวต้องไม่เปลี่ยน');
});

t('runSelfTest ผ่านทุกข้อ', () => {
  const out = G.runSelfTest();
  const bad = out.split('\n').filter(l => l.indexOf('FAIL') === 0);
  eq(bad.length, 0, 'ข้อที่ไม่ผ่าน:\n' + bad.join('\n'));
});

/* ── B. เครื่องมือทวนสอบ ────────────────────────────────────────────── */
group('B. การทวนสอบ (backward / forward / กระทบยอด)');

as('qc@mgs.co.th');

t('ค้นหาด้วยหมายเลขซีเรียลเจอ 1 รายการ', () => {
  const d = accepts(G.apiSearch('SG50R-A001'));
  eq(d.results.length, 1, 'จำนวนผลลัพธ์');
  eq(d.results[0].dist_number, 'SG50R-A001', 'ซีเรียลที่เจอ');
});

t('ค้นหาแบบไม่ใส่ขีดก็เจอ', () => {
  const d = accepts(G.apiSearch('sg50ra001'));
  eq(d.results.length, 1, 'จำนวนผลลัพธ์');
});

t('ค้นหาด้วยเลขใบส่งของเจอทุกซีเรียลในใบนั้น', () => {
  const d = accepts(G.apiSearch('DO-260812'));
  eq(d.results.length, 7, 'ซีเรียลในใบ DO-260812');
});

t('ค้นหาด้วยล็อตของผู้ขายเจอล็อตราง', () => {
  const d = accepts(G.apiSearch('SUP-260705-A'));
  eq(d.results.length, 1, 'จำนวนผลลัพธ์');
  eq(d.results[0].item_code, 'RAIL-4200', 'รหัสสินค้า');
});

t('ค้นหาด้วยเลข PO ของผู้ขายเจอ', () => {
  const d = accepts(G.apiSearch('PO-260801'));
  eq(d.results.length, 20, 'ซีเรียลที่รับเข้าตาม PO-260801');
});

t('ค้นหาสั้นเกินไปถูกปฏิเสธ', () => {
  rejects(G.apiSearch('A'), 'อย่างน้อย 2 ตัวอักษร', 'ค้นหา 1 ตัวอักษร');
});

t('กระทบยอดของซีเรียลที่ยังอยู่ในคลัง', () => {
  const r = G.reconcile_('INV-SG5RS|SG50R-A001');
  near(r.received, 1, 'รับเข้า');
  near(r.on_hand, 1, 'คงคลัง');
  near(r.shipped_out, 0, 'ส่งออก');
  near(r.unaccounted, 0, 'ส่วนต่าง');
  truthy(r.pass, 'ต้องกระทบยอดลงตัว');
});

t('กระทบยอดของซีเรียลที่ส่งลูกค้าไปแล้ว', () => {
  const r = G.reconcile_('INV-SG5RS|SG50R-A006');
  near(r.received, 1, 'รับเข้า');
  near(r.on_hand, 0, 'คงคลัง');
  near(r.shipped_out, 1, 'ส่งออก');
  near(r.unaccounted, 0, 'ส่วนต่าง');
});

t('กระทบยอดของล็อตราง 500 = ส่ง 320 + เหลือ 180', () => {
  const r = G.reconcile_('RAIL-4200|SUP-260705-A');
  near(r.received, 500, 'รับเข้า');
  near(r.shipped_out, 320, 'ส่งออก');
  near(r.on_hand, 180, 'คงคลัง');
  near(r.unaccounted, 0, 'ส่วนต่าง');
  truthy(r.pass, 'ต้องกระทบยอดลงตัว');
});

t('ตามรอยย้อนกลับได้ถึง PO และใบกำกับของผู้ขาย', () => {
  const d = accepts(G.apiTraceLot('INV-SG5RS|SG50R-A001'));
  eq(d.backward.length, 1, 'จำนวนรายการรับเข้า');
  eq(d.backward[0].supplier_po_no, 'PO-260801', 'เลข PO ผู้ขาย');
  eq(d.backward[0].supplier_invoice_no, 'INV-260801', 'เลขใบกำกับผู้ขาย');
  eq(d.backward[0].party_name, 'Supplier A', 'ชื่อผู้ขาย');
  eq(d.lot.supplier_lot, 'LOT-2607-A', 'ล็อตของผู้ขาย');
});

t('ตามรอยไปข้างหน้าบอกลูกค้าและโครงการ', () => {
  const d = accepts(G.apiTraceLot('INV-SG5RS|SG50R-A013'));
  eq(d.forward.shipments.length, 1, 'จำนวนรายการส่งออก');
  eq(d.forward.shipments[0].party_name, 'Customer B', 'ลูกค้า');
  eq(d.forward.shipments[0].project, 'Project B', 'โครงการ');
  eq(d.forward.shipments[0].doc_num, 'DO-260815', 'เลขใบส่งของ');
});

t('ทวนสอบจากเลขใบส่งของบอกได้ว่ามีซีเรียลอะไรบ้าง', () => {
  const d = accepts(G.apiTraceDocument('DO-260812'));
  eq(d.doc.party_name, 'Customer A', 'ลูกค้า');
  eq(d.lines.length, 7, 'จำนวนบรรทัด');
});

t('ทวนสอบจากเลขเอกสารที่ไม่มีจริงถูกปฏิเสธพร้อมเหตุผล', () => {
  rejects(G.apiTraceDocument('DO-999999'), 'ไม่พบเอกสาร', 'เอกสารไม่มีจริง');
});

t('ตรวจจับของหายได้ — สร้างล็อตที่ยอดไม่ลงตัว', () => {
  const now = G.nowStamp_();
  const moves = rows(G.TAB.MOVES).map(r => {
    const o = {};
    G.SCHEMA[G.TAB.MOVES].forEach(h => { o[h] = r[h]; });
    return o;
  });
  moves.push({
    move_id: '20~999~0~RAIL-4200|GHOST-01~IN', lot_key: 'RAIL-4200|GHOST-01',
    item_code: 'RAIL-4200', dist_number: 'GHOST-01', kind: 'BATCH', obj_type: '20',
    doc_entry: 999, doc_num: 'GR-GHOST', line_num: 0, doc_date: '2026-08-07',
    direction: 'IN', quantity: 100, whs_code: 'CHOD-WH', card_code: 'S0002',
    card_name: 'Supplier B (EMPERY)', project: '', synced_at: now
  });
  moves.push({
    move_id: '15~998~0~RAIL-4200|GHOST-01~OUT', lot_key: 'RAIL-4200|GHOST-01',
    item_code: 'RAIL-4200', dist_number: 'GHOST-01', kind: 'BATCH', obj_type: '15',
    doc_entry: 998, doc_num: 'DO-GHOST', line_num: 0, doc_date: '2026-08-20',
    direction: 'OUT', quantity: 60, whs_code: 'CHOD-WH', card_code: 'C0001',
    card_name: 'Customer A', project: 'Project A', synced_at: now
  });
  G.replaceTable_(G.TAB.MOVES, moves);
  const lots = rows(G.TAB.LOTS).map(r => {
    const o = {}; G.SCHEMA[G.TAB.LOTS].forEach(h => { o[h] = r[h]; }); return o;
  });
  lots.push({ lot_key: 'RAIL-4200|GHOST-01', item_code: 'RAIL-4200', dist_number: 'GHOST-01',
    kind: 'BATCH', sys_number: '', mnf_serial: '', supplier_lot: 'SUP-GHOST',
    in_date: '2026-08-07', exp_date: '', notes: '', synced_at: now });
  G.replaceTable_(G.TAB.LOTS, lots);
  G.resetCtx_();

  // รับ 100 · ส่งออก 60 · ไม่มีของคงคลัง -> หายไป 40
  const r = G.reconcile_('RAIL-4200|GHOST-01');
  near(r.received, 100, 'รับเข้า');
  near(r.shipped_out, 60, 'ส่งออก');
  near(r.on_hand, 0, 'คงคลัง');
  near(r.unaccounted, 40, 'ของที่ระบุที่อยู่ไม่ได้');
  truthy(!r.pass, 'ต้องไม่ผ่านการกระทบยอด');
});

/* ── C. สิทธิ์ ──────────────────────────────────────────────────────── */
group('C. สิทธิ์ — ตรวจที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อนปุ่ม');

t('VIEWER เปิดเคสไม่ได้', () => {
  as('view@mgs.co.th');
  rejects(G.apiOpenCase({ item_code: 'INV-SG5RS' }), 'ใช้งาน "openCase" ไม่ได้', 'VIEWER เปิดเคส');
});

t('คลังปลดการกักเองไม่ได้ ต้องผู้จัดการคุณภาพ', () => {
  as('wh@mgs.co.th');
  rejects(G.apiReleaseHold({ hold_id: 'x', reason: 'ตรวจแล้วไม่มีปัญหา' }), 'ไม่ได้', 'WH ปลดการกัก');
});

t('บัญชีที่ถูกปิดใช้งานเข้าไม่ได้', () => {
  as('off@mgs.co.th');
  rejects(G.apiBootstrap(), 'ถูกปิดการใช้งาน', 'บัญชีที่ปิดแล้ว');
});

t('บัญชีนอกโดเมนที่ไม่มีในทะเบียนเข้าไม่ได้', () => {
  as('outsider@gmail.com');
  rejects(G.apiBootstrap(), 'ไม่มีสิทธิ์ใช้งาน', 'บัญชีนอกโดเมน');
});

t('คนที่ยังไม่ถูกกำหนดสิทธิ์ได้ VIEWER และเข้าดูได้', () => {
  as('newbie@mgs.co.th');
  const d = accepts(G.apiBootstrap());
  eq(d.user.role, 'VIEWER', 'บทบาทเริ่มต้น');
  eq(d.perm.openCase, false, 'สิทธิ์เปิดเคส');
  truthy(d.user.unlisted, 'ต้องถูกทำเครื่องหมายว่ายังไม่ลงทะเบียน');
});

/* ── D. เคสเรียกคืน ────────────────────────────────────────────────── */
group('D. เคสเรียกคืน — ตั้งแต่เปิดจนปิด');

let CASE_NO = null;

t('ดูขอบเขตก่อนเปิดเคสได้ว่าเข้าข่ายกี่หน่วย', () => {
  as('qc@mgs.co.th');
  const d = accepts(G.apiPreviewScope('INV-SG5RS', 'SERIAL', '', 'SG50R-A001', 'SG50R-A020'));
  eq(d.count, 20, 'จำนวนซีเรียลในช่วง');
  near(d.qty_in_stock, 5, 'อยู่ในคลัง');
  near(d.qty_delivered, 15, 'ส่งลูกค้าไปแล้ว');
});

t('ระบุช่วงซีเรียลที่ไม่มีจริงถูกปฏิเสธ ไม่เดาเลขให้', () => {
  rejects(G.apiPreviewScope('INV-SG5RS', 'SERIAL', '', 'ZZ-001', 'ZZ-099'), 'ไม่พบซีเรียลในช่วง', 'ช่วงที่ไม่มีจริง');
});

t('เปิดเคสด้วยคำอธิบายสั้นเกินไปถูกปฏิเสธ', () => {
  rejects(G.apiOpenCase({
    item_code: 'INV-SG5RS', source: 'SUPPLIER_NOTICE', risk_class: 'MAJOR',
    problem: 'เสีย', scope: [{ kind: 'SERIAL', sn_from: 'SG50R-A001', sn_to: 'SG50R-A020' }]
  }), 'อย่างน้อย 10 ตัวอักษร', 'คำอธิบายสั้น');
});

t('เปิดเคสโดยไม่ระบุขอบเขตถูกปฏิเสธ', () => {
  rejects(G.apiOpenCase({
    item_code: 'INV-SG5RS', source: 'SUPPLIER_NOTICE', risk_class: 'MAJOR',
    problem: 'ผู้ขายแจ้งว่า PCB ล็อตนี้อาจมีจุดบัดกรีไม่สมบูรณ์', scope: []
  }), 'อย่างน้อย 1 รายการ', 'ไม่มีขอบเขต');
});

t('ขอบเขตกว้างเกิน 1,000 รายการถูกปฏิเสธก่อนเริ่มเขียน', () => {
  // จำลองสินค้าที่มีซีเรียลจำนวนมาก แล้วลองเปิดเคสครอบทั้งหมด
  const now = G.nowStamp_();
  const base = rows(G.TAB.LOTS).map(r => {
    const o = {}; G.SCHEMA[G.TAB.LOTS].forEach(h => { o[h] = r[h]; }); return o;
  });
  const bulky = base.slice();
  for (let i = 1; i <= 1200; i++) {
    const sn = 'BULK-' + ('0000' + i).slice(-4);
    bulky.push({ lot_key: G.lotKey_('INV-SG5RS', sn), item_code: 'INV-SG5RS', dist_number: sn,
      kind: 'SERIAL', sys_number: '', mnf_serial: sn, supplier_lot: 'LOT-BULK',
      in_date: '2026-08-07', exp_date: '', notes: '', synced_at: now });
  }
  G.replaceTable_(G.TAB.LOTS, bulky);
  G.resetCtx_();

  const before = rows(G.TAB.SCOPE).length;
  rejects(G.apiOpenCase({
    item_code: 'INV-SG5RS', source: 'SUPPLIER_NOTICE', risk_class: 'MAJOR',
    problem: 'ผู้ขายแจ้งว่าล็อตใหญ่ทั้งชุดอาจมีปัญหา ต้องตรวจทั้งหมด',
    scope: [{ kind: 'SERIAL', sn_from: 'BULK-0001', sn_to: 'BULK-1200' }]
  }), 'กว้างเกินไป', 'ช่วงซีเรียลกว้างเกิน');
  eq(rows(G.TAB.SCOPE).length, before, 'ต้องไม่มีอะไรถูกเขียนเลย');

  // คืนสภาพเดิมเพื่อไม่ให้กระทบข้อทดสอบถัดไป
  G.replaceTable_(G.TAB.LOTS, base);
  G.resetCtx_();
});

t('เปิดเคสสำเร็จ — คำนวณของกระทบ กักของ และสร้างรายการติดตามให้อัตโนมัติ', () => {
  const d = accepts(G.apiOpenCase({
    clientKey: 'CASE-KEY-1',
    item_code: 'INV-SG5RS', source: 'SUPPLIER_NOTICE', source_ref: 'SN-2026-0812',
    risk_class: 'MAJOR', case_owner: 'qc@mgs.co.th',
    problem: 'ผู้ขายแจ้งว่า PCB ล็อต LOT-2607-A อาจมีจุดบัดกรีไม่สมบูรณ์ เสี่ยงหยุดทำงานหลังใช้งาน 6 เดือน',
    scope: [{ kind: 'SERIAL', sn_from: 'SG50R-A001', sn_to: 'SG50R-A020' }]
  }));
  CASE_NO = d.case_no;
  truthy(/^RC-\d{4}-\d{3}$/.test(CASE_NO), 'รูปแบบเลขเคส: ' + CASE_NO);
  near(d.totals.affected, 20, 'ของกระทบทั้งหมด');
  near(d.totals.in_stock, 5, 'อยู่ในคลัง');
  near(d.totals.delivered, 15, 'ส่งลูกค้าไปแล้ว');
  near(d.totals.unaccounted, 0, 'ระบุที่อยู่ไม่ได้');
  eq(d.holds, 5, 'จำนวนรายการกัก (ซีเรียลละ 1)');
  eq(d.tracking_rows, 3, 'ปลายทาง: คลัง 1 + ลูกค้า 2');
});

t('เปิดเคสซ้ำด้วย clientKey เดิมไม่เกิดเคสที่สอง', () => {
  const before = rows(G.TAB.CASES).length;
  const res = G.apiOpenCase({
    clientKey: 'CASE-KEY-1',
    item_code: 'INV-SG5RS', source: 'SUPPLIER_NOTICE', risk_class: 'MAJOR',
    problem: 'ผู้ขายแจ้งว่า PCB ล็อต LOT-2607-A อาจมีจุดบัดกรีไม่สมบูรณ์ เสี่ยงหยุดทำงานหลังใช้งาน 6 เดือน',
    scope: [{ kind: 'SERIAL', sn_from: 'SG50R-A001', sn_to: 'SG50R-A020' }]
  });
  truthy(res.ok, 'ต้องตอบสำเร็จเหมือนเดิม');
  truthy(res.duplicate, 'ต้องถูกทำเครื่องหมายว่าเป็นการส่งซ้ำ');
  eq(rows(G.TAB.CASES).length, before, 'จำนวนเคสต้องไม่เพิ่ม');
});

t('รายการติดตามถูกรวมเป็นแถวเดียวต่อลูกค้า ไม่ใช่แถวละซีเรียล', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  eq(d.tracking.length, 3, 'จำนวนแถวติดตาม');
  const custA = d.tracking.filter(x => x.party_name === 'Customer A')[0];
  truthy(custA, 'ต้องมีแถวของ Customer A');
  near(custA.qty_affected, 7, 'จำนวนของ Customer A');
  eq(custA.sn_display, 'SG50R-A006–SG50R-A012 (7 หน่วย)', 'ช่วงซีเรียลที่แสดง');
  eq(custA.status, 'PENDING', 'สถานะเริ่มต้นของลูกค้า');
  const wh = d.tracking.filter(x => x.location_type === 'WAREHOUSE')[0];
  eq(wh.required_action, 'HOLD', 'ของในคลังต้องตั้งเป็นกักไว้');
});

t('แจ้ง Lark ตอนเปิดเคส พร้อมตัวเลขที่หัวหน้าต้องเห็น', () => {
  const msgs = store.larkLog.map(x => String(x.payload || ''));
  const opened = msgs.filter(m => m.indexOf(CASE_NO) !== -1);
  truthy(opened.length > 0, 'ต้องมีข้อความแจ้งเปิดเคส');
  truthy(opened[0].indexOf('20') !== -1, 'ต้องมีจำนวนที่กระทบ');
});

t('บันทึกจำนวนเกินที่กระทบถูกปฏิเสธ', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  const custA = d.tracking.filter(x => x.party_name === 'Customer A')[0];
  rejects(G.apiUpdateTracking({
    track_id: custA.track_id, row_version: custA.row_version, qty_replaced: 99, status: 'IN_PROGRESS'
  }), 'มากกว่าจำนวนที่กระทบ', 'จำนวนเกิน');
});

t('ปิดแถวติดตามทั้งที่ของยังค้างไม่ได้', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  const custA = d.tracking.filter(x => x.party_name === 'Customer A')[0];
  rejects(G.apiUpdateTracking({
    track_id: custA.track_id, row_version: custA.row_version, qty_replaced: 3, status: 'COMPLETED'
  }), 'ปิดรายการนี้ไม่ได้', 'ปิดทั้งที่ค้าง');
});

t('บันทึกความคืบหน้าบางส่วนได้ และคำนวณจำนวนค้างให้', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  const custA = d.tracking.filter(x => x.party_name === 'Customer A')[0];
  const r = accepts(G.apiUpdateTracking({
    clientKey: 'TRK-A-1', track_id: custA.track_id, row_version: custA.row_version,
    required_action: 'REPLACE', qty_replaced: 3, status: 'IN_PROGRESS',
    remark: 'เปลี่ยนไปแล้ว 3 เครื่อง รออีก 4'
  }));
  near(r.case_totals.effectiveness_pct, 3 / 20, 'ประสิทธิผลหลังบันทึก');
  const after = accepts(G.apiGetCase(CASE_NO)).tracking.filter(x => x.party_name === 'Customer A')[0];
  near(after.qty_pending, 4, 'จำนวนที่ยังค้าง');
  truthy(after.contacted_at, 'ต้องบันทึกเวลาที่ติดต่อให้อัตโนมัติ');
});

t('ส่งซ้ำด้วย row_version เดิมถูกปฏิเสธ (สองคนแก้พร้อมกัน)', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  const custA = d.tracking.filter(x => x.party_name === 'Customer A')[0];
  rejects(G.apiUpdateTracking({
    clientKey: 'TRK-A-STALE', track_id: custA.track_id,
    row_version: custA.row_version - 1, qty_replaced: 5, status: 'IN_PROGRESS'
  }), 'มีคนอื่นแก้ไขรายการนี้ไปแล้ว', 'row_version ไม่ตรง');
});

t('เดินสถานะข้ามขั้นไม่ได้', () => {
  const H = accepts(G.apiGetCase(CASE_NO)).header;
  rejects(G.apiAdvanceCase({ case_no: CASE_NO, to_status: 'VERIFYING', row_version: H.row_version }),
    'ไม่ได้', 'ข้ามจาก OPEN ไป VERIFYING');
});

t('เดินสถานะ OPEN → กักของแล้ว → กำลังติดตาม', () => {
  let H = accepts(G.apiGetCase(CASE_NO)).header;
  accepts(G.apiAdvanceCase({ clientKey: 'ADV-1', case_no: CASE_NO, to_status: 'CONTAINED', row_version: H.row_version }));
  H = accepts(G.apiGetCase(CASE_NO)).header;
  eq(H.status, 'CONTAINED', 'สถานะหลังกักของ');
  accepts(G.apiAdvanceCase({ clientKey: 'ADV-2', case_no: CASE_NO, to_status: 'TRACKING', row_version: H.row_version }));
  eq(accepts(G.apiGetCase(CASE_NO)).header.status, 'TRACKING', 'สถานะหลังเริ่มติดตาม');
});

t('เข้าขั้นตรวจประสิทธิผลไม่ได้ถ้ายังมีรายการค้าง', () => {
  const H = accepts(G.apiGetCase(CASE_NO)).header;
  rejects(G.apiAdvanceCase({ case_no: CASE_NO, to_status: 'VERIFYING', row_version: H.row_version }),
    'ยังมีรายการติดตามค้างอยู่', 'ยังมีรายการค้าง');
});

t('ปิดรายการติดตามครบทุกแถว → ประสิทธิผล 100%', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  d.tracking.forEach((tr, i) => {
    const fresh = accepts(G.apiGetCase(CASE_NO)).tracking.filter(x => x.track_id === tr.track_id)[0];
    const field = fresh.location_type === 'WAREHOUSE' ? 'qty_corrected' : 'qty_replaced';
    const payload = {
      clientKey: 'FINISH-' + i, track_id: fresh.track_id, row_version: fresh.row_version,
      required_action: fresh.location_type === 'WAREHOUSE' ? 'HOLD' : 'REPLACE',
      qty_returned: 0, qty_replaced: 0, qty_corrected: 0,
      status: 'IN_PROGRESS', remark: 'ดำเนินการครบแล้ว'
    };
    payload[field] = fresh.qty_affected;
    accepts(G.apiUpdateTracking(payload), 'ปิดแถว ' + fresh.party_name);
  });
  const H = accepts(G.apiGetCase(CASE_NO)).header;
  near(H.effectiveness_pct, 1, 'ประสิทธิผล');
  const still = accepts(G.apiGetCase(CASE_NO)).tracking.filter(x => x.status !== 'COMPLETED');
  eq(still.length, 0, 'แถวที่ยังไม่เสร็จ');
});

t('ปิดเคสไม่ได้ถ้ายังมีของถูกกักอยู่', () => {
  let H = accepts(G.apiGetCase(CASE_NO)).header;
  accepts(G.apiAdvanceCase({ clientKey: 'ADV-3', case_no: CASE_NO, to_status: 'VERIFYING', row_version: H.row_version }));
  as('qcm@mgs.co.th');
  H = accepts(G.apiGetCase(CASE_NO)).header;
  rejects(G.apiCloseCase({ case_no: CASE_NO, row_version: H.row_version, closure_note: 'ดำเนินการครบถ้วนแล้ว เปลี่ยนของให้ลูกค้าทุกราย' }),
    'ยังมีของถูกกักอยู่', 'ปิดทั้งที่ยังกักอยู่');
});

t('ปลดการกักต้องระบุเหตุผล', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  rejects(G.apiReleaseHold({ hold_id: d.holds[0].hold_id, row_version: d.holds[0].row_version, reason: 'ok' }),
    'เหตุผล', 'เหตุผลสั้นเกินไป');
});

t('ผู้จัดการคุณภาพปลดการกักได้ทุกรายการ', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  d.holds.forEach((h, i) => {
    const fresh = accepts(G.apiGetCase(CASE_NO)).holds.filter(x => x.hold_id === h.hold_id)[0];
    accepts(G.apiReleaseHold({
      clientKey: 'REL-' + i, hold_id: fresh.hold_id, row_version: fresh.row_version,
      reason: 'เปลี่ยนของใหม่ให้ลูกค้าครบแล้ว ของชุดนี้ส่งคืนผู้ขายตามใบเคลม CLM-2026-014'
    }), 'ปลดการกัก ' + fresh.dist_number);
  });
  const after = accepts(G.apiGetCase(CASE_NO)).holds.filter(x => x.status === 'HOLD');
  eq(after.length, 0, 'รายการที่ยังกักอยู่');
});

t('ปิดเคสไม่ได้ถ้าหัวข้อการตัดสินใจยังไม่สรุป', () => {
  const H = accepts(G.apiGetCase(CASE_NO)).header;
  rejects(G.apiCloseCase({ case_no: CASE_NO, row_version: H.row_version, closure_note: 'ดำเนินการครบถ้วนแล้ว เปลี่ยนของให้ลูกค้าทุกราย' }),
    'การตัดสินใจที่ยังไม่สรุป', 'ยังมีหัวข้อค้าง');
});

t('ตั้งหัวข้อเป็นเสร็จโดยไม่กรอกรายละเอียดไม่ได้', () => {
  const d = accepts(G.apiGetCase(CASE_NO));
  const a = d.actions.filter(x => x.section === 'ROOT_CAUSE')[0];
  rejects(G.apiUpdateAction({ action_id: a.action_id, row_version: a.row_version, status: 'DONE', details: '' }),
    'ต้องกรอกรายละเอียด', 'DONE โดยไม่มีรายละเอียด');
});

t('กรอกการสอบสวนและการตัดสินใจครบทุกหัวข้อ', () => {
  as('qc@mgs.co.th');
  const d = accepts(G.apiGetCase(CASE_NO));
  d.actions.forEach((a, i) => {
    const fresh = accepts(G.apiGetCase(CASE_NO)).actions.filter(x => x.action_id === a.action_id)[0];
    accepts(G.apiUpdateAction({
      clientKey: 'ACT-' + i, action_id: fresh.action_id, row_version: fresh.row_version,
      details: 'สรุปสำหรับหัวข้อ ' + fresh.section_th + ' — ผู้ขายยืนยันปัญหาอยู่เฉพาะล็อต LOT-2607-A',
      responsible: 'qc@mgs.co.th', target_date: '2026-09-15', status: 'DONE'
    }), 'กรอกหัวข้อ ' + fresh.section);
  });
  const still = accepts(G.apiGetCase(CASE_NO)).actions.filter(x => x.status === 'OPEN');
  eq(still.length, 0, 'หัวข้อที่ยังไม่สรุป');
});

t('ผู้กรอกอนุมัติงานตัวเองไม่ได้', () => {
  const a = accepts(G.apiGetCase(CASE_NO)).actions.filter(x => x.section === 'ROOT_CAUSE')[0];
  as('qc@mgs.co.th');
  rejects(G.apiApproveAction({ action_id: a.action_id, row_version: a.row_version }), 'ไม่ได้', 'QC อนุมัติเอง');
});

t('ผู้จัดการคุณภาพอนุมัติหัวข้อได้', () => {
  as('qcm@mgs.co.th');
  const a = accepts(G.apiGetCase(CASE_NO)).actions.filter(x => x.section === 'ROOT_CAUSE')[0];
  accepts(G.apiApproveAction({ clientKey: 'APR-1', action_id: a.action_id, row_version: a.row_version }));
  const after = accepts(G.apiGetCase(CASE_NO)).actions.filter(x => x.section === 'ROOT_CAUSE')[0];
  eq(after.approved_by, 'qcm@mgs.co.th', 'ผู้อนุมัติ');
});

t('ปิดเคสสำเร็จเมื่อเงื่อนไขครบ', () => {
  const H = accepts(G.apiGetCase(CASE_NO)).header;
  accepts(G.apiCloseCase({
    clientKey: 'CLOSE-1', case_no: CASE_NO, row_version: H.row_version,
    closure_note: 'เปลี่ยนสินค้าให้ลูกค้าครบทั้ง 15 เครื่อง ของในคลัง 5 เครื่องส่งคืนผู้ขาย ปิดเคส'
  }));
  eq(accepts(G.apiGetCase(CASE_NO)).header.status, 'CLOSED', 'สถานะสุดท้าย');
});

t('เคสที่ปิดแล้วแก้ไขรายการติดตามไม่ได้', () => {
  const tr = accepts(G.apiGetCase(CASE_NO)).tracking[0];
  rejects(G.apiUpdateTracking({ track_id: tr.track_id, row_version: tr.row_version, qty_replaced: 1 }),
    'ปิดแล้ว', 'แก้เคสที่ปิดแล้ว');
});

t('เคสที่ปิดแล้วเปิดใหม่ไม่ได้', () => {
  const H = accepts(G.apiGetCase(CASE_NO)).header;
  rejects(G.apiAdvanceCase({ case_no: CASE_NO, to_status: 'OPEN', row_version: H.row_version }),
    'ไม่ได้', 'เปิดเคสที่ปิดแล้ว');
});

t('ยกเลิกเคสปลดการกักทั้งหมดให้อัตโนมัติ', () => {
  as('qc@mgs.co.th');
  const d = accepts(G.apiOpenCase({
    clientKey: 'CASE-KEY-2',
    item_code: 'RAIL-4200', source: 'INTERNAL_QC', risk_class: 'MINOR',
    problem: 'QC พบรอยขูดบนผิวรางบางเส้นระหว่างตรวจนับประจำเดือน ต้องตรวจทั้งล็อต',
    scope: [{ kind: 'BATCH', dist_number: 'SUP-260705-A' }]
  }));
  const caseNo = d.case_no;
  near(d.totals.affected, 500, 'ของกระทบทั้งล็อต');
  near(d.totals.in_stock, 180, 'อยู่ในคลัง');
  near(d.totals.delivered, 320, 'ส่งไปแล้ว');
  eq(d.holds, 1, 'จำนวนรายการกัก');

  as('qcm@mgs.co.th');
  const H = accepts(G.apiGetCase(caseNo)).header;
  accepts(G.apiCancelCase({
    clientKey: 'CANCEL-1', case_no: caseNo, row_version: H.row_version,
    reason: 'ตรวจซ้ำแล้วเป็นคราบจากฟิล์มกันรอย ไม่ใช่รอยขูด ไม่กระทบการใช้งาน'
  }));
  const after = accepts(G.apiGetCase(caseNo));
  eq(after.header.status, 'CANCELLED', 'สถานะ');
  eq(after.holds.filter(x => x.status === 'HOLD').length, 0, 'รายการที่ยังกักอยู่');
});

/* ── E. ทดสอบทวนสอบย้อนกลับ ────────────────────────────────────────── */
group('E. การทดสอบทวนสอบย้อนกลับ (Mock Recall)');

let TEST_NO = null;

t('เริ่มทดสอบจากล็อตที่มีทั้งรับเข้าและส่งออก', () => {
  as('qc@mgs.co.th');
  const d = accepts(G.apiStartMockRecall({
    clientKey: 'MR-1', item_code: 'RAIL-4200', dist_number: 'SUP-260705-A',
    test_type: 'BOTH', target_min: 120
  }));
  TEST_NO = d.test_no;
  truthy(/^MR-\d{4}-\d{3}$/.test(TEST_NO), 'รูปแบบเลขที่: ' + TEST_NO);
  eq(d.lines, 3, 'บรรทัดที่ต้องยืนยัน (รับเข้า 1 + คงคลัง 1 + ส่งออก 1)');
});

t('ระบบสร้าง "จำนวนที่ควรหาเจอ" จาก SAP ให้ ไม่ใช่ให้คนเดา', () => {
  const d = accepts(G.apiGetMockRecall(TEST_NO));
  const back = d.lines.filter(l => l.leg === 'BACKWARD');
  const fwd = d.lines.filter(l => l.leg === 'FORWARD');
  eq(back.length, 1, 'บรรทัดย้อนกลับ');
  near(back[0].qty_expected, 500, 'จำนวนที่รับเข้า');
  eq(fwd.length, 2, 'บรรทัดไปข้างหน้า');
  near(fwd.reduce((s, l) => s + l.qty_expected, 0), 500, 'คงคลัง 180 + ส่งออก 320');
  eq(d.lines.filter(l => l.result === 'PENDING').length, 3, 'บรรทัดที่รอบันทึกผล');
});

t('ล็อตที่ยังไม่มีการเคลื่อนไหวทดสอบไม่ได้', () => {
  rejects(G.apiStartMockRecall({ item_code: 'INV-SG5RS', dist_number: 'ไม่มีล็อตนี้' }),
    'ไม่พบล็อต', 'ล็อตที่ไม่มีจริง');
});

t('ปิดผลไม่ได้ถ้ายังบันทึกไม่ครบทุกบรรทัด', () => {
  rejects(G.apiFinishMockRecall({ test_no: TEST_NO }), 'ยังไม่ได้บันทึกผล', 'ยังมีบรรทัดค้าง');
});

t('บันทึกจำนวนที่หาเจอเกินที่คาดไว้ถูกปฏิเสธ', () => {
  const l = accepts(G.apiGetMockRecall(TEST_NO)).lines[0];
  rejects(G.apiUpdateMockLine({ line_id: l.line_id, qty_located: l.qty_expected + 1, evidence: 'ใบรับสินค้า' }),
    'มากกว่าจำนวนที่คาดไว้', 'จำนวนเกิน');
});

t('บันทึกว่าหาเจอโดยไม่มีหลักฐานไม่ได้', () => {
  const l = accepts(G.apiGetMockRecall(TEST_NO)).lines[0];
  rejects(G.apiUpdateMockLine({ line_id: l.line_id, qty_located: l.qty_expected, evidence: '' }),
    'หลักฐาน', 'ไม่มีหลักฐาน');
});

t('บันทึกผลครบทุกบรรทัดแล้วปิดผล — ผ่าน', () => {
  accepts(G.apiGetMockRecall(TEST_NO)).lines.forEach((l, i) => {
    accepts(G.apiUpdateMockLine({
      clientKey: 'MRL-' + i, line_id: l.line_id, qty_located: l.qty_expected,
      evidence: 'ยืนยันจากใบ ' + (l.doc_num || 'รายงานสต๊อก') + ' และการนับจริงหน้าคลัง'
    }), 'บันทึกบรรทัด ' + (i + 1));
  });
  const d = accepts(G.apiFinishMockRecall({ clientKey: 'MRF-1', test_no: TEST_NO }));
  eq(d.result, 'PASS', 'ผลการทดสอบ');
  near(d.completion_pct, 1, 'เปอร์เซ็นต์ที่หาเจอ');
  near(d.reconcile_pct, 1, 'เปอร์เซ็นต์การกระทบยอด');
  eq(d.gap_found, '', 'ต้องไม่มีข้อบกพร่อง');
});

t('ผู้ทดสอบทบทวนผลของตัวเองไม่ได้', () => {
  rejects(G.apiReviewMockRecall({ test_no: TEST_NO }), 'ไม่ได้', 'QC ทบทวนเอง');
});

t('ผู้จัดการคุณภาพทบทวนผลได้', () => {
  as('qcm@mgs.co.th');
  const H = accepts(G.apiGetMockRecall(TEST_NO)).header;
  accepts(G.apiReviewMockRecall({ clientKey: 'MRV-1', test_no: TEST_NO, row_version: H.row_version,
    note: 'ผลเป็นที่น่าพอใจ ทีมหาของครบภายในเวลา' }));
  eq(accepts(G.apiGetMockRecall(TEST_NO)).header.reviewed_by, 'qcm@mgs.co.th', 'ผู้ทบทวน');
});

t('การทดสอบที่หาของไม่ครบ = ไม่ผ่าน และต้องมี CAPA', () => {
  as('qc@mgs.co.th');
  const d = accepts(G.apiStartMockRecall({
    clientKey: 'MR-2', item_code: 'RAIL-4200', dist_number: 'GHOST-01', test_type: 'BOTH'
  }));
  const no = d.test_no;
  accepts(G.apiGetMockRecall(no)).lines.forEach((l, i) => {
    // จงใจหาเจอแค่ครึ่งเดียว
    accepts(G.apiUpdateMockLine({
      clientKey: 'MRL2-' + i, line_id: l.line_id,
      qty_located: Math.floor(l.qty_expected / 2),
      evidence: 'พบเพียงบางส่วนจากเอกสารที่มี'
    }));
  });
  const r = accepts(G.apiFinishMockRecall({ clientKey: 'MRF-2', test_no: no }));
  eq(r.result, 'FAIL', 'ผลการทดสอบ');
  truthy(r.gap_found.indexOf('หาของไม่ครบ') !== -1, 'ต้องระบุว่าหาของไม่ครบ: ' + r.gap_found);
  truthy(r.gap_found.indexOf('กระทบยอดไม่ลง') !== -1, 'ต้องระบุว่ากระทบยอดไม่ลง: ' + r.gap_found);

  as('qcm@mgs.co.th');
  const H = accepts(G.apiGetMockRecall(no)).header;
  rejects(G.apiReviewMockRecall({ test_no: no, row_version: H.row_version }),
    'สาเหตุที่แท้จริง', 'ทบทวนผลที่ไม่ผ่านโดยไม่ระบุสาเหตุ');

  accepts(G.apiReviewMockRecall({
    clientKey: 'MRV-2', test_no: no, row_version: H.row_version,
    root_cause: 'ไม่มีการบันทึกล็อตตอนตัดจ่ายชั่วคราวหน้างาน ทำให้ยอดคงคลังกับของจริงไม่ตรง',
    corrective_action: 'บังคับสแกนล็อตทุกครั้งที่ตัดจ่าย และกระทบยอดล็อตรายเดือน',
    capa_owner: 'wh@mgs.co.th', capa_due: '2026-09-30'
  }));
  eq(accepts(G.apiGetMockRecall(no)).header.capa_status, 'OPEN', 'สถานะ CAPA');
});

/* ── F. การรับข้อมูลจาก SAP ────────────────────────────────────────── */
group('F. การรับข้อมูลจาก SAP');

t('ingest ทับข้อมูลทั้งแท็บ แถวที่ถูกลบใน B1 ต้องหายไปด้วย', () => {
  const before = rows(G.TAB.WHS).length;
  truthy(before >= 2, 'ต้องมีคลังอยู่ก่อน');
  G.ingestBatch_({
    batch_id: 'B1',
    tables: {
      'SAP_Warehouses': [
        { whs_code: 'CHOD-WH', whs_name: 'คลังฉะเชิงเทรา', location_type: 'INTERNAL', is_active: 'TRUE' }
      ]
    }
  }, 'TEST', 'B1');
  eq(rows(G.TAB.WHS).length, 1, 'จำนวนคลังหลัง sync');
});

t('ingest ไปยังแท็บที่ไม่อนุญาตถูกปฏิเสธ', () => {
  const before = rows(G.TAB.CASES).length;
  const res = G.ingestBatch_({ batch_id: 'B2', tables: { 'Recall_Cases': [] } }, 'TEST', 'B2');
  eq(res['Recall_Cases'].ok, false, 'ต้องถูกปฏิเสธ');
  eq(rows(G.TAB.CASES).length, before, 'ข้อมูลเคสต้องไม่ถูกแตะ');
});

t('ingest แถวที่ขาดฟิลด์บังคับถูกปฏิเสธทั้งแท็บ ไม่เขียนครึ่ง ๆ กลาง ๆ', () => {
  const before = rows(G.TAB.LOTS).length;
  const res = G.ingestBatch_({
    batch_id: 'B3',
    tables: { 'SAP_Lots': [{ item_code: 'X', dist_number: 'Y', kind: 'BATCH' }, { item_code: '', dist_number: '' }] }
  }, 'TEST', 'B3');
  eq(res['SAP_Lots'].ok, false, 'ต้องถูกปฏิเสธ');
  eq(rows(G.TAB.LOTS).length, before, 'ข้อมูลเดิมต้องอยู่ครบ');
});

t('ingest จำนวนแถวเกินเพดานถูกปฏิเสธ', () => {
  const big = [];
  for (let i = 0; i < G.CFG.MAX_INGEST_ROWS + 1; i++) big.push({ card_code: 'C' + i, card_name: 'x' });
  const res = G.ingestBatch_({ batch_id: 'B4', tables: { 'SAP_BP': big } }, 'TEST', 'B4');
  eq(res['SAP_BP'].ok, false, 'ต้องถูกปฏิเสธ');
});

t('ingest เดาทิศทางเข้า-ออกจากชนิดเอกสารเมื่อตัวส่งไม่ระบุ', () => {
  G.ingestBatch_({
    batch_id: 'B5',
    tables: { 'SAP_Lot_Moves': [{
      item_code: 'INV-SG5RS', dist_number: 'SG50R-A001', kind: 'SERIAL',
      obj_type: '20', doc_entry: 1, doc_num: 'GR-X', line_num: 0,
      doc_date: '2026-08-07', quantity: -5, whs_code: 'CHOD-WH'
    }] }
  }, 'TEST', 'B5');
  const m = rows(G.TAB.MOVES)[0];
  eq(String(m.direction), 'IN', 'ทิศทางที่เดาได้จากใบรับสินค้า');
  eq(String(m.quantity), '5', 'จำนวนต้องเป็นค่าบวกเสมอ');
  truthy(String(m.move_id).length > 0, 'ต้องมี move_id');
});

t('ตารางใหญ่ส่งเป็นหลายก้อนได้ — ก้อนแรกทับ ก้อนถัดไปต่อท้าย', () => {
  const mk = (n, prefix) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ card_code: prefix + i, card_name: 'BP ' + prefix + i, card_type: 'C' });
    return out;
  };
  let res = G.ingestBatch_({ batch_id: 'B6', tables: { 'SAP_BP': { mode: 'REPLACE', rows: mk(3, 'A') } } }, 'TEST', 'B6');
  eq(res['SAP_BP'].ok, true, 'ก้อนแรก');
  eq(rows(G.TAB.BP).length, 3, 'จำนวนหลังก้อนแรก');

  res = G.ingestBatch_({ batch_id: 'B6', tables: { 'SAP_BP': { mode: 'APPEND', rows: mk(4, 'B') } } }, 'TEST', 'B6');
  eq(res['SAP_BP'].ok, true, 'ก้อนที่สอง');
  eq(rows(G.TAB.BP).length, 7, 'จำนวนหลังต่อท้าย');

  // ก้อนแรกของรอบถัดไปต้องล้างของเดิมทิ้ง ไม่ใช่สะสมไปเรื่อย ๆ
  res = G.ingestBatch_({ batch_id: 'B7', tables: { 'SAP_BP': { mode: 'REPLACE', rows: mk(2, 'C') } } }, 'TEST', 'B7');
  eq(rows(G.TAB.BP).length, 2, 'จำนวนหลังเริ่มรอบใหม่');
});

t('ingest ที่ระบุ mode ผิดถูกปฏิเสธ', () => {
  const res = G.ingestBatch_({ batch_id: 'B8', tables: { 'SAP_BP': { mode: 'DELETE', rows: [] } } }, 'TEST', 'B8');
  eq(res['SAP_BP'].ok, false, 'ต้องถูกปฏิเสธ');
});

t('ingest บันทึกลง Sync_Log ทุกครั้ง', () => {
  const logs = rows(G.TAB.SYNC_LOG);
  truthy(logs.length >= 5, 'จำนวนบันทึก sync');
  truthy(logs.some(l => String(l.status) === 'REJECTED'), 'ต้องมีบันทึกรายการที่ถูกปฏิเสธ');
});

/* ── G. ความปลอดภัยและความถูกต้องของข้อมูล ────────────────────────── */
group('G. ความปลอดภัยและความถูกต้องของข้อมูล');

t('สูตรที่ฝังมากับข้อความถูกปิดหัวก่อนเขียนลงเซลล์', () => {
  eq(G.sanitizeCell_('=IMPORTRANGE("a","b")'), "'=IMPORTRANGE(\"a\",\"b\")", 'สูตร =');
  eq(G.sanitizeCell_('@SUM(A1)'), "'@SUM(A1)", 'สูตร @');
  eq(G.sanitizeCell_('+1+1'), "'+1+1", 'สูตร +');
  eq(G.sanitizeCell_('-12.5'), '-12.5', 'เลขติดลบต้องไม่ถูกแตะ');
  eq(G.sanitizeCell_('ปกติ'), 'ปกติ', 'ข้อความปกติ');
});

t('จำนวนที่แปลงไม่ได้เป็น error ไม่ใช่ 0 เงียบ ๆ', () => {
  eq(G.parseQty_('1,250.50'), 1250.5, 'ลูกน้ำ');
  eq(G.parseQty_('  12  '), 12, 'ช่องว่าง');
  eq(G.parseQty_(''), 0, 'ค่าว่าง');
  throws(() => G.parseQty_('ห้า'), 'ต้องเป็นตัวเลข', 'ข้อความที่ไม่ใช่ตัวเลข');
  throws(() => G.parseQtyPos_(-1), 'ติดลบไม่ได้', 'จำนวนติดลบ');
});

t('วันที่รูปแบบกำกวมถูกปฏิเสธ', () => {
  eq(G.parseDate_('2026-08-22'), '2026-08-22', 'รูปแบบที่ถูกต้อง');
  throws(() => G.parseDate_('01/02/2026'), 'ปี-เดือน-วัน', 'รูปแบบกำกวม');
});

t('sync ทับข้อมูล SAP แล้วข้อมูลที่ MGS เป็นเจ้าของต้องไม่หาย', () => {
  // ชุดทดสอบ F เพิ่งเขียนทับตาราง SAP_* ไปทั้งชุด — นี่คือสถานการณ์จริงทุก 30 นาที
  // เคส การติดตาม การกัก การสอบสวน และหมายเหตุของ QC ต้องรอดทุกครั้ง
  truthy(rows(G.TAB.CASES).length >= 2, 'เคสต้องยังอยู่');
  truthy(rows(G.TAB.TRACKING).length >= 3, 'รายการติดตามต้องยังอยู่');
  truthy(rows(G.TAB.HOLDS).length >= 5, 'ประวัติการกักต้องยังอยู่');
  truthy(rows(G.TAB.ACTIONS).length >= 11, 'หัวข้อสอบสวนต้องยังอยู่');
  truthy(rows(G.TAB.MOCK).length >= 2, 'ผลการทดสอบทวนสอบต้องยังอยู่');
  truthy(rows(G.TAB.AUDIT).length > 0, 'audit log ต้องยังอยู่');

  // และเคสที่ปิดไปแล้วต้องอ่านได้เหมือนเดิม แม้ข้อมูล SAP ที่อ้างถึงจะถูกทับไปแล้ว
  as('qc@mgs.co.th');
  const d = accepts(G.apiGetCase(CASE_NO));
  eq(d.header.status, 'CLOSED', 'สถานะเคสเดิม');
  near(d.header.effectiveness_pct, 1, 'ประสิทธิผลที่บันทึกไว้');
  eq(d.tracking.length, 3, 'จำนวนแถวติดตามเดิม');
});

t('ทุกการกระทำสำคัญถูกบันทึกใน Audit_Log พร้อมชื่อผู้ทำ', () => {
  const logs = rows(G.TAB.AUDIT);
  const actions = {};
  logs.forEach(l => { actions[String(l.action)] = String(l.actor_email); });
  ['OPEN_CASE', 'UPDATE_TRACKING', 'RELEASE_HOLD', 'CLOSE_CASE', 'CANCEL_CASE',
   'APPROVE_ACTION', 'START_MOCK_RECALL', 'FINISH_MOCK_RECALL'].forEach(a => {
    truthy(actions[a], 'ต้องมีบันทึกการกระทำ ' + a);
    truthy(String(actions[a]).indexOf('@') !== -1, a + ' ต้องบันทึกอีเมลผู้ทำ');
  });
});

t('Audit_Log เก็บค่าก่อน-หลัง ไม่ใช่แค่ชื่อการกระทำ', () => {
  const l = rows(G.TAB.AUDIT).filter(x => String(x.action) === 'UPDATE_TRACKING')[0];
  truthy(l, 'ต้องมีบันทึกการแก้ไขรายการติดตาม');
  const before = JSON.parse(String(l.before_json));
  const after = JSON.parse(String(l.after_json));
  truthy('qty_replaced' in before || 'qty_returned' in before, 'ต้องเก็บค่าก่อนแก้');
  truthy('qty_pending' in after, 'ต้องเก็บค่าหลังแก้');
});

t('หน้าหลักโหลดได้และนับงานค้างถูกต้อง', () => {
  as('qc@mgs.co.th');
  const d = accepts(G.apiDashboard());
  truthy(d.counts, 'ต้องมีตัวเลขสรุป');
  eq(d.counts.tasks_pending, d.tasks.length, 'จำนวนงานค้างต้องตรงกับรายการ');
  truthy(d.sync, 'ต้องมีสถานะการ sync');
});

t('ออกรายงาน FM-QC-TR-01 ได้ตามรูปแบบฟอร์มเดิม', () => {
  const d = accepts(G.apiExportTraceMaster(['INV-SG5RS|SG50R-A006', 'RAIL-4200|SUP-260705-A']));
  truthy(d.rows >= 2, 'จำนวนแถวในรายงาน');
  const sh = store.ss.getSheetByName(d.sheet_name);
  truthy(sh, 'ต้องมีแท็บรายงาน');
  const head = sh.getRange(1, 1, 1, 23).getValues()[0];
  eq(head[0], 'Record No.', 'คอลัมน์แรก');
  eq(head[10], 'Serial Number', 'คอลัมน์ซีเรียล');
  eq(head[21], 'Recall Case No.', 'คอลัมน์เลขเคส');
});

t('ออกรายงานเกิน 200 ล็อตถูกปฏิเสธ', () => {
  const many = [];
  for (let i = 0; i < 201; i++) many.push('X|Y' + i);
  rejects(G.apiExportTraceMaster(many), 'ไม่เกิน 200', 'ล็อตมากเกินไป');
});

/* ═════════════════════════════════════════════════════════════════════════
   4. สรุปผล
   ═════════════════════════════════════════════════════════════════════════ */
console.log('\n' + '─'.repeat(64));
if (fail === 0) {
  console.log('\x1b[32m\x1b[1mผ่านทั้งหมด ' + pass + ' ข้อ\x1b[0m');
} else {
  console.log('\x1b[31m\x1b[1mผ่าน ' + pass + ' ข้อ · ไม่ผ่าน ' + fail + ' ข้อ\x1b[0m');
  failures.forEach(f => console.log('\n  ✗ ' + f.name + '\n    ' + f.message));
}
console.log('─'.repeat(64));
process.exit(fail === 0 ? 0 : 1);

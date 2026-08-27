/* เทียบว่าตัวประมวลผลสองฝั่งให้ผลตรงกันจริง — รันด้วย:
 *   python3 tools/costing-extract.py "Costing Mech.xlsx" -o /tmp/py.json --grid /tmp/grid.json
 *   node tools/costing-parity.mjs /tmp/grid.json /tmp/py.json
 *
 * ทำไมต้องมี: กฎเดียวกันถูกเขียนสองที่ (Python ไว้ตรวจสอบ · Apps Script ไว้ใช้งานจริง)
 * สองฝั่งเพี้ยนจากกันเมื่อไหร่ ตัวเลขที่ทีมเห็นกับตัวเลขที่ตั้งเบิกจริงจะไม่ตรงกันโดยไม่มีใครรู้
 */
import fs from "fs";

const [gridPath, pyPath] = process.argv.slice(2);
if (!gridPath || !pyPath) {
  console.log("ใช้: node tools/costing-parity.mjs <grid.json> <py.json>");
  process.exit(2);
}

// สตับของ Google เท่าที่ transform_ ใช้ — ไม่ต้องมี Apps Script จริง
global.Utilities = { formatDate: d => d };
global.Session = { getScriptTimeZone: () => "Asia/Bangkok" };

const src = fs.readFileSync(new URL("../apps-script/CostingDashboard.gs", import.meta.url), "utf8");
const { transform_, fingerprint_ } = new Function(src + "\nreturn {transform_, fingerprint_};")();

const gs = transform_(JSON.parse(fs.readFileSync(gridPath, "utf8")));
const py = JSON.parse(fs.readFileSync(pyPath, "utf8"));
const bad = [];

if (!gs.ok) bad.push("ฝั่ง Apps Script ประมวลผลไม่ผ่าน: " + gs.msg);
else {
  ["read", "excluded_lc", "complete", "incomplete", "unknown_term", "zero_price"].forEach(k => {
    if (gs.stats[k] !== py.stats[k])
      bad.push(`สถิติ ${k} ไม่ตรง — Apps Script ${gs.stats[k]} · Python ${py.stats[k]}`);
  });
  if (gs.rows.length !== py.rows.length)
    bad.push(`จำนวนแถวไม่ตรง — Apps Script ${gs.rows.length} · Python ${py.rows.length}`);

  const n = Math.min(gs.rows.length, py.rows.length);
  for (let i = 0; i < n; i++) {
    const a = py.rows[i], b = gs.rows[i];
    const cmp = [
      ["PO Number", a["PO Number"], b["PO Number"]],
      ["Supplier", a.Supplier, b.Supplier],
      ["PO Payment Term", a["PO Payment Term"], b["PO Payment Term"]],
      ["Price", a.Price === null ? "" : a.Price, b.Price],
      ["Currency", a.Currency, b.Currency],
      ["Due Date", a["Due Date"], b["Due Date"]],
      ["Payment_Status", a.Payment_Status, b.Payment_Status],
      ["ธงยอดศูนย์", a.Zero_Price, b._zero]
    ];
    cmp.forEach(([f, x, y]) => {
      if (x !== y && bad.length < 12)
        bad.push(`แถวที่ ${i + 1} ช่อง ${f} ไม่ตรง — Python "${x}" · Apps Script "${y}"`);
    });
  }

  // ลายนิ้วมือชนกันแปลว่ากันส่งซ้ำไม่ได้จริง — เป็นเรื่องเงิน ต้องดักไว้
  const seen = new Map();
  gs.rows.forEach((r, i) => {
    const k = fingerprint_(r);
    if (seen.has(k)) bad.push(`ลายนิ้วมือแถวชนกัน (แถว ${seen.get(k) + 1} กับ ${i + 1}): ${k}`);
    else seen.set(k, i);
  });
}

if (bad.length) {
  console.log(`พบปัญหา ${bad.length}:`);
  bad.forEach(b => console.log("  - " + b));
  process.exit(1);
}
console.log(`ผลตรงกันทุกแถวระหว่าง Python กับ Apps Script (${gs.rows.length} แถว) ` +
  `· ลายนิ้วมือไม่ชนกัน`);

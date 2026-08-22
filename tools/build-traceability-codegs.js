/**
 * รวมไฟล์ .gs ทั้ง 9 ไฟล์เป็น Code.gs ไฟล์เดียว
 * รันด้วย: node tools/build-traceability-codegs.js
 *
 * ทำไมต้องมี: การวาง 9 ไฟล์ใน Apps Script ทีละไฟล์ผิดพลาดง่าย (ลืมไฟล์ · ตั้งชื่อผิด)
 * ไฟล์รวมนี้ทำให้เหลือแค่ 2 ไฟล์ที่ต้องวาง — Code.gs กับ index.html
 *
 * ข้อแลกเปลี่ยนที่ต้องรู้: ไฟล์รวมยาว ~3,900 บรรทัด หาโค้ดยากกว่าตอนแยกไฟล์
 * ถ้าจะดูแลระยะยาวและใช้ clasp อยู่แล้ว ให้ใช้ไฟล์แยกใน apps-script/traceability/ ดีกว่า
 * ไฟล์นี้เหมาะกับการติดตั้งครั้งแรกและการส่งให้คนที่ไม่คุ้น Apps Script
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script', 'traceability');
const DIST = path.join(SRC, 'dist');

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
if (files.length < 9) throw new Error('พบไฟล์ .gs แค่ ' + files.length + ' ไฟล์ — คาดว่าต้องมี 9');

const stamp = new Date().toISOString().slice(0, 10);
const version = (fs.readFileSync(path.join(SRC, '00_Config.gs'), 'utf8')
  .match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || 'unknown';

const header = `/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MGS TRACEABILITY & RECALL — Code.gs
 *  ระบบทวนสอบสินค้าและเรียกคืน · เวอร์ชัน ${version}
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ⚠️  ไฟล์นี้ถูกสร้างอัตโนมัติ — อย่าแก้ที่นี่
 *      แก้ที่ apps-script/traceability/*.gs แล้วรัน:
 *          node tools/build-traceability-codegs.js
 *      รวมจาก ${files.length} ไฟล์ เมื่อ ${stamp}
 *
 *  ───────────────────────────────────────────────────────────────────────────
 *  โปรเจกต์ Apps Script นี้มีแค่ 2 ไฟล์
 *      Code.gs      ← ไฟล์นี้
 *      index.html   ← หน้าเว็บ (ต้องตั้งชื่อว่า index พอดี ไม่งั้น doGet หาไม่เจอ)
 *
 *  ขั้นตอนติดตั้ง (ทำครั้งเดียว)
 *      1. รัน  setupCreateWorkbook()      สร้างสเปรดชีตและ 23 แท็บ
 *      2. ใส่รายชื่อผู้ใช้ในแท็บ Users     (ต้องมี ADMIN อย่างน้อย 1 คน)
 *      3. รัน  setupGeneratePushSecret()  คัดลอกกุญแจไปใส่ตัวส่งข้อมูลในออฟฟิศ
 *      4. รัน  setupTriggers()            ตั้งตัวตั้งเวลา 4 ตัว
 *      5. รัน  runSelfTest()              ต้องผ่านทุกข้อก่อนไปต่อ
 *      6. Deploy > New deployment · Execute as: Me · Access: MGS domain
 *
 *  ทดลองใช้ก่อนเชื่อม SAP
 *      รัน  setupSeedDemoData()   ได้ข้อมูลตัวอย่างที่ตรงกับฟอร์ม QC เดิม
 *      ล้างทีหลังด้วย  setupWipeAllData("ลบข้อมูลทั้งหมด")
 *
 *  ⚠️  การกด Save ไม่ทำให้ผู้ใช้ได้โค้ดใหม่
 *      ต้อง Deploy > Manage deployments > แก้ > Version: New version ทุกครั้ง
 *
 *  ⚠️  ห้ามแชร์สเปรดชีตให้ผู้ใช้ทั่วไป
 *      ถ้าเปิดชีตตรงได้ กฎตรวจสอบ 13 ข้อและระบบสิทธิ์ทั้งหมดเป็นโมฆะทันที
 * ═══════════════════════════════════════════════════════════════════════════
 */

`;

const body = files.map(f => {
  const bar = '═'.repeat(Math.max(4, 68 - f.length));
  return `\n/* ${bar} ${f} ${'═'.repeat(4)} */\n\n` + fs.readFileSync(path.join(SRC, f), 'utf8').trimEnd() + '\n';
}).join('\n');

const out = header + body;
fs.writeFileSync(path.join(DIST, 'Code.gs'), out, 'utf8');

// index.html คัดลอกมาไว้ข้าง ๆ กัน เพื่อให้โฟลเดอร์ dist มีครบทุกอย่างที่ต้องวาง
fs.copyFileSync(path.join(SRC, 'index.html'), path.join(DIST, 'index.html'));

const lines = out.split('\n').length;
console.log('สร้าง apps-script/traceability/dist/Code.gs แล้ว — ' + lines.toLocaleString() + ' บรรทัด จาก ' + files.length + ' ไฟล์');
console.log('คัดลอก index.html ไปไว้ที่ dist/ ด้วย');

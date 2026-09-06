/* tools/flow-parity.mjs — ตรวจว่านิยามกระบวนการสองที่ยังตรงกัน
   รันด้วย: node tools/flow-parity.mjs

   ทำไมต้องมี
   ----------
   นิยามกระบวนการอยู่ที่ apps-script/Flow.gs ที่เดียว ระบบจริงส่งตารางจากตรงนั้นให้หน้าจอ
   แต่ presentation/prototype.html ยังถือสำเนาของตัวเองอยู่ เพราะต้องเปิดจากไฟล์เดียวได้
   ตอนใช้นำเสนอ (ไม่มีเซิร์ฟเวอร์ให้เรียก)

   สำเนาสองชุดที่ไม่มีใครตรวจ = สองชุดที่จะเริ่มพูดคนละเรื่องภายในไม่กี่เดือน
   ไฟล์นี้เทียบให้ — แก้ที่ไฟล์หนึ่งแล้วลืมอีกไฟล์ จะได้รู้ตั้งแต่วันนั้น ไม่ใช่วันสาธิต

   เทียบอะไรบ้าง (เอาเฉพาะที่ "ผิดแล้วคนละระบบ" ไม่ใช่ทุกตัวอักษร)
     ROLES · MODULES · PAY_ST · DONE_PAY  → รายชื่อคีย์ต้องเท่ากัน
     STAGES · DOCS                        → รหัสและลำดับต้องเท่ากัน
     PAY_TERMS                            → ลำดับแถว · รูปแบบที่จับ · ชื่อ · ธง lc/auto
                                            (ลำดับสำคัญ แถวกว้างมาก่อนจะกินแถวแคบ) */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Flow.gs'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'presentation', 'prototype.html'), 'utf8');

const bad = [];
const ck = (ok, msg) => { if (!ok) bad.push(msg); };

/* ตัดข้อความของตารางหนึ่งออกมา — จาก "ชื่อ = [" หรือ "ชื่อ = {" ไปจนวงเล็บปิดที่สมดุล
   นับวงเล็บจริง ไม่ใช้ regex ตะกละ เพราะในแถวมีทั้ง [] และ {} ซ้อนกัน */
function block(src, name) {
  const m = src.match(new RegExp('\\b' + name + '\\s*=\\s*([\\[{])'));
  if (!m) return null;
  const open = m[1], close = open === '[' ? ']' : '}';
  let i = m.index + m[0].length - 1, depth = 0, inRe = false, inStr = '';
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = ''; continue; }
    if (inRe) { if (c === '/' && prev !== '\\') inRe = false; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    // regex literal เริ่มหลัง m: เท่านั้นในไฟล์นี้ — พอสำหรับงานเทียบตาราง
    if (c === '/' && /m\s*:\s*$/.test(src.slice(Math.max(0, i - 4), i))) { inRe = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  return null;
}

/* คีย์ระดับบนสุดของอ็อบเจ็กต์ — นับเฉพาะที่ความลึก 1 ไม่ให้คีย์ข้างในหลุดมาปน */
function topKeys(text) {
  const body = text.slice(text.indexOf('{') + 1, text.lastIndexOf('}'));
  const out = [];
  let depth = 0, inStr = '', inRe = false, tok = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i], prev = body[i - 1];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = ''; continue; }
    if (inRe) { if (c === '/' && prev !== '\\') inRe = false; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') i++; continue; }
    if (c === '/' && body[i + 1] === '*') { i = body.indexOf('*/', i) + 1; continue; }
    if ('[{('.indexOf(c) >= 0) { depth++; tok = ''; continue; }
    if (']})'.indexOf(c) >= 0) { depth--; tok = ''; continue; }
    if (depth === 0) {
      if (c === ':') { const k = tok.trim(); if (/^\w+$/.test(k)) out.push(k); tok = ''; }
      else if (c === ',') tok = '';
      else tok += c;
    }
  }
  return out;
}

/* ความต่างที่ "รู้แล้วและตั้งใจ" — ต้องเขียนเหตุผลไว้ตรงนี้ ไม่ใช่ปิดเช็คเงียบ ๆ
   ไฟล์นี้จะพิมพ์รายการนี้ออกมาทุกครั้งที่รันผ่าน จะได้ไม่มีใครลืมว่ามันยังค้างอยู่
   ลบแถวออกจากตารางนี้เมื่อไหร่ = บังคับให้สองไฟล์ตรงกันเมื่อนั้น */
const KNOWN = {
  PAY_ST: {
    only_gs: ['CHECKED', 'REJECTED'],
    why: 'ระบบจริงเดินสายอนุมัติสี่มือ (ขอ → บัญชีตรวจ → หัวหน้าอนุมัติ → บันทึกจ่าย)\n' +
         '      สถานะ CHECKED/REJECTED จึงอยู่ในช่อง status ของงวด\n' +
         '      ตัวอย่างที่ใช้นำเสนอเก็บสถานะสายอนุมัติไว้คนละช่อง (reqSt) และ**ยังไม่มีด่านบัญชีตรวจ**\n' +
         '      → ตัวอย่างเดินจาก "จัดซื้อขอ" ไป "หัวหน้าอนุมัติ" ตรง ๆ ซึ่งสั้นกว่าของจริงหนึ่งด่าน\n' +
         '      งานที่ค้าง: เพิ่มด่านบัญชีตรวจในตัวอย่าง แล้วลบแถวนี้ทิ้ง'
  }
};

function sameList(a, b, what) {
  if (!a || !b) return ck(false, what + ': อ่านตารางจากไฟล์ไม่ได้ (Flow.gs=' + !!a + ' prototype=' + !!b + ')');
  const allow = (KNOWN[what] && KNOWN[what].only_gs) || [];
  a = a.filter(x => allow.indexOf(x) < 0);
  const miss = a.filter(x => b.indexOf(x) < 0), extra = b.filter(x => a.indexOf(x) < 0);
  ck(!miss.length, what + ': ตัวอย่างขาด ' + miss.join(' · '));
  ck(!extra.length, what + ': ตัวอย่างมีเกินมา ' + extra.join(' · '));
  if (!miss.length && !extra.length)
    ck(a.join('|') === b.join('|'), what + ': ลำดับไม่ตรงกัน\n      Flow.gs   ' + a.join(' · ') +
       '\n      prototype ' + b.join(' · '));
}

/* ---------- รายชื่อคีย์ ---------- */
[['ROLES', 'ROLES'], ['MODULES', 'MODULES'], ['PAY_ST', 'PAY_ST']].forEach(([g, h]) => {
  const A = block(GS, g), B = block(HTML, h);
  sameList(A && topKeys(A), B && topKeys(B), g);
});

/* ---------- DONE_PAY ---------- */
const strs = t => (t ? t.match(/["']([^"']+)["']/g) || [] : []).map(s => s.slice(1, -1));
sameList(strs(block(GS, 'DONE_PAY')), strs(block(HTML, 'DONE_PAY')), 'DONE_PAY');

/* ---------- STAGES / DOCS: รหัสและลำดับ ---------- */
const codes = t => (t ? [...t.matchAll(/\bc\s*:\s*["']([^"']+)["']/g)].map(m => m[1]) : null);
sameList(codes(block(GS, 'STAGES')), codes(block(HTML, 'STAGES')), 'STAGES');
sameList(codes(block(GS, 'DOCS')), codes(block(HTML, 'DOCS')), 'DOCS');

/* ---------- PAY_TERMS: แถวต่อแถว ----------
   ธง lc/auto อยู่ในตัว plan ซึ่งเขียนคนละสไตล์ (function ใน .gs / arrow ในตัวอย่าง)
   จึงไม่เทียบตัวอักษร แต่เทียบ "รูปแบบที่จับ + ชื่อ + ลำดับธงในแถว" ซึ่งคือความหมายจริง */
function terms(text, label) {
  if (!text) { bad.push('PAY_TERMS: อ่านจาก ' + label + ' ไม่ได้'); return []; }
  const body = text.slice(text.indexOf('[') + 1, text.lastIndexOf(']'));
  const rows = [];
  let depth = 0, start = 0, inStr = '', inRe = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i], prev = body[i - 1];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = ''; continue; }
    if (inRe) { if (c === '/' && prev !== '\\') inRe = false; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && /m\s*:\s*$/.test(body.slice(Math.max(0, i - 4), i))) { inRe = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0) rows.push(body.slice(start, i + 1)); }
  }
  return rows.map(r => ({
    // regex literal ของแถว: ตั้งแต่ m:/ ถึง / ที่ปิด (ข้าม \/ ที่อยู่ในตัวรูปแบบ)
    m: (r.match(/m\s*:\s*\/((?:\\.|[^/\\])*)\//) || [])[1] || '(อ่านไม่ได้)',
    n: (r.match(/\bn\s*:\s*["']([^"']+)["']/) || [])[1] || '(ไม่มีชื่อ)',
    // ธงของทุกงวดในแถว เรียงตามที่เขียน — 'lc' / 'auto' / '-' ต่อหนึ่งงวด
    flags: [...r.matchAll(/\btype\s*:\s*["'][^"']*["']([^{}]*)/g)]
      .map(g => /\blc\s*:\s*true/.test(g[1]) ? 'lc' :
                /\bauto\s*:\s*true/.test(g[1]) ? 'auto' : '-').join('+')
  }));
}
const TG = terms(block(GS, 'PAY_TERMS'), 'Flow.gs');
const TH = terms(block(HTML, 'PAY_TERMS'), 'prototype.html');
ck(TG.length === TH.length,
   'PAY_TERMS: จำนวนแถวไม่เท่ากัน (Flow.gs ' + TG.length + ' · ตัวอย่าง ' + TH.length + ')');
for (let i = 0; i < Math.min(TG.length, TH.length); i++) {
  const a = TG[i], b = TH[i];
  ck(a.m === b.m, 'PAY_TERMS แถวที่ ' + (i + 1) + ' (' + a.n + '): รูปแบบที่จับต่างกัน' +
     '\n      Flow.gs   /' + a.m + '/\n      prototype /' + b.m + '/');
  ck(a.n === b.n, 'PAY_TERMS แถวที่ ' + (i + 1) + ': ชื่อเงื่อนไขต่างกัน — "' + a.n + '" กับ "' + b.n + '"');
  ck(a.flags === b.flags, 'PAY_TERMS แถวที่ ' + (i + 1) + ' (' + a.n + '): ธงงวดต่างกัน — ' +
     'Flow.gs [' + a.flags + '] ตัวอย่าง [' + b.flags + ']' +
     '\n      lc = ธนาคารจ่ายตาม LC · auto = เครดิต SAP ตัดจ่ายตามรอบ · - = ต้องตั้งเรื่องขอจ่าย');
}

/* ---------- รายงาน ---------- */
if (bad.length) {
  console.log('นิยามกระบวนการสองที่ไม่ตรงกัน ' + bad.length + ' จุด:');
  bad.forEach(b => console.log('  - ' + b));
  console.log('\nแก้ที่ apps-script/Flow.gs เป็นหลัก แล้วสะท้อนไปที่ presentation/prototype.html');
  process.exit(1);
}
console.log('นิยามกระบวนการตรงกันทั้งสองที่ — ' +
  'ROLES · MODULES · PAY_ST · DONE_PAY · STAGES (' + codes(block(GS, 'STAGES')).length + ' ขั้น) · ' +
  'DOCS · PAY_TERMS (' + TG.length + ' เงื่อนไข · ธง lc/auto ตรงกันทุกงวด)');
Object.keys(KNOWN).forEach(k => {
  console.log('\n  ยังต่างกันโดยรู้ตัว — ' + k + ': มีใน Flow.gs แต่ไม่มีในตัวอย่าง (' +
    KNOWN[k].only_gs.join(' · ') + ')\n      ' + KNOWN[k].why);
});

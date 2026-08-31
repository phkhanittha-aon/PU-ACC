/**
 * ชุดทดสอบฝั่งเซิร์ฟเวอร์ — รันด้วย:  node tools/domain-test.mjs
 * =========================================================================
 * รันไฟล์ .gs จริงบน Node โดยจำลอง Google Sheets ไว้ในหน่วยความจำ
 * ทดสอบได้โดยไม่ต้องขึ้น Google ไม่ต้องมีบัญชี ไม่ต้อง deploy
 *
 * ตรงนี้คือที่ที่พิสูจน์ว่ากติกาสามข้อบังคับได้จริงที่เซิร์ฟเวอร์
 *   1. ยอดเงินไม่ออกจากเซิร์ฟเวอร์ไปหาบทบาทที่ไม่มีสิทธิ์เห็น
 *   2. คำสั่งที่บทบาทไม่มีสิทธิ์ ถูกปฏิเสธ
 *   3. ผู้ขอ ≠ ผู้อนุมัติ ≠ ผู้บันทึกจ่าย
 * การซ่อนที่หน้าจอไม่นับ — ทดสอบที่ผลลัพธ์ที่เซิร์ฟเวอร์ส่งออกมา
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const GS = path.join(DIR, '..', 'apps-script');
const bad = [];
const ck = (cond, msg) => { if (!cond) bad.push(msg); };

/* ---------- Google ปลอม ---------- */
const store = {};          // ชื่อแท็บ -> array ของ array (แถวแรกเป็นหัวคอลัมน์)
const props = {};
const cache = {};
let currentUser = '';
const sent = [];           // ข้อความ Lark ที่ถูกส่ง

function mkSheet(name) {
  const rows = () => store[name];
  return {
    getName: () => name,
    getLastRow: () => rows().length,
    getLastColumn: () => (rows()[0] ? rows()[0].length : 0),
    setFrozenRows: () => {},
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = rows()[r - 1 + i] || [];
            out.push(Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? ''));
          }
          return out;
        },
        setValues: (vals) => {
          vals.forEach((v, i) => {
            const ri = r - 1 + i;
            while (rows().length <= ri) rows().push([]);
            v.forEach((cell, j) => { rows()[ri][c - 1 + j] = cell; });
          });
          return this;
        },
        setFontWeight() { return this; }, setBackground() { return this; },
        setFontColor() { return this; }, setDataValidation() { return this; }
      };
    },
    appendRow: (row) => { rows().push(row.slice()); },
    setColumnWidth() { return this; }
  };
}
const fakeSS = {
  getId: () => 'FAKE_SHEET_ID',
  getSheetByName: (n) => (store[n] ? mkSheet(n) : null),
  insertSheet: (n) => { store[n] = []; return mkSheet(n); }
};

const g = {
  SpreadsheetApp: {
    openById: () => fakeSS, getActiveSpreadsheet: () => fakeSS,
    newDataValidation: () => ({
      requireValueInList() { return this; }, setAllowInvalid() { return this; },
      setHelpText() { return this; }, build: () => ({})
    }),
    getUi: () => ({ alert() {}, prompt: () => ({ getSelectedButton: () => null }),
                    createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; },
                                         addToUi() {} }), ButtonSet: {}, Button: {} })
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (props[k] === undefined ? null : props[k]),
      setProperty: (k, v) => { props[k] = String(v); }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => (cache[k] === undefined ? null : cache[k]),
      put: (k, v) => { cache[k] = v; },
      remove: (k) => { delete cache[k]; }
    })
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
  },
  Session: { getActiveUser: () => ({ getEmail: () => currentUser }) },
  Utilities: {
    formatDate: (d, tz, f) => {
      const p = (n) => String(n).padStart(2, '0');
      const D = d instanceof Date ? d : new Date(d);
      return f.replace('yyyy', D.getFullYear()).replace('yy', String(D.getFullYear()).slice(2))
        .replace('MM', p(D.getMonth() + 1)).replace('dd', p(D.getDate()))
        .replace('HH', p(D.getHours())).replace('mm', p(D.getMinutes()))
        .replace('ss', p(D.getSeconds()));
    },
    base64Decode: (s) => Buffer.from(s, 'base64'),
    newBlob: (b, m, n) => ({ bytes: b, mime: m, name: n })
  },
  Logger: { log: () => {} },
  MailApp: { sendEmail: () => {} },
  DriveApp: {
    createFolder: () => ({ getId: () => 'FOLDER' }),
    getFolderById: () => ({
      getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
      createFolder() { return this; },
      createFile: () => ({ getId: () => 'FILE_' + Math.random().toString(36).slice(2) })
    })
  },
  UrlFetchApp: {
    fetch: (url, opt) => {
      if (url.includes('tenant_access_token'))
        return { getContentText: () => JSON.stringify({ code: 0, tenant_access_token: 'T' }) };
      sent.push(JSON.parse(opt.payload));
      return { getContentText: () => JSON.stringify({ code: 0 }) };
    }
  },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({
    timeBased: () => ({ everyHours: () => ({ create() {} }), atHour: () => ({ everyDays: () => ({ create() {} }) }),
                        everyMinutes: () => ({ create() {} }) }) }) }
};

/* โหลดไฟล์ .gs ทั้งหมดเข้า scope เดียวกัน เหมือนที่ Apps Script ทำ */
const FILES = ['Flow.gs', 'Config.gs', 'Repo.gs', 'Auth.gs', 'Lark.gs', 'Domain.gs', 'Code.gs', 'Setup.gs'];
// Intake.gs ต้องอ่าน SapCostingImport.gs ด้วยจึงทดสอบแยกในไฟล์ของตัวเอง
const src = FILES.map(f => fs.readFileSync(path.join(GS, f), 'utf8'))
  .join('\n;\n')
  .replace(/if \(typeof module !== 'undefined' && module\.exports\)[\s\S]*?^}/m, '');

const names = Object.keys(g);
const api = new Function(...names, src + `
  ; return {apiBoot, apiListDeals, apiGetDeal, apiSaveHandoff, apiAdvanceStage,
            apiRequestPayment, apiApprovePayment, apiRecordPayment, apiSendFeedback,
            apiListUsers, apiAddToPilot, Repo, SHEETS, COLS, Auth, Domain, Config,
            STAGES, DOCS, ROLES, buildPayments, setupWorkspace};
`)(...names.map(n => g[n]));

/* ---------- เตรียมข้อมูลทดสอบ ---------- */
Object.keys(api.COLS).forEach(t => { store[t] = [api.COLS[t].slice()]; });
props.SPREADSHEET_ID = 'FAKE';
props.DRIVE_ROOT_ID = 'FOLDER';
props.LARK_APP_ID = 'x'; props.LARK_APP_SECRET = 'y'; props.LARK_GROUP_CHAT_ID = 'oc_1';

const U = {
  sr:  'somchai@mgs.co.th',   qc:  'somying@mgs.co.th',  ls: 'anucha@mgs.co.th',
  wh:  'prasert@mgs.co.th',   ac:  'wipa@mgs.co.th',     ac2:'nid@mgs.co.th',
  ach: 'aree@mgs.co.th',      ach2:'boss2@mgs.co.th',    gm: 'gm@mgs.co.th'
};
[['sr','SR','คุณสมชาย'],['qc','QC','คุณสมหญิง'],['ls','LS','คุณอนุชา'],['wh','WH','คุณประเสริฐ'],
 ['ac','AC','คุณวิภา'],['ac2','AC','คุณนิด'],['ach','ACH','คุณอารีย์'],['ach2','ACH','คุณบอส'],
 ['gm','GM','คุณผู้จัดการ']].forEach(([k, d, n]) => {
  api.Repo.insert(api.SHEETS.USERS, { email: U[k], full_name: n, dept: d, is_active: 'TRUE',
                                      lark_user_id: 'lk_' + k });
});
api.Repo.insert(api.SHEETS.CONFIG, { config_key: 'PILOT_ONLY', config_value: 'TRUE' });
api.Repo.insert(api.SHEETS.CONFIG, { config_key: 'LARK_ON', config_value: 'TRUE' });

const DEAL = 'PO-F126050001';
api.Repo.insert(api.SHEETS.DEALS, {
  deal_no: DEAL, entry: 'PO', module: 'FOOD', supplier: 'ABC Foods',
  item: 'กุ้งแช่แข็ง 16/20', qty: '500 KG', amount: 130000, currency: 'THB',
  payment_term: '100% after received goods within 7 days', term_name: 'เครดิตหลังรับของ',
  due_date: '2026-09-30', stage: 12, status: 'ACTIVE', owner_email: U.sr, created_at: new Date()
});
api.Repo.insert(api.SHEETS.STAGES, {
  deal_no: DEAL, seq: 12, stage_code: 'INVOICE_RECEIVED', owner_dept: 'AC',
  entered_at: new Date(), sla_hours: 72
});
api.buildPayments(130000, '100% after received goods within 7 days', '30/09/2026')
  .forEach(p => api.Repo.insert(api.SHEETS.PAYMENTS, {
    deal_no: DEAL, seq: p.seq, type: p.type, pct: p.pct, amount: p.amount,
    due: p.due, status: p.status, is_lc: p.lc ? 'TRUE' : 'FALSE'
  }));
api.Repo.insert(api.SHEETS.PILOT, { deal_no: DEAL, added_at: new Date(), added_by: U.sr });
// ค่าที่ขั้นรับใบแจ้งหนี้ส่งต่อ — มียอดเงินอยู่ข้างใน
api.Repo.insert(api.SHEETS.HANDOFF, {
  deal_no: DEAL, stage_code: 'INVOICE_RECEIVED', saved_at: new Date(), saved_by: U.ac,
  payload_json: JSON.stringify({ invNo: 'INV-ABC-0804', invAmt: 130000 })
});

const as = (email, fn) => { currentUser = email; try { return fn(); } finally { currentUser = ''; } };

/* ================= 1. ยอดเงินต้องไม่ออกจากเซิร์ฟเวอร์ ================= */
const MONEY_RE = /130000|"?amount"?|invAmt|payment_term/;
['qc', 'ls', 'wh'].forEach(k => {
  const list = as(U[k], () => api.apiListDeals());
  ck(list.ok, k + ': ดึงรายการไม่ได้ — ' + (list.error || ''));
  if (list.ok) {
    const raw = JSON.stringify(list.data);
    ck(!/130000/.test(raw), k.toUpperCase() + ' ได้รับยอดเงินมาจากเซิร์ฟเวอร์ในรายการ (listDeals)');
    ck(!/payment_term/.test(raw), k.toUpperCase() + ' ได้รับเงื่อนไขชำระเงินมาด้วย');
  }
  const one = as(U[k], () => api.apiGetDeal(DEAL));
  ck(one.ok, k + ': เปิดรายการไม่ได้ — ' + (one.error || ''));
  if (one.ok) {
    const raw = JSON.stringify(one.data);
    ck(!/130000/.test(raw), k.toUpperCase() + ' ได้รับยอดเงินมาจากเซิร์ฟเวอร์ตอนเปิดใบ (getDeal)');
    ck(!/invAmt/.test(raw), k.toUpperCase() + ' ได้รับ invAmt (ยอดในใบแจ้งหนี้) มาด้วย');
    ck(one.data.payments.length === 0, k.toUpperCase() + ' ได้รับตารางงวดจ่ายมาด้วย');
  }
});
// ฝั่งที่มีสิทธิ์ต้องยังเห็นครบ ไม่ใช่กรองจนใครก็ไม่เห็น
const acView = as(U.ac, () => api.apiGetDeal(DEAL));
ck(acView.ok && /130000/.test(JSON.stringify(acView.data)),
   'บัญชีเปิดใบเดียวกันแล้วไม่เห็นยอดเงิน — กรองแรงเกินไป');
ck(acView.ok && acView.data.payments.length > 0, 'บัญชีไม่เห็นตารางงวดจ่าย');

/* ================= 2. สิทธิ์รายคำสั่ง ================= */
const forbid = as(U.qc, () => api.apiRequestPayment(DEAL, 1, { amount: 100, billNo: 'X' }));
ck(!forbid.ok && forbid.code === 'FORBIDDEN', 'QC ตั้งเรื่องขอจ่ายได้ ทั้งที่ไม่มีสิทธิ์');
const forbid2 = as(U.ls, () => api.apiListUsers());
ck(!forbid2.ok, 'โลจิสติกส์ดูตารางผู้ใช้ได้ ทั้งที่ไม่มีสิทธิ์');
const notReg = as('stranger@example.com', () => api.apiListDeals());
ck(!notReg.ok && notReg.code === 'NOT_REGISTERED', 'คนนอกตาราง Users เข้าระบบได้');

/* ================= 3. เจ้าของขั้น ================= */
const notMine = as(U.qc, () => api.apiAdvanceStage(DEAL, ''));
ck(!notMine.ok && notMine.code === 'NOT_YOUR_STAGE',
   'QC ปิดขั้นของบัญชีได้ (ขั้นปัจจุบันคือรับใบแจ้งหนี้ เจ้าของคือ AC)');

/* ================= 4. แยกหน้าที่เรื่องเงิน ================= */
const req = as(U.ac, () => api.apiRequestPayment(DEAL, 1, {
  amount: 130000, billNo: 'INV-ABC-0804', billKind: 'INVOICE', billAmt: 130000
}));
ck(req.ok, 'บัญชีตั้งเรื่องขอจ่ายไม่ได้ — ' + (req.error || ''));

// จ่ายซ้ำด้วยใบเรียกเก็บใบเดิม
api.Repo.insert(api.SHEETS.PAYMENTS, { deal_no: DEAL, seq: 2, type: 'งวดทดสอบ',
  amount: 1000, status: 'PENDING', is_lc: 'FALSE' });
const dupBill = as(U.ac, () => api.apiRequestPayment(DEAL, 2, {
  amount: 1000, billNo: 'INV-ABC-0804'
}));
ck(!dupBill.ok && dupBill.code === 'DUP_BILL', 'ตั้งเบิกซ้ำด้วยใบเรียกเก็บใบเดิมได้');

// ตั้งเรื่องซ้ำงวดเดิม (กดสองครั้ง)
const twice = as(U.ac, () => api.apiRequestPayment(DEAL, 1, {
  amount: 130000, billNo: 'INV-ABC-0805'
}));
ck(!twice.ok && twice.code === 'BAD_STATUS', 'กดตั้งเรื่องซ้ำงวดเดิมแล้วได้สองครั้ง');

// ผู้ขออนุมัติเอง (บัญชีไม่มีสิทธิ์อนุมัติอยู่แล้ว) — ทดสอบกรณีหัวหน้าบัญชีตั้งเรื่องเอง
api.Repo.insert(api.SHEETS.PAYMENTS, { deal_no: DEAL, seq: 3, type: 'งวดทดสอบ 2',
  amount: 500, status: 'REQUESTED', is_lc: 'FALSE', req_by: U.ach, req_no: 'PRQ-26-9999' });
const selfApprove = as(U.ach, () => api.apiApprovePayment(DEAL, 3));
ck(!selfApprove.ok && selfApprove.code === 'SOD',
   'ผู้ตั้งเรื่องอนุมัติงวดของตัวเองได้ (P12)');
const otherApprove = as(U.ach2, () => api.apiApprovePayment(DEAL, 3));
ck(otherApprove.ok, 'หัวหน้าบัญชีคนอื่นอนุมัติไม่ได้ — ' + (otherApprove.error || ''));

// ผู้อนุมัติบันทึกจ่ายเอง
const apv = as(U.ach, () => api.apiApprovePayment(DEAL, 1));
ck(apv.ok, 'อนุมัติงวดที่ 1 ไม่ได้ — ' + (apv.error || ''));
api.Repo.update(api.SHEETS.USERS, 'email', U.ach, { dept: 'AC' });   // สมมติหัวหน้าถูกย้ายมาบัญชี
const selfRecord = as(U.ach, () => api.apiRecordPayment(DEAL, 1, {
  paidAmt: 130000, ref: 'KB001', slipFileId: 'F1'
}));
ck(!selfRecord.ok && selfRecord.code === 'SOD', 'ผู้อนุมัติบันทึกการจ่ายเองได้ (P13)');
api.Repo.update(api.SHEETS.USERS, 'email', U.ach, { dept: 'ACH' });

const rec = as(U.ac, () => api.apiRecordPayment(DEAL, 1, {
  paidAmt: 130000, ref: 'KB26083000456', slipFileId: 'FILE_X', method: 'TRANSFER'
}));
ck(rec.ok, 'บัญชีบันทึกการจ่ายไม่ได้ — ' + (rec.error || ''));
const noSlip = as(U.ac, () => api.apiRecordPayment(DEAL, 3, { paidAmt: 500, ref: 'X' }));
ck(!noSlip.ok, 'บันทึกการจ่ายได้โดยไม่แนบสลิป');

/* ================= 5. นอกช่วงทดลองต้องแก้ไม่ได้ ================= */
const OUT = 'PO-F126050999';
api.Repo.insert(api.SHEETS.DEALS, { deal_no: OUT, entry: 'PO', module: 'FOOD',
  supplier: 'X', amount: 1000, stage: 12, status: 'ACTIVE' });
const outside = as(U.ac, () => api.apiSaveHandoff(OUT, { invNo: 'A', invAmt: 1 }));
ck(!outside.ok && outside.code === 'NOT_IN_PILOT',
   'แก้รายการที่ไม่ได้อยู่ในช่วงทดลองได้');

/* ================= 6. ช่องบังคับและช่องเงิน ================= */
const missing = as(U.ac, () => api.apiSaveHandoff(DEAL, { invNo: '' }));
ck(!missing.ok && missing.code === 'REQUIRED', 'บันทึกข้อมูลส่งต่อได้ทั้งที่ช่องบังคับว่าง');
api.Repo.update(api.SHEETS.DEALS, 'deal_no', DEAL, { stage: 11 });
api.Repo.insert(api.SHEETS.STAGES, { deal_no: DEAL, seq: 11, stage_code: 'GR',
  owner_dept: 'WH', entered_at: new Date(), sla_hours: 24 });
const whMoney = as(U.wh, () => api.apiSaveHandoff(DEAL, {
  qtyIn: '500 KG', grNo: 'GR-1', invAmt: 999
}));
ck(!whMoney.ok && whMoney.code === 'FORBIDDEN_FIELD',
   'คลังส่งค่าช่องเงินขึ้นเซิร์ฟเวอร์ได้');

/* ================= 7. ความเห็นจากผู้ใช้ ================= */
const fb = as(U.qc, () => api.apiSendFeedback({
  message: 'กดบันทึกแล้วหน้าค้าง ต้องรีเฟรช', severity: 'BLOCKER', page: 'ใบ PO'
}));
ck(fb.ok && /^FB-/.test(fb.data.id), 'ส่งความเห็นไม่ได้ — ' + (fb.error || ''));
ck(sent.some(m => JSON.parse(m.content).text.includes('ทำงานต่อไม่ได้')),
   'ความเห็นระดับ BLOCKER ไม่ถูกส่งเข้ากลุ่ม Lark');
const short = as(U.qc, () => api.apiSendFeedback({ message: 'x' }));
ck(!short.ok, 'ส่งความเห็นสั้นเกินไปได้');

/* ================= 8. Lark ไม่หลุดยอดเงินเข้ากลุ่ม ================= */
const groupMsgs = sent.filter(m => m.receive_id === 'oc_1')
  .map(m => JSON.parse(m.content).text);
ck(!groupMsgs.some(t => /฿|130,000/.test(t)),
   'ข้อความที่ส่งเข้ากลุ่ม Lark มียอดเงินติดไปด้วย (กลุ่มมี QC/คลังอยู่)');

/* ================= 9. ประวัติถูกบันทึกครบ ================= */
const hist = api.Repo.readAll(api.SHEETS.HISTORY);
const acted = hist.map(h => String(h.action));
[['ตั้งเรื่องขอจ่ายงวดที่ 1', 'ตั้งเรื่องขอจ่าย'],
 ['อนุมัติ PRQ-26-9999 งวดที่ 3', 'อนุมัติจ่ายโดยหัวหน้าคนอื่น'],
 ['บันทึกจ่ายงวดที่ 1', 'บันทึกการจ่าย']].forEach(([frag, what]) => {
  ck(acted.some(a => a.includes(frag)), 'ไม่มีร่องรอยใน History ของ: ' + what);
});
ck(hist.every(h => String(h.actor).includes('@')), 'มีประวัติที่ไม่รู้ว่าใครทำ');
// ยอดเงินในบรรทัดประวัติต้องถูกห่อไว้ ไม่งั้นตัดออกให้ QC ไม่ได้
ck(acted.some(a => a.includes('⁢')), 'ยอดเงินในบรรทัดประวัติไม่ได้ห่อด้วยตัวคั่น — ตัดออกให้ QC ไม่ได้');
const qcHist = as(U.qc, () => api.apiGetDeal(DEAL));
ck(qcHist.ok && !qcHist.data.history.some(h => /130,000|฿/.test(h.text)),
   'QC เห็นยอดเงินในบรรทัดประวัติ');

/* ================= 10. หน้าจอ — ตรวจแบบอ่านไฟล์ ================= */
const uiRaw = fs.readFileSync(path.join(GS, 'index.html'), 'utf8');
// นับเฉพาะโค้ดจริง — คอมเมนต์ที่พูดถึงกฎก็มีคำเดียวกันอยู่ ทำให้นับเกิน
const ui = uiRaw.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
// ทุกการเรียกเซิร์ฟเวอร์ต้องมีทางล้มเหลว ไม่งั้นเน็ตหลุดแล้วหน้าค้างเงียบ ๆ
const succ = (ui.match(/withSuccessHandler/g) || []).length;
const fail = (ui.match(/withFailureHandler/g) || []).length;
ck(succ === fail && succ > 0,
   'มีการเรียกเซิร์ฟเวอร์ที่ไม่มี withFailureHandler (สำเร็จ ' + succ + ' / ล้มเหลว ' + fail + ')');
// หน้าจอต้องไม่มีปุ่มสลับบทบาท — บทบาทมาจากตาราง Users ตามอีเมลเท่านั้น
ck(!/data-role=/.test(ui), 'หน้าจอยังมีปุ่มเลือกบทบาทอยู่ — บทบาทต้องมาจากเซิร์ฟเวอร์');
// หน้าจอต้องไม่ตัดสินสิทธิ์เอง ต้องถามจากรายการ can ที่เซิร์ฟเวอร์ส่งมา
ck(!/me\.dept\s*===\s*['"](?:AC|ACH|GM|SR)['"]/.test(ui),
   'หน้าจอตัดสินสิทธิ์จากชื่อแผนกเอง — ต้องใช้ can() ที่มาจากเซิร์ฟเวอร์');

/* ================= 11. ชื่อชนกันข้ามไฟล์ .gs =================
   Apps Script ใช้ global scope เดียวกันทั้งโปรเจกต์ ประกาศชื่อเดียวกันสองไฟล์
   ตัวหลังทับตัวแรกเงียบ ๆ ตอนรันในเครื่องไม่มีอะไรฟ้อง แต่ขึ้นจริงแล้วฟังก์ชันหาย
   เคยเจอมาแล้วจริง: onOpen อยู่ทั้ง Setup.gs และ SapCostingImport.gs เมนูหายไปหนึ่งชุด */
const seen = {}, clash = [];
fs.readdirSync(GS).filter(f => f.endsWith('.gs')).forEach(f => {
  const text = fs.readFileSync(path.join(GS, f), 'utf8');
  const re = /^(?:function\s+(\w+)|var\s+(\w+)\s*=)/gm;
  let m;
  while ((m = re.exec(text))) {
    const nm = m[1] || m[2];
    if (seen[nm] && seen[nm] !== f) clash.push(nm + ' (' + seen[nm] + ' + ' + f + ')');
    seen[nm] = f;
  }
});
ck(clash.length === 0, 'ชื่อประกาศซ้ำข้ามไฟล์ .gs — ตัวหลังจะทับตัวแรกเงียบ ๆ: ' + clash.join(', '));

/* ================= 12. ไวยากรณ์ของทุกไฟล์ =================
   ไฟล์ .gs กับสคริปต์ในหน้าจอไม่ได้ถูกรันตอนทดสอบทุกบรรทัด
   เครื่องหมายคำพูดไม่เข้าคู่จะไม่มีอะไรฟ้องจนกว่าจะขึ้น Google แล้วหน้าขาว
   (เจอมาแล้วจริง: บรรทัดหนึ่งเปิดด้วย " แต่ปิดด้วย ') */
import { execFileSync } from 'child_process';
import os from 'os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gscheck-'));
fs.readdirSync(GS).filter(f => f.endsWith('.gs')).forEach(f => {
  const js = path.join(tmp, f.replace(/\.gs$/, '.js'));
  fs.writeFileSync(js, fs.readFileSync(path.join(GS, f), 'utf8'));
  try { execFileSync('node', ['--check', js], { stdio: 'pipe' }); }
  catch (e) { bad.push('ไวยากรณ์ผิดใน ' + f + ': ' + String(e.stderr).split('\n')[2]); }
});
// ไฟล์มีหลาย <script> โดยตั้งใจ (ตัวเฝ้าดูแยกก้อนเพื่อให้รอดจาก syntax error ของก้อนใหญ่)
// ต้องตรวจทีละก้อน ดึงรวมกันแล้วจะกลายเป็น JS ที่ผิดไวยากรณ์เอง
const blocks = [...uiRaw.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ck(blocks.length >= 2, 'index.html ควรมีสคริปต์อย่างน้อย 2 ก้อน (ตัวเฝ้าดู + ตัวหลัก)');
blocks.forEach((code, i) => {
  const uiFile = path.join(tmp, 'ui' + i + '.js');
  fs.writeFileSync(uiFile, code);
  try { execFileSync('node', ['--check', uiFile], { stdio: 'pipe' }); }
  catch (e) {
    bad.push('ไวยากรณ์ผิดใน index.html สคริปต์ก้อนที่ ' + (i + 1) + ': ' +
      String(e.stderr).split('\n')[2]);
  }
});

/* ================= 13. บริการพิเศษที่โค้ดใช้ ต้องประกาศใน manifest =================
   Drive.Files.copy คือ Advanced Drive Service ไม่ใช่ DriveApp ธรรมดา
   ไม่ประกาศใน appsscript.json แล้วจะพังตอนรันจริงด้วย "Drive is not defined"
   ตอนทดสอบในเครื่องไม่มีอะไรฟ้อง เพราะเราจำลอง Drive ไว้เอง */
const manifest = JSON.parse(fs.readFileSync(path.join(GS, 'appsscript.json'), 'utf8'));
const declared = ((manifest.dependencies || {}).enabledAdvancedServices || [])
  .map(x => x.userSymbol);
const gsAll = fs.readdirSync(GS).filter(f => f.endsWith('.gs'))
  .map(f => fs.readFileSync(path.join(GS, f), 'utf8')).join('\n');
[['Drive', /\bDrive\.[A-Z]/], ['Sheets', /\bSheets\.[A-Z]/], ['Calendar', /\bCalendar\.[A-Z]/]]
  .forEach(([sym, re]) => {
    if (re.test(gsAll) && declared.indexOf(sym) < 0)
      bad.push('โค้ดใช้บริการพิเศษ ' + sym + ' แต่ appsscript.json ไม่ได้ประกาศไว้');
  });

/* ---------- สรุป ---------- */
if (bad.length) {
  console.log('พบปัญหา ' + bad.length + ':');
  bad.forEach(b => console.log('  - ' + b));
  process.exit(1);
}
console.log('ทดสอบฝั่งเซิร์ฟเวอร์ผ่านทั้งหมด');
console.log('  ยอดเงินไม่ออกไปหา QC/โลจิสติกส์/คลัง (list + detail + งวดจ่าย + Lark กลุ่ม)');
console.log('  สิทธิ์รายคำสั่ง · เจ้าของขั้น · คนนอกเข้าไม่ได้');
console.log('  แยกหน้าที่ P12/P13 · กันตั้งเบิกซ้ำ · กันใบเรียกเก็บซ้ำ · บังคับแนบสลิป');
console.log('  นอกช่วงทดลองแก้ไม่ได้ · ช่องบังคับ · ช่องเงินส่งมาไม่ได้ · ความเห็นเข้ากลุ่ม Lark');
console.log('  หน้าจอ: ทุกการเรียกมีทางล้มเหลว · ไม่มีปุ่มสลับบทบาท · ไม่ตัดสินสิทธิ์เอง');
console.log('  ไม่มีชื่อฟังก์ชันชนกันข้ามไฟล์ .gs (' + Object.keys(seen).length + ' ชื่อ)');
console.log('  ไวยากรณ์ผ่านทุกไฟล์ .gs และสคริปต์ในหน้าจอ');
console.log('  บริการพิเศษที่โค้ดใช้ประกาศครบใน manifest (' + (declared.join(', ') || 'ไม่มี') + ')');

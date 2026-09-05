/**
 * ทดสอบตั้งแต่ต้นจนจบ — รันด้วย:  node tools/e2e-test.mjs
 * =========================================================================
 * เดินเส้นทางเดียวกับที่ IT กับพนักงานทำจริง บนชีตที่ "ว่างเปล่าจริง ๆ"
 *
 *   1. IT กดเมนู ติดตั้งระบบ           (setupWorkspace)
 *   2. หัวหน้าแผนกกรอกอีเมลใน Users
 *   3. IT นำเข้าไฟล์ Costing            (importFromCosting)
 *   4. จัดซื้อเพิ่ม PO เข้าช่วงทดลอง
 *   5. พนักงานเปิดเว็บ                  (apiBoot -> apiListDeals -> apiGetDeal)
 *   6. เดินงานจริงจนถึงจ่ายเงิน
 *
 * ต่างจาก domain-test.mjs ตรงที่ไฟล์นั้นวางข้อมูลตั้งต้นให้เองแบบสะอาด
 * ส่วนไฟล์นี้ *ไม่วางอะไรเลย* ให้โค้ดติดตั้งสร้างทุกอย่างขึ้นมาเอง
 * แล้วเลียนแบบพฤติกรรมจริงของ Sheets ที่ทำให้พลาดกันบ่อย
 *   - เซลล์วันที่คืนค่าเป็น Date object ไม่ใช่ข้อความ
 *   - เซลล์ตัวเลขคืนเป็น number · เซลล์ว่างคืนเป็น '' ไม่ใช่ null
 *   - แถวเทมเพลตที่ยังไม่กรอกอีเมลก็ยังอยู่ในชีต
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const GS = path.join(DIR, '..', 'apps-script');
const bad = [];
const step = [];
const ck = (cond, msg) => { if (!cond) bad.push(msg); return cond; };

/* ---------- Sheets ปลอมที่ทำตัวเหมือนของจริง ---------- */
const store = {};
const props = {};
const cache = {};
let currentUser = '';
const larkSent = [];
const alerts = [];

function cellOut(v) {
  // Sheets คืนค่าว่างเป็น '' เสมอ ไม่เคยคืน null/undefined
  return (v === undefined || v === null) ? '' : v;
}
function mkSheet(name) {
  const rows = () => store[name];
  const self = {
    getName: () => name,
    getLastRow: () => rows().length,
    getLastColumn: () => rows().reduce((m, r) => Math.max(m, r.length), 0),
    setFrozenRows: () => self,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => cellOut((rows()[r - 1 + i] || [])[c - 1 + j]))),
        setValues: (vals) => {
          vals.forEach((v, i) => {
            const ri = r - 1 + i;
            while (rows().length <= ri) rows().push([]);
            v.forEach((cell, j) => { rows()[ri][c - 1 + j] = cell; });
          });
          return this;
        },
        setFontWeight: () => ({ setBackground: () => ({ setFontColor: () => {} }) }),
        setBackground: () => ({ setFontColor: () => {} }),
        setFontColor: () => {},
        setDataValidation: () => {}
      };
    },
    appendRow: (row) => { rows().push(row.slice()); },
    setColumnWidth: () => self
  };
  return self;
}
const fakeSS = {
  getId: () => 'SHEET_E2E',
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
    getUi: () => ({
      alert: (...a) => alerts.push(a.join(' | ')),
      prompt: () => ({ getSelectedButton: () => null }),
      createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; },
                           addToUi() {} }),
      ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' }, Button: { OK: 'OK' }
    })
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (props[k] === undefined ? null : props[k]),
    setProperty: (k, v) => { props[k] = String(v); } }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (cache[k] === undefined ? null : cache[k]),
    put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => currentUser }),
             getScriptTimeZone: () => 'Asia/Bangkok' },
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
  DriveApp: (() => {
    // โฟลเดอร์ปลอมที่ซ้อนกันได้จริง — ของเดิมสร้างลูกแล้วลูกไม่มี getFoldersByName
    // ทำให้เส้นทางอัพโหลดพังตั้งแต่ชั้นที่สอง แล้วเราจะไม่รู้ว่าโค้ดจริงพังหรือของปลอมพัง
    const mk = (name) => {
      const kids = {}, files = [];
      const f = {
        getId: () => 'FOLDER_' + name, getName: () => name,
        getFoldersByName: (n) => {
          const hit = kids[n];
          let done = !hit;
          return { hasNext: () => !done, next: () => { done = true; return hit; } };
        },
        createFolder: (n) => (kids[n] = kids[n] || mk(n)),
        createFile: (blob) => { files.push(blob); return { getId: () => 'FILE_' + files.length }; },
        getFilesByName: () => ({ hasNext: () => false }),
        __files: files
      };
      return f;
    };
    const root = mk('MGS-Documents');
    return { createFolder: (n) => mk(n), getFolderById: () => root, __root: root };
  })(),
  UrlFetchApp: { fetch: (url, opt) => {
    if (url.includes('tenant_access_token'))
      return { getContentText: () => JSON.stringify({ code: 0, tenant_access_token: 'T' }) };
    if (opt && opt.payload) larkSent.push(JSON.parse(opt.payload));
    return { getContentText: () => JSON.stringify({ code: 0, data: { items: [] } }) };
  } },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({
    timeBased: () => ({ everyHours: () => ({ create() {} }),
                        atHour: () => ({ everyDays: () => ({ create() {} }) }),
                        everyMinutes: () => ({ create() {} }) }) }) },
  Drive: { Files: { copy: () => ({ id: 'TMP' }) } },
  MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' }
};

const FILES = ['Flow.gs', 'Config.gs', 'Repo.gs', 'Auth.gs', 'Lark.gs', 'Domain.gs',
               'Code.gs', 'Setup.gs', 'SapCostingImport.gs', 'Intake.gs'];
const src = FILES.map(f => fs.readFileSync(path.join(GS, f), 'utf8')).join('\n;\n')
  .replace(/if \(typeof module !== 'undefined' && module\.exports\)[\s\S]*?^}/m, '');
const names = Object.keys(g);
const app = new Function(...names, src + `
  ; return {setupWorkspace, apiBoot, apiListDeals, apiGetDeal, apiSaveHandoff,
            apiAdvanceStage, apiRequestPayment, apiApprovePayment, apiRecordPayment,
            apiUploadDoc, apiAddToPilot, apiSendFeedback, apiCheckPayment,
            apiRejectPayment, apiConfirmShortClose, apiPulse,
            Repo, SHEETS, Intake, Auth,
            STAGES, DOCS, usersReport_, healthCheck};
`)(...names.map(n => g[n]));

const as = (email, fn) => { currentUser = email; try { return fn(); } finally { currentUser = ''; } };
const ok = (r, what) => {
  if (!r || !r.ok) { bad.push(what + ' ล้มเหลว: ' + ((r && r.error) || 'ไม่มีผลลัพธ์')); return null; }
  return r.data;
};

/* ===== 1. IT กดติดตั้งระบบบนชีตว่างเปล่า ===== */
props.LARK_APP_ID = 'x'; props.LARK_APP_SECRET = 'y'; props.LARK_GROUP_CHAT_ID = 'oc_1';
props.DRIVE_ROOT_ID = 'FOLDER_ROOT';
app.setupWorkspace();
step.push('ติดตั้งระบบ — สร้าง ' + Object.keys(store).length + ' แท็บ');
ck(Object.keys(store).length >= 13, 'ติดตั้งแล้วแท็บไม่ครบ (ได้ ' + Object.keys(store).length + ')');
ck(!!store['Users'] && store['Users'].length > 1, 'แท็บ Users ไม่มีแถวเทมเพลตให้กรอก');
ck(!!store['Assignments'] && store['Assignments'].length > 1, 'แท็บ Assignments ไม่ถูกเตรียมไว้');
ck(props.SPREADSHEET_ID === 'SHEET_E2E', 'ติดตั้งแล้วไม่ได้ตั้ง SPREADSHEET_ID ให้เอง');

/* ===== 2. คนยังไม่ได้กรอกอีเมล — ต้องเข้าไม่ได้ และต้องบอกให้รู้เรื่อง ===== */
const before = as('somchai@mglobalsourcing.net', () => app.apiBoot());
ck(before && !before.ok && before.code === 'NOT_REGISTERED',
   'ยังไม่ได้กรอกอีเมลแต่เข้าระบบได้ (ได้ ' + JSON.stringify(before && before.code) + ')');
step.push('ยังไม่กรอกอีเมล — ระบบปฏิเสธพร้อมบอกวิธีแก้');

/* ===== 3. หัวหน้าแผนกกรอกอีเมลทับแถวเทมเพลต (เหมือนพิมพ์ในชีตจริง) ===== */
const U = {SR:'somchai@mglobalsourcing.net', QC:'somying@mglobalsourcing.net',
           LS:'anucha@mglobalsourcing.net', WH:'prasert@mglobalsourcing.net',
           AC_TH:'wipa@mglobalsourcing.net', AC_FN:'nid@mglobalsourcing.net',
           ACH:'aree@mglobalsourcing.net', GM:'gm@mglobalsourcing.net'};
const NAME = {SR:'สมชาย', QC:'สมหญิง', LS:'อนุชา', WH:'ประเสริฐ',
              AC_TH:'วิภา', AC_FN:'นิด', ACH:'อารีย์', GM:'ผู้จัดการ'};
const hdr = store['Users'][0];
const cE = hdr.indexOf('email'), cN = hdr.indexOf('full_name'), cD = hdr.indexOf('dept');
const cL = hdr.indexOf('lark_user_id');
Object.keys(U).forEach(d => {
  let row = store['Users'].slice(1).filter(r => String(r[cD]).trim() === d)[0];
  if (!row) { row = new Array(hdr.length).fill(''); row[cD] = d;
              row[hdr.indexOf('is_active')] = 'TRUE'; store['Users'].push(row); }
  row[cE] = U[d]; row[cN] = NAME[d]; row[cL] = 'lk_' + d;
});
step.push('กรอกอีเมลครบ ' + Object.keys(U).length + ' แผนก');

/* ===== 4. ระบุเจ้าของงานตามกลุ่ม ===== */
const ah = store['Assignments'][0];
store['Assignments'].slice(1).forEach(r => {
  if (String(r[ah.indexOf('group_code')]).trim() === 'FOOD')
    r[ah.indexOf('sr_email')] = U.SR;
});

/* ===== 5. นำเข้าจาก Costing (เลียนแบบแถวที่อ่านได้จากไฟล์จริง) ===== */
const rows = [
  {'PO Number':'PO-F126050001', 'Supplier':'ABC Foods', 'PO Payment Term':'100% after received goods within 7 days',
   'Price':130000, 'Currency':'THB', 'Due Date':'2026-09-30', 'Payment_Status':'🟢', '_item':'กุ้งแช่แข็ง 16/20', '_module':'FOOD'},
  {'PO Number':'PO-M226050002', 'Supplier':'Sungrow', 'PO Payment Term':'30% advance and 70% L/C',
   'Price':420000, 'Currency':'USD', 'Due Date':'2026-10-15', 'Payment_Status':'🟢', '_item':'อินเวอร์เตอร์', '_module':'MECH'}
];
const imp = as(U.SR, () => {
  const me = app.Auth.me();
  return app.Intake.run(me, rows);
});
ck(imp && imp.created === 2, 'นำเข้าไม่ได้ 2 รายการ (ได้ ' + (imp && imp.created) + ')');
step.push('นำเข้า ' + (imp && imp.created) + ' รายการ · เริ่มที่ขั้น ' +
          app.STAGES[imp.startStage].n + ' (' + app.STAGES[imp.startStage].o + ')');
const dealsNow = app.Repo.readAll(app.SHEETS.DEALS);
ck(dealsNow.length === 2, 'ตาราง Deals ไม่มี 2 แถว');
ck(String(dealsNow[0].owner_email) === U.SR, 'ใบสายอาหารไม่ได้เจ้าของงานตามกลุ่ม');
ck(String(dealsNow[1].owner_email) === '', 'ใบสายเครื่องจักรไม่ควรมีเจ้าของ (ยังไม่ได้ระบุในตาราง)');

/* ===== 6. พนักงานเปิดเว็บ — เส้นทางเดียวกับที่หน้าจอเรียก ===== */
const boot = ok(as(U.SR, () => app.apiBoot()), 'เปิดระบบ (apiBoot)');
ck(boot && boot.me && boot.me.dept === 'SR', 'เปิดระบบแล้วบทบาทไม่ถูก');
ck(boot && boot.flow && boot.flow.STAGES.length === 17, 'เปิดระบบแล้วไม่ได้นิยามกระบวนการ');
const list = ok(as(U.SR, () => app.apiListDeals()), 'ดึงรายการ (apiListDeals)');
ck(Array.isArray(list) && list.length === 2, 'ดึงรายการแล้วไม่ได้ 2 ใบ');
step.push('จัดซื้อเปิดเว็บ เห็น ' + (list ? list.length : 0) + ' รายการ');

const DEAL = 'PO-F126050001';
ok(as(U.SR, () => app.apiAddToPilot(DEAL, 'ทดลอง')), 'เพิ่มเข้าช่วงทดลอง');
const det = ok(as(U.SR, () => app.apiGetDeal(DEAL)), 'เปิดใบ (apiGetDeal)');
ck(det && det.inPilot === true, 'เพิ่มเข้าช่วงทดลองแล้วแต่ใบยังไม่ติดธง');
ck(det && Number(det.stage) === 8, 'ใบไม่ได้เริ่มที่ขั้นจัดซื้อแนบ PO');

/* ===== 7. จัดซื้อแนบ PO แล้วส่งต่อ ===== */
const noDoc = as(U.SR, () => app.apiAdvanceStage(DEAL, ''));
ck(noDoc && !noDoc.ok && ['NEED_DOC', 'REQUIRED'].indexOf(noDoc.code) >= 0,
   'ส่งต่อได้ทั้งที่ยังไม่ได้แนบ PO และยังไม่ได้กรอกวันนัดส่ง (ต้องบังคับ)');
ok(as(U.SR, () => app.apiUploadDoc(DEAL, 'PO_SIGNED', 'po.pdf', 'AAAA', 'application/pdf')),
   'แนบ PO');
ok(as(U.SR, () => app.apiSaveHandoff(DEAL, {shipDate:'2026-09-01'})), 'กรอกวันนัดส่ง');
const adv = ok(as(U.SR, () => app.apiAdvanceStage(DEAL, '')), 'ส่งต่อขั้นถัดไป');
ck(adv && Number(adv.stage) === 9, 'ส่งต่อแล้วไม่ได้ไปขั้นจองรถ (ได้ ' + (adv && adv.stage) + ')');
step.push('จัดซื้อแนบ PO + ส่งต่อ → ขั้น ' + app.STAGES[9].n);
ck(larkSent.length > 0, 'ส่งต่อแล้วไม่มีการแจ้งเตือน Lark');

/* ===== 8. QC ต้องไม่เห็นยอดเงินตลอดทาง ===== */
const qcList = ok(as(U.QC, () => app.apiListDeals()), 'QC ดึงรายการ');
const qcDet = ok(as(U.QC, () => app.apiGetDeal(DEAL)), 'QC เปิดใบ');
ck(!/130000|420000/.test(JSON.stringify(qcList)), 'QC เห็นยอดเงินในรายการ');
ck(!/130000/.test(JSON.stringify(qcDet)), 'QC เห็นยอดเงินในใบ');
step.push('QC เปิดดูได้ แต่ไม่เห็นยอดเงิน');

/* ===== 9. บัญชีเข้าคิวถูกฝั่งตามสกุลเงิน ===== */
const thDeal = app.Repo.readAll(app.SHEETS.DEALS).filter(d => d.deal_no === DEAL)[0];
ck(String(thDeal.currency) === 'THB', 'สกุลเงินของใบทดสอบไม่ใช่ THB');
const fnList = ok(as(U.AC_FN, () => app.apiListDeals()), 'บัญชีต่างประเทศดึงรายการ');
ck(/130000/.test(JSON.stringify(fnList)), 'บัญชีต่างประเทศควรเห็นยอดเงิน (ดูได้ทุกใบ)');
step.push('บัญชีสองฝั่งเปิดดูได้ · คิวแยกตามสกุลเงิน');

/* ===== 10. เดินให้ครบทั้งกระบวนการจนปิดบัญชี =====
   ตรงนี้คือคำถามที่ทีมถาม: "ทำครบ process แล้วติดตรงไหน"
   เดินทีละขั้นด้วยบทบาทที่ถือขั้นนั้นจริง กรอกเฉพาะช่องที่ระบบขอ
   ขั้นไหนเดินไม่ผ่าน ให้บอกว่าติดที่ขั้นไหน เพราะอะไร */
const DEPT_USER = {SR:U.SR, QC:U.QC, LS:U.LS, WH:U.WH, ACH:U.ACH, GM:U.GM,
                   AC:U.AC_TH, AC_FN:U.AC_FN, AC_TH:U.AC_TH};
const SAMPLE = {text:'ทดสอบ', num:'1', date:'2026-09-15', time:'09:00'};
const walked = [];
let guard = 0;

while (guard++ < 30) {
  const cur = app.Repo.readAll(app.SHEETS.DEALS).filter(d => d.deal_no === DEAL)[0];
  if (String(cur.status) !== 'ACTIVE') break;
  const idx = Number(cur.stage);
  const want = app.Auth.CAN ? null : null;
  const dept = (function () {
    // แผนกที่ถือขั้นนี้จริง (บัญชีแยกสองฝั่งตามสกุลเงิน)
    const st = app.STAGES[idx];
    if (st.o !== 'AC') return st.o;
    return String(cur.currency).toUpperCase() === 'THB' ? 'AC_TH' : 'AC_FN';
  })();
  const who = DEPT_USER[dept];
  if (!who) { bad.push('ขั้น ' + app.STAGES[idx].n + ' ไม่มีผู้ใช้ของแผนก ' + dept); break; }

  // กรอกช่องที่ขั้นนี้ขอ (ถ้ามี)
  const spec = as(who, () => app.apiGetDeal(DEAL));
  const hand = (spec && spec.ok && spec.data) ? spec.data : null;
  const flowHand = boot.flow.HAND[app.STAGES[idx].c];
  if (flowHand) {
    const fields = (flowHand.f || []).concat(
      (flowHand.byMod && flowHand.byMod[String(cur.module)]) || []);
    const payload = {};
    fields.forEach(f => {
      payload[f.k] = f.t === 'sel' ? f.o[0] : (SAMPLE[f.t] || SAMPLE.text);
    });
    const sv = as(who, () => app.apiSaveHandoff(DEAL, payload));
    if (!sv.ok) { bad.push('ขั้น ' + app.STAGES[idx].n + ' กรอกข้อมูลไม่ผ่าน: ' + sv.error); break; }
  }
  // แนบเอกสารที่ขั้นนี้บังคับ
  app.DOCS.filter(d => d.at === idx && d.req).forEach(d => {
    const up = as(who, () => app.apiUploadDoc(DEAL, d.c, d.c + '.pdf', 'AAAA', 'application/pdf'));
    if (!up.ok) bad.push('ขั้น ' + app.STAGES[idx].n + ' แนบ ' + d.n + ' ไม่ได้: ' + up.error);
  });

  const r = as(who, () => app.apiAdvanceStage(DEAL, ''));
  if (!r.ok) {
    bad.push('เดินไม่ผ่านที่ขั้น "' + app.STAGES[idx].n + '" (' + dept + '): ' + r.error);
    break;
  }
  walked.push(app.STAGES[idx].n + ' [' + dept + ']');
  if (r.data && r.data.done) break;
}
step.push('เดินครบ ' + walked.length + ' ขั้น: ' + walked.slice(0, 4).join(' → ') +
          (walked.length > 4 ? ' → … → ' + walked[walked.length - 1] : ''));

const closed = app.Repo.readAll(app.SHEETS.DEALS).filter(d => d.deal_no === DEAL)[0];
ck(String(closed.status) === 'COMPLETED',
   'เดินจนจบแล้วรายการยังไม่ปิด (สถานะ ' + closed.status + ' ค้างที่ขั้น ' +
   (app.STAGES[Number(closed.stage)] || {}).n + ')');

/* ===== 11. เรื่องเงิน — ตั้งเบิก อนุมัติ บันทึกจ่าย ===== */
const pays = app.Repo.readAll(app.SHEETS.PAYMENTS).filter(p => p.deal_no === DEAL);
ck(pays.length > 0, 'ไม่มีงวดจ่ายให้ทำ');
if (pays.length) {
  const seq = Number(pays[0].seq);
  /* สายอนุมัติสี่มือ: จัดซื้อตั้งเรื่อง → บัญชีตรวจ → หัวหน้าอนุมัติ → บัญชีบันทึกจ่าย
     พร้อมทดสอบทางตีกลับซึ่งเป็นเส้นทางที่เกิดจริงบ่อยกว่าทางผ่านฉลุย */
  const rq = as(U.SR, () => app.apiRequestPayment(DEAL, seq, {
    amount: 130000, billNo: 'INV-ABC-0804', billAmt: 130000}));
  ck(rq.ok, 'จัดซื้อตั้งเรื่องขอจ่ายไม่ผ่าน: ' + (rq.error || ''));

  const acCant = as(U.AC_TH, () => app.apiRequestPayment(DEAL, 99, {
    amount: 1, billNo: 'X'}));
  ck(!acCant.ok, 'บัญชีตั้งเรื่องขอจ่ายเองได้ (ต้องเป็นจัดซื้อเท่านั้น)');

  const early = as(U.ACH, () => app.apiApprovePayment(DEAL, seq));
  ck(!early.ok && early.code === 'NEED_CHECK',
     'อนุมัติได้ทั้งที่บัญชียังไม่ได้ตรวจ (ต้องบังคับให้ตรวจก่อน)');

  const noWhy = as(U.AC_TH, () => app.apiRejectPayment(DEAL, seq, ''));
  ck(!noWhy.ok && noWhy.code === 'NEED_REASON', 'ตีกลับได้โดยไม่ต้องเขียนเหตุผล');

  const larkBefore = larkSent.length;
  const rej = as(U.AC_TH, () => app.apiRejectPayment(DEAL, seq,
    'ใบแจ้งหนี้ไม่มีเลขผู้เสียภาษีของผู้ขาย ขอใบใหม่'));
  ck(rej.ok, 'บัญชีตีกลับไม่ผ่าน: ' + (rej.error || ''));
  const rejMsgs = larkSent.slice(larkBefore)
    .map(m => JSON.parse(m.content).text).join('\n');
  ck(/ถูกตีกลับ|ตีกลับ/.test(rejMsgs), 'ตีกลับแล้วไม่มีการแจ้งเตือน');
  ck(/เลขผู้เสียภาษี/.test(rejMsgs), 'การแจ้งเตือนไม่ได้บอกเหตุผลที่ตีกลับ');
  step.push('บัญชีตีกลับพร้อมเหตุผล → แจ้งเตือนถึงผู้ขอ');

  const rowRej = app.Repo.readAll(app.SHEETS.PAYMENTS)
    .filter(x => x.deal_no === DEAL && Number(x.seq) === seq)[0];
  ck(String(rowRej.status) === 'REJECTED', 'ตีกลับแล้วสถานะไม่เปลี่ยน');
  ck(String(rowRej.rej_note).includes('เลขผู้เสียภาษี'), 'ไม่ได้เก็บหมายเหตุที่ตีกลับ');

  // จัดซื้อแก้แล้วส่งใหม่ ต้องได้เลขคำขอเดิม จะได้ตามเรื่องเดียวกันต่อได้
  const again = as(U.SR, () => app.apiRequestPayment(DEAL, seq, {
    amount: 130000, billNo: 'INV-ABC-0804-R1', billAmt: 130000}));
  ck(again.ok, 'แก้แล้วส่งใหม่ไม่ผ่าน: ' + (again.error || ''));
  ck(again.ok && again.data.reqNo === rq.data.reqNo, 'ส่งใหม่แล้วเลขคำขอเปลี่ยน');
  step.push('จัดซื้อแก้แล้วส่งใหม่ ใช้เลขคำขอเดิม');

  const selfChk = as(U.SR, () => app.apiCheckPayment(DEAL, seq, ''));
  ck(!selfChk.ok, 'ผู้ตั้งเรื่องตรวจงานตัวเองได้');
  const chk = as(U.AC_TH, () => app.apiCheckPayment(DEAL, seq, 'เอกสารครบแล้ว'));
  ck(chk.ok, 'บัญชีตรวจสอบไม่ผ่าน: ' + (chk.error || ''));

  const ap = as(U.ACH, () => app.apiApprovePayment(DEAL, seq));
  ck(ap.ok, 'อนุมัติจ่ายไม่ผ่าน: ' + (ap.error || ''));
  const selfRec = as(U.ACH, () => app.apiRecordPayment(DEAL, seq, {
    paidAmt: 130000, ref: 'KB1', slipFileId: 'F1'}));
  ck(!selfRec.ok, 'ผู้อนุมัติบันทึกจ่ายเองได้ (ต้องห้าม)');
  const rec = as(U.AC_TH, () => app.apiRecordPayment(DEAL, seq, {
    paidAmt: 130000, ref: 'KB26083000456', slipFileId: 'FILE_1'}));
  ck(rec.ok, 'บันทึกการจ่ายไม่ผ่าน: ' + (rec.error || ''));
  step.push('ตั้งเรื่อง(SR) → ตรวจ(บัญชี) → อนุมัติ(หัวหน้า) → บันทึกจ่าย(บัญชี) ครบสี่มือ');
}

/* ===== 12. ทวนสอบการตรวจยอดจ่าย และการรับของเกิน/ขาด ===== */
const D2 = 'PO-M226050002';                 // ใบสกุล USD ยอด 420,000
ok(as(U.SR, () => app.apiAddToPilot(D2, 'ทดสอบ')), 'เพิ่มใบที่สองเข้าช่วงทดลอง');
const p2 = app.Repo.readAll(app.SHEETS.PAYMENTS).filter(x => x.deal_no === D2);
// ใบนี้เงื่อนไข 30% advance + 70% L/C จึงมีสองงวด งวดที่สองเป็น LC
ck(p2.length === 2, 'ใบสกุล USD ควรมี 2 งวด (ได้ ' + p2.length + ')');
const lcRow = p2.filter(x => String(x.status) === 'LC')[0];
ck(!!lcRow, 'ไม่มีงวดที่เป็น LC');
if (lcRow) {
  const lcTry = as(U.SR, () => app.apiRequestPayment(D2, Number(lcRow.seq), {
    amount: 1000, billNo: 'X1'}));
  ck(!lcTry.ok && lcTry.code === 'LC', 'ตั้งเบิกงวด LC ได้ ทั้งที่ธนาคารจ่ายเอง');
}
const dep = p2.filter(x => String(x.status) === 'PENDING')[0];
if (dep) {
  // ขอเกินยอดของงวด/ของใบ ต้องถูกปฏิเสธ
  const over = as(U.SR, () => app.apiRequestPayment(D2, Number(dep.seq), {
    amount: 9999999, billNo: 'PI-001'}));
  ck(!over.ok && over.code === 'OVER_PO',
     'ขอจ่ายเกินยอดคงเหลือของใบได้ (พิมพ์เลขเกินมาแล้วไม่มีอะไรทัก)');
  // ขอเกินยอดในเอกสารเรียกเก็บ ต้องถูกปฏิเสธ
  const overBill = as(U.SR, () => app.apiRequestPayment(D2, Number(dep.seq), {
    amount: 126000, billNo: 'PI-001', billAmt: 100000}));
  ck(!overBill.ok && overBill.code === 'OVER_BILL', 'ขอจ่ายเกินยอดในเอกสารเรียกเก็บได้');
  const okReq = as(U.SR, () => app.apiRequestPayment(D2, Number(dep.seq), {
    amount: 126000, billNo: 'PI-001', billAmt: 126000}));
  ck(okReq.ok, 'ขอจ่ายตามยอดที่ถูกต้องไม่ผ่าน: ' + (okReq.error || ''));
  step.push('เพดานยอดจ่าย: เกินยอดใบ · เกินยอดเอกสารเรียกเก็บ · งวด LC — กันได้ทั้งสามแบบ');
}

/* ===== 13. รับของไม่ครบ ต้องกดยืนยันก่อนปิดใบ ===== */
const D3 = 'PO-F126050003';
app.Repo.insert(app.SHEETS.DEALS, {
  deal_no: D3, entry: 'PO', module: 'FOOD', supplier: 'ABC Foods', item: 'ปลาแซลมอน',
  amount: 50000, currency: 'THB', payment_term: 'UNKNOWN', due_date: '2026-10-01',
  stage: 16, status: 'ACTIVE', created_at: new Date()});
app.Repo.insert(app.SHEETS.STAGES, {deal_no: D3, seq: 16, stage_code: 'AC_CLOSE',
  owner_dept: 'AC', entered_at: new Date(), sla_hours: 48});
app.Repo.insert(app.SHEETS.PILOT, {deal_no: D3, added_at: new Date(), added_by: U.SR});
// QC บอกใบแจ้งหนี้ 500 KG แต่คลังรับเข้าจริง 470 KG
app.Repo.insert(app.SHEETS.HANDOFF, {deal_no: D3, stage_code: 'QC_INCOMING',
  payload_json: JSON.stringify({invQty: '500 KG', qtyOk: '470 KG'}), saved_at: new Date()});
app.Repo.insert(app.SHEETS.HANDOFF, {deal_no: D3, stage_code: 'GR',
  payload_json: JSON.stringify({qtyIn: '470 KG', grNo: 'GR-1'}), saved_at: new Date()});

const closeShort = as(U.AC_TH, () => app.apiAdvanceStage(D3, ''));
ck(!closeShort.ok && closeShort.code === 'QTY_SHORT',
   'ปิดใบได้ทั้งที่รับของขาด 30 KG โดยไม่มีใครยืนยัน');
const noWhy2 = as(U.AC_TH, () => app.apiConfirmShortClose(D3, ''));
ck(!noWhy2.ok, 'ยืนยันจบ PO ได้โดยไม่ต้องเขียนเหตุผล');
const conf = as(U.AC_TH, () => app.apiConfirmShortClose(D3,
  'ผู้ขายส่งได้เท่านี้ ตกลงกันแล้วว่าไม่ส่งเพิ่ม จ่ายตามที่รับจริง'));
ck(conf.ok, 'ยืนยันจบ PO ไม่ผ่าน: ' + (conf.error || ''));
ck(conf.ok && Math.abs(conf.data.diff) === 30, 'คำนวณส่วนต่างผิด (ได้ ' +
   (conf.ok ? conf.data.diff : '?') + ')');
const closeNow = as(U.AC_TH, () => app.apiAdvanceStage(D3, ''));
ck(closeNow.ok, 'ยืนยันแล้วยังปิดใบไม่ได้: ' + (closeNow.error || ''));
step.push('รับของขาด 30 KG → ปิดไม่ได้จนกว่าจะยืนยันพร้อมเหตุผล → ปิดได้');

/* ===== 14. นำเข้าซ้ำ — PO เดิมต้องไม่ขึ้นใหม่ และต้องบอกถ้ายอดเปลี่ยน ===== */
const again2 = as(U.SR, () => { const me = app.Auth.me(); return app.Intake.run(me, rows); });
ck(again2 && again2.created === 0, 'นำเข้าไฟล์เดิมซ้ำแล้วสร้างรายการใหม่ (ได้ ' +
   (again2 && again2.created) + ')');
ck(again2 && again2.inProgress.length > 0,
   'ไม่ได้รายงานว่ามี PO ที่ดำเนินเอกสารไปแล้วถูกข้าม');
const rowsChanged = rows.map(r => Object.assign({}, r, {Price: r.Price + 5000}));
const chg = as(U.SR, () => { const me = app.Auth.me(); return app.Intake.run(me, rowsChanged); });
ck(chg && chg.created === 0, 'ยอดเปลี่ยนแล้วสร้างใบใหม่ซ้ำ');
ck(chg && chg.changed.length === 2,
   'ไม่ได้เตือนว่ายอดใน SAP ไม่ตรงกับในระบบ (ได้ ' + (chg && chg.changed.length) + ')');
step.push('นำเข้าซ้ำ: ไม่สร้างใบซ้ำ · บอกว่าใบไหนดำเนินการอยู่ · เตือนเมื่อยอดใน SAP เปลี่ยน');

/* ===== 15. สถานะเรียลไทม์ ===== */
const pulse1 = ok(as(U.SR, () => app.apiPulse()), 'ตรวจความเปลี่ยนแปลง');
app.Repo.update(app.SHEETS.DEALS, 'deal_no', D3, {status: 'CANCELLED'});
const pulse2 = ok(as(U.SR, () => app.apiPulse()), 'ตรวจความเปลี่ยนแปลงรอบสอง');
ck(pulse1 && pulse2 && pulse1.sig !== pulse2.sig,
   'ข้อมูลเปลี่ยนแล้วแต่ลายเซ็นสถานะไม่เปลี่ยน — หน้าจอจะไม่รู้ว่าต้องโหลดใหม่');
step.push('ลายเซ็นสถานะเปลี่ยนเมื่อข้อมูลเปลี่ยน — หน้าจอรู้ได้ว่าต้องรีเฟรช');

/* ---------- สรุป ---------- */
console.log('เดินเส้นทางจริงตั้งแต่ติดตั้งจนใช้งาน');
step.forEach((s, i) => console.log('  ' + (i + 1) + '. ' + s));
if (bad.length) {
  console.log('\nพบปัญหา ' + bad.length + ':');
  bad.forEach(b => console.log('  - ' + b));
  process.exit(1);
}
console.log('\nผ่านทั้งหมด — ระบบเดินได้ตั้งแต่ชีตว่างจนจ่ายเงิน');

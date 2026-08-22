/**
 * ตัวจำลองบริการของ Google สำหรับรันโค้ด .gs นอก Apps Script
 * ============================================================================
 * ใช้ร่วมกัน 2 ที่
 *   · tools/traceability-test.js            — ชุดทดสอบใน node
 *   · presentation/traceability-prototype.html — ตัวอย่างระบบที่รันในเบราว์เซอร์
 *
 * ทำไมต้องใช้ตัวเดียวกัน: ตัวอย่างระบบที่ใช้ในที่ประชุมจะได้รันโค้ดหลังบ้าน "ตัวจริง"
 * กฎตรวจสอบทุกข้อจึงทำงานเหมือนของจริง ไม่ใช่หน้าจอปลอมที่กดแล้วผ่านทุกอย่าง
 *
 * ใช้ได้ทั้งใน node (require) และในเบราว์เซอร์ (แปะเป็น <script> แล้วเรียก createGasMocks())
 */
(function (root) {
  'use strict';

function makeSheet(name) {
  const S = { name, data: [], frozen: 0 };

  function ensure(rows, cols) {
    while (S.data.length < rows) S.data.push([]);
    for (const r of S.data) while (r.length < cols) r.push('');
  }
  function lastRow() {
    let last = 0;
    S.data.forEach((row, i) => {
      if (row.some(v => v !== '' && v !== null && v !== undefined)) last = i + 1;
    });
    return last;
  }
  function lastCol() {
    let last = 0;
    S.data.forEach(row => row.forEach((v, c) => {
      if (v !== '' && v !== null && v !== undefined) last = Math.max(last, c + 1);
    }));
    return last;
  }

  const api = {
    getName: () => name,
    getSheetId: () => name.length,
    setFrozenRows: n => { S.frozen = n; return api; },
    getLastRow: lastRow,
    getLastColumn: lastCol,
    getMaxRows: () => Math.max(S.data.length, 200),
    getMaxColumns: () => Math.max(lastCol(), 40),
    deleteColumns: (start, howMany) => {
      S.data.forEach(r => r.splice(start - 1, howMany));
      return api;
    },
    appendRow: values => {
      ensure(lastRow() + 1, values.length);
      S.data[lastRow()] = values.slice();
      return api;
    },
    getDataRange: () => api.getRange(1, 1, Math.max(lastRow(), 1), Math.max(lastCol(), 1)),
    getRange: (row, col, numRows, numCols) => {
      numRows = numRows || 1; numCols = numCols || 1;
      const rg = {
        getValues: () => {
          ensure(row + numRows - 1, col + numCols - 1);
          const out = [];
          for (let r = 0; r < numRows; r++) {
            out.push(S.data[row - 1 + r].slice(col - 1, col - 1 + numCols));
          }
          return out;
        },
        getDisplayValues: () => rg.getValues().map(r => r.map(v => {
          if (v === null || v === undefined) return '';
          if (v instanceof Date) return isoStamp(v);
          return String(v);
        })),
        setValues: vals => {
          ensure(row + vals.length - 1, col + (vals[0] ? vals[0].length : 0) - 1);
          vals.forEach((rowVals, r) => {
            rowVals.forEach((v, c) => { S.data[row - 1 + r][col - 1 + c] = v; });
          });
          return rg;
        },
        clearContent: () => {
          ensure(row + numRows - 1, col + numCols - 1);
          for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numCols; c++) S.data[row - 1 + r][col - 1 + c] = '';
          }
          return rg;
        },
        setFontWeight: () => rg,
        setBackground: () => rg
      };
      return rg;
    },
    _raw: S
  };
  return api;
}

function makeSpreadsheet(id, name) {
  const sheets = [];
  const ss = {
    getId: () => id,
    getName: () => name,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    getSheets: () => sheets.slice(),
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
    deleteSheet: s => { const i = sheets.indexOf(s); if (i >= 0) sheets.splice(i, 1); },
    setSpreadsheetTimeZone: () => ss
  };
  return ss;
}

function pad(n, w) { return ('000000' + n).slice(-w); }
function isoStamp(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) + ' ' +
         pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
}

function buildSandbox(store, state) {
  var sandbox = {
  console: {
    log: () => {}, error: () => {}, warn: () => {},
    _real: (typeof console !== 'undefined' ? console : null)
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (store.props[k] === undefined ? null : store.props[k]),
      setProperty: (k, v) => { store.props[k] = String(v); },
      deleteProperty: k => { delete store.props[k]; }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: k => (store.cache[k] === undefined ? null : store.cache[k]),
      put: (k, v) => { store.cache[k] = v; },
      remove: k => { delete store.cache[k]; },
      removeAll: ks => ks.forEach(k => delete store.cache[k])
    })
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {}, hasLock: () => true })
  },
  Session: {
    getActiveUser: () => ({ getEmail: () => state.user }),
    getEffectiveUser: () => ({ getEmail: () => state.user })
  },
  SpreadsheetApp: {
    openById: () => store.ss,
    create: name => { store.ss = makeSpreadsheet('TEST_SS_ID', name); return store.ss; },
    flush: () => {}
  },
  DriveApp: {
    Access: { DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
    getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
    createFolder: n => makeFolder(n),
    getFolderById: id => makeFolder(id),
    getFileById: () => ({ makeCopy: () => ({ getId: () => 'copy', getUrl: () => 'u' }) })
  },
  UrlFetchApp: {
    fetch: (url, opts) => {
      store.larkLog.push({ url, payload: opts && opts.payload });
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ code: 0, tenant_access_token: 'tok' })
      };
    }
  },
  Utilities: {
    getUuid: () => 'uuid-' + (++state.uuidSeq).toString().padStart(6, '0'),
    formatDate: (d, tz, fmt) => {
      const D = new Date(d);
      return fmt
        .replace(/yyyy/g, D.getFullYear())
        .replace(/MM/g, pad(D.getMonth() + 1, 2))
        .replace(/dd/g, pad(D.getDate(), 2))
        .replace(/HH/g, pad(D.getHours(), 2))
        .replace(/mm/g, pad(D.getMinutes(), 2))
        .replace(/ss/g, pad(D.getSeconds(), 2));
    },
    computeHmacSha256Signature: () => [1, 2, 3],
    newBlob: () => ({}),
    base64Decode: () => []
  },
  ScriptApp: {
    getProjectTriggers: () => [],
    deleteTrigger: () => {},
    WeekDay: { SUNDAY: 'SUNDAY' },
    newTrigger: () => {
      const b = {
        timeBased: () => b, everyHours: () => b, everyDays: () => b, atHour: () => b,
        onMonthDay: () => b, onWeekDay: () => b, inTimezone: () => b, create: () => {}
      };
      return b;
    }
  },
  HtmlService: {
    createTemplateFromFile: () => ({ evaluate: () => ({}) }),
    XFrameOptionsMode: { ALLOWALL: 1 }
  },
  ContentService: {
    createTextOutput: t => ({ setMimeType: () => t }),
    MimeType: { JSON: 'JSON' }
  }
};
  return sandbox;
}

function makeFolder(name) {
  return {
    getId: () => 'folder-' + name,
    getUrl: () => 'https://drive.google.com/folder-' + name,
    getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
    createFolder: n => makeFolder(n),
    createFile: () => ({ getId: () => 'file-1', setSharing: () => {} }),
    getFiles: () => ({ hasNext: () => false, next: () => null })
  };
}
  function createGasMocks(options) {
    options = options || {};
    var store = { props: {}, cache: {}, ss: null, larkLog: [] };
    var state = { user: options.user || 'admin@mgs.co.th', uuidSeq: 0 };
    var sandbox = buildSandbox(store, state);
    return {
      sandbox: sandbox,
      store: store,
      setUser: function (email) { state.user = email; },
      getUser: function () { return state.user; }
    };
  }

  root.createGasMocks = createGasMocks;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createGasMocks: createGasMocks };

})(typeof globalThis !== 'undefined' ? globalThis : this);

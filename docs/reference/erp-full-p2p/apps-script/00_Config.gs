/**
 * 00_Config.gs — configuration, constants, small utilities, error type.
 *
 * Nothing environment-specific is hard-coded. Script Properties hold IDs and secrets:
 *   SPREADSHEET_ID, SPREADSHEET_ID_QC, SPREADSHEET_ID_LOG, DRIVE_ROOT_ID,
 *   TPL_PO_DOC_ID, TPL_QC_DOC_ID, TPL_NCR_DOC_ID, TPL_REMITTANCE_DOC_ID,
 *   HMAC_SECRET, ADMIN_EMAIL, CHAT_WEBHOOK_URL, ENV
 */

const TZ = 'Asia/Bangkok';

/** Business error: expected, user-facing, not an incident. */
class AppError extends Error {
  constructor(code, message, requestId) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.requestId = requestId || null;
  }
}

const Props = {
  get(key, fallback) {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    return v === null || v === '' ? fallback : v;
  },
  set(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
  },
  require(key) {
    const v = this.get(key);
    if (!v) throw new AppError('CONFIG_MISSING', 'Missing script property: ' + key);
    return v;
  }
};

/** Config tab accessor, cached for 6h (invalidated by Config writes). */
const Config = {
  _cacheKey: 'CONFIG_MAP_V1',

  all() {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(this._cacheKey);
    if (hit) return JSON.parse(hit);
    const map = {};
    Repo.readAll(SHEETS.CONFIG).forEach(r => { map[r.config_key] = r.config_value; });
    cache.put(this._cacheKey, JSON.stringify(map), 21600);
    return map;
  },

  get(key, fallback) {
    const v = this.all()[key];
    return v === undefined || v === '' ? fallback : v;
  },

  num(key, fallback) {
    const v = Number(this.get(key, fallback));
    return isNaN(v) ? Number(fallback) : v;
  },

  bool(key, fallback) {
    const v = String(this.get(key, fallback)).toUpperCase();
    return v === 'TRUE' || v === 'YES' || v === '1';
  },

  invalidate() { CacheService.getScriptCache().remove(this._cacheKey); }
};

/* --------------------------------------------------------- status constants */

const PO_STATUS = {
  DRAFT: 'DRAFT', PENDING_APPROVAL: 'PENDING_APPROVAL', APPROVED: 'APPROVED',
  REJECTED: 'REJECTED', SENT_TO_VENDOR: 'SENT_TO_VENDOR', ACKNOWLEDGED: 'ACKNOWLEDGED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED', FULLY_RECEIVED: 'FULLY_RECEIVED',
  SHORT_CLOSED: 'SHORT_CLOSED', INVOICED: 'INVOICED', ON_HOLD: 'ON_HOLD',
  CLOSED: 'CLOSED', CANCELLED: 'CANCELLED'
};

const GRN_STATUS = {
  DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', PENDING_QC: 'PENDING_QC',
  QC_IN_PROGRESS: 'QC_IN_PROGRESS', QC_PENDING_LAB: 'QC_PENDING_LAB',
  QC_PASSED: 'QC_PASSED', QC_CONDITIONAL: 'QC_CONDITIONAL', QC_FAILED: 'QC_FAILED',
  QUARANTINE: 'QUARANTINE', PARTIALLY_POSTED: 'PARTIALLY_POSTED', POSTED: 'POSTED',
  RETURN_TO_VENDOR: 'RETURN_TO_VENDOR', CLOSED_RTV: 'CLOSED_RTV', SCRAPPED: 'SCRAPPED',
  REVERSED: 'REVERSED', CANCELLED: 'CANCELLED'
};

const QC_STATUS = {
  PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', SAMPLING: 'SAMPLING', TESTING: 'TESTING',
  PENDING_LAB: 'PENDING_LAB', PENDING_APPROVAL: 'PENDING_APPROVAL',
  COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED'
};

const QC_RESULT = { PENDING: 'PENDING', PASS: 'PASS', FAIL: 'FAIL', CONDITIONAL: 'CONDITIONAL' };

const MATCH_STATUS = {
  RECEIVED: 'RECEIVED', MATCHING: 'MATCHING', MATCHED: 'MATCHED', EXCEPTION: 'EXCEPTION',
  NO_GRN: 'NO_GRN', QC_HOLD: 'QC_HOLD', DISPUTED: 'DISPUTED',
  CREDIT_NOTE_PENDING: 'CREDIT_NOTE_PENDING', APPROVED_FOR_PAYMENT: 'APPROVED_FOR_PAYMENT',
  SCHEDULED: 'SCHEDULED', PAID: 'PAID', REJECTED: 'REJECTED'
};

const EXCEPTION = {
  PRICE_OVER: 'PRICE_OVER', PRICE_UNDER: 'PRICE_UNDER', QTY_OVER: 'QTY_OVER',
  QTY_NO_RECEIPT: 'QTY_NO_RECEIPT', QC_REJECTED: 'QC_REJECTED', DUP_INVOICE: 'DUP_INVOICE',
  TAX_MISMATCH: 'TAX_MISMATCH', FX_MISMATCH: 'FX_MISMATCH', UOM_MISMATCH: 'UOM_MISMATCH',
  PO_CLOSED: 'PO_CLOSED', NO_PO: 'NO_PO', DEPOSIT_UNAPPLIED: 'DEPOSIT_UNAPPLIED'
};

/** Which role owns each exception code (doc 01 §4). */
const EXCEPTION_OWNER = {
  PRICE_OVER: 'BUYER', PRICE_UNDER: 'BUYER', QTY_OVER: 'WH_SUP',
  QTY_NO_RECEIPT: 'BUYER', QC_REJECTED: 'QC_MGR', DUP_INVOICE: 'AP_OFFICER',
  TAX_MISMATCH: 'AP_OFFICER', FX_MISMATCH: 'AP_OFFICER', UOM_MISMATCH: 'AP_OFFICER',
  PO_CLOSED: 'BUYER', NO_PO: 'AP_OFFICER', DEPOSIT_UNAPPLIED: 'AP_OFFICER'
};

const ROLES = {
  REQUESTER: 'REQUESTER', BUYER: 'BUYER', PUR_MGR: 'PUR_MGR', WH_OFFICER: 'WH_OFFICER',
  WH_SUP: 'WH_SUP', QC_INSPECTOR: 'QC_INSPECTOR', QC_MGR: 'QC_MGR',
  AP_OFFICER: 'AP_OFFICER', FIN_MGR: 'FIN_MGR', MGMT_VIEW: 'MGMT_VIEW', SYS_ADMIN: 'SYS_ADMIN'
};

/* ---------------------------------------------------------------- utilities */

const Fmt = {
  /** ISO 8601 with offset, stored as text — see docs/02 §1. */
  now() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); },
  today() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); },
  stamp() { return Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); },
  date(v) { return v ? String(v).slice(0, 10) : ''; },
  dateTime(v) { return v ? String(v).replace('T', ' ').slice(0, 16) : ''; },
  money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  qty(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 }); },
  addHours(iso, hrs) {
    const d = iso ? new Date(iso) : new Date();
    return Utilities.formatDate(new Date(d.getTime() + hrs * 3600000), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
  },
  addDays(iso, days) { return this.addHours(iso, days * 24); },
  hoursBetween(fromIso, toIso) {
    if (!fromIso || !toIso) return '';
    return Math.round(((new Date(toIso) - new Date(fromIso)) / 3600000) * 100) / 100;
  },
  fiscalYY() { return Utilities.formatDate(new Date(), TZ, 'yy'); }
};

const Num = {
  n(v) { const x = Number(v); return isNaN(x) ? 0 : x; },
  round(v, dp) { const f = Math.pow(10, dp === undefined ? 2 : dp); return Math.round(this.n(v) * f) / f; }
};

const Json = {
  /** Serialise for logs, redacting anything we must never write to a log tab. */
  safe(obj, maxLen) {
    const REDACT = ['bank_account_no', 'bank_swift', 'tax_id', 'HMAC_SECRET', 'token', 'password'];
    let out;
    try {
      out = JSON.stringify(obj, (k, v) => (REDACT.indexOf(k) >= 0 ? '***REDACTED***' : v));
    } catch (e) {
      out = String(obj);
    }
    return maxLen && out.length > maxLen ? out.slice(0, maxLen) + '…' : out;
  }
};

/** Guard against CSV/formula injection when user text lands in a cell. */
function sanitizeCell_(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function escapeRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Script-lock wrapper. Read-modify-write must happen inside this.
 *
 * Reentrant on purpose: workflow functions take the lock and then call StateMachine.fire(),
 * which takes it again. LockService does not promise reentrancy, so we count depth ourselves
 * and only touch the real lock at the outermost call.
 */
var __lockDepth = 0;

function withLock_(fn, timeoutMs) {
  if (__lockDepth > 0) {
    __lockDepth++;
    try { return fn(); } finally { __lockDepth--; }
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 30000)) {
    throw new AppError('SYSTEM_BUSY', 'The system is busy saving another record. Please retry in a moment.');
  }
  __lockDepth = 1;
  try {
    const out = fn();
    SpreadsheetApp.flush();
    return out;
  } finally {
    __lockDepth = 0;
    lock.releaseLock();
  }
}

/** Uniform error boundary: log, alert if unexpected, rethrow as AppError. */
function safely_(name, fn, ctx) {
  const requestId = Utilities.getUuid();
  try {
    return fn();
  } catch (err) {
    const expected = err instanceof AppError;
    try {
      ErrorLog.write({
        severity: expected ? 'WARN' : 'ERROR',
        function_name: name,
        error_message: String(err && err.message || err),
        stack: String(err && err.stack || '').slice(0, 4000),
        entity_type: ctx && ctx.entityType,
        entity_no: ctx && ctx.entityNo,
        actor_email: Auth.currentEmail(),
        payload_json: Json.safe(ctx, 4000),
        request_id: requestId
      });
      if (!expected) Notify.alertAdmin(name, err, requestId);
    } catch (logErr) {
      Logger.log('logging failed: ' + logErr);
    }
    if (expected) { err.requestId = requestId; throw err; }
    throw new AppError('INTERNAL', 'Something went wrong. Quote reference ' + requestId + ' to IT.', requestId);
  }
}

const ErrorLog = {
  write(rec) {
    Repo.insert(SHEETS.ERROR_LOG, Object.assign({
      err_id: Utilities.getUuid(), at_ts: Fmt.now(), resolved: 'FALSE'
    }, rec));
  }
};

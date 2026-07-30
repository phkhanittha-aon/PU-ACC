/**
 * 01_Repo.gs — the only file that knows the data lives in Google Sheets.
 *
 * Everything above this layer deals in plain record objects. That is deliberate: when
 * volume outgrows Sheets, this file is replaced with a Cloud SQL / BigQuery
 * implementation and nothing else changes (Appendix B §5).
 *
 * Performance contract:
 *   - one getValues() per tab per execution (memoised per invocation)
 *   - one setValues() per write batch
 *   - never getRange().getValue() in a loop
 */

const Repo = (function () {

  const _sheetCache = {};   // tab -> Sheet
  const _dataCache = {};    // tab -> {headers, values}

  function spreadsheetFor_(tab) {
    const overflowProp = OVERFLOW_TABS[tab];
    const id = overflowProp ? Props.get(overflowProp, Props.require('SPREADSHEET_ID'))
                            : Props.require('SPREADSHEET_ID');
    return SpreadsheetApp.openById(id);
  }

  function sheet_(tab) {
    if (_sheetCache[tab]) return _sheetCache[tab];
    const sh = spreadsheetFor_(tab).getSheetByName(tab);
    if (!sh) throw new AppError('SCHEMA_MISSING', 'Missing tab: ' + tab + '. Run setupWorkspace().');
    _sheetCache[tab] = sh;
    return sh;
  }

  function load_(tab) {
    if (_dataCache[tab]) return _dataCache[tab];
    const sh = sheet_(tab);
    const lastRow = sh.getLastRow();
    const headers = schemaCols(tab);
    const values = lastRow < 2 ? []
      : sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    _dataCache[tab] = { headers: headers, values: values };
    return _dataCache[tab];
  }

  function toObject_(headers, row, rowNumber) {
    const o = {};
    for (let i = 0; i < headers.length; i++) o[headers[i]] = row[i];
    o.__row = rowNumber;          // physical sheet row, for targeted updates
    return o;
  }

  function toRow_(headers, obj, existing) {
    return headers.map((h, i) => {
      if (Object.prototype.hasOwnProperty.call(obj, h)) return sanitizeCell_(obj[h]);
      return existing ? existing[i] : '';
    });
  }

  /** Invalidate the in-memory cache for a tab after a write. */
  function dirty_(tab) { delete _dataCache[tab]; }

  return {

    /** All rows as objects. Use sparingly on large tabs — prefer findAll/index. */
    readAll(tab) {
      const d = load_(tab);
      return d.values.map((r, i) => toObject_(d.headers, r, i + 2));
    },

    /** First row where field === value, or null. */
    findOne(tab, field, value) {
      const d = load_(tab);
      const col = d.headers.indexOf(field);
      if (col < 0) throw new AppError('SCHEMA_FIELD', field + ' not in ' + tab);
      for (let i = 0; i < d.values.length; i++) {
        if (String(d.values[i][col]) === String(value)) return toObject_(d.headers, d.values[i], i + 2);
      }
      return null;
    },

    findById(tab, id) {
      const pk = SCHEMA[tab].pk;
      if (!pk) throw new AppError('SCHEMA_PK', tab + ' has no primary key');
      return this.findOne(tab, pk, id);
    },

    /** All rows where field === value. */
    findAll(tab, field, value) {
      const d = load_(tab);
      const col = d.headers.indexOf(field);
      if (col < 0) throw new AppError('SCHEMA_FIELD', field + ' not in ' + tab);
      const out = [];
      for (let i = 0; i < d.values.length; i++) {
        if (String(d.values[i][col]) === String(value)) out.push(toObject_(d.headers, d.values[i], i + 2));
      }
      return out;
    },

    /** Rows matching a predicate over record objects. */
    where(tab, predicate) {
      return this.readAll(tab).filter(predicate);
    },

    /** Map of key -> record, built in one pass. Use for roll-ups. */
    indexBy(tab, field) {
      const map = {};
      this.readAll(tab).forEach(r => { map[String(r[field])] = r; });
      return map;
    },

    /** Multi-map of key -> [records]. */
    groupBy(tab, field) {
      const map = {};
      this.readAll(tab).forEach(r => {
        const k = String(r[field]);
        (map[k] = map[k] || []).push(r);
      });
      return map;
    },

    /**
     * Insert one record. Fills PK, audit columns and row_version.
     * Enforces the uniqueness constraints declared in SCHEMA.
     */
    insert(tab, rec) {
      const def = SCHEMA[tab];
      const headers = schemaCols(tab);
      const now = Fmt.now();
      const actor = Auth.currentEmail();
      const row = Object.assign({}, rec);

      if (def.pk && !row[def.pk]) row[def.pk] = Utilities.getUuid();
      if (headers.indexOf('created_at') >= 0 && !row.created_at) row.created_at = now;
      if (headers.indexOf('created_by') >= 0 && !row.created_by) row.created_by = actor;
      if (headers.indexOf('updated_at') >= 0) row.updated_at = now;
      if (headers.indexOf('updated_by') >= 0) row.updated_by = actor;
      if (headers.indexOf('row_version') >= 0) row.row_version = 1;

      // Append-only log tabs are keyed by freshly generated UUIDs, so the scan is pure cost —
      // and these are the largest tabs in the file.
      if (!def.appendOnly) {
        (def.unique || []).forEach(f => {
          if (row[f] === undefined || row[f] === '') return;
          if (this.findOne(tab, f, row[f])) {
            throw new AppError('DUPLICATE', 'A ' + tab + ' record with ' + f + ' = ' + row[f] + ' already exists.');
          }
        });
      }

      const sh = sheet_(tab);
      sh.appendRow(toRow_(headers, row, null));
      dirty_(tab);
      return row;
    },

    /** Insert many records in one setValues() call. */
    insertMany(tab, recs) {
      if (!recs || !recs.length) return [];
      const def = SCHEMA[tab];
      const headers = schemaCols(tab);
      const now = Fmt.now();
      const actor = Auth.currentEmail();
      const prepared = recs.map(r => {
        const row = Object.assign({}, r);
        if (def.pk && !row[def.pk]) row[def.pk] = Utilities.getUuid();
        if (headers.indexOf('created_at') >= 0 && !row.created_at) row.created_at = now;
        if (headers.indexOf('created_by') >= 0 && !row.created_by) row.created_by = actor;
        if (headers.indexOf('updated_at') >= 0) row.updated_at = now;
        if (headers.indexOf('row_version') >= 0) row.row_version = 1;
        return row;
      });
      const sh = sheet_(tab);
      const start = sh.getLastRow() + 1;
      sh.getRange(start, 1, prepared.length, headers.length)
        .setValues(prepared.map(r => toRow_(headers, r, null)));
      dirty_(tab);
      return prepared;
    },

    /**
     * Patch a record by primary key.
     * @param {number} expectedVersion optional — optimistic lock; throws STALE if mismatched.
     */
    update(tab, id, patch, expectedVersion) {
      const def = SCHEMA[tab];
      if (def.appendOnly) throw new AppError('APPEND_ONLY', tab + ' is append-only and cannot be updated.');
      const current = this.findById(tab, id);
      if (!current) throw new AppError('NOT_FOUND', 'No ' + tab + ' with ' + def.pk + ' = ' + id);

      if (expectedVersion !== undefined && expectedVersion !== null &&
          Number(current.row_version) !== Number(expectedVersion)) {
        throw new AppError('STALE',
          'This record was changed by ' + (current.updated_by || 'someone else') +
          ' while you were editing. Reload and reapply your change.');
      }

      const headers = schemaCols(tab);
      const merged = Object.assign({}, current, patch);
      if (headers.indexOf('updated_at') >= 0) merged.updated_at = Fmt.now();
      if (headers.indexOf('updated_by') >= 0) merged.updated_by = Auth.currentEmail();
      if (headers.indexOf('row_version') >= 0) merged.row_version = Num.n(current.row_version) + 1;

      sheet_(tab).getRange(current.__row, 1, 1, headers.length)
        .setValues([toRow_(headers, merged, null)]);
      dirty_(tab);
      return merged;
    },

    /** Patch many records by PK in one write per contiguous row. */
    updateMany(tab, patches) {
      return patches.map(p => this.update(tab, p.id, p.patch));
    },

    /**
     * Next document number, e.g. nextDocNo('PO') -> 'PO-26-0042'.
     * MUST be called inside withLock_ — the caller owns the lock so that numbering
     * and the record insert are atomic together.
     */
    nextDocNo(counterKey) {
      const row = this.findOne(SHEETS.COUNTERS, 'counter_key', counterKey);
      if (!row) throw new AppError('COUNTER_MISSING', 'No counter configured for ' + counterKey);
      const yy = Fmt.fiscalYY();
      const reset = String(row.year) !== String(yy);
      const next = reset ? 1 : Num.n(row.last_number) + 1;
      const padding = Num.n(row.padding) || 4;
      this.update(SHEETS.COUNTERS, counterKey,
        { year: yy, last_number: next, updated_at: Fmt.now() });
      return row.prefix + '-' + yy + '-' + Utilities.formatString('%0' + padding + 'd', next);
    },

    /** Cached master-data lookup: vendors, items, lookups. */
    cachedIndex(tab, field) {
      const key = 'IDX_' + tab + '_' + field;
      const cache = CacheService.getScriptCache();
      const hit = cache.get(key);
      if (hit) return JSON.parse(hit);
      const idx = this.indexBy(tab, field);
      try { cache.put(key, JSON.stringify(idx), 21600); } catch (e) { /* >100KB: skip cache */ }
      return idx;
    },

    invalidateCache(tab, field) {
      CacheService.getScriptCache().remove('IDX_' + tab + '_' + field);
      dirty_(tab);
    },

    /** Idempotency guard: returns the previous result if this key was already processed. */
    idempotent(key, functionName, fn) {
      if (!key) return fn();
      const existing = this.findOne(SHEETS.IDEMPOTENCY, 'idempotency_key', key);
      if (existing) return JSON.parse(existing.result_json || 'null');
      const result = fn();
      this.insert(SHEETS.IDEMPOTENCY, {
        idempotency_key: key, created_at: Fmt.now(), function_name: functionName,
        result_json: Json.safe(result, 40000), expires_at: Fmt.addDays(Fmt.now(), 30)
      });
      return result;
    }
  };
})();

/** Append-only audit writer. Every mutation goes through here (docs/02 §6.2). */
const History = {
  log(rec) {
    const prev = rec.entity_no ? this._lastFor(rec.entity_type, rec.entity_no) : null;
    const now = Fmt.now();
    Repo.insert(SHEETS.HISTORY, {
      log_id: Utilities.getUuid(),
      at_ts: now,
      entity_type: rec.entity_type,
      entity_no: rec.entity_no,
      entity_id: rec.entity_id || '',
      action: rec.action,
      from_status: rec.from_status || '',
      to_status: rec.to_status || '',
      actor_email: rec.actor_email || Auth.currentEmail(),
      // never let an audit write fail because the actor is not in Users yet
      actor_role: rec.actor_role || this._roleOf() || '',
      on_behalf_of: rec.on_behalf_of || '',
      duration_in_prev_status_hrs: prev ? Fmt.hoursBetween(prev.at_ts, now) : '',
      sla_hours: rec.sla_hours || '',
      sla_breached: rec.sla_breached === undefined ? '' : String(rec.sla_breached).toUpperCase(),
      reason: rec.reason || '',
      changed_fields: (rec.changed_fields || []).join(','),
      payload_json: Json.safe(rec.payload, 4000),
      source: rec.source || 'WEB',
      request_id: rec.request_id || ''
    });
  },

  _roleOf() {
    try { return Auth.currentUser().role_codes; } catch (e) { return ''; }
  },

  _lastFor(entityType, entityNo) {
    const rows = Repo.findAll(SHEETS.HISTORY, 'entity_no', entityNo)
      .filter(r => r.entity_type === entityType);
    return rows.length ? rows[rows.length - 1] : null;
  },

  timeline(entityType, entityNo) {
    return Repo.findAll(SHEETS.HISTORY, 'entity_no', entityNo)
      .filter(r => r.entity_type === entityType)
      .sort((a, b) => String(a.at_ts).localeCompare(String(b.at_ts)));
  }
};

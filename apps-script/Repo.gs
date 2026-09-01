/**
 * Repo.gs — โครงสร้างตารางและชั้นอ่าน/เขียนชีต
 * ==========================================================================
 * *** ไฟล์นี้เป็นที่เดียวที่รู้ว่าข้อมูลเก็บอยู่ใน Google Sheets ***
 * ไฟล์อื่นเรียกผ่าน Repo เท่านั้น วันที่ย้ายไปฐานข้อมูลจริงจะได้แก้ที่เดียว
 *
 * หลักที่ยึด
 *   - อ่านทีเดียวทั้งช่วง แล้วค่อยคำนวณ · ห้าม getValue() ในลูป (ชนเพดาน 6 นาที)
 *   - หาแถวด้วย "คีย์" เสมอ ห้ามจำเลขแถว — คนเรียงชีตใหม่แล้วเลขแถวเลื่อน
 *   - ทุกการเขียนที่สำคัญบันทึกลง History ค่าเดิม→ค่าใหม่
 */

var SHEETS = {
  USERS:    'Users',
  DEALS:    'Deals',
  STAGES:   'Deal_Stages',
  HANDOFF:  'Handoffs',
  PAYMENTS: 'Payments',
  DOCUMENTS:'Documents',
  CLAIMS:   'Claims',
  NOTIFS:   'Notifications',
  FEEDBACK: 'Feedback',
  HISTORY:  'History',
  CONFIG:   'Config',
  PILOT:    'Pilot_Scope',
  ASSIGN:   'Assignments',
  ERRORS:   'Errors'
};

/* หัวคอลัมน์คือสัญญาของตาราง — เปลี่ยนชื่อคอลัมน์ = เปลี่ยนสัญญา ต้องแก้โค้ดที่อ้างถึงด้วย */
var COLS = {
  Users: ['email', 'full_name', 'dept', 'title', 'lark_user_id', 'manager_email',
          'delegate_email', 'delegate_until', 'is_active', 'note'],
  Deals: ['deal_no', 'entry', 'module', 'b1_po_no', 'supplier', 'item', 'qty', 'uom',
          'amount', 'currency', 'payment_term', 'term_name', 'due_date', 'stage',
          'status', 'owner_email', 'qc_bypass', 'qc_bypass_why', 'qc_bypass_by',
          'cash_why', 'created_at', 'created_by', 'updated_at', 'fingerprint'],
  Deal_Stages: ['deal_no', 'seq', 'stage_code', 'owner_dept', 'entered_at', 'done_at',
                'done_by', 'hours_used', 'sla_hours', 'sla_breached', 'note'],
  Handoffs: ['deal_no', 'stage_code', 'payload_json', 'saved_at', 'saved_by'],
  Payments: ['deal_no', 'seq', 'type', 'pct', 'amount', 'due', 'status', 'is_lc',
             'req_no', 'req_by', 'req_at', 'chk_by', 'chk_at',
             'rej_by', 'rej_at', 'rej_note', 'rej_count',
             'apv_by', 'apv_at', 'paid_by', 'paid_at',
             'method', 'bank', 'ref', 'bill_kind', 'bill_no', 'bill_amt',
             'wht_type', 'wht', 'fee', 'fee_by', 'paid_amt', 'slip_file_id', 'note'],
  Documents: ['doc_id', 'deal_no', 'doc_code', 'doc_name', 'file_id', 'file_name',
              'version', 'uploaded_at', 'uploaded_by'],
  Claims: ['claim_id', 'deal_no', 'opened_at', 'opened_by', 'reason', 'qty_bad',
           'credit_note', 'status', 'closed_at', 'closed_by'],
  Notifications: ['notif_id', 'created_at', 'to_email', 'channel', 'title', 'body',
                  'deal_no', 'level', 'sent_at', 'send_status', 'error'],
  Feedback: ['fb_id', 'created_at', 'who', 'dept', 'severity', 'page', 'deal_no',
             'message', 'status', 'answered_at', 'answered_by', 'answer'],
  History: ['ts', 'actor', 'action', 'entity', 'entity_id', 'before_json', 'after_json'],
  Config: ['config_key', 'config_value', 'note'],
  Pilot_Scope: ['deal_no', 'added_at', 'added_by', 'note'],
  Assignments: ['group_code', 'group_name', 'sr_email', 'note'],
  Errors: ['ts', 'who', 'where', 'message']
};

var Repo = (function () {
  var _ss = null;
  function ss_() {
    if (!_ss) _ss = SpreadsheetApp.openById(Props.require('SPREADSHEET_ID'));
    return _ss;
  }
  function sheet_(name) {
    var sh = ss_().getSheetByName(name);
    if (!sh) throw AppError('NO_SHEET', 'ไม่พบแท็บ "' + name + '" — ให้ IT กดเมนู ติดตั้งระบบ อีกครั้ง');
    return sh;
  }
  function headers_(sh) {
    var last = sh.getLastColumn();
    if (last < 1) return [];
    return sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h).trim(); });
  }

  return {
    sheet: sheet_,

    /** อ่านทั้งตารางเป็น array ของ object — อ่านครั้งเดียว */
    readAll: function (name) {
      var sh = sheet_(name);
      var rows = sh.getLastRow() - 1;
      if (rows < 1) return [];
      var hd = headers_(sh);
      var vals = sh.getRange(2, 1, rows, hd.length).getValues();
      return vals.map(function (r, i) {
        var o = {_row: i + 2};
        hd.forEach(function (h, c) { o[h] = r[c]; });
        return o;
      }).filter(function (o) {
        // แถวว่างล้วนไม่ใช่ข้อมูล — ไฟล์ที่คนลบเนื้อหาแต่ไม่ลบแถวมีเยอะ
        return Object.keys(o).some(function (k) {
          return k !== '_row' && String(o[k]).trim() !== '';
        });
      });
    },

    /** หาแถวเดียวด้วยคีย์ */
    findBy: function (name, key, value) {
      var want = String(value).trim();
      var hit = this.readAll(name).filter(function (r) {
        return String(r[key]).trim() === want;
      });
      return hit.length ? hit[0] : null;
    },

    where: function (name, fn) { return this.readAll(name).filter(fn); },

    /** เพิ่มแถวเดียว */
    insert: function (name, obj) {
      var sh = sheet_(name);
      var hd = headers_(sh);
      var row = hd.map(function (h) { return sanitizeCell_(obj[h] === undefined ? '' : obj[h]); });
      sh.appendRow(row);
      return obj;
    },

    /** เพิ่มหลายแถวในครั้งเดียว — เร็วกว่า appendRow ทีละแถวหลายสิบเท่า */
    insertMany: function (name, list) {
      if (!list || !list.length) return 0;
      var sh = sheet_(name);
      var hd = headers_(sh);
      var rows = list.map(function (obj) {
        return hd.map(function (h) { return sanitizeCell_(obj[h] === undefined ? '' : obj[h]); });
      });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, hd.length).setValues(rows);
      return rows.length;
    },

    /** แก้แถวที่หาด้วยคีย์ — คืน object หลังแก้ · ไม่เจอคีย์ถือเป็นข้อผิดพลาด */
    update: function (name, key, value, patch) {
      var sh = sheet_(name);
      var hd = headers_(sh);
      var cur = this.findBy(name, key, value);
      if (!cur) throw AppError('NOT_FOUND', 'ไม่พบข้อมูล ' + key + ' = ' + value + ' ใน ' + name);
      var after = {};
      hd.forEach(function (h) {
        after[h] = patch[h] !== undefined ? patch[h] : cur[h];
      });
      sh.getRange(cur._row, 1, 1, hd.length).setValues([
        hd.map(function (h) { return sanitizeCell_(after[h] === undefined ? '' : after[h]); })
      ]);
      after._row = cur._row;
      return {before: cur, after: after};
    },

    /** แก้แถวที่หาด้วยสองคีย์ (เช่น deal_no + seq) */
    updateBy2: function (name, k1, v1, k2, v2, patch) {
      var sh = sheet_(name);
      var hd = headers_(sh);
      var hit = this.readAll(name).filter(function (r) {
        return String(r[k1]).trim() === String(v1).trim() &&
               String(r[k2]).trim() === String(v2).trim();
      });
      if (!hit.length)
        throw AppError('NOT_FOUND', 'ไม่พบข้อมูล ' + v1 + '/' + v2 + ' ใน ' + name);
      var cur = hit[0], after = {};
      hd.forEach(function (h) { after[h] = patch[h] !== undefined ? patch[h] : cur[h]; });
      sh.getRange(cur._row, 1, 1, hd.length).setValues([
        hd.map(function (h) { return sanitizeCell_(after[h] === undefined ? '' : after[h]); })
      ]);
      return {before: cur, after: after};
    },

    /** เลขที่เอกสารถัดไป — ต้องเรียกในล็อกเสมอ ไม่งั้นสองคนได้เลขเดียวกัน */
    nextNo: function (prefix, name, col) {
      var yr = Utilities.formatDate(new Date(), TZ, 'yy');
      var head = prefix + '-' + yr + '-';
      var max = 0;
      this.readAll(name).forEach(function (r) {
        var m = String(r[col] || '').match(new RegExp('^' + head + '(\\d+)$'));
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      return head + ('000' + (max + 1)).slice(-4);
    }
  };
})();

/* บันทึกประวัติ — เพิ่มอย่างเดียว ห้ามแก้ ห้ามลบ
   ระบบที่แก้ข้อมูลได้โดยไม่มีร่องรอย คือระบบที่ผู้ตรวจสอบบัญชีไม่รับ */
var History = {
  log: function (actor, action, entity, entityId, before, after) {
    try {
      Repo.insert(SHEETS.HISTORY, {
        ts: new Date(), actor: actor || '(ระบบ)', action: action,
        entity: entity, entity_id: entityId,
        before_json: before ? Json.stringify(before).slice(0, 4000) : '',
        after_json:  after  ? Json.stringify(after).slice(0, 4000)  : ''
      });
    } catch (e) {
      // จดประวัติไม่ได้ต้องไม่ทำให้งานหลักล้ม แต่ต้องดังพอให้รู้
      try { Logger.log('History failed: ' + e); } catch (e2) {}
    }
  }
};

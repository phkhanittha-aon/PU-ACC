/**
 * MGS Traceability & Recall — 06_Notify.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * แจ้งเตือนผ่าน Lark
 *
 * กฎเหล็ก: การแจ้งเตือนล้มเหลว ต้องไม่ทำให้การบันทึกข้อมูลล้มเหลวตาม
 * บันทึกรายการก่อน แล้วค่อยแจ้ง — ถ้าแจ้งไม่ได้ให้บันทึกไว้ ไม่ใช่โยน error
 *
 * Lark คืน HTTP 200 พร้อม code != 0 เวลาผิดพลาด ถ้าไม่เช็ค body จะเห็นเป็นสำเร็จหมด
 */

function larkEnabled_() {
  if (!CFG.LARK.ENABLED) return false;
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('LARK_WEBHOOK') || (p.getProperty('LARK_APP_ID') && p.getProperty('LARK_APP_SECRET')));
}

/** ข้อความธรรมดา — ใช้ webhook ถ้ามี ไม่งั้นใช้ Bot API */
function notifyLarkText_(text) {
  try {
    if (!larkEnabled_()) { console.log('[lark disabled] ' + text); return false; }
    var hook = PropertiesService.getScriptProperties().getProperty('LARK_WEBHOOK');
    if (hook) return larkPost_(hook, { msg_type: 'text', content: { text: String(text) } });
    return larkSendToChat_(String(text));
  } catch (e) {
    console.error('notifyLarkText_ failed', e && e.stack);
    return false;
  }
}

function larkPost_(url, payload) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { code: -1, msg: res.getContentText() }; }
  if (body.code !== 0 && body.StatusCode !== 0) {
    console.error('Lark error', res.getResponseCode(), res.getContentText().slice(0, 500));
    return false;
  }
  return true;
}

function larkToken_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('lark_tat');
  if (hit) return hit;
  var res = UrlFetchApp.fetch(CFG.LARK.HOST + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ app_id: secret_('LARK_APP_ID'), app_secret: secret_('LARK_APP_SECRET') })
  });
  var body = JSON.parse(res.getContentText());
  if (body.code !== 0) throw new Error('Lark auth failed: ' + body.msg);
  cache.put('lark_tat', body.tenant_access_token, 6000);   // token อายุ ~2 ชม. cache 100 นาที
  return body.tenant_access_token;
}

function larkSendToChat_(text, chatId) {
  var target = chatId || PropertiesService.getScriptProperties().getProperty('LARK_CHAT_QC');
  if (!target) { console.log('[no lark chat] ' + text); return false; }
  var res = UrlFetchApp.fetch(CFG.LARK.HOST + '/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + larkToken_() },
    payload: JSON.stringify({
      receive_id: target, msg_type: 'text',
      content: JSON.stringify({ text: String(text) })
    })
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { code: -1 }; }
  if (body.code !== 0) {
    console.error('Lark send failed', res.getContentText().slice(0, 500));
    return false;
  }
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
   ข้อความสำเร็จรูป — เขียนไว้ที่เดียวเพื่อให้ถ้อยคำเหมือนกันทั้งระบบ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * แจ้งเปิดเคส — ข้อความนี้คือสิ่งที่หัวหน้าอ่านบนมือถือตอนตี 2
 * ต้องตอบได้ในหน้าจอเดียวว่า อะไรเสีย กระทบเท่าไหร่ ของอยู่ที่ไหน ใครต้องทำอะไร
 */
function notifyCaseOpened_(caseRow, totals, holds, tracks) {
  var risk = RISK_CLASS[String(caseRow.risk_class)] || {};
  var icon = String(caseRow.risk_class) === 'CRITICAL' ? '🔴'
           : String(caseRow.risk_class) === 'MAJOR' ? '🟠' : '🟡';

  var lines = [
    icon + ' เปิดเคสเรียกคืน ' + caseRow.case_no + ' — ' + (risk.th || caseRow.risk_class),
    '',
    'สินค้า: ' + caseRow.item_code + ' ' + (caseRow.model || ''),
    'ปัญหา: ' + String(caseRow.problem).slice(0, 300),
    'ที่มา: ' + (CASE_SOURCE[String(caseRow.source)] || caseRow.source) +
      (caseRow.source_ref ? ' (' + caseRow.source_ref + ')' : ''),
    '',
    'จำนวนที่กระทบทั้งหมด: ' + totals.affected,
    '  · อยู่ในคลัง: ' + totals.in_stock + ' (กักแล้ว ' + holds + ' รายการ)',
    '  · ส่งลูกค้าไปแล้ว: ' + totals.delivered,
    '  · ยังระบุที่อยู่ไม่ได้: ' + totals.unaccounted,
    '',
    'ปลายทางที่ต้องติดตาม: ' + tracks + ' รายการ',
    'ดำเนินการทันที: ' + caseRow.immediate_action,
    'ผู้รับผิดชอบเคส: ' + caseRow.case_owner
  ];

  if (totals.unaccounted > 0) {
    lines.push('', '⚠️ มีของ ' + totals.unaccounted + ' หน่วยที่ระบบระบุปลายทางไม่ได้ — ต้องตามด้วยมือ');
  }
  if (risk.escalate) {
    lines.push('', '‼️ ระดับความเสี่ยงนี้ต้องแจ้งผู้บริหารภายใน ' + risk.sla_hours + ' ชั่วโมง');
  }

  notifyLarkText_(lines.join('\n'));
}

/** เตือนเคสที่ค้างเกิน SLA — รันวันละครั้ง */
function checkCaseSlaJob() {
  try {
    var overdue = [];
    var now = new Date().getTime();
    readTable_(TAB.CASES, true).rows.forEach(function (r) {
      var st = String(r.status).toUpperCase();
      if (['CLOSED', 'CANCELLED'].indexOf(st) !== -1) return;
      var risk = RISK_CLASS[String(r.risk_class)];
      if (!risk) return;
      var opened = parseStamp_(String(r.opened_at));
      if (!opened) return;
      var ageHours = (now - opened) / 3600000;
      if (ageHours > risk.sla_hours) {
        overdue.push({ case_no: String(r.case_no), risk: String(r.risk_class),
                       hours: Math.round(ageHours), sla: risk.sla_hours,
                       owner: String(r.case_owner), status: statusTh_(st),
                       pending: parseQty_(r.qty_affected) -
                                (parseQty_(r.qty_returned) + parseQty_(r.qty_replaced) + parseQty_(r.qty_corrected)) });
      }
    });
    if (!overdue.length) return;

    overdue.sort(function (a, b) { return (b.hours / b.sla) - (a.hours / a.sla); });
    var msg = ['⏰ เคสเรียกคืนที่เกินกำหนด ' + overdue.length + ' เคส', ''];
    overdue.slice(0, 10).forEach(function (o) {
      msg.push('· ' + o.case_no + ' (' + o.risk + ') เปิดมาแล้ว ' + o.hours + ' ชม. เกินเป้า ' + o.sla + ' ชม.');
      msg.push('   สถานะ ' + o.status + ' · ค้างอีก ' + round3_(o.pending) + ' หน่วย · ' + o.owner);
    });
    notifyLarkText_(msg.join('\n'));
  } catch (e) {
    logError_('checkCaseSlaJob', e);
  }
}

/** เตือนให้ทำ mock recall เมื่อไม่ได้ทำมานานเกินกำหนด — รันเดือนละครั้ง */
function checkMockRecallDueJob() {
  try {
    var everyDays = Number(setting_('mock_recall_every_days', 180));
    var rows = readTable_(TAB.MOCK, true).rows.filter(function (r) {
      return String(r.result).toUpperCase() !== 'IN_PROGRESS';
    });
    var last = '';
    rows.forEach(function (r) { if (String(r.test_date) > last) last = String(r.test_date); });

    if (!last) {
      notifyLarkText_('📋 ยังไม่เคยมีการทดสอบทวนสอบย้อนกลับ (Mock Recall) ในระบบ — ควรทำครั้งแรกภายในเดือนนี้');
      return;
    }
    var days = Math.round((new Date().getTime() - parseStamp_(last + ' 00:00:00')) / 86400000);
    if (days > everyDays) {
      notifyLarkText_('📋 ครบกำหนดทดสอบทวนสอบย้อนกลับแล้ว\nครั้งล่าสุด ' + last +
                      ' (' + days + ' วันที่แล้ว · กำหนดทุก ' + everyDays + ' วัน)');
    }
  } catch (e) {
    logError_('checkMockRecallDueJob', e);
  }
}

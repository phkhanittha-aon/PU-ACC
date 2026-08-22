/**
 * MGS Traceability & Recall — 04_MockRecall.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * การทดสอบทวนสอบย้อนกลับ (FM-QC-TR-02)
 *
 * แนวคิด: ระบบสร้าง "รายการที่ควรหาเจอ" จาก SAP ให้ก่อน แล้วผู้ทดสอบต้องไป
 * ยืนยันของจริงว่าหาเจอกี่หน่วย พร้อมหลักฐาน — ไม่ใช่ให้ระบบตอบเองทั้งหมด
 * ถ้าระบบตอบเองหมด การทดสอบก็ไม่ได้พิสูจน์อะไรเลย
 *
 * เกณฑ์ผ่าน (ทั้ง 3 ข้อต้องผ่านพร้อมกัน)
 *   1. หาเจอครบ 100% ของจำนวนที่คาดไว้
 *   2. กระทบยอดได้ 100% (รับเข้า = ส่งออก + คงคลัง + คืน)
 *   3. ใช้เวลาไม่เกินเป้าหมาย (ค่าตั้งต้น 120 นาที)
 */

function startMockRecall_(p, user) {
  var itemCode = str_(p.item_code, 60);
  var distNumber = str_(p.dist_number, 60);
  if (!itemCode || !distNumber) fail_('กรุณาเลือกสินค้าและเลขล็อต/ซีเรียลที่จะทดสอบ');

  var key = lotKey_(itemCode, distNumber);
  var trace = buildLotTrace_(key);      // โยน error เองถ้าไม่มีล็อตนี้

  var testType = String(p.test_type || 'BOTH').toUpperCase();
  if (['BACKWARD', 'FORWARD', 'BOTH'].indexOf(testType) === -1) fail_('ชนิดการทดสอบไม่ถูกต้อง');

  var now = nowStamp_();
  var testNo = nextDocNo_(TAB.MOCK, 'test_no', 'MR');
  var targetMin = parseQtyPos_(p.target_min || setting_('mock_recall_target_min', CFG.MOCK_RECALL_TARGET_MIN), 'เวลาเป้าหมาย');

  var lines = [];
  var seq = 0;

  if (testType === 'BACKWARD' || testType === 'BOTH') {
    trace.backward.forEach(function (b) {
      lines.push({
        line_id: uuid_(), test_no: testNo, leg: 'BACKWARD', seq: ++seq,
        party_or_location: b.party_name || b.whs_name || b.party_code,
        doc_type: b.doc_type_th, doc_num: b.doc_num, doc_date: b.doc_date,
        project: [b.supplier_po_no, b.supplier_invoice_no].filter(String).join(' / '),
        qty_expected: b.qty, qty_located: '', result: 'PENDING', evidence: '', remark: ''
      });
    });
  }

  if (testType === 'FORWARD' || testType === 'BOTH') {
    trace.forward.on_hand.forEach(function (s) {
      lines.push({
        line_id: uuid_(), test_no: testNo, leg: 'FORWARD', seq: ++seq,
        party_or_location: s.whs_name + ' (' + s.whs_code + ')',
        doc_type: 'คงคลัง', doc_num: '', doc_date: '', project: '',
        qty_expected: s.qty, qty_located: '', result: 'PENDING', evidence: '', remark: ''
      });
    });
    trace.forward.shipments.forEach(function (sh) {
      lines.push({
        line_id: uuid_(), test_no: testNo, leg: 'FORWARD', seq: ++seq,
        party_or_location: sh.party_name || sh.party_code || sh.whs_name,
        doc_type: sh.doc_type_th, doc_num: sh.doc_num, doc_date: sh.doc_date,
        project: sh.project,
        qty_expected: sh.qty, qty_located: '', result: 'PENDING', evidence: '', remark: ''
      });
    });
  }

  if (!lines.length) fail_('ล็อตนี้ยังไม่มีการเคลื่อนไหวใน SAP จึงทดสอบไม่ได้ — เลือกล็อตที่มีทั้งรับเข้าและส่งออก');

  var item = ctx_().items[itemCode] || {};
  appendRows_(TAB.MOCK, [{
    test_id: uuid_(), test_no: testNo, test_date: today_(),
    conducted_by: user.email, reviewed_by: '',
    item_code: itemCode, model: str_(item.item_name, 120),
    lot_key: key, dist_number: distNumber, test_type: testType,
    started_at: now, ended_at: '', duration_min: '', target_min: targetMin,
    qty_affected: '', qty_located: '', completion_pct: '', reconcile_pct: '',
    result: 'IN_PROGRESS',
    gap_found: '', root_cause: '', corrective_action: '', capa_owner: '',
    capa_due: '', capa_status: '', verified_by: '', verified_at: '',
    note: str_(p.note, 1000),
    created_at: now, updated_by: user.email, updated_at: now, row_version: 1
  }]);
  appendRows_(TAB.MOCK_LINES, lines);

  logAudit_('START_MOCK_RECALL', 'Mock_Recalls', testNo, null,
            { lot_key: key, lines: lines.length }, p.clientKey);

  return ok_({ test_no: testNo, lines: lines.length, started_at: now, target_min: targetMin });
}

/** ผู้ทดสอบบันทึกว่าหาเจอกี่หน่วย พร้อมหลักฐาน */
function updateMockLine_(p, user) {
  var lineId = str_(p.line_id, 60);
  var t = readTable_(TAB.MOCK_LINES);
  var found = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].line_id) === lineId) { found = t.rows[i]; break; }
  }
  if (!found) fail_('ไม่พบบรรทัดนี้');

  var head = findRow_(TAB.MOCK, 'test_no', String(found.test_no));
  if (!head) fail_('ไม่พบการทดสอบ ' + found.test_no);
  if (String(head.result).toUpperCase() !== 'IN_PROGRESS') {
    fail_('การทดสอบ ' + found.test_no + ' ปิดผลไปแล้ว แก้ไขไม่ได้');
  }

  var expected = parseQty_(found.qty_expected, 'จำนวนที่คาดไว้');
  var located = parseQtyPos_(p.qty_located, 'จำนวนที่หาเจอ');
  if (located > expected + 0.0001) {
    fail_('จำนวนที่หาเจอ (' + located + ') มากกว่าจำนวนที่คาดไว้ (' + expected + ') — ตรวจสอบอีกครั้ง');
  }
  var evidence = str_(p.evidence, 500);
  if (located > 0 && !evidence) fail_('ต้องระบุหลักฐานที่ใช้ยืนยัน เช่น เลขใบส่งของ รายการซีเรียล หรือรูปถ่าย');

  var result = located >= expected ? 'PASS' : (located > 0 ? 'PARTIAL' : 'FAIL');

  withLock_(function () {
    var sh = sheet_(TAB.MOCK_LINES);
    var fresh = readTable_(TAB.MOCK_LINES);
    var row = null;
    for (var j = 0; j < fresh.rows.length; j++) {
      if (String(fresh.rows[j].line_id) === lineId) { row = fresh.rows[j]; break; }
    }
    if (!row) fail_('ไม่พบบรรทัดนี้ (อาจถูกลบไปแล้ว)');
    var after = {};
    SCHEMA[TAB.MOCK_LINES].forEach(function (h) { after[h] = row[h]; });
    after.qty_located = located;
    after.result = result;
    after.evidence = evidence;
    after.remark = str_(p.remark, 500);
    sh.getRange(row._row, 1, 1, SCHEMA[TAB.MOCK_LINES].length)
      .setValues([toRow_(TAB.MOCK_LINES, after)]);
  });

  logAudit_('UPDATE_MOCK_LINE', 'Mock_Recall_Lines', lineId,
            { located: found.qty_located }, { located: located, result: result }, p.clientKey);
  return ok_({ line_id: lineId, result: result });
}

/** ปิดผลการทดสอบและคำนวณเกณฑ์ผ่าน */
function finishMockRecall_(p, user) {
  var testNo = str_(p.test_no, 40);
  var head = findRow_(TAB.MOCK, 'test_no', testNo);
  if (!head) fail_('ไม่พบการทดสอบ ' + testNo);
  if (String(head.result).toUpperCase() !== 'IN_PROGRESS') fail_('การทดสอบนี้ปิดผลไปแล้ว');

  var lines = findRows_(TAB.MOCK_LINES, 'test_no', testNo);
  var pending = lines.filter(function (l) { return String(l.result).toUpperCase() === 'PENDING'; });
  if (pending.length) fail_('ยังมี ' + pending.length + ' บรรทัดที่ยังไม่ได้บันทึกผล');

  var expected = 0, located = 0, anyFail = false;
  lines.forEach(function (l) {
    expected += parseQty_(l.qty_expected);
    located += parseQty_(l.qty_located);
    if (String(l.result).toUpperCase() === 'FAIL') anyFail = true;
  });

  var rec = reconcile_(String(head.lot_key));
  var endedAt = nowStamp_();
  var durationMin = diffMinutes_(String(head.started_at), endedAt);
  var targetMin = parseQty_(head.target_min) || CFG.MOCK_RECALL_TARGET_MIN;

  var completion = expected > 0 ? round3_(located / expected) : 0;
  var reconcilePct = rec.completion_pct;

  var pass = (completion >= 1) && rec.pass && !anyFail && (durationMin <= targetMin);
  var reasons = [];
  if (completion < 1) reasons.push('หาของไม่ครบ (' + Math.round(completion * 100) + '%)');
  if (!rec.pass) reasons.push('กระทบยอดไม่ลง ต่างอยู่ ' + rec.unaccounted + ' หน่วย');
  if (anyFail) reasons.push('มีบรรทัดที่หาไม่เจอเลย');
  if (durationMin > targetMin) reasons.push('ใช้เวลา ' + durationMin + ' นาที เกินเป้า ' + targetMin + ' นาที');

  var gap = pass ? '' : reasons.join(' · ');

  var res = withLock_(function () {
    return updateRow_(TAB.MOCK, 'test_no', testNo, {
      ended_at: endedAt, duration_min: durationMin,
      qty_affected: round3_(expected), qty_located: round3_(located),
      completion_pct: completion, reconcile_pct: reconcilePct,
      result: pass ? 'PASS' : 'FAIL',
      gap_found: gap,
      capa_status: pass ? 'NA' : 'OPEN',
      updated_by: user.email, updated_at: endedAt
    }, p.row_version);
  });

  logAudit_('FINISH_MOCK_RECALL', 'Mock_Recalls', testNo, null,
            { result: pass ? 'PASS' : 'FAIL', duration_min: durationMin, completion: completion },
            p.clientKey);

  notifyLarkText_((pass ? '✅' : '❌') + ' ทดสอบทวนสอบ ' + testNo + ' — ' + (pass ? 'ผ่าน' : 'ไม่ผ่าน') +
    '\nสินค้า ' + head.item_code + ' ล็อต ' + head.dist_number +
    '\nหาเจอ ' + Math.round(completion * 100) + '% · ใช้เวลา ' + durationMin + '/' + targetMin + ' นาที' +
    (gap ? '\nสาเหตุ: ' + gap : ''));

  return ok_({ test_no: testNo, result: pass ? 'PASS' : 'FAIL', duration_min: durationMin,
               completion_pct: completion, reconcile_pct: reconcilePct, gap_found: gap,
               row_version: res.after.row_version });
}

/** ผู้จัดการคุณภาพทบทวนผล + บันทึก CAPA เมื่อไม่ผ่าน */
function reviewMockRecall_(p, user) {
  var testNo = str_(p.test_no, 40);
  var head = findRow_(TAB.MOCK, 'test_no', testNo);
  if (!head) fail_('ไม่พบการทดสอบ ' + testNo);
  if (String(head.result).toUpperCase() === 'IN_PROGRESS') fail_('ต้องปิดผลการทดสอบก่อนจึงทบทวนได้');
  if (String(head.conducted_by || '').toLowerCase() === user.email) {
    fail_('ผู้ทดสอบกับผู้ทบทวนต้องเป็นคนละคน');
  }

  var failed = String(head.result).toUpperCase() === 'FAIL';
  var rootCause = str_(p.root_cause, 2000);
  var capa = str_(p.corrective_action, 2000);
  if (failed) {
    if (rootCause.length < 10) fail_('การทดสอบไม่ผ่าน ต้องระบุสาเหตุที่แท้จริงอย่างน้อย 10 ตัวอักษร');
    if (capa.length < 10) fail_('การทดสอบไม่ผ่าน ต้องระบุการแก้ไขอย่างน้อย 10 ตัวอักษร');
    if (!str_(p.capa_owner, 120)) fail_('ต้องระบุผู้รับผิดชอบการแก้ไข');
    if (!p.capa_due) fail_('ต้องระบุวันที่กำหนดแล้วเสร็จ');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.MOCK, 'test_no', testNo, {
      reviewed_by: user.email,
      root_cause: rootCause, corrective_action: capa,
      capa_owner: str_(p.capa_owner, 120),
      capa_due: p.capa_due ? parseDate_(p.capa_due, 'วันที่กำหนดแล้วเสร็จ') : '',
      capa_status: failed ? 'OPEN' : 'NA',
      verified_by: user.email, verified_at: nowStamp_(),
      note: str_(pick_(p.note, head.note), 1000),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  logAudit_('REVIEW_MOCK_RECALL', 'Mock_Recalls', testNo, res.before, res.after, p.clientKey);
  return ok_({ test_no: testNo, reviewed_by: user.email });
}

function getMockRecall_(testNo) {
  var head = findRow_(TAB.MOCK, 'test_no', testNo);
  if (!head) fail_('ไม่พบการทดสอบ ' + testNo);
  var lines = findRows_(TAB.MOCK_LINES, 'test_no', testNo);
  return {
    header: {
      test_no: String(head.test_no), test_date: String(head.test_date),
      conducted_by: String(head.conducted_by), reviewed_by: String(head.reviewed_by || ''),
      item_code: String(head.item_code), model: String(head.model || ''),
      lot_key: String(head.lot_key), dist_number: String(head.dist_number),
      test_type: String(head.test_type),
      started_at: String(head.started_at), ended_at: String(head.ended_at || ''),
      duration_min: parseQty_(head.duration_min), target_min: parseQty_(head.target_min),
      qty_affected: parseQty_(head.qty_affected), qty_located: parseQty_(head.qty_located),
      completion_pct: parseQty_(head.completion_pct), reconcile_pct: parseQty_(head.reconcile_pct),
      result: String(head.result),
      gap_found: String(head.gap_found || ''), root_cause: String(head.root_cause || ''),
      corrective_action: String(head.corrective_action || ''),
      capa_owner: String(head.capa_owner || ''), capa_due: String(head.capa_due || ''),
      capa_status: String(head.capa_status || ''),
      note: String(head.note || ''), row_version: parseQty_(head.row_version)
    },
    lines: lines.map(function (l) {
      return { line_id: String(l.line_id), leg: String(l.leg), seq: parseQty_(l.seq),
               party_or_location: String(l.party_or_location || ''),
               doc_type: String(l.doc_type || ''), doc_num: String(l.doc_num || ''),
               doc_date: String(l.doc_date || ''), project: String(l.project || ''),
               qty_expected: parseQty_(l.qty_expected),
               qty_located: l.qty_located === '' ? '' : parseQty_(l.qty_located),
               result: String(l.result), evidence: String(l.evidence || ''),
               remark: String(l.remark || '') };
    }).sort(function (a, b) { return a.seq - b.seq; })
  };
}

function listMockRecalls_() {
  return readTable_(TAB.MOCK, true).rows.map(function (r) {
    return { test_no: String(r.test_no), test_date: String(r.test_date),
             item_code: String(r.item_code), dist_number: String(r.dist_number),
             test_type: String(r.test_type), result: String(r.result),
             duration_min: parseQty_(r.duration_min), target_min: parseQty_(r.target_min),
             completion_pct: parseQty_(r.completion_pct),
             conducted_by: String(r.conducted_by), reviewed_by: String(r.reviewed_by || ''),
             capa_status: String(r.capa_status || '') };
  }).sort(function (a, b) { return String(b.test_date).localeCompare(String(a.test_date)); });
}

/** ต่างเวลาเป็นนาที จากสตริง yyyy-MM-dd HH:mm:ss (เขตเวลาเดียวกันทั้งคู่) */
function diffMinutes_(from, to) {
  var a = parseStamp_(from), b = parseStamp_(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

function parseStamp_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                  Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
}

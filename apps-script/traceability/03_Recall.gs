/**
 * MGS Traceability & Recall — 03_Recall.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * วงจรชีวิตของเคสเรียกคืน (FM-QC-RC-01 + FM-QC-RC-02)
 *
 *   DRAFT ──► OPEN ──► CONTAINED ──► TRACKING ──► VERIFYING ──► CLOSED
 *                └──────────┴──► CANCELLED
 *
 * สิ่งที่ระบบทำให้แทนคน (ต่างจากฟอร์ม Excel เดิม)
 *   · คำนวณ "ของกระทบทั้งหมด / อยู่ในคลัง / ส่งไปแล้ว / หายไป" จาก SAP ไม่ใช่ให้คนคีย์
 *   · สร้างแถวติดตามลูกค้า-โครงการ-คลัง ครบทุกปลายทางอัตโนมัติ ไม่ต้องไล่หาเอง
 *   · กักของในคลังทันทีที่เปิดเคส และปลดได้เฉพาะผู้จัดการคุณภาพ
 *   · คำนวณ % ประสิทธิผลใหม่ทุกครั้งที่มีคนอัปเดตแถวติดตาม
 */

/* ══════════════════════════════════════════════════════════════════════════
   1. เปิดเคส
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * @param {{clientKey:string, source:string, source_ref:string, item_code:string,
 *          problem:string, risk_class:string, immediate_action:string,
 *          case_owner:string, scope:Array<{kind:string, dist_number:string,
 *          sn_from:string, sn_to:string, qty_affected:number}>}} p
 */
function openCase_(p, user) {
  var itemCode = str_(p.item_code, 60);
  if (!itemCode) fail_('กรุณาเลือกสินค้า');
  if (!CASE_SOURCE[p.source]) fail_('ที่มาของเคสไม่ถูกต้อง');
  if (!RISK_CLASS[p.risk_class]) fail_('ระดับความเสี่ยงไม่ถูกต้อง');
  var problem = str_(p.problem, 2000);
  if (problem.length < 10) fail_('กรุณาอธิบายปัญหาอย่างน้อย 10 ตัวอักษร — ข้อความนี้จะถูกส่งให้ทุกแผนกที่เกี่ยวข้อง');
  if (!p.scope || !p.scope.length) fail_('กรุณาระบุล็อตหรือช่วงซีเรียลที่ได้รับผลกระทบอย่างน้อย 1 รายการ');
  if (p.scope.length > 200) fail_('ระบุขอบเขตได้ไม่เกิน 200 รายการต่อเคส');

  var c = ctx_();
  var item = c.items[itemCode];
  if (!item) fail_('ไม่พบรหัสสินค้า ' + itemCode + ' ในข้อมูลจาก SAP');

  // แปลงขอบเขตที่ผู้ใช้ระบุ -> รายการ lot_key จริงที่มีอยู่ใน SAP
  var scopeRows = [];
  p.scope.forEach(function (s) {
    var kind = String(s.kind || item.mng_method || '').toUpperCase();
    if (kind === MNG.SERIAL) {
      var serials = expandSerialRange_(itemCode, s.sn_from, s.sn_to);
      serials.forEach(function (sn) {
        scopeRows.push({ kind: MNG.SERIAL, dist_number: sn, lot_key: lotKey_(itemCode, sn),
                         sn_from: sn, sn_to: sn, qty: 1 });
      });
    } else {
      var dn = str_(s.dist_number, 60);
      if (!dn) fail_('กรุณาระบุเลขล็อต');
      var k = lotKey_(itemCode, dn);
      if (!c.lots[k] && !c.movesByLot[k]) fail_('ไม่พบล็อต ' + dn + ' ของสินค้า ' + itemCode + ' ใน SAP');
      var q = (s.qty_affected === '' || s.qty_affected === undefined || s.qty_affected === null)
        ? reconcile_(k).received
        : parseQtyPos_(s.qty_affected, 'จำนวนที่กระทบ');
      if (q <= 0) fail_('จำนวนที่กระทบของล็อต ' + dn + ' ต้องมากกว่า 0');
      scopeRows.push({ kind: MNG.BATCH, dist_number: dn, lot_key: k,
                       sn_from: '', sn_to: '', qty: q });
    }
  });

  // ตัดล็อตซ้ำ — ผู้ใช้ระบุช่วงซีเรียลทับกันได้ง่าย
  var seen = {}, uniq = [];
  scopeRows.forEach(function (r) { if (!seen[r.lot_key]) { seen[r.lot_key] = 1; uniq.push(r); } });
  scopeRows = uniq;

  // ช่วงซีเรียลกว้างมากทำให้คำขอเดียวต้องเขียนหลายพันแถว แล้วชนเพดาน 6 นาทีของ Apps Script
  // ตัดตั้งแต่ต้นดีกว่าปล่อยให้เขียนไปครึ่งทางแล้วตาย — เคสที่เปิดค้างครึ่ง ๆ กลาง ๆ แก้ยากที่สุด
  if (scopeRows.length > 1000) {
    fail_('ขอบเขตกว้างเกินไป (' + scopeRows.length + ' ล็อต/ซีเรียล) — ระบบรับได้ครั้งละไม่เกิน 1,000 รายการ\n' +
          'ให้แบ่งเปิดเป็นหลายเคสตามช่วงซีเรียล หรือระบุเป็นเลขล็อตแทนการไล่ทีละซีเรียล');
  }

  var caseNo = nextDocNo_(TAB.CASES, 'case_no', 'RC');
  var now = nowStamp_();
  var folderId = createCaseFolder_(caseNo);

  var totals = computeScopeTotals_(scopeRows);
  var risk = RISK_CLASS[p.risk_class];

  var row = {
    case_id: uuid_(),
    case_no: caseNo,
    status: 'OPEN',
    opened_at: now,
    opened_by: user.email,
    case_owner: str_(p.case_owner, 120) || user.email,
    source: p.source,
    source_ref: str_(p.source_ref, 200),
    product_type: str_(item.product_type, 60),
    brand: str_(item.brand, 60),
    item_code: itemCode,
    model: str_(item.item_name, 120),
    problem: problem,
    risk_class: p.risk_class,
    immediate_action: str_(p.immediate_action, 500) || 'กักของที่ยังอยู่ในคลัง และตามหาของที่ส่งออกไปแล้ว',
    escalated: risk.escalate ? 'TRUE' : 'FALSE',
    escalated_at: risk.escalate ? now : '',
    recall_required: '',
    field_action: '',
    customer_notify_required: '',
    supplier_claim_required: '',
    qty_affected: totals.affected,
    qty_in_stock: totals.in_stock,
    qty_delivered: totals.delivered,
    qty_unaccounted: totals.unaccounted,
    qty_returned: 0,
    qty_replaced: 0,
    qty_corrected: 0,
    effectiveness_pct: 0,
    closed_at: '', closed_by: '', closure_note: '',
    drive_folder_id: folderId,
    created_at: now,
    updated_by: user.email,
    updated_at: now,
    row_version: 1
  };

  appendRows_(TAB.CASES, [row]);

  appendRows_(TAB.SCOPE, scopeRows.map(function (s) {
    return { scope_id: uuid_(), case_no: caseNo, item_code: itemCode, kind: s.kind,
             dist_number: s.dist_number, sn_from: s.sn_from, sn_to: s.sn_to,
             lot_key: s.lot_key, qty_affected: s.qty, added_by: user.email,
             added_at: now, note: '' };
  }));

  // สร้างช่องการสอบสวน/CAPA/การตัดสินใจ ครบทุกหัวข้อตามฟอร์ม RC-01
  appendRows_(TAB.ACTIONS, ACTION_SECTIONS.map(function (s, i) {
    return { action_id: uuid_(), case_no: caseNo, section_type: s.type, section: s.key,
             seq: i + 1, details: '', responsible: '', target_date: '', status: 'OPEN',
             evidence_file_ids: '', approved_by: '', approved_at: '', remark: '',
             created_at: now, updated_by: user.email, updated_at: now, row_version: 1 };
  }));

  // กักของในคลังทันที — นี่คือสิ่งที่ต้องเกิดก่อนอย่างอื่นทั้งหมด
  var holds = placeHoldsForScope_(caseNo, scopeRows, user, now);

  // สร้างแถวติดตามทุกปลายทาง
  var tracks = buildTrackingRows_(caseNo, scopeRows, user, now);

  logAudit_('OPEN_CASE', 'Recall_Cases', caseNo, null,
            { qty_affected: totals.affected, lots: scopeRows.length, holds: holds, tracks: tracks },
            p.clientKey);

  notifyCaseOpened_(row, totals, holds, tracks);

  return ok_({ case_no: caseNo, holds: holds, tracking_rows: tracks, totals: totals });
}

/** ยอดรวมของขอบเขต — คิดจาก SAP ไม่ใช่จากที่คนกรอก */
function computeScopeTotals_(scopeRows) {
  var affected = 0, inStock = 0, delivered = 0, other = 0;
  scopeRows.forEach(function (s) {
    var r = reconcile_(s.lot_key);
    var qty = Number(s.qty_affected !== undefined ? s.qty_affected : s.qty) || 0;
    affected += qty;
    // สัดส่วนที่กระทบเทียบกับล็อตทั้งหมด — ล็อตใหญ่ที่กระทบบางส่วนต้องไม่นับเกินจริง
    var share = r.received > 0 ? Math.min(1, qty / r.received) : 1;
    inStock   += r.on_hand * share;
    delivered += r.shipped_out * share;
    other     += (r.returned_to_supplier + r.other_out) * share;
  });
  affected = round3_(affected);
  inStock = round3_(inStock);
  delivered = round3_(delivered);
  other = round3_(other);
  return {
    affected: affected,
    in_stock: inStock,
    delivered: delivered,
    other_out: other,
    unaccounted: round3_(Math.max(affected - inStock - delivered - other, 0))
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2. กักของ
   ══════════════════════════════════════════════════════════════════════════ */
function placeHoldsForScope_(caseNo, scopeRows, user, now) {
  var c = ctx_();
  var rows = [];
  scopeRows.forEach(function (s) {
    (c.stockByLot[s.lot_key] || []).forEach(function (st) {
      if (!st.quantity || st.quantity <= 0) return;
      var parts = s.lot_key.split('|');
      rows.push({
        hold_id: uuid_(), case_no: caseNo, lot_key: s.lot_key,
        item_code: parts[0], dist_number: parts[1] || '',
        whs_code: st.whs_code, qty_hold: st.quantity, status: 'HOLD',
        placed_by: user.email, placed_at: now,
        released_by: '', released_at: '', release_reason: '', row_version: 1
      });
    });
  });
  appendRows_(TAB.HOLDS, rows);
  return rows.length;
}

function releaseHold_(p, user) {
  var holdId = str_(p.hold_id, 60);
  var reason = str_(p.reason, 500);
  if (reason.length < 5) fail_('กรุณาระบุเหตุผลที่ปลดการกัก — ข้อความนี้ถูกบันทึกถาวรและใช้ตอนตรวจสอบ');
  var h = findRow_(TAB.HOLDS, 'hold_id', holdId);
  if (!h) fail_('ไม่พบรายการกักนี้');
  if (String(h.status).toUpperCase() !== 'HOLD') fail_('รายการนี้ถูกปลดไปแล้วเมื่อ ' + h.released_at);

  var r = updateRow_(TAB.HOLDS, 'hold_id', holdId, {
    status: 'RELEASED', released_by: user.email, released_at: nowStamp_(), release_reason: reason
  }, p.row_version);

  logAudit_('RELEASE_HOLD', 'Holds', holdId, r.before, r.after, p.clientKey);
  notifyLarkText_('🔓 ปลดการกักสินค้า ' + h.item_code + ' / ' + h.dist_number +
                  ' คลัง ' + h.whs_code + ' จำนวน ' + h.qty_hold +
                  '\nเคส ' + h.case_no + ' · โดย ' + user.email + '\nเหตุผล: ' + reason);
  return ok_({ hold_id: holdId });
}

/* ══════════════════════════════════════════════════════════════════════════
   3. สร้างแถวติดตาม — หัวใจของ FM-QC-RC-02
   ══════════════════════════════════════════════════════════════════════════ */
function buildTrackingRows_(caseNo, scopeRows, user, now) {
  var c = ctx_();
  var lotKeys = scopeRows.map(function (s) { return s.lot_key; });

  // สัดส่วนที่กระทบต่อล็อต — ล็อตที่กระทบบางส่วนต้องไม่เรียกคืนทั้งล็อต
  var shareByLot = {};
  scopeRows.forEach(function (s) {
    var r = reconcile_(s.lot_key);
    var qty = Number(s.qty_affected !== undefined ? s.qty_affected : s.qty) || 0;
    shareByLot[s.lot_key] = r.received > 0 ? Math.min(1, qty / r.received) : 1;
  });

  var dests = destinationsForLots_(lotKeys, shareByLot);

  // แถวที่มีอยู่แล้วของเคสนี้ — กันการสร้างซ้ำเมื่อกด "สร้างรายการติดตามใหม่"
  var existing = {};
  findRows_(TAB.TRACKING, 'case_no', caseNo).forEach(function (t) {
    existing[[String(t.location_type), String(t.party_code), String(t.project),
              String(t.doc_num), String(t.item_code)].join('~')] = true;
  });

  var rows = [];
  dests.forEach(function (d) {
    var dedupeKey = [d.location_type === 'CUSTOMER' ? 'CUSTOMER' : d.location_type,
                     d.party_code, d.project, d.doc_num, d.item_code].join('~');
    if (existing[dedupeKey]) return;
    if (d.qty <= 0) return;
    var item = c.items[String(d.item_code)] || {};
    var inWarehouse = d.location_type === 'WAREHOUSE';
    rows.push({
      track_id: uuid_(), case_no: caseNo,
      item_code: d.item_code, model: str_(item.item_name, 120),
      lot_key: d.lot_keys.length === 1 ? d.lot_keys[0] : '',
      dist_number: d.dist_numbers.length === 1 ? d.dist_numbers[0] : '',
      sn_display: d.sn_display,
      location_type: d.location_type, party_code: d.party_code, party_name: d.party_name,
      project: d.project, doc_type: d.doc_type, doc_num: d.doc_num, doc_date: d.doc_date,
      qty_affected: d.qty,
      contacted_at: '', contacted_by: '',
      // ของในคลังกักได้ทันทีเอง ของที่ส่งไปแล้วต้องให้คนตัดสินใจว่าจะคืน เปลี่ยน หรือแก้หน้างาน
      required_action: inWarehouse ? 'HOLD' : 'INSPECT_CORRECT',
      qty_returned: 0, qty_replaced: 0, qty_corrected: 0, qty_pending: d.qty,
      status: inWarehouse ? 'IN_PROGRESS' : 'PENDING',
      evidence_file_ids: '', remark: '',
      created_at: now, updated_by: user.email, updated_at: now, row_version: 1
    });
  });

  appendRows_(TAB.TRACKING, rows);
  return rows.length;
}

/** เรียกสร้างแถวติดตามใหม่ (ใช้เมื่อ sync ข้อมูล SAP มาแล้วเจอปลายทางเพิ่ม) */
function rebuildTracking_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var cs = requireOpenCase_(caseNo);
  var scopeRows = findRows_(TAB.SCOPE, 'case_no', caseNo).map(function (s) {
    return { lot_key: String(s.lot_key), kind: String(s.kind),
             dist_number: String(s.dist_number), qty_affected: parseQty_(s.qty_affected) };
  });
  if (!scopeRows.length) fail_('เคสนี้ยังไม่มีขอบเขต');
  var added = buildTrackingRows_(caseNo, scopeRows, user, nowStamp_());
  var holds = placeHoldsForScopeIfNew_(caseNo, scopeRows, user);
  recomputeCase_(caseNo, user);
  logAudit_('REBUILD_TRACKING', 'Recall_Cases', caseNo, null, { added: added, holds: holds }, p.clientKey);
  return ok_({ added: added, holds_added: holds, case_status: cs.status });
}

function placeHoldsForScopeIfNew_(caseNo, scopeRows, user) {
  var have = {};
  findRows_(TAB.HOLDS, 'case_no', caseNo).forEach(function (h) {
    have[String(h.lot_key) + '|' + String(h.whs_code)] = true;
  });
  var fresh = [];
  var c = ctx_();
  scopeRows.forEach(function (s) {
    (c.stockByLot[s.lot_key] || []).forEach(function (st) {
      if (!st.quantity || st.quantity <= 0) return;
      if (have[s.lot_key + '|' + st.whs_code]) return;
      fresh.push(s);
    });
  });
  if (!fresh.length) return 0;
  return placeHoldsForScope_(caseNo, fresh, user, nowStamp_());
}

/* ══════════════════════════════════════════════════════════════════════════
   4. อัปเดตแถวติดตาม — งานประจำวันของ QC/คลัง/ขาย
   ══════════════════════════════════════════════════════════════════════════ */
function updateTracking_(p, user) {
  var trackId = str_(p.track_id, 60);
  var t = findRow_(TAB.TRACKING, 'track_id', trackId);
  if (!t) fail_('ไม่พบรายการติดตามนี้');
  var cs = findRow_(TAB.CASES, 'case_no', String(t.case_no));
  if (!cs) fail_('ไม่พบเคส ' + t.case_no);
  if (['CLOSED', 'CANCELLED'].indexOf(String(cs.status)) !== -1) {
    fail_('เคส ' + t.case_no + ' ปิดแล้ว แก้ไขรายการติดตามไม่ได้');
  }

  var affected = parseQty_(t.qty_affected, 'จำนวนที่กระทบ');
  var ret = parseQtyPos_(pick_(p.qty_returned,  t.qty_returned),  'จำนวนที่รับคืน');
  var rep = parseQtyPos_(pick_(p.qty_replaced,  t.qty_replaced),  'จำนวนที่เปลี่ยนใหม่');
  var cor = parseQtyPos_(pick_(p.qty_corrected, t.qty_corrected), 'จำนวนที่แก้ไข/ตรวจแล้ว');

  var done = round3_(ret + rep + cor);
  if (done > affected + 0.0001) {
    fail_('จำนวนที่ดำเนินการแล้ว (' + done + ') มากกว่าจำนวนที่กระทบ (' + affected + ') — กรุณาตรวจสอบตัวเลข');
  }

  var action = p.required_action !== undefined ? String(p.required_action) : String(t.required_action);
  if (!REQUIRED_ACTION[action]) fail_('การดำเนินการที่ระบุไม่ถูกต้อง');

  var status = p.status !== undefined ? String(p.status) : String(t.status);
  if (!TRACK_STATUS[status]) fail_('สถานะที่ระบุไม่ถูกต้อง');

  var pending = round3_(affected - done);
  // ปิดแถวได้ก็ต่อเมื่อจำนวนครบจริง — กันการติ๊ก "เสร็จสิ้น" ทั้งที่ของยังค้าง
  if (status === 'COMPLETED' && pending > CFG.RECONCILE_TOLERANCE_QTY) {
    fail_('ยังเหลือ ' + pending + ' หน่วยที่ยังไม่ได้รับคืน/เปลี่ยน/แก้ไข — ปิดรายการนี้ไม่ได้');
  }
  if (status !== 'COMPLETED' && pending <= 0 && done > 0) status = 'COMPLETED';

  var contactedAt = String(t.contacted_at || '');
  var contactedBy = String(t.contacted_by || '');
  if (!contactedAt && ['CONTACTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_REACHED'].indexOf(status) !== -1) {
    contactedAt = nowStamp_();
    contactedBy = user.email;
  }

  var res = withLock_(function () {
    return updateRow_(TAB.TRACKING, 'track_id', trackId, {
      required_action: action,
      qty_returned: ret, qty_replaced: rep, qty_corrected: cor, qty_pending: pending,
      status: status,
      contacted_at: contactedAt, contacted_by: contactedBy,
      evidence_file_ids: str_(pick_(p.evidence_file_ids, t.evidence_file_ids), 1000),
      remark: str_(pick_(p.remark, t.remark), 1000),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  var totals = recomputeCase_(String(t.case_no), user);
  logAudit_('UPDATE_TRACKING', 'Recall_Tracking', trackId, res.before, res.after, p.clientKey);
  return ok_({ track_id: trackId, case_totals: totals, row_version: res.after.row_version });
}

function pick_(a, b) { return (a === undefined || a === null) ? b : a; }

/* ══════════════════════════════════════════════════════════════════════════
   5. คำนวณยอดรวมและ % ประสิทธิผลของเคสใหม่
   ══════════════════════════════════════════════════════════════════════════ */
function recomputeCase_(caseNo, user) {
  var tracks = findRows_(TAB.TRACKING, 'case_no', caseNo);
  var ret = 0, rep = 0, cor = 0, aff = 0;
  tracks.forEach(function (t) {
    aff += parseQty_(t.qty_affected);
    ret += parseQty_(t.qty_returned);
    rep += parseQty_(t.qty_replaced);
    cor += parseQty_(t.qty_corrected);
  });
  var scopeRows = findRows_(TAB.SCOPE, 'case_no', caseNo).map(function (s) {
    return { lot_key: String(s.lot_key), qty_affected: parseQty_(s.qty_affected) };
  });
  var totals = computeScopeTotals_(scopeRows);
  var done = round3_(ret + rep + cor);
  var pct = aff > 0 ? round3_(done / aff) : 0;

  withLock_(function () {
    updateRow_(TAB.CASES, 'case_no', caseNo, {
      qty_affected: totals.affected,
      qty_in_stock: totals.in_stock,
      qty_delivered: totals.delivered,
      qty_unaccounted: totals.unaccounted,
      qty_returned: round3_(ret), qty_replaced: round3_(rep), qty_corrected: round3_(cor),
      effectiveness_pct: pct,
      updated_by: user ? user.email : 'system', updated_at: nowStamp_()
    }, null);
  });

  return { affected: totals.affected, in_stock: totals.in_stock, delivered: totals.delivered,
           unaccounted: totals.unaccounted, returned: round3_(ret), replaced: round3_(rep),
           corrected: round3_(cor), effectiveness_pct: pct,
           tracked_total: round3_(aff), tracked_done: done };
}

/* ══════════════════════════════════════════════════════════════════════════
   6. เปลี่ยนสถานะเคส — เดินหน้าอย่างเดียว ตรวจเงื่อนไขทุกครั้ง
   ══════════════════════════════════════════════════════════════════════════ */
function advanceCase_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var to = String(p.to_status || '').toUpperCase();
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  var from = String(cs.status).toUpperCase();
  assertTransition_(from, to);

  // เงื่อนไขก่อนเข้าสถานะใหม่ — เขียนไว้ที่เดียว
  if (to === 'CONTAINED') {
    var open = findRows_(TAB.HOLDS, 'case_no', caseNo).filter(function (h) {
      return String(h.status).toUpperCase() === 'HOLD';
    });
    var stockQty = parseQty_(cs.qty_in_stock);
    if (stockQty > 0 && !open.length) {
      fail_('ยังมีของในคลัง ' + stockQty + ' หน่วยที่ยังไม่ถูกกัก — กดสร้างรายการกักก่อน');
    }
  }
  if (to === 'VERIFYING') {
    var pend = findRows_(TAB.TRACKING, 'case_no', caseNo).filter(function (t) {
      return ['COMPLETED', 'NOT_REACHED'].indexOf(String(t.status).toUpperCase()) === -1;
    });
    if (pend.length) fail_('ยังมีรายการติดตามค้างอยู่ ' + pend.length + ' รายการ — ปิดให้ครบก่อนตรวจประสิทธิผล');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.CASES, 'case_no', caseNo, {
      status: to, updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  logAudit_('CASE_STATUS', 'Recall_Cases', caseNo, { status: from }, { status: to }, p.clientKey);
  notifyLarkText_('📋 เคส ' + caseNo + ' เปลี่ยนสถานะ ' + statusTh_(from) + ' → ' + statusTh_(to) +
                  '\nโดย ' + user.email);
  return ok_({ case_no: caseNo, status: to, row_version: res.after.row_version });
}

function assertTransition_(from, to) {
  var def = CASE_STATUS[from];
  if (!def) fail_('สถานะปัจจุบันของเคสไม่ถูกต้อง: ' + from);
  if (def.next.indexOf(to) === -1) {
    fail_('เปลี่ยนสถานะจาก "' + statusTh_(from) + '" ไปเป็น "' + statusTh_(to) + '" ไม่ได้');
  }
}

function statusTh_(s) { return (CASE_STATUS[s] && CASE_STATUS[s].th) || s; }

function requireOpenCase_(caseNo) {
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  if (['CLOSED', 'CANCELLED'].indexOf(String(cs.status).toUpperCase()) !== -1) {
    fail_('เคส ' + caseNo + ' อยู่ในสถานะ ' + statusTh_(String(cs.status)) + ' แก้ไขไม่ได้');
  }
  return cs;
}

/* ══════════════════════════════════════════════════════════════════════════
   7. ปิดเคส / ยกเลิกเคส
   ══════════════════════════════════════════════════════════════════════════ */
function closeCase_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var note = str_(p.closure_note, 2000);
  if (note.length < 10) fail_('กรุณาสรุปผลการปิดเคสอย่างน้อย 10 ตัวอักษร');
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  assertTransition_(String(cs.status).toUpperCase(), 'CLOSED');
  assertVersion_(cs.row_version, p.row_version, 'เคส ' + caseNo);

  // ห้ามปิดถ้ายังมีของค้าง หรือยังมีการกักที่ไม่ได้ตัดสินใจ
  // recomputeCase_ ขยับ row_version เอง จึงตรวจเวอร์ชันไปแล้วข้างบน แล้วเขียนด้วย null
  var totals = recomputeCase_(caseNo, user);
  if (totals.tracked_total - totals.tracked_done > CFG.RECONCILE_TOLERANCE_QTY) {
    fail_('ยังเหลือของที่ยังไม่จบ ' + round3_(totals.tracked_total - totals.tracked_done) +
          ' หน่วย — ปิดเคสไม่ได้');
  }
  var stillHeld = findRows_(TAB.HOLDS, 'case_no', caseNo).filter(function (h) {
    return String(h.status).toUpperCase() === 'HOLD';
  });
  if (stillHeld.length) {
    fail_('ยังมีของถูกกักอยู่ ' + stillHeld.length + ' รายการ — ต้องปลดการกักหรือบันทึกการทำลายก่อนปิดเคส');
  }
  var openDecisions = findRows_(TAB.ACTIONS, 'case_no', caseNo).filter(function (a) {
    return String(a.section_type) === 'DECISION' && String(a.status).toUpperCase() === 'OPEN';
  });
  if (openDecisions.length) {
    fail_('ยังมีหัวข้อการตัดสินใจที่ยังไม่สรุป ' + openDecisions.length + ' หัวข้อ');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.CASES, 'case_no', caseNo, {
      status: 'CLOSED', closed_at: nowStamp_(), closed_by: user.email, closure_note: note,
      updated_by: user.email, updated_at: nowStamp_()
    }, null);
  });

  logAudit_('CLOSE_CASE', 'Recall_Cases', caseNo, { status: cs.status }, res.after, p.clientKey);
  notifyLarkText_('✅ ปิดเคสเรียกคืน ' + caseNo + ' แล้ว\nประสิทธิผล ' +
                  Math.round(totals.effectiveness_pct * 100) + '%\nสรุป: ' + note);
  return ok_({ case_no: caseNo, status: 'CLOSED' });
}

function cancelCase_(p, user) {
  var caseNo = str_(p.case_no, 40);
  var reason = str_(p.reason, 1000);
  if (reason.length < 10) fail_('กรุณาระบุเหตุผลที่ยกเลิกอย่างน้อย 10 ตัวอักษร');
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  assertTransition_(String(cs.status).toUpperCase(), 'CANCELLED');

  var res = withLock_(function () {
    var r = updateRow_(TAB.CASES, 'case_no', caseNo, {
      status: 'CANCELLED', closed_at: nowStamp_(), closed_by: user.email,
      closure_note: 'ยกเลิก: ' + reason, updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
    // ปลดการกักทั้งหมดของเคสที่ยกเลิก — ของไม่ควรค้างอยู่ในสถานะกักโดยไม่มีเจ้าของ
    findRows_(TAB.HOLDS, 'case_no', caseNo).forEach(function (h) {
      if (String(h.status).toUpperCase() !== 'HOLD') return;
      updateRow_(TAB.HOLDS, 'hold_id', String(h.hold_id), {
        status: 'RELEASED', released_by: user.email, released_at: nowStamp_(),
        release_reason: 'ยกเลิกเคส: ' + reason
      }, null);
    });
    return r;
  });

  logAudit_('CANCEL_CASE', 'Recall_Cases', caseNo, { status: cs.status }, res.after, p.clientKey);
  notifyLarkText_('🚫 ยกเลิกเคส ' + caseNo + ' และปลดการกักทั้งหมด\nเหตุผล: ' + reason);
  return ok_({ case_no: caseNo, status: 'CANCELLED' });
}

/* ══════════════════════════════════════════════════════════════════════════
   8. การสอบสวน / CAPA / การตัดสินใจ
   ══════════════════════════════════════════════════════════════════════════ */
function updateAction_(p, user) {
  var actionId = str_(p.action_id, 60);
  var a = findRow_(TAB.ACTIONS, 'action_id', actionId);
  if (!a) fail_('ไม่พบหัวข้อนี้');
  requireOpenCase_(String(a.case_no));

  var status = p.status !== undefined ? String(p.status).toUpperCase() : String(a.status).toUpperCase();
  if (['OPEN', 'IN_PROGRESS', 'DONE', 'NA'].indexOf(status) === -1) fail_('สถานะไม่ถูกต้อง');
  var details = str_(pick_(p.details, a.details), 4000);
  if (status === 'DONE' && details.length < 5) fail_('ต้องกรอกรายละเอียดก่อนตั้งสถานะเป็น "เสร็จ"');

  var res = withLock_(function () {
    return updateRow_(TAB.ACTIONS, 'action_id', actionId, {
      details: details,
      responsible: str_(pick_(p.responsible, a.responsible), 120),
      target_date: p.target_date ? parseDate_(p.target_date, 'วันที่กำหนดเสร็จ') : String(a.target_date || ''),
      status: status,
      evidence_file_ids: str_(pick_(p.evidence_file_ids, a.evidence_file_ids), 1000),
      remark: str_(pick_(p.remark, a.remark), 1000),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  syncCaseDecisionFlags_(String(a.case_no), user);
  logAudit_('UPDATE_ACTION', 'Recall_Actions', actionId, res.before, res.after, p.clientKey);
  return ok_({ action_id: actionId, row_version: res.after.row_version });
}

function approveAction_(p, user) {
  var actionId = str_(p.action_id, 60);
  var a = findRow_(TAB.ACTIONS, 'action_id', actionId);
  if (!a) fail_('ไม่พบหัวข้อนี้');
  requireOpenCase_(String(a.case_no));
  if (String(a.status).toUpperCase() !== 'DONE') fail_('อนุมัติได้เฉพาะหัวข้อที่สถานะเป็น "เสร็จ" แล้ว');
  if (String(a.approved_by || '')) fail_('หัวข้อนี้อนุมัติไปแล้วโดย ' + a.approved_by);
  if (String(a.updated_by || '').toLowerCase() === user.email) {
    fail_('ผู้กรอกกับผู้อนุมัติต้องเป็นคนละคน');
  }

  var res = withLock_(function () {
    return updateRow_(TAB.ACTIONS, 'action_id', actionId, {
      approved_by: user.email, approved_at: nowStamp_(),
      updated_by: user.email, updated_at: nowStamp_()
    }, p.row_version);
  });

  logAudit_('APPROVE_ACTION', 'Recall_Actions', actionId, res.before, res.after, p.clientKey);
  return ok_({ action_id: actionId, approved_by: user.email });
}

/** สะท้อนผลการตัดสินใจ 4 ข้อขึ้นไปที่หัวเคส เพื่อให้รายงานอ่านได้ในแถวเดียว */
function syncCaseDecisionFlags_(caseNo, user) {
  var map = {};
  findRows_(TAB.ACTIONS, 'case_no', caseNo).forEach(function (a) {
    if (String(a.section_type) !== 'DECISION') return;
    map[String(a.section)] = { status: String(a.status), details: String(a.details || '') };
  });
  var f = function (k) { return map[k] ? map[k].details : ''; };
  withLock_(function () {
    updateRow_(TAB.CASES, 'case_no', caseNo, {
      recall_required: f('RECALL_REQUIRED'),
      field_action: f('FIELD_ACTION'),
      customer_notify_required: f('CUSTOMER_NOTIFY'),
      supplier_claim_required: f('SUPPLIER_CLAIM'),
      updated_by: user ? user.email : 'system', updated_at: nowStamp_()
    }, null);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   9. โฟลเดอร์หลักฐานของเคส
   ══════════════════════════════════════════════════════════════════════════ */
function createCaseFolder_(caseNo) {
  try {
    if (!CFG.DRIVE_ROOT_ID) return '';
    var root = DriveApp.getFolderById(CFG.DRIVE_ROOT_ID);
    var it = root.getFoldersByName(caseNo);
    if (it.hasNext()) return it.next().getId();
    return root.createFolder(caseNo).getId();
  } catch (e) {
    console.error('createCaseFolder_ failed', e && e.stack);
    return '';    // สร้างโฟลเดอร์ไม่ได้ต้องไม่ทำให้เปิดเคสไม่ได้
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   10. อ่านเคสสำหรับหน้าจอ
   ══════════════════════════════════════════════════════════════════════════ */
function getCase_(caseNo) {
  var cs = findRow_(TAB.CASES, 'case_no', caseNo);
  if (!cs) fail_('ไม่พบเคส ' + caseNo);
  var c = ctx_();

  var scope = findRows_(TAB.SCOPE, 'case_no', caseNo);
  var tracking = findRows_(TAB.TRACKING, 'case_no', caseNo);
  var actions = findRows_(TAB.ACTIONS, 'case_no', caseNo);
  var holds = findRows_(TAB.HOLDS, 'case_no', caseNo);

  var sectionTh = {};
  ACTION_SECTIONS.forEach(function (s) { sectionTh[s.key] = s.th; });

  return {
    header: {
      case_no: String(cs.case_no), status: String(cs.status), status_th: statusTh_(String(cs.status)),
      next_status: (CASE_STATUS[String(cs.status)] || { next: [] }).next,
      opened_at: String(cs.opened_at), opened_by: String(cs.opened_by),
      case_owner: String(cs.case_owner),
      source: String(cs.source), source_th: CASE_SOURCE[String(cs.source)] || String(cs.source),
      source_ref: String(cs.source_ref || ''),
      product_type: String(cs.product_type || ''), brand: String(cs.brand || ''),
      item_code: String(cs.item_code), model: String(cs.model || ''),
      problem: String(cs.problem || ''),
      risk_class: String(cs.risk_class),
      risk_th: (RISK_CLASS[String(cs.risk_class)] || {}).th || String(cs.risk_class),
      immediate_action: String(cs.immediate_action || ''),
      escalated: isTrue_(cs.escalated),
      qty_affected: parseQty_(cs.qty_affected), qty_in_stock: parseQty_(cs.qty_in_stock),
      qty_delivered: parseQty_(cs.qty_delivered), qty_unaccounted: parseQty_(cs.qty_unaccounted),
      qty_returned: parseQty_(cs.qty_returned), qty_replaced: parseQty_(cs.qty_replaced),
      qty_corrected: parseQty_(cs.qty_corrected),
      effectiveness_pct: parseQty_(cs.effectiveness_pct),
      closed_at: String(cs.closed_at || ''), closed_by: String(cs.closed_by || ''),
      closure_note: String(cs.closure_note || ''),
      drive_folder_id: String(cs.drive_folder_id || ''),
      row_version: parseQty_(cs.row_version)
    },
    scope: scope.map(function (s) {
      return { scope_id: String(s.scope_id), kind: String(s.kind),
               dist_number: String(s.dist_number), lot_key: String(s.lot_key),
               qty_affected: parseQty_(s.qty_affected), note: String(s.note || '') };
    }),
    tracking: tracking.map(function (t) {
      return {
        track_id: String(t.track_id), item_code: String(t.item_code), model: String(t.model || ''),
        dist_number: String(t.dist_number || ''), sn_display: String(t.sn_display || ''),
        location_type: String(t.location_type), party_code: String(t.party_code || ''),
        party_name: String(t.party_name || ''), project: String(t.project || ''),
        doc_type: String(t.doc_type || ''), doc_num: String(t.doc_num || ''),
        doc_date: String(t.doc_date || ''),
        qty_affected: parseQty_(t.qty_affected),
        qty_returned: parseQty_(t.qty_returned), qty_replaced: parseQty_(t.qty_replaced),
        qty_corrected: parseQty_(t.qty_corrected), qty_pending: parseQty_(t.qty_pending),
        required_action: String(t.required_action), required_action_th: REQUIRED_ACTION[String(t.required_action)] || '',
        status: String(t.status), status_th: TRACK_STATUS[String(t.status)] || String(t.status),
        contacted_at: String(t.contacted_at || ''), remark: String(t.remark || ''),
        row_version: parseQty_(t.row_version)
      };
    }),
    actions: actions.map(function (a) {
      return { action_id: String(a.action_id), section_type: String(a.section_type),
               section: String(a.section), section_th: sectionTh[String(a.section)] || String(a.section),
               seq: parseQty_(a.seq), details: String(a.details || ''),
               responsible: String(a.responsible || ''), target_date: String(a.target_date || ''),
               status: String(a.status), approved_by: String(a.approved_by || ''),
               approved_at: String(a.approved_at || ''), remark: String(a.remark || ''),
               row_version: parseQty_(a.row_version) };
    }).sort(function (x, y) { return x.seq - y.seq; }),
    holds: holds.map(function (h) {
      return { hold_id: String(h.hold_id), lot_key: String(h.lot_key),
               item_code: String(h.item_code), dist_number: String(h.dist_number || ''),
               whs_code: String(h.whs_code), whs_name: whsName_(h.whs_code),
               qty_hold: parseQty_(h.qty_hold), status: String(h.status),
               placed_at: String(h.placed_at), placed_by: String(h.placed_by),
               released_at: String(h.released_at || ''), released_by: String(h.released_by || ''),
               release_reason: String(h.release_reason || ''),
               row_version: parseQty_(h.row_version) };
    })
  };
}

function listCases_(filter) {
  var rows = readTable_(TAB.CASES, true).rows;
  var f = String(filter || 'ACTIVE').toUpperCase();
  return rows.filter(function (r) {
    var st = String(r.status).toUpperCase();
    if (f === 'ALL') return true;
    if (f === 'ACTIVE') return ['CLOSED', 'CANCELLED'].indexOf(st) === -1;
    if (f === 'CLOSED') return st === 'CLOSED';
    return st === f;
  }).map(function (r) {
    return {
      case_no: String(r.case_no), status: String(r.status), status_th: statusTh_(String(r.status)),
      opened_at: String(r.opened_at), case_owner: String(r.case_owner),
      item_code: String(r.item_code), model: String(r.model || ''), brand: String(r.brand || ''),
      risk_class: String(r.risk_class),
      risk_th: (RISK_CLASS[String(r.risk_class)] || {}).th || String(r.risk_class),
      problem: String(r.problem || '').slice(0, 160),
      qty_affected: parseQty_(r.qty_affected), qty_unaccounted: parseQty_(r.qty_unaccounted),
      effectiveness_pct: parseQty_(r.effectiveness_pct)
    };
  }).sort(function (a, b) {
    var rank = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };
    var ra = rank[a.risk_class] === undefined ? 9 : rank[a.risk_class];
    var rb = rank[b.risk_class] === undefined ? 9 : rank[b.risk_class];
    if (ra !== rb) return ra - rb;
    return String(b.opened_at).localeCompare(String(a.opened_at));
  });
}

/**
 * MGS Traceability & Recall — 02_Trace.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * เครื่องมือทวนสอบ — หัวใจของระบบทั้งหมด
 *
 * กระดูกสันหลังคือ SAP_Lot_Moves (มาจาก OITL/ITL1 + OBTL/OSRL ของ B1)
 * 1 แถว = การเคลื่อนไหวของ lot/SN 1 ครั้ง บนเอกสาร 1 บรรทัด
 *   direction = IN  -> ของเข้า (รับซื้อ / รับคืนจากลูกค้า / โอนเข้า)
 *   direction = OUT -> ของออก (ส่งลูกค้า / คืนผู้ขาย / ตัดออก / โอนออก)
 *   quantity  เป็นค่าบวกเสมอ ทิศทางดูจาก direction ไม่ใช่จากเครื่องหมาย
 *
 * คำถาม 3 ข้อที่ระบบต้องตอบได้ภายในไม่กี่วินาที
 *   1. ของล็อตนี้มาจากไหน  (backward)  -> ผู้ขาย · PO · ใบรับ · ล็อตของผู้ขาย
 *   2. ของล็อตนี้ไปไหนบ้าง (forward)   -> ลูกค้า · โครงการ · DO · ที่ยังค้างในคลัง
 *   3. จำนวนครบไหม        (reconcile)  -> รับ = ส่งออก + คงคลัง + คืน (+ ที่หายไป)
 */

/** คีย์ยืนหมายเลขล็อต/ซีเรียล — ItemCode + DistNumber ตามหลักของ B1 */
function lotKey_(itemCode, distNumber) {
  return String(itemCode || '').trim() + '|' + String(distNumber || '').trim();
}

/* ══════════════════════════════════════════════════════════════════════════
   1. โหลดข้อมูลอ้างอิงเข้าหน่วยความจำครั้งเดียวต่อคำขอ
   อ่านทีละเซลล์ในลูปคือสาเหตุอันดับหนึ่งที่สคริปต์ timeout
   ══════════════════════════════════════════════════════════════════════════ */
function ctx_() {
  if (ctx_._c) return ctx_._c;

  var items = {}, bp = {}, whs = {}, lots = {};
  readTableCached_(TAB.ITEMS).rows.forEach(function (r) { items[String(r.item_code)] = r; });
  readTableCached_(TAB.BP).rows.forEach(function (r) { bp[String(r.card_code)] = r; });
  readTableCached_(TAB.WHS).rows.forEach(function (r) { whs[String(r.whs_code)] = r; });
  readTableCached_(TAB.LOTS).rows.forEach(function (r) { lots[String(r.lot_key)] = r; });

  var moves = readTable_(TAB.MOVES, true).rows;
  var byLot = {};
  moves.forEach(function (m) {
    var k = String(m.lot_key || lotKey_(m.item_code, m.dist_number));
    m.lot_key = k;
    m.quantity = parseQty_(m.quantity, 'quantity');
    (byLot[k] = byLot[k] || []).push(m);
  });
  Object.keys(byLot).forEach(function (k) {
    byLot[k].sort(function (a, b) { return String(a.doc_date).localeCompare(String(b.doc_date)); });
  });

  var stockByLot = {};
  readTable_(TAB.STOCK, true).rows.forEach(function (s) {
    var k = String(s.lot_key || lotKey_(s.item_code, s.dist_number));
    (stockByLot[k] = stockByLot[k] || []).push({
      whs_code: String(s.whs_code || ''),
      quantity: parseQty_(s.quantity, 'stock qty'),
      status: String(s.status || '')
    });
  });

  // ใบรับสินค้า: ใช้เชื่อมกลับไปหา PO และเลขใบกำกับของผู้ขาย
  var grpoByDoc = {};
  readTableCached_(TAB.GRPO).rows.forEach(function (g) {
    grpoByDoc[String(g.doc_entry) + '#' + String(g.item_code)] = g;
  });

  var poByEntry = {};
  readTableCached_(TAB.PO).rows.forEach(function (p) {
    poByEntry[String(p.doc_entry) + '#' + String(p.line_num)] = p;
  });

  ctx_._c = { items: items, bp: bp, whs: whs, lots: lots,
              movesByLot: byLot, stockByLot: stockByLot,
              grpoByDoc: grpoByDoc, poByEntry: poByEntry, allMoves: moves };
  return ctx_._c;
}
ctx_._c = null;

/**
 * ตารางฝั่ง MGS ที่ buildLotTrace_ ต้องใช้ — อ่านครั้งเดียวต่อ 1 คำขอ
 * ถ้าไม่ทำแบบนี้ การออกรายงาน 200 ล็อตจะอ่านชีต 600 ครั้งแล้ว timeout
 */
function mgsCtx_() {
  if (mgsCtx_._c) return mgsCtx_._c;
  var notes = {}, holds = {}, scopes = {};
  readTable_(TAB.TRACE_NOTES, true).rows.forEach(function (r) { notes[String(r.lot_key)] = r; });
  readTable_(TAB.HOLDS, true).rows.forEach(function (r) {
    if (String(r.status).toUpperCase() !== 'HOLD') return;
    (holds[String(r.lot_key)] = holds[String(r.lot_key)] || []).push(r);
  });
  readTable_(TAB.SCOPE, true).rows.forEach(function (r) {
    (scopes[String(r.lot_key)] = scopes[String(r.lot_key)] || []).push(r);
  });
  mgsCtx_._c = { notes: notes, holds: holds, scopes: scopes };
  return mgsCtx_._c;
}
mgsCtx_._c = null;

function resetCtx_() { ctx_._c = null; mgsCtx_._c = null; }

/** ล้างเฉพาะ cache ที่เกี่ยวข้องกับแท็บที่เพิ่งถูกเขียน */
function invalidateCtx_(tabName) {
  if (SAP_TABS.indexOf(tabName) !== -1) ctx_._c = null;
  if ([TAB.TRACE_NOTES, TAB.HOLDS, TAB.SCOPE].indexOf(tabName) !== -1) mgsCtx_._c = null;
}

function objInfo_(objType) {
  return OBJ[String(objType)] || { name: 'เอกสารอื่น (' + objType + ')', dir: 'NONE', doc: 'OTHER' };
}

function whsName_(code) {
  var c = ctx_(); var w = c.whs[String(code)];
  return w ? String(w.whs_name || code) : String(code || '');
}

function whsIsCustomerSite_(code) {
  var c = ctx_(); var w = c.whs[String(code)];
  return w ? String(w.location_type || '').toUpperCase() === 'CUSTOMER' : false;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. ตามรอยย้อนหลัง — ของล็อตนี้มาจากไหน
   ══════════════════════════════════════════════════════════════════════════ */
function traceBackward_(lotKey) {
  var c = ctx_();
  var moves = c.movesByLot[lotKey] || [];
  var out = [];

  moves.forEach(function (m) {
    if (String(m.direction).toUpperCase() !== 'IN') return;
    var info = objInfo_(m.obj_type);
    var rec = {
      obj_type: String(m.obj_type),
      doc_type: info.doc,
      doc_type_th: info.name,
      doc_num: String(m.doc_num || ''),
      doc_date: String(m.doc_date || ''),
      qty: m.quantity,
      whs_code: String(m.whs_code || ''),
      whs_name: whsName_(m.whs_code),
      party_code: String(m.card_code || ''),
      party_name: String(m.card_name || ''),
      supplier_po_no: '',
      supplier_invoice_no: '',
      project: String(m.project || '')
    };
    // ต่อสายกลับไปหา PO และใบกำกับผู้ขายผ่านใบรับสินค้า
    if (info.doc === 'GRPO') {
      var g = c.grpoByDoc[String(m.doc_entry) + '#' + String(m.item_code)];
      if (g) {
        rec.supplier_invoice_no = String(g.num_at_card || '');
        rec.supplier_po_no = String(g.base_doc_num || '');
        if (!rec.supplier_po_no && g.base_entry !== '' && g.base_entry !== null) {
          var p = c.poByEntry[String(g.base_entry) + '#' + String(g.base_line)];
          if (p) rec.supplier_po_no = String(p.doc_num || '');
        }
        if (!rec.project) rec.project = String(g.project || '');
      }
    }
    out.push(rec);
  });

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   3. ตามรอยไปข้างหน้า — ของล็อตนี้ไปอยู่ที่ไหนแล้วบ้าง
   ══════════════════════════════════════════════════════════════════════════ */
function traceForward_(lotKey) {
  var c = ctx_();
  var moves = c.movesByLot[lotKey] || [];
  var shipments = [];

  moves.forEach(function (m) {
    if (String(m.direction).toUpperCase() !== 'OUT') return;
    var info = objInfo_(m.obj_type);
    // ใบกำกับที่อ้างใบส่งของอยู่แล้วจะทำให้นับซ้ำ — ยึดใบส่งของเป็นหลัก
    // (ตัวส่งข้อมูลฝั่งออฟฟิศกรองใบกำกับที่มี base เป็นใบส่งของออกให้แล้ว)
    shipments.push({
      obj_type: String(m.obj_type),
      doc_type: info.doc,
      doc_type_th: info.name,
      doc_num: String(m.doc_num || ''),
      doc_date: String(m.doc_date || ''),
      qty: m.quantity,
      whs_code: String(m.whs_code || ''),
      whs_name: whsName_(m.whs_code),
      party_code: String(m.card_code || ''),
      party_name: String(m.card_name || ''),
      project: String(m.project || ''),
      to_customer: OUTBOUND_TO_CUSTOMER.indexOf(String(m.obj_type)) !== -1
    });
  });

  var onHand = (c.stockByLot[lotKey] || []).map(function (s) {
    return {
      whs_code: s.whs_code,
      whs_name: whsName_(s.whs_code),
      qty: s.quantity,
      status: s.status,
      is_customer_site: whsIsCustomerSite_(s.whs_code)
    };
  }).filter(function (s) { return s.qty !== 0; });

  return { shipments: shipments, on_hand: onHand };
}

/* ══════════════════════════════════════════════════════════════════════════
   4. กระทบยอด — ตัวเลขที่ FM-QC-TR-02 ใช้ตัดสิน PASS/FAIL
   ══════════════════════════════════════════════════════════════════════════ */
function reconcile_(lotKey) {
  var c = ctx_();
  var moves = c.movesByLot[lotKey] || [];
  var received = 0, returnedIn = 0, shippedOut = 0, returnedToSupplier = 0, otherOut = 0;

  moves.forEach(function (m) {
    var t = String(m.obj_type), d = String(m.direction).toUpperCase(), q = m.quantity;
    if (t === '67') return;                              // โอนย้ายคลังไม่เปลี่ยนยอดรวม
    if (d === 'IN') {
      if (t === '16' || t === '14') returnedIn += q;      // ลูกค้าคืนกลับมา
      else received += q;                                 // รับซื้อ / รับเข้าอื่น
    } else if (d === 'OUT') {
      if (OUTBOUND_TO_CUSTOMER.indexOf(t) !== -1) shippedOut += q;
      else if (t === '21' || t === '19') returnedToSupplier += q;
      else otherOut += q;                                 // ตัดออก/ทำลาย
    }
  });

  var onHand = 0;
  (c.stockByLot[lotKey] || []).forEach(function (s) { onHand += s.quantity; });

  // รับเข้า + รับคืน  =  ส่งออก + คืนผู้ขาย + ตัดออก + คงคลัง  (+ ส่วนต่างที่อธิบายไม่ได้)
  var accounted = shippedOut + returnedToSupplier + otherOut + onHand + returnedIn * 0;
  var unaccounted = round3_(received + returnedIn - shippedOut - returnedToSupplier - otherOut - onHand);

  var totalIn = received + returnedIn;
  var pct = totalIn > 0 ? round3_((totalIn - Math.abs(unaccounted)) / totalIn) : (accounted === 0 ? 1 : 0);

  return {
    received: round3_(received),
    returned_in: round3_(returnedIn),
    shipped_out: round3_(shippedOut),
    returned_to_supplier: round3_(returnedToSupplier),
    other_out: round3_(otherOut),
    on_hand: round3_(onHand),
    unaccounted: unaccounted,
    completion_pct: pct,
    pass: Math.abs(unaccounted) <= CFG.RECONCILE_TOLERANCE_QTY
  };
}

function round3_(n) { return Math.round(Number(n) * 1000) / 1000; }

/* ══════════════════════════════════════════════════════════════════════════
   5. ภาพรวมของ 1 ล็อต/ซีเรียล — สิ่งที่หน้าจอ "ทวนสอบ" แสดง
   ══════════════════════════════════════════════════════════════════════════ */
function buildLotTrace_(lotKey) {
  var c = ctx_();
  var lot = c.lots[lotKey];
  if (!lot) {
    // ยังไม่มีใน master แต่มีการเคลื่อนไหว = ข้อมูล sync ไม่ครบ ให้เห็นแทนที่จะเงียบ
    if (!c.movesByLot[lotKey]) fail_('ไม่พบล็อต/ซีเรียล: ' + lotKey.split('|').join(' / '));
    var first = c.movesByLot[lotKey][0];
    lot = { lot_key: lotKey, item_code: first.item_code, dist_number: first.dist_number,
            kind: first.kind, supplier_lot: '', in_date: '', exp_date: '',
            notes: 'ไม่พบใน SAP_Lots — ข้อมูล sync อาจไม่ครบ' };
  }
  var item = c.items[String(lot.item_code)] || {};
  var back = traceBackward_(lotKey);
  var fwd = traceForward_(lotKey);
  var rec = reconcile_(lotKey);

  var m = mgsCtx_();
  var note = m.notes[lotKey] || null;
  var holds = m.holds[lotKey] || [];
  var scopes = m.scopes[lotKey] || [];

  return {
    lot: {
      lot_key: lotKey,
      item_code: String(lot.item_code || ''),
      item_name: String(item.item_name || lot.item_code || ''),
      brand: String(item.brand || ''),
      product_type: String(item.product_type || ''),
      model: String(item.item_name || ''),
      uom: String(item.uom || ''),
      dist_number: String(lot.dist_number || ''),
      kind: String(lot.kind || item.mng_method || ''),
      supplier_lot: String(lot.supplier_lot || ''),
      mnf_serial: String(lot.mnf_serial || ''),
      in_date: String(lot.in_date || ''),
      exp_date: String(lot.exp_date || ''),
      notes: String(lot.notes || '')
    },
    backward: back,
    forward: fwd,
    reconcile: rec,
    mgs_note: note ? {
      mgs_receiving_lot: String(note.mgs_receiving_lot || ''),
      qc_status: String(note.qc_status || ''),
      note: String(note.note || ''),
      updated_by: String(note.updated_by || ''),
      updated_at: String(note.updated_at || '')
    } : null,
    holds: holds.map(function (h) {
      return { hold_id: String(h.hold_id), case_no: String(h.case_no),
               whs_code: String(h.whs_code), whs_name: whsName_(h.whs_code),
               qty_hold: parseQty_(h.qty_hold), placed_at: String(h.placed_at),
               placed_by: String(h.placed_by) };
    }),
    recall_cases: dedupe_(scopes.map(function (s) { return String(s.case_no); }))
  };
}

function dedupe_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   6. ค้นหา — คนหน้างานพิมพ์อะไรมาก็ต้องเจอ
   รองรับ: ซีเรียล · เลขล็อต · ล็อตของผู้ขาย · รหัส/ชื่อสินค้า
           เลข PO · เลขใบรับ · เลข DO · เลขใบกำกับ · ชื่อลูกค้า · ชื่อโครงการ
   ══════════════════════════════════════════════════════════════════════════ */
function searchLots_(q, limit) {
  var needle = normalize_(q);
  if (needle.length < 2) fail_('พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา');
  limit = limit || 200;

  var c = ctx_();
  var hits = {};   // lot_key -> เหตุผลที่แมตช์

  function hit(k, why) { if (!hits[k]) hits[k] = why; }

  // 1) แมตช์จาก master ของล็อต
  Object.keys(c.lots).forEach(function (k) {
    var l = c.lots[k];
    var item = c.items[String(l.item_code)] || {};
    if (normalize_(l.dist_number).indexOf(needle) !== -1) return hit(k, 'เลขล็อต/ซีเรียล');
    if (normalize_(l.supplier_lot).indexOf(needle) !== -1) return hit(k, 'ล็อตของผู้ขาย');
    if (normalize_(l.mnf_serial).indexOf(needle) !== -1) return hit(k, 'ซีเรียลผู้ผลิต');
    if (normalize_(l.item_code).indexOf(needle) !== -1) return hit(k, 'รหัสสินค้า');
    if (normalize_(item.item_name).indexOf(needle) !== -1) return hit(k, 'ชื่อสินค้า');
  });

  // 2) แมตช์จากเอกสารที่ล็อตนั้นเดินผ่าน
  c.allMoves.forEach(function (m) {
    var k = String(m.lot_key);
    if (hits[k]) return;
    if (normalize_(m.doc_num).indexOf(needle) !== -1) return hit(k, 'เลขที่เอกสาร ' + objInfo_(m.obj_type).name);
    if (normalize_(m.card_name).indexOf(needle) !== -1) return hit(k, 'ชื่อคู่ค้า');
    if (normalize_(m.card_code).indexOf(needle) !== -1) return hit(k, 'รหัสคู่ค้า');
    if (normalize_(m.project).indexOf(needle) !== -1) return hit(k, 'โครงการ');
  });

  // 3) แมตช์เลข PO ของผู้ขาย ผ่านใบรับสินค้า
  readTableCached_(TAB.GRPO).rows.forEach(function (g) {
    if (normalize_(g.base_doc_num).indexOf(needle) === -1 &&
        normalize_(g.num_at_card).indexOf(needle) === -1) return;
    c.allMoves.forEach(function (m) {
      if (String(m.obj_type) === '20' && String(m.doc_entry) === String(g.doc_entry) &&
          String(m.item_code) === String(g.item_code)) {
        hit(String(m.lot_key), 'เลข PO / ใบกำกับผู้ขาย');
      }
    });
  });

  var keys = Object.keys(hits).slice(0, limit);
  return {
    total: Object.keys(hits).length,
    shown: keys.length,
    results: keys.map(function (k) {
      var l = c.lots[k] || {};
      var item = c.items[String(l.item_code)] || {};
      var r = reconcile_(k);
      return {
        lot_key: k,
        item_code: String(l.item_code || k.split('|')[0]),
        item_name: String(item.item_name || ''),
        brand: String(item.brand || ''),
        dist_number: String(l.dist_number || k.split('|')[1]),
        kind: String(l.kind || ''),
        supplier_lot: String(l.supplier_lot || ''),
        received: r.received,
        shipped_out: r.shipped_out,
        on_hand: r.on_hand,
        unaccounted: r.unaccounted,
        matched_on: hits[k]
      };
    })
  };
}

/** ตัดช่องว่างและตัวคั่นออกก่อนเทียบ — คนพิมพ์ SN มีขีดบ้างไม่มีบ้าง */
function normalize_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/ /g, ' ').trim().toUpperCase().replace(/[\s\-_.]/g, '');
}

/* ══════════════════════════════════════════════════════════════════════════
   7. ทวนสอบจากฝั่งเอกสาร — ลูกค้าโทรมาพร้อมเลข DO
   "ใบส่งของใบนี้มีของล็อตไหนบ้าง" คือคำถามแรกเสมอเวลามีปัญหาหน้างาน
   ══════════════════════════════════════════════════════════════════════════ */
function traceFromDocument_(docNum) {
  var needle = normalize_(docNum);
  if (needle.length < 2) fail_('กรุณาระบุเลขที่เอกสาร');
  var c = ctx_();
  var lines = c.allMoves.filter(function (m) { return normalize_(m.doc_num) === needle; });
  if (!lines.length) fail_('ไม่พบเอกสารเลขที่ ' + docNum + ' ในข้อมูลที่ sync มาจาก SAP');

  var head = lines[0];
  var info = objInfo_(head.obj_type);
  return {
    doc: {
      doc_num: String(head.doc_num),
      doc_type: info.doc,
      doc_type_th: info.name,
      doc_date: String(head.doc_date || ''),
      party_code: String(head.card_code || ''),
      party_name: String(head.card_name || ''),
      project: String(head.project || ''),
      direction: String(head.direction || '')
    },
    lines: lines.map(function (m) {
      var item = c.items[String(m.item_code)] || {};
      return {
        lot_key: String(m.lot_key),
        item_code: String(m.item_code),
        item_name: String(item.item_name || ''),
        dist_number: String(m.dist_number || ''),
        kind: String(m.kind || ''),
        qty: m.quantity,
        whs_code: String(m.whs_code || ''),
        whs_name: whsName_(m.whs_code)
      };
    })
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   8. หาปลายทางทั้งหมดของหลายล็อตพร้อมกัน — ใช้ตอนเปิดเคสเรียกคืน
   รวมยอดต่อ (ปลายทาง + โครงการ + เอกสาร + สินค้า) ไม่ใช่ต่อซีเรียล
   เพราะการเรียกคืน 20 เครื่องจากลูกค้า 2 รายคือการโทร 2 สาย ไม่ใช่ 20 สาย
   — ตรงกับฟอร์ม FM-QC-RC-02 ที่เขียน "SG50R-A006–A012" ในแถวเดียว

   @param {Array<string>} lotKeys
   @param {Object<string,number>} shareByLot สัดส่วนที่กระทบของแต่ละล็อต (0–1)
          ล็อต 500 ชิ้นที่กระทบ 100 ชิ้น = 0.2 ไม่เรียกคืนทั้งล็อต
   ══════════════════════════════════════════════════════════════════════════ */
function destinationsForLots_(lotKeys, shareByLot) {
  var c = ctx_();
  var bucket = {};
  shareByLot = shareByLot || {};

  function slot(id, seed) {
    if (!bucket[id]) {
      seed.qty = 0;
      seed.lot_keys = [];
      seed.dist_numbers = [];
      bucket[id] = seed;
    }
    return bucket[id];
  }

  lotKeys.forEach(function (k) {
    var share = (shareByLot[k] === undefined) ? 1 : shareByLot[k];
    var parts = k.split('|');

    // ของที่ส่งออกไปหาลูกค้าแล้ว
    (c.movesByLot[k] || []).forEach(function (m) {
      if (String(m.direction).toUpperCase() !== 'OUT') return;
      if (OUTBOUND_TO_CUSTOMER.indexOf(String(m.obj_type)) === -1) return;
      var info = objInfo_(m.obj_type);
      var id = ['CUSTOMER', String(m.card_code), String(m.project || ''),
                String(m.doc_num), String(m.item_code)].join('~');
      var b = slot(id, {
        location_type: 'CUSTOMER',
        party_code: String(m.card_code || ''),
        party_name: String(m.card_name || ''),
        project: String(m.project || ''),
        doc_type: info.doc,
        doc_num: String(m.doc_num || ''),
        doc_date: String(m.doc_date || ''),
        item_code: String(m.item_code)
      });
      b.qty = round3_(b.qty + m.quantity * share);
      b.lot_keys.push(k);
      b.dist_numbers.push(String(m.dist_number || parts[1] || ''));
    });

    // ของที่ยังอยู่ในคลัง
    (c.stockByLot[k] || []).forEach(function (s) {
      if (!s.quantity) return;
      var isCust = whsIsCustomerSite_(s.whs_code);
      var id = ['STOCK', s.whs_code, '', '', parts[0]].join('~');
      var b = slot(id, {
        location_type: isCust ? 'CUSTOMER_SITE' : 'WAREHOUSE',
        party_code: s.whs_code,
        party_name: whsName_(s.whs_code),
        project: '',
        doc_type: 'STOCK',
        doc_num: '',
        doc_date: '',
        item_code: parts[0]
      });
      b.qty = round3_(b.qty + s.quantity * share);
      b.lot_keys.push(k);
      b.dist_numbers.push(parts[1] || '');
    });
  });

  return Object.keys(bucket).map(function (id) {
    var b = bucket[id];
    b.bucket_id = id;
    b.dist_numbers = dedupe_(b.dist_numbers);
    b.lot_keys = dedupe_(b.lot_keys);
    b.sn_display = summarizeSerials_(b.dist_numbers);
    return b;
  }).filter(function (b) { return b.qty > 0; })
    .sort(function (a, b) {
      // ของในคลังขึ้นก่อน — กักได้ทันที ไม่ต้องรอใคร
      if (a.location_type !== b.location_type) return a.location_type === 'WAREHOUSE' ? -1 : 1;
      return b.qty - a.qty;
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   9. ขยายช่วงซีเรียล — "SG50R-A001 – SG50R-A020" ที่คนเขียนในฟอร์มกระดาษ
   คืนเฉพาะซีเรียลที่ "มีอยู่จริงใน SAP" เท่านั้น ไม่เดาเลขที่ไม่มีตัวตน
   ══════════════════════════════════════════════════════════════════════════ */
function expandSerialRange_(itemCode, snFrom, snTo) {
  var c = ctx_();
  var from = String(snFrom || '').trim(), to = String(snTo || '').trim();
  if (!from) fail_('กรุณาระบุซีเรียลเริ่มต้น');
  if (!to) to = from;

  var all = [];
  Object.keys(c.lots).forEach(function (k) {
    var l = c.lots[k];
    if (String(l.item_code) !== String(itemCode)) return;
    all.push(String(l.dist_number));
  });
  if (!all.length) fail_('ไม่พบซีเรียลของสินค้า ' + itemCode + ' ในข้อมูลจาก SAP');

  all.sort(function (a, b) { return a.localeCompare(b, 'en', { numeric: true }); });

  var lo = from.localeCompare(to, 'en', { numeric: true }) <= 0 ? from : to;
  var hi = lo === from ? to : from;

  var picked = all.filter(function (sn) {
    return sn.localeCompare(lo, 'en', { numeric: true }) >= 0 &&
           sn.localeCompare(hi, 'en', { numeric: true }) <= 0;
  });
  if (!picked.length) {
    fail_('ไม่พบซีเรียลในช่วง ' + lo + ' ถึง ' + hi + ' — ตรวจสอบว่าพิมพ์ตรงกับที่บันทึกใน SAP');
  }
  return picked;
}

/** ย่อรายการซีเรียลให้อ่านง่ายในรายงาน: A001–A005 (5 หน่วย) */
function summarizeSerials_(serials) {
  if (!serials || !serials.length) return '';
  if (serials.length === 1) return serials[0];
  var s = serials.slice().sort(function (a, b) { return a.localeCompare(b, 'en', { numeric: true }); });
  return s[0] + '–' + s[s.length - 1] + ' (' + s.length + ' หน่วย)';
}

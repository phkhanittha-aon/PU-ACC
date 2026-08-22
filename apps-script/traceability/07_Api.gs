/**
 * MGS Traceability & Recall — 07_Api.gs
 * ─────────────────────────────────────────────────────────────────────────────
 * ฟังก์ชันที่หน้าเว็บเรียกผ่าน google.script.run เท่านั้น
 *
 * กติกาของทุกฟังก์ชันในไฟล์นี้
 *   · คืน {ok:true,data} หรือ {ok:false,error} เสมอ — ไม่มี exception หลุดถึง client
 *   · เช็คสิทธิ์จาก session ฝั่งเซิร์ฟเวอร์เอง ไม่เชื่อ role ที่ client ส่งมา
 *   · ฟังก์ชันที่เขียนข้อมูลต้องรับ clientKey เพื่อกันบันทึกซ้ำ
 */

/* ══════════════════════════════════════════════════════════════════════════
   หน้าเว็บ
   ══════════════════════════════════════════════════════════════════════════ */
var SAFE_PAGES = { index: 'index' };

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
  var file = SAFE_PAGES[page] || 'index';        // whitelist — ห้ามเอา parameter ไปต่อเป็นชื่อไฟล์
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle('MGS ทวนสอบสินค้าและเรียกคืน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ══════════════════════════════════════════════════════════════════════════
   1. เปิดแอป
   ══════════════════════════════════════════════════════════════════════════ */
function apiBootstrap() {
  return guard_('apiBootstrap', function () {
    var u = me_();
    var health = syncHealth_();
    var c = ctx_();

    var items = Object.keys(c.items).map(function (k) {
      var i = c.items[k];
      return { item_code: k, item_name: String(i.item_name || ''), brand: String(i.brand || ''),
               product_type: String(i.product_type || ''), mng_method: String(i.mng_method || ''),
               uom: String(i.uom || '') };
    }).filter(function (i) { return i.mng_method !== MNG.NONE; })
      .sort(function (a, b) { return a.item_code.localeCompare(b.item_code, 'th'); });

    return ok_({
      app_version: APP_VERSION,
      user: { email: u.email, name: u.name, dept: u.dept, role: u.role,
              role_th: ROLES[u.role] || u.role, unlisted: !!u.unlisted },
      perm: permsFor_(u.role),
      sync: health,
      items: items.slice(0, 2000),
      enums: {
        case_status: CASE_STATUS, track_status: TRACK_STATUS,
        required_action: REQUIRED_ACTION, risk_class: RISK_CLASS,
        case_source: CASE_SOURCE, action_sections: ACTION_SECTIONS
      }
    });
  });
}

/** บอกหน้าจอว่าปุ่มไหนควรแสดง — ยังต้องเช็คซ้ำที่เซิร์ฟเวอร์อยู่ดี */
function permsFor_(role) {
  var out = {};
  Object.keys(PERM).forEach(function (fn) { out[fn] = PERM[fn].indexOf(role) !== -1; });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. ทวนสอบ
   ══════════════════════════════════════════════════════════════════════════ */
function apiSearch(q) {
  return guard_('apiSearch', function () {
    me_();
    return ok_(searchLots_(str_(q, 100), 200));
  });
}

function apiTraceLot(lotKey) {
  return guard_('apiTraceLot', function () {
    me_();
    return ok_(buildLotTrace_(String(lotKey)));
  });
}

function apiTraceDocument(docNum) {
  return guard_('apiTraceDocument', function () {
    me_();
    return ok_(traceFromDocument_(str_(docNum, 60)));
  });
}

/** ตัวอย่างช่วงซีเรียลที่จะถูกดึงเข้าเคส — ให้ผู้ใช้เห็นก่อนกดเปิดเคสจริง */
function apiPreviewScope(itemCode, kind, distNumber, snFrom, snTo) {
  return guard_('apiPreviewScope', function () {
    me_();
    var code = str_(itemCode, 60);
    if (String(kind).toUpperCase() === MNG.SERIAL) {
      var serials = expandSerialRange_(code, snFrom, snTo);
      var total = 0, inStock = 0, delivered = 0;
      serials.forEach(function (sn) {
        var r = reconcile_(lotKey_(code, sn));
        total += 1; inStock += r.on_hand; delivered += r.shipped_out;
      });
      return ok_({ kind: MNG.SERIAL, count: serials.length, sample: serials.slice(0, 50),
                   display: summarizeSerials_(serials),
                   qty_affected: total, qty_in_stock: round3_(inStock), qty_delivered: round3_(delivered) });
    }
    var k = lotKey_(code, str_(distNumber, 60));
    var rec = reconcile_(k);
    return ok_({ kind: MNG.BATCH, count: 1, sample: [str_(distNumber, 60)],
                 display: str_(distNumber, 60),
                 qty_affected: rec.received, qty_in_stock: rec.on_hand, qty_delivered: rec.shipped_out,
                 unaccounted: rec.unaccounted });
  });
}

function apiSaveTraceNote(p) {
  return guard_('apiSaveTraceNote', function () {
    var u = requirePerm_('saveTraceNote');
    p = p || {};
    var lotKey = str_(p.lot_key, 140);
    if (!lotKey || lotKey.indexOf('|') === -1) fail_('ไม่พบล็อตที่จะบันทึกหมายเหตุ');
    var parts = lotKey.split('|');
    var now = nowStamp_();

    return idempotent_(p.clientKey, function () {
      return withLock_(function () {
        var existing = findRow_(TAB.TRACE_NOTES, 'lot_key', lotKey);
        if (existing) {
          var r = updateRow_(TAB.TRACE_NOTES, 'lot_key', lotKey, {
            mgs_receiving_lot: str_(p.mgs_receiving_lot, 60),
            qc_status: str_(p.qc_status, 40),
            note: str_(p.note, 2000),
            evidence_file_ids: str_(p.evidence_file_ids, 1000),
            updated_by: u.email, updated_at: now
          }, null);
          logAudit_('SAVE_TRACE_NOTE', 'Trace_Notes', lotKey, r.before, r.after, p.clientKey);
        } else {
          appendRows_(TAB.TRACE_NOTES, [{
            note_id: uuid_(), lot_key: lotKey, item_code: parts[0], dist_number: parts[1] || '',
            mgs_receiving_lot: str_(p.mgs_receiving_lot, 60), qc_status: str_(p.qc_status, 40),
            note: str_(p.note, 2000), evidence_file_ids: str_(p.evidence_file_ids, 1000),
            created_by: u.email, created_at: now, updated_by: u.email, updated_at: now
          }]);
          logAudit_('SAVE_TRACE_NOTE', 'Trace_Notes', lotKey, null, { note: str_(p.note, 200) }, p.clientKey);
        }
        return ok_({ lot_key: lotKey });
      });
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3. เคสเรียกคืน
   ══════════════════════════════════════════════════════════════════════════ */
function apiListCases(filter) {
  return guard_('apiListCases', function () {
    me_();
    return ok_(listCases_(filter));
  });
}

function apiGetCase(caseNo) {
  return guard_('apiGetCase', function () {
    me_();
    return ok_(getCase_(str_(caseNo, 40)));
  });
}

function apiOpenCase(p) {
  return guard_('apiOpenCase', function () {
    var u = requirePerm_('openCase');
    p = p || {};
    return idempotent_(p.clientKey, function () {
      return withLock_(function () { return openCase_(p, u); });
    });
  });
}

function apiRebuildTracking(p) {
  return guard_('apiRebuildTracking', function () {
    var u = requirePerm_('buildTracking');
    return idempotent_((p || {}).clientKey, function () {
      return withLock_(function () { return rebuildTracking_(p || {}, u); });
    });
  });
}

function apiUpdateTracking(p) {
  return guard_('apiUpdateTracking', function () {
    var u = requirePerm_('updateTracking');
    return idempotent_((p || {}).clientKey, function () { return updateTracking_(p || {}, u); });
  });
}

function apiUpdateAction(p) {
  return guard_('apiUpdateAction', function () {
    var u = requirePerm_('updateAction');
    return idempotent_((p || {}).clientKey, function () { return updateAction_(p || {}, u); });
  });
}

function apiApproveAction(p) {
  return guard_('apiApproveAction', function () {
    var u = requirePerm_('approveAction');
    return idempotent_((p || {}).clientKey, function () { return approveAction_(p || {}, u); });
  });
}

function apiAdvanceCase(p) {
  return guard_('apiAdvanceCase', function () {
    var u = requirePerm_('advanceCaseStatus');
    return idempotent_((p || {}).clientKey, function () { return advanceCase_(p || {}, u); });
  });
}

function apiCloseCase(p) {
  return guard_('apiCloseCase', function () {
    var u = requirePerm_('closeCase');
    return idempotent_((p || {}).clientKey, function () { return closeCase_(p || {}, u); });
  });
}

function apiCancelCase(p) {
  return guard_('apiCancelCase', function () {
    var u = requirePerm_('cancelCase');
    return idempotent_((p || {}).clientKey, function () { return cancelCase_(p || {}, u); });
  });
}

function apiReleaseHold(p) {
  return guard_('apiReleaseHold', function () {
    var u = requirePerm_('releaseHold');
    return idempotent_((p || {}).clientKey, function () {
      return withLock_(function () { return releaseHold_(p || {}, u); });
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   4. ทดสอบทวนสอบย้อนกลับ
   ══════════════════════════════════════════════════════════════════════════ */
function apiListMockRecalls() {
  return guard_('apiListMockRecalls', function () { me_(); return ok_(listMockRecalls_()); });
}

function apiGetMockRecall(testNo) {
  return guard_('apiGetMockRecall', function () { me_(); return ok_(getMockRecall_(str_(testNo, 40))); });
}

function apiStartMockRecall(p) {
  return guard_('apiStartMockRecall', function () {
    var u = requirePerm_('startMockRecall');
    return idempotent_((p || {}).clientKey, function () {
      return withLock_(function () { return startMockRecall_(p || {}, u); });
    });
  });
}

function apiUpdateMockLine(p) {
  return guard_('apiUpdateMockLine', function () {
    var u = requirePerm_('startMockRecall');
    return idempotent_((p || {}).clientKey, function () { return updateMockLine_(p || {}, u); });
  });
}

function apiFinishMockRecall(p) {
  return guard_('apiFinishMockRecall', function () {
    var u = requirePerm_('finishMockRecall');
    return idempotent_((p || {}).clientKey, function () { return finishMockRecall_(p || {}, u); });
  });
}

function apiReviewMockRecall(p) {
  return guard_('apiReviewMockRecall', function () {
    var u = requirePerm_('reviewMockRecall');
    return idempotent_((p || {}).clientKey, function () { return reviewMockRecall_(p || {}, u); });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   5. หน้ารวม — สิ่งที่ต้องเห็นก่อนเลื่อนจอ
   ══════════════════════════════════════════════════════════════════════════ */
function apiDashboard() {
  return guard_('apiDashboard', function () {
    var u = me_();
    var cases = listCases_('ACTIVE');

    // อ่านตารางติดตามครั้งเดียวแล้วจัดกลุ่ม — อ่านต่อเคสจะทำให้ 30 เคสอ่านชีต 30 รอบ
    var trackByCase = {};
    readTable_(TAB.TRACKING, true).rows.forEach(function (t) {
      (trackByCase[String(t.case_no)] = trackByCase[String(t.case_no)] || []).push(t);
    });

    var myTasks = [];
    cases.forEach(function (cs) {
      (trackByCase[cs.case_no] || []).forEach(function (t) {
        var st = String(t.status).toUpperCase();
        if (st === 'COMPLETED' || st === 'NOT_REACHED') return;
        myTasks.push({
          case_no: cs.case_no, track_id: String(t.track_id),
          risk_class: cs.risk_class,
          party_name: String(t.party_name || ''), project: String(t.project || ''),
          location_type: String(t.location_type),
          qty_pending: parseQty_(t.qty_pending),
          required_action: String(t.required_action),
          required_action_th: REQUIRED_ACTION[String(t.required_action)] || '',
          status: st, status_th: TRACK_STATUS[st] || st,
          doc_num: String(t.doc_num || '')
        });
      });
    });
    myTasks.sort(function (a, b) {
      var rank = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };
      var ra = rank[a.risk_class] === undefined ? 9 : rank[a.risk_class];
      var rb = rank[b.risk_class] === undefined ? 9 : rank[b.risk_class];
      if (ra !== rb) return ra - rb;
      return b.qty_pending - a.qty_pending;
    });

    var heldQty = 0, heldRows = 0;
    readTable_(TAB.HOLDS, true).rows.forEach(function (h) {
      if (String(h.status).toUpperCase() !== 'HOLD') return;
      heldRows++; heldQty += parseQty_(h.qty_hold);
    });

    var mocks = listMockRecalls_();
    var lastMock = mocks.filter(function (m) { return m.result !== 'IN_PROGRESS'; })[0] || null;
    var openMock = mocks.filter(function (m) { return m.result === 'IN_PROGRESS'; });

    return ok_({
      user_role: u.role,
      sync: syncHealth_(),
      counts: {
        cases_active: cases.length,
        cases_critical: cases.filter(function (c) { return c.risk_class === 'CRITICAL'; }).length,
        tasks_pending: myTasks.length,
        qty_unaccounted: round3_(cases.reduce(function (s, c) { return s + c.qty_unaccounted; }, 0)),
        held_rows: heldRows, held_qty: round3_(heldQty)
      },
      cases: cases.slice(0, 50),
      tasks: myTasks.slice(0, 100),
      last_mock: lastMock,
      open_mocks: openMock
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   6. แนบหลักฐาน
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * @param {{case_no:string, name:string, mime:string, b64:string}} p
 * ไฟล์ถูกบีบขนาดฝั่ง client แล้ว — ที่นี่กันไว้อีกชั้นไม่ให้เกิน 5MB
 */
function apiUploadEvidence(p) {
  return guard_('apiUploadEvidence', function () {
    var u = me_();
    p = p || {};
    if (!p.b64) fail_('ไม่พบไฟล์');
    if (String(p.b64).length > 7000000) fail_('ไฟล์ใหญ่เกินไป — กรุณาถ่ายใหม่หรือย่อขนาดก่อน (ไม่เกิน 5 MB)');
    var mime = String(p.mime || 'application/octet-stream');
    if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(mime)) {
      fail_('รองรับเฉพาะรูปภาพและไฟล์ PDF');
    }
    if (!CFG.DRIVE_ROOT_ID) fail_('ยังไม่ได้ตั้งค่าโฟลเดอร์เก็บหลักฐาน');

    var caseNo = str_(p.case_no, 40);
    var folderId = '';
    if (caseNo) {
      var cs = findRow_(TAB.CASES, 'case_no', caseNo);
      if (!cs) fail_('ไม่พบเคส ' + caseNo);
      folderId = String(cs.drive_folder_id || '') || createCaseFolder_(caseNo);
    }
    var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getFolderById(CFG.DRIVE_ROOT_ID);

    var safeName = str_(p.name, 120).replace(/[\\\/:*?"<>|]/g, '_') || 'evidence';
    var stamped = Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd-HHmmss') + '_' + safeName;
    var blob = Utilities.newBlob(Utilities.base64Decode(p.b64), mime, stamped);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

    logAudit_('UPLOAD_EVIDENCE', 'Drive', file.getId(), null,
              { name: stamped, case_no: caseNo, by: u.email }, p.clientKey);
    return ok_({ file_id: file.getId(), name: stamped,
                 url: 'https://drive.google.com/file/d/' + file.getId() + '/view' });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   7. รายงานตามแบบฟอร์ม QC — ส่งออกเป็นแท็บใน Google Sheets ให้เซ็นได้
   ══════════════════════════════════════════════════════════════════════════ */
/** สร้าง/อัปเดตแท็บ "FM-QC-TR-01 Traceability Master" ตามล็อตที่เลือก */
function apiExportTraceMaster(lotKeys) {
  return guard_('apiExportTraceMaster', function () {
    var u = me_();
    var keys = (lotKeys || []).map(String);
    if (!keys.length) fail_('กรุณาเลือกล็อตที่จะออกรายงานอย่างน้อย 1 รายการ');
    if (keys.length > 200) fail_('ออกรายงานได้ครั้งละไม่เกิน 200 ล็อต — กรองให้แคบลงก่อน');

    var head = ['Record No.', 'Product Type', 'Brand', 'Item Code', 'Product / Description',
      'Model / Part No.', 'Supplier', 'Supplier PO', 'Supplier Invoice / Shipment',
      'Supplier Lot / Batch', 'Serial Number', 'Receiving Date', 'MGS Receiving Lot',
      'Qty Received', 'Warehouse Location', 'DO / Invoice', 'Delivery Date', 'Customer',
      'Project / Site', 'Qty Delivered', 'Current Status', 'Recall Case No.', 'Remark'];

    var rows = [], n = 0;
    keys.forEach(function (k) {
      var t = buildLotTrace_(k);
      var back = t.backward[0] || {};
      var note = t.mgs_note || {};
      var recall = t.recall_cases.join(', ') || '-';
      var isSerial = String(t.lot.kind).toUpperCase() === MNG.SERIAL;

      var ships = t.forward.shipments.filter(function (s) { return s.to_customer; });
      if (!ships.length) ships = [null];

      ships.forEach(function (s) {
        n++;
        rows.push([
          'TR-' + ('0000' + n).slice(-4),
          t.lot.product_type, t.lot.brand, t.lot.item_code, t.lot.item_name, t.lot.model,
          back.party_name || '', back.supplier_po_no || '', back.supplier_invoice_no || '',
          isSerial ? (t.lot.supplier_lot || '') : t.lot.dist_number,
          isSerial ? t.lot.dist_number : '',
          back.doc_date || t.lot.in_date || '',
          note.mgs_receiving_lot || '',
          t.reconcile.received,
          s ? s.whs_name : (t.forward.on_hand.map(function (o) { return o.whs_name; }).join(', ') || ''),
          s ? s.doc_num : '', s ? s.doc_date : '', s ? s.party_name : '', s ? s.project : '',
          s ? s.qty : 0,
          statusOfLot_(t),
          recall,
          note.note || ''
        ]);
      });
    });

    var name = 'FM-QC-TR-01 Master ' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd-HHmm');
    var sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    sh.setFrozenRows(1);

    logAudit_('EXPORT_TRACE_MASTER', 'Report', name, null, { lots: keys.length, rows: rows.length }, '');
    return ok_({ sheet_name: name, rows: rows.length,
                 url: ss_().getUrl() + '#gid=' + sh.getSheetId() });
  });
}

function statusOfLot_(t) {
  if (t.holds.length) return 'HOLD';
  if (t.reconcile.on_hand > 0 && t.reconcile.shipped_out > 0) return 'Partially Delivered';
  if (t.reconcile.on_hand > 0) return 'In Stock';
  if (t.reconcile.shipped_out > 0) return 'Delivered';
  return 'No Stock';
}

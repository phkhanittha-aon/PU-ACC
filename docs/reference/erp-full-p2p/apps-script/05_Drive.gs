/**
 * 05_Drive.gs — Drive folder management, upload handling, document registry, PDF generation.
 *
 * Folder layout and naming convention: docs/02 §7.
 * Rule: files are never copied between folders — shortcuts only, so there is one byte-stream
 * and one version history.
 */

const DriveService = {

  root() {
    return DriveApp.getFolderById(Props.require('DRIVE_ROOT_ID'));
  },

  _childFolder(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  },

  path(parent, segments) {
    return segments.reduce((f, seg) => this._childFolder(f, seg), parent);
  },

  /** /02_Transactions/{YYYY}/{MM}/{PO_NO}/ */
  ensurePoFolder(poNo) {
    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
    const d = po && po.po_date ? String(po.po_date) : Fmt.today();
    const folder = this.path(this.root(), ['02_Transactions', d.slice(0, 4), d.slice(5, 7), poNo]);
    if (po && po.drive_folder_id !== folder.getId()) {
      Repo.update(SHEETS.PO_HEADER, po.po_id, { drive_folder_id: folder.getId() });
    }
    return folder;
  },

  /** One of 01_PO … 07_Payment under the PO folder. */
  ensurePoSubfolder(poNo, sub) {
    return this._childFolder(this.ensurePoFolder(poNo), sub);
  },

  ensureGrnFolder(poNo, grnNo) {
    return this._childFolder(this.ensurePoSubfolder(poNo, '03_GRN'), grnNo);
  },

  ensureQcFolder(poNo, qcNo) {
    return this._childFolder(this.ensurePoSubfolder(poNo, '04_QC'), qcNo);
  },

  ensureNcrFolder(poNo, ncrNo) {
    return this._childFolder(this.ensurePoSubfolder(poNo, '05_NCR'), ncrNo);
  },

  ensureVendorFolder(vendorCode, vendorName) {
    return this.path(this.root(), ['01_Vendors', vendorCode + '_' + String(vendorName).replace(/[\\/:*?"<>|]/g, '')]);
  },

  /** {DOCTYPE}_{DOC_NO}_{REV}_{yyyyMMdd}_{desc}.{ext} — enforced, not left to habit. */
  buildFileName(docType, docNo, rev, description, ext) {
    const clean = s => String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 40);
    return [String(docType).replace(/_/g, '-'), docNo, 'R' + Num.n(rev), Fmt.stamp(), clean(description)]
      .filter(Boolean).join('_') + (ext ? '.' + ext : '');
  },

  /**
   * Accept an upload from the web app or AppSheet, file it, and register it.
   * @param {object} p { docType, entityType, entityNo, poNo, description,
   *                     base64, fileName, mimeType, isRequired, validFrom, validTo }
   */
  upload(p) {
    return safely_('DriveService.upload', () => {
      const maxBytes = Config.num('MAX_UPLOAD_MB', 25) * 1024 * 1024;
      const bytes = Utilities.base64Decode(p.base64);
      if (bytes.length > maxBytes) {
        throw new AppError('TOO_LARGE', 'File exceeds the ' + Config.num('MAX_UPLOAD_MB', 25) + ' MB limit.');
      }
      const allowed = String(Config.get('ALLOWED_MIME',
        'application/pdf,image/jpeg,image/png,image/heic,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
        .split(',');
      if (allowed.indexOf(p.mimeType) < 0) {
        throw new AppError('BAD_MIME', p.mimeType + ' files are not accepted.');
      }

      const folder = this._folderFor(p);
      const ext = String(p.fileName || '').split('.').pop();
      const name = this.buildFileName(p.docType, p.entityNo, p.revision || 0, p.description, ext);
      const blob = Utilities.newBlob(bytes, p.mimeType, name);
      const file = folder.createFile(blob);

      return this.register({
        doc_type: p.docType, entity_type: p.entityType, entity_no: p.entityNo,
        po_no: p.poNo || this._poNoFor(p.entityType, p.entityNo),
        drive_file_id: file.getId(), file_name: name, file_url: file.getUrl(),
        mime_type: p.mimeType, size_bytes: bytes.length, folder_id: folder.getId(),
        checksum_md5: Utilities.base64Encode(
          Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)),
        is_required: p.isRequired ? 'TRUE' : 'FALSE',
        valid_from: p.validFrom || '', valid_to: p.validTo || '',
        source: p.source || 'WEB'
      });
    }, { entityType: p.entityType, entityNo: p.entityNo });
  },

  _folderFor(p) {
    const poNo = p.poNo || this._poNoFor(p.entityType, p.entityNo);
    switch (p.entityType) {
      case 'GRN': return this.ensureGrnFolder(poNo, p.entityNo);
      case 'QC': return this.ensureQcFolder(poNo, p.entityNo);
      case 'NCR': return this.ensureNcrFolder(poNo, p.entityNo);
      case 'INVOICE': return this.ensurePoSubfolder(poNo, '06_Invoice');
      case 'PAYMENT': return this.ensurePoSubfolder(poNo, '07_Payment');
      case 'VENDOR': {
        const v = Repo.findOne(SHEETS.VENDORS, 'vendor_code', p.entityNo);
        return this.path(this.ensureVendorFolder(p.entityNo, v ? v.vendor_name_en : ''),
          [p.docType === 'CERTIFICATE' ? '02_Certificates' : '01_Legal']);
      }
      case 'PO':
      default:
        return this.ensurePoSubfolder(poNo, p.docType === 'PO_PDF' ? '01_PO' : '02_Vendor_Docs');
    }
  },

  _poNoFor(entityType, entityNo) {
    const map = {
      GRN: [SHEETS.GRN_HEADER, 'grn_no'], QC: [SHEETS.QC_HEADER, 'qc_no'],
      NCR: [SHEETS.NCR, 'ncr_no'], INVOICE: [SHEETS.INV_HEADER, 'inv_internal_no'],
      PO: [SHEETS.PO_HEADER, 'po_no']
    };
    if (entityType === 'PO') return entityNo;
    const m = map[entityType];
    if (!m) return '';
    const rec = Repo.findOne(m[0], m[1], entityNo);
    return rec ? rec.po_no : '';
  },

  /** Register (or supersede) a document in the registry — the source of truth. */
  register(rec) {
    const prior = Repo.findAll(SHEETS.DOCUMENTS, 'entity_no', rec.entity_no)
      .filter(d => d.doc_type === rec.doc_type && String(d.is_current).toUpperCase() === 'TRUE');
    let version = 1;
    if (prior.length) {
      version = Math.max.apply(null, prior.map(d => Num.n(d.version))) + 1;
      prior.forEach(d => Repo.update(SHEETS.DOCUMENTS, d.doc_id, { is_current: 'FALSE' }));
      rec.supersedes_doc_id = prior[prior.length - 1].doc_id;
    }
    const doc = Repo.insert(SHEETS.DOCUMENTS, Object.assign({
      version: version, is_current: 'TRUE',
      verification_status: 'PENDING',
      uploaded_by: Auth.currentEmail(), uploaded_at: Fmt.now(),
      retention_until: Fmt.date(Fmt.addDays(Fmt.now(), Config.num('RETENTION_DAYS', 2555))),
      is_archived: 'FALSE'
    }, rec));
    History.log({
      entity_type: rec.entity_type, entity_no: rec.entity_no,
      action: 'DOC_ATTACHED', reason: rec.doc_type + ' v' + version + ' — ' + rec.file_name
    });
    return doc;
  },

  /** Everything attached anywhere under a PO — powers the traceability view. */
  documentsForPo(poNo) {
    return Repo.findAll(SHEETS.DOCUMENTS, 'po_no', poNo)
      .filter(d => String(d.is_archived).toUpperCase() !== 'TRUE');
  },

  /** A25 — move a closed PO's folder to the archive tree. */
  archivePo(poNo) {
    const folder = this.ensurePoFolder(poNo);
    const target = this.path(this.root(), ['03_Archive', String(poNo).split('-')[1] ? '20' + String(poNo).split('-')[1] : Fmt.today().slice(0, 4)]);
    // Drive has no atomic "move": add to the new parent, remove from the old one.
    target.addFolder(folder);
    folder.getParents().next().removeFolder(folder);
    Repo.findAll(SHEETS.DOCUMENTS, 'po_no', poNo)
      .forEach(d => Repo.update(SHEETS.DOCUMENTS, d.doc_id, { is_archived: 'TRUE' }));
    return target.getId();
  }
};

/* ------------------------------------------------------- PDF generation (A2/A11) */

const DocGen = {

  /** A2 — PO PDF from a Google Docs template. */
  generatePoPdf(poNo) {
    return safely_('DocGen.generatePoPdf', () => {
      const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
      if (!po) throw new AppError('NOT_FOUND', 'PO ' + poNo + ' not found.');
      const lines = Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo)
        .sort((a, b) => Num.n(a.line_no) - Num.n(b.line_no));
      const vendor = Repo.findOne(SHEETS.VENDORS, 'vendor_code', po.vendor_code) || {};
      const folder = DriveService.ensurePoSubfolder(poNo, '01_PO');

      const copy = DriveApp.getFileById(Props.require('TPL_PO_DOC_ID'))
        .makeCopy('tmp_' + poNo + '_' + Date.now(), folder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      const map = {
        '{{PO_NO}}': poNo,
        '{{REV}}': Num.n(po.po_revision) ? 'REVISION ' + po.po_revision : '',
        '{{PO_DATE}}': Fmt.date(po.po_date),
        '{{VENDOR_CODE}}': po.vendor_code,
        '{{VENDOR_NAME}}': po.vendor_name || vendor.vendor_name_en || '',
        '{{VENDOR_ADDRESS}}': vendor.address || '',
        '{{VENDOR_CONTACT}}': vendor.contact_name || '',
        '{{BUYER}}': po.buyer_email,
        '{{INCOTERM}}': po.incoterm || '-',
        '{{PAYMENT_TERM}}': po.payment_term_code || '-',
        '{{DELIVERY_DATE}}': Fmt.date(po.requested_delivery_date),
        '{{WAREHOUSE}}': po.warehouse_id || '',
        '{{CURRENCY}}': po.currency,
        '{{SUBTOTAL}}': Fmt.money(po.subtotal_amount),
        '{{DISCOUNT}}': Fmt.money(po.discount_amount),
        '{{VAT}}': Fmt.money(po.vat_amount),
        '{{TOTAL}}': Fmt.money(po.total_amount),
        '{{TOTAL_WORDS}}': this.amountInWords(po.total_amount, po.currency),
        '{{REMARK}}': po.remark || '',
        '{{APPROVED_BY}}': po.approved_by || '',
        '{{APPROVED_AT}}': Fmt.dateTime(po.approved_at)
      };
      Object.keys(map).forEach(k => body.replaceText(escapeRegex_(k), String(map[k])));

      const tableIndex = Number(Config.get('TPL_PO_LINE_TABLE_INDEX', 1));
      const tables = body.getTables();
      if (tables.length > tableIndex) {
        const table = tables[tableIndex];
        const proto = table.getRow(table.getNumRows() - 1);
        lines.forEach((l, i) => {
          const row = i === 0 ? proto : table.appendTableRow(proto.copy());
          const cells = [l.line_no, l.item_code + '\n' + (l.description || ''), Fmt.qty(l.qty_ordered),
                         l.uom, Fmt.money(l.unit_price), Fmt.money(l.line_amount)];
          for (let c = 0; c < row.getNumCells() && c < cells.length; c++) {
            row.getCell(c).setText(String(cells[c]));
          }
        });
      }

      doc.saveAndClose();
      const name = DriveService.buildFileName('PO', poNo, po.po_revision, po.vendor_code, 'pdf');
      const pdf = folder.createFile(copy.getAs(MimeType.PDF).setName(name));
      copy.setTrashed(true);

      DriveService.register({
        doc_type: Num.n(po.po_revision) ? 'PO_REV_PDF' : 'PO_PDF',
        entity_type: 'PO', entity_no: poNo, po_no: poNo,
        drive_file_id: pdf.getId(), file_name: name, file_url: pdf.getUrl(),
        mime_type: 'application/pdf', size_bytes: pdf.getSize(),
        folder_id: folder.getId(), source: 'SYSTEM'
      });
      Repo.update(SHEETS.PO_HEADER, po.po_id, { pdf_file_id: pdf.getId() });
      return pdf.getId();
    }, { entityType: 'PO', entityNo: poNo });
  },

  /** A11 — QC report with parameter results and embedded defect photos. */
  generateQcReport(qcNo) {
    return safely_('DocGen.generateQcReport', () => {
      const tplId = Props.get('TPL_QC_DOC_ID');
      if (!tplId) return null;                          // template not configured yet
      const qc = Repo.findOne(SHEETS.QC_HEADER, 'qc_no', qcNo);
      const lines = Repo.findAll(SHEETS.QC_LINES, 'qc_no', qcNo)
        .sort((a, b) => Num.n(a.seq) - Num.n(b.seq));
      const folder = DriveService.ensureQcFolder(qc.po_no, qcNo);

      const copy = DriveApp.getFileById(tplId).makeCopy('tmp_' + qcNo, folder);
      const doc = DocumentApp.openById(copy.getId());
      const body = doc.getBody();

      const map = {
        '{{QC_NO}}': qcNo, '{{GRN_NO}}': qc.grn_no, '{{PO_NO}}': qc.po_no,
        '{{VENDOR}}': qc.vendor_code, '{{ITEM}}': qc.item_code, '{{LOT}}': qc.lot_no,
        '{{SPEC}}': qc.qc_spec_id + ' v' + qc.spec_version,
        '{{QTY_SUBMITTED}}': Fmt.qty(qc.qty_submitted), '{{SAMPLE_SIZE}}': qc.sample_size,
        '{{AQL}}': qc.aql_level,
        '{{CRITICAL}}': qc.critical_defects, '{{MAJOR}}': qc.major_defects, '{{MINOR}}': qc.minor_defects,
        '{{QTY_ACCEPTED}}': Fmt.qty(qc.qty_accepted), '{{QTY_REJECTED}}': Fmt.qty(qc.qty_rejected),
        '{{RESULT}}': qc.result, '{{FAIL_REASONS}}': qc.fail_reason_codes || '-',
        '{{INSPECTOR}}': qc.inspector_email, '{{COMPLETED_AT}}': Fmt.dateTime(qc.completed_at),
        '{{REMARK}}': qc.remark || ''
      };
      Object.keys(map).forEach(k => body.replaceText(escapeRegex_(k), String(map[k])));

      const tables = body.getTables();
      if (tables.length) {
        const table = tables[tables.length - 1];
        const proto = table.getRow(table.getNumRows() - 1);
        lines.forEach((l, i) => {
          const row = i === 0 ? proto : table.appendTableRow(proto.copy());
          const spec = l.spec_text || [l.spec_min, l.spec_max].filter(v => v !== '').join(' – ');
          const cells = [l.param_name, l.test_method, spec + ' ' + (l.unit || ''),
                         l.measured_value !== '' ? l.measured_value : l.measured_text, l.result];
          for (let c = 0; c < row.getNumCells() && c < cells.length; c++) {
            row.getCell(c).setText(String(cells[c]));
          }
        });
      }

      // defect photos
      const photoIds = lines.reduce((acc, l) =>
        acc.concat(String(l.photo_file_ids || '').split(',').filter(Boolean)), []);
      if (photoIds.length) {
        body.appendParagraph('Photographic evidence').setHeading(DocumentApp.ParagraphHeading.HEADING2);
        photoIds.slice(0, 12).forEach(id => {
          try {
            const img = body.appendImage(DriveApp.getFileById(id.trim()).getBlob());
            const ratio = img.getHeight() / img.getWidth();
            img.setWidth(240).setHeight(Math.round(240 * ratio));
          } catch (e) { Logger.log('photo ' + id + ' skipped: ' + e.message); }
        });
      }

      doc.saveAndClose();
      const name = DriveService.buildFileName('QC-REPORT', qcNo, 0, qc.lot_no, 'pdf');
      const pdf = folder.createFile(copy.getAs(MimeType.PDF).setName(name));
      copy.setTrashed(true);

      DriveService.register({
        doc_type: 'QC_REPORT', entity_type: 'QC', entity_no: qcNo, po_no: qc.po_no,
        drive_file_id: pdf.getId(), file_name: name, file_url: pdf.getUrl(),
        mime_type: 'application/pdf', size_bytes: pdf.getSize(),
        folder_id: folder.getId(), source: 'SYSTEM'
      });
      Repo.update(SHEETS.QC_HEADER, qc.qc_id, { report_file_id: pdf.getId() });
      return pdf.getId();
    }, { entityType: 'QC', entityNo: qcNo });
  },

  generateNcrReport(ncrNo) {
    const tplId = Props.get('TPL_NCR_DOC_ID');
    if (!tplId) return null;
    const ncr = Repo.findOne(SHEETS.NCR, 'ncr_no', ncrNo);
    const folder = DriveService.ensureNcrFolder(ncr.po_no, ncrNo);
    const copy = DriveApp.getFileById(tplId).makeCopy('tmp_' + ncrNo, folder);
    const doc = DocumentApp.openById(copy.getId());
    const body = doc.getBody();
    const map = {
      '{{NCR_NO}}': ncrNo, '{{NCR_DATE}}': ncr.ncr_date, '{{PO_NO}}': ncr.po_no,
      '{{GRN_NO}}': ncr.grn_no, '{{QC_NO}}': ncr.qc_no, '{{VENDOR}}': ncr.vendor_code,
      '{{ITEM}}': ncr.item_code, '{{LOT}}': ncr.lot_no, '{{QTY}}': Fmt.qty(ncr.qty_affected),
      '{{DEFECT}}': ncr.defect_category, '{{DETAIL}}': ncr.defect_detail,
      '{{SEVERITY}}': ncr.severity, '{{IMPACT}}': Fmt.money(ncr.financial_impact_amount),
      '{{DISPOSITION}}': ncr.disposition || 'PENDING', '{{OWNER}}': ncr.owner_email
    };
    Object.keys(map).forEach(k => body.replaceText(escapeRegex_(k), String(map[k])));
    doc.saveAndClose();
    const name = DriveService.buildFileName('NCR', ncrNo, 0, ncr.item_code, 'pdf');
    const pdf = folder.createFile(copy.getAs(MimeType.PDF).setName(name));
    copy.setTrashed(true);
    DriveService.register({
      doc_type: 'NCR_REPORT', entity_type: 'NCR', entity_no: ncrNo, po_no: ncr.po_no,
      drive_file_id: pdf.getId(), file_name: name, file_url: pdf.getUrl(),
      mime_type: 'application/pdf', size_bytes: pdf.getSize(),
      folder_id: folder.getId(), source: 'SYSTEM'
    });
    return pdf.getId();
  },

  /** Thai POs are commonly required to show the amount in words. */
  amountInWords(amount, currency) {
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    function below1000(n) {
      if (n === 0) return '';
      if (n < 20) return ones[n];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
      return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + below1000(n % 100) : '');
    }
    function toWords(n) {
      if (n === 0) return 'zero';
      const groups = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
      let out = '';
      groups.forEach(g => {
        if (n >= g[0]) { out += below1000(Math.floor(n / g[0])) + ' ' + g[1] + ' '; n %= g[0]; }
      });
      return (out + below1000(n)).trim();
    }
    const whole = Math.floor(Num.n(amount));
    const cents = Math.round((Num.n(amount) - whole) * 100);
    const unit = currency === 'THB' ? 'baht' : String(currency || '').toLowerCase();
    const sub = currency === 'THB' ? 'satang' : 'cents';
    return (toWords(whole) + ' ' + unit + (cents ? ' and ' + toWords(cents) + ' ' + sub : ' only'))
      .replace(/\s+/g, ' ').toUpperCase();
  }
};

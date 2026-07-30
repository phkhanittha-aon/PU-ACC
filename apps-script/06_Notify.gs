/**
 * 06_Notify.gs — the notification engine (docs/04 §5).
 *
 * Business code never sends mail inline: it queues. The 15-minute job drains the queue with
 * retry and dedupe, so a Gmail hiccup never loses a hand-off and never blocks a user's save.
 */

const Notify = {

  /** @param {object} p { template_id, to[], cc[], entity_type, entity_no, vars, dedupe_key, channel } */
  queue(p) {
    try {
      const to = (p.to || []).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
      if (!to.length) return null;
      if (p.dedupe_key && Repo.findOne(SHEETS.NOTIF_LOG, 'dedupe_key', p.dedupe_key)) return null;

      return Repo.insert(SHEETS.NOTIF_LOG, {
        notif_id: Utilities.getUuid(), created_at: Fmt.now(),
        channel: p.channel || 'EMAIL', template_id: p.template_id,
        to_recipients: to.join(','), cc: (p.cc || []).filter(Boolean).join(','),
        subject: '', entity_type: p.entity_type || '', entity_no: p.entity_no || '',
        vars_json: Json.safe(p.vars || {}, 20000),
        status: 'QUEUED', attempts: 0, next_retry_at: Fmt.now(),
        dedupe_key: p.dedupe_key || ''
      });
    } catch (e) {
      Logger.log('Notify.queue failed (non-fatal): ' + e.message);
      return null;
    }
  },

  /** Drain the queue. Called every 15 minutes. */
  drain() {
    const now = Fmt.now();
    const batch = Repo.readAll(SHEETS.NOTIF_LOG)
      .filter(n => (n.status === 'QUEUED' || n.status === 'FAILED') &&
                   Num.n(n.attempts) < 5 &&
                   String(n.next_retry_at || '') <= now)
      .slice(0, Config.num('NOTIFY_BATCH_SIZE', 40));

    batch.forEach(n => {
      try {
        const vars = JSON.parse(n.vars_json || '{}');
        const tpl = this.render(n.template_id, vars, n);
        if (n.channel === 'CHAT') {
          this._sendChat(tpl.subject + '\n' + tpl.plain);
        } else {
          MailApp.sendEmail({
            to: n.to_recipients, cc: n.cc || '',
            subject: tpl.subject, htmlBody: tpl.html, body: tpl.plain,
            name: Config.get('MAIL_FROM_NAME', 'PU-ACC System'),
            attachments: tpl.attachments || []
          });
        }
        Repo.update(SHEETS.NOTIF_LOG, n.notif_id, {
          status: 'SENT', sent_at: Fmt.now(), subject: tpl.subject,
          attempts: Num.n(n.attempts) + 1, error: ''
        });
      } catch (e) {
        const attempts = Num.n(n.attempts) + 1;
        const backoffMin = Math.min(240, 5 * Math.pow(2, attempts - 1));
        Repo.update(SHEETS.NOTIF_LOG, n.notif_id, {
          status: attempts >= 5 ? 'FAILED' : 'QUEUED',
          attempts: attempts,
          next_retry_at: Fmt.addHours(Fmt.now(), backoffMin / 60),
          error: String(e.message || e).slice(0, 500)
        });
      }
    });
    return batch.length;
  },

  appUrl() {
    try { return ScriptApp.getService().getUrl(); } catch (e) { return Config.get('APP_URL', ''); }
  },

  link(entityType, entityNo) {
    const url = this.appUrl();
    return url ? url + '?view=' + encodeURIComponent(entityType) + '&no=' + encodeURIComponent(entityNo) : '';
  },

  /** Templates. Kept in code so they are version-controlled and reviewable. */
  render(templateId, v, notif) {
    const T = {
      PO_APPROVAL_REQUEST: {
        subject: 'Approval needed: PO ' + v.po_no + ' — ' + v.vendor + ' — ' + v.amount + ' THB',
        body: 'PO <b>' + v.po_no + '</b> is waiting for your approval.<br><br>' +
              'Vendor: ' + v.vendor + '<br>Total: ' + v.amount + ' THB<br>' +
              'Buyer: ' + v.buyer + '<br>Delivery required: ' + v.delivery_date + '<br><br>' +
              (v.approveUrl ? '<a href="' + v.approveUrl + '">APPROVE</a> &nbsp; ' +
                              '<a href="' + v.rejectUrl + '">REJECT</a><br><br>' : '')
      },
      PO_APPROVED: {
        subject: 'PO ' + v.po_no + ' approved',
        body: 'PO <b>' + v.po_no + '</b> was approved by ' + v.approved_by + '. You may now send it to the vendor.'
      },
      PO_REJECTED: {
        subject: 'PO ' + v.po_no + ' rejected',
        body: 'PO <b>' + v.po_no + '</b> was rejected by ' + v.rejected_by + '.<br>Reason: ' + v.reason
      },
      PO_TO_VENDOR: {
        subject: 'Purchase Order ' + v.po_no + ' from ' + Config.get('COMPANY_NAME', 'our company'),
        body: 'Dear ' + (v.contact || 'Supplier') + ',<br><br>' +
              'Please find attached our Purchase Order <b>' + v.po_no + '</b>.<br>' +
              'Requested delivery date: ' + v.delivery_date + '<br>' +
              'Incoterm: ' + v.incoterm + ' &nbsp; Payment terms: ' + v.payment_term + '<br><br>' +
              'Please acknowledge receipt of this order by reply.<br><br>' +
              'เรียน ผู้จำหน่าย กรุณายืนยันการรับใบสั่งซื้อฉบับนี้ด้วยครับ/ค่ะ'
      },
      PO_SHORT_CLOSED: {
        subject: 'PO ' + v.po_no + ' short-closed',
        body: 'The remaining balance on PO <b>' + v.po_no + '</b> has been closed.<br>Reason: ' + v.reason +
              '<br>Please release the open commitment.'
      },
      GRN_PENDING_QC: {
        subject: 'QC required: ' + v.grn_no + ' (' + v.qc_count + ' lot(s)) — PO ' + v.po_no,
        body: 'Goods received on <b>' + v.grn_no + '</b> are waiting for inspection.<br><br>' +
              'PO: ' + v.po_no + '<br>Vendor: ' + v.vendor + '<br>' +
              'Inspections created: ' + v.qc_nos + '<br><br>' +
              'Stock is received but NOT available until QC completes.'
      },
      GRN_OVER_TOLERANCE: {
        subject: 'Approval needed: over-receipt on ' + v.grn_no,
        body: 'Receipt <b>' + v.grn_no + '</b> exceeds the ordered quantity by ' + v.variance_pct + '%.<br>' +
              'Item: ' + v.item + '<br>Ordered open: ' + v.qty_open + ' / Received: ' + v.qty_received
      },
      DOC_MISSING: {
        subject: 'Missing vendor documents on ' + v.grn_no + ' (PO ' + v.po_no + ')',
        body: 'The following mandatory documents are missing: <b>' + v.missing + '</b>.<br>' +
              'QC cannot pass this lot until they are provided.'
      },
      QC_PASSED: {
        subject: 'Ready to invoice: ' + v.grn_no + ' — PO ' + v.po_no,
        body: 'QC completed and receipt <b>' + v.grn_no + '</b> is posted.<br>' +
              'Accepted quantity: ' + v.qty_accepted + '<br>' +
              (v.partial === 'YES' ? '<b>Partial posting</b> — some quantity remains in quarantine.<br>' : '') +
              'Accounting may now match the vendor invoice against the accepted quantity.'
      },
      QC_FAILED: {
        subject: 'QC FAILED — ' + v.ncr_no + ' — ' + v.item + ' lot ' + v.lot + ' (PO ' + v.po_no + ')',
        body: '<b>Inspection failed.</b><br><br>' +
              'NCR: ' + v.ncr_no + '<br>QC: ' + v.qc_no + '<br>Receipt: ' + v.grn_no + '<br>' +
              'PO: ' + v.po_no + '<br>Vendor: ' + v.vendor + '<br>' +
              'Item: ' + v.item + ' lot ' + v.lot + '<br>Rejected quantity: ' + v.qty + '<br>' +
              'Defect: ' + v.defect + '<br><br>' +
              'The lot is quarantined and payment for the rejected quantity is on hold. ' +
              'Purchasing: please agree a disposition (return / rework / replacement / deduction).'
      },
      QC_CONDITIONAL_APPROVAL: {
        subject: 'Concession approval needed: ' + v.qc_no + ' — ' + v.item + ' lot ' + v.lot,
        body: 'An inspector proposes a <b>conditional accept</b>.<br><br>' +
              'Reason: ' + v.reason + '<br>Proposed price deduction: ' + v.deduction + '%<br><br>' +
              'This requires QC Manager approval AND buyer agreement before the receipt posts.'
      },
      NCR_TO_VENDOR: {
        subject: 'Non-conformance report ' + v.ncr_no + ' — PO ' + v.po_no,
        body: 'Dear Supplier,<br><br>Goods supplied under PO <b>' + v.po_no + '</b> did not meet ' +
              'our specification.<br><br>Item: ' + v.item + '<br>Lot: ' + v.lot + '<br>' +
              'Affected quantity: ' + v.qty + '<br>Non-conformance: ' + v.defect + '<br><br>' +
              'Please respond within 3 working days with your proposed corrective action.'
      },
      LAB_OVERDUE: {
        subject: 'Laboratory result overdue: ' + v.qc_no,
        body: 'Samples for <b>' + v.qc_no + '</b> were sent to ' + v.lab + ' on ' + v.sent_at +
              ' and were due ' + v.due_at + '.<br>The lot remains quarantined.'
      },
      INVOICE_EXCEPTION: {
        subject: 'Invoice exception ' + v.exception + ': ' + v.inv_no + ' (' + v.vendor + ')',
        body: 'Invoice <b>' + v.inv_no + '</b> (vendor ref ' + (v.vendor_invoice_no || '-') + ') ' +
              'failed three-way matching.<br><br>' +
              'PO: ' + (v.po_no || '-') + '<br>Amount: ' + v.amount + ' THB<br>' +
              'Exception: <b>' + v.exception + '</b><br>Detail: ' + v.detail + '<br><br>' +
              'Payment is blocked until this is resolved.'
      },
      INVOICE_APPROVAL_REQUEST: {
        subject: 'Approval needed: invoice ' + v.inv_no + ' — ' + v.vendor + ' — ' + v.amount + ' THB',
        body: 'Invoice <b>' + v.inv_no + '</b> matched successfully and is ready for payment approval.<br>' +
              'Vendor: ' + v.vendor + '<br>Amount: ' + v.amount + ' THB<br>' + (v.note ? v.note + '<br>' : '')
      },
      PAYMENT_ADVICE: {
        subject: 'Payment advice ' + v.payment_no + ' from ' + Config.get('COMPANY_NAME', 'our company'),
        body: 'Dear Supplier,<br><br>The following payment has been made.<br><br>' +
              'Payment: ' + v.payment_no + '<br>Date: ' + v.payment_date + '<br>' +
              'Net amount: ' + v.net_amount + ' ' + v.currency + '<br>' +
              'Invoices settled: ' + v.invoices
      },
      SLA_BREACH_ESCALATION: {
        subject: 'SLA breached: ' + v.entity_type + ' ' + v.entity_no + ' (' + v.aging + 'h)',
        body: '<b>' + v.entity_type + ' ' + v.entity_no + '</b> has been in status <b>' + v.status +
              '</b> for ' + v.aging + ' hours, past the ' + v.sla + 'h SLA.<br>' +
              'Owner: ' + v.owner + '<br><br>Please intervene.'
      },
      DAILY_DIGEST: {
        subject: 'PU-ACC daily digest — ' + Fmt.today(),
        body: v.html || ''
      },
      ADMIN_ALERT: {
        subject: '[PU-ACC] ' + v.fn + ' failed',
        body: 'Function: ' + v.fn + '<br>Reference: ' + v.requestId + '<br><br><pre>' + v.stack + '</pre>'
      }
    };

    const t = T[templateId];
    if (!t) throw new AppError('NO_TEMPLATE', 'Unknown notification template ' + templateId);

    const link = notif && notif.entity_no ? this.link(notif.entity_type, notif.entity_no) : '';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.55">' +
      t.body +
      (link ? '<br><br><a href="' + link + '" style="background:#1a73e8;color:#fff;padding:9px 16px;' +
              'border-radius:4px;text-decoration:none;display:inline-block">Open in PU-ACC</a>' : '') +
      '<hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">' +
      '<span style="color:#888;font-size:12px">Sent automatically by PU-ACC. Do not reply to this address.</span>' +
      '</div>';

    return {
      subject: t.subject,
      html: html,
      plain: t.body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') + (link ? '\n\n' + link : ''),
      attachments: v.attachmentFileIds
        ? String(v.attachmentFileIds).split(',').filter(Boolean).map(id => DriveApp.getFileById(id.trim()).getBlob())
        : []
    };
  },

  /** A3 — send the PO PDF to the vendor. */
  sendPoToVendor(poNo) {
    const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
    const vendor = Repo.findOne(SHEETS.VENDORS, 'vendor_code', po.vendor_code);
    this.queue({
      template_id: 'PO_TO_VENDOR', to: [vendor.contact_email], cc: [po.buyer_email],
      entity_type: 'PO', entity_no: poNo,
      vars: {
        po_no: poNo, contact: vendor.contact_name,
        delivery_date: Fmt.date(po.requested_delivery_date),
        incoterm: po.incoterm || '-', payment_term: po.payment_term_code || '-',
        attachmentFileIds: po.pdf_file_id
      }
    });
  },

  _sendChat(text) {
    const url = Props.get('CHAT_WEBHOOK_URL');
    if (!url) throw new AppError('NO_WEBHOOK', 'CHAT_WEBHOOK_URL is not configured.');
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ text: text }), muteHttpExceptions: true
    });
  },

  /** Rate-limited admin alert for unexpected errors. */
  alertAdmin(fnName, err, requestId) {
    const cache = CacheService.getScriptCache();
    const key = 'ALERT_' + fnName;
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
    try {
      const tpl = this.render('ADMIN_ALERT',
        { fn: fnName, requestId: requestId, stack: String(err.stack || err.message || err).slice(0, 3000) }, null);
      MailApp.sendEmail({ to: Props.get('ADMIN_EMAIL'), subject: tpl.subject, htmlBody: tpl.html });
    } catch (e) {
      Logger.log('admin alert failed: ' + e.message);
    }
  },

  /** A19 — one digest per user: my queue, my overdue, what I am waiting on. */
  sendDailyDigests() {
    const users = Repo.readAll(SHEETS.USERS)
      .filter(u => String(u.is_active).toUpperCase() === 'TRUE' &&
                   String(u.digest_optin).toUpperCase() !== 'FALSE');
    users.forEach(u => {
      const items = Dashboard.queueFor(u);
      const total = items.reduce((s, g) => s + g.rows.length, 0);
      if (!total) return;                                  // silence beats noise
      const html = '<b>Your PU-ACC queue for ' + Fmt.today() + '</b><br><br>' +
        items.filter(g => g.rows.length).map(g =>
          '<b>' + g.title + ' (' + g.rows.length + ')</b><br>' +
          g.rows.slice(0, 10).map(r =>
            '• ' + r.no + ' — ' + r.summary +
            (r.aging_hrs ? ' <span style="color:#c00">(' + r.aging_hrs + 'h)</span>' : '')
          ).join('<br>') +
          (g.rows.length > 10 ? '<br>… and ' + (g.rows.length - 10) + ' more' : '')
        ).join('<br><br>');
      this.queue({
        template_id: 'DAILY_DIGEST', to: [u.email], vars: { html: html },
        dedupe_key: 'DIGEST:' + u.email + ':' + Fmt.today()
      });
    });
  }
};

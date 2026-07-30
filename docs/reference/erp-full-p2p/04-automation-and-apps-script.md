# 04 — Automation & Apps Script Strategy

**Objective:** every hand-off between the four departments happens without anyone sending a message, and every
document that can be generated is generated.

**Guiding rule:** automate the *hand-off*, never the *judgement*. A script may create a QC record, notify the
inspector, and block a payment. It must never decide that goods passed QC, that a price variance is acceptable,
or that a vendor should be paid.

---

## 1. Automation catalogue

| # | Automation | Trigger | What it does | Saves |
|---|---|---|---|---|
| **A1** | Document numbering | On create, via API | `LockService`-guarded increment of `Counters`; `PO-26-0042` format; numbers are burnt on cancel, never reused | Duplicate/collided numbers |
| **A2** | PO PDF generation | PO reaches `APPROVED` | Copies the Docs template, replaces `{{placeholders}}`, builds the line table, exports PDF to `/01_PO/`, registers in `Documents` | ~10 min/PO of manual formatting |
| **A3** | PO email to vendor | PO → `SENT_TO_VENDOR` | Sends PDF + terms, bilingual TH/EN template, CC buyer, logs `message_id` in `Notification_Log` | Manual attach-and-send |
| **A4** | Approval request emails | PR/PO/invoice/payment submitted | Email with record summary and signed one-click `Approve` / `Reject` links (HMAC token, single-use, 7-day expiry) | Chasing approvers |
| **A5** | Approval escalation | Hourly | `sla_due_at` passed → reminder to approver; `escalate_after_hours` passed → escalate to `escalate_to_email`; honours `delegate_email` | Silent stalls |
| **A6** | Expected-receipt list | On PO send | PO lines with `qty_open > 0` surface on the Warehouse dashboard with ETA | Warehouse phoning Purchasing |
| **A7** | **GRN → QC hand-off** | GRN → `SUBMITTED` | Creates one `QC_Header` per (item, lot), explodes `QC_Lines` from the current spec, computes AQL sample size, sets `sla_due_at`, assigns inspector round-robin, notifies QC + supervisor | The core manual hand-off today |
| **A8** | Document completeness check | GRN submit | Compares `QC_Specs.doc_requirements` against `Documents`; writes `doc_missing_list`; blocks QC `PASS` while mandatory docs are absent | Missing certs found at audit |
| **A9** | Tolerance & shelf-life validation | GRN submit | Over-receipt vs `over_receipt_tolerance_pct`, remaining shelf life vs `min_remaining_shelf_life_pct`, temperature vs item range; routes overrides to the supervisor | Unmatched invoices later |
| **A10** | **QC result → posting** | QC → `COMPLETED` | Updates `GRN_Lines` accept/reject, posts the GRN, rolls quantities up to `PO_Lines`, recomputes PO status, appends `Stock_Ledger`, notifies Warehouse + Purchasing + AP | 3 manual updates per receipt |
| **A11** | QC report PDF | QC completed | Renders parameters, measurements, spec limits, defect counts, verdict, and embedded photos to PDF; files to `/04_QC/{QC_NO}/` | ~20 min/inspection |
| **A12** | **NCR auto-creation** | QC → `FAIL`, or damage on GRN | Creates the NCR with quantities, defects, photos, financial impact; sets `blocks_payment`; notifies Purchasing + QC Manager + AP; emails the vendor with the QC report | Rejections lost in email |
| **A13** | Lab-result chase | Daily 09:00 | `QC_PENDING_LAB` past `lab_due_at` → chase the lab, alert QC Manager, flag the quarantined lot | Stock stuck in quarantine |
| **A14** | Aging, SLA & bottleneck engine | Hourly + nightly | Recomputes aging from `Status_History`, marks `sla_breached`, escalates by stage owner, rebuilds `VW_Bottleneck` | Management chasing status |
| **A15** | Invoice inbox parser | Every 15 min | Reads a monitored Gmail label / Drive folder, files the attachment, pre-creates a `RECEIVED` invoice with vendor guessed from the sender domain, and queues it for AP to confirm (**never auto-posts**) | Manual filing |
| **A16** | **3-way match engine** | Every 15 min + on demand | Runs the §4 logic from doc 01, writes `Match_Results`, sets `match_status`, assigns exceptions by code to buyer/warehouse/QC/AP | The single biggest AP time sink |
| **A17** | Duplicate invoice guard | On registration | `duplicate_check_hash` uniqueness + fuzzy check on (vendor, amount, ±5 days) | Double payment |
| **A18** | Payment proposal | Weekly, or on demand | Groups `APPROVED_FOR_PAYMENT` invoices by vendor/currency/due date, applies WHT and NCR deductions, produces the proposal + bank file + remittance advice PDFs | Manual payment prep |
| **A19** | Daily role digest | 08:00 weekdays | One email per user: my queue, my overdue items, what I'm waiting on. Suppressed when empty | 20+ status emails/day |
| **A20** | Integrity audit | Nightly 01:00 | Runs every check in doc 02 §8; writes findings to `Error_Log`; emails `SYS_ADMIN` | Silent data corruption |
| **A21** | Backup snapshot | Nightly 02:00 | Copies the spreadsheet to `/00_System/Backups/YYYY/MM/`, 30-day rolling retention | Total data loss |
| **A22** | Vendor scorecard | Nightly | Recomputes on-time %, QC pass %, NCR count, claim value, lead-time accuracy → `Vendors` + `VW_Vendor_Scorecard` | Manual vendor reviews |
| **A23** | FX rate load | Daily 08:30 | Fetches BOT reference rates via `UrlFetchApp` into `Currencies_FX`; alerts if unavailable | Manual rate entry |
| **A24** | Expiry & compliance watch | Daily | Vendor certs, QC specs, and contracts expiring in ≤30 days; open POs for vendors that became `SUSPENDED`/`BLACKLISTED` | Compliance surprises |
| **A25** | Archive & close | Nightly | Closes fully received + invoiced + paid POs with no open NCR; moves the Drive folder to `/03_Archive/YYYY/` | Clutter, cell growth |

---

## 2. Trigger plan

| Trigger | Type | Handler | Notes |
|---|---|---|---|
| `doGet` / `doPost` | Web App | `Api.gs` router | Deploy: *execute as me*, *access: anyone within the domain*. All UI traffic. |
| `onOpen` | Simple | `buildAdminMenu_` | Admin-only menu on the DB spreadsheet (setup, re-run match, rebuild views) |
| `onChange` | **Installable** | `guardAppSheetWrite_` | Re-validates writes that bypassed the API (AppSheet, manual edits); reverts or flags illegal transitions |
| Every 15 min | Time-driven | `processQueues_` | A15 invoice inbox, A16 match engine, notification queue drain |
| Hourly | Time-driven | `processHourly_` | A5 escalations, A14 aging/SLA |
| Daily 08:00 | Time-driven | `dailyMorning_` | A19 digests, A13 lab chase, A24 expiry watch |
| Daily 08:30 | Time-driven | `dailyFx_` | A23 FX rates |
| Daily 01:00 | Time-driven | `nightlyIntegrity_` | A20 audit, A22 scorecards, A25 archive, `VW_*` rebuild |
| Daily 02:00 | Time-driven | `nightlyBackup_` | A21 |
| Weekly Mon 09:00 | Time-driven | `weeklyPaymentProposal_` | A18 |

Installed idempotently by `installTriggers()` in [`apps-script/07_Triggers.gs`](../apps-script/07_Triggers.gs),
which deletes existing project triggers first — otherwise every redeploy silently doubles your job frequency,
and you find out when vendors get duplicate emails.

**Do not use simple `onEdit`** for business logic: it cannot call authenticated services, has a 30-second limit,
and does not fire on API or AppSheet writes. Installable `onChange` plus API-mediated writes is the correct pair.

---

## 3. PDF generation pattern (A2, A11, A18)

Template as a Google Doc with `{{placeholders}}`; tables built by row insertion; export via
`getAs('application/pdf')`. No external service, no licence.

```javascript
function generatePoPdf(poNo) {
  const po = Repo.findOne(SHEETS.PO_HEADER, 'po_no', poNo);
  const lines = Repo.findAll(SHEETS.PO_LINES, 'po_no', poNo);
  const folder = DriveService.ensurePoSubfolder(poNo, '01_PO');

  const copy = DriveApp.getFileById(Config.get('TPL_PO_DOC_ID'))
      .makeCopy(`PO_${poNo}_R${po.po_revision}_tmp`, folder);
  const doc  = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  Object.entries({
    '{{PO_NO}}': poNo,
    '{{REV}}': po.po_revision ? `REVISION ${po.po_revision}` : '',
    '{{PO_DATE}}': Fmt.date(po.po_date),
    '{{VENDOR_NAME}}': po.vendor_name,
    '{{INCOTERM}}': po.incoterm || '-',
    '{{PAYMENT_TERM}}': Lookup.label('PAYMENT_TERM', po.payment_term_code),
    '{{DELIVERY_DATE}}': Fmt.date(po.requested_delivery_date),
    '{{CURRENCY}}': po.currency,
    '{{SUBTOTAL}}': Fmt.money(po.subtotal_amount),
    '{{VAT}}': Fmt.money(po.vat_amount),
    '{{TOTAL}}': Fmt.money(po.total_amount),
    '{{TOTAL_WORDS}}': Fmt.amountInWords(po.total_amount, po.currency),
    '{{APPROVED_BY}}': po.approved_by,
    '{{APPROVED_AT}}': Fmt.dateTime(po.approved_at)
  }).forEach(([k, v]) => body.replaceText(escapeRegex_(k), String(v)));

  const table = body.getTables()[Number(Config.get('TPL_PO_LINE_TABLE_INDEX') || 1)];
  const proto = table.getRow(1);                       // styled prototype row
  lines.forEach((l, i) => {
    const row = i === 0 ? proto : table.appendTableRow(proto.copy());
    [l.line_no, `${l.item_code}\n${l.description}`, Fmt.qty(l.qty_ordered), l.uom,
     Fmt.money(l.unit_price), Fmt.money(l.line_amount)]
      .forEach((val, c) => row.getCell(c).setText(String(val)));
  });

  doc.saveAndClose();
  const pdf = folder.createFile(
      copy.getAs(MimeType.PDF).setName(`PO_${poNo}_R${po.po_revision}_${Fmt.stamp()}.pdf`));
  copy.setTrashed(true);                               // never leave the temp Doc behind

  DocRegistry.register({
    doc_type: 'PO_PDF', entity_type: 'PO', entity_no: poNo, po_no: poNo,
    drive_file_id: pdf.getId(), version: po.po_revision + 1, is_current: true, source: 'SYSTEM'
  });
  Repo.update(SHEETS.PO_HEADER, po.po_id, { pdf_file_id: pdf.getId() });
  return pdf.getId();
}
```

Same pattern for the QC report (parameter table + `body.appendImage()` for defect photos), the NCR, remittance
advice, and WHT certificates. Keep **one template per document type** in `/00_System/Templates` with its ID in
`Config` — never hard-code IDs in source.

---

## 4. Approval by email (A4)

Approvers will not log into a new app to click one button, so the button comes to them — safely.

```javascript
function buildApprovalLinks_(docType, docNo, approverEmail) {
  const base = ScriptApp.getService().getUrl();
  const mk = decision => {
    const payload = { d: docType, n: docNo, a: approverEmail, x: decision,
                      e: Date.now() + 7 * 864e5, j: Utilities.getUuid() };
    const json = JSON.stringify(payload);
    const sig  = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
                    json, PropertiesService.getScriptProperties().getProperty('HMAC_SECRET')));
    return `${base}?action=decide&p=${Utilities.base64EncodeWebSafe(json)}&s=${sig}`;
  };
  return { approveUrl: mk('APPROVE'), rejectUrl: mk('REJECT') };
}
```

Server side on `action=decide`: verify the HMAC, check `e` has not expired, check the `j` nonce is unused in
`Idempotency`, confirm `Session.getActiveUser().getEmail()` matches `a` (or its active delegate), then run the
state-machine transition. Rejection always opens a form for the mandatory reason — a rejection without a reason
just moves the conversation back to email.

**Never** encode the decision in an unsigned URL parameter. An unsigned approval link forwarded to a colleague is
an approval anyone in the mail thread can grant.

---

## 5. Notification engine

Queue, never send inline. A `MailApp` call inside a save handler makes the user wait for Gmail and loses the
notification if the send fails.

1. Business code calls `Notify.queue({ template_id, to, entity_type, entity_no, vars, dedupe_key })`, which
   appends a `QUEUED` row to `Notification_Log`.
2. The 15-minute job drains the queue, renders the template, sends, and stamps `SENT` + `message_id`, or
   `FAILED` + `next_retry_at` with exponential backoff (5 min → 4 h, 5 attempts).
3. `dedupe_key` (e.g. `QC_PENDING:GR-26-0311:2026-07-30`) suppresses duplicates — the reason a "helpful"
   reminder job does not send the same inspector 14 identical emails.

| Template | To | When |
|---|---|---|
| `PO_APPROVAL_REQUEST` | approver | PO submitted |
| `PO_APPROVED` / `PO_REJECTED` | buyer | decision |
| `PO_TO_VENDOR` | vendor | PO sent |
| `GRN_PENDING_QC` | QC group + inspector | GRN submitted (A7) |
| `GRN_OVER_TOLERANCE` | WH supervisor + buyer | A9 |
| `DOC_MISSING` | buyer + vendor | A8 |
| `QC_PASSED` | warehouse + buyer + AP | A10 |
| `QC_FAILED` | buyer + QC mgr + WH + AP | A12 |
| `QC_CONDITIONAL_APPROVAL` | QC mgr + buyer | Q4 |
| `NCR_TO_VENDOR` | vendor + buyer | A12 |
| `LAB_OVERDUE` | QC mgr + lab | A13 |
| `INVOICE_EXCEPTION` | exception owner | A16 |
| `INVOICE_APPROVAL_REQUEST` | FIN_MGR | A8 in doc 01 |
| `PAYMENT_ADVICE` | vendor | A18 |
| `SLA_BREACH_ESCALATION` | stage owner's manager | A14 |
| `DAILY_DIGEST` | every active user | A19 |

For urgent floor-level alerts, add Google Chat webhooks (`UrlFetchApp` POST to a space) — QC and warehouse staff
read Chat faster than email. LINE is popular in Thailand; note that **LINE Notify was discontinued (2025)**, so
use the LINE Messaging API with a stored channel token if you go that route.

---

## 6. Performance patterns (non-negotiable at 50k rows)

| Rule | Why |
|---|---|
| One `getValues()` per tab per execution, one `setValues()` to write back | 500 `getRange().getValue()` calls cost ~30 s; one batched read costs ~0.3 s |
| Build a `Map` from key → row index once, then look up in memory | Avoids O(n²) scans when rolling GRN lines into PO lines |
| Never `appendRow()` in a loop | Use one `setValues()` on a range sized to the batch |
| Cache master data in `CacheService` for 6 h, invalidated on master write | Vendors/Items/Lookups are read on every transaction |
| `SpreadsheetApp.flush()` only before releasing a lock | Each flush is a round trip |
| Chunk long jobs (300–500 rows) and store a continuation cursor in Script Properties | 6-minute execution ceiling |
| Wrap every write path in `LockService.getScriptLock()` with a 30 s timeout | Two concurrent GRN posts otherwise both read the same `qty_open` and both accept it |
| Read-modify-write must happen **inside** the lock | The classic Sheets race condition |
| Use `TextFinder` for lookups on tabs you deliberately don't cache | Faster than reading a whole column |

```javascript
function withLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 30000)) throw new AppError('SYSTEM_BUSY', 'Please retry in a moment.');
  try { const out = fn(); SpreadsheetApp.flush(); return out; }
  finally { lock.releaseLock(); }
}
```

### Quotas to plan against (Google Workspace account)

| Resource | Limit | Headroom at modelled volume |
|---|---|---|
| Script runtime per execution | 6 min | Chunk everything above ~2k rows |
| Total script runtime/day | 90 min | ~25 min used by all jobs at 200 POs/month |
| Triggers per script per user | 20 | 9 used |
| Emails/day (`MailApp`) | 1,500 | ~120/day; digests are the bulk |
| `UrlFetchApp` calls/day | 100,000 | trivial |
| Simultaneous executions/user | 30 | the real concurrency ceiling |
| Spreadsheet cells | 10,000,000 | see Appendix B |

---

## 7. Error handling and observability

```javascript
function safely_(name, fn, ctx) {
  const requestId = Utilities.getUuid();
  try {
    return fn();
  } catch (err) {
    Logger.log('%s failed: %s', name, err.stack || err);
    ErrorLog.write({
      severity: err instanceof AppError ? 'WARN' : 'ERROR',
      function_name: name, error_message: String(err.message || err),
      stack: String(err.stack || '').slice(0, 4000),
      entity_type: ctx && ctx.entityType, entity_no: ctx && ctx.entityNo,
      actor_email: Auth.currentEmail(), payload_json: Json.safe(ctx, 4000), request_id: requestId
    });
    if (!(err instanceof AppError)) Notify.alertAdmin(name, err, requestId);
    throw new AppError(err.code || 'INTERNAL', userMessage_(err), requestId);
  }
}
```

- Users see a plain message plus a `request_id`; stack traces stay in `Error_Log`.
- `AppError` = expected business rejection (validation, permission, stale version) → `WARN`, no admin alert.
- Anything else → `ERROR` + immediate admin email, rate-limited to one per function per hour.
- Never log full payloads containing bank details; `Json.safe()` redacts `bank_account_no`, `bank_swift`, and
  `tax_id`.
- A weekly `Error_Log` summary catches slow-burn failures — a notification queue silently failing for eight days
  is a very quiet, very expensive bug.

---

## 8. Security

| Control | Implementation |
|---|---|
| Authentication | Google Workspace SSO. Web App deployed *execute as me*, *access: anyone in domain*. `Session.getActiveUser().getEmail()` is the identity — never trust an email in the request body |
| Authorisation | Every API action resolves the caller against `Users` + `Roles_Permissions` **server-side, before any read**. Deny by default: an unlisted (action, role) pair is refused |
| Data exposure | The client never receives the spreadsheet ID, never receives fields the role cannot see (price fields stripped for warehouse/QC responses), and never receives another user's records outside their scope |
| Input validation | Whitelist per action: field names, types, enum membership, numeric ranges, and referential existence. Reject unknown fields rather than ignoring them |
| Injection | Never build formulas from user input; prefix any user text written to a cell that starts with `=`, `+`, `-`, or `@` with `'` to prevent formula injection into exports |
| XSS | Escape all interpolated values in HTML templates; keep `sandbox: IFRAME` mode |
| Secrets | HMAC secret, LINE/Chat tokens, template IDs, spreadsheet IDs in `PropertiesService` script properties — never in source, never in the repo |
| Audit | Every mutation writes `Status_History` including blocked attempts; append-only, and no role has `EDIT` on that tab |
| SoD | Enforced in code (doc 03 §7), not by convention |
| Backup | Nightly snapshot + 30-day retention; quarterly restore drill (an untested backup is a hypothesis) |
| Data residency | All data stays in Google Workspace; no third-party processor is introduced |
| PDPA | `Users` holds work contact data only. Document a retention rule (`Documents.retention_until`) and a purge job for anything holding personal data of vendor contacts |

---

## 9. Build, deploy, and environments

```
DEV  spreadsheet PU-ACC-DB-DEV  +  Apps Script "PU-ACC-DEV"   (safe to break)
UAT  spreadsheet PU-ACC-DB-UAT  +  head deployment            (department sign-off)
PROD spreadsheet PU-ACC-DB-2026 +  versioned deployment       (users only ever hit a numbered version)
```

- Source of truth is **this git repository**, synced with [`clasp`](https://github.com/google/clasp):
  `clasp push` to DEV, promote by `clasp deploy --description "v1.4.0 match engine tolerances"`.
- Environment differences live entirely in script properties (`SPREADSHEET_ID`, `DRIVE_ROOT_ID`,
  `TPL_*_DOC_ID`, `ENV`, `HMAC_SECRET`) — the code is identical in all three.
- Users are pinned to a **versioned deployment URL**, never `/dev`. Otherwise a mid-afternoon `clasp push`
  ships half-finished code to the warehouse.
- Refresh UAT from a PROD copy before each release cycle so testing happens on realistic data volumes.
- Keep a `CHANGELOG.md` per release; in a system where finance controls are code, "when did the tolerance change"
  is an audit question you will be asked.

### Test approach

Apps Script has no built-in test runner, so keep the discipline manual but real:

1. Pure functions (matching, tolerance, AQL sample size, WHT, amount-in-words) live in files with no
   `SpreadsheetApp` calls and are covered by `runUnitTests()` asserting against fixtures.
2. Integration tests run against DEV with a `seedDemoData()` fixture: a PO, a partial receipt, a QC pass, a QC
   fail with NCR, a matched invoice, and an exception invoice.
3. Before each release, walk the six regression scenarios in `apps-script/README.md` §5. The QC-fail path is the
   one that breaks most often, because it touches all four departments.

---

## 10. Implementation order for the automations

Sequence matters — several automations depend on others being trustworthy first.

| Wave | Automations | Rationale |
|---|---|---|
| 1 | A1, A20, A21 + `Status_History` writes | Numbering, integrity, backup, and audit before any business logic. Retrofitting an audit log is painful and incomplete |
| 2 | A2, A3, A4, A5 | Purchasing gets visible value first, which buys goodwill for the rest of the rollout |
| 3 | A6, A7, A8, A9 | The Purchasing → Warehouse → QC hand-off, the biggest manual cost |
| 4 | A10, A11, A12, A13 | QC outcomes and the rejection path, including the AP hold |
| 5 | A15, A16, A17, A18 | AP automation, which only works once A10 is producing reliable accepted quantities |
| 6 | A14, A19, A22, A23, A24, A25 | Visibility, digests, scorecards, housekeeping |

Wave 1 is not optional and not deferrable. Everything in waves 4–6 reads from `Status_History`; if it starts
being written in month three, your first quarter of KPIs does not exist.

# Apps Script implementation

Executable scaffold for the blueprint in [`../docs`](../docs). It implements the schema, the
state machine, the QC hand-off, the three-way match engine, the document registry, and the
scheduled jobs. Department entry screens (PO grid, GRN capture, QC form, AP workbench) plug into
the existing API contract in `08_Api.gs`.

## 1. Files

| File | Contents |
|---|---|
| `00_Schema.gs` | Tab names, columns, primary keys, uniqueness, counters — the source of truth for docs/02 |
| `00_Config.gs` | Script properties, `Config` tab accessor, status constants, `AppError`, `withLock_`, `safely_` |
| `01_Repo.gs` | Sheets data-access layer + `History` audit writer. **The only file that knows the data is in Sheets** |
| `02_StateMachine.gs` | `Auth`, the transition table (docs/01 §3), `Approvals` |
| `03_Workflow.gs` | GRN submit validation, QC auto-creation, QC completion, GRN posting, PO roll-up, NCR, AP hold |
| `04_Match.gs` | Three-way match engine, exception routing, invoice registration, duplicate guard |
| `05_Drive.gs` | Folder tree, upload handling, `Documents` registry, PO/QC/NCR PDF generation |
| `06_Notify.gs` | Queued notification engine, templates, daily digests |
| `07_Triggers.gs` | Trigger installation, time-driven jobs, AppSheet write guard, aging/SLA, views, integrity, scorecard, backup |
| `08_Api.gs` | `doGet`/`doPost` router with deny-by-default authz, dashboards, domain services, payments, signed approval links |
| `09_Setup.gs` | `setupWorkspace()`, reference data, permission matrix, validation, admin menu, demo fixture, unit tests |
| `index.html` | Office-side SPA shell: work queue, bottleneck board, search, traceability view |
| `appsscript.json` | Manifest: timezone, V8, OAuth scopes, web app config |

Load order does not matter in Apps Script — all files share one global scope.

## 2. First-time setup

```bash
npm i -g @google/clasp
clasp login
clasp create --type sheets --title "PU-ACC" --rootDir apps-script
clasp push
```

Then in the script editor (**Project Settings → Script properties**):

| Property | Value |
|---|---|
| `SPREADSHEET_ID` | the bound spreadsheet's ID |
| `DRIVE_ROOT_ID` | the `/PU-ACC/` folder ID (create it on a **shared drive**) |
| `ADMIN_EMAIL` | who receives error and integrity alerts |
| `HMAC_SECRET` | 32+ random characters — signs the email approval links |
| `ENV` | `DEV`, `UAT` or `PROD` |
| `TPL_PO_DOC_ID` | Google Doc template for the PO (see §4) |
| `TPL_QC_DOC_ID` | *(optional)* QC report template |
| `TPL_NCR_DOC_ID` | *(optional)* NCR template |
| `SPREADSHEET_ID_QC`, `SPREADSHEET_ID_LOG` | *(optional)* overflow files for `QC_Lines` / logs — see Appendix B §2 |
| `CHAT_WEBHOOK_URL` | *(optional)* Google Chat space webhook |

Then, from the **PU-ACC Admin** menu on the spreadsheet:

1. **Setup workspace** — creates all tabs, headers, formats, Drive tree, counters, config
2. **Seed reference data** — lookups, permission matrix, named ranges, validation
3. Load master data: `Users`, `Vendors`, `Items`, `Warehouses`, `Payment_Terms`, `Tax_Codes`,
   `Approval_Matrix`, `QC_Specs`, `QC_Spec_Params`
4. **Install triggers**
5. Deploy → **New deployment → Web app**, *execute as me*, *access: anyone within the domain*.
   Give users the **versioned** URL, never `/dev`.

Every user must exist in `Users` with `is_active = TRUE` and at least one role, or the app
refuses them by design.

## 3. Fill in `Config` before go-live

`ensureConfig()` seeds sensible defaults but leaves the group addresses blank. Set at minimum:
`COMPANY_NAME`, `QC_GROUP_EMAIL`, `QC_MGR_EMAIL`, `WH_GROUP_EMAIL`, `AP_GROUP_EMAIL`,
`FIN_MGR_EMAIL`, `PUR_MGR_EMAIL`. Review the tolerances in Appendix A §3 with Finance and QC —
`PRICE_TOL_PCT` and `OVER_RECEIPT_TOL_PCT` are financial controls, not technical settings.

## 4. Document templates

Create Google Docs in `/PU-ACC/00_System/Templates/` using `{{PLACEHOLDER}}` tokens. The PO
template needs a line table whose **last row is the styled prototype**; set
`TPL_PO_LINE_TABLE_INDEX` in `Config` if it is not the second table in the document.

PO tokens: `{{PO_NO}} {{REV}} {{PO_DATE}} {{VENDOR_CODE}} {{VENDOR_NAME}} {{VENDOR_ADDRESS}}
{{VENDOR_CONTACT}} {{BUYER}} {{INCOTERM}} {{PAYMENT_TERM}} {{DELIVERY_DATE}} {{WAREHOUSE}}
{{CURRENCY}} {{SUBTOTAL}} {{DISCOUNT}} {{VAT}} {{TOTAL}} {{TOTAL_WORDS}} {{REMARK}}
{{APPROVED_BY}} {{APPROVED_AT}}`

## 5. Regression scenarios — walk all six before each release

`seedDemoData()` (DEV only; refuses to run when `ENV=PROD`) creates a vendor, item, QC spec and
one PO to start from.

1. **Happy path** — PO → approve → send → receive full qty → QC pass → GRN posts → register
   invoice → auto-match → approve → pay → PO closes.
2. **Partial receipt** — receive 60%; PO stays `PARTIALLY_RECEIVED` with `qty_open` correct; the
   invoice for the received portion matches; the balance stays open.
3. **QC failure** — record a critical failure; confirm the NCR is created, the GRN goes to
   `QUARANTINE`, Purchasing and AP are notified, and `qc_hold_flag` blocks payment.
4. **Split lot** — two lots on one GRN, one passing and one failing; the good lot posts and
   becomes invoiceable, the bad lot quarantines. **This is the scenario that breaks most often.**
5. **Price variance** — invoice 5% above PO price; confirm `PRICE_OVER` routes to the buyer,
   payment is blocked, and resolution + re-match clears it.
6. **Invoice before goods** — register an invoice with no posted GRN; confirm `NO_GRN`, then post
   the receipt and confirm the nightly re-run matches it automatically.

`runUnitTests()` covers the pure functions (AQL sample size, amount in words, duplicate hashing,
formula-injection guard, date maths, log redaction) and touches no spreadsheet data.

## 6. Conventions to keep

- **All writes go through `Repo`**, inside `withLock_`. Read-modify-write outside the lock is the
  classic Sheets race condition: two concurrent GRN posts both read the same `qty_open`.
- **Status changes only via `StateMachine.fire()`.** Writing a status with `Repo.update` skips the
  guards and the audit row.
- **One `getValues()` per tab per execution.** `Repo` memoises per invocation; do not reach for
  `getRange().getValue()` in a loop.
- **Never trust an email in a request body** — identity is `Session.getActiveUser()`.
- **Never log bank details.** `Json.safe()` redacts them; use it for every `payload_json`.
- **Add a column in `00_Schema.gs`, never in the Sheet.** Re-run `setupWorkspace()` to apply it.

## 7. Known gaps in this scaffold

Deliberate — they need decisions from the business, not more code:

- **Department entry screens.** `index.html` is the shell plus the read-only views. The PO grid,
  GRN capture, QC form and AP match workbench are per-department UI work; the API actions they
  need already exist in `Api.routes()`.
- **AppSheet app.** Not buildable from source — configure it against the same tabs, and rely on
  `guardAppSheetWrite_` to re-validate what it writes.
- **`FX_API_URL`** is unset, so rates are entered manually until you pick a source.
- **WHT calculation** is carried on the invoice rather than derived; Thai WHT rates vary by service
  type and need a rule table from Finance.
- **Landed cost allocation** (freight and duty spread across lines) is scoped as Phase 6.
- **`rolloverYear()`** — the year-end carry-forward described in Appendix B §4 is not implemented;
  build and rehearse it on UAT during the first Q4.

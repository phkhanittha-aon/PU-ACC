# Appendix B — Limits, Sizing, Archiving, and the Exit Path

Google Sheets will run this system well at the volume described below. It will not run it well at ten times that
volume. Knowing where the wall is — before you hit it — is the difference between a planned migration and an
emergency one.

---

## 1. Hard platform limits

| Resource | Limit | Consequence when hit |
|---|---|---|
| Cells per spreadsheet | **10,000,000** | Cannot add rows at all. Not a soft warning — a wall |
| Columns per sheet | 18,278 | Not a practical concern here |
| Rows per sheet | 10M cells ÷ column count | The real constraint |
| Characters per cell | 50,000 | Truncate `payload_json` in logs |
| Tabs per spreadsheet | ~200 (cell-bound) | 41 tabs used |
| Concurrent editors | 100 (API writes contend far sooner) | Practical ceiling ~25–30 active users |
| `IMPORTRANGE`/volatile formulas | performance-bound | Which is why all `VW_*` are script-materialised |
| Drive items per folder | ~500k | Folder-per-PO keeps counts tiny |
| Apps Script execution | 6 min | Chunk long jobs |
| Apps Script runtime/day | 90 min (Workspace) | ~25 min used at modelled volume |
| Triggers per script | 20 | 9 used |
| Emails/day | 1,500 (Workspace) / 100 (consumer) | **A consumer Gmail account cannot run this system** |
| `LockService` wait | configurable, 30 s used | `SYSTEM_BUSY` error surfaced to the user |
| URL Fetch/day | 100,000 | Not a concern |

---

## 2. Sizing model

Assumption: **200 POs per month**, 4 lines each, 1.3 receipts per PO, 1 QC per receipt line, 1.1 invoices per PO.

| Tab | Rows/month | Rows/year | Cols | Cells/year |
|---|---|---|---|---|
| `PO_Header` | 200 | 2,400 | 55 | 132,000 |
| `PO_Lines` | 800 | 9,600 | 34 | 326,400 |
| `GRN_Header` | 260 | 3,120 | 42 | 131,040 |
| `GRN_Lines` | 1,100 | 13,200 | 32 | 422,400 |
| `QC_Header` | 1,100 | 13,200 | 48 | 633,600 |
| `QC_Lines` | 13,200 | 158,400 | 20 | **3,168,000** |
| `Invoice_Header` | 220 | 2,640 | 52 | 137,280 |
| `Invoice_Lines` | 880 | 10,560 | 24 | 253,440 |
| `Match_Results` | 1,200 | 14,400 | 30 | 432,000 |
| `Documents` | 2,500 | 30,000 | 25 | 750,000 |
| `Status_History` | 6,000 | 72,000 | 18 | **1,296,000** |
| `Notification_Log` | 3,000 | 36,000 | 15 | 540,000 |
| Others (masters, PR, NCR, payments, config) | — | ~30,000 | ~30 | ~900,000 |
| **Total** | | | | **≈ 9.1M** |

That is uncomfortably close to 10M in a single year, and the two culprits are obvious: **`QC_Lines` (10 params ×
every inspected lot) and `Status_History`**. Mitigations, in order of preference:

1. **One spreadsheet per fiscal year** (already the design) — resets the count annually.
2. **Move `QC_Lines` and `Notification_Log` to their own spreadsheets** (`PU-ACC-QC-2026`, `PU-ACC-LOG-2026`),
   referenced by ID from `Config`. The repository layer already abstracts which file a tab lives in, so this is a
   configuration change, not a rewrite.
3. **Quarterly rotation of `Status_History` and `Notification_Log`** into archive spreadsheets, keeping the
   current quarter hot. KPI jobs read the archive only for historical reports.
4. **Trim `payload_json`** to changed fields only — it is the widest column in the widest tab.

At **400+ POs/month you must do items 2 and 3 from day one**, and at 800+ you should be reading §5 rather than
optimising tabs.

---

## 3. Performance expectations

| Operation | Target | Notes |
|---|---|---|
| Load dashboard | < 2 s | From `VW_*` materialised tabs + `CacheService` |
| Open a PO with 10 lines | < 1.5 s | Indexed single-tab reads |
| Save a GRN with 8 lot lines | < 3 s | Inside the lock; includes QC creation |
| Run 3-way match on 50 invoices | < 60 s | Batched, chunked |
| Global search by document number | < 2 s | `TextFinder` on indexed columns |
| Nightly integrity + views | < 6 min total | Chunked across functions if it grows |

If a save routinely exceeds 5 seconds, the cause is almost always a loop doing per-row `getRange()` calls or a
live formula recalculating a whole tab — not Sheets being "slow".

---

## 4. Archiving strategy

| What | When | Where |
|---|---|---|
| Closed POs (Drive folder) | 30 days after `CLOSED` | `/03_Archive/{YYYY}/{PO_NO}/` |
| `Status_History`, `Notification_Log` | quarterly | `PU-ACC-LOG-{YYYY}-Q{n}` spreadsheet |
| Whole fiscal year | at year-end close | Spreadsheet marked read-only; a new `PU-ACC-DB-{YYYY+1}` is created by `setupWorkspace()`; **open POs, open invoices, and all master data are carried forward** by `rolloverYear()` |
| Backups | nightly | `/00_System/Backups/{YYYY}/{MM}/`, 30-day rolling |
| Statutory retention | per Thai Revenue Code (5 years, 7 recommended) | Archive spreadsheets + Drive folders retained; `Documents.retention_until` drives purge eligibility |

Year-end rollover is the one operation that must be rehearsed on UAT before it runs on PROD. Carrying open
commitments across files is where a naive implementation loses the link between last year's PO and this year's
invoice.

---

## 5. The exit path

Sheets is the right choice *now* — zero licence cost, everyone already understands it, and the whole system can
be built by one person in a quarter. It becomes the wrong choice at a predictable point.

### Migrate when any of these becomes true

| Signal | Threshold |
|---|---|
| Transaction volume | > 600 POs/month sustained |
| Active concurrent users | > 30 |
| `SYSTEM_BUSY` lock errors | > 5/day |
| Save latency | p95 > 5 s after batching is correct |
| Audit requirement | External auditor requires enforced field-level access or immutable ledger guarantees |
| Integration need | Real-time integration with a finance system or WMS |
| Multi-entity | A second legal entity with separate books |

### How the migration stays cheap

The design already puts a seam in the right place:

```
Front-ends  →  Api.gs (auth + validation + state machine)  →  Repo.gs  →  Sheets
                                                              ↑
                                              swap this one layer  →  Cloud SQL / BigQuery / Supabase
```

`01_Repo.gs` is the only file that knows data lives in Sheets. Everything above it deals in records and
transitions. A staged migration therefore looks like:

1. **Mirror** — nightly export of all tabs to BigQuery for reporting. Removes analytical load from Sheets and
   gives you months of validated history in the target schema. Low risk, immediate benefit.
2. **Re-point the repository** — implement `Repo` against Cloud SQL (Postgres) with the identical method
   signatures. Run both in parallel with a comparison job for one month.
3. **Replace the front-end last, if at all.** The Apps Script web app can keep serving a Postgres-backed
   `Repo` via JDBC. AppSheet connects natively to Cloud SQL. You may never need to rewrite the UI.
4. **Retire Sheets to reporting only.**

Column names in doc 02 are deliberately SQL-safe (`snake_case`, no spaces, no reserved words) and every table has
a surrogate UUID key, so the schema transfers to a relational database with `CREATE TABLE` statements and no
renaming. That is not an accident — it is the cheapest insurance in this blueprint.

### What you will *not* get from Sheets, ever

Be candid with Finance about these up front, so nobody discovers them during an audit:

- **No transactional integrity.** A failure between "GRN posted" and "PO lines updated" leaves an inconsistency
  that only the nightly integrity job will catch.
- **No enforced field-level security.** Anyone with the file URL and edit rights can change a posted record.
  Access control is by *not sharing the file* — an administrative control, not a technical one.
- **No immutable audit trail.** `Status_History` is append-only by convention and code, not by platform
  guarantee. A determined admin can edit it. If you need a tamper-evident ledger, that is a migration trigger.
- **No real referential integrity.** Every constraint in this design is enforced by code that you must keep
  correct.

None of that makes the plan wrong. It makes the plan a deliberate trade — cheap and fast now, with a known exit —
rather than an accident you discover in year two.

# Appendix A — Lookups, Numbering, Tolerances, KPI Formulas

Seed data for the `Lookups`, `Counters`, and `Config` tabs. Loaded by `seedReferenceData()` in
[`apps-script/09_Setup.gs`](../apps-script/09_Setup.gs).

---

## 1. Document numbering (`Counters`)

Format `{PREFIX}-{YY}-{NNNN}` — short enough to read aloud on the phone, long enough for 9,999 documents a year
per type. The counter resets each fiscal year, which is why the year is in the number.

| `counter_key` | Prefix | Example | Padding |
|---|---|---|---|
| `PR` | `PR` | `PR-26-0018` | 4 |
| `PO` | `PO` | `PO-26-0042` | 4 |
| `GRN` | `GR` | `GR-26-0311` | 4 |
| `QC` | `QC` | `QC-26-0290` | 4 |
| `NCR` | `NCR` | `NCR-26-0031` | 4 |
| `RTV` | `RTV` | `RTV-26-0009` | 4 |
| `INVOICE` | `AP` | `AP-26-0501` | 4 |
| `PAYMENT` | `PAY` | `PAY-26-0188` | 4 |
| `DEBIT_NOTE` | `DN` | `DN-26-0012` | 4 |
| `CREDIT_NOTE` | `CN` | `CN-26-0007` | 4 |

Rules: numbers are issued inside the `LockService` lock at record creation, are **never reused** (a cancelled
`PO-26-0042` leaves a permanent gap — gaps are evidence, not errors), and revisions extend the number rather than
consuming a new one (`PO-26-0042 R1`).

---

## 2. Lookup enumerations (`Lookups`)

| `lookup_group` | Codes |
|---|---|
| `PR_STATUS` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `CONVERTED`, `REJECTED`, `CANCELLED` |
| `PO_STATUS` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SENT_TO_VENDOR`, `ACKNOWLEDGED`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`, `SHORT_CLOSED`, `INVOICED`, `ON_HOLD`, `CLOSED`, `CANCELLED` |
| `PO_LINE_STATUS` | `OPEN`, `PARTIAL`, `RECEIVED`, `CLOSED`, `SHORT_CLOSED`, `CANCELLED` |
| `RECEIPT_STATUS` | `NONE`, `PARTIAL`, `FULL`, `OVER` |
| `INVOICE_STATUS_PO` | `NONE`, `PARTIAL`, `FULL`, `OVER` |
| `GRN_STATUS` | `DRAFT`, `SUBMITTED`, `PENDING_QC`, `QC_IN_PROGRESS`, `QC_PENDING_LAB`, `QC_PASSED`, `QC_CONDITIONAL`, `QC_FAILED`, `QUARANTINE`, `PARTIALLY_POSTED`, `POSTED`, `RETURN_TO_VENDOR`, `CLOSED_RTV`, `SCRAPPED`, `REVERSED`, `CANCELLED` |
| `GRN_LINE_STATUS` | `PENDING_QC`, `ACCEPTED`, `REJECTED`, `PARTIAL_ACCEPT`, `ON_HOLD`, `RETURNED`, `SCRAPPED` |
| `QC_STATUS` | `PENDING`, `ASSIGNED`, `SAMPLING`, `TESTING`, `PENDING_LAB`, `PENDING_APPROVAL`, `COMPLETED`, `CANCELLED` |
| `QC_RESULT` | `PENDING`, `PASS`, `FAIL`, `CONDITIONAL` |
| `QC_INSPECTION_TYPE` | `INCOMING`, `REWORK`, `RE_INSPECTION`, `LAB_ONLY`, `DOC_ONLY` |
| `QC_FAIL_REASON` | `SENSORY_FAIL`, `WEIGHT_SHORT`, `TEMP_ABUSE`, `MICRO_FAIL`, `CHEMICAL_FAIL`, `FOREIGN_MATTER`, `PACKAGING_DAMAGE`, `LABEL_INCORRECT`, `SHELF_LIFE_SHORT`, `DOC_MISSING`, `SPEC_DEVIATION`, `ELECTRICAL_FAIL`, `DIMENSION_OUT`, `WRONG_ITEM` |
| `DEFECT_CLASS` | `CRITICAL`, `MAJOR`, `MINOR` |
| `NCR_STATUS` | `OPEN`, `VENDOR_NOTIFIED`, `VENDOR_RESPONDED`, `DISPOSITION_APPROVED`, `REMEDY_IN_PROGRESS`, `CLOSED`, `ESCALATED`, `CANCELLED` |
| `NCR_DISPOSITION` | `RETURN`, `REWORK`, `SCRAP`, `CONCESSION`, `PRICE_DEDUCTION`, `REPLACEMENT`, `USE_AS_IS` |
| `NCR_CLAIM_TARGET` | `VENDOR`, `CARRIER`, `INTERNAL`, `INSURANCE` |
| `CLAIM_TYPE` | `DEBIT_NOTE`, `CREDIT_NOTE_EXPECTED`, `REPLACEMENT`, `NONE` |
| `INVOICE_TYPE` | `GOODS`, `DEPOSIT`, `FREIGHT`, `DUTY`, `SERVICE`, `CREDIT_NOTE`, `DEBIT_NOTE` |
| `MATCH_STATUS` | `RECEIVED`, `MATCHING`, `MATCHED`, `EXCEPTION`, `NO_GRN`, `QC_HOLD`, `DISPUTED`, `CREDIT_NOTE_PENDING`, `APPROVED_FOR_PAYMENT`, `SCHEDULED`, `PAID`, `REJECTED` |
| `PAYMENT_STATUS_INV` | `UNPAID`, `PARTIALLY_PAID`, `PAID`, `VOID` |
| `EXCEPTION_CODE` | `PRICE_OVER`, `PRICE_UNDER`, `QTY_OVER`, `QTY_NO_RECEIPT`, `QC_REJECTED`, `DUP_INVOICE`, `TAX_MISMATCH`, `FX_MISMATCH`, `UOM_MISMATCH`, `PO_CLOSED`, `NO_PO`, `DEPOSIT_UNAPPLIED` |
| `PAYMENT_STATUS` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `SCHEDULED`, `EXECUTED`, `PAID`, `CANCELLED`, `FAILED` |
| `PAYMENT_METHOD` | `TT`, `LOCAL_TRANSFER`, `CHEQUE`, `LC`, `CASH` |
| `VENDOR_STATUS` | `PROSPECT`, `APPROVED`, `CONDITIONAL`, `SUSPENDED`, `BLACKLISTED` |
| `VENDOR_TYPE` | `LOCAL`, `IMPORT`, `SERVICE`, `FORWARDER`, `LAB` |
| `INCOTERM` | `EXW`, `FCA`, `FOB`, `CFR`, `CIF`, `CPT`, `CIP`, `DAP`, `DPU`, `DDP` |
| `UOM` | `KG`, `G`, `TON`, `PCS`, `BOX`, `CTN`, `PALLET`, `SET`, `M`, `M2`, `L`, `ROLL`, `BAG`, `SERVICE` |
| `STORAGE_CONDITION` | `AMBIENT`, `CHILLED`, `FROZEN`, `DRY` |
| `DOC_TYPE` | as listed in doc 02 §6.1 |
| `ITEM_GROUP` | `FOOD`, `SEAFOOD`, `SOLAR`, `MECHANICAL`, `PACKAGING`, `CONSUMABLE`, `SERVICE` |
| `ROLE` | `REQUESTER`, `BUYER`, `PUR_MGR`, `WH_OFFICER`, `WH_SUP`, `QC_INSPECTOR`, `QC_MGR`, `AP_OFFICER`, `FIN_MGR`, `MGMT_VIEW`, `SYS_ADMIN` |

---

## 3. Configuration defaults (`Config`)

| Key | Default | Meaning |
|---|---|---|
| `PRICE_TOL_PCT` | `2` | Invoice price variance tolerance (%) |
| `PRICE_TOL_ABS_THB` | `200` | Absolute price tolerance; the **lower** of pct/abs applies |
| `AMOUNT_TOL_ABS_THB` | `500` | Whole-invoice rounding tolerance |
| `OVER_RECEIPT_TOL_PCT` | `2` | Default over-delivery tolerance (item master overrides) |
| `PO_REAPPROVAL_INCREASE_PCT` | `5` | Revision increase that forces re-approval |
| `PRICE_ALERT_PCT` | `10` | Price rise vs last purchase that demands justification |
| `MIN_SHELF_LIFE_PCT` | `75` | Default remaining shelf life at receipt (item master overrides) |
| `QC_SLA_HOURS` | `24` | Standard inspection SLA |
| `QC_SLA_HOURS_LAB` | `48` | SLA when lab testing is required |
| `PR_APPROVAL_SLA_HOURS` | `24` | |
| `PO_APPROVAL_SLA_HOURS` | `24` | |
| `GR_BOOKING_SLA_HOURS` | `4` | Arrival → GRN submitted |
| `AP_REGISTER_SLA_HOURS` | `24` | |
| `EXCEPTION_SLA_HOURS` | `48` | |
| `PAYMENT_APPROVAL_SLA_HOURS` | `48` | |
| `NO_GRN_ESCALATION_DAYS` | `7` | Parked invoice escalation |
| `LAB_CHASE_AFTER_DAYS` | `1` | Days past `lab_due_at` before chasing |
| `ALLOW_CONDITIONAL_RELEASE` | `FALSE` | Release quarantined stock pending lab results |
| `DUAL_APPROVAL_PAYMENT_THB` | `500000` | Payments above this need two approvers |
| `MAX_UPLOAD_MB` | `25` | |
| `FX_SOURCE` | `BOT` | Reference rate source |
| `FX_TOL_PCT` | `1` | Invoice FX rate variance tolerance |
| `DIGEST_SEND_HOUR` | `8` | |
| `ARCHIVE_AFTER_DAYS_CLOSED` | `30` | |
| `BACKUP_RETENTION_DAYS` | `30` | |
| `ENV` | `PROD` | Guards destructive admin actions |

### Approval matrix starter (`Approval_Matrix`)

| Doc | Amount band (THB) | L1 | L2 | L3 |
|---|---|---|---|---|
| PR | any | requester's manager | — | — |
| PO | ≤ 50,000 | `PUR_MGR` | — | — |
| PO | 50,001 – 500,000 | `PUR_MGR` | `FIN_MGR` | — |
| PO | > 500,000 | `PUR_MGR` | `FIN_MGR` | MD | 
| PO revision | ↑ > 5% or new band | original chain re-run | | |
| GRN over-tolerance | any | `WH_SUP` | `BUYER` (parallel) | — |
| QC conditional accept | any | `QC_MGR` | `BUYER` (parallel) | — |
| NCR disposition | impact ≤ 50,000 | `QC_MGR` | — | — |
| NCR disposition | impact > 50,000 | `QC_MGR` | `PUR_MGR` | `FIN_MGR` |
| Invoice | ≤ 500,000 | `FIN_MGR` | — | — |
| Invoice | > 500,000 | `FIN_MGR` | MD | — |
| Payment | ≤ 500,000 | `FIN_MGR` | — | — |
| Payment | > 500,000 | `FIN_MGR` | MD | — |

Tune the bands to your delegation of authority before go-live — these are placeholders, not policy.

---

## 4. KPI formulas

All computed from `Status_History` unless noted. `dur(entity, A→B)` = hours between the transition into A and the
transition into B for that record.

| KPI | Formula |
|---|---|
| PR → PO cycle time | mean `dur(PR submitted → PR CONVERTED)` |
| PO approval time | mean `dur(PO PENDING_APPROVAL → APPROVED)` |
| PO issue lag | mean `dur(PO APPROVED → SENT_TO_VENDOR)` |
| Delivery lead time | mean (`GRN.received_datetime − PO.sent_to_vendor_at`) in days |
| On-time delivery % | `count(GRN where received_datetime ≤ promised_delivery_date) / count(GRN) × 100` |
| Delivery accuracy % | `count(GRN lines where |variance_pct| ≤ tolerance) / count(GRN lines) × 100` |
| GR booking lag | mean `dur(goods arrival → GRN SUBMITTED)` |
| QC turnaround | mean `QC_Header.turnaround_hours` |
| QC SLA compliance % | `count(QC where turnaround ≤ sla) / count(QC) × 100` |
| QC pass rate % | `Σ qty_accepted / Σ qty_submitted × 100` (by vendor, item, month) |
| Lot rejection rate % | `count(QC where result = FAIL) / count(QC) × 100` |
| NCR rate | `count(NCR) / count(GRN) × 100` |
| Claim value | `Σ NCR.financial_impact_thb` by vendor |
| CAPA on-time closure % | `count(capa_closed_at ≤ capa_due_date) / count(NCR with CAPA) × 100` |
| GR → invoice lag | mean (`Invoice.received_date − GRN.posted_at`) in days |
| **First-pass match rate %** | `count(invoices MATCHED with no exception on run 1) / count(invoices) × 100` |
| Exception resolution time | mean `dur(EXCEPTION → MATCHED)` |
| Invoice → payment days | mean (`paid_at − invoice received_date`) |
| DPO | `Σ AP balance / Σ purchases × days in period` |
| Open commitment value | `Σ PO_Lines.qty_open × unit_price` for POs not `CLOSED` |
| GR/IR balance | `Σ (qty_accepted − qty_invoiced) × unit_price` — the accrual number for month-end |
| **Bottleneck rank** | rank stages by `open_count × mean_aging_hours`, desc |
| Vendor overall score | `0.4 × on_time% + 0.4 × qc_pass% + 0.2 × (100 − doc_error%)` |

Vendor scorecard grading: `A ≥ 90`, `B 80–89`, `C 70–79`, `D < 70`. Two consecutive quarters at `D` should
trigger a vendor review — and the system should be the thing that tells you, not a spreadsheet someone maintains
by hand.

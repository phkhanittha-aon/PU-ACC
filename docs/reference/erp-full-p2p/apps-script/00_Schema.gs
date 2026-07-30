/**
 * 00_Schema.gs — the authoritative table definitions.
 *
 * This file is the single source of truth for tab names, columns, primary keys,
 * uniqueness constraints and document counters. docs/02-data-model-google-sheets.md
 * describes it in prose; setupWorkspace() builds the spreadsheet from it; Repo reads
 * headers from it. Change a column here, not in the Sheet.
 *
 * Column order in `cols` IS the physical column order in the Sheet.
 */

/** Tab name constants — always reference tabs through this, never a string literal. */
const SHEETS = {
  // master
  USERS: 'Users',
  ROLES: 'Roles_Permissions',
  VENDORS: 'Vendors',
  ITEMS: 'Items',
  WAREHOUSES: 'Warehouses',
  COST_CENTERS: 'Cost_Centers',
  PAYMENT_TERMS: 'Payment_Terms',
  TAX_CODES: 'Tax_Codes',
  FX: 'Currencies_FX',
  APPROVAL_MATRIX: 'Approval_Matrix',
  QC_SPECS: 'QC_Specs',
  QC_SPEC_PARAMS: 'QC_Spec_Params',
  // transaction
  PR_HEADER: 'PR_Header',
  PR_LINES: 'PR_Lines',
  PO_HEADER: 'PO_Header',
  PO_LINES: 'PO_Lines',
  PO_REVISIONS: 'PO_Revisions',
  GRN_HEADER: 'GRN_Header',
  GRN_LINES: 'GRN_Lines',
  QC_HEADER: 'QC_Header',
  QC_LINES: 'QC_Lines',
  NCR: 'NCR',
  INV_HEADER: 'Invoice_Header',
  INV_LINES: 'Invoice_Lines',
  MATCH_RESULTS: 'Match_Results',
  PAYMENTS: 'Payments',
  PAY_ALLOC: 'Payment_Allocations',
  STOCK_LEDGER: 'Stock_Ledger',
  // system
  DOCUMENTS: 'Documents',
  HISTORY: 'Status_History',
  NOTIF_LOG: 'Notification_Log',
  ERROR_LOG: 'Error_Log',
  IDEMPOTENCY: 'Idempotency',
  COUNTERS: 'Counters',
  CONFIG: 'Config',
  LOOKUPS: 'Lookups',
  // views (materialised nightly)
  VW_BOTTLENECK: 'VW_Bottleneck',
  VW_OPEN_PO: 'VW_Open_PO',
  VW_PENDING_QC: 'VW_Pending_QC',
  VW_AP_EXCEPTIONS: 'VW_AP_Exceptions',
  VW_SCORECARD: 'VW_Vendor_Scorecard'
};

/** Tabs that may live in a separate spreadsheet once volume demands it (see Appendix B §2). */
const OVERFLOW_TABS = {};
OVERFLOW_TABS[SHEETS.QC_LINES] = 'SPREADSHEET_ID_QC';
OVERFLOW_TABS[SHEETS.HISTORY] = 'SPREADSHEET_ID_LOG';
OVERFLOW_TABS[SHEETS.NOTIF_LOG] = 'SPREADSHEET_ID_LOG';

const c = s => s.trim().split(/\s+/);

const AUDIT_COLS = 'created_by created_at updated_by updated_at row_version';

const SCHEMA = {};

/* ------------------------------------------------------------------ master */

SCHEMA[SHEETS.USERS] = {
  pk: 'user_id', unique: ['email'],
  cols: c(`user_id email full_name employee_code department job_title role_codes
           warehouse_scope cost_center_scope approval_limit_thb delegate_email delegate_until
           manager_email notify_channel digest_optin is_active created_at updated_at`)
};

SCHEMA[SHEETS.ROLES] = {
  pk: null, unique: [],
  cols: c(`role_code role_name module permission scope field_restrictions is_active notes`)
};

SCHEMA[SHEETS.VENDORS] = {
  pk: 'vendor_id', unique: ['vendor_code'],
  cols: c(`vendor_id vendor_code vendor_name_en vendor_name_th vendor_type tax_id branch_code
           country address contact_name contact_email contact_phone default_currency
           payment_term_code default_incoterm lead_time_days min_order_value bank_name
           bank_account_no bank_swift wht_type qc_required_default approved_status approval_date
           approval_expiry_date certifications cert_expiry_earliest last_audit_date next_audit_date
           scorecard_quality scorecard_delivery scorecard_overall drive_folder_id is_active
           ${AUDIT_COLS} notes`)
};

SCHEMA[SHEETS.ITEMS] = {
  pk: 'item_id', unique: ['item_code'],
  cols: c(`item_id item_code item_name_en item_name_th category sub_category item_group
           uom_base uom_purchase uom_conversion_factor hs_code is_food lot_tracked shelf_life_days
           min_remaining_shelf_life_pct storage_condition storage_temp_min_c storage_temp_max_c
           qc_required qc_spec_id inspection_level over_receipt_tolerance_pct standard_cost
           last_purchase_price last_purchase_currency last_purchase_date default_vendor_code
           default_gl_account tax_code is_active created_at updated_at`)
};

SCHEMA[SHEETS.WAREHOUSES] = {
  pk: 'warehouse_id', unique: ['warehouse_code'],
  cols: c(`warehouse_id warehouse_code warehouse_name address storage_types supervisor_email
           qc_room_available is_active`)
};

SCHEMA[SHEETS.COST_CENTERS] = {
  pk: 'cost_center_code', unique: ['cost_center_code'],
  cols: c(`cost_center_code name department owner_email budget_year budget_amount_thb is_active`)
};

SCHEMA[SHEETS.PAYMENT_TERMS] = {
  pk: 'term_code', unique: ['term_code'],
  cols: c(`term_code description base_event net_days deposit_pct balance_days is_active`)
};

SCHEMA[SHEETS.TAX_CODES] = {
  pk: 'tax_code', unique: ['tax_code'],
  cols: c(`tax_code description vat_rate_pct wht_rate_pct is_reverse_charge gl_account is_active`)
};

SCHEMA[SHEETS.FX] = {
  pk: 'fx_id', unique: [],
  cols: c(`fx_id fx_date currency rate_to_thb rate_type source fetched_at entered_by`)
};

SCHEMA[SHEETS.APPROVAL_MATRIX] = {
  pk: 'rule_id', unique: ['rule_id'],
  cols: c(`rule_id doc_type department item_group amount_from_thb amount_to_thb level approver_role
           approver_email resolve_by is_parallel sla_hours escalate_to_email escalate_after_hours
           condition_expr is_active effective_from notes`)
};

SCHEMA[SHEETS.QC_SPECS] = {
  pk: 'qc_spec_id', unique: ['qc_spec_id'],
  cols: c(`qc_spec_id item_id item_code spec_version effective_from effective_to inspection_type
           aql_level sample_plan_ref critical_aql major_aql minor_aql doc_requirements lab_required
           lab_turnaround_days approved_by approved_at is_current spec_file_id notes`)
};

SCHEMA[SHEETS.QC_SPEC_PARAMS] = {
  pk: 'param_id', unique: ['param_id'],
  cols: c(`param_id qc_spec_id seq param_group param_name test_method unit spec_min spec_max
           spec_target spec_text is_critical defect_class is_mandatory requires_lab requires_photo
           is_active`)
};

/* ------------------------------------------------------------- transaction */

SCHEMA[SHEETS.PR_HEADER] = {
  pk: 'pr_id', unique: ['pr_no'], counter: 'PR',
  cols: c(`pr_id pr_no pr_date requester_email department cost_center_code project_code need_by_date
           purpose priority currency total_est_amount total_est_amount_thb status
           approval_level_current approved_by approved_at reject_reason converted_po_nos sla_due_at
           ${AUDIT_COLS}`)
};

SCHEMA[SHEETS.PR_LINES] = {
  pk: 'pr_line_id', unique: ['pr_line_id'],
  cols: c(`pr_line_id pr_no line_no item_id item_code description qty uom est_unit_price currency
           est_amount need_by_date suggested_vendor_code spec_note line_status po_no po_line_no notes`)
};

SCHEMA[SHEETS.PO_HEADER] = {
  pk: 'po_id', unique: ['po_no'], counter: 'PO',
  cols: c(`po_id po_no po_revision po_date revision_date vendor_id vendor_code vendor_name
           buyer_email department cost_center_code project_code currency fx_rate fx_date incoterm
           port_of_loading port_of_discharge shipment_mode payment_term_code deposit_pct credit_days
           requested_delivery_date promised_delivery_date warehouse_id subtotal_amount
           discount_amount other_charges vat_amount wht_amount total_amount total_amount_thb
           status receipt_status invoice_status approval_level_required approval_level_current
           approved_by approved_at reject_reason sent_to_vendor_at vendor_ack_at vendor_ack_ref
           pdf_file_id drive_folder_id has_open_ncr open_ncr_nos short_close_reason closed_at
           close_reason pr_nos sla_due_at remark ${AUDIT_COLS}`)
};

SCHEMA[SHEETS.PO_LINES] = {
  pk: 'po_line_id', unique: ['po_line_id'],
  cols: c(`po_line_id po_no po_revision line_no item_id item_code description spec_note qty_ordered
           uom unit_price currency discount_pct line_amount tax_code tax_amount requested_date
           promised_date qty_received qty_accepted qty_rejected qty_returned qty_scrapped
           qty_invoiced qty_paid qty_open over_tolerance_pct qc_required qc_spec_id line_status
           gl_account cost_center_code notes`)
};

SCHEMA[SHEETS.PO_REVISIONS] = {
  pk: 'rev_id', unique: ['rev_id'], appendOnly: true,
  cols: c(`rev_id po_no revision revised_at revised_by change_type line_no field_changed old_value
           new_value amount_delta_thb reason requires_reapproval approved_by approved_at
           vendor_notified_at pdf_file_id`)
};

SCHEMA[SHEETS.GRN_HEADER] = {
  pk: 'grn_id', unique: ['grn_no', 'idempotency_key'], counter: 'GRN',
  cols: c(`grn_id grn_no grn_date received_datetime po_no po_revision_at_receipt vendor_code
           warehouse_id receiver_email carrier_name vehicle_or_container_no seal_no seal_intact
           delivery_note_no delivery_note_date vendor_invoice_no_ref bl_awb_no import_entry_no
           temp_on_arrival_c truck_condition hygiene_check_pass total_lines total_qty_received
           total_qty_damaged doc_required_list doc_received_list doc_missing_list doc_complete
           qc_required qc_nos qc_result_summary status posted_at posted_by reversal_of_grn_no
           reversed_by_grn_no ncr_nos rtv_no drive_folder_id photo_count signature_file_id
           idempotency_key remark ${AUDIT_COLS}`)
};

SCHEMA[SHEETS.GRN_LINES] = {
  pk: 'grn_line_id', unique: ['grn_line_id'],
  cols: c(`grn_line_id grn_no line_no po_no po_line_no item_id item_code description lot_no
           production_date expiry_date remaining_shelf_life_days shelf_life_ok
           qty_on_delivery_note qty_received uom qty_damaged qty_short pack_size pack_count
           gross_weight_kg net_weight_kg pallet_ids location_bin storage_temp_c variance_qty
           variance_pct over_tolerance_flag over_tolerance_approved_by qty_accepted qty_rejected
           qty_on_hold reject_reason_code qc_no ncr_no line_status unit_price_snapshot notes`)
};

SCHEMA[SHEETS.QC_HEADER] = {
  pk: 'qc_id', unique: ['qc_no'], counter: 'QC',
  cols: c(`qc_id qc_no grn_no grn_line_id po_no vendor_code item_id item_code lot_no qc_spec_id
           spec_version inspection_type assigned_to inspector_email requested_at sla_due_at
           started_at completed_at turnaround_hours qty_submitted uom sample_size aql_level
           critical_defects major_defects minor_defects defect_rate_pct params_total params_pass
           params_fail lab_required lab_name lab_sent_at lab_due_at lab_result_received_at
           lab_report_file_id qty_accepted qty_rejected qty_conditional result fail_reason_codes
           conditional_reason conditional_deduction_pct conditional_approved_by
           conditional_approved_at buyer_agreed_by ncr_no verified_by verified_at report_file_id
           drive_folder_id photo_count status remark ${AUDIT_COLS}`)
};

SCHEMA[SHEETS.QC_LINES] = {
  pk: 'qc_line_id', unique: ['qc_line_id'],
  cols: c(`qc_line_id qc_no param_id seq param_group param_name test_method unit spec_min spec_max
           spec_text measured_value measured_text result defect_class defect_qty is_critical
           photo_file_ids tested_by tested_at lab_ref remark`)
};

SCHEMA[SHEETS.NCR] = {
  pk: 'ncr_id', unique: ['ncr_no'], counter: 'NCR',
  cols: c(`ncr_id ncr_no ncr_date source_type source_no po_no grn_no qc_no vendor_code item_code
           lot_no qty_affected uom unit_price currency defect_category defect_detail severity
           claim_target root_cause root_cause_category disposition disposition_proposed_by
           disposition_approved_by disposition_approved_at financial_impact_amount
           financial_impact_thb claim_type claim_amount debit_note_no credit_note_no
           credit_note_received_at vendor_notified_at vendor_response vendor_response_at
           capa_action capa_owner capa_due_date capa_closed_at capa_effective blocks_payment
           status owner_email drive_folder_id closed_at ${AUDIT_COLS}`)
};

SCHEMA[SHEETS.INV_HEADER] = {
  pk: 'inv_id', unique: ['inv_internal_no', 'duplicate_check_hash'], counter: 'INVOICE',
  cols: c(`inv_id inv_internal_no vendor_invoice_no vendor_code invoice_date received_date
           registered_at invoice_type po_no grn_nos currency fx_rate fx_date subtotal_amount
           discount_amount other_charges vat_amount wht_amount deduction_amount total_amount
           net_payable total_amount_thb tax_invoice_no tax_invoice_date tax_code payment_term_code
           due_date discount_due_date match_status match_run_at match_exception_codes
           first_pass_match qc_hold_flag qc_hold_reason hold_released_by hold_released_at
           deposit_applied_amount deposit_invoice_no approved_by approved_at approval_level
           payment_status payment_nos paid_amount paid_at reject_reason dispute_reason
           dispute_owner duplicate_check_hash gl_period posted_to_gl gl_export_batch file_id
           drive_folder_id ap_owner_email ${AUDIT_COLS}`)
};

SCHEMA[SHEETS.INV_LINES] = {
  pk: 'inv_line_id', unique: ['inv_line_id'],
  cols: c(`inv_line_id inv_internal_no line_no po_no po_line_no grn_no grn_line_id item_code
           description qty_invoiced uom unit_price discount_pct line_amount tax_code tax_amount
           gl_account cost_center_code matched_qty matched_amount qty_variance price_variance
           amount_variance match_result exception_code resolution_note notes`)
};

SCHEMA[SHEETS.MATCH_RESULTS] = {
  pk: 'match_id', unique: ['match_id'], appendOnly: true,
  cols: c(`match_id run_at run_by inv_internal_no inv_line_id po_no po_line_no grn_nos
           po_unit_price po_revision_used grn_accepted_qty already_invoiced_qty matchable_qty
           inv_qty inv_unit_price qty_variance qty_variance_pct price_variance price_variance_pct
           amount_variance tolerance_applied ncr_deduction_pct within_tolerance exception_code
           exception_detail decision routed_to resolved_by resolved_at resolution_action
           resolution_note`)
};

SCHEMA[SHEETS.PAYMENTS] = {
  pk: 'payment_id', unique: ['payment_no'], counter: 'PAYMENT',
  cols: c(`payment_id payment_no payment_date value_date vendor_code payment_method
           bank_account_from currency fx_rate gross_amount wht_amount deduction_amount bank_fee
           net_amount net_amount_thb invoice_count status prepared_by approved_by approved_at
           second_approved_by executed_by executed_at bank_ref_no wht_cert_no remittance_file_id
           remittance_sent_at remark created_at updated_at row_version`)
};

SCHEMA[SHEETS.PAY_ALLOC] = {
  pk: 'alloc_id', unique: ['alloc_id'],
  cols: c(`alloc_id payment_no inv_internal_no allocated_amount wht_amount deduction_amount
           deduction_ncr_no residual_amount notes`)
};

SCHEMA[SHEETS.STOCK_LEDGER] = {
  pk: 'ledger_id', unique: ['ledger_id'], appendOnly: true, optional: true,
  cols: c(`ledger_id txn_datetime txn_type source_doc_type source_doc_no warehouse_id location_bin
           item_code lot_no expiry_date qty_in qty_out uom unit_cost value_in value_out running_qty
           running_value created_by`)
};

/* ------------------------------------------------------------------ system */

SCHEMA[SHEETS.DOCUMENTS] = {
  pk: 'doc_id', unique: ['doc_id'],
  cols: c(`doc_id doc_type entity_type entity_no po_no drive_file_id file_name file_url mime_type
           size_bytes page_count version is_current supersedes_doc_id folder_id checksum_md5
           is_required verification_status verified_by verified_at reject_reason uploaded_by
           uploaded_at source valid_from valid_to retention_until is_archived notes`)
};

SCHEMA[SHEETS.HISTORY] = {
  pk: 'log_id', unique: ['log_id'], appendOnly: true,
  cols: c(`log_id at_ts entity_type entity_no entity_id action from_status to_status actor_email
           actor_role on_behalf_of duration_in_prev_status_hrs sla_hours sla_breached reason
           changed_fields payload_json source request_id`)
};

SCHEMA[SHEETS.NOTIF_LOG] = {
  pk: 'notif_id', unique: ['notif_id'],
  cols: c(`notif_id created_at channel template_id to_recipients cc subject entity_type entity_no
           vars_json status attempts next_retry_at sent_at message_id error dedupe_key`)
};

SCHEMA[SHEETS.ERROR_LOG] = {
  pk: 'err_id', unique: ['err_id'], appendOnly: true,
  cols: c(`err_id at_ts severity function_name entity_type entity_no error_message stack
           actor_email payload_json request_id resolved resolved_by resolved_at`)
};

SCHEMA[SHEETS.IDEMPOTENCY] = {
  pk: 'idempotency_key', unique: ['idempotency_key'],
  cols: c(`idempotency_key created_at function_name entity_type entity_no result_json expires_at`)
};

SCHEMA[SHEETS.COUNTERS] = {
  pk: 'counter_key', unique: ['counter_key'],
  cols: c(`counter_key prefix year last_number padding format updated_at`)
};

SCHEMA[SHEETS.CONFIG] = {
  pk: 'config_key', unique: ['config_key'],
  cols: c(`config_key config_value data_type group description updated_by updated_at`)
};

SCHEMA[SHEETS.LOOKUPS] = {
  pk: null, unique: [],
  cols: c(`lookup_group code label_en label_th sort_order is_active meta_json parent_code`)
};

/* ------------------------------------------------------------------- views */

SCHEMA[SHEETS.VW_BOTTLENECK] = {
  pk: null, view: true,
  cols: c(`refreshed_at stage owner_role open_count mean_aging_hrs max_aging_hrs breached_count
           bucket_0_24 bucket_24_48 bucket_48_72 bucket_over_72 bottleneck_score bottleneck_rank`)
};
SCHEMA[SHEETS.VW_OPEN_PO] = {
  pk: null, view: true,
  cols: c(`refreshed_at po_no vendor_code vendor_name buyer_email po_date promised_delivery_date
           days_late qty_open_lines value_open_thb receipt_status invoice_status status`)
};
SCHEMA[SHEETS.VW_PENDING_QC] = {
  pk: null, view: true,
  cols: c(`refreshed_at qc_no grn_no item_code lot_no qty_submitted requested_at aging_hrs
           sla_due_at sla_breached inspector_email lab_required lab_due_at status`)
};
SCHEMA[SHEETS.VW_AP_EXCEPTIONS] = {
  pk: null, view: true,
  cols: c(`refreshed_at inv_internal_no vendor_code total_amount_thb exception_code routed_to
           aging_hrs sla_breached po_no match_status`)
};
SCHEMA[SHEETS.VW_SCORECARD] = {
  pk: null, view: true,
  cols: c(`refreshed_at period vendor_code vendor_name po_count on_time_pct qc_pass_pct ncr_count
           claim_value_thb avg_lead_time_days doc_error_pct overall_score grade`)
};

/** Tabs that must exist for the system to boot. */
function schemaTabNames() {
  return Object.keys(SCHEMA);
}

/** Header row for a tab. */
function schemaCols(tab) {
  const def = SCHEMA[tab];
  if (!def) throw new Error('Unknown tab in SCHEMA: ' + tab);
  return def.cols;
}

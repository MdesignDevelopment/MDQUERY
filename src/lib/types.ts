export type Role = 'user' | 'lead' | 'curator' | 'admin';
export type RiskLevel = 'safe' | 'scoped_write' | 'high_risk';
export type ItemType = 'query' | 'workflow';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  department: string;
}

export interface QueryParamDef {
  name: string;
  data_type: string; // text | number | date | enum
  default_value: string | null;
  enum_options: string[] | null;
  label: string | null;
  /** When true, the form field accepts multiple values (one per line or comma-separated),
   *  each formatted per data_type and comma-joined — for binds used inside IN (:param). */
  is_list: boolean;
}

export interface CategoryRow {
  id: number;
  owner_id: number | null;
  is_public: boolean;
  name: string;
  created_at: string;
}

export interface QueryRow {
  id: number;
  owner_id: number | null;
  is_public: boolean;
  source_query_id: number | null;
  source_body_snapshot: string | null;
  shared_from: { from_user_id: number; from_user_name: string; source_item_id: number; shared_at: string } | null;
  tag: string;
  title: string;
  description: string;
  body: string;
  documentation: string;
  department: string | null;
  client_label: string | null;
  category_id: number | null;
  category_name?: string | null;
  risk_level: RiskLevel;
  flagged_stale: boolean;
  stale_note: string | null;
  created_at: string;
  updated_at: string;
  updated_by: number | null;
  params?: QueryParamDef[];
  favorited?: boolean;
  owner_name?: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface LintFinding {
  severity: Severity;
  code: string;
  message: string;
  line: number; // 1-based
  col: number; // 1-based
  /** if set, saving requires this confirmation token from the user */
  requires?: 'CONFIRM_NO_WHERE' | 'ACK_DDL';
}

export interface ValidationResult {
  findings: LintFinding[];
  risk_level: RiskLevel;
  statement_kinds: string[];
  ok: boolean; // no errors
}

export interface WorkflowStepRow {
  id: number;
  workflow_id: number;
  query_id: number;
  step_order: number;
  param_bindings: Record<string, { source: string }>; // targetParam -> { source: "step_<order>.<param>" }
  note: string | null;
  query?: QueryRow;
}

export interface WorkflowRow {
  id: number;
  owner_id: number | null;
  is_public: boolean;
  tag: string;
  title: string;
  description: string;
  client_label: string | null;
  category_id: number | null;
  category_name?: string | null;
  shared_from: QueryRow['shared_from'];
  flagged_stale: boolean;
  stale_note: string | null;
  created_at: string;
  updated_at: string;
  steps?: WorkflowStepRow[];
  risk_level?: RiskLevel;
  favorited?: boolean;
  owner_name?: string;
}

export interface ReviewRequestRow {
  id: number;
  item_type: ItemType;
  item_id: number;
  target_public_id: number | null;
  request_type: 'new_promotion' | 'update';
  proposed: { tag: string; title: string; description: string; body: string; department: string | null; validation?: ValidationResult; steps?: unknown[] };
  status: 'pending' | 'approved' | 'rejected';
  requested_by: number;
  requested_by_name?: string;
  reviewed_by: number | null;
  reviewed_by_name?: string;
  reviewed_at: string | null;
  review_notes: string | null;
  parent_request_id: number | null;
  created_at: string;
}

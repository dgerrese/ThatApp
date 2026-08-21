// A hand-written mirror of the Go response structs. There is no shared type
// definition across the language boundary; the API is small enough that drift
// surfaces immediately in the UI.

export interface Instance {
  id: number;
  name: string;
  /** Empty when the instance was migrated from a gateway URL, which carries no recoverable site. */
  siteUrl: string;
  apiBaseUrl: string;
  email: string;
  createdAt: string;
}

export interface ConnectionTest {
  accountId: string;
  displayName: string;
}

/** The fields a create or update sends. An absent token means "keep the stored one". */
export interface InstanceDraft {
  name: string;
  siteUrl: string;
  email: string;
  token?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface Issue {
  key: string;
  summary: string;
  status: string;
  /** Empty when the instance has no site URL, which leaves nothing to link to. */
  url: string;
}

/** One instance's assigned issues, or the reason it has none. */
export interface InstanceIssues {
  id: number;
  name: string;
  issues: Issue[];
  error: ApiErrorBody | null;
}

export interface IssuesResponse {
  instances: InstanceIssues[];
}

export interface Pin {
  id: number;
  instanceId: number;
  instanceName: string;
  /** 0-based index into the instance list's created_at order — what instanceHue keys its dot off. */
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: ApiErrorBody | null;
}

export interface IssueHit {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
}

export interface InstanceFailure {
  instanceId: number;
  instanceName: string;
  error: ApiErrorBody;
}

export interface IssueSearchResponse {
  results: IssueHit[];
  errors: InstanceFailure[];
}

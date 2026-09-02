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

/**
 * One logged entry, as the dialog and the rail read it. `day` and `startedAt`
 * are stamped by the server and never sent by the browser, which is what keeps
 * the day boundary answerable in THAT_TIMEZONE with no browser open.
 *
 * `startedAt` is RFC 3339 already converted to that zone — read the wall clock
 * out of the string rather than through Date, which would re-convert it to
 * whatever zone this browser happens to be in.
 */
export interface Entry {
  id: number;
  instanceId: number;
  instanceName: string;
  /** 0-based index into the instance list's created_at order — what instanceHue keys its dot off. */
  instancePosition: number;
  issueKey: string;
  day: string;
  startedAt: string;
  seconds: number;
  comment: string;
  /** Derived server-side from worklog_id, pushed_at and updated_at — never stored. */
  pushState: "unpushed" | "pushed" | "dirty";
}

/** The fields a create sends. The server stamps the rest. */
export interface EntryDraft {
  instanceId: number;
  issueKey: string;
  seconds: number;
  comment: string;
}

/**
 * The fields an edit sends. Both optional, because the API tells an absent
 * field from a cleared one: an omitted comment keeps what is stored, and an
 * empty string erases it. `startedAt` is not here and never will be.
 */
export interface EntryEdit {
  seconds?: number;
  comment?: string;
}

export interface PushResult {
  entryId: number;
  issueKey: string;
  instanceId: number;
  status: "pushed" | "skipped" | "failed";
  worklogId?: string;
  error?: { code: string; message: string };
}

export interface PushResponse {
  day: string;
  results: PushResult[];
}

/**
 * One ticket's time on one day. `pushState` is null exactly when the cell is
 * empty, which keeps "nothing logged" from becoming a fourth state.
 */
export interface WeekCell {
  seconds: number;
  pushState: "unpushed" | "pushed" | "dirty" | null;
}

export interface WeekDay {
  day: string;
  seconds: number;
  pushState: "unpushed" | "pushed" | "dirty" | null;
}

export interface WeekRow {
  instanceId: number;
  instanceName: string;
  /** 0-based index into the instance list's created_at order — what instanceHue keys its dot off. */
  instancePosition: number;
  issueKey: string;
  /** Exactly seven, index-aligned with the rollup's `days`. */
  cells: WeekCell[];
  seconds: number;
}

export interface WeekRollup {
  start: string;
  end: string;
  /** The Mondays either side, resolved server-side so the browser derives no date. */
  prevStart: string;
  nextStart: string;
  /** ISO 8601 week number of `start`, from Go's time.ISOWeek() — the browser
   *  never computes one, because ISO week numbering goes wrong in hand-written
   *  TypeScript exactly at year boundaries. */
  weekNumber: number;
  days: WeekDay[];
  rows: WeekRow[];
  seconds: number;
}

import type {
  ApiErrorBody,
  ConnectionTest,
  Instance,
  InstanceDraft,
  IssueSearchResponse,
  IssuesResponse,
  Pin,
} from "./types";

/**
 * A failed API call. The code is what callers branch on: a rejected credential
 * and an unreachable host both fail a connection test and need different words,
 * and matching on message text would break the moment one is reworded.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** A response body plus when it was cached: null for one that came off the wire. */
export type Cached<T> = { value: T; cachedAt: Date | null };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestWithMeta<T>(path, init)).value;
}

async function requestWithMeta<T>(path: string, init?: RequestInit): Promise<Cached<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (error) {
    // A caller-initiated abort (type-ahead superseding its own previous
    // request) is not a reachability failure. Rethrow it as-is so the caller
    // can recognise its own AbortError instead of meeting a wrapped
    // ApiError that reads exactly like a real outage.
    if (init?.signal?.aborted) throw error;
    throw new ApiError(0, "network_error", "Could not reach the dashboard server.");
  }

  if (!response.ok) {
    throw new ApiError(response.status, ...(await errorFrom(response)));
  }

  const cachedAtHeader = response.headers.get("X-WD-Cached-At");
  const cachedAt = cachedAtHeader === null ? null : new Date(cachedAtHeader);

  if (response.status === 204) {
    return { value: undefined as T, cachedAt };
  }

  return { value: (await response.json()) as T, cachedAt };
}

/** Reads the server's {code, message} envelope, falling back when a proxy or crash returns something else. */
async function errorFrom(response: Response): Promise<[string, string]> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.code && body.message) {
      return [body.code, body.message];
    }
  } catch {
    // Fall through to the generic message below.
  }

  return ["unexpected", `The server returned ${response.status}.`];
}

export function listInstances(): Promise<Instance[]> {
  return request<Instance[]>("/api/instances");
}

export function createInstance(draft: InstanceDraft): Promise<Instance> {
  return request<Instance>("/api/instances", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function updateInstance(id: number, draft: InstanceDraft): Promise<Instance> {
  return request<Instance>(`/api/instances/${id}`, {
    method: "PATCH",
    body: JSON.stringify(draft),
  });
}

export function deleteInstance(id: number): Promise<void> {
  return request<void>(`/api/instances/${id}`, { method: "DELETE" });
}

export function testInstance(id: number): Promise<ConnectionTest> {
  return request<ConnectionTest>(`/api/instances/${id}/test`, { method: "POST" });
}

export function listIssues(): Promise<Cached<IssuesResponse>> {
  return requestWithMeta<IssuesResponse>("/api/issues");
}

export function listPins(options?: { refresh?: boolean }): Promise<Cached<Pin[]>> {
  return requestWithMeta<Pin[]>(options?.refresh === true ? "/api/pins?refresh=1" : "/api/pins");
}

export function createPin(instanceId: number, issueKey: string): Promise<Pin> {
  return request<Pin>("/api/pins", {
    method: "POST",
    body: JSON.stringify({ instanceId, issueKey }),
  });
}

export function deletePin(id: number): Promise<void> {
  return request<void>(`/api/pins/${id}`, { method: "DELETE" });
}

/**
 * The signal is required rather than optional: type-ahead is the first place in
 * this app where a second request can overtake the first, and the last response
 * to arrive is not reliably the last one asked for.
 */
export function searchIssues(query: string, signal: AbortSignal): Promise<IssueSearchResponse> {
  return request<IssueSearchResponse>(
    `/api/issues/search?q=${encodeURIComponent(query)}`,
    { signal },
  );
}

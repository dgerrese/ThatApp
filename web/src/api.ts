import type { ApiErrorBody, ConnectionTest, Instance, InstanceDraft } from "./types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the dashboard server.");
  }

  if (!response.ok) {
    throw new ApiError(response.status, ...(await errorFrom(response)));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
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

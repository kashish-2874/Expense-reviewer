import type { AiReview, AppConfig, ClaimDetail, ClaimInput, ClaimStatus, ClaimSummary, DecisionAction, Totals } from "./types";

// Thin fetch wrapper. Every failure becomes an ApiError carrying the server's
// { error, details } body, so components can show one consistent message.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }

  // Field-level messages from a 400 "Validation failed" response, if any.
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { path?: string; message?: string }[])
        .filter((d) => d.path && d.message)
        .map((d) => [d.path!, d.message!]),
    );
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the server. Is the API running?", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.details);
  }
  return body as T;
}

const post = <T>(path: string, data: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data) });

export const api = {
  config: () => request<AppConfig>("/config"),
  listClaims: (status?: ClaimStatus) => request<ClaimSummary[]>(`/claims${status ? `?status=${status}` : ""}`),
  getClaim: (id: number) => request<ClaimDetail>(`/claims/${id}`),
  createClaim: (claim: ClaimInput) => post<ClaimDetail>("/claims", claim),
  runReview: (id: number, reviewer: string) => post<AiReview>(`/claims/${id}/review`, reviewer ? { reviewer } : {}),
  decide: (id: number, body: { reviewer: string; action: DecisionAction; reason?: string; overrideCategory?: string }) =>
    post<{ decisionId: number }>(`/claims/${id}/decision`, body),
  totals: () => request<Totals>("/totals"),
};

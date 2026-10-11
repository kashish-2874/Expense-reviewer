import type {
  AiReview,
  AppConfig,
  ClaimDetail,
  ClaimInput,
  ClaimPage,
  ClaimReceipt,
  ClaimStatus,
  DecisionAction,
  Totals,
  User,
} from "./types";

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

// Called on any 401 from a protected endpoint (an expired or missing
// session). The auth context registers this to log the user out and send
// them to the login page.
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: (() => void) | undefined) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // The session is an httpOnly cookie; same-origin requests (the dev proxy,
      // or the server serving the UI in production) send it automatically.
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the server. Is the API running?", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // A 401 from the auth endpoints is a normal answer ("wrong password",
    // "not logged in yet"); anywhere else it means the session is gone.
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    // Our API always answers errors with a JSON body. A 5xx without one comes
    // from the dev proxy when the API server is not running.
    if (!body && res.status >= 500) {
      throw new ApiError("Cannot reach the API server. Start it with \"npm run dev\" in the server folder.", res.status);
    }
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.details);
  }
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export interface ClaimListQuery {
  page: number;
  limit: number;
  status?: ClaimStatus;
}

export const api = {
  // public
  config: () => request<AppConfig>("/config"),
  createClaim: (claim: ClaimInput) => post<ClaimReceipt>("/claims", claim),

  // auth
  me: () => request<{ user: User }>("/auth/me"),
  login: (username: string, password: string) => post<{ user: User }>("/auth/login", { username, password }),
  logout: () => post<null>("/auth/logout"),

  // reviewer area (needs a session)
  listClaims: ({ page, limit, status }: ClaimListQuery) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set("status", status);
    return request<ClaimPage>(`/claims?${params}`);
  },
  getClaim: (id: number) => request<ClaimDetail>(`/claims/${id}`),
  runReview: (id: number) => post<AiReview>(`/claims/${id}/review`, {}),
  decide: (id: number, body: { action: DecisionAction; reason?: string; overrideCategory?: string }) =>
    post<{ decisionId: string }>(`/claims/${id}/decision`, body),
  totals: () => request<Totals>("/totals"),
};

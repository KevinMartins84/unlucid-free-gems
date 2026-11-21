export const CLAIM_URL = "https://unlucid.ai/gems?/claim";
export const GEMS_DATA_URL = "https://unlucid.ai/gems/__data.json";

const remainingMsValueRegex =
  /"remainingMs"\s*:\s*\d+\s*\}\s*,\s*(\d+)/;

export type ClaimResult = {
  success: boolean;
  error: string | null;
  nextFreeGemsAtUtc: string | null;
  authBlocked: boolean;
};

export function tryParseSvelteKitAction(
  json: string,
): { ok: boolean; type: string | null; status: number | null; message: string | null } {
  if (!json.trim()) return { ok: false, type: null, status: null, message: null };
  try {
    const root = JSON.parse(json) as {
      type?: string;
      status?: number;
      data?: unknown;
    };
    if (!root.type) return { ok: false, type: null, status: null, message: null };
    return {
      ok: true,
      type: root.type,
      status: typeof root.status === "number" ? root.status : null,
      message: extractActionMessage(root.data),
    };
  } catch {
    return { ok: false, type: null, status: null, message: null };
  }
}

function extractActionMessage(dataEl: unknown): string | null {
  if (typeof dataEl === "string") {
    const raw = dataEl.trim();
    if (!raw) return null;
    try {
      const inner = JSON.parse(raw) as unknown[];
      if (Array.isArray(inner)) {
        for (const item of inner) {
          if (typeof item === "string") return item;
        }
      }
    } catch {
      return raw;
    }
    return raw;
  }
  if (Array.isArray(dataEl)) {
    for (const item of dataEl) {
      if (typeof item === "string") return item;
    }
  }
  return null;
}

export function tryParseRemainingMs(gemsDataJson: string): { ok: boolean; remainingMs: number } {
  if (!gemsDataJson.trim()) return { ok: false, remainingMs: 0 };
  const match = remainingMsValueRegex.exec(gemsDataJson);
  if (!match) return { ok: false, remainingMs: 0 };
  const remainingMs = Number(match[1]);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return { ok: false, remainingMs: 0 };
  return { ok: true, remainingMs };
}

function authCookieHint(cookie: string): string {
  const lower = cookie.toLowerCase();
  if (
    lower.includes("better-auth.session_token") ||
    lower.includes("session-token") ||
    lower.includes("session_token")
  ) {
    return "Session cookie may be expired — paste a fresh Cookie header from unlucid.ai/gems.";
  }
  return "Cookie is missing __Secure-better-auth.session_token — paste the full Cookie header from your browser.";
}

function truncate(value: string | null, maxLength: number): string {
  if (!value) return "";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function createAuthedRequest(method: string, url: string, cookie: string): RequestInit {
  return {
    method,
    headers: {
      accept: "*/*",
      "accept-language": "nl,en;q=0.9,en-GB;q=0.8,en-US;q=0.7",
      origin: "https://unlucid.ai",
      referer: "https://unlucid.ai/gems",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0",
      Cookie: cookie,
    },
  };
}

function createClaimRequest(cookie: string): RequestInit {
  return {
    ...createAuthedRequest("POST", CLAIM_URL, cookie),
    headers: {
      ...createAuthedRequest("POST", CLAIM_URL, cookie).headers,
      accept: "application/json",
      "x-sveltekit-action": "true",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  };
}

async function trySyncNextFreeGemsFromGemsPage(cookie: string): Promise<string | null> {
  const response = await fetch(GEMS_DATA_URL, {
    ...createAuthedRequest("GET", GEMS_DATA_URL, cookie),
    headers: {
      ...createAuthedRequest("GET", GEMS_DATA_URL, cookie).headers,
      accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const body = await response.text();
  const remaining = tryParseRemainingMs(body);
  if (remaining.ok) {
    return new Date(Date.now() + remaining.remainingMs).toISOString();
  }
  const parsed = tryFindNextFreeGemsAt(JSON.parse(body) as unknown);
  return parsed;
}

export function parseNextFreeGemsFromJsonBody(json: string): string | null {
  if (!json.trim()) return null;
  try {
    return tryFindNextFreeGemsAt(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

function tryFindNextFreeGemsAt(element: unknown): string | null {
  if (element && typeof element === "object") {
    if (Array.isArray(element)) {
      for (const item of element) {
        const found = tryFindNextFreeGemsAt(item);
        if (found) return found;
      }
    } else {
      for (const [key, value] of Object.entries(element)) {
        if (key === "nextFreeGemsAt" || key === "next_free_gems_at") {
          const ms = readUnixMilliseconds(value);
          if (ms) return new Date(ms).toISOString();
        }
        const found = tryFindNextFreeGemsAt(value);
        if (found) return found;
      }
    }
  }
  return null;
}

function readUnixMilliseconds(value: unknown): number | null {
  if (typeof value === "number" && value > 0) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export async function tryClaimAsync(cookie: string): Promise<{
  authFailure: boolean;
  error: string | null;
  nextFreeGemsAtUtc: string | null;
}> {
  const response = await fetch(CLAIM_URL, createClaimRequest(cookie));
  const body = await response.text();

  const action = tryParseSvelteKitAction(body);
  if (action.ok) {
    if (
      action.type?.toLowerCase() === "success" ||
      (action.status !== null && action.status >= 200 && action.status < 300)
    ) {
      const synced = (await trySyncNextFreeGemsFromGemsPage(cookie)) ?? new Date(Date.now() + 86_400_000).toISOString();
      return { authFailure: false, error: null, nextFreeGemsAtUtc: synced };
    }
    if (action.status === 409) {
      const synced = await trySyncNextFreeGemsFromGemsPage(cookie);
      if (synced) return { authFailure: false, error: action.message ?? "Already claimed for today.", nextFreeGemsAtUtc: synced };
      return {
        authFailure: false,
        error: `Already claimed but could not determine next free time. Body: ${truncate(body, 300)}`,
        nextFreeGemsAtUtc: null,
      };
    }
    if (action.status === 401 || action.status === 403) {
      return {
        authFailure: true,
        error: `HTTP ${action.status}: ${action.message ?? truncate(body, 200)}. ${authCookieHint(cookie)}`,
        nextFreeGemsAtUtc: null,
      };
    }
    return {
      authFailure: false,
      error: `Action ${action.type} HTTP ${action.status}: ${action.message ?? truncate(body, 300)}`,
      nextFreeGemsAtUtc: null,
    };
  }

  if (response.ok) {
    const fromBody = parseNextFreeGemsFromJsonBody(body);
    if (fromBody) return { authFailure: false, error: null, nextFreeGemsAtUtc: fromBody };
    const synced = await trySyncNextFreeGemsFromGemsPage(cookie);
    if (synced) {
      return {
        authFailure: false,
        error: "Claim succeeded but response had no next time; synced from /gems/__data.json.",
        nextFreeGemsAtUtc: synced,
      };
    }
    return { authFailure: false, error: `Response missing next free time. Body: ${truncate(body, 300)}`, nextFreeGemsAtUtc: null };
  }

  if (response.status === 409) {
    const synced = await trySyncNextFreeGemsFromGemsPage(cookie);
    if (synced) return { authFailure: false, error: "Already claimed for today (synced from /gems/__data.json).", nextFreeGemsAtUtc: synced };
    return { authFailure: false, error: `Already claimed but could not determine next free time. Body: ${truncate(body, 300)}`, nextFreeGemsAtUtc: null };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      authFailure: true,
      error: `HTTP ${response.status}: ${truncate(body, 200)}. ${authCookieHint(cookie)}`,
      nextFreeGemsAtUtc: null,
    };
  }

  return { authFailure: false, error: `HTTP ${response.status}: ${truncate(body, 300)}`, nextFreeGemsAtUtc: null };
}
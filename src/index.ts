import {
  deleteRow,
  getById,
  getMeta,
  insertClaimLog,
  insertRow,
  listAll,
  listClaimLogs,
  listDue,
  setAuthBlocked,
  setMeta,
  updateNextFree,
  updateRow,
  type LoginRowInput,
} from "./db";
import { tryClaimAsync } from "./claim";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

const GITHUB_PAGES_PREFIX = "https://kevinmartins84.github.io";

function jsonResponse(body: unknown, init: ResponseInit = {}, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value) headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

function unauthorized(extraHeaders: HeadersInit = {}): Response {
  return jsonResponse({ error: "Unauthorized" }, { status: 401 }, extraHeaders);
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const allowed =
    origin.startsWith(GITHUB_PAGES_PREFIX) ||
    origin.includes("workers.dev") ||
    origin.includes("pages.dev") ||
    origin === new URL(request.url).origin;
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function requireAuth(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && token === env.ADMIN_TOKEN;
}

function parseNextUtcOrAsap(text: string | null | undefined): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "1970-01-01T00:00:00.000Z";
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid UTC date/time. Use ISO 8601, e.g. 2026-03-23T12:00:00Z");
  return d.toISOString();
}

function httpStatusFromClaim(error: string | null, authFailure: boolean): number | null {
  if (authFailure) {
    const match = error?.match(/HTTP (\d{3})/);
    return match ? Number(match[1]) : 401;
  }
  return null;
}

async function logClaim(
  env: Env,
  login: string,
  success: boolean,
  authBlocked: boolean,
  error: string | null,
  nextFreeGemsAtUtc: string | null,
  httpStatus: number | null,
): Promise<void> {
  const outcome = authBlocked ? "auth_blocked" : success ? "success" : "failure";
  await insertClaimLog(env.DB, {
    login,
    outcome,
    httpStatus,
    message: error,
    nextFreeGemsAt: nextFreeGemsAtUtc,
  });
}

async function claimRow(env: Env, id: number, login: string, cookie: string, _source: "cron" | "manual") {
  const result = await tryClaimAsync(cookie);
  const httpStatus = result.authFailure ? httpStatusFromClaim(result.error, true) : null;

  if (result.authFailure) {
    await setAuthBlocked(env.DB, id, true);
    await logClaim(env, login, false, true, result.error, null, httpStatus);
    return { id, login, success: false, error: result.error, nextFreeGemsAtUtc: null, authBlocked: true };
  }
  if (result.nextFreeGemsAtUtc) {
    await updateNextFree(env.DB, id, result.nextFreeGemsAtUtc);
    await logClaim(env, login, true, false, result.error, result.nextFreeGemsAtUtc, httpStatus);
    return {
      id,
      login,
      success: true,
      error: result.error,
      nextFreeGemsAtUtc: result.nextFreeGemsAtUtc,
      authBlocked: false,
    };
  }
  await logClaim(env, login, false, false, result.error, null, httpStatus);
  return { id, login, success: false, error: result.error, nextFreeGemsAtUtc: null, authBlocked: false };
}

async function runDueClaims(env: Env): Promise<{ dueCount: number; failureCount: number }> {
  const started = new Date().toISOString();
  await setMeta(env.DB, "lastCronStartedAt", started);
  try {
    const now = new Date().toISOString();
    const due = await listDue(env.DB, now);
    const failures: Array<{ login: string; error: string | null; authBlocked: boolean }> = [];
    for (const row of due) {
      const r = await claimRow(env, row.id, row.login, row.cookie, "cron");
      if (!r.success) failures.push({ login: r.login, error: r.error, authBlocked: r.authBlocked });
    }
    const finished = new Date().toISOString();
    await setMeta(env.DB, "lastCronRunAt", finished);
    if (failures.length === 0) {
      await setMeta(env.DB, "lastCronResult", due.length === 0 ? "idle" : "ok");
      await setMeta(env.DB, "lastCronMessage", due.length === 0 ? "No due rows." : `Claimed ${due.length} row(s) with no failures.`);
    } else {
      await setMeta(env.DB, "lastCronResult", "failures");
      await setMeta(env.DB, "lastCronMessage", `${failures.length} failure(s) of ${due.length} due.`);
      await sendTelegramFailures(env, failures);
    }
    return { dueCount: due.length, failureCount: failures.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setMeta(env.DB, "lastCronRunAt", new Date().toISOString());
    await setMeta(env.DB, "lastCronResult", "error");
    await setMeta(env.DB, "lastCronMessage", message);
    await sendTimerErrorTelegram(env, message);
    throw err;
  }
}

async function sendTelegramFailures(
  env: Env,
  failures: Array<{ login: string; error: string | null; authBlocked: boolean }>,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const lines = failures.map((f) => {
    let line = `• ${escapeHtml(f.login)}: ${escapeHtml(f.error ?? "Unknown error")}`;
    if (f.authBlocked) {
      line +=
        "\n  ⛔ Timer paused for this row until you paste a fresh cookie and run a successful manual Claim.";
    }
    return line;
  });
  const text = `⚠️ <b>Unlucid free gems claim failed</b>\n${lines.join("\n")}`;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

async function sendTimerErrorTelegram(env: Env, message: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const text = `⚠️ <b>Unlucid free gems timer error</b>\n${escapeHtml(message)}`;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function handleHealth(env: Env, cors: Record<string, string>): Promise<Response> {
  const [lastCronRunAt, lastCronResult, lastCronMessage, lastCronStartedAt] = await Promise.all([
    getMeta(env.DB, "lastCronRunAt"),
    getMeta(env.DB, "lastCronResult"),
    getMeta(env.DB, "lastCronMessage"),
    getMeta(env.DB, "lastCronStartedAt"),
  ]);
  return jsonResponse(
    {
      ok: true,
      service: "unlucid-free-gems",
      lastCronRunAt,
      lastCronStartedAt,
      lastCronResult,
      lastCronMessage,
    },
    {},
    cors,
  );
}

async function handleApi(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return handleHealth(env, cors);
  }

  if (!requireAuth(request, env)) return unauthorized(cors);

  if (request.method === "GET" && url.pathname === "/api/rows") {
    const rows = await listAll(env.DB);
    return jsonResponse({ rows }, {}, cors);
  }

  if (request.method === "GET" && url.pathname === "/api/log") {
    const limit = Math.min(Number(url.searchParams.get("limit") || "100"), 500);
    const entries = await listClaimLogs(env.DB, limit);
    return jsonResponse({ entries }, {}, cors);
  }

  if (request.method === "POST" && url.pathname === "/api/rows") {
    const body = (await request.json()) as { login?: string; cookie?: string; nextFreeGemsAt?: string };
    if (!body.login?.trim()) return jsonResponse({ error: "Login is required." }, { status: 400 }, cors);
    if (!body.cookie?.trim()) return jsonResponse({ error: "Cookie is required." }, { status: 400 }, cors);
    let nextFreeGemsAt: string;
    try {
      nextFreeGemsAt = parseNextUtcOrAsap(body.nextFreeGemsAt);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : "Invalid date." }, { status: 400 }, cors);
    }
    const input: LoginRowInput = { login: body.login.trim(), cookie: body.cookie.trim(), nextFreeGemsAt };
    const id = await insertRow(env.DB, input);
    return jsonResponse({ id }, {}, cors);
  }

  const rowMatch = url.pathname.match(/^\/api\/rows\/(\d+)(?:\/(claim))?$/);
  if (rowMatch) {
    const id = Number(rowMatch[1]);
    const isClaim = rowMatch[2] === "claim";

    if (request.method === "PUT") {
      const body = (await request.json()) as { login?: string; cookie?: string; nextFreeGemsAt?: string };
      let nextFreeGemsAt: string;
      try {
        nextFreeGemsAt = parseNextUtcOrAsap(body.nextFreeGemsAt);
      } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : "Invalid date." }, { status: 400 }, cors);
      }
      await updateRow(env.DB, id, {
        login: (body.login ?? "").trim(),
        cookie: (body.cookie ?? "").trim(),
        nextFreeGemsAt,
      });
      return jsonResponse({ ok: true }, {}, cors);
    }

    if (request.method === "DELETE") {
      await deleteRow(env.DB, id);
      return jsonResponse({ ok: true }, {}, cors);
    }

    if (request.method === "POST" && isClaim) {
      const row = await getById(env.DB, id);
      if (!row) return jsonResponse({ error: "Row not found." }, { status: 404 }, cors);
      if (!row.cookie.trim()) {
        return jsonResponse(
          {
            id,
            login: row.login,
            success: false,
            error: "Cookie is empty.",
            authBlocked: row.authBlocked,
          },
          {},
          cors,
        );
      }
      const result = await claimRow(env, id, row.login, row.cookie, "manual");
      return jsonResponse(result, {}, cors);
    }
  }

  return jsonResponse({ error: "Not found" }, { status: 404 }, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url, cors);
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) {
      if (Object.keys(cors).length > 0) {
        const headers = new Headers(asset.headers);
        for (const [key, value] of Object.entries(cors)) headers.set(key, value);
        return new Response(asset.body, { status: asset.status, headers });
      }
      return asset;
    }
    const index = await env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
    return index.status === 404 ? new Response("Not found", { status: 404 }) : index;
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDueClaims(env);
  },
};

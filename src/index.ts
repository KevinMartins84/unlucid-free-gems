import { deleteRow, getById, insertRow, listAll, listDue, setAuthBlocked, updateNextFree, updateRow, type LoginRowInput } from "./db";
import { tryClaimAsync } from "./claim";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function unauthorized(): Response {
  return jsonResponse({ error: "Unauthorized" }, { status: 401 });
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

async function claimRow(env: Env, id: number, login: string, cookie: string) {
  const result = await tryClaimAsync(cookie);
  if (result.authFailure) {
    await setAuthBlocked(env.DB, id, true);
    return { id, login, success: false, error: result.error, nextFreeGemsAtUtc: null, authBlocked: true };
  }
  if (result.nextFreeGemsAtUtc) {
    await updateNextFree(env.DB, id, result.nextFreeGemsAtUtc);
    return { id, login, success: true, error: result.error, nextFreeGemsAtUtc: result.nextFreeGemsAtUtc, authBlocked: false };
  }
  return { id, login, success: false, error: result.error, nextFreeGemsAtUtc: null, authBlocked: false };
}

async function runDueClaims(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const due = await listDue(env.DB, now);
  const failures: Array<{ login: string; error: string | null; authBlocked: boolean }> = [];
  for (const row of due) {
    const r = await claimRow(env, row.id, row.login, row.cookie);
    if (!r.success) failures.push({ login: r.login, error: r.error, authBlocked: r.authBlocked });
  }
  if (failures.length > 0) await sendTelegramFailures(env, failures);
}

async function sendTelegramFailures(
  env: Env,
  failures: Array<{ login: string; error: string | null; authBlocked: boolean }>,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const lines = failures.map((f) => {
    let line = `• ${escapeHtml(f.login)}: ${escapeHtml(f.error ?? "Unknown error")}`;
    if (f.authBlocked) line += "\n  ⛔ Timer paused until a successful manual Claim.";
    return line;
  });
  const text = `⚠️ <b>Unlucid free gems claim failed</b>\n${lines.join("\n")}`;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!requireAuth(request, env)) return unauthorized();

  if (request.method === "GET" && url.pathname === "/api/rows") {
    const rows = await listAll(env.DB);
    return jsonResponse({ rows });
  }

  if (request.method === "POST" && url.pathname === "/api/rows") {
    const body = (await request.json()) as { login?: string; cookie?: string; nextFreeGemsAt?: string };
    if (!body.login?.trim()) return jsonResponse({ error: "Login is required." }, { status: 400 });
    if (!body.cookie?.trim()) return jsonResponse({ error: "Cookie is required." }, { status: 400 });
    let nextFreeGemsAt: string;
    try {
      nextFreeGemsAt = parseNextUtcOrAsap(body.nextFreeGemsAt);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : "Invalid date." }, { status: 400 });
    }
    const input: LoginRowInput = { login: body.login.trim(), cookie: body.cookie.trim(), nextFreeGemsAt };
    const id = await insertRow(env.DB, input);
    return jsonResponse({ id });
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
        return jsonResponse({ error: e instanceof Error ? e.message : "Invalid date." }, { status: 400 });
      }
      await updateRow(env.DB, id, {
        login: (body.login ?? "").trim(),
        cookie: (body.cookie ?? "").trim(),
        nextFreeGemsAt,
      });
      return jsonResponse({ ok: true });
    }

    if (request.method === "DELETE") {
      await deleteRow(env.DB, id);
      return jsonResponse({ ok: true });
    }

    if (request.method === "POST" && isClaim) {
      const row = await getById(env.DB, id);
      if (!row) return jsonResponse({ error: "Row not found." }, { status: 404 });
      if (!row.cookie.trim()) {
        return jsonResponse({
          id,
          login: row.login,
          success: false,
          error: "Cookie is empty.",
          authBlocked: row.authBlocked,
        });
      }
      const result = await claimRow(env, id, row.login, row.cookie);
      return jsonResponse(result);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse({ ok: true, service: "unlucid-free-gems" });
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    const index = await env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
    return index.status === 404 ? new Response("Not found", { status: 404 }) : index;
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDueClaims(env);
  },
};
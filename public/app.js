const storageKeys = { base: "unlucid-api-base", token: "unlucid-admin-token", reveal: "unlucid-reveal-cookies" };

const TZ = "Europe/Amsterdam";
const MIN_UTC = "1970-01-01T00:00:00.000Z";

function isWorkerHost() {
  const { origin, hostname } = window.location;
  return origin.includes("workers.dev") || (hostname !== "kevinmartins84.github.io" && !origin.includes("github.io"));
}

function defaultApiBase() {
  if (isWorkerHost()) return window.location.origin;
  return localStorage.getItem(storageKeys.base) || "";
}

function settings() {
  return {
    base: (localStorage.getItem(storageKeys.base) || defaultApiBase()).replace(/\/$/, ""),
    token: localStorage.getItem(storageKeys.token) || "",
    revealCookies: localStorage.getItem(storageKeys.reveal) === "1",
  };
}

function showMessage(text, isError) {
  const el = document.getElementById("message");
  el.hidden = false;
  el.textContent = text;
  el.className = isError ? "error" : "ok";
}

async function api(path, init = {}) {
  const { base, token } = settings();
  if (!base || !token) throw new Error("Connect with admin token first.");
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function formatAmsterdam(iso) {
  if (!iso || iso.startsWith("1970-01-01")) return "(ASAP)";
  try {
    return new Intl.DateTimeFormat("nl-NL", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso)) + " (Amsterdam)";
  } catch {
    return iso;
  }
}

function rowStatus(row) {
  if (row.authBlocked) return { key: "auth", label: "Auth blocked", className: "badge warn" };
  const due = !row.nextFreeGemsAt || row.nextFreeGemsAt <= MIN_UTC || new Date(row.nextFreeGemsAt).getTime() <= Date.now();
  if (due) return { key: "due", label: "Due", className: "badge due" };
  return { key: "ok", label: "OK", className: "badge ok" };
}

function maskCookie(cookie, reveal) {
  if (!cookie) return "—";
  if (reveal) return cookie;
  const head = cookie.slice(0, 8);
  const tail = cookie.slice(-6);
  return `${head}••••••${tail}`;
}

let editingId = null;
let editDraft = {};
let pendingDeleteId = null;

function renderRows(rows) {
  const { revealCookies } = settings();
  const tbody = document.getElementById("rows-body");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const editing = editingId === row.id;
    const status = rowStatus(row);
    const cookieCell = editing
      ? `<textarea data-field="cookie" rows="2">${escapeHtml(editDraft.cookie || "")}</textarea>`
      : `<span class="cookie-mask">${escapeHtml(maskCookie(row.cookie, revealCookies))}</span>`;
    tr.innerHTML = `
      <td>${row.id}</td>
      <td>${editing ? `<input data-field="login" value="${escapeAttr(editDraft.login)}" />` : escapeHtml(row.login)}</td>
      <td><span class="${status.className}">${status.label}</span></td>
      <td class="mono">${editing ? `<input data-field="next" value="${escapeAttr(editDraft.nextFreeGemsAt || "")}" placeholder="UTC ISO or empty=ASAP" />` : formatAmsterdam(row.nextFreeGemsAt)}</td>
      <td class="mono cookie-cell">${cookieCell}</td>
      <td><div class="actions" data-id="${row.id}"></div></td>
    `;
    tbody.appendChild(tr);
    const actions = tr.querySelector(".actions");
    if (editing) {
      actions.append(makeButton("Save", () => saveEdit(row.id, tr)));
      actions.append(makeButton("Cancel", () => { editingId = null; loadRows(); }, true));
    } else if (pendingDeleteId === row.id) {
      actions.append(makeButton("Confirm delete", () => confirmDelete(row.id), false, true));
      actions.append(makeButton("Cancel", () => { pendingDeleteId = null; loadRows(); }, true));
    } else {
      actions.append(makeButton("Claim now", () => claimRow(row.id)));
      actions.append(makeButton("Edit", () => startEdit(row), true));
      actions.append(makeButton("Delete", () => { pendingDeleteId = row.id; loadRows(); }, true, true));
    }
  }
  document.getElementById("rows-table-wrap").hidden = rows.length === 0;
  const loading = document.getElementById("rows-loading");
  loading.hidden = rows.length > 0;
  loading.textContent = rows.length === 0 ? "No rows yet." : "Loading…";
}

function renderLog(entries) {
  const tbody = document.getElementById("log-body");
  tbody.innerHTML = "";
  for (const entry of entries) {
    const tr = document.createElement("tr");
    const badgeClass =
      entry.outcome === "success" ? "badge ok" : entry.outcome === "auth_blocked" ? "badge warn" : "badge due";
    tr.innerHTML = `
      <td class="mono">${formatAmsterdam(entry.createdAt)}</td>
      <td>${escapeHtml(entry.login)}</td>
      <td><span class="${badgeClass}">${escapeHtml(entry.outcome)}</span></td>
      <td>${entry.httpStatus ?? "—"}</td>
      <td class="message-cell">${escapeHtml(entry.message || "—")}</td>
      <td class="mono">${entry.nextFreeGemsAt ? formatAmsterdam(entry.nextFreeGemsAt) : "—"}</td>
    `;
    tbody.appendChild(tr);
  }
  document.getElementById("log-table-wrap").hidden = entries.length === 0;
  const loading = document.getElementById("log-loading");
  loading.hidden = entries.length > 0;
  loading.textContent = entries.length === 0 ? "No log entries yet." : "Loading…";
}

function makeButton(label, onClick, secondary = false, danger = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.className = secondary ? "secondary" : danger ? "danger" : "primary-inline";
  if (secondary) btn.classList.add("secondary");
  if (danger) btn.classList.add("danger");
  btn.addEventListener("click", onClick);
  return btn;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function startEdit(row) {
  editingId = row.id;
  editDraft = {
    login: row.login,
    cookie: row.cookie,
    nextFreeGemsAt: row.nextFreeGemsAt.startsWith("1970-01-01") ? "" : row.nextFreeGemsAt,
  };
  loadRows();
}

async function loadRows() {
  try {
    const data = await api("/api/rows");
    renderRows(data.rows || []);
  } catch (err) {
    showMessage(err.message, true);
    document.getElementById("rows-loading").hidden = false;
    document.getElementById("rows-loading").textContent = err.message;
  }
}

async function loadLog() {
  try {
    const data = await api("/api/log?limit=100");
    renderLog(data.entries || []);
  } catch (err) {
    showMessage(err.message, true);
    document.getElementById("log-loading").textContent = err.message;
  }
}

async function loadHealth() {
  try {
    const { base } = settings();
    if (!base) return;
    const response = await fetch(`${base}/api/health`);
    const data = await response.json();
    const el = document.getElementById("health-panel");
    if (!data.ok) return;
    el.hidden = false;
    el.innerHTML = `<strong>Cron</strong>: ${data.lastCronResult || "unknown"} — ${data.lastCronRunAt ? formatAmsterdam(data.lastCronRunAt) : "never"}${
      data.lastCronMessage ? ` · ${escapeHtml(data.lastCronMessage)}` : ""
    }`;
  } catch {
    // Health is best-effort on the public endpoint.
  }
}

async function saveEdit(id, tr) {
  const login = tr.querySelector('[data-field="login"]').value.trim();
  const cookie = tr.querySelector('[data-field="cookie"]').value.trim();
  const nextFreeGemsAt = tr.querySelector('[data-field="next"]').value.trim();
  try {
    await api(`/api/rows/${id}`, { method: "PUT", body: JSON.stringify({ login, cookie, nextFreeGemsAt }) });
    editingId = null;
    showMessage("Saved.", false);
    await loadRows();
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function claimRow(id) {
  try {
    const result = await api(`/api/rows/${id}/claim`, { method: "POST", body: "{}" });
    showMessage(
      result.success
        ? `Claim ok — ${result.login}. Next: ${result.nextFreeGemsAtUtc ? formatAmsterdam(result.nextFreeGemsAtUtc) : "—"}`
        : `Claim failed — ${result.login}: ${result.error || "unknown"}`,
      !result.success,
    );
    await Promise.all([loadRows(), loadLog(), loadHealth()]);
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function confirmDelete(id) {
  try {
    await api(`/api/rows/${id}`, { method: "DELETE" });
    pendingDeleteId = null;
    showMessage(`Deleted Id=${id}.`, false);
    await loadRows();
  } catch (err) {
    showMessage(err.message, true);
  }
}

function showMain(connected) {
  document.getElementById("main-panel").hidden = !connected;
  const revealRow = document.getElementById("cookie-reveal-row");
  if (revealRow) revealRow.hidden = !connected;
}

function setupTabs() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.getElementById("tab-rows").hidden = name !== "rows";
      document.getElementById("tab-log").hidden = name !== "log";
      if (name === "log") loadLog();
    });
  }
}

function setupAuthUi() {
  const onWorker = isWorkerHost();
  document.getElementById("api-base-wrap").hidden = onWorker;
  const initial = settings();
  if (onWorker) localStorage.setItem(storageKeys.base, window.location.origin);
  document.getElementById("api-base").value = initial.base;
  document.getElementById("admin-token").value = initial.token;

  const card = document.getElementById("auth-card");
  const reveal = document.createElement("div");
  reveal.id = "cookie-reveal-row";
  reveal.className = "reveal-row";
  reveal.hidden = true;
  reveal.innerHTML = `
    <label class="inline-check">
      <input type="checkbox" id="reveal-cookies" /> Show cookie values
    </label>
  `;
  card.appendChild(reveal);
  document.getElementById("reveal-cookies").checked = initial.revealCookies;
  document.getElementById("reveal-cookies").addEventListener("change", (e) => {
    localStorage.setItem(storageKeys.reveal, e.target.checked ? "1" : "0");
    loadRows();
  });
}

document.getElementById("save-settings").addEventListener("click", async () => {
  const base = (document.getElementById("api-base").value || window.location.origin).trim().replace(/\/$/, "");
  const token = document.getElementById("admin-token").value.trim();
  if (!token) {
    showMessage("Admin token is required.", true);
    return;
  }
  localStorage.setItem(storageKeys.base, base);
  localStorage.setItem(storageKeys.token, token);
  showMessage("Connected.", false);
  showMain(true);
  await Promise.all([loadRows(), loadLog(), loadHealth()]);
});

document.getElementById("add-row").addEventListener("click", async () => {
  const login = document.getElementById("new-login").value.trim();
  const cookie = document.getElementById("new-cookie").value.trim();
  const nextFreeGemsAt = document.getElementById("new-next").value.trim();
  try {
    const data = await api("/api/rows", {
      method: "POST",
      body: JSON.stringify({ login, cookie, nextFreeGemsAt }),
    });
    document.getElementById("new-login").value = "";
    document.getElementById("new-cookie").value = "";
    document.getElementById("new-next").value = "";
    showMessage(`Added row Id=${data.id}.`, false);
    await loadRows();
  } catch (err) {
    showMessage(err.message, true);
  }
});

setupAuthUi();
setupTabs();

const boot = settings();
if (boot.base && boot.token) {
  showMain(true);
  loadRows();
  loadHealth();
}
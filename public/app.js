const storageKeys = { base: "unlucid-api-base", token: "unlucid-admin-token" };

function defaultApiBase() {
  const { origin } = window.location;
  if (origin.includes("workers.dev") || origin.includes("pages.dev")) return origin;
  if (origin.includes("github.io")) return "";
  return origin;
}

function settings() {
  return {
    base: (localStorage.getItem(storageKeys.base) || defaultApiBase()).replace(/\/$/, ""),
    token: localStorage.getItem(storageKeys.token) || "",
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
  if (!base || !token) throw new Error("Set API base URL and admin token first.");
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function formatUtc(value) {
  if (!value || value.startsWith("1970-01-01")) return "(ASAP / min)";
  return `${value.replace("T", " ").replace(/\.\d+Z$/, " UTC")}`;
}

function previewCookie(cookie) {
  if (!cookie) return "—";
  return cookie.length <= 48 ? cookie : `${cookie.slice(0, 48)}…`;
}

let editingId = null;
let editDraft = {};

function renderRows(rows) {
  const tbody = document.getElementById("rows-body");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const editing = editingId === row.id;
    tr.innerHTML = `
      <td>${row.id}</td>
      <td>${editing ? `<input data-field="login" value="${escapeAttr(editing ? editDraft.login : row.login)}" />` : escapeHtml(row.login)}</td>
      <td>${row.authBlocked ? '<span class="badge warn">Auth blocked</span>' : '<span class="badge ok">Active</span>'}</td>
      <td class="mono">${editing ? `<input data-field="next" value="${escapeAttr(editDraft.nextFreeGemsAt || "")}" />` : formatUtc(row.nextFreeGemsAt)}</td>
      <td class="mono">${editing ? `<textarea data-field="cookie" rows="2">${escapeHtml(editDraft.cookie || "")}</textarea>` : escapeHtml(previewCookie(row.cookie))}</td>
      <td><div class="actions" data-id="${row.id}"></div></td>
    `;
    tbody.appendChild(tr);
    const actions = tr.querySelector(".actions");
    if (editing) {
      actions.append(makeButton("Save", () => saveEdit(row.id, tr));
      actions.append(makeButton("Cancel", () => { editingId = null; loadRows(); }, true));
    } else {
      actions.append(makeButton("Claim", () => claimRow(row.id)));
      actions.append(makeButton("Edit", () => {
        editingId = row.id;
        editDraft = {
          login: row.login,
          cookie: row.cookie,
          nextFreeGemsAt: row.nextFreeGemsAt.startsWith("1970-01-01") ? "" : row.nextFreeGemsAt,
        };
        loadRows();
      }, true));
      actions.append(makeButton("Delete", () => deleteRow(row.id), false, true));
    }
  }
  document.getElementById("rows-table").hidden = rows.length === 0;
  document.getElementById("rows-loading").hidden = rows.length > 0;
  if (rows.length === 0) document.getElementById("rows-loading").textContent = "No rows yet.";
}

function makeButton(label, onClick, secondary = false, danger = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
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

async function loadRows() {
  document.getElementById("rows-loading").hidden = false;
  document.getElementById("rows-loading").textContent = "Loading…";
  try {
    const data = await api("/api/rows");
    renderRows(data.rows || []);
  } catch (err) {
    showMessage(err.message, true);
    document.getElementById("rows-loading").textContent = err.message;
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
        ? `Claim ok — ${result.login}. Next free UTC: ${result.nextFreeGemsAtUtc ?? "—"}`
        : `Claim failed — ${result.login}: ${result.error || "unknown"}`,
      !result.success,
    );
    await loadRows();
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function deleteRow(id) {
  if (!confirm(`Delete row ${id}?`)) return;
  try {
    await api(`/api/rows/${id}`, { method: "DELETE" });
    showMessage(`Deleted Id=${id}.`, false);
    await loadRows();
  } catch (err) {
    showMessage(err.message, true);
  }
}

document.getElementById("save-settings").addEventListener("click", () => {
  const base = document.getElementById("api-base").value.trim().replace(/\/$/, "");
  const token = document.getElementById("admin-token").value.trim();
  localStorage.setItem(storageKeys.base, base);
  localStorage.setItem(storageKeys.token, token);
  showMessage("Settings saved.", false);
  loadRows();
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

const initial = settings();
document.getElementById("api-base").value = initial.base;
document.getElementById("admin-token").value = initial.token;
if (initial.base && initial.token) loadRows();
/* =========================================================
   CEMICS — shared dashboard client
   Handles auth storage, the API wrapper, the notification
   bell, and small UI helpers (toasts / modals) that every
   dashboard page (seeker / employer / councillor) reuses.
========================================================= */

const API_BASE = "/api";
const TOKEN_KEY = "cemics_token";
const USER_KEY = "cemics_user";

/* ---------------- auth storage ---------------- */

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch (e) {
    return null;
  }
}

function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function dashboardUrlForRole(role) {
  if (role === "seeker") return "dashboard-seeker.html";
  if (role === "employer" || role === "councillor") return "dashboard-poster.html";
  if (role === "admin") return "dashboard-admin.html";
  if (role === "actor") return "dashboard-actor.html";
  return "index.html";
}

/**
 * Guard a dashboard page: redirects to login if not authenticated,
 * or to the correct dashboard if the logged-in role doesn't match.
 */
function requireRole(...allowedRoles) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) {
    window.location.href = "login.html";
    return null;
  }
  if (!allowedRoles.includes(user.role)) {
    window.location.href = dashboardUrlForRole(user.role);
    return null;
  }
  return user;
}

function logout() {
  clearSession();
  window.location.href = "login.html";
}

/* ---------------- API wrapper ---------------- */

async function apiFetch(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    const message = (data && data.error) || "Something went wrong. Please try again.";
    if (res.status === 401) {
      clearSession();
      window.location.href = "login.html";
    }
    throw new Error(message);
  }
  return data;
}

/* ---------------- toasts ---------------- */

function ensureToastWrap() {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  return wrap;
}

function showToast(message, type = "") {
  const wrap = ensureToastWrap();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

/* ---------------- initials avatar ---------------- */

function initialsOf(user) {
  if (!user) return "?";
  return `${(user.firstName || "?")[0]}${(user.lastName || "")[0] || ""}`.toUpperCase();
}

/* ---------------- notification bell ---------------- */

function timeAgo(iso) {
  const then = new Date(iso.replace(" ", "T") + "Z");
  const diffMs = Date.now() - then.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function initNotificationBell({ onRefresh } = {}) {
  const bellBtn = document.getElementById("bellBtn");
  const bellDot = document.getElementById("bellDot");
  const panel = document.getElementById("notifPanel");
  const list = document.getElementById("notifList");
  const markAllBtn = document.getElementById("notifMarkAll");
  if (!bellBtn || !panel || !list) return;

  async function refresh() {
    try {
      const data = await apiFetch("/notifications");
      bellDot.classList.toggle("show", data.unreadCount > 0);
      list.innerHTML = "";
      if (!data.notifications.length) {
        list.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
      } else {
        data.notifications.forEach((n) => {
          const item = document.createElement("div");
          item.className = `notif-item ${n.isRead ? "" : "unread"}`.trim();
          item.innerHTML = `
            <div class="notif-item-title">${escapeHtml(n.title)}</div>
            <div class="notif-item-msg">${escapeHtml(n.message)}</div>
            <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
          `;
          item.addEventListener("click", async () => {
            if (!n.isRead) {
              await apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" });
              refresh();
            }
          });
          list.appendChild(item);
        });
      }
      if (onRefresh) onRefresh(data);
    } catch (e) {
      /* fail silently for the bell — don't block the page */
    }
  }

  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("show");
    if (panel.classList.contains("show")) refresh();
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== bellBtn) panel.classList.remove("show");
  });
  if (markAllBtn) {
    markAllBtn.addEventListener("click", async () => {
      await apiFetch("/notifications/read-all", { method: "PATCH" });
      refresh();
    });
  }

  refresh();
  setInterval(refresh, 30000);
}

/* ---------------- misc helpers ---------------- */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.valueOf())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.valueOf())) return value;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function scoreTier(score) {
  if (score >= 65) return "high";
  if (score >= 40) return "mid";
  return "low";
}

function setupTopbarUser(user) {
  const nameEl = document.getElementById("userChipName");
  const avatarEl = document.getElementById("userAvatar");
  if (nameEl) nameEl.textContent = `${user.firstName} ${user.lastName}`;
  if (avatarEl) avatarEl.textContent = initialsOf(user);
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
}

function setupSidebarNav() {
  const links = document.querySelectorAll(".sidebar-link[data-view]");
  const views = document.querySelectorAll(".view[id]");
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((l) => l.classList.remove("is-active"));
      views.forEach((v) => v.classList.remove("is-active"));
      link.classList.add("is-active");
      const target = document.getElementById(link.dataset.view);
      if (target) target.classList.add("is-active");
      if (typeof window.onViewChange === "function") window.onViewChange(link.dataset.view);
    });
  });
}

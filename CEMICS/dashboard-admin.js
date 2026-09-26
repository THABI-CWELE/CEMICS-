/* =========================================================
   CEMICS — System Administrator dashboard logic
========================================================= */

const user = requireRole("admin");
let currentUser = user;
let editingUserRole = null; // used only for the "add account" modal, not editing existing users' role

document.addEventListener("DOMContentLoaded", () => {
  if (!currentUser) return;
  setupTopbarUser(currentUser);
  initNotificationBell();
  wireSidebar();

  loadOverview();
  loadUsers("");
  loadJobs();
  loadReports();
  loadSecurity();
  loadSettings();
  loadAdminProfile();

  document.getElementById("userSearch").addEventListener("input", debounce(() => loadUsers(currentRoleFilter), 300));
  document.getElementById("jobSearch").addEventListener("input", debounce(loadJobs, 300));
  document.getElementById("jobStatusFilter").addEventListener("change", loadJobs);
  document.getElementById("onlyFailedToggle").addEventListener("change", loadSecurity);

  document.getElementById("addUserBtn").addEventListener("click", () => openUserModal());
  document.querySelectorAll("[data-close-modal]").forEach((btn) =>
    btn.addEventListener("click", () => document.getElementById("userModal").classList.remove("show"))
  );
  document.getElementById("confirmUserBtn").addEventListener("click", submitNewUser);

  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
  document.getElementById("saveAdminProfileBtn").addEventListener("click", saveAdminProfile);
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function emptyState(msg) {
  return `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none"><path d="M4 21V10l8-6 8 6v11" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><p>${msg}</p></div>`;
}

/* ---------------- sidebar ---------------- */

let currentRoleFilter = "";

function wireSidebar() {
  const links = document.querySelectorAll(".sidebar-link[data-view]");
  const views = document.querySelectorAll(".view[id]");
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((l) => l.classList.remove("is-active"));
      views.forEach((v) => v.classList.remove("is-active"));
      link.classList.add("is-active");
      document.getElementById(link.dataset.view).classList.add("is-active");

      if (link.dataset.view === "view-users") {
        currentRoleFilter = link.dataset.roleFilter || "";
        const labels = { "": "All Users", seeker: "Community Members", employer: "Employers", councillor: "Counselors", actor: "Actors" };
        document.getElementById("usersTitle").textContent = labels[currentRoleFilter] || "All Users";
        loadUsers(currentRoleFilter);
      }
    });
  });
}

/* ---------------- overview ---------------- */

async function loadOverview() {
  try {
    const data = await apiFetch("/admin/stats");
    document.getElementById("overviewStats").innerHTML = `
      <div class="stat-card blue"><div class="stat-num">${data.totalUsers}</div><div class="stat-label">Total accounts</div></div>
      <div class="stat-card green"><div class="stat-num">${data.vacancyCounts.open || 0}</div><div class="stat-label">Open vacancies</div></div>
      <div class="stat-card"><div class="stat-num">${(data.applicationCounts.submitted || 0) + (data.applicationCounts.shortlisted || 0) + (data.applicationCounts.interview || 0) + (data.applicationCounts.rejected || 0) + (data.applicationCounts.hired || 0)}</div><div class="stat-label">Total applications</div></div>
      <div class="stat-card orange"><div class="stat-num">${data.failedLoginsToday}</div><div class="stat-label">Failed logins (24h)</div></div>
    `;
    const roles = { seeker: "Community Members", employer: "Employers", councillor: "Counselors", actor: "Actors", admin: "Administrators" };
    const max = Math.max(1, ...Object.values(data.usersByRole));
    document.getElementById("overviewRoleBars").innerHTML = Object.entries(roles)
      .map(([key, label]) => {
        const count = data.usersByRole[key] || 0;
        return barRow(label, count, max);
      })
      .join("");
  } catch (e) {
    showToast(e.message, "error");
  }
}

function barRow(label, count, max, cls = "") {
  const pct = Math.round((count / max) * 100);
  return `
    <div class="bar-row">
      <div class="bar-row-label"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>
      <div class="bar-row-track"><div class="bar-row-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
}

/* ---------------- account management ---------------- */

async function loadUsers(role) {
  const q = document.getElementById("userSearch").value.trim();
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  if (q) params.set("q", q);
  try {
    const data = await apiFetch(`/admin/users?${params.toString()}`);
    renderUsers(data.users);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderUsers(users) {
  const list = document.getElementById("usersList");
  if (!users.length) {
    list.innerHTML = emptyState("No accounts match.");
    return;
  }
  list.innerHTML = users
    .map((u) => {
      const isSelf = u.id === currentUser.id;
      return `
    <div class="user-row">
      <div>
        <span class="badge badge-role">${u.role}</span>
        <span class="badge ${u.isActive ? "badge-active" : "badge-suspended"}">${u.isActive ? "Active" : "Suspended"}</span>
        <div class="u-name" style="margin-top:6px;">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
        <div class="u-meta">${escapeHtml(u.email)}${u.phone ? " &middot; " + escapeHtml(u.phone) : ""} &middot; Joined ${formatDate(u.createdAt)}</div>
      </div>
      <div class="u-actions">
        ${
          !isSelf
            ? `<button class="btn btn-outline btn-sm" onclick="toggleUserStatus('${u.id}', ${u.isActive ? "false" : "true"})">${u.isActive ? "Suspend" : "Reactivate"}</button>
               <button class="btn btn-danger-outline btn-sm" onclick="deleteUser('${u.id}')">Delete</button>`
            : `<span style="font-size:12px; color:#8b94a0;">This is you</span>`
        }
      </div>
    </div>`;
    })
    .join("");
}

async function toggleUserStatus(id, makeActive) {
  try {
    await apiFetch(`/admin/users/${id}/status`, { method: "PATCH", body: { isActive: makeActive === "true" || makeActive === true } });
    showToast(makeActive === "true" || makeActive === true ? "Account reactivated." : "Account suspended.", "success");
    loadUsers(currentRoleFilter);
    loadOverview();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function deleteUser(id) {
  if (!confirm("Delete this account permanently? This also removes their vacancies/applications. This cannot be undone.")) return;
  try {
    await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
    showToast("Account deleted.", "success");
    loadUsers(currentRoleFilter);
    loadOverview();
  } catch (e) {
    showToast(e.message, "error");
  }
}

function openUserModal() {
  document.getElementById("umRole").value = currentRoleFilter || "councillor";
  document.getElementById("umFirstName").value = "";
  document.getElementById("umLastName").value = "";
  document.getElementById("umEmail").value = "";
  document.getElementById("umPassword").value = "";
  document.getElementById("userModal").classList.add("show");
}

async function submitNewUser() {
  const payload = {
    role: document.getElementById("umRole").value,
    firstName: document.getElementById("umFirstName").value.trim(),
    lastName: document.getElementById("umLastName").value.trim(),
    email: document.getElementById("umEmail").value.trim(),
    password: document.getElementById("umPassword").value,
  };
  if (!payload.firstName || !payload.lastName || !payload.email || !payload.password) {
    return showToast("All fields are required.", "error");
  }
  try {
    await apiFetch("/admin/users", { method: "POST", body: payload });
    document.getElementById("userModal").classList.remove("show");
    showToast("Account created.", "success");
    loadUsers(currentRoleFilter);
    loadOverview();
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ---------------- job management ---------------- */

async function loadJobs() {
  const q = document.getElementById("jobSearch").value.trim();
  const status = document.getElementById("jobStatusFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  try {
    const data = await apiFetch(`/admin/jobs?${params.toString()}`);
    renderJobs(data.vacancies);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderJobs(jobs) {
  const list = document.getElementById("jobsList");
  if (!jobs.length) {
    list.innerHTML = emptyState("No vacancies match.");
    return;
  }
  list.innerHTML = jobs
    .map(
      (v) => `
    <div class="card vacancy-card">
      <div>
        <span class="badge badge-${v.status}">${v.status}</span>
        <h3 style="margin-top:8px;">${escapeHtml(v.title)}</h3>
        <div class="vacancy-meta">
          <span>Posted by ${escapeHtml(v.postedByName)} (${v.postedByRole})</span>
          <span>&bull;</span>
          <span>${v.applicantCount} applicant${v.applicantCount === 1 ? "" : "s"}</span>
          <span>&bull;</span>
          <span>${escapeHtml(v.location || "No location")}</span>
        </div>
        <p class="vacancy-desc">${escapeHtml(v.description)}</p>
      </div>
      <div class="vacancy-actions">
        ${v.status === "open" ? `<button class="btn btn-danger-outline btn-sm" onclick="closeJob('${v.id}')">Close</button>` : ""}
        <button class="btn btn-danger-outline btn-sm" onclick="deleteJob('${v.id}')">Remove</button>
      </div>
    </div>`
    )
    .join("");
}

async function closeJob(id) {
  try {
    await apiFetch(`/admin/jobs/${id}/close`, { method: "PATCH" });
    showToast("Vacancy closed.", "success");
    loadJobs();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function deleteJob(id) {
  if (!confirm("Remove this vacancy permanently, along with its applications?")) return;
  try {
    await apiFetch(`/admin/jobs/${id}`, { method: "DELETE" });
    showToast("Vacancy removed.", "success");
    loadJobs();
    loadOverview();
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ---------------- reports ---------------- */

async function loadReports() {
  try {
    const data = await apiFetch("/admin/reports");
    document.getElementById("reportStats").innerHTML = `
      <div class="stat-card blue"><div class="stat-num">${data.avgAiScore}</div><div class="stat-label">Avg. AI match score</div></div>
      <div class="stat-card green"><div class="stat-num">${data.jobsByStatus.open || 0}</div><div class="stat-label">Open vacancies</div></div>
      <div class="stat-card orange"><div class="stat-num">${data.jobsByStatus.closed || 0}</div><div class="stat-label">Closed vacancies</div></div>
    `;
    const industryEntries = Object.entries(data.jobsByIndustry);
    const industryMax = Math.max(1, ...industryEntries.map(([, c]) => c));
    document.getElementById("reportJobsByIndustry").innerHTML =
      industryEntries.map(([label, count]) => barRow(label, count, industryMax)).join("") || emptyState("No jobs posted yet.");

    const statusLabels = { submitted: "Submitted", shortlisted: "Shortlisted", interview: "Interview stage", rejected: "Not successful", hired: "Hired" };
    const appEntries = Object.entries(data.applicationsByStatus);
    const appMax = Math.max(1, ...appEntries.map(([, c]) => c));
    document.getElementById("reportAppsByStatus").innerHTML =
      appEntries.map(([status, count]) => barRow(statusLabels[status] || status, count, appMax, "green")).join("") ||
      emptyState("No applications yet.");

    const signupMax = Math.max(1, ...data.signupsByMonth.map((m) => m.c));
    document.getElementById("reportSignups").innerHTML =
      data.signupsByMonth.map((m) => barRow(m.month, m.c, signupMax, "orange")).join("") || emptyState("No sign-ups yet.");
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ---------------- security ---------------- */

async function loadSecurity() {
  try {
    const summary = await apiFetch("/admin/security/summary");
    document.getElementById("securityStats").innerHTML = `
      <div class="stat-card green"><div class="stat-num">${summary.successLast24h}</div><div class="stat-label">Successful logins (24h)</div></div>
      <div class="stat-card orange"><div class="stat-num">${summary.failedLast24h}</div><div class="stat-label">Failed logins (24h)</div></div>
      <div class="stat-card"><div class="stat-num">${summary.suspendedAccounts}</div><div class="stat-label">Suspended accounts</div></div>
    `;

    const onlyFailed = document.getElementById("onlyFailedToggle").checked;
    const logs = await apiFetch(`/admin/security/logins${onlyFailed ? "?onlyFailed=true" : ""}`);
    const list = document.getElementById("loginLogsList");
    if (!logs.logs.length) {
      list.innerHTML = emptyState("No login activity recorded yet.");
      return;
    }
    list.innerHTML = logs.logs
      .map(
        (l) => `
      <div class="log-row">
        <div>
          <span class="log-email">${escapeHtml(l.email)}</span>
          <span class="badge ${l.success ? "badge-active" : "badge-suspended"}" style="margin-left:8px;">${l.success ? "Success" : "Failed"}</span>
          ${l.reason ? `<span style="margin-left:6px; color:#8b94a0;">${escapeHtml(l.reason)}</span>` : ""}
        </div>
        <div class="log-time">${formatDateTime(l.createdAt)}</div>
      </div>`
      )
      .join("");
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ---------------- settings ---------------- */

async function loadSettings() {
  try {
    const data = await apiFetch("/admin/settings");
    document.getElementById("setSiteName").value = data.settings.siteName || "";
    document.getElementById("setSupportEmail").value = data.settings.supportEmail || "";
    document.getElementById("setAllowRegistrations").checked = data.settings.allowRegistrations === "true";
    document.getElementById("setMaintenanceMode").checked = data.settings.maintenanceMode === "true";
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function saveSettings() {
  const payload = {
    siteName: document.getElementById("setSiteName").value.trim(),
    supportEmail: document.getElementById("setSupportEmail").value.trim(),
    allowRegistrations: document.getElementById("setAllowRegistrations").checked,
    maintenanceMode: document.getElementById("setMaintenanceMode").checked,
  };
  try {
    await apiFetch("/admin/settings", { method: "PUT", body: payload });
    showToast("Settings saved.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ---------------- admin profile ---------------- */

function loadAdminProfile() {
  document.getElementById("pFirstName").value = currentUser.firstName;
  document.getElementById("pLastName").value = currentUser.lastName;
  document.getElementById("pEmail").value = currentUser.email;
  document.getElementById("pPhone").value = currentUser.phone || "";
}

async function saveAdminProfile() {
  const payload = {
    firstName: document.getElementById("pFirstName").value.trim(),
    lastName: document.getElementById("pLastName").value.trim(),
    phone: document.getElementById("pPhone").value.trim(),
  };
  try {
    const data = await apiFetch("/users/me", { method: "PUT", body: payload });
    currentUser = data.user;
    saveSession(getToken(), currentUser);
    setupTopbarUser(currentUser);
    showToast("Profile saved.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

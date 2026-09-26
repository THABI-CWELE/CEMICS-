/* =========================================================
   CEMICS — Community Member dashboard logic
   Community members register and keep their profile/CV/documents
   up to date. They no longer browse or apply to vacancies directly
   — the councillor holds the full community register, matches
   members to suitable roles, and forwards ("refers") them to the
   employer (see backend/routes/councillor.js). This dashboard just
   tracks the status of those referrals and any resulting interviews.
========================================================= */

const user = requireRole("seeker");

let currentUser = user;

document.addEventListener("DOMContentLoaded", () => {
  if (!currentUser) return;
  setupTopbarUser(currentUser);
  setupSidebarNav();
  initNotificationBell();
  document.getElementById("topbarFirstName").textContent = `, ${currentUser.firstName}`;

  loadApplications();
  loadInterviews();
  loadProfile();

  document.getElementById("uploadCvBtn").addEventListener("click", uploadCv);
  document.getElementById("uploadDocsBtn").addEventListener("click", uploadDocs);
  document.getElementById("saveProfileBtn").addEventListener("click", saveProfile);
});

/* ---------------- My referrals ---------------- */

async function loadApplications() {
  try {
    const data = await apiFetch("/applications/mine");
    renderApplications(data.applications);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function statusLabel(status) {
  return { submitted: "Submitted", shortlisted: "Shortlisted", interview: "Interview stage", rejected: "Not successful", hired: "Hired" }[status] || status;
}

function renderApplications(apps) {
  const list = document.getElementById("applicationsList");
  if (!apps.length) {
    list.innerHTML = emptyState("No referrals yet — make sure your profile and CV are up to date so your councillor can put you forward for suitable roles.");
    return;
  }
  list.innerHTML = apps
    .map(
      (a) => `
    <div class="card vacancy-card">
      <div>
        <span class="badge badge-${a.status}">${statusLabel(a.status)}</span>
        <h3 style="margin-top:8px;">${escapeHtml(a.vacancyTitle)}</h3>
        <div class="vacancy-meta">
          <span>Referred ${formatDate(a.appliedAt)}</span>
          ${a.vacancyLocation ? `<span>&bull;</span><span>${escapeHtml(a.vacancyLocation)}</span>` : ""}
          ${a.vacancyStatus === "closed" ? `<span>&bull;</span><span>Vacancy closed</span>` : ""}
        </div>
        ${a.interview ? `<p class="vacancy-desc">Interview: ${formatDateTime(a.interview.scheduledAt)} &middot; ${escapeHtml(a.interview.mode)}${a.interview.location ? " &middot; " + escapeHtml(a.interview.location) : ""}</p>` : ""}
      </div>
    </div>`
    )
    .join("");
}

/* ---------------- Interviews ---------------- */

async function loadInterviews() {
  try {
    const data = await apiFetch("/applications/interviews/mine");
    renderInterviews(data.interviews);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderInterviews(interviews) {
  const list = document.getElementById("interviewsList");
  if (!interviews.length) {
    list.innerHTML = emptyState("No interviews scheduled yet.");
    return;
  }
  list.innerHTML = interviews
    .map(
      (i) => `
    <div class="card vacancy-card">
      <div>
        <span class="badge badge-interview">${i.status}</span>
        <h3 style="margin-top:8px;">${escapeHtml(i.vacancyTitle)}</h3>
        <div class="vacancy-meta">
          <span>${formatDateTime(i.scheduledAt)}</span>
          <span>&bull;</span>
          <span>${escapeHtml(i.mode)}</span>
          ${i.location ? `<span>&bull;</span><span>${escapeHtml(i.location)}</span>` : ""}
        </div>
        ${i.notes ? `<p class="vacancy-desc">${escapeHtml(i.notes)}</p>` : ""}
      </div>
    </div>`
    )
    .join("");
}

/* ---------------- Profile / CV / Documents ---------------- */

function loadProfile() {
  const p = currentUser.profile || {};
  document.getElementById("qualification").value = p.qualification || "";
  document.getElementById("fieldOfInterest").value = p.fieldOfInterest || "";
  document.getElementById("skillsText").value = p.skills || "";
  renderCvStatus();
  renderDocs();
}

function renderCvStatus() {
  const el = document.getElementById("cvStatus");
  el.textContent = currentUser.cvOriginalName
    ? `Current CV on file: ${currentUser.cvOriginalName}`
    : "No CV uploaded yet.";
}

function renderDocs() {
  const list = document.getElementById("docList");
  const docs = currentUser.documents || [];
  if (!docs.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = docs
    .map((d) => `<div class="doc-item"><span>${escapeHtml(d.name)}</span><a href="${d.path}" target="_blank" rel="noopener">View</a></div>`)
    .join("");
}

async function uploadCv() {
  const fileInput = document.getElementById("cvFile");
  if (!fileInput.files[0]) return showToast("Choose a file first.", "error");
  const form = new FormData();
  form.append("cv", fileInput.files[0]);
  try {
    const data = await apiFetch("/users/me/cv", { method: "POST", body: form, isForm: true });
    currentUser = data.user;
    saveSession(getToken(), currentUser);
    renderCvStatus();
    fileInput.value = "";
    showToast("CV uploaded.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function uploadDocs() {
  const fileInput = document.getElementById("docFiles");
  if (!fileInput.files.length) return showToast("Choose at least one file.", "error");
  const form = new FormData();
  Array.from(fileInput.files).forEach((f) => form.append("documents", f));
  try {
    const data = await apiFetch("/users/me/documents", { method: "POST", body: form, isForm: true });
    currentUser = data.user;
    saveSession(getToken(), currentUser);
    renderDocs();
    fileInput.value = "";
    showToast("Documents uploaded.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function saveProfile() {
  const profile = {
    qualification: document.getElementById("qualification").value,
    fieldOfInterest: document.getElementById("fieldOfInterest").value.trim(),
    skills: document.getElementById("skillsText").value.trim(),
  };
  try {
    const data = await apiFetch("/users/me", { method: "PUT", body: { profile } });
    currentUser = data.user;
    saveSession(getToken(), currentUser);
    showToast("Profile saved.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

function emptyState(msg) {
  return `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none"><path d="M4 21V10l8-6 8 6v11" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><p>${msg}</p></div>`;
}

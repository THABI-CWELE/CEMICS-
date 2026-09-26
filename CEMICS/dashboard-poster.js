/* =========================================================
   CEMICS — Employer / Councillor dashboard logic
   Employers post vacancies and manage the applicants referred
   to them — they never browse or contact community members
   directly, only their councillor. Councillors additionally get
   the full Community Register and an org-wide All Vacancies view,
   so they can find suitable candidates for any employer's role and
   refer them (see backend/routes/councillor.js). Reviewing referred
   applicants, statuses, and interviews works the same for both.
========================================================= */

const user = requireRole("employer", "councillor");
let currentUser = user;
let editingVacancyId = null;
let activeApplicationForInterview = null;
const isCouncillor = currentUser && currentUser.role === "councillor";

document.addEventListener("DOMContentLoaded", () => {
  if (!currentUser) return;
  setupTopbarUser(currentUser);
  setupSidebarNav();
  initNotificationBell();

  const roleLabel = currentUser.role === "employer" ? "Employer" : "Councillor";
  document.getElementById("sidebarRole").textContent = roleLabel;
  document.getElementById("topbarTitle").textContent = `${roleLabel} Dashboard`;

  if (isCouncillor) {
    document.getElementById("navAllVacancies").style.display = "";
    document.getElementById("navRegister").style.display = "";
    document.getElementById("postFormSub").textContent = "Post a vacancy on behalf of the community, or match community members against roles employers have posted via All Vacancies.";
    // Councillors work from the org-wide view by default, not "My Vacancies".
    switchView("view-allvacancies");
    loadAllVacancies();
  } else {
    loadVacancies();
  }

  document.getElementById("saveVacancyBtn").addEventListener("click", saveVacancy);
  document.getElementById("cancelEditBtn").addEventListener("click", resetVacancyForm);
  document.getElementById("backToVacancies").addEventListener("click", () => switchView(isCouncillor ? "view-allvacancies" : "view-vacancies"));

  document.querySelectorAll("[data-close-modal]").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.getElementById("interviewModal").classList.remove("show");
      document.getElementById("suggestModal").classList.remove("show");
    })
  );
  document.getElementById("confirmInterviewBtn").addEventListener("click", confirmScheduleInterview);

  if (isCouncillor) {
    document.getElementById("allVacSearch").addEventListener("input", debounce(loadAllVacancies, 300));
    document.getElementById("registerSearch").addEventListener("input", debounce(loadRegister, 300));
    document.getElementById("registerQualification").addEventListener("change", loadRegister);
    loadRegister();
  }
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function switchView(id) {
  document.querySelectorAll(".sidebar-link[data-view]").forEach((l) => l.classList.toggle("is-active", l.dataset.view === id));
  document.querySelectorAll(".view[id]").forEach((v) => v.classList.toggle("is-active", v.id === id));
}

/* ---------------- My vacancies ---------------- */

async function loadVacancies() {
  try {
    const data = await apiFetch("/vacancies/mine");
    renderStats(data.vacancies);
    renderVacancies(data.vacancies);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderStats(vacancies) {
  const open = vacancies.filter((v) => v.status === "open").length;
  const totalApplicants = vacancies.reduce((sum, v) => sum + v.applicantCount, 0);
  const totalShortlisted = vacancies.reduce((sum, v) => sum + v.shortlistedCount, 0);
  document.getElementById("statGrid").innerHTML = `
    <div class="stat-card blue"><div class="stat-num">${open}</div><div class="stat-label">Open vacancies</div></div>
    <div class="stat-card"><div class="stat-num">${totalApplicants}</div><div class="stat-label">Total applicants</div></div>
    <div class="stat-card green"><div class="stat-num">${totalShortlisted}</div><div class="stat-label">Shortlisted</div></div>
  `;
}

function renderVacancies(vacancies) {
  const list = document.getElementById("vacancyList");
  if (!vacancies.length) {
    list.innerHTML = emptyState("You haven't posted a vacancy yet — head to \"Post a Vacancy\" to get started.");
    return;
  }
  list.innerHTML = vacancies
    .map(
      (v) => `
    <div class="card vacancy-card">
      <div>
        <span class="badge badge-${v.status}">${v.status}</span>
        <h3 style="margin-top:8px;">${escapeHtml(v.title)}</h3>
        <div class="vacancy-meta">
          <span>${escapeHtml(v.location || "No location set")}</span>
          <span>&bull;</span>
          <span>${escapeHtml(v.employmentType || "")}</span>
          ${v.closingDate ? `<span>&bull;</span><span>Closes ${formatDate(v.closingDate)}</span>` : ""}
          <span>&bull;</span>
          <span>${v.applicantCount} applicant${v.applicantCount === 1 ? "" : "s"}</span>
          <span>&bull;</span>
          <span>${v.shortlistedCount} shortlisted</span>
        </div>
        <p class="vacancy-desc">${escapeHtml(v.description)}</p>
      </div>
      <div class="vacancy-actions">
        <button class="btn btn-primary btn-sm" onclick="viewApplications('${v.id}','${escapeHtml(v.title).replace(/'/g, "\\'")}')">View Applications</button>
        <button class="btn btn-outline btn-sm" onclick="editVacancy('${v.id}')">Edit</button>
        ${
          v.status === "open"
            ? `<button class="btn btn-danger-outline btn-sm" onclick="closeVacancy('${v.id}')">Close vacancy</button>`
            : `<button class="btn btn-outline btn-sm" onclick="reopenVacancy('${v.id}')">Reopen</button>`
        }
      </div>
    </div>`
    )
    .join("");
}

async function closeVacancy(id) {
  try {
    await apiFetch(`/vacancies/${id}/close`, { method: "PATCH" });
    showToast("Vacancy closed.", "success");
    loadVacancies();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function reopenVacancy(id) {
  try {
    await apiFetch(`/vacancies/${id}/reopen`, { method: "PATCH" });
    showToast("Vacancy reopened.", "success");
    loadVacancies();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function editVacancy(id) {
  try {
    const data = await apiFetch(`/vacancies/${id}`);
    const v = data.vacancy;
    editingVacancyId = id;
    document.getElementById("postFormTitle").textContent = "Edit Vacancy";
    document.getElementById("vTitle").value = v.title;
    document.getElementById("vDescription").value = v.description;
    document.getElementById("vRequirements").value = v.requirements || "";
    document.getElementById("vSkills").value = (v.skills || []).join(", ");
    document.getElementById("vIndustry").value = v.industry || "";
    document.getElementById("vEmploymentType").value = v.employmentType || "Full-time";
    document.getElementById("vLocation").value = v.location || "";
    document.getElementById("vMinQualification").value = v.minQualification || "";
    document.getElementById("vSalary").value = v.salaryRange || "";
    document.getElementById("vClosingDate").value = v.closingDate ? v.closingDate.substring(0, 10) : "";
    document.getElementById("saveVacancyBtn").textContent = "Save Changes";
    document.getElementById("cancelEditBtn").style.display = "inline-flex";
    switchView("view-post");
  } catch (e) {
    showToast(e.message, "error");
  }
}

function resetVacancyForm() {
  editingVacancyId = null;
  ["vTitle", "vDescription", "vRequirements", "vSkills", "vLocation", "vSalary", "vClosingDate"].forEach(
    (id) => (document.getElementById(id).value = "")
  );
  document.getElementById("vIndustry").value = "";
  document.getElementById("vEmploymentType").value = "Full-time";
  document.getElementById("vMinQualification").value = "";
  document.getElementById("postFormTitle").textContent = "Post a Vacancy";
  document.getElementById("saveVacancyBtn").textContent = "Post Vacancy";
  document.getElementById("cancelEditBtn").style.display = "none";
}

async function saveVacancy() {
  const payload = {
    title: document.getElementById("vTitle").value.trim(),
    description: document.getElementById("vDescription").value.trim(),
    requirements: document.getElementById("vRequirements").value.trim(),
    skills: document.getElementById("vSkills").value.split(",").map((s) => s.trim()).filter(Boolean),
    industry: document.getElementById("vIndustry").value,
    employmentType: document.getElementById("vEmploymentType").value,
    location: document.getElementById("vLocation").value.trim(),
    minQualification: document.getElementById("vMinQualification").value,
    salaryRange: document.getElementById("vSalary").value.trim(),
    closingDate: document.getElementById("vClosingDate").value || null,
  };

  if (!payload.title || !payload.description) {
    showToast("Title and description are required.", "error");
    return;
  }

  try {
    if (editingVacancyId) {
      await apiFetch(`/vacancies/${editingVacancyId}`, { method: "PUT", body: payload });
      showToast("Vacancy updated.", "success");
    } else {
      await apiFetch("/vacancies", { method: "POST", body: payload });
      showToast("Vacancy posted.", "success");
    }
    resetVacancyForm();
    switchView("view-vacancies");
    loadVacancies();
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ---------------- Applications for a vacancy ---------------- */

async function viewApplications(vacancyId, title) {
  document.getElementById("applicationsVacancyTitle").textContent = `Applications — ${title}`;
  switchView("view-applications");
  try {
    const data = await apiFetch(`/applications/vacancies/${vacancyId}`);
    renderApplicants(data.applications);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderApplicants(applicants) {
  const list = document.getElementById("applicantsList");
  if (!applicants.length) {
    list.innerHTML = emptyState("No applications yet for this vacancy.");
    return;
  }
  list.innerHTML = applicants
    .map((a) => {
      const tier = scoreTier(a.aiScore);
      const breakdown = a.aiBreakdown || {};
      return `
    <div class="applicant-row">
      <div class="score-pill ${tier}">
        <div class="num">${a.aiScore}</div>
        <div class="lbl">match</div>
      </div>
      <div class="applicant-info" style="flex:1;">
        <h4>${escapeHtml(a.seekerName)} ${a.aiRecommended ? '<span class="badge badge-shortlisted">AI recommended</span>' : ""}</h4>
        <div class="contact">${escapeHtml(a.seekerEmail)}${a.seekerPhone ? " &middot; " + escapeHtml(a.seekerPhone) : ""} &middot; Applied ${formatDate(a.appliedAt)}</div>
        ${a.coverLetter ? `<p class="cover">${escapeHtml(a.coverLetter)}</p>` : ""}
        ${breakdown.summary ? `<p class="cover" style="margin-top:6px; color:#075792;">${escapeHtml(breakdown.summary)}</p>` : ""}
        ${
          (breakdown.requiredSkills || []).length
            ? `<div style="margin-top:8px;">${breakdown.requiredSkills
                .map((s) => `<span class="skill-chip ${breakdown.matchedSkills && breakdown.matchedSkills.includes(s) ? "matched" : ""}">${escapeHtml(s)}</span>`)
                .join("")}</div>`
            : ""
        }
        ${a.cvPath ? `<div style="margin-top:10px;"><a class="link" href="${a.cvPath}" target="_blank" rel="noopener">View CV${a.cvOriginalName ? " — " + escapeHtml(a.cvOriginalName) : ""}</a></div>` : ""}
      </div>
      <div class="applicant-actions">
        <select onchange="updateApplicationStatus('${a.id}', this.value)">
          <option value="submitted" ${a.status === "submitted" ? "selected" : ""}>Submitted</option>
          <option value="shortlisted" ${a.status === "shortlisted" ? "selected" : ""}>Shortlisted</option>
          <option value="interview" ${a.status === "interview" ? "selected" : ""}>Interview stage</option>
          <option value="rejected" ${a.status === "rejected" ? "selected" : ""}>Not successful</option>
          <option value="hired" ${a.status === "hired" ? "selected" : ""}>Hired</option>
        </select>
        <button class="btn btn-outline btn-sm" onclick="openInterviewModal('${a.id}')">Schedule interview</button>
      </div>
    </div>`;
    })
    .join("");
}

async function updateApplicationStatus(applicationId, status) {
  try {
    await apiFetch(`/applications/${applicationId}/status`, { method: "PATCH", body: { status } });
    showToast("Status updated — the applicant has been notified.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

function openInterviewModal(applicationId) {
  activeApplicationForInterview = applicationId;
  document.getElementById("interviewDate").value = "";
  document.getElementById("interviewMode").value = "In-person";
  document.getElementById("interviewLocation").value = "";
  document.getElementById("interviewNotes").value = "";
  document.getElementById("interviewModal").classList.add("show");
}

async function confirmScheduleInterview() {
  if (!activeApplicationForInterview) return;
  const scheduledAt = document.getElementById("interviewDate").value;
  if (!scheduledAt) return showToast("Pick a date and time.", "error");

  try {
    await apiFetch(`/applications/${activeApplicationForInterview}/interview`, {
      method: "POST",
      body: {
        scheduledAt,
        mode: document.getElementById("interviewMode").value,
        location: document.getElementById("interviewLocation").value.trim(),
        notes: document.getElementById("interviewNotes").value.trim(),
      },
    });
    document.getElementById("interviewModal").classList.remove("show");
    showToast("Interview scheduled — the candidate has been notified.", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

function emptyState(msg) {
  return `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none"><path d="M4 21V10l8-6 8 6v11" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><p>${msg}</p></div>`;
}

/* =========================================================
   Councillor only — Community Register
   The full list of registered community members, with basic
   search/filter, so the councillor always has a record of
   everyone on the system.
========================================================= */

async function loadRegister() {
  const q = document.getElementById("registerSearch").value.trim();
  const qualification = document.getElementById("registerQualification").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (qualification) params.set("qualification", qualification);

  try {
    const data = await apiFetch(`/councillor/members?${params.toString()}`);
    renderRegister(data.members);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderRegister(members) {
  const list = document.getElementById("registerList");
  if (!members.length) {
    list.innerHTML = emptyState("No community members match right now.");
    return;
  }
  list.innerHTML = members
    .map((m) => {
      const p = m.profile || {};
      return `
    <div class="card vacancy-card">
      <div>
        <h3>${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</h3>
        <div class="vacancy-meta">
          <span>${escapeHtml(m.email)}</span>
          ${m.phone ? `<span>&bull;</span><span>${escapeHtml(m.phone)}</span>` : ""}
          ${p.qualification ? `<span>&bull;</span><span>${escapeHtml(p.qualification)}</span>` : ""}
          <span>&bull;</span>
          <span>${m.hasCv ? "CV on file" : "No CV yet"}</span>
        </div>
        ${p.fieldOfInterest ? `<p class="vacancy-desc">Interested in: ${escapeHtml(p.fieldOfInterest)}</p>` : ""}
        ${p.skills ? `<p class="vacancy-desc">${escapeHtml(p.skills)}</p>` : ""}
      </div>
    </div>`;
    })
    .join("");
}

/* =========================================================
   Councillor only — All Vacancies
   Every open role across every employer, so the councillor can
   match community members against the full pool rather than
   just roles they posted themselves.
========================================================= */

async function loadAllVacancies() {
  const q = document.getElementById("allVacSearch").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);

  try {
    const data = await apiFetch(`/councillor/vacancies?${params.toString()}`);
    renderAllVacancies(data.vacancies);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderAllVacancies(vacancies) {
  const list = document.getElementById("allVacanciesList");
  if (!vacancies.length) {
    list.innerHTML = emptyState("No open vacancies right now.");
    return;
  }
  list.innerHTML = vacancies
    .map(
      (v) => `
    <div class="card vacancy-card">
      <div>
        <span class="badge badge-open">Open</span>
        <h3 style="margin-top:8px;">${escapeHtml(v.title)}</h3>
        <div class="vacancy-meta">
          <span>${escapeHtml(v.employerName || "")}</span>
          <span>&bull;</span>
          <span>${escapeHtml(v.location || "Location not specified")}</span>
          <span>&bull;</span>
          <span>${v.referredCount} referred</span>
        </div>
        <p class="vacancy-desc">${escapeHtml(v.description)}</p>
        ${(v.skills || []).length ? `<div style="margin-top:8px;">${v.skills.map((s) => `<span class="skill-chip">${escapeHtml(s)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="vacancy-actions">
        <button class="btn btn-primary btn-sm" onclick="openSuggestModal('${v.id}','${escapeHtml(v.title).replace(/'/g, "\\'")}')">Find candidates</button>
      </div>
    </div>`
    )
    .join("");
}

async function openSuggestModal(vacancyId, title) {
  document.getElementById("suggestModalTitle").textContent = `Suggested Candidates — ${title}`;
  document.getElementById("suggestList").innerHTML = emptyState("Loading…");
  document.getElementById("suggestModal").classList.add("show");
  try {
    const data = await apiFetch(`/councillor/vacancies/${vacancyId}/suggestions`);
    renderSuggestions(vacancyId, data.suggestions);
  } catch (e) {
    document.getElementById("suggestList").innerHTML = emptyState(e.message);
  }
}

function renderSuggestions(vacancyId, suggestions) {
  const list = document.getElementById("suggestList");
  if (!suggestions.length) {
    list.innerHTML = emptyState("No unreferred community members match this vacancy yet.");
    return;
  }
  list.innerHTML = suggestions
    .map((s) => {
      const m = s.member;
      const tier = scoreTier(s.score);
      const breakdown = s.breakdown || {};
      return `
    <div class="applicant-row">
      <div class="score-pill ${tier}">
        <div class="num">${s.score}</div>
        <div class="lbl">match</div>
      </div>
      <div class="applicant-info" style="flex:1;">
        <h4>${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</h4>
        <div class="contact">${escapeHtml(m.email)}${m.phone ? " &middot; " + escapeHtml(m.phone) : ""} &middot; ${s.hasCv ? "CV on file" : "No CV yet"}</div>
        ${breakdown.summary ? `<p class="cover" style="margin-top:6px; color:#075792;">${escapeHtml(breakdown.summary)}</p>` : ""}
        ${
          (breakdown.requiredSkills || []).length
            ? `<div style="margin-top:8px;">${breakdown.requiredSkills
                .map((sk) => `<span class="skill-chip ${breakdown.matchedSkills && breakdown.matchedSkills.includes(sk) ? "matched" : ""}">${escapeHtml(sk)}</span>`)
                .join("")}</div>`
            : ""
        }
      </div>
      <div class="applicant-actions">
        <button class="btn btn-primary btn-sm" ${s.hasCv ? "" : "disabled title=\"This community member hasn't uploaded a CV yet.\""} onclick="referCandidate('${vacancyId}','${m.id}')">Refer to employer</button>
      </div>
    </div>`;
    })
    .join("");
}

async function referCandidate(vacancyId, memberId) {
  try {
    await apiFetch("/councillor/refer", { method: "POST", body: { vacancyId, memberId } });
    showToast("Candidate referred — the employer has been notified.", "success");
    document.getElementById("suggestModal").classList.remove("show");
    loadAllVacancies();
  } catch (e) {
    showToast(e.message, "error");
  }
}

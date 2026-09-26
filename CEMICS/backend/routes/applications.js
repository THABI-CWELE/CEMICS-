const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notify } = require("../utils/notify");

const router = express.Router();

function serializeApplication(row) {
  if (!row) return null;
  return {
    ...row,
    documents: JSON.parse(row.documents || "[]"),
    aiBreakdown: JSON.parse(row.aiBreakdown || "{}"),
  };
}

// NOTE: Community members no longer apply to vacancies directly. Vacancies
// are posted to the councillor, who reviews the community register and
// forwards suitable candidates to the employer — see POST /api/councillor/refer.

// Seeker (community member): my applications/referrals with live status + vacancy summary.
router.get("/mine", requireAuth, requireRole("seeker"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, v.title as vacancyTitle, v.status as vacancyStatus, v.location as vacancyLocation
       FROM applications a JOIN vacancies v ON v.id = a.vacancyId
       WHERE a.seekerId = ? ORDER BY a.appliedAt DESC`
    )
    .all(req.user.id);

  const withInterviews = rows.map((r) => {
    const interview = db
      .prepare(`SELECT * FROM interviews WHERE applicationId = ? ORDER BY scheduledAt DESC LIMIT 1`)
      .get(r.id);
    return { ...serializeApplication(r), interview: interview || null };
  });

  res.json({ applications: withInterviews });
});

// Employer/councillor: view all applications for a vacancy they own, ranked by AI score,
// with the top tier flagged as AI-shortlisted for quick review.
router.get("/vacancies/:vacancyId", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const vacancy = db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.vacancyId);
  if (!vacancy) return res.status(404).json({ error: "Vacancy not found." });
  // Councillors oversee every vacancy in the system (to match candidates);
  // employers can only see the applications on vacancies they themselves posted.
  if (req.user.role !== "councillor" && vacancy.postedBy !== req.user.id) {
    return res.status(403).json({ error: "Not your vacancy." });
  }

  const rows = db
    .prepare(
      `SELECT a.*, u.firstName, u.lastName, u.email, u.phone, u.profile as seekerProfile
       FROM applications a JOIN users u ON u.id = a.seekerId
       WHERE a.vacancyId = ? ORDER BY a.aiScore DESC, a.appliedAt ASC`
    )
    .all(req.params.vacancyId);

  const applications = rows.map((r) => ({
    ...serializeApplication(r),
    seekerName: `${r.firstName} ${r.lastName}`,
    seekerEmail: r.email,
    seekerPhone: r.phone,
    seekerProfile: JSON.parse(r.seekerProfile || "{}"),
    aiRecommended: r.aiScore >= 65,
  }));

  res.json({ vacancy: { id: vacancy.id, title: vacancy.title }, applications });
});

function assertOwnedApplication(req, res) {
  const application = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id);
  if (!application) {
    res.status(404).json({ error: "Application not found." });
    return null;
  }
  const vacancy = db.prepare("SELECT * FROM vacancies WHERE id = ?").get(application.vacancyId);
  if (!vacancy || (req.user.role !== "councillor" && vacancy.postedBy !== req.user.id)) {
    res.status(403).json({ error: "Not your vacancy." });
    return null;
  }
  return { application, vacancy };
}

const STATUS_MESSAGES = {
  shortlisted: (title) => `Good news — you've been shortlisted for "${title}".`,
  interview: (title) => `You've been moved to the interview stage for "${title}".`,
  rejected: (title) => `Your application for "${title}" was not successful this time.`,
  hired: (title) => `Congratulations — you've been selected for "${title}"!`,
  submitted: (title) => `Your application for "${title}" is under review.`,
};

router.patch("/:id/status", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const ctx = assertOwnedApplication(req, res);
  if (!ctx) return;
  const { status } = req.body;
  const allowed = ["submitted", "shortlisted", "interview", "rejected", "hired"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status." });

  db.prepare(`UPDATE applications SET status = ?, updatedAt = datetime('now') WHERE id = ?`).run(status, req.params.id);

  const messageFn = STATUS_MESSAGES[status];
  if (messageFn) {
    notify(ctx.application.seekerId, "application_status", "Application status updated", messageFn(ctx.vacancy.title), ctx.vacancy.id);
  }

  const updated = serializeApplication(db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id));
  res.json({ application: updated });
});

router.post("/:id/interview", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const ctx = assertOwnedApplication(req, res);
  if (!ctx) return;
  const { scheduledAt, mode, location, notes } = req.body;
  if (!scheduledAt) return res.status(400).json({ error: "Interview date/time is required." });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO interviews (id, applicationId, scheduledAt, mode, location, notes) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, req.params.id, scheduledAt, mode || "In-person", location || "", notes || "");

  db.prepare(`UPDATE applications SET status = 'interview', updatedAt = datetime('now') WHERE id = ?`).run(req.params.id);

  const when = new Date(scheduledAt);
  const whenStr = isNaN(when.valueOf()) ? scheduledAt : when.toLocaleString();
  notify(
    ctx.application.seekerId,
    "interview_scheduled",
    "Interview scheduled",
    `Your interview for "${ctx.vacancy.title}" is set for ${whenStr}${location ? ` at ${location}` : ""}.`,
    ctx.vacancy.id
  );

  const interview = db.prepare("SELECT * FROM interviews WHERE id = ?").get(id);
  res.status(201).json({ interview });
});

router.get("/interviews/mine", requireAuth, requireRole("seeker"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, v.title as vacancyTitle
       FROM interviews i
       JOIN applications a ON a.id = i.applicationId
       JOIN vacancies v ON v.id = a.vacancyId
       WHERE a.seekerId = ? ORDER BY i.scheduledAt ASC`
    )
    .all(req.user.id);
  res.json({ interviews: rows });
});

module.exports = router;

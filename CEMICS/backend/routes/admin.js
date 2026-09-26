const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { publicUser } = require("./auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

/* =========================================================
   Dashboard summary
========================================================= */
router.get("/stats", (req, res) => {
  const usersByRole = db.prepare(`SELECT role, COUNT(*) c FROM users GROUP BY role`).all();
  const vacancyCounts = db.prepare(`SELECT status, COUNT(*) c FROM vacancies GROUP BY status`).all();
  const applicationCounts = db.prepare(`SELECT status, COUNT(*) c FROM applications GROUP BY status`).all();
  const totalUsers = db.prepare(`SELECT COUNT(*) c FROM users`).get().c;
  const failedLoginsToday = db
    .prepare(`SELECT COUNT(*) c FROM login_logs WHERE success = 0 AND createdAt >= datetime('now','-1 day')`)
    .get().c;

  res.json({
    totalUsers,
    usersByRole: Object.fromEntries(usersByRole.map((r) => [r.role, r.c])),
    vacancyCounts: Object.fromEntries(vacancyCounts.map((r) => [r.status, r.c])),
    applicationCounts: Object.fromEntries(applicationCounts.map((r) => [r.status, r.c])),
    failedLoginsToday,
  });
});

/* =========================================================
   Account management — community members, employers, councillors, actors
========================================================= */

router.get("/users", (req, res) => {
  const { role, q } = req.query;
  let rows = db.prepare(`SELECT * FROM users ORDER BY createdAt DESC`).all();
  if (role) rows = rows.filter((u) => u.role === role);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle)
    );
  }
  res.json({ users: rows.map(publicUser) });
});

// Admin directly creates an account (e.g. a counselor or actor/partner org).
router.post("/users", (req, res) => {
  const { role, firstName, lastName, email, phone, address, password, profile } = req.body;
  if (!["seeker", "employer", "councillor", "actor", "admin"].includes(role)) {
    return res.status(400).json({ error: "Invalid role." });
  }
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: "An account with that email already exists." });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO users (id, role, firstName, lastName, phone, email, address, passwordHash, profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    role,
    firstName.trim(),
    lastName.trim(),
    phone || null,
    email.toLowerCase().trim(),
    address || null,
    bcrypt.hashSync(password, 10),
    JSON.stringify(profile || {})
  );
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  res.status(201).json({ user: publicUser(user) });
});

router.get("/users/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

router.put("/users/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  const { firstName, lastName, phone, address, profile } = req.body;
  const mergedProfile = { ...JSON.parse(user.profile || "{}"), ...(profile || {}) };
  db.prepare(
    `UPDATE users SET firstName = COALESCE(?, firstName), lastName = COALESCE(?, lastName), phone = COALESCE(?, phone), address = COALESCE(?, address), profile = ?, updatedAt = datetime('now') WHERE id = ?`
  ).run(firstName || null, lastName || null, phone || null, address || null, JSON.stringify(mergedProfile), req.params.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)) });
});

router.patch("/users/:id/status", (req, res) => {
  const { isActive } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't suspend your own account." });
  db.prepare(`UPDATE users SET isActive = ?, updatedAt = datetime('now') WHERE id = ?`).run(isActive ? 1 : 0, req.params.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)) });
});

router.delete("/users/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });

  db.prepare(`DELETE FROM notifications WHERE userId = ?`).run(req.params.id);
  if (user.role === "seeker") {
    const apps = db.prepare(`SELECT id FROM applications WHERE seekerId = ?`).all(req.params.id);
    apps.forEach((a) => db.prepare(`DELETE FROM interviews WHERE applicationId = ?`).run(a.id));
    db.prepare(`DELETE FROM applications WHERE seekerId = ?`).run(req.params.id);
  } else if (user.role === "employer" || user.role === "councillor") {
    const vacs = db.prepare(`SELECT id FROM vacancies WHERE postedBy = ?`).all(req.params.id);
    vacs.forEach((v) => {
      const apps = db.prepare(`SELECT id FROM applications WHERE vacancyId = ?`).all(v.id);
      apps.forEach((a) => db.prepare(`DELETE FROM interviews WHERE applicationId = ?`).run(a.id));
      db.prepare(`DELETE FROM applications WHERE vacancyId = ?`).run(v.id);
    });
    db.prepare(`DELETE FROM vacancies WHERE postedBy = ?`).run(req.params.id);
  }
  db.prepare(`DELETE FROM users WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

/* =========================================================
   Job management — oversight of every vacancy in the system
========================================================= */

router.get("/jobs", (req, res) => {
  const { status, q } = req.query;
  let rows = db.prepare(`SELECT * FROM vacancies ORDER BY createdAt DESC`).all();
  if (status) rows = rows.filter((v) => v.status === status);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((v) => v.title.toLowerCase().includes(needle) || v.description.toLowerCase().includes(needle));
  }
  const withPoster = rows.map((v) => {
    const poster = db.prepare("SELECT firstName, lastName, email, role FROM users WHERE id = ?").get(v.postedBy);
    const applicantCount = db.prepare(`SELECT COUNT(*) c FROM applications WHERE vacancyId = ?`).get(v.id).c;
    return {
      ...v,
      skills: JSON.parse(v.skills || "[]"),
      postedByName: poster ? `${poster.firstName} ${poster.lastName}` : "Unknown",
      postedByEmail: poster ? poster.email : null,
      postedByRole: poster ? poster.role : null,
      applicantCount,
    };
  });
  res.json({ vacancies: withPoster });
});

router.put("/jobs/:id", (req, res) => {
  const vacancy = db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id);
  if (!vacancy) return res.status(404).json({ error: "Vacancy not found." });
  const { title, description, requirements, skills, industry, location, employmentType, minQualification, salaryRange, closingDate } = req.body;
  db.prepare(
    `UPDATE vacancies SET
      title = COALESCE(?, title), description = COALESCE(?, description), requirements = COALESCE(?, requirements),
      skills = COALESCE(?, skills), industry = COALESCE(?, industry), location = COALESCE(?, location),
      employmentType = COALESCE(?, employmentType), minQualification = COALESCE(?, minQualification),
      salaryRange = COALESCE(?, salaryRange), closingDate = COALESCE(?, closingDate), updatedAt = datetime('now')
     WHERE id = ?`
  ).run(
    title || null,
    description || null,
    requirements || null,
    skills !== undefined ? JSON.stringify(skills) : null,
    industry || null,
    location || null,
    employmentType || null,
    minQualification || null,
    salaryRange || null,
    closingDate || null,
    req.params.id
  );
  res.json({ vacancy: db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id) });
});

router.patch("/jobs/:id/close", (req, res) => {
  db.prepare(`UPDATE vacancies SET status = 'closed', updatedAt = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.delete("/jobs/:id", (req, res) => {
  db.prepare(`DELETE FROM applications WHERE vacancyId = ?`).run(req.params.id);
  db.prepare(`DELETE FROM vacancies WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

/* =========================================================
   Reports
========================================================= */

router.get("/reports", (req, res) => {
  const usersByRole = db.prepare(`SELECT role, COUNT(*) c FROM users GROUP BY role`).all();
  const signupsByMonth = db
    .prepare(`SELECT strftime('%Y-%m', createdAt) month, COUNT(*) c FROM users GROUP BY month ORDER BY month DESC LIMIT 12`)
    .all();
  const jobsByIndustry = db.prepare(`SELECT industry, COUNT(*) c FROM vacancies GROUP BY industry`).all();
  const jobsByStatus = db.prepare(`SELECT status, COUNT(*) c FROM vacancies GROUP BY status`).all();
  const applicationsByStatus = db.prepare(`SELECT status, COUNT(*) c FROM applications GROUP BY status`).all();
  const avgAiScore = db.prepare(`SELECT AVG(aiScore) a FROM applications`).get().a || 0;

  res.json({
    usersByRole: Object.fromEntries(usersByRole.map((r) => [r.role, r.c])),
    signupsByMonth: signupsByMonth.reverse(),
    jobsByIndustry: Object.fromEntries(jobsByIndustry.map((r) => [r.industry || "Unspecified", r.c])),
    jobsByStatus: Object.fromEntries(jobsByStatus.map((r) => [r.status, r.c])),
    applicationsByStatus: Object.fromEntries(applicationsByStatus.map((r) => [r.status, r.c])),
    avgAiScore: Math.round(avgAiScore),
  });
});

/* =========================================================
   Security — login activity & account status
========================================================= */

router.get("/security/logins", (req, res) => {
  const { onlyFailed } = req.query;
  let rows = db.prepare(`SELECT * FROM login_logs ORDER BY createdAt DESC LIMIT 200`).all();
  if (onlyFailed === "true") rows = rows.filter((r) => r.success === 0);
  res.json({ logs: rows });
});

router.get("/security/summary", (req, res) => {
  const failedLast24h = db.prepare(`SELECT COUNT(*) c FROM login_logs WHERE success = 0 AND createdAt >= datetime('now','-1 day')`).get().c;
  const successLast24h = db.prepare(`SELECT COUNT(*) c FROM login_logs WHERE success = 1 AND createdAt >= datetime('now','-1 day')`).get().c;
  const suspendedAccounts = db.prepare(`SELECT COUNT(*) c FROM users WHERE isActive = 0`).get().c;
  // Emails with 3+ failed attempts in the last hour — worth a human look.
  const suspicious = db
    .prepare(
      `SELECT email, COUNT(*) c FROM login_logs WHERE success = 0 AND createdAt >= datetime('now','-1 hour') GROUP BY email HAVING c >= 3`
    )
    .all();
  res.json({ failedLast24h, successLast24h, suspendedAccounts, suspiciousEmails: suspicious });
});

/* =========================================================
   System settings
========================================================= */

router.get("/settings", (req, res) => {
  const rows = db.prepare(`SELECT * FROM settings`).all();
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
});

router.put("/settings", (req, res) => {
  const updates = req.body || {};
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  Object.entries(updates).forEach(([key, value]) => upsert.run(key, String(value)));
  const rows = db.prepare(`SELECT * FROM settings`).all();
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
});

module.exports = router;

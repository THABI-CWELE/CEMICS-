const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notifyCouncillors, notifyAdmins } = require("../utils/notify");

const router = express.Router();

function serializeVacancy(row) {
  if (!row) return null;
  return {
    ...row,
    skills: JSON.parse(row.skills || "[]"),
  };
}

function closeIfExpired(row) {
  if (row.status === "open" && row.closingDate) {
    const closing = new Date(row.closingDate);
    if (!isNaN(closing.valueOf()) && closing < new Date()) {
      db.prepare(`UPDATE vacancies SET status = 'closed', updatedAt = datetime('now') WHERE id = ?`).run(row.id);
      row.status = "closed";
    }
  }
  return row;
}

// Councillor only: every open vacancy across every employer, with basic
// search/filter. This is no longer a public/community-member-facing route —
// vacancies are posted to the councillor, who matches them against the
// community register rather than community members applying directly.
router.get("/", requireAuth, requireRole("councillor"), (req, res) => {
  const { q, industry, status } = req.query;
  let rows = db.prepare(`SELECT * FROM vacancies ORDER BY createdAt DESC`).all();
  rows = rows.map(closeIfExpired);

  if (status) {
    rows = rows.filter((r) => r.status === status);
  } else {
    rows = rows.filter((r) => r.status === "open");
  }
  if (industry) {
    rows = rows.filter((r) => (r.industry || "").toLowerCase() === industry.toLowerCase());
  }
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        (r.location || "").toLowerCase().includes(needle)
    );
  }

  // Attach poster's organisation name for display.
  const withPoster = rows.map((r) => {
    const poster = db.prepare("SELECT firstName, lastName, role, profile FROM users WHERE id = ?").get(r.postedBy);
    let posterName = poster ? `${poster.firstName} ${poster.lastName}` : "CEMICS";
    if (poster) {
      try {
        const p = JSON.parse(poster.profile || "{}");
        if (poster.role === "employer" && p.companyName) posterName = p.companyName;
        if (poster.role === "councillor" && p.municipality) posterName = p.municipality;
      } catch (e) {}
    }
    return { ...serializeVacancy(r), postedByName: posterName, postedByRole: poster ? poster.role : null };
  });

  res.json({ vacancies: withPoster });
});

// Employer/councillor: view own postings (including closed ones).
router.get("/mine", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  let rows = db
    .prepare(`SELECT * FROM vacancies WHERE postedBy = ? ORDER BY createdAt DESC`)
    .all(req.user.id)
    .map(closeIfExpired);

  const withCounts = rows.map((r) => {
    const total = db.prepare(`SELECT COUNT(*) c FROM applications WHERE vacancyId = ?`).get(r.id).c;
    const shortlisted = db
      .prepare(`SELECT COUNT(*) c FROM applications WHERE vacancyId = ? AND status = 'shortlisted'`)
      .get(r.id).c;
    return { ...serializeVacancy(r), applicantCount: total, shortlistedCount: shortlisted };
  });

  res.json({ vacancies: withCounts });
});

// Employer/councillor only: single vacancy detail. Community members no
// longer view individual postings — the councillor forwards them instead.
router.get("/:id", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const row = db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Vacancy not found." });
  closeIfExpired(row);
  res.json({ vacancy: serializeVacancy(row) });
});

router.post("/", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const {
    title,
    description,
    requirements,
    skills,
    industry,
    location,
    employmentType,
    minQualification,
    salaryRange,
    closingDate,
  } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: "Title and description are required." });
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO vacancies
      (id, postedBy, title, description, requirements, skills, industry, location, employmentType, minQualification, salaryRange, closingDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user.id,
    title.trim(),
    description.trim(),
    requirements || "",
    JSON.stringify(Array.isArray(skills) ? skills : String(skills || "").split(",").map((s) => s.trim()).filter(Boolean)),
    industry || null,
    location || null,
    employmentType || "Full-time",
    minQualification || null,
    salaryRange || null,
    closingDate || null
  );

  const vacancy = serializeVacancy(db.prepare("SELECT * FROM vacancies WHERE id = ?").get(id));
  notifyCouncillors(vacancy, req.user);
  notifyAdmins("new_vacancy_posted", "New vacancy posted", `"${vacancy.title}" was posted by ${req.user.firstName} ${req.user.lastName}.`, vacancy.id);
  res.status(201).json({ vacancy });
});

function assertOwnership(req, res) {
  const vacancy = db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id);
  if (!vacancy) {
    res.status(404).json({ error: "Vacancy not found." });
    return null;
  }
  if (vacancy.postedBy !== req.user.id) {
    res.status(403).json({ error: "You can only manage vacancies you posted." });
    return null;
  }
  return vacancy;
}

router.put("/:id", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const vacancy = assertOwnership(req, res);
  if (!vacancy) return;

  const fields = [
    "title",
    "description",
    "requirements",
    "industry",
    "location",
    "employmentType",
    "minQualification",
    "salaryRange",
    "closingDate",
  ];
  const updates = {};
  fields.forEach((f) => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });
  const skills = req.body.skills;

  db.prepare(
    `UPDATE vacancies SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      requirements = COALESCE(?, requirements),
      skills = COALESCE(?, skills),
      industry = COALESCE(?, industry),
      location = COALESCE(?, location),
      employmentType = COALESCE(?, employmentType),
      minQualification = COALESCE(?, minQualification),
      salaryRange = COALESCE(?, salaryRange),
      closingDate = COALESCE(?, closingDate),
      updatedAt = datetime('now')
     WHERE id = ?`
  ).run(
    updates.title ?? null,
    updates.description ?? null,
    updates.requirements ?? null,
    skills !== undefined ? JSON.stringify(Array.isArray(skills) ? skills : String(skills).split(",").map((s) => s.trim()).filter(Boolean)) : null,
    updates.industry ?? null,
    updates.location ?? null,
    updates.employmentType ?? null,
    updates.minQualification ?? null,
    updates.salaryRange ?? null,
    updates.closingDate ?? null,
    req.params.id
  );

  const updated = serializeVacancy(db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id));
  res.json({ vacancy: updated });
});

router.patch("/:id/close", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const vacancy = assertOwnership(req, res);
  if (!vacancy) return;
  db.prepare(`UPDATE vacancies SET status = 'closed', updatedAt = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ vacancy: serializeVacancy(db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id)) });
});

router.patch("/:id/reopen", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const vacancy = assertOwnership(req, res);
  if (!vacancy) return;
  db.prepare(`UPDATE vacancies SET status = 'open', updatedAt = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ vacancy: serializeVacancy(db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id)) });
});

router.delete("/:id", requireAuth, requireRole("employer", "councillor"), (req, res) => {
  const vacancy = assertOwnership(req, res);
  if (!vacancy) return;
  db.prepare(`DELETE FROM applications WHERE vacancyId = ?`).run(req.params.id);
  db.prepare(`DELETE FROM vacancies WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

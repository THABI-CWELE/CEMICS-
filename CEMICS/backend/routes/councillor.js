/* =========================================================
   CEMICS — Councillor routes
   The councillor is the single point of contact between
   employers and the community. Employers post vacancies to
   the councillor (never directly to community members); the
   councillor holds the full community-member register, finds
   suitable candidates, and forwards ("refers") them to the
   employer. Community members register and keep their own
   profile/CV/documents up to date (see routes/users.js) but
   never apply to a vacancy themselves.
========================================================= */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { publicUser } = require("./auth");
const { scoreApplication } = require("../utils/scoring");
const { notify } = require("../utils/notify");

const router = express.Router();
router.use(requireAuth, requireRole("councillor"));

function serializeVacancy(row) {
  if (!row) return null;
  return { ...row, skills: JSON.parse(row.skills || "[]") };
}

/* =========================================================
   Community member register — every registered community
   member, with basic search so the councillor can find who's
   suitable for a given vacancy.
========================================================= */
router.get("/members", (req, res) => {
  const { q, skill, fieldOfInterest, qualification } = req.query;
  let rows = db.prepare(`SELECT * FROM users WHERE role = 'seeker' ORDER BY createdAt DESC`).all();

  rows = rows.map((u) => ({ ...u, _profile: (() => { try { return JSON.parse(u.profile || "{}"); } catch (e) { return {}; } })() }));

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        (u._profile.skills || "").toLowerCase().includes(needle)
    );
  }
  if (skill) {
    const needle = skill.toLowerCase();
    rows = rows.filter((u) => (u._profile.skills || "").toLowerCase().includes(needle));
  }
  if (fieldOfInterest) {
    rows = rows.filter((u) => (u._profile.fieldOfInterest || "").toLowerCase() === fieldOfInterest.toLowerCase());
  }
  if (qualification) {
    rows = rows.filter((u) => (u._profile.qualification || "") === qualification);
  }

  const members = rows.map((u) => ({ ...publicUser(u), hasCv: Boolean(u.cvPath) }));
  res.json({ members });
});

router.get("/members/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'seeker'").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Community member not found." });

  const referrals = db
    .prepare(
      `SELECT a.*, v.title as vacancyTitle FROM applications a JOIN vacancies v ON v.id = a.vacancyId
       WHERE a.seekerId = ? ORDER BY a.appliedAt DESC`
    )
    .all(user.id);

  res.json({ member: publicUser(user), referrals });
});

/* =========================================================
   Org-wide vacancies — every open role posted by any employer,
   so the councillor can match candidates against the full pool
   rather than just what one employer posted.
========================================================= */
router.get("/vacancies", (req, res) => {
  const { status, q } = req.query;
  let rows = db.prepare(`SELECT * FROM vacancies ORDER BY createdAt DESC`).all();
  if (status) rows = rows.filter((v) => v.status === status);
  else rows = rows.filter((v) => v.status === "open");
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((v) => v.title.toLowerCase().includes(needle) || (v.description || "").toLowerCase().includes(needle));
  }

  const withDetail = rows.map((v) => {
    const employer = db.prepare("SELECT firstName, lastName, profile FROM users WHERE id = ?").get(v.postedBy);
    let employerName = employer ? `${employer.firstName} ${employer.lastName}` : "Unknown";
    if (employer) {
      try {
        const p = JSON.parse(employer.profile || "{}");
        if (p.companyName) employerName = p.companyName;
      } catch (e) {}
    }
    const referredCount = db.prepare(`SELECT COUNT(*) c FROM applications WHERE vacancyId = ?`).get(v.id).c;
    return { ...serializeVacancy(v), employerName, referredCount };
  });

  res.json({ vacancies: withDetail });
});

/* =========================================================
   Suggested matches — ranks every community member who hasn't
   already been referred to this vacancy, using the same scoring
   engine employers see once a referral is made.
========================================================= */
router.get("/vacancies/:id/suggestions", (req, res) => {
  const vacancy = db.prepare("SELECT * FROM vacancies WHERE id = ?").get(req.params.id);
  if (!vacancy) return res.status(404).json({ error: "Vacancy not found." });

  const alreadyReferred = new Set(
    db.prepare(`SELECT seekerId FROM applications WHERE vacancyId = ?`).all(vacancy.id).map((r) => r.seekerId)
  );

  const vacancyForScoring = { ...vacancy, skills: JSON.parse(vacancy.skills || "[]") };
  const members = db.prepare(`SELECT * FROM users WHERE role = 'seeker'`).all();

  const suggestions = members
    .filter((m) => !alreadyReferred.has(m.id))
    .map((m) => {
      let profile = {};
      try {
        profile = JSON.parse(m.profile || "{}");
      } catch (e) {}
      const { score, breakdown } = scoreApplication(profile, "", vacancyForScoring);
      return { member: publicUser(m), hasCv: Boolean(m.cvPath), score, breakdown };
    })
    .sort((a, b) => b.score - a.score);

  res.json({ vacancy: serializeVacancy(vacancy), suggestions });
});

/* =========================================================
   Refer — the councillor forwards a community member to an
   employer's vacancy. This is the only way an application gets
   created; from here the existing status/interview/notification
   flow (applications.js) carries on unchanged.
========================================================= */
router.post("/refer", (req, res) => {
  const { vacancyId, memberId, coverLetter } = req.body;
  if (!vacancyId || !memberId) return res.status(400).json({ error: "vacancyId and memberId are required." });

  const vacancy = db.prepare("SELECT * FROM vacancies WHERE id = ?").get(vacancyId);
  if (!vacancy) return res.status(404).json({ error: "Vacancy not found." });
  if (vacancy.status !== "open") return res.status(400).json({ error: "This vacancy is no longer open." });

  const member = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'seeker'").get(memberId);
  if (!member) return res.status(404).json({ error: "Community member not found." });
  if (!member.cvPath) return res.status(400).json({ error: "This community member hasn't uploaded a CV yet." });

  const already = db.prepare("SELECT id FROM applications WHERE vacancyId = ? AND seekerId = ?").get(vacancyId, memberId);
  if (already) return res.status(409).json({ error: "This community member has already been referred to this vacancy." });

  let profile = {};
  try {
    profile = JSON.parse(member.profile || "{}");
  } catch (e) {}
  const vacancyForScoring = { ...vacancy, skills: JSON.parse(vacancy.skills || "[]") };
  const { score, breakdown } = scoreApplication(profile, coverLetter || "", vacancyForScoring);

  const id = uuidv4();
  db.prepare(
    `INSERT INTO applications (id, vacancyId, seekerId, cvPath, cvOriginalName, coverLetter, aiScore, aiBreakdown, referredBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, vacancyId, memberId, member.cvPath, member.cvOriginalName, coverLetter || "", score, JSON.stringify(breakdown), req.user.id);

  notify(
    vacancy.postedBy,
    "new_referral",
    "Your councillor forwarded a candidate",
    `${req.user.firstName} ${req.user.lastName} (your councillor) put forward ${member.firstName} ${member.lastName} for "${vacancy.title}".`,
    vacancy.id
  );
  notify(
    member.id,
    "referred",
    "You've been put forward for a role",
    `Your councillor forwarded your profile to the employer for "${vacancy.title}".`,
    vacancy.id
  );

  const application = db.prepare("SELECT * FROM applications WHERE id = ?").get(id);
  res.status(201).json({ application: { ...application, documents: JSON.parse(application.documents || "[]"), aiBreakdown: JSON.parse(application.aiBreakdown || "{}") } });
});

module.exports = router;

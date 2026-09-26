const express = require("express");
const path = require("path");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { uploadCV, uploadDocuments } = require("../middleware/upload");
const { publicUser } = require("./auth");

const router = express.Router();

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.put("/me", requireAuth, (req, res) => {
  const { firstName, lastName, phone, address, profile } = req.body;
  const current = JSON.parse(req.user.profile || "{}");
  const mergedProfile = { ...current, ...(profile || {}) };

  db.prepare(
    `UPDATE users SET firstName = ?, lastName = ?, phone = ?, address = ?, profile = ?, updatedAt = datetime('now') WHERE id = ?`
  ).run(
    firstName || req.user.firstName,
    lastName || req.user.lastName,
    phone || req.user.phone,
    address || req.user.address,
    JSON.stringify(mergedProfile),
    req.user.id
  );

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: publicUser(updated) });
});

// Community members keep one primary CV on file, reusable when the councillor refers them.
router.post("/me/cv", requireAuth, requireRole("seeker"), uploadCV.single("cv"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No CV file received." });

  db.prepare(`UPDATE users SET cvPath = ?, cvOriginalName = ?, updatedAt = datetime('now') WHERE id = ?`).run(
    `/uploads/cv/${req.file.filename}`,
    req.file.originalname,
    req.user.id
  );

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: publicUser(updated) });
});

// Supporting documents: certificates, ID copy, references, etc. Multiple allowed.
router.post(
  "/me/documents",
  requireAuth,
  requireRole("seeker"),
  uploadDocuments.array("documents", 5),
  (req, res) => {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "No documents received." });
    }
    const current = JSON.parse(req.user.documents || "[]");
    const added = req.files.map((f) => ({
      name: f.originalname,
      path: `/uploads/documents/${f.filename}`,
      uploadedAt: new Date().toISOString(),
    }));
    const merged = [...current, ...added];

    db.prepare(`UPDATE users SET documents = ?, updatedAt = datetime('now') WHERE id = ?`).run(
      JSON.stringify(merged),
      req.user.id
    );

    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json({ user: publicUser(updated) });
  }
);

module.exports = router;

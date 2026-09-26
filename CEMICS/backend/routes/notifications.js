const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50`)
    .all(req.user.id);
  const unreadCount = db
    .prepare(`SELECT COUNT(*) c FROM notifications WHERE userId = ? AND isRead = 0`)
    .get(req.user.id).c;
  res.json({ notifications: rows, unreadCount });
});

router.patch("/:id/read", requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.patch("/read-all", requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET isRead = 1 WHERE userId = ?`).run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;

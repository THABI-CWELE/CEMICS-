const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");
const { notifyAdmins } = require("../utils/notify");

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function publicUser(user) {
  let profile = {};
  try {
    profile = JSON.parse(user.profile || "{}");
  } catch (e) {
    profile = {};
  }
  return {
    id: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    address: user.address,
    profile,
    cvOriginalName: user.cvOriginalName || null,
    documents: JSON.parse(user.documents || "[]"),
    isActive: user.isActive !== 0,
    createdAt: user.createdAt,
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

router.post("/register", (req, res) => {
  try {
    const allowSetting = db.prepare(`SELECT value FROM settings WHERE key = 'allowRegistrations'`).get();
    if (allowSetting && allowSetting.value === "false") {
      return res.status(403).json({ error: "New registrations are currently disabled by the CEMICS administrator." });
    }

    const {
      role,
      firstName,
      lastName,
      idNumber,
      phone,
      email,
      address,
      password,
      profile,
    } = req.body;

    if (!["seeker", "employer", "councillor"].includes(role)) {
      return res.status(400).json({ error: "Invalid account role." });
    }
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);

    db.prepare(
      `INSERT INTO users (id, role, firstName, lastName, idNumber, phone, email, address, passwordHash, profile)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      role,
      firstName.trim(),
      lastName.trim(),
      idNumber || null,
      phone || null,
      email.toLowerCase().trim(),
      address || null,
      passwordHash,
      JSON.stringify(profile || {})
    );

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    const token = signToken(user);
    notifyAdmins(
      "new_registration",
      "New account registered",
      `${firstName} ${lastName} signed up as a ${role}.`,
      id
    );
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const cleanEmail = email.toLowerCase().trim();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(cleanEmail);
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
    const userAgent = req.headers["user-agent"] || "";

    function logAttempt(success, reason, userId) {
      db.prepare(
        `INSERT INTO login_logs (id, userId, email, success, reason, ip, userAgent) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), userId || null, cleanEmail, success ? 1 : 0, reason || null, String(ip), userAgent);
    }

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      logAttempt(false, "Invalid credentials", user ? user.id : null);
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (user.isActive === 0) {
      logAttempt(false, "Account suspended", user.id);
      return res.status(403).json({ error: "This account has been suspended. Please contact the CEMICS administrator." });
    }
    const maintenance = db.prepare(`SELECT value FROM settings WHERE key = 'maintenanceMode'`).get();
    if (maintenance && maintenance.value === "true" && user.role !== "admin") {
      logAttempt(false, "Maintenance mode", user.id);
      return res.status(503).json({ error: "CEMICS is currently undergoing maintenance. Please try again shortly." });
    }

    logAttempt(true, "Login successful", user.id);
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, publicUser };

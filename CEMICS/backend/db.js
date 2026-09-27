/* =========================================================
   CEMICS — database layer (Node's built-in node:sqlite)
   Single-file embedded database, zero external DB server and
   zero native-module compilation needed — this ships as part
   of Node.js itself (v22.5+), so there's nothing for npm to
   build. Good enough for a community-scale deployment; swap
   for Postgres later without touching the routes much since
   all access goes through the same prepare/run/get/all calls.
========================================================= */

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "cemics.db"), {
  enableForeignKeyConstraints: true,
});
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('seeker','employer','councillor','actor','admin')),
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  idNumber TEXT,
  phone TEXT,
  email TEXT NOT NULL UNIQUE,
  address TEXT,
  passwordHash TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '{}',
  cvPath TEXT,
  cvOriginalName TEXT,
  documents TEXT NOT NULL DEFAULT '[]',
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY,
  postedBy TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  requirements TEXT DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  industry TEXT,
  location TEXT,
  employmentType TEXT DEFAULT 'Full-time',
  minQualification TEXT,
  salaryRange TEXT,
  closingDate TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  vacancyId TEXT NOT NULL REFERENCES vacancies(id),
  seekerId TEXT NOT NULL REFERENCES users(id),
  cvPath TEXT,
  cvOriginalName TEXT,
  coverLetter TEXT DEFAULT '',
  documents TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK(status IN ('submitted','shortlisted','interview','rejected','hired')),
  aiScore INTEGER NOT NULL DEFAULT 0,
  aiBreakdown TEXT NOT NULL DEFAULT '{}',
  appliedAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  referredBy TEXT REFERENCES users(id),
  UNIQUE(vacancyId, seekerId)
);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id),
  scheduledAt TEXT NOT NULL,
  mode TEXT DEFAULT 'In-person',
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  relatedId TEXT,
  isRead INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_logs (
  id TEXT PRIMARY KEY,
  userId TEXT,
  email TEXT NOT NULL,
  success INTEGER NOT NULL,
  reason TEXT,
  ip TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_vacancies_status ON vacancies(status);
CREATE INDEX IF NOT EXISTS idx_applications_vacancy ON applications(vacancyId);
CREATE INDEX IF NOT EXISTS idx_applications_seeker ON applications(seekerId);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId);
`);

// Migration: older databases created before the councillor-mediated referral
// workflow existed won't have this column yet — add it if missing.
try {
  db.exec(`ALTER TABLE applications ADD COLUMN referredBy TEXT REFERENCES users(id)`);
} catch (e) {
  /* column already exists — fine */
}

// Seed sane defaults for system settings (idempotent).
const DEFAULT_SETTINGS = {
  siteName: "CEMICS",
  allowRegistrations: "true",
  maintenanceMode: "false",
  supportEmail: "support@cemics.org.za",
};
const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => insertSetting.run(k, v));
try{
  const b=require('bcryptjs');
  if(!db.prepare("SELECT id FROM users WHERE email=?").get('admin@cemics.com')){
    const h=b.hashSync('admin123',10);
    db.prepare("INSERT INTO users (firstname,lastname,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)").run('Admin','User','admin@cemics.com','0000000000',h,'admin');
    console.log('ADMIN CREATED');
  }
}catch(e){ console.log('Admin error:',e.message); }
module.exports = db;

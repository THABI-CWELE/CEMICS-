const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("./db");

// delete broken admin
db.prepare("DELETE FROM users WHERE email = ?").run("cemics2026#");
db.prepare("DELETE FROM users WHERE email LIKE '%CEMICS%'").run();

// create correct admin
const id = uuidv4();
db.prepare(`INSERT INTO users (id, role, firstName, lastName, email, passwordHash, isActive) VALUES (?, ?, ?, ?, ?, ?, 1)`).run(
  id,
  "admin",
  "CEMICS",
  "ADMIN",
  "admin@cemics.com",
  bcrypt.hashSync("CEMICS2026#", 10)
);
console.log("DONE! Admin created:");
console.log("Email: admin@cemics.com");
console.log("Password: CEMICS2026#");
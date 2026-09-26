/**
 * One-time setup script: creates a System Administrator account directly in
 * the database. Admin accounts are never exposed through public /api/auth/register.
 *
 * Usage:
 *   node create-admin.js "Jane" "Doe" jane@cemics.org.za "a-strong-password"
 *
 * Or run with no arguments and answer the prompts interactively.
 */

const readline = require("readline");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("./db");

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  let [firstName, lastName, email, password] = process.argv.slice(2);

  if (!firstName || !lastName || !email || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("Create the first CEMICS System Administrator account.\n");
    firstName = firstName || (await ask(rl, "First name: "));
    lastName = lastName || (await ask(rl, "Last name: "));
    email = email || (await ask(rl, "Email: "));
    password = password || (await ask(rl, "Password (min 8 characters): "));
    rl.close();
  }

  if (!firstName || !lastName || !email || !password) {
    console.error("\nAll fields are required. Aborting.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("\nPassword must be at least 8 characters. Aborting.");
    process.exit(1);
  }

  const cleanEmail = email.toLowerCase().trim();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail);
  if (existing) {
    if (existing.role === "admin") {
      console.error(`\nAn admin account already exists for ${cleanEmail}. Nothing to do.`);
    } else {
      console.error(`\nAn account with ${cleanEmail} already exists with a different role. Choose a different email.`);
    }
    process.exit(1);
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO users (id, role, firstName, lastName, email, passwordHash, profile) VALUES (?, 'admin', ?, ?, ?, ?, '{}')`
  ).run(id, firstName.trim(), lastName.trim(), cleanEmail, bcrypt.hashSync(password, 10));

  console.log(`\n✅ System Administrator account created for ${firstName} ${lastName} <${cleanEmail}>.`);
  console.log("You can now log in at /login.html with these credentials.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

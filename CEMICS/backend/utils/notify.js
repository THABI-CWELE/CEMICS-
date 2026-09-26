const { v4: uuidv4 } = require("uuid");
const db = require("../db");

function notify(userId, type, title, message, relatedId = null) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO notifications (id, userId, type, title, message, relatedId) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, type, title, message, relatedId);
  return id;
}

/**
 * Notify every councillor account that a new vacancy has come in from an
 * employer and is waiting to be matched against the community register.
 * Vacancies are no longer broadcast to community members directly — the
 * councillor reviews the community member records and forwards suitable
 * candidates back to the employer.
 */
function notifyCouncillors(vacancy, postedByUser) {
  const councillors = db.prepare(`SELECT id FROM users WHERE role = 'councillor' AND isActive = 1`).all();
  const posterName = postedByUser ? `${postedByUser.firstName} ${postedByUser.lastName}` : "An employer";
  councillors.forEach((c) => {
    notify(
      c.id,
      "new_vacancy_for_review",
      "New vacancy needs matching",
      `${posterName} posted "${vacancy.title}"${vacancy.industry ? ` (${vacancy.industry})` : ""}. Review the community register for suitable candidates.`,
      vacancy.id
    );
  });
}

/** Notify all admin accounts of a system event (new registrations, etc). */
function notifyAdmins(type, title, message, relatedId = null) {
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND isActive = 1`).all();
  admins.forEach((a) => notify(a.id, type, title, message, relatedId));
}

module.exports = { notify, notifyCouncillors, notifyAdmins };

require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const { router: authRouter } = require("./routes/auth");
const usersRouter = require("./routes/users");
const vacanciesRouter = require("./routes/vacancies");
const applicationsRouter = require("./routes/applications");
const notificationsRouter = require("./routes/notifications");
const adminRouter = require("./routes/admin");
const councillorRouter = require("./routes/councillor");

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ROOT = path.join(__dirname, ".."); // CEMICS/ (contains index.html, styles.css, etc.)

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API routes ---
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/vacancies", vacanciesRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/councillor", councillorRouter);

app.get("/api/health", (req, res) => res.json({ ok: true, service: "CEMICS backend", time: new Date().toISOString() }));
app.get("/create-admin",(req,res)=>{try{const b=require('bcryptjs');const c=require('crypto');const db=require('./db');if(db.prepare("SELECT id FROM users WHERE email=?").get('admin@cemics.com')) return res.send('Admin exists - login now');const h=b.hashSync('admin123',10);const id=c.randomUUID();db.prepare("INSERT INTO users (id,role,firstName,lastName,email,phone,passwordHash) VALUES (?,?,?,?,?,?,?)").run(id,'admin','Admin','User','admin@cemics.com','0000000000',h);res.send('ADMIN CREATED - login with admin@cemics.com / admin123');}catch(e){res.send('Error: '+e.message);}});
// --- Uploaded files (CVs, supporting documents) ---
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- Serve the CEMICS front-end from the same origin so it "just works" ---
// (Never expose the backend/ folder itself — only the sibling frontend files.)
app.use((req, res, next) => {
  if (req.path.startsWith("/backend")) return res.status(404).end();
  next();
});
app.use(express.static(FRONTEND_ROOT, { index: "index.html" }));

// --- Centralised error handler (e.g. Multer file-type/size errors) ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`\nCEMICS backend running: http://localhost:${PORT}`);
  console.log(`Frontend served from:   ${FRONTEND_ROOT}`);
  console.log(`API base:               http://localhost:${PORT}/api\n`);
});

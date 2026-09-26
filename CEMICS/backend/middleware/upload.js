const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");
["cv", "documents"].forEach((sub) => {
  const dir = path.join(UPLOAD_ROOT, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];

function storageFor(subfolder) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(UPLOAD_ROOT, subfolder)),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  });
}

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return cb(new Error("Unsupported file type. Use PDF, Word or image files."));
  }
  cb(null, true);
}

const uploadCV = multer({
  storage: storageFor("cv"),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

const uploadDocuments = multer({
  storage: storageFor("documents"),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

module.exports = { uploadCV, uploadDocuments, UPLOAD_ROOT };

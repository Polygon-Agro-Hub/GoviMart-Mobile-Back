const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const brUpload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|heic|heif|pdf/;
    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    const extname = filetypes.test(ext);
    const mimetype =
      /image\/(jpeg|jpg|png|heic|heif|heic-sequence|heif-sequence)|application\/pdf|application\/octet-stream/.test(
        file.mimetype
      ) || filetypes.test(file.mimetype);

    if (extname || mimetype) {
      return cb(null, true);
    } else {
      return cb(new Error("Only PDF, JPG, PNG, and HEIC files are allowed (max 10MB)"));
    }
  },
});

module.exports = { brUpload };


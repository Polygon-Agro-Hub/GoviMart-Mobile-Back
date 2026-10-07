const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|heic|heif|webp/;
    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    const extname = filetypes.test(ext);
    const mimetype =
      /image\/(jpeg|jpg|png|heic|heif|heic-sequence|heif-sequence|webp)|application\/octet-stream/.test(
        file.mimetype,
      ) || filetypes.test(file.mimetype);

    if (extname || mimetype) {
      return cb(null, true);
    } else {
      return cb(new Error("Only images (JPG, PNG, HEIC, WEBP) are allowed"));
    }
  },
});


module.exports = { upload };

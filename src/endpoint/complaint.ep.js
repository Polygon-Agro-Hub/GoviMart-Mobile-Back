const path = require("path");
const convert = require("heic-convert");
const complainDao = require("../dao/complaint.dao");
const asyncHandler = require("express-async-handler");
const uploadFileToS3 = require("../middlewares/s3upload"); // adjust path to your s3 upload util
const {
  createComplainSchema,
} = require("../validations/complaint.validations");

// ---------- HEIC helpers ----------
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

const isHeic = (file) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (/image\/(heic|heif|heic-sequence|heif-sequence)/.test(file.mimetype || "")) {
    return true;
  }
  if (ext === ".heic" || ext === ".heif") return true;

  // Sniff magic bytes (covers application/octet-stream with no/wrong extension)
  if (file.buffer && file.buffer.length > 12) {
    const isFtyp = file.buffer.toString("ascii", 4, 8) === "ftyp";
    const brand = file.buffer.toString("ascii", 8, 12);
    return isFtyp && HEIC_BRANDS.includes(brand);
  }
  return false;
};

// Converts HEIC/HEIF to JPEG; passes everything else through untouched
const normalizeImage = async (file) => {
  if (!isHeic(file)) {
    return { buffer: file.buffer, name: file.originalname };
  }

  const output = await convert({
    buffer: file.buffer,
    format: "JPEG",
    quality: 0.8,
  });

  const baseName = (file.originalname || `image_${Date.now()}`).replace(
    /\.[^.]+$/,
    "",
  );

  return { buffer: Buffer.from(output), name: `${baseName}.jpg` };
};

// Get All Complain Categories
exports.getComplainCategories = asyncHandler(async (req, res) => {
  try {
    const categories = await complainDao.getComplainCategoriesDao();

    return res.status(200).json({
      status: true,
      data: categories,
    });
  } catch (err) {
    console.error("Error in getComplainCategories:", err.message);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch complain categories",
      error: err.message,
    });
  }
});

// Create Complain
exports.createComplain = asyncHandler(async (req, res) => {
  const { error } = createComplainSchema.validate(req.body, {
    abortEarly: false,
  });

  if (error) {
    return res.status(400).json({
      status: false,
      message: "Validation error",
      errors: error.details.map((err) => err.message),
    });
  }

  const { complaicategoryId, complain } = req.body;
  const userId = req.user.id;

  try {
    // Generate next ref id: [CUS_ID]000, [CUS_ID]001, [CUS_ID]002, etc.
    let cusId = await complainDao.getUserCusIdDao(userId);
    if (!cusId) {
      cusId = `CUS-${userId}`;
    }

    const lastRefId = await complainDao.getLastComplainRefIdByUserDao(
      userId,
      cusId,
    );

    let nextRefId;
    if (!lastRefId) {
      nextRefId = `${cusId}000`;
    } else {
      const suffix = lastRefId.substring(cusId.length);
      const numericPart = parseInt(suffix, 10);
      if (isNaN(numericPart)) {
        nextRefId = `${cusId}000`;
      } else {
        nextRefId = `${cusId}${(numericPart + 1).toString().padStart(3, "0")}`;
      }
    }

    // Insert complain record first
    const complainId = await complainDao.createComplainDao(
      userId,
      complaicategoryId,
      nextRefId,
      complain,
    );

    // Convert (if HEIC) and upload images (if any), then save URLs
    const uploadedImages = [];
    let failedImages = 0;

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const { buffer, name } = await normalizeImage(file);

          const imageUrl = await uploadFileToS3(
            buffer,
            name,
            "complain-images",
          );
          await complainDao.addComplainImageDao(complainId, imageUrl);
          uploadedImages.push(imageUrl);
        } catch (uploadErr) {
          failedImages++;
          console.error(
            `Failed to process/upload complaint image (${file.originalname}):`,
            uploadErr.message,
          );
          // continue with remaining images even if one fails
        }
      }
    }

    return res.status(201).json({
      status: true,
      message: "Complaint submitted successfully.",
      data: {
        id: complainId,
        refId: nextRefId,
        images: uploadedImages,
        failedImages,
      },
    });
  } catch (err) {
    console.error("Error creating complain:", err.message);
    return res.status(500).json({
      status: false,
      message: "Failed to submit complaint",
      error: err.message,
    });
  }
});

exports.getUserComplains = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  try {
    const complains = await complainDao.getComplainsByUserIdDao(userId);

    return res.status(200).json({
      status: true,
      data: complains,
    });
  } catch (err) {
    console.error("Error in getUserComplains:", err.message);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch complaints",
      error: err.message,
    });
  }
});

// Get Complaint Details By ID
exports.getComplainDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (!id || isNaN(id)) {
    return res.status(400).json({
      status: false,
      message: "Valid complaint id is required.",
    });
  }

  try {
    const complain = await complainDao.getComplainByIdDao(id);

    if (!complain) {
      return res.status(404).json({
        status: false,
        message: "Complaint not found.",
      });
    }

    // Ownership check - user can only view their own complaint
    if (complain.userId !== userId) {
      return res.status(403).json({
        status: false,
        message: "You are not authorized to view this complaint.",
      });
    }

    return res.status(200).json({
      status: true,
      data: complain,
    });
  } catch (err) {
    console.error("Error in getComplainDetails:", err.message);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch complaint details",
      error: err.message,
    });
  }
});
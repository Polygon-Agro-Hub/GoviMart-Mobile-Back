const complainDao = require("../dao/complaint.dao");
const asyncHandler = require("express-async-handler");
const uploadFileToS3 = require("../middlewares/s3upload"); // adjust path to your s3 upload util
const {
  createComplainSchema,
} = require("../validations/complaint.validations");

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
    // Generate next CMP-XXXXX ref id
    const lastRefId = await complainDao.getLastComplainRefIdDao();
    let nextRefId;
    if (!lastRefId) {
      nextRefId = "CMP-00001";
    } else {
      const numericPart = parseInt(lastRefId.split("-")[1], 10);
      nextRefId = `CMP-${(numericPart + 1).toString().padStart(5, "0")}`;
    }

    // Insert complain record first
    const complainId = await complainDao.createComplainDao(
      userId,
      complaicategoryId,
      nextRefId,
      complain,
    );

    // Upload images (if any) to R2 and save URLs
    const uploadedImages = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const imageUrl = await uploadFileToS3(
            file.buffer,
            file.originalname,
            "complain-images",
          );
          await complainDao.addComplainImageDao(complainId, imageUrl);
          uploadedImages.push(imageUrl);
        } catch (uploadErr) {
          console.error(
            "Failed to upload one complaint image:",
            uploadErr.message,
          );
          // continue uploading remaining images even if one fails
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

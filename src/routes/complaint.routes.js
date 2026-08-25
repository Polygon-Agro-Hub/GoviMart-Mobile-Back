const express = require("express");
const router = express.Router();
const complainEndpoint = require("../endpoint/complaint.ep");
const { upload } = require("../middlewares/multer.middleware");
const authMiddleware = require("../middlewares/auth.middleware");

// Get All Complaint Categories
router.get(
  "/categories", 
  authMiddleware,
  complainEndpoint.getComplainCategories
);

// Create Complaint
router.post(
  "/create-complain",
  authMiddleware,
  upload.array("images", 6),
  complainEndpoint.createComplain,
);

// Get All Complaints for User
router.get("/my-complaints", 
  authMiddleware, 
  complainEndpoint.getUserComplains
);

// View Single Complaint Details
router.get(
  "/complain/:id",
  authMiddleware,
  complainEndpoint.getComplainDetails,
);

module.exports = router;

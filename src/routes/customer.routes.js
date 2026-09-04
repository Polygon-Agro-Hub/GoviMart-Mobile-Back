const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const { upload } = require("../middlewares/multer.middleware");
const customerEp = require("../endpoint/customer.ep");

// Upload customer profile image
router.post(
  "/upload-profile-image",
  authMiddleware,
  upload.single("profileImage"),
  customerEp.uploadProfileImage
);

// Get customer profile info
router.get("/profile", authMiddleware, customerEp.getCustomerProfile);

// Get suggested crop list (all crops)
router.get("/marketplace/suggestions", authMiddleware, customerEp.getSuggestions);

// Get user's preferred (included) items
router.get("/marketplace/include-items", authMiddleware, customerEp.getIncludeItems);

// Add items to user's preferred (included) list
router.post("/marketplace/add-include-items", authMiddleware, customerEp.addIncludeItems);

// Delete items from user's preferred (included) list
router.post("/marketplace/delete-included", authMiddleware, customerEp.deleteIncluded);

// Get user's excluded items
router.get("/marketplace/excluded-items", authMiddleware, customerEp.getExcludeItems);

// Add items to user's excluded list
router.post("/marketplace/exclude-items", authMiddleware, customerEp.addExcludeItems);

// Delete items from user's excluded list
router.post("/marketplace/delete-excluded", authMiddleware, customerEp.deleteExcluded);

// Update firstTimeUser status
router.post("/update-user-status", authMiddleware, customerEp.updateUserStatus);

// Get User Saved All Addresses
router.get('/fetch-saved-addresses', authMiddleware, customerEp.getSavedAddresses);

// Get User Account Details with Credit Balance
router.get("/account-details", authMiddleware, customerEp.getAccountDetails);

// Add User Address
router.post("/add-address", authMiddleware, customerEp.addAddress);

// Update User Address
router.put("/update-address/:addressId", authMiddleware, customerEp.updateAddress);

// Delete User Address
router.delete("/delete-address/:addressId", authMiddleware, customerEp.deleteAddress);

// Update User Details
router.put("/update-details", authMiddleware, customerEp.updateUserDetails);

// Get Delete Account Status (Credit Balance & Active Orders)
router.get("/delete-account-status", authMiddleware, customerEp.getDeleteAccountStatus);

// Delete User Account
router.delete("/delete-account", authMiddleware, customerEp.deleteUserAccount);

// Send OTP to verify a new phone number
router.post("/send-phone-change-otp", authMiddleware, customerEp.sendPhoneChangeOtp);

// Verify phone change OTP and update the number
router.post("/verify-phone-change-otp", authMiddleware, customerEp.verifyPhoneChange);

// Resend phone change OTP
router.post("/resend-phone-change-otp", authMiddleware, customerEp.resendPhoneChangeOtp);

// Update / Clear Credit Balance
router.put("/update-credit-balance", authMiddleware, customerEp.updateCreditBalance);

module.exports = router;

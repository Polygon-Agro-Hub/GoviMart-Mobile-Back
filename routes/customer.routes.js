const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const customerEp = require("../endpoint/customer.ep");

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

// Get User Account Details with Credit Balance

// Get User Saved All Addresses

// Add User Address

// Update User Address

// Delete User Address

// Update User Details

// Delete User Account

module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const cartEp = require("../endpoint/cart.ep");

// Get active cart for logged in user
router.get("/user-cart", authMiddleware, cartEp.getUserCart);

// Add or update ala carte product in cart
router.post("/product", authMiddleware, cartEp.addOrUpdateCartProduct);

// Add or update package in cart
router.post("/package", authMiddleware, cartEp.addOrUpdateCartPackage);

// Remove ala carte product from cart
router.delete("/product/:productId", authMiddleware, cartEp.removeCartProduct);

// Remove package from cart
router.delete("/package/:packageId", authMiddleware, cartEp.removeCartPackage);

// Clear entire cart
router.delete("/clear", authMiddleware, cartEp.clearCart);

module.exports = router;

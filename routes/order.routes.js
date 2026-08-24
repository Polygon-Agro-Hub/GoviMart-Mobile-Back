const express = require('express');
const router = express.Router();
const orderEp = require("../endpoint/order.ep");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/order-history", authMiddleware, orderEp.getRetailOrderHistory);
router.get("/:orderId", authMiddleware, orderEp.getRetailOrderById);
router.get('/packages/:orderId', authMiddleware, orderEp.getOrderPackages);
router.get("/additional-items/:orderId", authMiddleware, orderEp.getOrderAdditionalItems);

module.exports = router;
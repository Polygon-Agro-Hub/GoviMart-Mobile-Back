const express = require('express');
const router = express.Router();
const orderEp = require("../endpoint/order.ep");
const packageReviewEp = require("../endpoint/package-review.ep");
const authMiddleware = require("../middlewares/auth.middleware");

// Package review and customization routes
router.get("/package/packing-limit", authMiddleware, packageReviewEp.getPackingTargetSlots);
router.get("/package/review/:orderId", authMiddleware, packageReviewEp.getOrderPackageReview);
router.post("/package/replace-item", authMiddleware, packageReviewEp.replacePackageItem);
router.post("/package/reset-item", authMiddleware, packageReviewEp.resetPackageItem);
router.post("/package/confirm-review", authMiddleware, packageReviewEp.confirmPackageReview);
router.post("/package/cancel-order", authMiddleware, packageReviewEp.cancelPackageOrder);

router.get("/order-history", authMiddleware, orderEp.getRetailOrderHistory);
router.get("/pickup-centers", authMiddleware, orderEp.getPickupCenters);
router.get("/delivery-cities", authMiddleware, orderEp.getDeliveryCities);
router.get("/coupons", authMiddleware, orderEp.getAvailableCoupons);
router.post("/check-coupon", authMiddleware, orderEp.checkCouponAvalability);
router.post("/create-order", authMiddleware, orderEp.createOrder);

router.get("/invoice/:orderId", authMiddleware, orderEp.getInvoiceByOrderId);
router.get("/:orderId", authMiddleware, orderEp.getRetailOrderById);
router.get('/packages/:orderId', authMiddleware, orderEp.getOrderPackages);
router.get("/additional-items/:orderId", authMiddleware, orderEp.getOrderAdditionalItems);

router.get('/delivered-total/:userId', authMiddleware, orderEp.getDeliveredOrdersTotal);

module.exports = router;
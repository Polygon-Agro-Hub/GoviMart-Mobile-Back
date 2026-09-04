const asyncHandler = require("express-async-handler");
const packageReviewDao = require("../dao/package-review.dao");

/**
 * GET /api/order/package/review/:orderId
 * Fetches the complete package review data for an order or process order.
 */
exports.getOrderPackageReview = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { userId } = req.user;

    if (!orderId) {
        return res.status(400).json({
            status: false,
            message: "Order ID is required",
        });
    }

    const reviewData = await packageReviewDao.getOrderPackageReviewDao(orderId, userId);

    if (!reviewData) {
        return res.status(404).json({
            status: false,
            message: "Order package details not found for review",
        });
    }

    return res.status(200).json({
        status: true,
        message: "Package review details fetched successfully",
        data: reviewData,
    });
});

/**
 * POST /api/order/package/replace-item
 * Replaces an item in an order package and records in replacerequest
 */
exports.replacePackageItem = asyncHandler(async (req, res) => {
    const { userId } = req.user;
    const { orderPackageId, replceId, newProductId, productType, newQty, newPrice } = req.body;

    if (!orderPackageId || !newProductId) {
        return res.status(400).json({
            status: false,
            message: "orderPackageId and newProductId are required",
        });
    }

    try {
        const result = await packageReviewDao.replacePackageItemDao({
            orderPackageId,
            userId,
            replceId,
            newProductId,
            productType,
            newQty: parseFloat(newQty) || 1,
            newPrice: parseFloat(newPrice) || 0,
        });

        return res.status(200).json({
            status: true,
            message: result.message,
            data: result,
        });
    } catch (err) {
        console.error("Replace package item error:", err);
        return res.status(400).json({
            status: false,
            message: err.message || "Failed to replace package item",
        });
    }
});

/**
 * POST /api/order/package/reset-item
 * Resets a replaced item back to its default baseline state
 */
exports.resetPackageItem = asyncHandler(async (req, res) => {
    const { userId } = req.user;
    const { orderPackageId, replceId, originalBaselineId } = req.body;

    if (!orderPackageId) {
        return res.status(400).json({
            status: false,
            message: "orderPackageId is required",
        });
    }

    try {
        const result = await packageReviewDao.resetPackageItemDao({
            orderPackageId,
            userId,
            replceId,
            originalBaselineId,
        });

        return res.status(200).json({
            status: true,
            message: result.message,
        });
    } catch (err) {
        console.error("Reset package item error:", err);
        return res.status(400).json({
            status: false,
            message: err.message || "Failed to reset package item",
        });
    }
});

/**
 * POST /api/order/package/confirm-review
 * Finalizes review, updates order lock status, and handles additional payment if any
 */
exports.confirmPackageReview = asyncHandler(async (req, res) => {
    const { userId } = req.user;
    const { orderId, processOrderId, lockNow = true, additionalAmount = 0 } = req.body;

    if (!orderId && !processOrderId) {
        return res.status(400).json({
            status: false,
            message: "orderId or processOrderId is required",
        });
    }

    try {
        const result = await packageReviewDao.confirmPackageReviewDao({
            orderId,
            processOrderId,
            userId,
            lockNow,
            additionalAmount,
        });

        return res.status(200).json({
            status: true,
            message: result.message,
        });
    } catch (err) {
        console.error("Confirm package review error:", err);
        return res.status(500).json({
            status: false,
            message: err.message || "Failed to finalize package review",
        });
    }
});

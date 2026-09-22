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
    const {
        orderId,
        processOrderId,
        lockNow = false,
        additionalAmount = 0,
        newScheduleDate = null,
        paymentMethod = null,
        newTotal = null,
        creditToAdd = 0,
        replacements = [],
        additionalItems = [],
        packages = [],
    } = req.body;

    console.log("[confirmPackageReview Endpoint] Received request by userId:", userId, "body:", JSON.stringify(req.body, null, 2));

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
            newScheduleDate,
            paymentMethod,
            newTotal,
            creditToAdd,
            replacements,
            additionalItems,
            packages,
        });

        console.log("[confirmPackageReview Endpoint] Success response:", result);

        return res.status(200).json({
            status: true,
            message: result.message,
        });
    } catch (err) {
        console.error("[confirmPackageReview Endpoint] Error finalize package review:", err);
        return res.status(500).json({
            status: false,
            message: err.message || "Failed to finalize package review",
        });
    }
});

/**
 * GET /api/order/package/packing-limit
 * Returns current packing target limit and remaining available order slots.
 */
exports.getPackingTargetSlots = asyncHandler(async (req, res) => {
    const { date, processOrderId } = req.query;

    const data = await packageReviewDao.getPackingSlotAvailabilityDao(date, processOrderId);

    return res.status(200).json({
        status: true,
        message: "Packing slot availability fetched successfully",
        data,
    });
});

/**
 * POST /api/order/package/cancel-order
 * Cancel order and refund paid amount as credit balance
 */
exports.cancelPackageOrder = asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { orderId, processOrderId } = req.body;

    if (!userId) {
        return res.status(401).json({
            status: false,
            message: "Unauthorized",
        });
    }

    if (!orderId && !processOrderId) {
        return res.status(400).json({
            status: false,
            message: "orderId or processOrderId is required",
        });
    }

    try {
        const result = await packageReviewDao.cancelOrderDao({
            orderId,
            processOrderId,
            userId,
        });

        return res.status(200).json({
            status: true,
            message: result.message,
            data: result,
        });
    } catch (error) {
        console.error("[cancelPackageOrder] Error:", error);
        return res.status(400).json({
            status: false,
            message: error.message || "Failed to cancel order",
        });
    }
});



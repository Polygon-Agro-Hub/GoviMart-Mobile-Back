const asyncHandler = require("express-async-handler");
const RetailOrderDao = require("../dao/order.dao");
const cartDao = require("../dao/cart.dao");
const customerDao = require("../dao/customer.dao");

const {
    couponValidationSchema,
    createOrderSchema,
} = require("../validations/order.validations");
exports.getRetailOrderHistory = async (req, res) => {
    try {
        const { userId } = req.user;
        console.log("Fetching order history for userId:", userId); // Debug log

        const orderHistory = await RetailOrderDao.getRetailOrderHistoryDao(userId);
        console.log("Order history fetched:", orderHistory); // Debug log


        res.status(200).json({
            status: true,
            message: "Order history fetched successfully.",
            orderHistory,
        });
    } catch (err) {
        console.error("Error fetching order history:", err);
        res.status(500).json({
            status: false,
            message: "Failed to fetch order history.",
        });
    }
};

exports.getRetailOrderById = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { userId } = req.user;
        console.log("Received orderId:", orderId, "for userId:", userId); // Debug log

        const order = await RetailOrderDao.getRetailOrderByIdDao(orderId, userId);

        res.status(200).json({
            status: true,
            message: "Order fetched successfully.",
            order,
        });
    } catch (err) {
        console.error("Error fetching order for orderId:", req.params.orderId, err);
        res.status(500).json({
            status: false,
            message: "Failed to fetch order.",
        });
    }
};

exports.getOrderPackages = async (req, res) => {
    try {
        const { orderId } = req.params;

        const packages = await RetailOrderDao.getOrderPackageDetailsDao(orderId);

        res.json({
            status: true,
            message: "Packages fetched successfully",
            data: packages
        });
    } catch (error) {
        console.error('Error in getPackagesByOrderId:', error);
        res.status(500).json({
            status: false,
            message: error?.toString() || 'Unknown server error'
        });
    }
};

exports.getOrderAdditionalItems = async (req, res) => {
    try {
        const { orderId } = req.params;

        const additionalItems = await RetailOrderDao.getOrderAdditionalItemsDao(orderId);

        res.json({
            status: true,
            message: "Additional items fetched successfully",
            data: additionalItems
        });

        console.log("getOrderAdditionalItems executed for orderId:", orderId);
        console.log("Additional items:", additionalItems);
    } catch (error) {
        console.error('Error in getOrderAdditionalItems:', error);
        res.status(500).json({
            status: false,
            message: error?.toString() || 'Unknown server error'
        });
    }
};

exports.checkCouponAvalability = async (req, res) => {
    try {
        const { userId } = req.user;
        const { coupon, deliveryMethod } = await couponValidationSchema.validateAsync(req.body);

        console.log('coupon detailsss', req.body);

        const currentDate = new Date();
        let discount = 0;

        // Helper function to format numbers with thousand separators
        const formatPrice = (price) => {
            return parseFloat(price).toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        };

        const couponData = await RetailOrderDao.getCouponDetailsDao(coupon);
        console.log("Coupon data:", couponData);
        const startDate = new Date(couponData.startDate);
        const endDate = new Date(couponData.endDate);

        if (!couponData || couponData === null) {
            return res.status(404).json({
                status: false,
                message: "Coupon not found.",
                discount
            });
        }

        if (couponData.status === 'Disabled') {
            return res.status(404).json({
                status: false,
                message: "Coupon doesn't available now.",
                discount
            });
        }

        // FIXED: Check both possible spellings for Free Delivery coupon
        const isFreeDeliveryCoupon = couponData.type === 'Free Delivery' || couponData.type === 'Free Delivary';

        if (isFreeDeliveryCoupon && deliveryMethod === 'pickup') {
            return res.status(400).json({
                status: false,
                message: "Delivery-free coupons cannot be applied to In-store Pickup orders.",
                discount
            });
        }

        console.log(currentDate, startDate);

        if (currentDate < startDate) {
            return res.status(400).json({
                status: false,
                message: `This coupon will be valid from ${startDate.toLocaleDateString()}`,
                discount
            });
        }

        if (currentDate > endDate) {
            return res.status(400).json({
                status: false,
                message: `This coupon has expired on ${endDate.toLocaleDateString()}`,
                discount
            });
        }

        let cartObj = null;
        if (req.body.cartTotal && parseFloat(req.body.cartTotal) > 0) {
            cartObj = { price: parseFloat(req.body.cartTotal) };
        } else {
            cartObj = await RetailOrderDao.getUserCartTotalDao(userId, req.body.cartId);
        }

        if (couponData.type === 'Percentage') {
            if (couponData.checkLimit === 1) {
                if (cartObj.price >= couponData.priceLimit) {
                    discount = (cartObj.price * couponData.percentage / 100);
                } else {
                    return res.status(400).json({
                        status: false,
                        message: `This coupon is valid for minimum purchase of Rs. ${formatPrice(couponData.priceLimit)}`,
                        discount: 0
                    });
                }
            } else {
                discount = (cartObj.price * couponData.percentage / 100);
            }
        } else if (couponData.type === 'Fixed Amount') {
            if (couponData.checkLimit === 1) {
                if (cartObj.price >= couponData.priceLimit) {
                    discount = parseFloat(couponData.fixDiscount) || 0;
                } else {
                    return res.status(400).json({
                        status: false,
                        message: `This coupon is valid for minimum purchase of Rs. ${formatPrice(couponData.priceLimit)}`,
                        discount: 0
                    });
                }
            } else {
                discount = parseFloat(couponData.fixDiscount) || 0;
            }
        } else if (isFreeDeliveryCoupon) {
            if (couponData.checkLimit === 1) {
                if (cartObj.price >= couponData.priceLimit) {
                    discount = 0;
                } else {
                    return res.status(400).json({
                        status: false,
                        message: `This coupon is valid for minimum purchase of Rs. ${formatPrice(couponData.priceLimit)}`,
                        discount: 0
                    });
                }
            } else {
                discount = 0;
            }
        } else {
            return res.status(400).json({
                status: false,
                message: "Invalid coupon type.",
                discount: 0
            });
        }

        res.status(200).json({
            status: true,
            message: "Coupon is valid.",
            discount: parseFloat(discount) || 0,
            discountFormatted: formatPrice(discount),
            type: couponData.type,
            code: couponData.code,
        });
    } catch (err) {
        console.error("Error validating coupon:", err);
        res.status(500).json({
            status: false,
            message: err?.message || "Invalid coupon code",
        });
    }
};

exports.getAvailableCoupons = async (req, res) => {
    try {
        const coupons = await RetailOrderDao.getAvailableCouponsDao();
        res.status(200).json({
            status: true,
            message: "Available coupons fetched successfully.",
            data: coupons,
        });
    } catch (err) {
        console.error("Error fetching available coupons:", err);
        res.status(500).json({
            status: false,
            message: "Failed to fetch available coupons.",
        });
    }
};

// ─── ORDER CREATION ───────────────────────────────────────────────────────────

/**
 * POST /api/order/create-order
 * Creates a new order with a full DB transaction.
 */
exports.createOrder = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // ── 1. Validate request payload ──────────────────────────────────────────
    const { error, value } = createOrderSchema.validate(req.body, { abortEarly: false });
    if (error) {
        console.error("[createOrder] Validation error:", error.details.map((d) => d.message));
        return res.status(400).json({
            status: false,
            message: "Validation failed: " + error.details.map((d) => d.message).join("; "),
            details: error.details.map((d) => d.message),
        });
    }

    const {
        cartId, paymentMethod, grandTotal, discountAmount, deliveryCharge,
        creditPaid, moneyPaid, isFinalizeImdt, checkoutDetails,
    } = value;

    const {
        deliveryMethod, title, fullName, phoneCode1, phone1, phoneCode2, phone2,
        buildingType, cityName, companycenterId, houseNo, street,
        buildingNo, buildingName, flatNumber, floorNumber, saveAs,
        centerId, scheduleType, deliveryDate, timeSlot,
        geoLatitude, geoLongitude, isCoupon, couponValue, couponType,
    } = checkoutDetails;

    // Resolve active cartId if missing/0
    let effectiveCartId = cartId;
    if (!effectiveCartId) {
        const userCart = await cartDao.getCartByUserIdDao(userId);
        effectiveCartId = userCart?.id;
    }
    if (!effectiveCartId) {
        return res.status(400).json({
            status: false,
            message: "Active cart not found for user",
        });
    }

    // Resolve user details fallback if empty (e.g. pickup flow)
    let resolvedTitle = title;
    let resolvedFullName = (fullName && fullName !== "Customer") ? fullName : null;
    let resolvedPhoneCode1 = phoneCode1 || "+94";
    let resolvedPhone1 = phone1;

    try {
        const rawProfile = await customerDao.getAccountDetailsDao(userId);
        const userProfile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
        if (userProfile) {
            resolvedTitle = resolvedTitle || userProfile.title || "Mr";
            const profileFullName = `${userProfile.firstName || ""} ${userProfile.lastName || ""}`.trim() || userProfile.firstName || "";
            resolvedFullName = resolvedFullName || profileFullName;
            resolvedPhoneCode1 = resolvedPhoneCode1 || userProfile.phoneCode || "+94";
            resolvedPhone1 = resolvedPhone1 || userProfile.phoneNumber || req.user.phoneNumber || "";
        }
    } catch (e) {
        console.warn("[createOrder] Profile lookup fallback failed:", e.message);
    }
    resolvedTitle = resolvedTitle || "Mr";
    resolvedFullName = resolvedFullName || "Customer";
    resolvedPhone1 = resolvedPhone1 || req.user.phoneNumber || "0000000000";

    // ── 2. Verify cart ownership ──────────────────────────────────────────────
    const cartBelongsToUser = await RetailOrderDao.validateCartDao(effectiveCartId, userId);
    if (!cartBelongsToUser) {
        return res.status(403).json({
            status: false,
            message: "Cart does not belong to the current user",
        });
    }

    // ── 3. Check item availability ────────────────────────────────────────────
    const availability = await RetailOrderDao.checkCartItemsAvailabilityDao(effectiveCartId);
    if (availability.hasUnavailableItems) {
        return res.status(409).json({
            status: false,
            code: "ITEMS_UNAVAILABLE",
            message: "Some cart items are no longer available. Please review your cart.",
            disabledCount: availability.disabledCount,
            invalidCount: availability.invalidCount,
        });
    }

    // ── 4. Fetch cart items ───────────────────────────────────────────────────
    const cartItems = await RetailOrderDao.getCartItemsForOrderDao(effectiveCartId);
    if (!cartItems.length) {
        return res.status(400).json({
            status: false,
            message: "Cart is empty",
        });
    }

    const hasPackages = cartItems.some((i) => i.itemType === "package");
    const isHomeDelivery = deliveryMethod === "home";

    // ── 5. Begin transaction ──────────────────────────────────────────────────
    const db = require("../startup/database");

    db.collectionofficer.getConnection((connErr, connection) => {
        if (connErr) {
            return res.status(500).json({
                status: false,
                message: "Database connection error",
            });
        }

        connection.beginTransaction(async (txErr) => {
            if (txErr) {
                connection.release();
                return res.status(500).json({
                    status: false,
                    message: "Transaction error",
                });
            }

            try {
                // ── 5a. Create order ──────────────────────────────────────────
                const orderId = await RetailOrderDao.createOrderWithTransactionDao(connection, {
                    userId,
                    delivaryMethod: deliveryMethod,
                    centerId: centerId || null,
                    buildingType: buildingType || null,
                    title: resolvedTitle,
                    fullName: resolvedFullName,
                    phonecode1: resolvedPhoneCode1,
                    phone1: resolvedPhone1,
                    phonecode2: phoneCode2 || null,
                    phone2: phone2 || null,
                    isCoupon: isCoupon || false,
                    couponValue: couponValue || 0,
                    couponType: couponType || null,
                    total: grandTotal,
                    fullTotal: grandTotal,
                    discount: discountAmount || 0,
                    deliveryCharge: isHomeDelivery ? (deliveryCharge || 0) : 0,
                    sheduleType: scheduleType || "One Time Order",
                    sheduleDate: deliveryDate || null,
                    sheduleTime: timeSlot || null,
                    isPackage: hasPackages ? 1 : 0,
                    isFinalizeImdt: isFinalizeImdt || 0,
                    latitude: geoLatitude || null,
                    longitude: geoLongitude || null,
                    companycenterId: companycenterId || null,
                });

                // ── 5b. Insert delivery address (home only) ───────────────────
                if (isHomeDelivery && buildingType) {
                    const addrData = {
                        houseNo: houseNo || null,
                        streetName: street || null,
                        city: cityName || null,
                        saveAs: saveAs || null,
                        buildingNo: buildingNo || null,
                        buildingName: buildingName || null,
                        unitNo: flatNumber || null,
                        floorNo: floorNumber || null,
                    };
                    await RetailOrderDao.createOrderAddressWithTransactionDao(
                        connection, orderId, addrData, buildingType
                    );
                }

                // ── 5c. Create process order (generates invoice number) ───────
                const { insertId: processOrderId, invNo } =
                    await RetailOrderDao.createProcessOrderWithTransactionDao(connection, {
                        orderId,
                        paymentMethod,
                        isPaid: 0,
                        amount: grandTotal,
                        creditPaid: creditPaid || 0,
                        moneyPaid: moneyPaid || 0,
                        status: "Ordered",
                        sheduleDate: deliveryDate || null,
                    });

                // ── 5d. Save all order items ──────────────────────────────────
                await RetailOrderDao.saveOrderItemsWithTransactionDao(
                    connection, orderId, processOrderId, cartItems
                );

                // ── 5e. Commit ────────────────────────────────────────────────
                connection.commit((commitErr) => {
                    if (commitErr) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ status: false, message: "Commit failed" });
                        });
                    }

                    connection.release();

                    // ── 5f. Clear cart (best-effort, after commit) ────────────
                    RetailOrderDao.clearCartAfterOrderDao(effectiveCartId).catch((clearErr) => {
                        console.error("[createOrder] Cart clear failed (non-fatal):", clearErr);
                    });

                    return res.status(201).json({
                        status: true,
                        message: "Order created successfully",
                        data: {
                            orderId,
                            processOrderId,
                            invoiceNumber: invNo,
                            total: grandTotal,
                        },
                    });
                });
            } catch (err) {
                connection.rollback(() => {
                    connection.release();
                });

                if (err.code === "ITEMS_UNAVAILABLE") {
                    return res.status(409).json({
                        status: false,
                        code: "ITEMS_UNAVAILABLE",
                        message: err.message,
                    });
                }

                console.error("[createOrder] Transaction error:", err);
                return res.status(500).json({
                    status: false,
                    message: "Order creation failed. Please try again.",
                });
            }
        });
    });
});

// ─── LOOKUP ENDPOINTS ─────────────────────────────────────────────────────────

/**
 * GET /api/order/pickup-centers
 * Returns all available pickup centres from the DB.
 */
exports.getPickupCenters = asyncHandler(async (req, res) => {
    const centers = await RetailOrderDao.getPickupCentersDao();
    return res.status(200).json({
        status: true,
        message: "Pickup centres fetched successfully",
        data: centers,
    });
});

/**
 * GET /api/order/delivery-cities
 * Returns all delivery cities with their charges and companycenterId mapping.
 */
exports.getDeliveryCities = asyncHandler(async (req, res) => {
    const cities = await RetailOrderDao.getDeliveryCitiesDao();
    return res.status(200).json({
        status: true,
        message: "Delivery cities fetched successfully",
        data: cities,
    });
});
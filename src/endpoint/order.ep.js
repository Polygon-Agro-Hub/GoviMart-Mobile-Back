const asyncHandler = require("express-async-handler");
const RetailOrderDao = require("../dao/order.dao");
const cartDao = require("../dao/cart.dao");
const customerDao = require("../dao/customer.dao");

const {
    couponValidationSchema,
    createOrderSchema,
} = require("../validations/order.validations");

// In-flight concurrency lock to prevent duplicate order creation (Risk 3.A)
const activeOrderLocks = new Set();
exports.getRetailOrderHistory = async (req, res) => {
    try {
        const { userId } = req.user;

        const orderHistory = await RetailOrderDao.getRetailOrderHistoryDao(userId);

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
        recurringDays, selectedDays, validityWeeks, validityPeriod, calculatedOrders,
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

    // In-flight concurrency lock to prevent duplicate order creation (Risk 3.A)
    const lockKey = `${userId}_${effectiveCartId}`;
    if (activeOrderLocks.has(lockKey)) {
        return res.status(429).json({
            status: false,
            message: "An order creation request is already in progress for this cart. Please wait.",
        });
    }
    activeOrderLocks.add(lockKey);

    const safeRespond = (statusCode, body) => {
        activeOrderLocks.delete(lockKey);
        return res.status(statusCode).json(body);
    };

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
        return safeRespond(403, {
            status: false,
            message: "Cart does not belong to the current user",
        });
    }

    // ── 3. Check item availability ────────────────────────────────────────────
    const availability = await RetailOrderDao.checkCartItemsAvailabilityDao(effectiveCartId);
    if (availability.hasUnavailableItems) {
        return safeRespond(409, {
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
        return safeRespond(400, {
            status: false,
            message: "Cart is empty",
        });
    }

    const hasPackages = cartItems.some((i) => i.itemType === "package");
    const isHomeDelivery = deliveryMethod === "home";

    // Recalculate item prices server-side (Risk 1.A)
    const [cartProducts, cartPackages] = await Promise.all([
        cartDao.getCartProductsDao(effectiveCartId),
        cartDao.getCartPackagesDao(effectiveCartId),
    ]);

    let calculatedNormalItemsTotal = 0;
    let calculatedDiscountedItemsTotal = 0;
    for (const p of cartProducts) {
        const pQty = parseFloat(p.quantity) || 0;
        const normPrice = Number(p.normalPrice || 0);
        const discPrice = (p.discountedPrice != null && p.discountedPrice !== "" && !isNaN(Number(p.discountedPrice)) && Number(p.discountedPrice) > 0 && Number(p.discountedPrice) < normPrice)
            ? Number(p.discountedPrice)
            : normPrice;
        const pUnit = (p.unit || p.unitType || "g").toLowerCase();
        const weightMultiplier = pUnit === "kg" ? pQty : pQty / 1000;
        calculatedNormalItemsTotal += normPrice * weightMultiplier;
        calculatedDiscountedItemsTotal += discPrice * weightMultiplier;
    }
    for (const pkg of cartPackages) {
        const pkgQty = parseFloat(pkg.quantity) || 0;
        const pkgPrice = parseFloat(pkg.price) || 0;
        calculatedNormalItemsTotal += pkgPrice * pkgQty;
        calculatedDiscountedItemsTotal += pkgPrice * pkgQty;
    }

    const isFreeDeliveryCoupon = Boolean(
        isCoupon && couponType && (
            String(couponType).toLowerCase().includes("free") ||
            String(couponType).toLowerCase().includes("delivery")
        )
    );
    const finalCouponValue = isFreeDeliveryCoupon ? 0 : (parseFloat(couponValue) || 0);
    const finalDeliveryCharge = isFreeDeliveryCoupon ? 0 : (isHomeDelivery ? (parseFloat(deliveryCharge) || 0) : 0);

    const clientProvidedDiscount = parseFloat(discountAmount) || 0;
    const clientGrandTotal = parseFloat(grandTotal) || 0;

    const finalProductDiscount = Math.max(0, parseFloat((calculatedNormalItemsTotal - calculatedDiscountedItemsTotal).toFixed(2)));
    const effectiveProductDiscount = clientProvidedDiscount > 0 ? clientProvidedDiscount : finalProductDiscount;
    const finalDiscount = Math.min(effectiveProductDiscount + finalCouponValue, calculatedNormalItemsTotal);

    const expectedDiscountedGrandTotal = Math.max(0, parseFloat((calculatedDiscountedItemsTotal + finalDeliveryCharge - finalCouponValue).toFixed(2)));
    const expectedNormalMinusDiscountGrandTotal = Math.max(0, parseFloat((calculatedNormalItemsTotal + finalDeliveryCharge - finalDiscount).toFixed(2)));
    const expectedNormalGrandTotal = Math.max(0, parseFloat((calculatedNormalItemsTotal + finalDeliveryCharge - finalCouponValue).toFixed(2)));

    let calculatedGrandTotal = clientGrandTotal;
    let isMatch = false;

    if (Math.abs(clientGrandTotal - expectedDiscountedGrandTotal) <= 1.0) {
        isMatch = true;
        calculatedGrandTotal = expectedDiscountedGrandTotal;
    } else if (Math.abs(clientGrandTotal - expectedNormalMinusDiscountGrandTotal) <= 1.0) {
        isMatch = true;
        calculatedGrandTotal = expectedNormalMinusDiscountGrandTotal;
    } else if (Math.abs(clientGrandTotal - expectedNormalGrandTotal) <= 1.0) {
        isMatch = true;
        calculatedGrandTotal = expectedNormalGrandTotal;
    }

    // Verify grandTotal from client against server-calculated grandTotal
    if (!isMatch) {
        console.warn(`[createOrder] Price manipulation detected for user ${userId}. Client: ${grandTotal}, Expected Discounted: ${expectedDiscountedGrandTotal}, Expected Normal-Discount: ${expectedNormalMinusDiscountGrandTotal}`);
        return safeRespond(400, {
            status: false,
            message: `Order total mismatch. Expected Rs. ${expectedDiscountedGrandTotal.toFixed(2)}, but received Rs. ${Number(grandTotal).toFixed(2)}.`,
        });
    }

    // Verify user credit balance if paying with credit
    const requestedCredit = parseFloat(creditPaid) || 0;
    if (requestedCredit > 0) {
        const userProfile = await customerDao.getCustomerProfileDao(userId);
        const availableCredit = parseFloat(userProfile?.[0]?.creditBalance || 0);
        if (requestedCredit > availableCredit + 0.01) {
            return safeRespond(400, {
                status: false,
                message: `Insufficient credit balance. Available: Rs. ${availableCredit.toFixed(2)}, requested: Rs. ${requestedCredit.toFixed(2)}.`,
            });
        }
    }

    // Normalize schedule fields
    let normScheduleType = "One Time";
    if (scheduleType === "Once a Week" || scheduleType === "Twice a Week") {
        normScheduleType = scheduleType;
    } else if (scheduleType === "One Time" || scheduleType === "One Time Order") {
        normScheduleType = "One Time";
    }

    const effRecurringDays = selectedDays || recurringDays || [];
    const effValidityPeriod = validityPeriod || validityWeeks || 4;

    const parseScheduleDate = (rawDate) => {
        if (!rawDate) return null;
        if (rawDate instanceof Date) return rawDate;
        const parsed = new Date(rawDate);
        if (!isNaN(parsed.getTime())) return parsed;
        return null;
    };

    // ── 5. Begin transaction ──────────────────────────────────────────────────
    const db = require("../startup/database");

    db.collectionofficer.getConnection((connErr, connection) => {
        if (connErr) {
            return safeRespond(500, {
                status: false,
                message: "Database connection error",
            });
        }

        connection.beginTransaction(async (txErr) => {
            if (txErr) {
                connection.release();
                return safeRespond(500, {
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
                    couponValue: finalCouponValue,
                    couponType: couponType || null,
                    total: calculatedGrandTotal,
                    fullTotal: calculatedGrandTotal,
                    discount: finalDiscount,
                    deliveryCharge: finalDeliveryCharge,
                    sheduleType: normScheduleType,
                    validityPeriod: effValidityPeriod,
                    selectedDays: effRecurringDays,
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

                // ── 5c. Create process order(s) ───────────────────────────────
                let primaryProcessOrderId = null;
                let primaryInvNo = null;
                const createdProcessOrders = [];

                if (normScheduleType === "Twice a Week") {
                    // Special condition: 2 individual rows in processorders for the 2 days
                    let date1 = null;
                    let date2 = null;

                    if (Array.isArray(calculatedOrders) && calculatedOrders.length >= 2) {
                        date1 = parseScheduleDate(calculatedOrders[0]?.date || calculatedOrders[0]?.dateStr);
                        date2 = parseScheduleDate(calculatedOrders[1]?.date || calculatedOrders[1]?.dateStr);
                    }

                    if (!date1 || !date2) {
                        const DAY_MAP = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 0 };
                        const minDate = new Date();
                        minDate.setDate(minDate.getDate() + 3);
                        minDate.setHours(0, 0, 0, 0);

                        const daysArr = Array.isArray(effRecurringDays) && effRecurringDays.length > 0
                            ? effRecurringDays
                            : ["Tu", "Sa"];

                        const computedDates = daysArr.map((d) => {
                            const targetDay = DAY_MAP[d] !== undefined ? DAY_MAP[d] : 2;
                            const dt = new Date(minDate);
                            while (dt.getDay() !== targetDay) {
                                dt.setDate(dt.getDate() + 1);
                            }
                            return dt;
                        }).sort((a, b) => a.getTime() - b.getTime());

                        date1 = date1 || computedDates[0];
                        date2 = date2 || computedDates[1] || computedDates[0];
                    }

                    // Insert 1st process order
                    const proc1 = await RetailOrderDao.createProcessOrderWithTransactionDao(connection, {
                        orderId,
                        paymentMethod,
                        isPaid: 0,
                        amount: calculatedGrandTotal,
                        creditPaid: requestedCredit,
                        moneyPaid: Math.max(0, calculatedGrandTotal - requestedCredit),
                        status: "Ordered",
                        sheduleDate: date1,
                    });
                    createdProcessOrders.push(proc1);

                    // Insert 2nd process order
                    const proc2 = await RetailOrderDao.createProcessOrderWithTransactionDao(connection, {
                        orderId,
                        paymentMethod,
                        isPaid: 0,
                        amount: calculatedGrandTotal,
                        creditPaid: requestedCredit,
                        moneyPaid: Math.max(0, calculatedGrandTotal - requestedCredit),
                        status: "Ordered",
                        sheduleDate: date2,
                    });
                    createdProcessOrders.push(proc2);

                    primaryProcessOrderId = proc1.insertId;
                    primaryInvNo = proc1.invNo;

                    // ── 5d. Save order items for both process orders ───────────
                    const additionalItems = cartItems.filter((i) => i.itemType === "additional");
                    for (const item of additionalItems) {
                        await RetailOrderDao.saveOrderAdditionalItemWithTransactionDao(connection, orderId, item, proc1.insertId);
                    }

                    // Packages link to each processOrderId
                    const packageItems = cartItems.filter((i) => i.itemType === "package");
                    for (const pkg of packageItems) {
                        await RetailOrderDao.saveOrderPackageWithTransactionDao(connection, proc1.insertId, pkg);
                        await RetailOrderDao.saveOrderPackageWithTransactionDao(connection, proc2.insertId, pkg);
                    }
                } else {
                    // One Time or Once a Week: 1 process order row
                    let targetDate = parseScheduleDate(deliveryDate);
                    if (!targetDate && Array.isArray(calculatedOrders) && calculatedOrders.length > 0) {
                        targetDate = parseScheduleDate(calculatedOrders[0]?.date || calculatedOrders[0]?.dateStr);
                    }

                    const proc = await RetailOrderDao.createProcessOrderWithTransactionDao(connection, {
                        orderId,
                        paymentMethod,
                        isPaid: 0,
                        amount: calculatedGrandTotal,
                        creditPaid: requestedCredit,
                        moneyPaid: Math.max(0, calculatedGrandTotal - requestedCredit),
                        status: "Ordered",
                        sheduleDate: targetDate,
                    });
                    createdProcessOrders.push(proc);
                    primaryProcessOrderId = proc.insertId;
                    primaryInvNo = proc.invNo;

                    // ── 5d. Save all order items ──────────────────────────────
                    await RetailOrderDao.saveOrderItemsWithTransactionDao(
                        connection, orderId, primaryProcessOrderId, cartItems
                    );
                }

                // ── 5e. Deduct credit balance from marketplaceusers if used ────
                if (requestedCredit > 0) {
                    await RetailOrderDao.deductUserCreditBalanceWithTransactionDao(
                        connection,
                        userId,
                        requestedCredit
                    );
                    console.log(`[createOrder] Deducted Rs. ${requestedCredit} credit from marketplaceusers for userId: ${userId}`);
                }

                // ── 5f. Commit ────────────────────────────────────────────────
                connection.commit((commitErr) => {
                    if (commitErr) {
                        return connection.rollback(() => {
                            connection.release();
                            safeRespond(500, { status: false, message: "Commit failed" });
                        });
                    }

                    connection.release();

                    // ── Clear cart (best-effort, after commit) ────────────
                    RetailOrderDao.clearCartAfterOrderDao(effectiveCartId).catch((clearErr) => {
                        console.error("[createOrder] Cart clear failed (non-fatal):", clearErr);
                    });

                    // ── Refresh marketplaceusers.creditLimit (best-effort, after commit) ──
                    RetailOrderDao.recalculateAndPersistCreditLimitDao(userId).catch((limitErr) => {
                        console.error("[createOrder] creditLimit recalculation failed (non-fatal):", limitErr);
                    });

                    return safeRespond(201, {
                        status: true,
                        message: "Order created successfully",
                        data: {
                            orderId,
                            processOrderId: primaryProcessOrderId,
                            processOrderIds: createdProcessOrders.map((p) => p.insertId),
                            invoiceNumber: primaryInvNo,
                            invoiceNumbers: createdProcessOrders.map((p) => p.invNo),
                            total: calculatedGrandTotal,
                        },
                    });
                });
            } catch (err) {
                connection.rollback(() => {
                    connection.release();
                });

                if (err.code === "ITEMS_UNAVAILABLE") {
                    return safeRespond(409, {
                        status: false,
                        code: "ITEMS_UNAVAILABLE",
                        message: err.message,
                    });
                }

                console.error("[createOrder] Transaction error:", err);
                return safeRespond(500, {
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

/**
 * GET /api/orders/invoice/:orderId
 * Fetches invoice details matching web format.
 */
exports.getInvoiceByOrderId = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { userId } = req.user;

    const result = await RetailOrderDao.getInvoiceByOrderIdDao(orderId, userId);

    if (!result || !result.invoice) {
        return res.status(404).json({
            status: false,
            message: "Invoice not found for this order.",
        });
    }

    return res.status(200).json({
        status: true,
        message: "Invoice fetched successfully",
        invoice: result.invoice,
    });
});

exports.getDeliveredOrdersTotal = async (req, res) => {
    try {
        const userId = req.params.userId;
        if (!userId || isNaN(parseInt(userId))) {
            return res.status(400).json({ success: false, message: "Invalid user ID" });
        }
        // Authorization check: ensure users can only access their own order totals
        if (parseInt(userId) !== parseInt(req.user.id)) {
            return res.status(403).json({ success: false, message: "Forbidden: Access denied to user data" });
        }
        const result = await RetailOrderDao.getDeliveredOrdersTotal(userId);
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error in getDeliveredOrdersTotal:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch delivered orders total",
            error: error.message,
        });
    }
};

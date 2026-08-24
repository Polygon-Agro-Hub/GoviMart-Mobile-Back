const RetailOrderDao = require("../dao/order.dao");

const {
    couponValidationSchema,
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

        const package = await athDao.getCartPackageInfoDao(userId);
        const items = await athDao.getCartAdditionalInfoDao(userId);
        const cartObj = {
            price: parseFloat(package.price) + parseFloat(items.price),
            count: parseFloat(package.count) + parseFloat(items.count)
        };
        console.log(cartObj);

        if (couponData.type === 'Percentage') {
            if (couponData.checkLimit === 1) {
                if (cartObj.price >= couponData.priceLimit) {
                    discount = (cartObj.price * couponData.percentage / 100);
                } else {
                    return res.status(400).json({
                        status: false,
                        message: `This coupon is valid for minimum purchase of Rs.${formatPrice(couponData.priceLimit)}`,
                        discount
                    });
                }
            } else {
                discount = (cartObj.price * couponData.percentage / 100);
            }
        } else if (couponData.type === 'Fixed Amount') {
            if (couponData.checkLimit === 1) {
                if (cartObj.price >= couponData.priceLimit) {
                    discount = couponData.fixDiscount;
                } else {
                    return res.status(400).json({
                        status: false,
                        message: `This coupon is valid for minimum purchase of Rs.${formatPrice(couponData.priceLimit)}`,
                        discount
                    });
                }
            } else {
                discount = couponData.fixDiscount;
            }
        } else if (isFreeDeliveryCoupon) {
            // FIXED: Handle both spellings
            if (couponData.checkLimit === 1) {
                if (cartObj.price >= couponData.priceLimit) {
                    discount = 0;
                    // Discount is 0 because delivery charge will be removed on frontend
                } else {
                    return res.status(400).json({
                        status: false,
                        message: `This coupon is valid for minimum purchase of Rs.${formatPrice(couponData.priceLimit)}`,
                        discount
                    });
                }
            } else {
                discount = 0;
                // Discount is 0 because delivery charge will be removed on frontend
            }
        } else {
            return res.status(400).json({
                status: false,
                message: "Invalid coupon type.",
                discount
            });
        }

        res.status(200).json({
            status: true,
            message: "Coupon is valid.",
            discount: formatPrice(discount),
            type: couponData.type  // Return the original type from database
        });
    } catch (err) {
        console.error("Error fetching invoice for orderId:", err);
        res.status(500).json({
            status: false,
            message: "Invalid coupon code",
        });
    }
};
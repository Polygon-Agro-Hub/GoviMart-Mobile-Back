const Joi = require('joi');

exports.couponValidationSchema = Joi.object({
    coupon: Joi.string().required(),
    deliveryMethod: Joi.string().allow('home', 'pickup', 'Delivery', 'Pickup').required(),
    cartTotal: Joi.number().min(0).optional(),
    cartId: Joi.number().integer().positive().optional(),
});

// ─── Order Creation Validation ────────────────────────────────────────────────
exports.createOrderSchema = Joi.object({
    cartId: Joi.number().integer().allow(0, null).optional(),
    paymentMethod: Joi.string().valid('cash', 'card', 'Cash', 'Card', 'payhere', 'PayHere', 'credit', 'Credit').required(),
    grandTotal: Joi.number().positive().required(),
    discountAmount: Joi.number().min(0).default(0),
    deliveryCharge: Joi.number().min(0).default(0),
    creditPaid: Joi.number().min(0).default(0),
    moneyPaid: Joi.number().min(0).default(0),
    isFinalizeImdt: Joi.number().valid(0, 1).default(0),
    checkoutDetails: Joi.object({
        deliveryMethod: Joi.string().valid('home', 'pickup').required(),
        title: Joi.string().allow('', null).optional(),
        fullName: Joi.string().allow('', null).optional(),
        phoneCode1: Joi.string().allow('', null).optional(),
        phone1: Joi.string().allow('', null).optional(),
        phoneCode2: Joi.string().allow('', null).optional(),
        phone2: Joi.string().allow('', null).optional(),
        // Home delivery fields
        buildingType: Joi.string().allow('', null).optional(),
        cityName: Joi.string().allow('', null).optional(),
        companycenterId: Joi.number().allow(null).optional(),
        houseNo: Joi.string().allow('', null).optional(),
        street: Joi.string().allow('', null).optional(),
        buildingNo: Joi.string().allow('', null).optional(),
        buildingName: Joi.string().allow('', null).optional(),
        flatNumber: Joi.string().allow('', null).optional(),
        floorNumber: Joi.string().allow('', null).optional(),
        saveAs: Joi.string().allow('', null).optional(),
        // Pickup fields
        centerId: Joi.number().allow(null).optional(),
        centreName: Joi.string().allow('', null).optional(),
        // Schedule fields
        scheduleType: Joi.string().allow('', null).optional(),
        deliveryDate: Joi.string().allow('', null).optional(),
        timeSlot: Joi.string().allow('', null).optional(),
        recurringDays: Joi.array().items(Joi.string()).optional(),
        selectedDays: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).optional(),
        validityWeeks: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
        validityPeriod: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
        calculatedOrders: Joi.array().items(Joi.object()).optional(),
        // Geo
        geoLatitude: Joi.number().allow(null).optional(),
        geoLongitude: Joi.number().allow(null).optional(),
        // Coupon
        isCoupon: Joi.boolean().default(false),
        couponValue: Joi.number().min(0).default(0),
        couponType: Joi.string().allow('', null).optional(),
        couponCode: Joi.string().allow('', null).optional(),
    }).unknown(true).required(),
}).unknown(true);


const asyncHandler = require("express-async-handler");
const customerDao = require("../dao/customer.dao");
const orderDao = require("../dao/order.dao");
const paymentGatewayFactory = require("../services/payment/payment.factory");
const {
  generatePayHereHash,
  verifyPayHereNotify,
} = require("../services/payhere.service");

// In-memory bounded cache for processed payment IDs (Idempotency)
const processedPaymentIds = new Set();
const MAX_PROCESSED_IDS = 5000;

const markPaymentProcessed = (paymentId) => {
  if (!paymentId) return false;
  const pidStr = String(paymentId);
  if (processedPaymentIds.has(pidStr)) return true;
  if (processedPaymentIds.size >= MAX_PROCESSED_IDS) {
    const firstEntry = processedPaymentIds.values().next().value;
    processedPaymentIds.delete(firstEntry);
  }
  processedPaymentIds.add(pidStr);
  return false;
};

// =========================================================================
// 1. UNIFIED PAYMENT INITIATION (Strategy + Factory Pattern)
// =========================================================================
exports.initiatePayment = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      amount,
      orderId,
      itemsDescription,
      paymentType = "order",
      gatewayName,
      customFields = {},
    } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({
        status: false,
        message: "A valid positive payment amount is required",
      });
    }

    // Retrieve customer profile details for pre-filling gateway info
    const userRows = await customerDao.getCustomerProfileDao(userId);
    const user = userRows[0] || {};

    const cleanPhone =
      user.phoneNumber && user.phoneNumber.length >= 6
        ? `${user.phoneCode || "+94"}${user.phoneNumber}`.replace(/\s+/g, "")
        : "0771234567";

    const customerDetails = {
      firstName: user.firstName || "Customer",
      lastName: user.lastName || "User",
      email: user.email || "customer@govimart.lk",
      phone: cleanPhone,
      address: "Colombo",
      city: "Colombo",
      country: "Sri Lanka",
    };

    // Obtain strategy from factory (dynamically switches based on gatewayName or ACTIVE_PAYMENT_GATEWAY)
    const strategy = paymentGatewayFactory.getGateway(gatewayName);

    const session = await strategy.initiatePayment({
      userId,
      amount: Number(amount),
      orderId,
      itemsDescription,
      paymentType,
      customer: customerDetails,
      customFields,
    });

    return res.status(200).json({
      status: true,
      message: `${strategy.gatewayName} payment session created successfully`,
      data: session,
    });
  } catch (error) {
    console.error("[Payment Initiate Error]", error);
    return res.status(500).json({
      status: false,
      message: error.message || "Failed to initiate payment session",
    });
  }
});

// =========================================================================
// 2. ACTIVE GATEWAY CONFIGURATION INQUIRY
// =========================================================================
exports.getActiveGateway = asyncHandler(async (req, res) => {
  return res.status(200).json({
    status: true,
    data: {
      activeGateway: paymentGatewayFactory.getActiveGatewayName(),
      supportedGateways: paymentGatewayFactory.getSupportedGateways(),
    },
  });
});

// =========================================================================
// 3. PAYMENTS.LK WEBHOOK HANDLER (Signed Webhook with HMAC-SHA256)
// =========================================================================
exports.handlePaymentsLkWebhook = asyncHandler(async (req, res) => {
  try {
    const signatureHeader = req.headers["payments-signature"];
    const rawBody = req.rawBody || req.body;

    const strategy = paymentGatewayFactory.getGateway("payments_lk");
    const isSignatureValid = strategy.verifyWebhook(signatureHeader, rawBody);

    if (!isSignatureValid) {
      console.error("[Payments.lk Webhook] Signature verification failed!");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const payload = req.body;
    console.log("[Payments.lk Webhook] Received payload event:", payload?.type);

    const event = strategy.parseWebhookEvent(payload);

    // Idempotency: skip duplicate event handling
    if (event.paymentId && markPaymentProcessed(event.paymentId)) {
      console.log(
        `[Payments.lk Webhook] Duplicate event for payment: ${event.paymentId}. Skipping.`
      );
      return res.status(200).json({ received: true, duplicate: true });
    }

    if (event.isPaid) {
      console.log(
        `[Payments.lk Webhook] Payment SUCCESS for order/ref: ${event.orderId}, paymentId: ${event.paymentId}`
      );

      if (event.paymentType === "clear_balance" && event.userId) {
        console.log(
          `[Payments.lk Webhook] Auto-clearing credit balance for user ${event.userId} by Rs. ${event.amount}`
        );
        await customerDao.updateCreditBalanceDao(
          event.userId,
          parseFloat(event.amount)
        );
      } else if (event.orderId) {
        console.log(
          `[Payments.lk Webhook] Settling order payment for identifier: ${event.orderId}, payment_id: ${event.paymentId}`
        );
        try {
          await orderDao.markOrderPaidDao(event.orderId, event.paymentId);
        } catch (settleErr) {
          console.error(
            `[Payments.lk Webhook] Failed to mark order paid:`,
            settleErr
          );
        }
      }
    } else {
      console.warn(
        `[Payments.lk Webhook] Event received with status unfulfilled: ${event.eventType}`
      );
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[Payments.lk Webhook Error]", error);
    return res.status(500).json({ error: "Server error processing webhook" });
  }
});

// =========================================================================
// 4. PAYHERE LEGACY DIRECT ENDPOINTS (Backwards Compatibility)
// =========================================================================
exports.initiatePayHere = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      amount,
      orderId: clientOrderId,
      itemsDescription,
      paymentType = "order",
    } = req.body;

    const userRows = await customerDao.getCustomerProfileDao(userId);
    const user = userRows[0] || {};

    const cleanPhone =
      user.phoneNumber && user.phoneNumber.length >= 6
        ? `${user.phoneCode || "+94"}${user.phoneNumber}`.replace(/\s+/g, "")
        : "0771234567";

    const strategy = paymentGatewayFactory.getGateway("payhere");
    const result = await strategy.initiatePayment({
      userId,
      amount,
      orderId: clientOrderId,
      itemsDescription,
      paymentType,
      customer: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: cleanPhone,
      },
    });

    return res.status(200).json({
      status: true,
      message: "PayHere payment initiated successfully",
      data: result.rawConfig,
    });
  } catch (error) {
    console.error("PayHere initiation error:", error);
    return res.status(500).json({
      status: false,
      message: error.message || "Failed to initiate PayHere payment",
    });
  }
});

exports.handlePayHereNotify = asyncHandler(async (req, res) => {
  try {
    const merchantSecret =
      process.env.PAYHERE_MERCHANT_SECRET ||
      "Mjk4NjMyODI2MjMyMDU0MDMyMzgyNDY5Nzc0OTkwNDEzNzQwNTcxMg==";

    const payload = req.body;
    console.log("[PayHere Webhook] Received notify payload:", payload);

    const isValid = verifyPayHereNotify(payload, merchantSecret);
    if (!isValid) {
      console.error("[PayHere Webhook] Signature verification failed!");
      return res.status(400).send("Invalid signature");
    }

    const {
      status_code,
      custom_1,
      custom_2,
      payhere_amount,
      order_id,
      payment_id,
    } = payload;

    if (payment_id && markPaymentProcessed(payment_id)) {
      console.log(
        `[PayHere Webhook] Duplicate webhook for payment_id: ${payment_id}. Skipping.`
      );
      return res.status(200).send("OK");
    }

    if (Number(status_code) === 2) {
      console.log(`[PayHere Webhook] Payment SUCCESS for order ${order_id}`);

      const userId = Number(custom_2);
      const paymentType = custom_1;

      if (paymentType === "clear_balance" && userId) {
        console.log(
          `[PayHere Webhook] Auto-clearing credit balance for user ${userId} by ${payhere_amount}`
        );
        await customerDao.updateCreditBalanceDao(
          userId,
          parseFloat(payhere_amount)
        );
      } else {
        console.log(
          `[PayHere Webhook] Settling order payment for identifier: ${order_id}, payment_id: ${payment_id}`
        );
        try {
          await orderDao.markOrderPaidDao(order_id, payment_id);
        } catch (settleErr) {
          console.error(`[PayHere Webhook] Failed to mark order paid:`, settleErr);
        }
      }
    } else {
      console.warn(
        `[PayHere Webhook] Payment not successful. Status code: ${status_code}`
      );
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("[PayHere Webhook] Error:", error);
    return res.status(500).send("Server Error");
  }
});

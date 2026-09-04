const asyncHandler = require("express-async-handler");
const customerDao = require("../dao/customer.dao");
const {
  generatePayHereHash,
  verifyPayHereNotify,
} = require("../services/payhere.service");

// ---------- Initiate PayHere Payment (Generates Pre-hashed Parameters) ----------
exports.initiatePayHere = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      amount,
      orderId: clientOrderId,
      itemsDescription,
      paymentType = "order",
      customFields = {},
    } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({
        status: false,
        message: "A valid positive payment amount is required",
      });
    }

    const merchantId = process.env.PAYHERE_MERCHANT_ID || "1237830";
    const merchantSecret =
      process.env.PAYHERE_MERCHANT_SECRET ||
      "Mjk4NjMyODI2MjMyMDU0MDMyMzgyNDY5Nzc0OTkwNDEzNzQwNTcxMg==";
    const isSandbox =
      String(process.env.PAYHERE_SANDBOX).toLowerCase() === "true" || true;

    // Generate unique order ID if not provided
    const prefix = paymentType === "clear_balance" ? "CB" : "ORD";
    const orderId =
      clientOrderId || `${prefix}_${userId}_${Date.now()}`;

    const formattedAmount = Number(amount).toFixed(2);
    const currency = "LKR";

    // Compute cryptographic hash
    const hash = generatePayHereHash(
      merchantId,
      orderId,
      formattedAmount,
      currency,
      merchantSecret
    );

    // Fetch user details for autofill
    const userRows = await customerDao.getCustomerProfileDao(userId);
    const user = userRows[0] || {};

    const domain = process.env.PAYHERE_DOMAIN || "https://dev.govimart.com";
    const cleanPhone = (user.phoneNumber && user.phoneNumber.length >= 6)
      ? `${user.phoneCode || "+94"}${user.phoneNumber}`.replace(/\s+/g, "")
      : "0771234567";

    const paymentConfig = {
      sandbox: isSandbox,
      checkout_url: isSandbox
        ? "https://sandbox.payhere.lk/pay/checkout"
        : "https://www.payhere.lk/pay/checkout",
      domain: domain,
      merchant_id: merchantId,
      return_url: `${domain}/payment/return`,
      cancel_url: `${domain}/payment/cancel`,
      notify_url: `${domain}/api/payment/payhere/notify`,
      order_id: orderId,
      items: itemsDescription || (paymentType === "clear_balance" ? "Clear Credit Balance" : "GoviMart Order"),
      currency: currency,
      amount: formattedAmount,
      first_name: user.firstName || "Customer",
      last_name: user.lastName || "User",
      email: user.email || "customer@govimart.lk",
      phone: cleanPhone,
      address: "Colombo",
      city: "Colombo",
      country: "Sri Lanka",
      hash: hash,
      custom_1: paymentType,
      custom_2: String(userId),
    };

    // Pre-encoded URL query string for direct WebView POST submission
    const postParams = new URLSearchParams();
    Object.keys(paymentConfig).forEach((key) => {
      if (!["sandbox", "checkout_url", "domain"].includes(key)) {
        postParams.append(key, paymentConfig[key]);
      }
    });
    paymentConfig.post_body = postParams.toString();

    return res.status(200).json({
      status: true,
      message: "PayHere payment initiated successfully",
      data: paymentConfig,
    });
  } catch (error) {
    console.error("PayHere initiation error:", error);
    return res.status(500).json({
      status: false,
      message: error.message || "Failed to initiate PayHere payment",
    });
  }
});

// ---------- PayHere Notify Webhook ----------
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

    const { status_code, custom_1, custom_2, payhere_amount, order_id } =
      payload;

    // Status code 2 represents a successful payment in PayHere
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

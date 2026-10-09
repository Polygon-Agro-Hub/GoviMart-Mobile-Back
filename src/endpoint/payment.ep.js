const asyncHandler = require("express-async-handler");
const customerDao = require("../dao/customer.dao");
const orderDao = require("../dao/order.dao");
const paymentGatewayFactory = require("../services/payment/payment.factory");
const savedCardService = require("../services/payment/saved-card.service");
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
      saveCard = false,
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

    let cleanPhone;
    if (user.phoneNumber) {
      let rawPhone = String(user.phoneNumber).replace(/\D/g, "");
      if (rawPhone.startsWith("94") && rawPhone.length === 11) {
        rawPhone = rawPhone.slice(2);
      }
      if (rawPhone.startsWith("0") && rawPhone.length === 10) {
        rawPhone = rawPhone.slice(1);
      }
      if (rawPhone.length === 9) {
        cleanPhone = `0${rawPhone}`;
      }
    }

    // Retrieve customer saved address from house / apartment tables
    let customerAddress = {
      street: "",
      city: "Colombo",
      postcode: "00100",
    };

    try {
      const addresses = await customerDao.getSavedAddressesByCustomerIdDao(userId);
      if (Array.isArray(addresses) && addresses.length > 0) {
        const primary = addresses[0];
        const streetParts = [];
        if (primary.buildingType === "Apartment") {
          if (primary.buildingNo) streetParts.push(`Bldg ${primary.buildingNo}`);
          if (primary.buildingName) streetParts.push(primary.buildingName);
          if (primary.unitNo) streetParts.push(`Unit ${primary.unitNo}`);
          if (primary.floorNo) streetParts.push(`Fl ${primary.floorNo}`);
        }
        if (primary.houseNo) streetParts.push(primary.houseNo);
        if (primary.streetName) streetParts.push(primary.streetName);

        const street = streetParts.filter(Boolean).join(", ").trim();
        const city = (primary.city || "").trim();

        let postcode = "00100";
        const cityLower = city.toLowerCase();
        if (cityLower.includes("kandy")) postcode = "20000";
        else if (cityLower.includes("galle")) postcode = "80000";
        else if (cityLower.includes("negombo")) postcode = "11500";
        else if (cityLower.includes("gampaha")) postcode = "11000";
        else if (cityLower.includes("jaffna")) postcode = "40000";
        else if (cityLower.includes("matara")) postcode = "81000";
        else if (cityLower.includes("kurunegala")) postcode = "60000";
        else if (cityLower.includes("ratnapura")) postcode = "70000";

        customerAddress = {
          street: street || primary.streetName || "Colombo",
          city: city || "Colombo",
          postcode,
        };
      }
    } catch (addrErr) {
      console.warn("[Payment EP] Could not fetch saved address for user:", addrErr.message);
    }

    const customerDetails = {
      firstName: user.firstName || "Customer",
      lastName: user.lastName || "User",
      email: user.email || "customer@govimart.lk",
      address: customerAddress.street || "Colombo",
      city: customerAddress.city || "Colombo",
      country: "Sri Lanka",
    };
    if (cleanPhone) {
      customerDetails.phone = cleanPhone;
    }

    // Obtain strategy from factory (dynamically switches based on gatewayName or ACTIVE_PAYMENT_GATEWAY)
    const strategy = paymentGatewayFactory.getGateway(gatewayName);

    const session = await strategy.initiatePayment({
      userId,
      amount: Number(amount),
      orderId,
      itemsDescription,
      paymentType,
      saveCard,
      customer: customerDetails,
      customFields,
    });

    session.customerAddress = customerAddress;

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

    // Idempotency: skip duplicate event handling (use card id for card events)
    const idempotencyId = event.paymentId || (event.isCardSaved && event.cardData?.id);
    if (idempotencyId && markPaymentProcessed(idempotencyId)) {
      console.log(
        `[Payments.lk Webhook] Duplicate event for id: ${idempotencyId}. Skipping.`
      );
      return res.status(200).json({ received: true, duplicate: true });
    }

    // ── Card on File: card.saved ──────────────────────────────────────────────
    // event.data for card.saved = { id, customerEmail, scheme, last4, expiry, paymentId, consent }
    // event.userId is null on card events (no metadata), so resolve via customerEmail → userId
    if (event.isCardSaved && event.cardData) {
      const cardData = event.cardData; // SavedCard object from Payments.lk
      const customerEmail = cardData.customerEmail;
      console.log(
        `[Payments.lk Webhook] card.saved received — card: ${cardData.id}, email: ${customerEmail}`
      );

      let resolvedUserId = event.userId || null;
      if (!resolvedUserId && customerEmail) {
        try {
          const userRow = await customerDao.getCustomerByEmailDao(customerEmail);
          if (userRow) {
            resolvedUserId = userRow.id;
            console.log(
              `[Payments.lk Webhook] Resolved userId ${resolvedUserId} for email ${customerEmail}`
            );
          } else {
            console.warn(
              `[Payments.lk Webhook] No user found for email: ${customerEmail} — card NOT saved`
            );
          }
        } catch (lookupErr) {
          console.error("[Payments.lk Webhook] Email→userId lookup failed:", lookupErr.message);
        }
      }

      if (resolvedUserId) {
        await savedCardService.saveCard(resolvedUserId, cardData, payload);
      }
    }

    // ── Card on File: card.save_failed ───────────────────────────────────────
    if (event.eventType === "card.save_failed") {
      // Payment succeeded but processor did not vault the card
      const failedEmail = event.customer?.email || payload?.data?.customer?.email;
      console.warn(
        `[Payments.lk Webhook] card.save_failed — payment went through but card was NOT kept.` +
        (failedEmail ? ` Customer: ${failedEmail}` : "") +
        ` The customer should be prompted to save their card again.`
      );
      // No action needed — payment already credited, just don't save a card
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
        : (user.phoneNumber || undefined);

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

// =========================================================================
// 5. SAVED CARD MANAGEMENT (Local In-Memory / Device Fallback)
// =========================================================================
exports.getSavedCards = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const card = await savedCardService.getCard(userId);
  return res.status(200).json({
    status: true,
    data: card ? [card] : [],
  });
});

exports.syncCheckout = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { checkoutId } = req.body;

    if (!checkoutId) {
      return res.status(400).json({
        status: false,
        message: "checkoutId is required to sync checkout session",
      });
    }

    const strategy = paymentGatewayFactory.getGateway("payments_lk");
    const { checkout, card, isCompleted } = await strategy.verifyAndSyncCheckout(
      checkoutId,
      userId
    );

    // Save the card in MySQL DB (user_saved_cards table)
    let savedCard = null;
    if (card && card.id) {
      savedCard = await savedCardService.saveCard(userId, card, checkout);
    }

    // If this was a Clear Balance payment and is completed, auto-update DB credit balance
    const payment = checkout?.payment || {};
    const reference = String(payment.reference || checkout?.reference || "");
    const amountInLkr = typeof payment.amountCents === "number" ? payment.amountCents / 100 : 0;

    // Security check 1: IDOR protection - verify checkout reference belongs to authenticated user
    const refParts = reference.split("_");
    if (reference.startsWith("CB_") && refParts.length >= 2) {
      const refUserId = refParts[1];
      if (String(refUserId) !== String(userId)) {
        return res.status(403).json({
          status: false,
          message: "Unauthorized: This checkout session does not belong to your account",
        });
      }
    }

    // Security check 2: Idempotency check to prevent replay attacks / double crediting
    const paymentRecordId = payment.id || checkoutId;
    const isAlreadyProcessed = markPaymentProcessed(paymentRecordId);

    if (
      !isAlreadyProcessed &&
      (isCompleted || payment.status === "succeeded") &&
      (reference.startsWith("CB_") || reference.includes("CB"))
    ) {
      if (amountInLkr > 0) {
        console.log(
          `[Sync Checkout] Auto-clearing balance for user ${userId} by Rs. ${amountInLkr}`
        );
        await customerDao.updateCreditBalanceDao(userId, parseFloat(amountInLkr));
      }
    }

    return res.status(200).json({
      status: true,
      message: "Checkout session synced successfully with Payments.lk",
      data: {
        isCompleted,
        card: savedCard || card,
        checkout,
      },
    });
  } catch (err) {
    console.error("[Sync Checkout Error]", err);
    return res.status(500).json({
      status: false,
      message: err.message || "Failed to sync checkout with Payments.lk",
    });
  }
});

exports.saveCardLocally = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const cardData = req.body;
  if (!cardData || (!cardData.token && !cardData.cardToken && !cardData.id)) {
    return res.status(400).json({
      status: false,
      message: "Direct un-tokenized card storage is prohibited. Use Payments.lk gateway.",
    });
  }
  const saved = await savedCardService.saveCard(userId, cardData);
  return res.status(200).json({
    status: true,
    message: "Card saved successfully in database",
    data: saved,
  });
});

exports.deleteSavedCard = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { cardId } = req.params;
  await savedCardService.removeCard(userId, cardId);
  return res.status(200).json({
    status: true,
    message: "Card removed successfully from database and Payments.lk vault",
  });
});

exports.chargeSavedCard = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      cardId,
      amount,
      paymentType = "order",
      orderId,
      itemsDescription,
    } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        status: false,
        message: "A valid positive payment amount is required",
      });
    }

    // Security check 3: Verify the card belongs to the authenticated user (prevent charging another user's card)
    const userCard = await savedCardService.getCard(userId);
    if (!userCard || (userCard.id !== cardId && String(userCard.cardId) !== String(cardId))) {
      return res.status(403).json({
        status: false,
        message: "Unauthorized or invalid payment card",
      });
    }

    const strategy = paymentGatewayFactory.getGateway("payments_lk");
    const result = await strategy.chargeSavedCard({
      cardId: userCard.id, // Always use user's verified cardToken
      amount: Number(amount),
      userId,
      orderId,
      itemsDescription,
      paymentType,
    });

    if (result.success && paymentType === "clear_balance") {
      console.log(
        `[Charge Saved Card] Auto-clearing credit balance for user ${userId} by Rs. ${amount}`
      );
      await customerDao.updateCreditBalanceDao(userId, parseFloat(amount));
    }

    return res.status(200).json({
      status: true,
      message: "Payment processed successfully with saved card",
      data: result,
    });
  } catch (err) {
    console.error("[Charge Saved Card Error]", err);
    const errMsg = err.message || "Failed to charge saved card";
    const isCardInvalid =
      errMsg.includes("No such object") ||
      errMsg.includes("NOT_FOUND") ||
      errMsg.includes("card_not_reusable") ||
      errMsg.includes("mode_mismatch") ||
      errMsg.includes("404");

    if (isCardInvalid && req.user?.id) {
      // Clean up invalid/stale card from database so user is not permanently stuck
      try {
        await savedCardService.removeCard(req.user.id);
      } catch (cleanErr) {
        console.warn("[Charge Saved Card] Failed to clean up invalid card:", cleanErr.message);
      }
    }

    return res.status(400).json({
      status: false,
      message: isCardInvalid
        ? "Saved card is no longer valid or has expired. Please use Pay with Card or link a new card."
        : errMsg,
      cardInvalid: isCardInvalid,
    });
  }
});


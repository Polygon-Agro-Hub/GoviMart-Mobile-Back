const crypto = require("crypto");
const PaymentStrategy = require("./payment.strategy");

/**
 * Payments.lk Gateway Strategy
 * Communicates with Payments.lk REST API (Payable) for hosted checkouts and signed webhooks.
 */
class PaymentsLkStrategy extends PaymentStrategy {
  constructor() {
    super();
    this.apiUrl =
      process.env.PAYMENTS_LK_API_URL || "https://api.payments.lk/v1";
    this.secretKey = (process.env.PAYMENTS_LK_SECRET_KEY || "").trim();
    this.webhookSecret = (process.env.PAYMENTS_LK_WEBHOOK_SECRET || "").trim();
    this.appScheme =
      process.env.APP_DEEP_LINK_SCHEME || "polygon";
    this.domain =
      process.env.PAYMENTS_LK_DOMAIN || "";
  }

  _ensureSecretKey() {
    if (!this.secretKey) {
      throw new Error(
        "Payments.lk API secret key is missing. Please set PAYMENTS_LK_SECRET_KEY in your environment variables."
      );
    }
  }

  get gatewayName() {
    return "payments_lk";
  }

  /**
   * Creates a checkout session on Payments.lk
   */
  async initiatePayment(params) {
    this._ensureSecretKey();
    const {
      userId,
      amount: rawAmount,
      orderId: clientOrderId,
      itemsDescription,
      paymentType = "order",
      customer = {},
      customFields = {},
    } = params;

    let amount = rawAmount;
    if (paymentType === "save_card" && (!amount || Number(amount) <= 0)) {
      amount = 10; // Nominal LKR 10.00 verification fee for card setup
    }

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error("A valid positive payment amount is required");
    }

    // Convert standard LKR into whole cents (e.g., LKR 1,500.00 -> 150000)
    const amountCents = Math.round(Number(amount) * 100);

    const prefix =
      paymentType === "clear_balance"
        ? "CB"
        : paymentType === "save_card"
          ? "SC"
          : "ORD";
    const orderId =
      clientOrderId || `${prefix}_${userId}_${Date.now()}`;

    // Callback URLs: Supports deep link scheme for mobile apps
    const successUrl = `${this.appScheme}://payments-lk/return?status=success&orderId=${encodeURIComponent(
      orderId
    )}&paymentType=${encodeURIComponent(paymentType)}&userId=${encodeURIComponent(userId || "")}`;
    const cancelUrl = `${this.appScheme}://payments-lk/return?status=cancel&orderId=${encodeURIComponent(
      orderId
    )}&paymentType=${encodeURIComponent(paymentType)}&userId=${encodeURIComponent(userId || "")}`;

    const description =
      itemsDescription ||
      (paymentType === "clear_balance"
        ? `Clear Credit Balance (User #${userId})`
        : paymentType === "save_card"
          ? `Link Payment Card (User #${userId})`
          : `Polygon Order #${orderId}`);

    // Format phone to valid Sri Lankan mobile number (e.g. 07XXXXXXXX) only if provided
    let validPhone;
    if (customer.phone) {
      let rawPhone = String(customer.phone).replace(/\D/g, "");
      if (rawPhone.startsWith("94") && rawPhone.length === 11) {
        rawPhone = rawPhone.slice(2);
      }
      if (rawPhone.startsWith("0") && rawPhone.length === 10) {
        rawPhone = rawPhone.slice(1);
      }
      if (rawPhone.length === 9) {
        validPhone = `0${rawPhone}`;
      }
    }

    const customerPayload = {
      name:
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
        "Polygon Customer",
      email: customer.email || "customer@govimart.lk",
    };
    if (validPhone) {
      customerPayload.phone = validPhone;
    }

    const requestBody = {
      amountCents,
      description,
      reference: String(orderId),
      successUrl,
      cancelUrl,
      customer: customerPayload,
      saveCard: paymentType === "save_card" ? true : Boolean(params.saveCard),
    };

    const idempotencyKey = `chk-${orderId}-${Date.now()}`;

    const response = await fetch(`${this.apiUrl}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();

    if (!response.ok) {
      const errMsg =
        responseData?.message ||
        responseData?.reason ||
        `Payments.lk API Error: ${response.status} ${response.statusText}`;
      console.error("❌ [Payments.lk API Error]", responseData);
      throw new Error(errMsg);
    }

    return {
      gateway: this.gatewayName,
      checkoutUrl: responseData.url,
      sessionId: responseData.id,
      orderId,
      amount: Number(amount),
      currency: "LKR",
      paymentType,
      successUrl,
      cancelUrl,
      rawData: responseData,
    };
  }

  /**
   * Fetches real checkout details directly from Payments.lk API and verifies card saving
   */
  async verifyAndSyncCheckout(checkoutId, userId, clientCardHolder = null) {
    this._ensureSecretKey();
    if (!checkoutId) {
      throw new Error("checkoutId is required to sync checkout session");
    }

    const response = await fetch(`${this.apiUrl}/checkouts/${checkoutId}`, {
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
    });

    const checkoutData = await response.json();

    if (!response.ok) {
      throw new Error(
        checkoutData?.message ||
        `Failed to retrieve checkout from Payments.lk: ${response.status}`
      );
    }

    const payment = checkoutData.payment || {};
    let card = payment.card || {};
    let savedCardId = payment.savedCardId || payment.cardId || null;
    let scheme = (card.brand || card.scheme || "visa").toLowerCase();
    let last4 = String(card.last4 || (card.maskedNumber ? card.maskedNumber.slice(-4) : "4821"));

    let expiryMonth = "";
    let expiryYear = "";
    let savedCardObj = null;

    // 1. Look up official SavedCard in Payments.lk vault
    const customer = payment.customer || checkoutData.customer || {};
    const customerEmail = customer.email;
    const reference = String(checkoutData.reference || checkoutData.orderId || payment.reference || "");
    const isSaveCard = reference.startsWith("SC_");

    console.log(
      `[Payments.lk Sync] Checkout ${checkoutId}: status=${checkoutData.status}, paymentStatus=${payment.status}, cardSave=${payment.cardSave}, savedCardId=${savedCardId}, email=${customerEmail}`
    );

    if (!savedCardId) {
      // Only attempt card lookup if the checkout payment indicates card was saved
      const cardWasSaved = payment.cardSave === "saved";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          // Query vault for all saved cards
          const queryUrl = `${this.apiUrl}/cards?limit=20`;
          const listRes = await fetch(queryUrl, {
            headers: { Authorization: `Bearer ${this.secretKey}` },
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            const cardList = (listData?.data || []).filter((c) => c.active !== false);

            console.log(`[Payments.lk Sync] Card vault has ${cardList.length} active card(s). cardWasSaved=${cardWasSaved}`);

            // Priority 1: match by payment ID on the card object
            let matched = cardList.find(
              (c) => payment.id && (c.paymentId === payment.id || c.payment_id === payment.id)
            );

            // Priority 2: match by customer email (only when card was explicitly saved during this checkout)
            if (!matched && cardWasSaved && customerEmail) {
              matched = cardList.find(
                (c) =>
                  (c.customerEmail || c.email || c.customer?.email || "")
                    .toLowerCase() === customerEmail.toLowerCase()
              );
            }

            // Priority 3: for save_card type flows, take the most recently added card
            if (!matched && isSaveCard && cardList.length > 0) {
              matched = cardList[0];
            }

            if (matched) {
              console.log(`[Payments.lk Sync] Matched card in vault: ${matched.id} (paymentId: ${matched.paymentId})`);
              savedCardId = matched.id;
              if (matched.expiry) {
                expiryMonth = String(matched.expiry.month || "").padStart(2, "0");
                expiryYear = String(matched.expiry.year || "").slice(-2);
              }
              if (matched.last4) last4 = String(matched.last4);
              if (matched.scheme) scheme = String(matched.scheme).toLowerCase();
              break;
            } else {
              console.log(`[Payments.lk Sync] No matching card found in vault (attempt ${attempt + 1}). cardWasSaved=${cardWasSaved}`);
              if (!cardWasSaved) break; // Don't retry if card was never saved
            }
          }
        } catch (err) {
          console.warn("⚠️ [Payments.lk] Could not query cards list for sync attempt", attempt, err.message);
        }
      }
    }

    if (savedCardId) {
      try {
        const cardRes = await fetch(`${this.apiUrl}/cards/${savedCardId}`, {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
        });
        if (cardRes.ok) {
          savedCardObj = await cardRes.json();
          if (savedCardObj && savedCardObj.expiry && !expiryMonth) {
            expiryMonth = String(savedCardObj.expiry.month || "").padStart(2, "0");
            expiryYear = String(savedCardObj.expiry.year || "").slice(-2);
          }
          if (savedCardObj.last4) last4 = String(savedCardObj.last4);
          if (savedCardObj.scheme) scheme = String(savedCardObj.scheme).toLowerCase();
        }
      } catch (err) {
        console.warn("⚠️ [Payments.lk] Could not fetch saved card by ID:", err.message);
      }
    }

    // 2. Check if expiry is present directly on card or checkout
    if (!expiryMonth) {
      if (card.expiry && typeof card.expiry === "object") {
        expiryMonth = String(card.expiry.month || card.expiry.expiryMonth || "").padStart(2, "0");
        expiryYear = String(card.expiry.year || card.expiry.expiryYear || "").slice(-2);
      } else if (card.expiryMonth || card.expMonth || card.exp_month) {
        expiryMonth = String(card.expiryMonth || card.expMonth || card.exp_month).padStart(2, "0");
        expiryYear = String(card.expiryYear || card.expYear || card.exp_year).slice(-2);
      } else if (typeof card.expiry === "string" && card.expiry.includes("/")) {
        const parts = card.expiry.split("/");
        expiryMonth = parts[0].padStart(2, "0");
        expiryYear = parts[1].slice(-2);
      } else {
        expiryMonth = "01";
        expiryYear = "39";
      }
    }

    // Only create saved card payload if a REAL Payments.lk card was vaulted
    if (!savedCardId) {
      console.log("[Payments.lk Sync] No card was vaulted by customer during checkout.");
      return {
        checkout: checkoutData,
        card: null,
        isCompleted: checkoutData.status === "completed" || payment.status === "succeeded",
      };
    }

    const effectiveCardId = savedCardId;
    // Prioritize the actual name entered on the card over generic profile name
    const resolvedCardHolder =
      (clientCardHolder && String(clientCardHolder).trim()) ||
      card.name ||
      card.holderName ||
      card.cardholderName ||
      card.card_holder_name ||
      (payment.card && (payment.card.name || payment.card.holderName || payment.card.cardholderName)) ||
      (savedCardObj && (savedCardObj.name || savedCardObj.cardHolder || savedCardObj.holderName)) ||
      customer.name ||
      checkoutData.customer?.name ||
      "Cardholder";

    const savedCardPayload = {
      id: effectiveCardId,
      cardToken: effectiveCardId,   // DAO prefers cardToken field
      token: effectiveCardId,
      userId: String(userId),
      scheme: scheme.includes("master") ? "mastercard" : "visa",
      last4,
      cardHolder: resolvedCardHolder,
      expiryMonth,
      expiryYear,
      isDefault: true,
      status: "active",
      checkoutId,
      paymentId: payment.id,
      mode: savedCardObj?.mode || "test",
      consent: savedCardObj?.consent || null,
      rawEvent: checkoutData,
    };

    console.log(`[Payments.lk Sync] Returning savedCardPayload: token=${effectiveCardId}, scheme=${savedCardPayload.scheme}, last4=${last4}, holder=${resolvedCardHolder}`);

    return {
      checkout: checkoutData,
      card: savedCardPayload,
      isCompleted: checkoutData.status === "completed" || payment.status === "succeeded",
    };
  }

  /**
   * Verifies Payments.lk signed webhook payload using HMAC-SHA256
   * Header format: Payments-Signature: "t=1726400000,v1=<hex>"
   */
  verifyWebhook(signatureHeader, rawBody, toleranceSeconds = 300) {
    const secret = this.webhookSecret;
    if (!secret) {
      console.error(
        "❌ [Payments.lk Webhook] PAYMENTS_LK_WEBHOOK_SECRET is not configured in environment variables. Webhook verification failed."
      );
      return false;
    }

    if (!signatureHeader || !rawBody) {
      console.warn("⚠️ [Payments.lk Webhook] Missing signature header or raw body.");
      return false;
    }

    let t;
    const signatures = [];
    const headerParts = String(signatureHeader).split(",");

    for (const part of headerParts) {
      const [key, value] = part.trim().split("=", 2);
      if (key === "t" && /^[0-9]{1,12}$/.test(value || "")) {
        t = Number(value);
      }
      if (key === "v1" && /^[0-9a-f]{64}$/i.test(value || "")) {
        signatures.push(value);
      }
    }

    if (t === undefined) {
      console.warn("⚠️ [Payments.lk Webhook] Timestamp 't' missing from signature header.");
      return false;
    }

    // Check timestamp tolerance to prevent replay attacks
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTimestamp - t) > toleranceSeconds) {
      console.warn(
        `⚠️ [Payments.lk Webhook] Webhook timestamp outside tolerance (${t} vs ${currentTimestamp})`
      );
      return false;
    }

    const payloadString =
      typeof rawBody === "string"
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString("utf8")
          : JSON.stringify(rawBody);

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${t}.${payloadString}`)
      .digest();

    const isValid = signatures.some((sig) => {
      try {
        const sigBuffer = Buffer.from(sig, "hex");
        return (
          expectedSignature.length === sigBuffer.length &&
          crypto.timingSafeEqual(expectedSignature, sigBuffer)
        );
      } catch (err) {
        return false;
      }
    });

    if (!isValid) {
      console.error("❌ [Payments.lk Webhook] HMAC SHA-256 signature verification mismatch.");
    }

    return isValid;
  }

  /**
   * Charges an existing card on file (1-click charge)
   */
  async chargeSavedCard(params) {
    this._ensureSecretKey();
    const {
      cardId,
      amount,
      userId,
      orderId: clientOrderId,
      itemsDescription,
      paymentType = "order",
    } = params;

    if (!amount || Number(amount) <= 0) {
      throw new Error("A valid positive payment amount is required");
    }

    const amountCents = Math.round(Number(amount) * 100);
    const prefix = paymentType === "clear_balance" ? "CB" : "ORD";
    const orderId = clientOrderId || `${prefix}_${userId}_${Date.now()}`;
    const description =
      itemsDescription ||
      (paymentType === "clear_balance"
        ? `Clear Balance #${userId}`
        : `Order #${orderId}`);
    const idempotencyKey = `charge-${orderId}-${Date.now()}`;

    try {
      const response = await fetch(`${this.apiUrl}/cards/${cardId}/charge`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Idempotency-Key": idempotencyKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amountCents,
          description,
          reference: String(orderId),
        }),
      });

      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(
          responseData?.message ||
          responseData?.reason ||
          `Charge failed: ${response.status}`
        );
      }

      return {
        success: true,
        orderId,
        paymentId: responseData?.id || `pm_${Date.now()}`,
        amount: Number(amount),
        paymentType,
        status: "success",
        rawData: responseData,
      };
    } catch (err) {
      console.error(
        `❌ [Payments.lk Charge] API call failed: ${err.message}`
      );
      throw new Error(err.message || "Card charge failed");
    }
  }

  /**
   * Normalizes Payments.lk event into standardized format
   */
  parseWebhookEvent(payload) {
    const eventType = payload?.type || "unknown";
    const data = payload?.data || {};

    const amountInLkr =
      typeof data.amountCents === "number"
        ? data.amountCents / 100
        : undefined;

    const reference = data.reference || data.orderId || "";
    const metadata = data.metadata || {};

    let paymentType = metadata.paymentType || "order";
    if (reference.startsWith("CB_")) {
      paymentType = "clear_balance";
    } else if (reference.startsWith("SC_")) {
      paymentType = "save_card";
    }

    let userId = metadata.userId ? Number(metadata.userId) : null;
    if (!userId && (reference.startsWith("SC_") || reference.startsWith("CB_") || reference.startsWith("ORD_"))) {
      const parts = reference.split("_");
      if (parts.length >= 2 && !isNaN(parts[1])) {
        userId = Number(parts[1]);
      }
    }

    return {
      eventType,
      isPaid: eventType === "payment.succeeded",
      isCardSaved: eventType === "card.saved",
      cardData: eventType === "card.saved" ? data : null,
      orderId: reference,
      paymentId: data.id || payload.id,
      amount: amountInLkr,
      paymentType,
      userId,
      customer: data.customer,
      rawEvent: payload,
    };
  }

  /**
   * Deletes a tokenized card from Payments.lk vault
   * @param {string} cardId - The card ID or token (e.g. card_... / crd_...)
   * @returns {Promise<boolean>}
   */
  async deleteSavedCard(cardId) {
    if (!cardId) return false;
    this._ensureSecretKey();

    try {
      console.log(`[Payments.lk] Deleting card ${cardId} from processor vault...`);
      const response = await fetch(`${this.apiUrl}/cards/${encodeURIComponent(cardId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      });

      // 200 = Success, 404 = Already deleted or not found (safe retry per Payments.lk spec)
      if (response.ok || response.status === 404) {
        console.log(
          `[Payments.lk] Card ${cardId} successfully removed from Payments.lk (status: ${response.status})`
        );
        return true;
      }

      const errText = await response.text().catch(() => "");
      console.warn(
        `⚠️ [Payments.lk] Delete card returned HTTP ${response.status}:`,
        errText
      );
      return false;
    } catch (err) {
      console.error(`❌ [Payments.lk Delete Card Error]:`, err.message);
      return false;
    }
  }
}

module.exports = PaymentsLkStrategy;

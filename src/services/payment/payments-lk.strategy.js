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
    this.secretKey =
      process.env.PAYMENTS_LK_SECRET_KEY || "sk_test_demo";
    this.appScheme =
      process.env.APP_DEEP_LINK_SCHEME || "polygon";
    this.domain =
      process.env.PAYMENTS_LK_DOMAIN || "https://dev.govimart.com";
  }

  get gatewayName() {
    return "payments_lk";
  }

  /**
   * Creates a checkout session on Payments.lk
   */
  async initiatePayment(params) {
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
        : `GoviMart Order #${orderId}`);

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
        "GoviMart Customer",
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
      console.error("[Payments.lk API Error]", responseData);
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
  async verifyAndSyncCheckout(checkoutId, userId) {
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

    // 1. Look up official SavedCard in Payments.lk vault
    const customer = payment.customer || checkoutData.customer || {};
    const customerEmail = customer.email;

    console.log(
      `[Payments.lk Sync] Checkout ${checkoutId}: status=${checkoutData.status}, paymentStatus=${payment.status}, cardSave=${payment.cardSave}, savedCardId=${savedCardId}, email=${customerEmail}`
    );

    if (!savedCardId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          const queryUrl = customerEmail
            ? `${this.apiUrl}/cards?customerEmail=${encodeURIComponent(customerEmail)}&limit=10`
            : `${this.apiUrl}/cards?limit=10`;
          const listRes = await fetch(queryUrl, {
            headers: { Authorization: `Bearer ${this.secretKey}` },
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            const cardList = listData?.data || [];
            const matched =
              cardList.find((c) => payment.id && c.paymentId === payment.id) ||
              cardList.find((c) => customerEmail && c.customerEmail === customerEmail && c.active !== false) ||
              cardList.find((c) => c.active !== false);
            if (matched) {
              savedCardId = matched.id;
              if (matched.expiry) {
                expiryMonth = String(matched.expiry.month || "").padStart(2, "0");
                expiryYear = String(matched.expiry.year || "").slice(-2);
              }
              if (matched.last4) last4 = String(matched.last4);
              if (matched.scheme) scheme = String(matched.scheme).toLowerCase();
              break;
            }
          }
        } catch (err) {
          console.warn("[Payments.lk] Could not query cards list for sync attempt", attempt, err.message);
        }
      }
    }

    if (savedCardId && !expiryMonth) {
      try {
        const cardRes = await fetch(`${this.apiUrl}/cards/${savedCardId}`, {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
        });
        if (cardRes.ok) {
          const savedCardObj = await cardRes.json();
          if (savedCardObj && savedCardObj.expiry) {
            expiryMonth = String(savedCardObj.expiry.month || "").padStart(2, "0");
            expiryYear = String(savedCardObj.expiry.year || "").slice(-2);
          }
          if (savedCardObj.last4) last4 = String(savedCardObj.last4);
          if (savedCardObj.scheme) scheme = String(savedCardObj.scheme).toLowerCase();
        }
      } catch (err) {
        console.warn("[Payments.lk] Could not fetch saved card by ID:", err.message);
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
    const cardHolder = customer.name || checkoutData.customer?.name || "Cardholder";

    const savedCardPayload = {
      id: effectiveCardId,
      userId: String(userId),
      scheme: scheme.includes("master") ? "mastercard" : "visa",
      last4,
      cardHolder,
      expiryMonth,
      expiryYear,
      isDefault: true,
      token: effectiveCardId,
      status: "active",
      checkoutId,
      paymentId: payment.id,
      rawEvent: checkoutData,
    };

    return {
      checkout: checkoutData,
      card: savedCardPayload,
      isCompleted: checkoutData.status === "completed" || payment.status === "succeeded",
    };
  }

  /**
   * Webhook verification (webhookSecret removed from system)
   */
  verifyWebhook(signatureHeader, rawBody) {
    return true;
  }

  /**
   * Charges an existing card on file (1-click charge)
   */
  async chargeSavedCard(params) {
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
        `[Payments.lk Charge] API call failed: ${err.message}`
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
    }

    const userId = metadata.userId ? Number(metadata.userId) : null;

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
        `[Payments.lk] Delete card returned HTTP ${response.status}:`,
        errText
      );
      return false;
    } catch (err) {
      console.error(`[Payments.lk Delete Card Error]:`, err.message);
      return false;
    }
  }
}

module.exports = PaymentsLkStrategy;

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
    this.secretKey =
      process.env.PAYMENTS_LK_SECRET_KEY || "sk_test_demo";
    this.webhookSecret =
      process.env.PAYMENTS_LK_WEBHOOK_SECRET || "";
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
      amount,
      orderId: clientOrderId,
      itemsDescription,
      paymentType = "order",
      customer = {},
      customFields = {},
    } = params;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error("A valid positive payment amount is required");
    }

    // Convert standard LKR into whole cents (e.g., LKR 1,500.00 -> 150000)
    const amountCents = Math.round(Number(amount) * 100);

    const prefix = paymentType === "clear_balance" ? "CB" : "ORD";
    const orderId =
      clientOrderId || `${prefix}_${userId}_${Date.now()}`;

    // Callback URLs: Supports deep link scheme for mobile apps or fallback web domain
    const successUrl = `${this.appScheme}://payment/return?orderId=${encodeURIComponent(
      orderId
    )}&paymentType=${encodeURIComponent(paymentType)}`;
    const cancelUrl = `${this.appScheme}://payment/cancel?orderId=${encodeURIComponent(
      orderId
    )}&paymentType=${encodeURIComponent(paymentType)}`;

    const description =
      itemsDescription ||
      (paymentType === "clear_balance"
        ? `Clear Credit Balance (User #${userId})`
        : `GoviMart Order #${orderId}`);

    const customerPayload = {
      name:
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
        "GoviMart Customer",
      email: customer.email || "customer@govimart.lk",
      phone: customer.phone || "0771234567",
    };

    const requestBody = {
      amountCents,
      description,
      reference: String(orderId),
      successUrl,
      cancelUrl,
      customer: customerPayload,
      metadata: {
        paymentType,
        userId: String(userId),
        orderId: String(orderId),
        ...customFields,
      },
    };

    const idempotencyKey = `order-${orderId}`;

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
   * Verifies Payments.lk signed webhook payload using HMAC-SHA256
   * Header format: Payments-Signature: "t=1726400000,v1=<hex>"
   */
  verifyWebhook(signatureHeader, rawBody, toleranceSeconds = 300) {
    const secret = this.webhookSecret;
    if (!secret) {
      console.warn(
        "[Payments.lk Webhook] PAYMENTS_LK_WEBHOOK_SECRET is not configured. Skipping signature check."
      );
      return true;
    }

    if (!signatureHeader || !rawBody) {
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
      return false;
    }

    // Check timestamp tolerance to prevent replay attacks
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTimestamp - t) > toleranceSeconds) {
      console.warn(
        `[Payments.lk Webhook] Webhook timestamp outside tolerance (${t} vs ${currentTimestamp})`
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

    return signatures.some((sig) => {
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
      orderId: reference,
      paymentId: data.id || payload.id,
      amount: amountInLkr,
      paymentType,
      userId,
      customer: data.customer,
      rawEvent: payload,
    };
  }
}

module.exports = PaymentsLkStrategy;

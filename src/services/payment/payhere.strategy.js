const PaymentStrategy = require("./payment.strategy");
const {
  generatePayHereHash,
  verifyPayHereNotify,
} = require("../payhere.service");

/**
 * PayHere Strategy
 * Wraps PayHere form-POST MD5 hashed checkout flow.
 */
class PayHereStrategy extends PaymentStrategy {
  constructor() {
    super();
    this.merchantId = process.env.PAYHERE_MERCHANT_ID || "1237830";
    this.merchantSecret =
      process.env.PAYHERE_MERCHANT_SECRET ||
      "Mjk4NjMyODI2MjMyMDU0MDMyMzgyNDY5Nzc0OTkwNDEzNzQwNTcxMg==";
    this.isSandbox =
      process.env.PAYHERE_SANDBOX !== undefined
        ? String(process.env.PAYHERE_SANDBOX).toLowerCase() === "true"
        : process.env.NODE_ENV !== "production";
    this.domain = process.env.PAYHERE_DOMAIN || "https://dev.govimart.com";
  }

  get gatewayName() {
    return "payhere";
  }

  async initiatePayment(params) {
    const {
      userId,
      amount,
      orderId: clientOrderId,
      itemsDescription,
      paymentType = "order",
      customer = {},
    } = params;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error("A valid positive payment amount is required");
    }

    const prefix = paymentType === "clear_balance" ? "CB" : "ORD";
    const orderId =
      clientOrderId || `${prefix}_${userId}_${Date.now()}`;

    const formattedAmount = Number(amount).toFixed(2);
    const currency = "LKR";

    const hash = generatePayHereHash(
      this.merchantId,
      orderId,
      formattedAmount,
      currency,
      this.merchantSecret
    );

    const checkoutUrl = this.isSandbox
      ? "https://sandbox.payhere.lk/pay/checkout"
      : "https://www.payhere.lk/pay/checkout";

    const paymentConfig = {
      sandbox: this.isSandbox,
      checkout_url: checkoutUrl,
      domain: this.domain,
      merchant_id: this.merchantId,
      return_url: `${this.domain}/payment/return`,
      cancel_url: `${this.domain}/payment/cancel`,
      notify_url: `${this.domain}/api/payment/payhere/notify`,
      order_id: orderId,
      items:
        itemsDescription ||
        (paymentType === "clear_balance"
          ? "Clear Credit Balance"
          : "GoviMart Order"),
      currency: currency,
      amount: formattedAmount,
      first_name: customer.firstName || "Customer",
      last_name: customer.lastName || "User",
      email: customer.email || "customer@govimart.lk",
      phone: customer.phone || "",
      address: customer.address || "Colombo",
      city: customer.city || "Colombo",
      country: "Sri Lanka",
      hash: hash,
      custom_1: paymentType,
      custom_2: String(userId),
    };

    const postParams = new URLSearchParams();
    Object.keys(paymentConfig).forEach((key) => {
      if (!["sandbox", "checkout_url", "domain"].includes(key)) {
        postParams.append(key, paymentConfig[key]);
      }
    });
    paymentConfig.post_body = postParams.toString();

    return {
      gateway: this.gatewayName,
      checkoutUrl: checkoutUrl,
      sessionId: orderId,
      orderId,
      amount: Number(amount),
      currency: "LKR",
      paymentType,
      rawConfig: paymentConfig,
    };
  }

  verifyWebhook(headers, body) {
    return verifyPayHereNotify(body, this.merchantSecret);
  }

  parseWebhookEvent(payload) {
    const {
      status_code,
      custom_1,
      custom_2,
      payhere_amount,
      order_id,
      payment_id,
    } = payload || {};

    const isPaid = Number(status_code) === 2;
    const paymentType = custom_1 || "order";
    const userId = custom_2 ? Number(custom_2) : null;

    return {
      eventType: isPaid ? "payment.succeeded" : "payment.failed",
      isPaid,
      orderId: order_id,
      paymentId: payment_id,
      amount: parseFloat(payhere_amount || "0"),
      paymentType,
      userId,
      rawEvent: payload,
    };
  }
}

module.exports = PayHereStrategy;

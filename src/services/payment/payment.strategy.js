/**
 * Payment Strategy Interface (Base Class)
 * Defines the contract that all payment gateways must implement.
 */
class PaymentStrategy {
  /**
   * Unique name of the gateway strategy (e.g. 'payments_lk', 'payhere')
   */
  get gatewayName() {
    throw new Error("Property 'gatewayName' must be implemented.");
  }

  /**
   * Initiates a payment session with the gateway.
   * @param {Object} params
   * @param {string|number} params.userId
   * @param {number} params.amount - Amount in standard currency units (LKR)
   * @param {string} [params.orderId] - Client or server order ID
   * @param {string} [params.itemsDescription]
   * @param {"order"|"clear_balance"} [params.paymentType="order"]
   * @param {Object} [params.customer] - Customer details { firstName, lastName, email, phone }
   * @param {Object} [params.customFields]
   * @returns {Promise<Object>} Unified checkout session object
   */
  async initiatePayment(params) {
    throw new Error("Method 'initiatePayment()' must be implemented.");
  }

  /**
   * Verifies the incoming webhook payload / signature.
   * @param {Object} headers - Request headers
   * @param {string|Buffer|Object} body - Request body or raw body
   * @returns {boolean|Promise<boolean>} True if signature is valid
   */
  verifyWebhook(headers, body) {
    throw new Error("Method 'verifyWebhook()' must be implemented.");
  }

  /**
   * Parses and normalizes webhook events into a unified format.
   * @param {Object} payload - Webhook request body
   * @returns {Object} Unified payment event
   */
  parseWebhookEvent(payload) {
    throw new Error("Method 'parseWebhookEvent()' must be implemented.");
  }
}

module.exports = PaymentStrategy;

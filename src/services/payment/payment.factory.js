const PaymentsLkStrategy = require("./payments-lk.strategy");
const PayHereStrategy = require("./payhere.strategy");

/**
 * Payment Gateway Factory (Factory Pattern)
 * Instantiates and returns the configured payment gateway strategy.
 */
class PaymentGatewayFactory {
  constructor() {
    this.strategies = new Map();
    this.strategies.set("payments_lk", new PaymentsLkStrategy());
    this.strategies.set("paymentslk", this.strategies.get("payments_lk"));
    this.strategies.set("payhere", new PayHereStrategy());
  }

  /**
   * Returns the strategy instance for the given gateway name,
   * falling back to ACTIVE_PAYMENT_GATEWAY env variable or "payments_lk".
   * @param {string} [gatewayName]
   * @returns {import('./payment.strategy')}
   */
  getGateway(gatewayName) {
    const activeName = (
      gatewayName ||
      process.env.ACTIVE_PAYMENT_GATEWAY ||
      "payments_lk"
    )
      .toLowerCase()
      .trim();

    const strategy = this.strategies.get(activeName);
    if (!strategy) {
      console.warn(
        `[PaymentGatewayFactory] Unknown gateway "${activeName}". Falling back to payments_lk.`
      );
      return this.strategies.get("payments_lk");
    }

    return strategy;
  }

  /**
   * Get the active gateway name configured in environment
   */
  getActiveGatewayName() {
    return (process.env.ACTIVE_PAYMENT_GATEWAY || "payments_lk")
      .toLowerCase()
      .trim();
  }

  /**
   * Get list of all registered gateway names
   */
  getSupportedGateways() {
    return Array.from(new Set(Array.from(this.strategies.keys()))).filter(
      (k) => k !== "paymentslk"
    );
  }
}

// Export singleton instance
module.exports = new PaymentGatewayFactory();

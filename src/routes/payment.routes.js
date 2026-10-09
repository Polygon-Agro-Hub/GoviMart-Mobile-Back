const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const paymentEp = require("../endpoint/payment.ep");

// 1. Unified Payment Initiation (Strategy & Factory Pattern)
router.post("/initiate", authMiddleware, paymentEp.initiatePayment);

// 2. Active Gateway Info
router.get("/active-gateway", authMiddleware, paymentEp.getActiveGateway);

// 3. Payments.lk Dedicated Routes
router.post("/payments-lk/initiate", authMiddleware, (req, res, next) => {
  req.body.gatewayName = "payments_lk";
  paymentEp.initiatePayment(req, res, next);
});
router.post("/payments-lk/webhook", paymentEp.handlePaymentsLkWebhook);

// 4. PayHere Legacy Dedicated Routes
router.post("/payhere/initiate", authMiddleware, paymentEp.initiatePayHere);
router.post(
  "/payhere/notify",
  express.urlencoded({ extended: true }),
  paymentEp.handlePayHereNotify
);

module.exports = router;

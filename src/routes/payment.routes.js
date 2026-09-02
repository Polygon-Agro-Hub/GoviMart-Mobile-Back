const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const paymentEp = require("../endpoint/payment.ep");

// Initiate PayHere Payment (Authenticated)
router.post("/payhere/initiate", authMiddleware, paymentEp.initiatePayHere);

// PayHere Notify Webhook (Public Callback, Signature Verified)
router.post("/payhere/notify", express.urlencoded({ extended: true }), paymentEp.handlePayHereNotify);

module.exports = router;

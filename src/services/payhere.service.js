const crypto = require("crypto");

const getMd5 = (string) => {
  return crypto.createHash("md5").update(string).digest("hex").toUpperCase();
};

/**
 * Generate PayHere checkout payment hash
 * Formula: strtoupper(md5(merchant_id + order_id + amountFormated + currency + strtoupper(md5(merchant_secret))))
 */
const generatePayHereHash = (
  merchantId,
  orderId,
  amount,
  currency = "LKR",
  merchantSecret
) => {
  const formattedAmount = Number(amount)
    .toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/,/g, "");

  const hashedSecret = getMd5(merchantSecret);
  const mainString = `${merchantId}${orderId}${formattedAmount}${currency}${hashedSecret}`;
  return getMd5(mainString);
};

/**
 * Verify PayHere notify webhook signature
 * Formula: strtoupper(md5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + strtoupper(md5(merchant_secret))))
 */
const verifyPayHereNotify = (body, merchantSecret) => {
  const {
    merchant_id,
    order_id,
    payhere_amount,
    payhere_currency,
    status_code,
    md5sig,
  } = body;

  const hashedSecret = getMd5(merchantSecret);
  const calculatedSig = getMd5(
    `${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${hashedSecret}`
  );

  return calculatedSig === (md5sig || "").toUpperCase();
};

module.exports = {
  generatePayHereHash,
  verifyPayHereNotify,
};

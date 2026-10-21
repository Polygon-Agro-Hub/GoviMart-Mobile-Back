const db = require("../../startup/database");
const { sendSms } = require("./sms.service");

// ─── Duplicate SMS protection ────────────────────────────────────────────────
// In-memory cache to prevent duplicate order confirmation SMS (10 minute TTL)
const recentConfirmedInvoices = new Map();

const isInvoiceRecentlyNotified = (invNo) => {
  if (!invNo) return false;
  const now = Date.now();
  const cachedTime = recentConfirmedInvoices.get(String(invNo));
  if (cachedTime && now - cachedTime < 10 * 60 * 1000) {
    return true;
  }
  recentConfirmedInvoices.set(String(invNo), now);
  // Housekeeping: purge entries older than 30 minutes
  if (recentConfirmedInvoices.size > 2000) {
    for (const [key, timestamp] of recentConfirmedInvoices.entries()) {
      if (now - timestamp > 30 * 60 * 1000) {
        recentConfirmedInvoices.delete(key);
      }
    }
  }
  return false;
};

// ─── Date helpers ────────────────────────────────────────────────────────────
const pad = (n) => (n < 10 ? `0${n}` : `${n}`);

// Parse "YYYY-MM-DD" or a Date into a local date with no timezone shift
const toLocalDate = (value) => {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const parsed = new Date(value);
  return isNaN(parsed.getTime())
    ? new Date()
    : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const formatYmd = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Never return a date in the past
const clampToToday = (d) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today ? today : d;
};

/**
 * Resolves customer phone number from marketplaceusers table by userId,
 * falling back to provided phone if DB record is empty.
 *
 * @param {number|string} userId
 * @param {string} [fallbackPhone]
 * @returns {Promise<string|null>}
 */
const resolveCustomerPhone = async (userId, fallbackPhone = null) => {
  if (userId) {
    try {
      const [rows] = await db.collectionofficer.promise().query(
        "SELECT phoneCode, phoneNumber FROM collection_officer.marketplaceusers WHERE id = ? LIMIT 1",
        [userId]
      );
      if (rows && rows.length > 0 && rows[0].phoneNumber) {
        const phoneCode = rows[0].phoneCode || "94";
        const phoneNumber = rows[0].phoneNumber;
        return `${phoneCode}${phoneNumber}`;
      }
    } catch (err) {
      console.warn("[Order SMS] Error resolving customer phone from marketplaceusers:", err.message);
    }
  }
  return fallbackPhone || null;
};

/**
 * Resolves invoice number and customer userId from processorders / orders tables
 * given an orderId, processOrderId, or invNo.
 *
 * @param {string|number} orderIdOrProcessOrderId
 * @param {string|number} [fallbackUserId=null]
 * @returns {Promise<{invNo: string|null, userId: string|number|null}>}
 */
const resolveOrderDetails = async (orderIdOrProcessOrderId, fallbackUserId = null) => {
  if (!orderIdOrProcessOrderId) return { invNo: null, userId: fallbackUserId };
  try {
    const [rows] = await db.collectionofficer.promise().query(
      `SELECT po.invNo, o.userId 
       FROM collection_officer.processorders po 
       JOIN collection_officer.orders o ON po.orderId = o.id 
       WHERE po.id = ? OR po.orderId = ? OR po.invNo = ? OR o.id = ?
       ORDER BY (po.id = ?) DESC 
       LIMIT 1`,
      [orderIdOrProcessOrderId, orderIdOrProcessOrderId, orderIdOrProcessOrderId, orderIdOrProcessOrderId, orderIdOrProcessOrderId]
    );
    if (rows && rows.length > 0) {
      return {
        invNo: rows[0].invNo,
        userId: rows[0].userId || fallbackUserId,
      };
    }
  } catch (err) {
    console.warn("[Order SMS] Failed to resolve order details:", err.message);
  }
  return { invNo: null, userId: fallbackUserId };
};

/**
 * Normal orders: Processing Date = delivery date - 3 days.
 * Example: delivery 2026-10-18 -> 2026-10-15
 * (2 full gap days between processing date and delivery date)
 *
 * @param {string|Date} deliveryDate
 * @returns {string} 'YYYY-MM-DD'
 */
const calculateProcessingDate = (deliveryDate) => {
  const d = toLocalDate(deliveryDate);
  d.setDate(d.getDate() - 3);
  return formatYmd(clampToToday(d));
};

/**
 * Package orders (isFinalizeImdt = 0 AND isPackage = 1):
 * Confirmation request date = Processing Date + 1 = delivery date - 2 days.
 * Example: delivery 2026-10-18 -> 2026-10-16
 *
 * @param {string|Date} deliveryDate
 * @returns {string} 'YYYY-MM-DD'
 */
const calculateConfirmationRequestDate = (deliveryDate) => {
  const d = toLocalDate(deliveryDate);
  d.setDate(d.getDate() - 2);
  return formatYmd(clampToToday(d));
};

/**
 * Type 1 / After-Acceptance / After-Payment SMS:
 * "Dear Customer, your order : [INV NO] is confirmed. Thank you for ordering with Polygon!"
 *
 * @param {object} params
 * @param {number|string} [params.userId]
 * @param {string} [params.phone]
 * @param {string} params.invNo
 * @returns {Promise<{success: boolean, referenceId?: string, error?: string}>}
 */
const sendOrderConfirmedSms = async ({ userId, phone, invNo }) => {
  try {
    if (!invNo) {
      console.warn("[Order SMS] sendOrderConfirmedSms skipped: invNo is required.");
      return { success: false, error: "Missing invoice number" };
    }

    if (isInvoiceRecentlyNotified(invNo)) {
      console.log(`[Order SMS] Skipping duplicate confirmation SMS for invoice: ${invNo}`);
      return { success: true, duplicate: true };
    }

    const resolvedPhone = await resolveCustomerPhone(userId, phone);
    if (!resolvedPhone) {
      console.warn(`[Order SMS] Could not resolve phone number for userId: ${userId}`);
      return { success: false, error: "Missing phone number" };
    }

    const message = `Dear Customer, your order : ${invNo} is confirmed. Thank you for ordering with Polygon!`;
    return await sendSms(resolvedPhone, message);
  } catch (err) {
    console.error("[Order SMS] Error in sendOrderConfirmedSms:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Type 2 SMS (When order is placed with Delivery Date After E.P.S.D.):
 * Cash/Cash+Credit:
 *   "Dear Customer, You’ll receive an order confirmation request via the Polygon Platform by 8:00 AM on [Processing Date]. Please confirm your order by 6:00 PM or it will be cancelled."
 * Card:
 *   "Dear Customer, You’ll receive an order confirmation request via the Polygon Platform by 8:00 AM on [Processing Date]. Please pay by 6:00 PM to confirm your order, or it will be cancelled."
 *
 * Processing Date = delivery date - 3 (18 -> 15)
 *
 * @param {object} params
 * @param {number|string} [params.userId]
 * @param {string} [params.phone]
 * @param {string|Date} params.deliveryDate
 * @param {boolean} [params.isCardPayment=false]
 * @returns {Promise<{success: boolean, referenceId?: string, error?: string}>}
 */
const sendOrderPlacedAfterEpsdSms = async ({ userId, phone, deliveryDate, isCardPayment = false }) => {
  try {
    const processingDateStr = calculateProcessingDate(deliveryDate);
    const resolvedPhone = await resolveCustomerPhone(userId, phone);

    if (!resolvedPhone) {
      console.warn(`[Order SMS] Could not resolve phone number for userId: ${userId}`);
      return { success: false, error: "Missing phone number" };
    }

    let message;
    if (isCardPayment) {
      message = `Dear Customer, You’ll receive an order confirmation request via the Polygon Platform by 8:00 AM on ${processingDateStr}. Please pay by 6:00 PM to confirm your order, or it will be cancelled.`;
    } else {
      message = `Dear Customer, You’ll receive an order confirmation request via the Polygon Platform by 8:00 AM on ${processingDateStr}. Please confirm your order by 6:00 PM or it will be cancelled.`;
    }

    return await sendSms(resolvedPhone, message);
  } catch (err) {
    console.error("[Order SMS] Error in sendOrderPlacedAfterEpsdSms:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * SMS for: isFinalizeImdt = 0 AND isPackage = 1 (no E.P.S.D. check):
 * "Dear Customer, You’ll receive an order review request via the Polygon Platform by 8:00 AM on [Processing Date + 1]. Please review and accept your order by 6:00 PM or it will be canceled."
 *
 * Date shown = delivery date - 2 (18 -> 16)
 *
 * @param {object} params
 * @param {number|string} [params.userId]
 * @param {string} [params.phone]
 * @param {string|Date} params.deliveryDate
 * @returns {Promise<{success: boolean, referenceId?: string, error?: string}>}
 */
const sendOrderPlacedPayToConfirmSms = async ({ userId, phone, deliveryDate }) => {
  try {
    const confirmDateStr = calculateConfirmationRequestDate(deliveryDate);
    const resolvedPhone = await resolveCustomerPhone(userId, phone);

    if (!resolvedPhone) {
      console.warn(`[Order SMS] Could not resolve phone number for userId: ${userId}`);
      return { success: false, error: "Missing phone number" };
    }

    const message = `Dear Customer, You’ll receive an order review request via the Polygon Platform by 8:00 AM on ${confirmDateStr}. Please review and accept your order by 6:00 PM or it will be canceled.`;
    return await sendSms(resolvedPhone, message);
  } catch (err) {
    console.error("[Order SMS] Error in sendOrderPlacedPayToConfirmSms:", err.message);
    return { success: false, error: err.message };
  }
};

module.exports = {
  resolveCustomerPhone,
  resolveOrderDetails,
  calculateProcessingDate,
  calculateConfirmationRequestDate,
  sendOrderConfirmedSms,
  sendOrderPlacedAfterEpsdSms,
  sendOrderPlacedPayToConfirmSms,
};
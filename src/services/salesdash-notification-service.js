const axios = require("axios");
const { SALESDASH_TRIGGER_SECRET } = require("../constants/notification-secrets");

/**
 * Service to notify Sales Dash Mobile API over HTTP webhook from Polygon backend.
 * Delivers real-time Socket.IO and Push Notification to Sales Agent.
 */

const getSalesDashBaseUrl = () => {
  const url =
    process.env.SALESDASH_API_URL ||
    "https://dev.polygonagro.com/dash-api/agro-api/salesdash";
  return url.replace(/\/+$/, "");
};

const getServiceHeaders = () => {
  const secret = SALESDASH_TRIGGER_SECRET;
  const headers = {
    "Content-Type": "application/json",
  };
  if (secret) {
    headers["x-service-token"] = secret;
    headers["Authorization"] = `Bearer ${secret}`;
  }
  return headers;
};

/**
 * Resolves assigned salesAgent ID for an order directly from DB.
 */
const resolveSalesAgentId = async (orderId) => {
  try {
    const db = require("../startup/database");
    const [rows] = await db.collectionofficer.promise().query(
      `SELECT mps.salesAgent 
       FROM collection_officer.processorders po 
       JOIN collection_officer.orders o ON po.orderId = o.id 
       JOIN collection_officer.marketplaceusers mps ON o.userId = mps.id 
       WHERE po.id = ? OR po.orderId = ? OR o.id = ?
       ORDER BY (po.id = ?) DESC
       LIMIT 1`,
      [orderId, orderId, orderId, orderId]
    );
    if (rows && rows.length > 0 && rows[0].salesAgent) {
      return rows[0].salesAgent;
    }
  } catch (err) {
    console.warn("[SalesDash Notification] DB resolveSalesAgentId error:", err.message);
  }
  return null;
};

/**
 * Dispatches a notification to Sales Agent via Sales Dash API webhook.
 */
const triggerSalesDashNotification = async ({
  orderId,
  title,
  message,
  eventType,
  data = {},
  skipDbInsert = true,
}) => {
  if (!orderId) {
    console.warn("[SalesDash Notification] orderId is required to trigger notification.");
    return false;
  }

  let salesAgentId = data?.salesAgentId;
  if (!salesAgentId) {
    salesAgentId = await resolveSalesAgentId(orderId);
  }

  if (!salesAgentId) {
    console.log(
      `ℹ️ [SalesDash Notification] Order ${orderId} is not assigned to any Sales Agent. Skipping.`
    );
    return true;
  }

  const salesDashBase = getSalesDashBaseUrl();
  const url = `${salesDashBase}/api/notifications/trigger`;

  try {
    const payload = {
      orderId,
      salesAgentId,
      title,
      message,
      eventType,
      data,
      skipDbInsert,
    };

    const response = await axios.post(url, payload, {
      timeout: 5000,
      headers: getServiceHeaders(),
    });

    console.log(
      `📢 [SalesDash Socket] Dispatched "${title}" to Sales Agent ${salesAgentId} for order ${orderId} (Status: ${response.status})`
    );
    return true;
  } catch (err) {
    console.warn(
      `⚠️ [SalesDash Socket] Could not dispatch notification to Sales Dash API (${url}) for order ${orderId}:`,
      err.response?.data?.message || err.message
    );
    return false;
  }
};

/**
 * Order cancelled from Polygon customer app
 */
const notifySalesDashOrderCancelled = async (processOrderId, invNo) => {
  return triggerSalesDashNotification({
    orderId: processOrderId,
    title: "Order is Cancelled",
    message: `Order #${invNo} has been cancelled by customer.`,
    eventType: "order_cancelled",
    data: { processOrderId, invNo },
    skipDbInsert: true,
  });
};

module.exports = {
  triggerSalesDashNotification,
  notifySalesDashOrderCancelled,
  resolveSalesAgentId,
};

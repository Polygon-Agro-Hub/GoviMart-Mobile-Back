/**
 * Service to notify Polygon Customer Mobile App (GoviMart Mobile)
 * Delivers real-time Socket.IO and Background Push Notification (FCM / Expo) to Customer.
 */

/**
 * Resolves customer userId and order details directly from DB.
 */
const resolveCustomerUserId = async (orderId) => {
  try {
    const db = require("../startup/database");
    const [rows] = await db.collectionofficer.promise().query(
      `SELECT o.userId, po.invNo 
       FROM collection_officer.processorders po 
       JOIN collection_officer.orders o ON po.orderId = o.id 
       WHERE po.id = ? OR po.orderId = ? OR o.id = ?
       ORDER BY (po.id = ?) DESC
       LIMIT 1`,
      [orderId, orderId, orderId, orderId]
    );
    if (rows && rows.length > 0) {
      return { userId: rows[0].userId, invNo: rows[0].invNo };
    }
  } catch (err) {
    console.warn("[Polygon Notification] DB resolveCustomerUserId error:", err.message);
  }
  return { userId: null, invNo: null };
};

/**
 * Dispatches a real-time background notification (Expo/FCM Push + Socket.IO) to Polygon Customer App.
 */
const triggerPolygonNotification = async ({
  orderId,
  userId = null,
  title,
  message,
  eventType = "order_cancelled",
  data = {},
  skipDbInsert = true,
}) => {
  try {
    let targetUserId = userId;
    let invNo = data?.invNo;

    if (!targetUserId && orderId) {
      const resolved = await resolveCustomerUserId(orderId);
      targetUserId = resolved.userId;
      if (!invNo && resolved.invNo) {
        invNo = resolved.invNo;
      }
    }

    if (!targetUserId) {
      console.warn(`[Polygon Notification] Cannot dispatch notification: target userId not found for order ${orderId}`);
      return false;
    }

    const invNoDisplay = invNo || (orderId ? `ORD-${orderId}` : "");
    const effectiveTitle = title || "Order Cancelled";
    const effectiveBody =
      message ||
      (invNoDisplay
        ? `Your order #${invNoDisplay} has been cancelled successfully.`
        : "Your order has been cancelled.");

    const notificationDao = require("../dao/notification.dao");

    if (!skipDbInsert && orderId) {
      await notificationDao.createNotificationDao({
        orderId,
        title: effectiveTitle,
        message: effectiveBody,
      });
      console.log(
        `📢 [Polygon Notification] Created DB record and dispatched push/socket for User ${targetUserId} order ${orderId}`
      );
      return true;
    }

    // When DB record already exists (e.g. order cancel time in transaction),
    // compute unread count, sync cache, and dispatch Socket.IO + Background Push Notification
    let unreadCount = 0;
    try {
      unreadCount = await notificationDao.getUnreadCountDao(targetUserId);
      const notificationCache = require("./notification-cache");
      notificationCache.setUnreadCount(targetUserId, unreadCount);
    } catch (countErr) {
      console.warn("⚠️ [Polygon Notification] Error fetching unread count:", countErr.message);
    }

    const payload = {
      id: Date.now(),
      orderId: orderId,
      processOrderId: orderId,
      title: effectiveTitle,
      message: effectiveBody,
      unreadCount,
      createdAt: new Date().toISOString(),
      invNo: invNoDisplay,
      orderStatus: data?.orderStatus || "Cancelled",
      eventType: eventType,
      data: {
        ...data,
        orderId: orderId,
        processOrderId: orderId,
        invNo: invNoDisplay,
        orderStatus: data?.orderStatus || "Cancelled",
        eventType: eventType,
      },
    };

    // 1. Emit Socket.IO event to active frontend sessions
    try {
      const { emitNotificationToUser, emitUnreadCountToUser } = require("../socket/socket");
      emitNotificationToUser(targetUserId, payload);
      emitUnreadCountToUser(targetUserId, unreadCount);
    } catch (sockErr) {
      console.warn("⚠️ [Polygon Notification] Socket emit warning:", sockErr.message);
    }

    // 2. Dispatch remote Background Push Notification (FCM / Expo)
    try {
      const { sendPushToUser } = require("./pushNotificationService");
      const pushRes = await sendPushToUser(targetUserId, {
        title: effectiveTitle,
        body: effectiveBody,
        data: payload,
      });
      console.log(
        `📢 [Polygon Push/Socket] Dispatched background notification "${effectiveTitle}" to Customer User ${targetUserId} for order ${orderId} (${pushRes?.count || 0} device(s) targeted)`
      );
    } catch (pushErr) {
      console.warn("⚠️ [Polygon Notification] Push notification warning:", pushErr.message);
    }

    return true;
  } catch (err) {
    console.error("❌ [Polygon Notification] Error dispatching notification to Polygon app:", err.message);
    return false;
  }
};

/**
 * Order cancelled notification to Polygon Customer App (Background Push + Socket.IO)
 */
const notifyPolygonOrderCancelled = async (processOrderId, invNo, userId = null) => {
  const invNoDisplay = invNo || (processOrderId ? `ORD-${processOrderId}` : "");
  return triggerPolygonNotification({
    orderId: processOrderId,
    userId,
    title: "Order Cancelled",
    message: `Your order #${invNoDisplay} has been cancelled successfully.`,
    eventType: "order_cancelled",
    data: {
      orderId: processOrderId,
      processOrderId,
      invNo: invNoDisplay,
      orderStatus: "Cancelled",
      eventType: "order_cancelled",
    },
    skipDbInsert: true,
  });
};

module.exports = {
  triggerPolygonNotification,
  notifyPolygonOrderCancelled,
  resolveCustomerUserId,
};

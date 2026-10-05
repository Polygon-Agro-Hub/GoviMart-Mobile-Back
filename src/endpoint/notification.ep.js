const asyncHandler = require("express-async-handler");
const notificationDao = require("../dao/notification.dao");
const notificationCache = require("../services/notification-cache");

/**
 * GET /polygon/api/notification/
 * Fetch user notifications and unread count with in-memory caching.
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const buyerType = req.user.buyerType || "Retail";
  const { limit = 50, offset = 0 } = req.query;

  // Check in-memory node-cache first
  let cachedCount = notificationCache.getUnreadCount(userId);

  const notificationsPromise = notificationDao.getUserNotificationsDao(userId, limit, offset, buyerType);
  const unreadPromise =
    cachedCount !== null
      ? Promise.resolve(cachedCount)
      : notificationDao.getUnreadCountDao(userId, buyerType);

  const [notifications, unreadCount] = await Promise.all([
    notificationsPromise,
    unreadPromise,
  ]);

  if (cachedCount === null) {
    notificationCache.setUnreadCount(userId, unreadCount);
  }

  return res.status(200).json({
    status: true,
    notifications,
    unreadCount,
  });
});

/**
 * PATCH /polygon/api/notification/:id/read
 * Mark a single notification as read and update cache.
 */
exports.markAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const success = await notificationDao.markAsReadDao(id, userId);
  if (success) {
    notificationCache.decrementUnreadCount(userId);
  }

  return res.status(200).json({
    status: true,
    message: success ? "Notification marked as read" : "Notification already read or not found",
  });
});

/**
 * PUT /polygon/api/notification/read-all
 * Mark all notifications as read for current user and reset cache.
 */
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const affected = await notificationDao.markAllAsReadDao(userId);
  notificationCache.setUnreadCount(userId, 0);

  return res.status(200).json({
    status: true,
    message: "All notifications marked as read",
    affected,
  });
});

/**
 * POST /polygon/api/notification/seed-dummy
 * Seed dummy notifications for testing.
 */
exports.seedDummyNotifications = asyncHandler(async (req, res) => {
  const userId = req.body?.userId || req.user?.id || 383;

  const result = await notificationDao.seedDummyNotificationsForUserDao(userId);

  return res.status(200).json({
    status: true,
    message: "14 dummy notification types seeded successfully for user " + userId,
    result,
  });
});

/**
 * POST /polygon/api/notification/save-push-token
 * Save user device push token (FCM or Expo) matching Codi Net pattern.
 */
exports.savePushToken = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { pushToken, deviceType = "android" } = req.body;

  if (!pushToken) {
    return res.status(400).json({
      status: false,
      message: "pushToken is required",
    });
  }

  const pushNotificationService = require("../services/pushNotificationService");
  await pushNotificationService.saveUserPushToken(userId, pushToken, deviceType);

  return res.status(200).json({
    status: true,
    message: "Push token registered successfully",
  });
});

/**
 * POST /polygon/api/notification/trigger
 * External Webhook to trigger real-time notifications to GoviMart Customers
 * from Admin Panel, Govi Transport, PayHere, or internal background services.
 * 
 * Delivers via WebSocket (0 polling) and Firebase/Expo Push.
 */
exports.triggerNotification = asyncHandler(async (req, res) => {
  const serviceToken =
    req.headers["x-service-token"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
    req.body?.serviceToken;

  if (process.env.POLYGON_TRIGGER_SECRET && serviceToken && serviceToken !== process.env.POLYGON_TRIGGER_SECRET) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized: Invalid service token for notification trigger",
    });
  }

  const { orderId, title, message, eventType, data, skipDbInsert } = req.body || {};
  let targetUserId = req.body.userId;

  let resolvedDetails = null;
  let effectiveProcessOrderId = null;

  if (orderId) {
    resolvedDetails = await notificationDao.resolveOrderCustomerDetailsDao(orderId);
    if (resolvedDetails) {
      if (targetUserId && Number(resolvedDetails.userId) !== Number(targetUserId)) {
        console.warn(`[Notification Trigger] Provided orderId ${orderId} belongs to user ${resolvedDetails.userId}, but target is user ${targetUserId}. Discarding mismatched orderId.`);
        resolvedDetails = null;
        effectiveProcessOrderId = null;
      } else {
        if (!targetUserId && resolvedDetails.userId) {
          targetUserId = resolvedDetails.userId;
        }
        effectiveProcessOrderId = resolvedDetails.processOrderId;
      }
    }
  }

  // If no effective process order yet for targetUserId, auto-resolve targetUserId's latest process order
  if (!effectiveProcessOrderId && targetUserId) {
    const userOrder = await notificationDao.getLatestProcessOrderForUserDao(targetUserId);
    if (userOrder) {
      resolvedDetails = userOrder;
      effectiveProcessOrderId = userOrder.processOrderId;
    }
  }

  if (!targetUserId) {
    return res.status(400).json({
      status: false,
      message: "Could not resolve userId. Please provide userId or a valid orderId.",
    });
  }

  const effectiveTitle =
    title || (eventType ? eventType.replace(/_/g, " ").toUpperCase() : "New Notification");
  const effectiveBody =
    message || (resolvedDetails?.invNo ? `Order #${resolvedDetails.invNo} update` : effectiveTitle);

  let notifResult = null;
  if (skipDbInsert) {
    // When the caller (e.g. Govi Transport) already inserted into ordernotfication,
    // only emit Socket.IO events and FCM push to avoid duplicate DB rows.
    const unreadCount = await notificationDao.getUnreadCountDao(targetUserId);
    notificationCache.setUnreadCount(targetUserId, unreadCount);

    const { emitNotificationToUser, emitUnreadCountToUser } = require("../socket/socket");
    const payload = {
      id: Date.now(),
      orderId: effectiveProcessOrderId,
      title: effectiveTitle,
      message: effectiveBody,
      unreadCount,
      createdAt: new Date().toISOString(),
      invNo: resolvedDetails?.invNo,
      data: data || {},
    };
    emitNotificationToUser(targetUserId, payload);
    emitUnreadCountToUser(targetUserId, unreadCount);

    const { sendPushToUser } = require("../services/pushNotificationService");
    sendPushToUser(targetUserId, {
      title: effectiveTitle,
      body: effectiveBody,
      data: payload,
    }).catch(() => {});

    notifResult = payload;
  } else if (effectiveProcessOrderId) {
    // Inserts into ordernotfication, computes unreadCount, emits new_notification + newNotification + notification_unread_count, and sends FCM push
    notifResult = await notificationDao.createNotificationDao({
      orderId: effectiveProcessOrderId,
      title: effectiveTitle,
      message: effectiveBody,
    });
  } else {
    // General / direct notification not linked to a specific order
    const unreadCount = await notificationDao.getUnreadCountDao(targetUserId);
    const newCount = unreadCount + 1;
    notificationCache.setUnreadCount(targetUserId, newCount);

    const { emitNotificationToUser, emitUnreadCountToUser } = require("../socket/socket");
    const payload = {
      id: Date.now(),
      title: effectiveTitle,
      message: effectiveBody,
      unreadCount: newCount,
      createdAt: new Date().toISOString(),
      data: data || {},
    };
    emitNotificationToUser(targetUserId, payload);
    emitUnreadCountToUser(targetUserId, newCount);

    const { sendPushToUser } = require("../services/pushNotificationService");
    sendPushToUser(targetUserId, {
      title: effectiveTitle,
      body: effectiveBody,
      data: payload,
    }).catch(() => {});

    notifResult = payload;
  }

  return res.status(200).json({
    status: true,
    message: `Notification dispatched to User ${targetUserId}`,
    data: {
      userId: targetUserId,
      socketDelivered: true,
      notification: notifResult,
    },
  });
});

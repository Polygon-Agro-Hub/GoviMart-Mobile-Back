const asyncHandler = require("express-async-handler");
const notificationDao = require("../dao/notification.dao");

/**
 * GET /polygon/api/notification/
 * Fetch user notifications and unread count.
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { limit = 50, offset = 0 } = req.query;

  const [notifications, unreadCount] = await Promise.all([
    notificationDao.getUserNotificationsDao(userId, limit, offset),
    notificationDao.getUnreadCountDao(userId),
  ]);

  return res.status(200).json({
    status: true,
    notifications,
    unreadCount,
  });
});

/**
 * PATCH /polygon/api/notification/:id/read
 * Mark a single notification as read.
 */
exports.markAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const success = await notificationDao.markAsReadDao(id, userId);

  return res.status(200).json({
    status: true,
    message: success ? "Notification marked as read" : "Notification already read or not found",
  });
});

/**
 * PUT /polygon/api/notification/read-all
 * Mark all notifications as read for current user.
 */
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const affected = await notificationDao.markAllAsReadDao(userId);

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

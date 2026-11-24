const cache = require("../cache/cache");

const UNREAD_PREFIX = "govimart_unread_";

/**
 * Get cached unread notification count for a user.
 */
function getUnreadCount(userId) {
  if (!userId) return null;
  const count = cache.get(`${UNREAD_PREFIX}${userId}`);
  return typeof count === "number" ? count : null;
}

/**
 * Set unread notification count in cache for a user.
 */
function setUnreadCount(userId, count) {
  if (!userId) return;
  const safeCount = Math.max(0, parseInt(count, 10) || 0);
  cache.set(`${UNREAD_PREFIX}${userId}`, safeCount);
}

/**
 * Increment unread count by 1 in cache (when a new notification arrives).
 */
function incrementUnreadCount(userId) {
  if (!userId) return 1;
  const current = getUnreadCount(userId);
  const updated = current !== null ? current + 1 : 1;
  setUnreadCount(userId, updated);
  return updated;
}

/**
 * Decrement unread count by 1 in cache (when a notification is marked read).
 */
function decrementUnreadCount(userId) {
  if (!userId) return 0;
  const current = getUnreadCount(userId);
  if (current !== null) {
    const updated = Math.max(0, current - 1);
    setUnreadCount(userId, updated);
    return updated;
  }
  return 0;
}

/**
 * Invalidate cached unread count for a user.
 */
function invalidateUnreadCount(userId) {
  if (!userId) return;
  cache.del(`${UNREAD_PREFIX}${userId}`);
}

module.exports = {
  getUnreadCount,
  setUnreadCount,
  incrementUnreadCount,
  decrementUnreadCount,
  invalidateUnreadCount,
};

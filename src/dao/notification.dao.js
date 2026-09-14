const db = require("../startup/database");
const { emitNotificationToUser } = require("../socket/socket");

/**
 * Fetch all notifications for a given user.
 */
exports.getUserNotificationsDao = (userId, limit = 50, offset = 0) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        n.id,
        n.orderId AS processOrderId,
        n.Title AS title,
        n.message,
        n.isRead,
        n.createdAt,
        po.invNo,
        po.orderId,
        po.amount,
        po.sheduleDate,
        po.status AS orderStatus,
        o.delivaryMethod
      FROM ordernotfication n
      JOIN processorders po ON n.orderId = po.id
      JOIN orders o ON po.orderId = o.id
      WHERE o.userId = ?
      ORDER BY n.createdAt DESC, n.id DESC
      LIMIT ? OFFSET ?
    `;

    db.collectionofficer.query(sql, [userId, Number(limit), Number(offset)], (err, results) => {
      if (err) {
        console.error("Error fetching user notifications:", err);
        return reject(err);
      }
      resolve(results || []);
    });
  });
};

/**
 * Count unread notifications for a user.
 */
exports.getUnreadCountDao = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT COUNT(*) AS unreadCount
      FROM ordernotfication n
      JOIN processorders po ON n.orderId = po.id
      JOIN orders o ON po.orderId = o.id
      WHERE o.userId = ? AND n.isRead = 0
    `;

    db.collectionofficer.query(sql, [userId], (err, results) => {
      if (err) {
        console.error("Error fetching unread count:", err);
        return reject(err);
      }
      resolve(results[0]?.unreadCount || 0);
    });
  });
};

/**
 * Mark a single notification as read.
 */
exports.markAsReadDao = (notificationId, userId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE ordernotfication n
      JOIN processorders po ON n.orderId = po.id
      JOIN orders o ON po.orderId = o.id
      SET n.isRead = 1
      WHERE n.id = ? AND o.userId = ?
    `;

    db.collectionofficer.query(sql, [notificationId, userId], (err, result) => {
      if (err) {
        console.error("Error marking notification as read:", err);
        return reject(err);
      }
      resolve(result.affectedRows > 0);
    });
  });
};

/**
 * Mark all notifications as read for a user.
 */
exports.markAllAsReadDao = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE ordernotfication n
      JOIN processorders po ON n.orderId = po.id
      JOIN orders o ON po.orderId = o.id
      SET n.isRead = 1
      WHERE o.userId = ? AND n.isRead = 0
    `;

    db.collectionofficer.query(sql, [userId], (err, result) => {
      if (err) {
        console.error("Error marking all notifications as read:", err);
        return reject(err);
      }
      resolve(result.affectedRows);
    });
  });
};

/**
 * Create a new notification in DB and emit via Socket.IO.
 */
exports.createNotificationDao = ({ orderId, title, message }) => {
  return new Promise((resolve, reject) => {
    const insertSql = `
      INSERT INTO ordernotfication (orderId, Title, message, isRead)
      VALUES (?, ?, ?, 0)
    `;

    db.collectionofficer.query(insertSql, [orderId, title, message], (err, result) => {
      if (err) {
        console.error("Error creating notification:", err);
        return reject(err);
      }

      const newId = result.insertId;

      // Query complete notification with order details to emit via socket
      const fetchSql = `
        SELECT 
          n.id,
          n.orderId AS processOrderId,
          n.Title AS title,
          n.message,
          n.isRead,
          n.createdAt,
          po.invNo,
          po.orderId,
          po.amount,
          po.sheduleDate,
          po.status AS orderStatus,
          o.userId,
          o.delivaryMethod
        FROM ordernotfication n
        JOIN processorders po ON n.orderId = po.id
        JOIN orders o ON po.orderId = o.id
        WHERE n.id = ?
      `;

      db.collectionofficer.query(fetchSql, [newId], (err2, rows) => {
        if (err2 || !rows.length) {
          return resolve({ id: newId, orderId, title, message, isRead: 0 });
        }

        const notifData = rows[0];
        // Emit in real-time via Socket.IO
        if (notifData.userId) {
          emitNotificationToUser(notifData.userId, notifData);
        }

        resolve(notifData);
      });
    });
  });
};

/**
 * Seed all 14 dummy notification types for a specific user (e.g. user 383)
 */
exports.seedDummyNotificationsForUserDao = (userId) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Find latest processorders for this user
      const findProcOrdersSql = `
        SELECT po.id AS proOrderId, po.invNo, po.sheduleDate, po.amount
        FROM processorders po
        JOIN orders o ON po.orderId = o.id
        WHERE o.userId = ?
        ORDER BY po.id DESC
        LIMIT 10
      `;

      db.collectionofficer.query(findProcOrdersSql, [userId], (err, rows) => {
        if (err) return reject(err);

        let defaultProOrderId = 3805;
        let defaultInvNo = "2609030012";

        if (rows && rows.length > 0) {
          defaultProOrderId = rows[0].proOrderId;
          defaultInvNo = rows[0].invNo || "2609030012";
        }

        const dummyTemplates = [
          {
            title: "Package Finalization Review",
            message: `Please review and finalize your package in #${defaultInvNo} to proceed the order.`,
            minutesAgo: 15,
            isRead: 0,
          },
          {
            title: "Order is Processing",
            message: `Your order #${defaultInvNo}, scheduled for August 8, is now being processed. We’ll keep you informed with further updates.`,
            minutesAgo: 60,
            isRead: 0,
          },
          {
            title: "Order is Out for Delivery",
            message: `Your order #${defaultInvNo}, scheduled for August 8, is now out for delivery. One of our drivers will be assigned to deliver your order shortly.`,
            minutesAgo: 180,
            isRead: 0,
          },
          {
            title: "Payment Reminder !!!",
            message: `Order #${defaultInvNo} – Rs. 1,000.00, scheduled for September 3. Please pay via online banking before September 1 at 6:00 PM to avoid cancellation.`,
            minutesAgo: 360,
            isRead: 0,
          },
          {
            title: "Order is Ready to Pickup",
            message: `Your order #${defaultInvNo}, scheduled for August 8, is now ready to pickup. Please visit our centre before 9:00 PM today to collect your order.`,
            minutesAgo: 720,
            isRead: 1,
          },
          {
            title: "Order Picked up",
            message: `Your order #${defaultInvNo}, has been successfully picked up. We hope you had a great experience with our service.`,
            minutesAgo: 1440, // 1 day ago
            isRead: 1,
          },
          {
            title: "Order Collected by Driver",
            message: `Your order #${defaultInvNo}, has been collected by our driver.`,
            minutesAgo: 1600,
            isRead: 1,
          },
          {
            title: "Order is On the Way",
            message: `Your order #${defaultInvNo}, is on its way to you. Our driver will deliver your order shortly.`,
            minutesAgo: 1800,
            isRead: 0,
          },
          {
            title: "Order Delivered",
            message: `Your order #${defaultInvNo}, has been successfully delivered. We hope you’re happy with our service and had a great experience. Thank you for choosing us!`,
            minutesAgo: 2880, // 2 days ago
            isRead: 1,
          },
          {
            title: "Order On Hold",
            message: `Your order #${defaultInvNo}, is currently on hold. Reason : “Customer didn’t answered the call.”`,
            minutesAgo: 4320, // 3 days ago
            isRead: 0,
          },
          {
            title: "Order is On the Way Again",
            message: `Your order #${defaultInvNo}, is back on the way to you. Our driver will deliver your order shortly.`,
            minutesAgo: 5000,
            isRead: 1,
          },
          {
            title: "Order Returned",
            message: `Your order #${defaultInvNo}, has been returned. Reason : “The customer didn’t answered the call.”`,
            minutesAgo: 6000,
            isRead: 1,
          },
          {
            title: "Order Cancelled",
            message: `Your order #${defaultInvNo}, has been cancelled.`,
            minutesAgo: 7200,
            isRead: 1,
          },
          {
            title: "Order Cancelled",
            message: `Your order #${defaultInvNo}, has been cancelled. Reason : “The customer did not respond to the package review confirmation within the required time.” If you have already made a payment for this order, the total amount will be added to your credit balance. You can use this credit toward your next order.`,
            minutesAgo: 8640,
            isRead: 1,
          },
        ];

        // Insert each dummy template with timestamp
        const insertPromises = dummyTemplates.map((item, idx) => {
          return new Promise((res, rej) => {
            const createdAt = new Date(Date.now() - item.minutesAgo * 60 * 1000);
            const sql = `
              INSERT INTO ordernotfication (orderId, Title, message, isRead, createdAt)
              VALUES (?, ?, ?, ?, ?)
            `;
            db.collectionofficer.query(
              sql,
              [defaultProOrderId, item.title, item.message, item.isRead, createdAt],
              (insErr, r) => {
                if (insErr) return rej(insErr);
                res(r.insertId);
              }
            );
          });
        });

        Promise.all(insertPromises)
          .then((ids) => resolve({ count: ids.length, ids }))
          .catch(reject);
      });
    } catch (e) {
      reject(e);
    }
  });
};

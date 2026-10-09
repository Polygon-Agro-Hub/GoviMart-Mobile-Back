const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    },
    // polling first so Vercel Fluid compute handles the initial handshake,
    // then upgrades to websocket when available — exactly like Sales Dash
    transports: ["polling", "websocket"],
  });

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
        socket.handshake.query?.token;

      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          socket.userId = decoded.id;
          socket.user = decoded;
        } catch (jwtErr) {
          console.warn("[Socket] Token verification failed:", jwtErr.message);
        }
      }
      return next();
    } catch (err) {
      console.error("[Socket] Auth middleware error:", err);
      return next();
    }
  });

  io.on("connection", (socket) => {
    console.log(`🔌 [Socket] Client connected: ${socket.id}, userId: ${socket.userId || "anonymous"}`);

    if (socket.userId) {
      socket.join(`user_${socket.userId}`);
      console.log(`👤 [Socket] Socket ${socket.id} joined room user_${socket.userId}`);
    }

    socket.on("register_user", (data) => {
      let targetUserId = null;
      let token = null;

      if (typeof data === "object" && data !== null) {
        targetUserId = data.userId;
        token = data.token;
      } else {
        targetUserId = data;
      }

      if (!targetUserId) return;

      // If socket already authenticated via handshake token
      if (socket.userId) {
        if (String(socket.userId) === String(targetUserId)) {
          socket.join(`user_${targetUserId}`);
          console.log(`👤 [Socket] Verified socket ${socket.id} joined room user_${targetUserId}`);
        } else {
          console.warn(`⚠️ [Socket Security] Blocked room hijacking: socket ${socket.id} (user ${socket.userId}) attempted to join user_${targetUserId}`);
        }
        return;
      }

      // If token provided in register_user payload, verify it
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (String(decoded.id) === String(targetUserId)) {
            socket.userId = decoded.id;
            socket.user = decoded;
            socket.join(`user_${targetUserId}`);
            console.log(`👤 [Socket] Socket ${socket.id} verified via payload token and joined room user_${targetUserId}`);
            return;
          } else {
            console.warn(`⚠️ [Socket Security] Token userId (${decoded.id}) does not match target (${targetUserId})`);
            return;
          }
        } catch (tokenErr) {
          console.warn("[Socket Security] Token verification failed on register_user:", tokenErr.message);
          return;
        }
      }

      console.warn(`⚠️ [Socket Security] Blocked unauthenticated register_user attempt for user_${targetUserId} from socket ${socket.id}`);
    });

    socket.on("send_test_notification", (data) => {
      if (data && data.userId && data.notification) {
        emitNotificationToUser(data.userId, data.notification);
      }
    });

    socket.on("catalog_update", (data) => {
      emitCatalogUpdate(data);
    });

    socket.on("product_update", (data) => {
      emitCatalogUpdate(data);
    });

    socket.on("package_update", (data) => {
      emitCatalogUpdate(data);
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔌 [Socket] Client disconnected: ${socket.id}, reason: ${reason}`);
    });
  });

  // Start real-time DB change watcher to detect changes made directly in DB (e.g. via Admin Panel)
  startDbChangeWatcher();

  return io;
};

const getIO = () => {
  return io;
};

const emitNotificationToUser = (userId, notification) => {
  if (!io) {
    console.warn("[Socket] IO not initialized, cannot emit notification");
    return false;
  }

  const room = `user_${userId}`;
  io.to(room).emit("new_notification", notification);
  io.to(room).emit("newNotification", notification);
  console.log(`📢 [Socket] Emitted new_notification to ${room}:`, notification?.title || notification?.id);
  return true;
};

const emitCatalogUpdate = (data) => {
  if (!io) {
    console.warn("[Socket] IO not initialized, cannot emit catalog update");
    return false;
  }

  io.emit("catalog_updated", data || {});
  io.emit("products_updated", data || {});
  io.emit("packages_updated", data || {});
  console.log("📦 [Socket] Broadcasted catalog_updated / products_updated / packages_updated to all clients");
  return true;
};

const emitUnreadCountToUser = (userId, unreadCount) => {
  if (!io) {
    console.warn("[Socket] IO not initialized, cannot emit unread count");
    return false;
  }

  const room = `user_${userId}`;
  io.to(room).emit("notification_unread_count", { unreadCount: Number(unreadCount) || 0 });
  console.log(`🔢 [Socket] Emitted notification_unread_count (${unreadCount}) to ${room}`);
  return true;
};

/**
 * Broadcasts real-time packing target slots and accepted orders count to all connected clients.
 * Called whenever an order is created, cancelled, or modified (from GoviMart, Sales Dash, or DB watcher).
 */
const emitPackingSlotsUpdate = async (scheduleDate = null) => {
  if (!io) {
    console.warn("[Socket] IO not initialized, cannot emit packing slots update");
    return false;
  }

  try {
    const packageReviewDao = require("../dao/package-review.dao");
    const slotData = await packageReviewDao.getPackingSlotAvailabilityDao(scheduleDate);

    io.emit("packing_slots_updated", slotData);
    io.emit("order_count_updated", slotData);
    console.log(
      `📦 [Socket] Broadcasted packing_slots_updated: Date=${slotData.scheduleDate}, Accepted=${slotData.acceptedOrdersCount}, Available=${slotData.availableSlots}, Limit=${slotData.targetLimit}`
    );
    return true;
  } catch (err) {
    console.error("[Socket] Failed to emit packing slots update:", err);
    return false;
  }
};

let dbWatcherInterval = null;
let lastHashes = {
  itemHash: null,
  pkgHash: null,
  pkgDetailHash: null,
  processOrderHash: null,
};

/**
 * Periodically polls a fast (<5ms) checksum query to detect DB changes
 * made by external tools/admin panels/Sales Dash and immediately notifies mobile apps via Socket.IO.
 */
const startDbChangeWatcher = (pollIntervalMs = 10000) => {
  if (dbWatcherInterval) return;

  const db = require("../startup/database");
  const checkQuery = `
    SELECT 
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, isEnable, displayName, category, normalPrice, discountedPrice))), 0) FROM marketplaceitems) as itemHash,
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, displayName, status, isValid, productPrice, packingFee, serviceFee))), 0) FROM marketplacepackages) as pkgHash,
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, packageId, qty, productTypeId))), 0) FROM packagedetails) as pkgDetailHash,
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, status, DATE(sheduleDate)))), 0) FROM processorders WHERE (status IS NULL OR status NOT IN ('Cancelled', 'Return', 'Return Received'))) as processOrderHash
  `;

  let isChecking = false;

  dbWatcherInterval = setInterval(() => {
    if (isChecking) return;
    if (!io) return;

    // Check if any client is actually connected
    const connectedClients = io.engine?.clientsCount || io.sockets?.sockets?.size || 0;
    if (connectedClients === 0) {
      // No active mobile clients connected -> skip DB query completely
      return;
    }

    isChecking = true;
    db.collectionofficer.query(checkQuery, (err, rows) => {
      isChecking = false;
      if (err) {
        return;
      }

      if (!rows || rows.length === 0) return;
      const current = rows[0];

      // Initial baseline
      if (lastHashes.itemHash === null) {
        lastHashes = {
          itemHash: String(current.itemHash),
          pkgHash: String(current.pkgHash),
          pkgDetailHash: String(current.pkgDetailHash),
          processOrderHash: String(current.processOrderHash),
        };
        return;
      }

      // Check product changes (added, enabled, disabled, edited)
      if (String(current.itemHash) !== lastHashes.itemHash) {
        console.log("⚡ [DB Watcher] Product change detected in DB -> emitting products_updated");
        lastHashes.itemHash = String(current.itemHash);
        emitCatalogUpdate({ type: "product", source: "db_change" });
      }

      // Check package changes (added, enabled, disabled, edited)
      if (
        String(current.pkgHash) !== lastHashes.pkgHash ||
        String(current.pkgDetailHash) !== lastHashes.pkgDetailHash
      ) {
        console.log("⚡ [DB Watcher] Package change detected in DB -> emitting packages_updated");
        lastHashes.pkgHash = String(current.pkgHash);
        lastHashes.pkgDetailHash = String(current.pkgDetailHash);
        emitCatalogUpdate({ type: "package", source: "db_change" });
      }

      // Check process orders changes (new order placed, status changed, date changed, cancelled)
      if (String(current.processOrderHash) !== lastHashes.processOrderHash) {
        console.log("⚡ [DB Watcher] Process order change detected in DB -> emitting packing_slots_updated");
        lastHashes.processOrderHash = String(current.processOrderHash);
        emitPackingSlotsUpdate();
      }
    });
  }, pollIntervalMs);

  if (dbWatcherInterval.unref) {
    dbWatcherInterval.unref();
  }
};

module.exports = {
  initSocket,
  getIO,
  emitNotificationToUser,
  emitUnreadCountToUser,
  emitCatalogUpdate,
  emitProductUpdate: emitCatalogUpdate,
  emitPackageUpdate: emitCatalogUpdate,
  emitPackingSlotsUpdate,
  startDbChangeWatcher,
};
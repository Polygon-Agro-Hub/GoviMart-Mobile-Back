const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    allowEIO3: true,
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

    socket.on("get_cities_availability", async () => {
      try {
        const authDao = require("../dao/auth.dao");
        const cities = await authDao.getAllCitiesDao();
        socket.emit("city_availability_updated", cities);
      } catch (err) {
        console.error("[Socket] Error fetching cities for socket client:", err);
      }
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

    socket.on("banner_update", (data) => {
      emitBannerUpdate(data);
    });

    socket.on("banners_update", (data) => {
      emitBannerUpdate(data);
    });

    socket.on("banner_position_update", (data) => {
      emitBannerUpdate(data);
    });

    socket.on("slide_update", (data) => {
      emitBannerUpdate(data);
    });

    socket.on("slides_update", (data) => {
      emitBannerUpdate(data);
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
  console.log(`📢 [Socket] Emitted new_notification to ${room}:`, notification?.title || notification?.id);
  return true;
};

const emitCityAvailabilityUpdate = (citiesData) => {
  if (!io) {
    console.warn("[Socket] IO not initialized, cannot emit city update");
    return false;
  }

  io.emit("city_availability_updated", citiesData);
  console.log(`🌍 [Socket] Broadcasted city_availability_updated to all clients (${Array.isArray(citiesData) ? citiesData.length : 1} items)`);
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

const emitBannerUpdate = (data) => {
  if (!io) {
    console.warn("[Socket] IO not initialized, cannot emit banner update");
    return false;
  }

  io.emit("banners_updated", data || {});
  io.emit("banner_updated", data || {});
  io.emit("slides_updated", data || {});
  io.emit("banner_position_updated", data || {});
  console.log("🎨 [Socket] Broadcasted banners_updated / slides_updated to all clients");
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

let dbWatcherInterval = null;
let lastHashes = {
  itemHash: null,
  pkgHash: null,
  bannerHash: null,
  pkgDetailHash: null,
};

/**
 * Periodically polls a fast (<5ms) checksum query to detect DB changes
 * made by external tools/admin panels and immediately notifies mobile apps via Socket.IO.
 */
const startDbChangeWatcher = (pollIntervalMs = 2500) => {
  if (dbWatcherInterval) return;

  const db = require("../startup/database");
  const checkQuery = `
    SELECT 
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, isEnable, displayName, category, normalPrice, discountedPrice))), 0) FROM marketplaceitems) as itemHash,
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, displayName, status, isValid, productPrice, packingFee, serviceFee))), 0) FROM marketplacepackages) as pkgHash,
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, indexId, details, image, type))), 0) FROM banners) as bannerHash,
      (SELECT COALESCE(BIT_XOR(CRC32(CONCAT_WS(':', id, packageId, qty, productTypeId))), 0) FROM packagedetails) as pkgDetailHash
  `;

  let isChecking = false;

  dbWatcherInterval = setInterval(() => {
    if (isChecking) return;
    if (!io) return;

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
          bannerHash: String(current.bannerHash),
          pkgDetailHash: String(current.pkgDetailHash),
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

      // Check banner changes (position/indexId changed, added, edited, deleted)
      if (String(current.bannerHash) !== lastHashes.bannerHash) {
        console.log("⚡ [DB Watcher] Banner change detected in DB -> emitting banners_updated");
        lastHashes.bannerHash = String(current.bannerHash);
        emitBannerUpdate({ type: "banner", source: "db_change" });
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
  emitCityAvailabilityUpdate,
  emitCatalogUpdate,
  emitProductUpdate: emitCatalogUpdate,
  emitPackageUpdate: emitCatalogUpdate,
  emitBannerUpdate,
  startDbChangeWatcher,
};
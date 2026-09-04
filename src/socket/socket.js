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

    socket.on("register_user", (userId) => {
      if (userId) {
        socket.userId = userId;
        socket.join(`user_${userId}`);
        console.log(`👤 [Socket] Socket ${socket.id} manually joined room user_${userId}`);
      }
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

    socket.on("disconnect", (reason) => {
      console.log(`🔌 [Socket] Client disconnected: ${socket.id}, reason: ${reason}`);
    });
  });

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

module.exports = {
  initSocket,
  getIO,
  emitNotificationToUser,
  emitCityAvailabilityUpdate,
};
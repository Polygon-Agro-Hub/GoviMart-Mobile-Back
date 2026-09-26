const express = require("express");
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const compression = require("compression");
require("dotenv").config();

const {
  plantcare,
  collectionofficer,
  admin,
} = require("./src/startup/database");

const app = express();
app.use(compression());

const BASE_PATH = "/polygon";

const corsOptions = {
  origin: process.env.CLIENT_ORIGIN || "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With", "Origin"],
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// Function to check database connection
const DatabaseConnection = (db, name) => {
  db.getConnection((err, connection) => {
    if (err) {
      console.error(`Error getting connection from ${name}:`, err);
    } else {
      connection.ping((err) => {
        if (err) {
          console.error(`Error pinging ${name} database:`, err);
        } else {
          console.log(`✅ Ping to ${name} database successful.`);
        }
        connection.release();
      });
    }
  });
};

// Initial database connections
DatabaseConnection(plantcare, "PlantCare");
DatabaseConnection(collectionofficer, "CollectionOfficer");
DatabaseConnection(admin, "Admin");

// Setup routes
const http = require("http");
const { initSocket } = require("./src/socket/socket");

const userroute = require("./src/routes/auth.routes");
const healthroute = require("./src/routes/health.routes");
const customerroute = require("./src/routes/customer.routes");
const homeroute = require("./src/routes/home.routes");
const complaintroute = require("./src/routes/complaint.routes");
const productroute = require("./src/routes/product.routes");
const orderroute = require("./src/routes/order.routes");
const cartroute = require("./src/routes/cart.routes");
const paymentroute = require("./src/routes/payment.routes");
const notificationroute = require("./src/routes/notification.routes");
const appversionroute = require("./src/routes/app-version.routes");

const registerRoutes = (prefix) => {
  app.use(`${prefix}/api/auth`, userroute);
  app.use(`${prefix}/api/customer`, customerroute);
  app.use(`${prefix}/api/home`, homeroute);
  app.use(`${prefix}/api/complaint`, complaintroute);
  app.use(`${prefix}/api/product`, productroute);
  app.use(`${prefix}/api/order`, orderroute);
  app.use(`${prefix}/api/cart`, cartroute);
  app.use(`${prefix}/api/payment`, paymentroute);
  app.use(`${prefix}/api/notification`, notificationroute);
  app.use(`${prefix}/api/app-version`, appversionroute);
  app.use(`${prefix}`, healthroute);
};

registerRoutes(BASE_PATH);
registerRoutes("");

// Error handling middleware
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  } else {
    console.error(`[Error] ${err.message}`);
  }
  res.status(500).send("Something broke!!");
});

// Create HTTP server & initialize Socket.IO
const server = http.createServer(app);
const io = initSocket(server);

// Attach io instance to express app
app.set("io", io);

// Attach io and app to server instance
server.io = io;
server.app = app;

// Start server
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`📍 Base Path: ${BASE_PATH}`);
    console.log(`💓 Health Check URL: ${BASE_PATH}/health`);
    console.log(`🔌 Socket.IO initialized`);
  });
}

module.exports = server;


const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const {
  plantcare,
  collectionofficer,
  admin,
} = require("./src/startup/database");

const app = express();

const BASE_PATH = "/polygon";

const corsOptions = {
  origin: process.env.CLIENT_ORIGIN || "http://localhost:8081",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
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

app.use(`${BASE_PATH}/api/auth`, userroute);
app.use(`${BASE_PATH}/api/customer`, customerroute);
app.use(`${BASE_PATH}/api/home`, homeroute);
app.use(`${BASE_PATH}/api/complaint`, complaintroute);
app.use(`${BASE_PATH}/api/product`, productroute);
app.use(`${BASE_PATH}/api/order`, orderroute);
app.use(`${BASE_PATH}/api/cart`, cartroute);
app.use(`${BASE_PATH}/api/payment`, paymentroute);
app.use(`${BASE_PATH}/api/notification`, notificationroute);
app.use(`${BASE_PATH}`, healthroute);

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


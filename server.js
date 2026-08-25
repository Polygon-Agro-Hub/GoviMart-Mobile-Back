const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const {
  plantcare,
  collectionofficer,
  marketPlace,
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
DatabaseConnection(marketPlace, "MarketPlace");
DatabaseConnection(admin, "Admin");

// Setup routes
const userroute = require("./src/routes/auth.routes");
const healthroute = require("./src/routes/health.routes");
const customerroute = require("./src/routes/customer.routes");
const homeroute = require("./src/routes/home.routes");
const complaintroute = require("./src/routes/complaint.routes");
const productroute = require("./src/routes/product.routes")
const orderroute = require("./src/routes/order.routes")

app.use(`${BASE_PATH}/api/auth`, userroute);
app.use(`${BASE_PATH}/api/customer`, customerroute);
app.use(`${BASE_PATH}/api/home`, homeroute);
app.use(`${BASE_PATH}/api/complaint`, complaintroute);
app.use(`${BASE_PATH}/api/product`, productroute);
app.use(`${BASE_PATH}/api/order`, orderroute);
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`📍 Base Path: ${BASE_PATH}`);
  console.log(`💓 Health Check URL: ${BASE_PATH}/health`);
});

module.exports = app;

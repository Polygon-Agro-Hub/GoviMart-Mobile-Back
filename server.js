const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();
const {
  plantcare,
  collectionofficer,
  marketPlace,
  admin,
} = require("./startup/database");

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
const userroute = require("./routes/user-auth-routes");
const healthroute = require("./routes/health-routes");
const customerroute = require("./routes/customer-routes");
const homeroute = require("./routes/home-routes");

// Routes
app.use(`${BASE_PATH}/test`, (req, res) => {
  res.send("Server is running!");
});

app.use(`${BASE_PATH}/api/auth`, userroute);
app.use(`${BASE_PATH}/api/customer`, customerroute);
app.use(`${BASE_PATH}/api/home`, homeroute);
app.use(`${BASE_PATH}`, healthroute);


// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
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

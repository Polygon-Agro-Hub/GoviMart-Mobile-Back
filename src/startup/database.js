const mysql = require("mysql2");
require("dotenv").config();

// Store all pools for cleanup
const pools = [];

// Create a MySQL connection pool with tracking
const createPool = (database) => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: database,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "30", 10),
    maxIdle: parseInt(process.env.DB_MAX_IDLE || "15", 10),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  
  // Track the pool for cleanup
  pools.push(pool);
  
  return pool;
};

// Create all database pools
const plantcare = createPool(process.env.DB_NAME_PC);
const collectionofficer = createPool(process.env.DB_NAME_CO || "collection_officer");
const admin = createPool(process.env.DB_NAME_AD);

// Function to close all database connections (useful for tests)
const closeAllPools = async () => {
  const closePromises = pools.map(pool => {
    return new Promise((resolve) => {
      pool.end((err) => {
        if (err) {
          console.error('Error closing database pool:', err);
        }
        resolve();
      });
    });
  });
  
  await Promise.all(closePromises);
  // Clear the pools array
  pools.length = 0;
};

// For testing: close specific pool if needed
const closePool = async (pool) => {
  return new Promise((resolve) => {
    pool.end((err) => {
      if (err) {
        console.error('Error closing pool:', err);
      }
      // Remove from pools array
      const index = pools.indexOf(pool);
      if (index > -1) {
        pools.splice(index, 1);
      }
      resolve();
    });
  });
};

module.exports = { 
  plantcare, 
  collectionofficer, 
  admin,
  closeAllPools,
  closePool
};
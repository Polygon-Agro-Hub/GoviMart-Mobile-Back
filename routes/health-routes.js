const express = require("express");
const router = express.Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - System
 *     summary: System Health Check
 *     description: Retrieve system status, uptime, and timestamp.
 *     responses:
 *       200:
 *         description: System is operational.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "UP"
 *                 timestamp:
 *                   type: string
 *                   example: "2026-07-14T08:45:12.345Z"
 *                 uptime:
 *                   type: number
 *                   example: 15.34
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;

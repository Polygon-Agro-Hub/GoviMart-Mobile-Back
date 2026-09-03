const express = require("express");
const router = express.Router();
const notificationEp = require("../endpoint/notification.ep");
const authMiddleware = require("../middlewares/auth.middleware");

router.get("/", authMiddleware, notificationEp.getNotifications);
router.patch("/:id/read", authMiddleware, notificationEp.markAsRead);
router.put("/read-all", authMiddleware, notificationEp.markAllAsRead);
router.post("/seed-dummy", authMiddleware, notificationEp.seedDummyNotifications);

module.exports = router;

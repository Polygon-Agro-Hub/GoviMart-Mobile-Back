const { collectionofficer } = require("../startup/database");
const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const firebaseConfig = require("../constants/firebase-config");

let firebaseApp = null;
let messaging = null;
let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized) return messaging;

  try {
    if (!firebaseConfig || !firebaseConfig.project_id) {
      console.warn("⚠️ [PushService] Firebase configuration not found in constants/firebase-config");
      return null;
    }

    if (getApps().length === 0) {
      firebaseApp = initializeApp({
        credential: cert(firebaseConfig),
      });
      console.log("🔥 [PushService] Firebase Admin SDK initialized successfully with project:", firebaseConfig.project_id);
    } else {
      firebaseApp = getApps()[0];
    }

    messaging = getMessaging(firebaseApp);
    firebaseInitialized = true;
    return messaging;
  } catch (err) {
    console.error("❌ [PushService] Failed to initialize Firebase Admin SDK:", err.message);
    return null;
  }
}

/**
 * Save or update user push token in notificationpushtoken table
 * Using marketplaceUserId column linked via FK to marketplaceusers(id)
 */
async function saveUserPushToken(userId, pushToken, arg3 = "android", arg4) {
  if (!userId || !pushToken) {
    throw new Error("userId and pushToken are required");
  }

  // Support both (userId, pushToken, deviceType) and legacy (userId, pushToken, tokenType, deviceType)
  let deviceType = "android";
  if (typeof arg4 === "string") {
    deviceType = arg4;
  } else if (typeof arg3 === "string" && (arg3 === "android" || arg3 === "ios")) {
    deviceType = arg3;
  }

  const sql = `
    INSERT INTO notificationpushtoken (marketplaceUserId, pushToken, deviceType, updatedAt)
    VALUES (?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      deviceType = VALUES(deviceType),
      updatedAt = NOW()
  `;

  return new Promise((resolve, reject) => {
    collectionofficer.query(sql, [userId, pushToken, deviceType], (err, result) => {
      if (err) {
        console.error("❌ [PushService] Error saving push token:", err);
        return reject(err);
      }
      console.log(`✅ [PushService] Push token saved for marketplaceUserId: ${userId} (${deviceType})`);
      resolve(result);
    });
  });
}

/**
 * Remove an invalid/expired token from the database
 */
function removeToken(pushToken) {
  const sql = "DELETE FROM notificationpushtoken WHERE pushToken = ?";
  collectionofficer.query(sql, [pushToken], (err) => {
    if (err) console.error("Error removing expired push token:", err);
    else console.log("Removed expired/unregistered push token:", pushToken);
  });
}

/**
 * Send push notification to all active devices of a user
 */
async function sendPushToUser(userId, { title, body, data = {} }) {
  if (!userId) return;

  const getTokensSql = `
    SELECT pushToken, deviceType 
    FROM notificationpushtoken 
    WHERE marketplaceUserId = ?
  `;

  return new Promise((resolve) => {
    collectionofficer.query(getTokensSql, [userId], async (err, rows) => {
      if (err) {
        console.error("❌ [PushService] Error fetching push tokens for user:", err);
        return resolve({ success: false, error: err.message });
      }

      if (!rows || rows.length === 0) {
        console.log(`ℹ️ [PushService] No registered push tokens found for userId: ${userId}`);
        return resolve({ success: true, count: 0 });
      }

      console.log(`📢 [PushService] Found ${rows.length} token(s) for userId: ${userId}. Sending push...`);

      const fbMessaging = initFirebase();
      const stringifiedData = {};
      for (const [key, value] of Object.entries(data)) {
        stringifiedData[key] = typeof value === "string" ? value : JSON.stringify(value);
      }

      const results = [];

      for (const row of rows) {
        const { pushToken, deviceType } = row;
        const isExpo = pushToken.startsWith("ExponentPushToken") || pushToken.startsWith("ExpoPushToken");

        // 1. Expo Push Token handling (auto-detected)
        if (isExpo) {
          try {
            const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip, deflate",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                to: pushToken,
                title: title,
                body: body,
                sound: "default",
                priority: "high",
                channelId: "default",
                _displayInForeground: true,
                data: stringifiedData,
              }),
            });
            const expoResult = await expoResponse.json();
            if (expoResult?.data?.status === "error") {
              console.warn(
                `⚠️ [PushService] Expo Push warning for token ${pushToken.slice(0, 15)}...:`,
                expoResult?.data?.message || expoResult?.data?.details?.error
              );
              if (
                expoResult?.data?.details?.error === "DeviceNotRegistered" ||
                expoResult?.data?.details?.error === "InvalidCredentials"
              ) {
                removeToken(pushToken);
              }
              results.push({ token: pushToken, success: false, error: expoResult?.data?.message });
            } else {
              console.log(`📱 [PushService] Expo Push response for token ${pushToken.slice(0, 15)}...:`, expoResult);
              results.push({ token: pushToken, success: true, type: "expo" });
            }
          } catch (expoErr) {
            console.error("❌ [PushService] Expo push error:", expoErr.message);
            results.push({ token: pushToken, success: false, error: expoErr.message });
          }
          continue;
        }

        // 2. Native FCM Token handling via Firebase Admin
        if (fbMessaging) {
          try {
            const message = {
              token: pushToken,
              notification: {
                title: title,
                body: body,
              },
              data: stringifiedData,
              android: {
                priority: "high",
                notification: {
                  channelId: "default",
                  sound: "default",
                  icon: "notification_icon",
                  color: "#FF8A00",
                  priority: "max",
                  defaultVibrateTimings: true,
                  visibility: "public",
                },
              },
            };

            const response = await fbMessaging.send(message);
            console.log(`🔥 [PushService] FCM message sent successfully! MessageId: ${response}`);
            results.push({ token: pushToken, success: true, messageId: response });
          } catch (fcmErr) {
            console.error("❌ [PushService] FCM send error:", fcmErr.message);
            if (
              fcmErr.code === "messaging/registration-token-not-registered" ||
              fcmErr.code === "messaging/invalid-registration-token" ||
              fcmErr.code === "messaging/mismatched-credential" ||
              fcmErr.message?.includes("SenderId mismatch")
            ) {
              removeToken(pushToken);
            }
            results.push({ token: pushToken, success: false, error: fcmErr.message });
          }
        } else {
          console.warn("⚠️ [PushService] Firebase Messaging not initialized; skipped FCM send for token:", pushToken.slice(0, 15));
        }
      }

      resolve({ success: true, count: results.length, results });
    });
  });
}

module.exports = {
  initFirebase,
  saveUserPushToken,
  sendPushToUser,
};

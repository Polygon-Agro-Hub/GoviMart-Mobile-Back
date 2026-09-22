const jwt = require("jsonwebtoken");

// In-memory blacklist for logged-out tokens (token -> expiration timestamp in ms)
const blacklistedTokens = new Map();

// Clean up expired tokens every 30 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  let count = 0;
  for (const [token, expiresAt] of blacklistedTokens.entries()) {
    if (now >= expiresAt) {
      blacklistedTokens.delete(token);
      count++;
    }
  }
  if (count > 0) {
    console.log(`🧹 Cleaned up ${count} expired blacklisted token(s) from memory.`);
  }
}, 30 * 60 * 1000).unref();

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        status: false,
        message: "No token provided, authorization denied.",
      });
    }

    const token = authHeader.split(" ")[1];

    // Check if token is in blacklist
    if (blacklistedTokens.has(token)) {
      const expiresAt = blacklistedTokens.get(token);
      if (Date.now() < expiresAt) {
        return res.status(401).json({
          status: false,
          message: "Token has expired or is invalid (logged out).",
        });
      } else {
        // Token has naturally expired, remove from blacklist
        blacklistedTokens.delete(token);
        console.log("🧹 Removed naturally expired token from blacklist on request check.");
      }
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add decoded token info to request
    req.user = {
      id: decoded.id,
      userId: decoded.id, // For compatibility with getIncludedSuggestionsItems
      email: decoded.email,
      phoneNumber: decoded.phoneNumber,
      buyerType: decoded.buyerType || "Retail",
    };
    
    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res.status(401).json({
      status: false,
      message: "Token is not valid.",
    });
  }
};

module.exports = authMiddleware;
module.exports.blacklistedTokens = blacklistedTokens;

const loginAttempts = new Map();

/**
 * Rate limiter middleware for login attempts.
 * Limits to 5 attempts per 15 minutes per IP address.
 *
 * Stale entries are cleaned up automatically after each request to prevent
 * unbounded Map growth over time.
 */
const loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes window
  const maxAttempts = 5;

  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, []);
  }

  // Filter out attempts that are older than the window
  const attempts = loginAttempts.get(ip).filter(timestamp => now - timestamp < windowMs);

  if (attempts.length >= maxAttempts) {
    return res.status(429).json({
      success: false,
      status: "error",
      message: "Too many login attempts. Please try again after 15 minutes.",
    });
  }

  // Add the current attempt timestamp
  attempts.push(now);

  // Persist if there are active attempts, otherwise clean up the entry
  if (attempts.length > 0) {
    loginAttempts.set(ip, attempts);
  } else {
    loginAttempts.delete(ip);
  }

  next();
};

module.exports = loginRateLimiter;

const loginAttempts = new Map();

/**
 * Rate limiter middleware for login attempts.
 * Limits to 5 attempts per 15 minutes per IP address.
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
  loginAttempts.set(ip, attempts);

  next();
};

module.exports = loginRateLimiter;

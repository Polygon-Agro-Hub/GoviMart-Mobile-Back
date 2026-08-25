const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        status: false,
        message: "No token provided, authorization denied.",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add decoded token info to request
    req.user = {
      id: decoded.id,
      userId: decoded.id, // For compatibility with getIncludedSuggestionsItems
      email: decoded.email,
      phoneNumber: decoded.phoneNumber,
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

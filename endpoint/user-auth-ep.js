const userDao = require("../dao/user-auth-dao");
const jwt = require("jsonwebtoken");
const { loginSchema } = require("../validations/user-auth-validations");
const asyncHandler = require("express-async-handler");

// Login User
exports.login = asyncHandler(async (req, res) => {
  const { error } = loginSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: error.details.map((err) => err.message),
    });
  }

  const { identifier, password } = req.body;

  try {
    const result = await userDao.loginUser(identifier, password);

    // Define JWT payload
    const payload = {
      id: result.id,
      email: result.email,
      phoneNumber: result.phoneNumber,
      iat: Math.floor(Date.now() / 1000),
    };

    // Create JWT token
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "8h",
    });

    // Send token as HTTP-only cookie
    res.cookie("authToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 8 * 60 * 60 * 1000,
    });

    // Send response with token
    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: result.id,
        token,
        firstName: result.firstName,
        lastName: result.lastName,
        email: result.email,
        phoneNumber: result.phoneNumber,
        image: result.image,
      },
    });
  } catch (err) {
    console.error("Login failed:", err.message);
    return res.status(401).json({ success: false, message: err.message });
  }
});

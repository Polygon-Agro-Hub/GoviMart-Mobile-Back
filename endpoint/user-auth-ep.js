const userDao = require("../dao/user-auth-dao");
const jwt = require("jsonwebtoken");
const { loginSchema, signupSchema } = require("../validations/user-auth-validations");
const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");

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

// Get or Search Cities
exports.getCities = asyncHandler(async (req, res) => {
  const { q } = req.query;

  try {
    let cities;
    if (q && q.trim().length > 0) {
      cities = await userDao.searchCitiesDao(q.trim());
    } else {
      cities = await userDao.getAllCitiesDao();
    }

    return res.status(200).json({
      status: true,
      data: cities,
    });
  } catch (err) {
    console.error("Error in getCities:", err.message);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch cities",
      error: err.message,
    });
  }
});

// Register User
exports.userSignup = asyncHandler(async (req, res) => {
  const { error } = signupSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      status: false,
      message: "Validation error",
      errors: error.details.map((err) => err.message),
    });
  }

  const { email, password } = req.body;

  try {
    // Check if user already exists
    const existingUser = await userDao.getUserByEmailDao(email);
    if (existingUser) {
      return res.status(400).json({
        status: false,
        message: "Email already in use.",
      });
    }

    // Generate hashed password
    const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || "10", 10);
    const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);

    // Generate next MAR-XXXXX customer ID
    const lastId = await userDao.getMarketPlaceUserLastCusIdDao();
    let nextId;
    if (lastId === null || lastId === undefined) {
      nextId = "MAR-00001";
    } else {
      const numericPart = parseInt(lastId.split("-")[1], 10);
      const nextNumber = numericPart + 1;
      nextId = `MAR-${nextNumber.toString().padStart(5, "0")}`;
    }

    // Create user
    const signupResult = await userDao.signupUserDao(req.body, hashedPassword, nextId);

    if (signupResult.status) {
      return res.status(201).json({
        status: true,
        message: signupResult.message,
        data: signupResult.data,
      });
    } else {
      return res.status(500).json({
        status: false,
        message: signupResult.message || "Failed to sign up.",
      });
    }
  } catch (err) {
    console.error("Error during signup:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred during signup.",
      error: err.message,
    });
  }
});

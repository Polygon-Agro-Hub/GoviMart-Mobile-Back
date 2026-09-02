const userDao = require("../dao/auth.dao");
const jwt = require("jsonwebtoken");
const { loginSchema, signupSchema } = require("../validations/auth.validations");
const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

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

    // Create Refresh Token
    const refreshToken = jwt.sign(
      { id: result.id, email: result.email, phoneNumber: result.phoneNumber },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: "2d" }
    );

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
        refreshToken,
        firstName: result.firstName,
        lastName: result.lastName,
        email: result.email,
        phoneNumber: result.phoneNumber,
        image: result.image,
        firstTimeUser: result.firstTimeUser,
        buyerType: result.buyerType,
        isDashUser: result.isDashUser,
        isPswUpdated: result.isPswUpdateed,
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

const sendEmailOtp = async (email, otp) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("Email SMTP credentials not configured in env");
    throw new Error("Email service not configured.");
  }

  const logoPath = path.join(__dirname, "..", "assets", "polygon-logo.png");
  const logoExists = fs.existsSync(logoPath);

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: { rejectUnauthorized: false },
  });

  const templatePath = path.join(__dirname, "..", "assets", "email-template.html");
  let htmlContent = "";
  if (fs.existsSync(templatePath)) {
    htmlContent = fs.readFileSync(templatePath, "utf8");

    const logoHtml = logoExists
      ? `<img src="cid:polygon_logo" alt="Polygon" style="max-width: 180px; height: auto;" />`
      : `<h2 style="margin:0; color:#FF7F00;">Polygon</h2>`;

    htmlContent = htmlContent
      .replace("{{logo_placeholder}}", logoHtml)
      .replace("{{otp}}", otp)
      .replace("{{year}}", new Date().getFullYear().toString());
  } else {
    // Fallback if template doesn't exist
    htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Complete Your Polygon Registration</h2>
        <p>Thank you for registering for Polygon.</p>
        <p>To verify your email address and complete your registration, please use the following One-Time Password (OTP):</p>
        <div style="background-color: #EEE8F8; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 5px; text-align: center; display: inline-block; border-radius: 6px;">
          ${otp}
        </div>
        <p>This code is valid for <strong>4 minutes</strong>.</p>
      </div>
    `;
  }

  const mailOptions = {
    from: {
      name: "Polygon",
      address: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    },
    to: email,
    subject: "Complete Your Polygon Registration",
    html: htmlContent,
    text: `Your Polygon OTP is: ${otp}\nThis code is valid for 4 minutes.`,
  };

  if (logoExists) {
    mailOptions.attachments = [
      {
        filename: "polygon-logo.png",
        path: logoPath,
        cid: "polygon_logo",
      },
    ];
  }

  await transporter.sendMail(mailOptions);
};

const sendShoutoutSms = async (phoneNumber, code) => {
  const message = `Your OTP for verification is: ${code}`;
  const apiUrl = "https://api.getshoutout.com/coreservice/messages";
  const headers = {
    "Authorization": `Apikey ${process.env.SHOUTOUT_API_KEY}`,
    "Content-Type": "application/json",
  };
  const body = {
    source: "PolygonAgro",
    transports: ["sms"],
    content: { sms: message },
    destinations: [phoneNumber],
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok || (!data.referenceId && !data.reference_id)) {
    throw new Error(data.message || "Failed to send SMS OTP via Shoutout.");
  }
  return data.referenceId || data.reference_id;
};

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

  const {
    email,
    phoneCode,
    phoneNumber,
    phoneNumber2,
    phoneCode2,
    nic,
    companyPhoneNumber,
    companyPhoneCode,
  } = req.body;

  try {
    // Check if user already exists
    const existingUser = await userDao.getUserByEmailDao(email);
    if (existingUser) {
      return res.status(400).json({
        status: false,
        message: "Email already in use.",
      });
    }

    // Check if phone number already exists in phoneNumber, phoneNumber2, or companyPhone
    const existingPhone = await userDao.getUserByPhoneDao(phoneCode, phoneNumber);
    if (existingPhone) {
      return res.status(400).json({
        status: false,
        message: "Mobile Number already exists",
      });
    }

    // Check secondary phone number if provided
    if (phoneNumber2) {
      const existingPhone2 = await userDao.getUserByPhoneDao(phoneCode2 || phoneCode, phoneNumber2);
      if (existingPhone2) {
        return res.status(400).json({
          status: false,
          message: "Secondary Mobile Number already exists",
        });
      }
    }

    // Check company phone number if provided
    if (companyPhoneNumber) {
      const existingCompanyPhone = await userDao.getUserByPhoneDao(companyPhoneCode || phoneCode, companyPhoneNumber);
      if (existingCompanyPhone) {
        return res.status(400).json({
          status: false,
          message: "Company Phone Number already exists",
        });
      }

      // Check if personal mobile and company phone are the same
      const cleanCustomerPhone = String(phoneNumber).replace(/[^0-9]/g, "").replace(/^0+/, "").replace(/^94/, "");
      const cleanCompanyPhone = String(companyPhoneNumber).replace(/[^0-9]/g, "").replace(/^0+/, "").replace(/^94/, "");
      if (cleanCustomerPhone === cleanCompanyPhone) {
        return res.status(400).json({
          status: false,
          message: "Customer Mobile Number and Company Number cannot be the same",
        });
      }
    }

    // Check if NIC already exists
    const existingNic = await userDao.getUserByNicDao(nic);
    if (existingNic) {
      return res.status(400).json({
        status: false,
        message: "NIC Number already exists",
      });
    }

    // Generate 5-digit OTP code
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const referenceId = uuidv4();
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000); // 4 minutes expiry

    // Save OTP to DB
    await userDao.saveOtpDao(referenceId, email, otp, expiresAt);

    // Create a secure registration session token containing the signup details
    const signupToken = jwt.sign(
      { signupData: req.body },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    // Determine verification method based on country code
    const method = phoneCode === "+94" ? "sms" : "email";

    if (method === "sms") {
      // Send via SMS
      try {
        const fullPhone = `${phoneCode}${phoneNumber}`.replace(/\+/g, "").replace(/\s+/g, "");
        const smsReference = await sendShoutoutSms(fullPhone, otp);
        console.log(`[SMS] OTP successfully sent to ${fullPhone} with ref ${smsReference}`);
      } catch (smsErr) {
        console.error("Failed to send Shoutout SMS:", smsErr.message);

      }
    } else {
      // Send via Email
      try {
        await sendEmailOtp(email, otp);
        console.log(`[Email] OTP successfully sent to ${email}`);
      } catch (emailErr) {
        console.error("Failed to send verification email:", emailErr.message);
      }
    }

    return res.status(200).json({
      status: true,
      verificationRequired: true,
      method: method,
      referenceId: referenceId,
      signupToken: signupToken,
      message: method === "sms"
        ? "Verification code has been sent to your mobile number."
        : "Verification code has been sent to your email address.",
    });

  } catch (err) {
    console.error("Error during signup:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred during signup.",
      error: err.message,
    });
  }
});

// Verify OTP and Complete Registration
exports.verifySignup = asyncHandler(async (req, res) => {
  const { code, referenceId, signupToken } = req.body;

  if (!code || !referenceId || !signupToken) {
    return res.status(400).json({
      status: false,
      message: "code, referenceId, and signupToken are required.",
    });
  }

  try {
    // 1. Verify OTP code against DB record
    const otpRecord = await userDao.getOtpDao(referenceId);

    if (!otpRecord) {
      return res.status(400).json({
        status: false,
        message: "Invalid verification code.",
      });
    }

    if (new Date() > new Date(otpRecord.expiresAt)) {
      await userDao.deleteOtpDao(referenceId);
      return res.status(400).json({
        status: false,
        message: "Verification code has expired.",
      });
    }

    if (otpRecord.otp !== code) {
      return res.status(400).json({
        status: false,
        message: "Incorrect verification code.",
      });
    }

    // 2. Verify and decode signupToken
    let decoded;
    try {
      decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Registration session has expired or is invalid.",
      });
    }

    const { signupData } = decoded;

    // Check again if email was taken since signup started
    const existingUser = await userDao.getUserByEmailDao(signupData.email);
    if (existingUser) {
      await userDao.deleteOtpDao(referenceId);
      return res.status(400).json({
        status: false,
        message: "Email already in use.",
      });
    }

    // Check again if phone was taken since signup started
    const existingPhone = await userDao.getUserByPhoneDao(signupData.phoneCode, signupData.phoneNumber);
    if (existingPhone) {
      await userDao.deleteOtpDao(referenceId);
      return res.status(400).json({
        status: false,
        message: "Mobile Number already exists",
      });
    }

    // Check again if secondary phone was taken
    if (signupData.phoneNumber2) {
      const existingPhone2 = await userDao.getUserByPhoneDao(signupData.phoneCode2 || signupData.phoneCode, signupData.phoneNumber2);
      if (existingPhone2) {
        await userDao.deleteOtpDao(referenceId);
        return res.status(400).json({
          status: false,
          message: "Secondary Mobile Number already exists",
        });
      }
    }

    // Check again if company phone was taken
    if (signupData.companyPhoneNumber) {
      const existingCompanyPhone = await userDao.getUserByPhoneDao(signupData.companyPhoneCode || signupData.phoneCode, signupData.companyPhoneNumber);
      if (existingCompanyPhone) {
        await userDao.deleteOtpDao(referenceId);
        return res.status(400).json({
          status: false,
          message: "Company Phone Number already exists",
        });
      }
    }

    // Check again if NIC was taken since signup started
    const existingNic = await userDao.getUserByNicDao(signupData.nic);
    if (existingNic) {
      await userDao.deleteOtpDao(referenceId);
      return res.status(400).json({
        status: false,
        message: "NIC Number already exists",
      });
    }

    // 3. Complete user signup insertion
    const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || "10", 10);
    const hashedPassword = bcrypt.hashSync(signupData.password, SALT_ROUNDS);

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

    // Create user in DB
    const signupResult = await userDao.signupUserDao(signupData, hashedPassword, nextId);

    // Delete OTP record since it has been successfully used
    await userDao.deleteOtpDao(referenceId);

    if (signupResult.status) {
      return res.status(201).json({
        status: true,
        message: "User registered successfully.",
        data: signupResult.data,
      });
    } else {
      return res.status(500).json({
        status: false,
        message: signupResult.message || "Failed to register user.",
      });
    }

  } catch (err) {
    console.error("Error during signup verification:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred during signup verification.",
      error: err.message,
    });
  }
});

// Resend OTP for Signup Verification
exports.resendSignupOtp = asyncHandler(async (req, res) => {
  const { signupToken } = req.body;

  if (!signupToken) {
    return res.status(400).json({
      status: false,
      message: "signupToken is required.",
    });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Registration session has expired or is invalid.",
      });
    }

    const { signupData } = decoded;
    const { email, phoneCode, phoneNumber } = signupData;

    // Generate new 5-digit OTP code
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const referenceId = uuidv4();
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000); // 4 minutes expiry

    // Save OTP to DB
    await userDao.saveOtpDao(referenceId, email, otp, expiresAt);

    // Create new signed JWT token with updated expiry
    const newSignupToken = jwt.sign(
      { signupData },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    const method = phoneCode === "+94" ? "sms" : "email";

    if (method === "sms") {
      try {
        const fullPhone = `${phoneCode}${phoneNumber}`.replace(/\+/g, "").replace(/\s+/g, "");
        await sendShoutoutSms(fullPhone, otp);
      } catch (smsErr) {
        console.error("Failed to send Shoutout SMS on resend:", smsErr.message);
      }
    } else {
      try {
        await sendEmailOtp(email, otp);
      } catch (emailErr) {
        console.error("Failed to send verification email on resend:", emailErr.message);
      }
    }

    return res.status(200).json({
      status: true,
      referenceId: referenceId,
      signupToken: newSignupToken,
      message: method === "sms"
        ? "Verification code has been resent to your mobile number."
        : "Verification code has been resent to your email address.",
    });

  } catch (err) {
    console.error("Error during resend:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred during resend.",
      error: err.message,
    });
  }
});

// Update Password
exports.updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({
      status: false,
      message: "All fields are required.",
    });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({
      status: false,
      message: "Confirm password does not match new password.",
    });
  }

  // Validate new password strength
  if (newPassword.length < 8) {
    return res.status(400).json({
      status: false,
      message: "Password must be at least 8 characters long.",
    });
  }

  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);

  if (!hasLetter || !hasNumber || !hasSymbol) {
    return res.status(400).json({
      status: false,
      message: "Password must contain a mix of letters, numbers, and symbols.",
    });
  }

  try {
    const user = await userDao.getUserPasswordByIdDao(userId);
    if (!user) {
      return res.status(404).json({
        status: false,
        message: "User not found.",
      });
    }

    let isPasswordValid = false;
    if (user.password) {
      isPasswordValid = bcrypt.compareSync(currentPassword, user.password);
      if (!isPasswordValid && /^[0-9]{9}[vVxX]$/.test(currentPassword)) {
        isPasswordValid = bcrypt.compareSync(currentPassword.toUpperCase(), user.password);
      }
    }

    if (!isPasswordValid) {
      return res.status(400).json({
        status: false,
        message: "Invalid current password.",
      });
    }

    const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || "10", 10);
    const hashedPassword = bcrypt.hashSync(newPassword, SALT_ROUNDS);

    const success = await userDao.updatePasswordDao(userId, hashedPassword);

    if (success) {
      return res.status(200).json({
        status: true,
        message: "Password updated successfully.",
      });
    } else {
      return res.status(500).json({
        status: false,
        message: "Failed to update password. Please try again.",
      });
    }
  } catch (err) {
    console.error("Error updating password:", err);
    return res.status(500).json({
      status: false,
      message: "An error occurred while updating the password.",
      error: err.message,
    });
  }
});

// Logout User
exports.logout = asyncHandler(async (req, res) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies && req.cookies.authToken) {
    token = req.cookies.authToken;
  }

  if (token) {
    const { blacklistedTokens } = require("../middlewares/auth.middleware");
    let expiresAt = Date.now() + 8 * 60 * 60 * 1000; // default 8 hours fallback
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp) {
        expiresAt = decoded.exp * 1000;
      }
    } catch (e) {
      console.error("Error decoding token on logout:", e);
    }
    blacklistedTokens.set(token, expiresAt);
    console.log(`🔒 Token successfully blacklisted until: ${new Date(expiresAt).toISOString()}`);
  }

  res.clearCookie("authToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
  });

  return res.status(200).json({
    success: true,
    message: "Logout successful",
  });
});

// Refresh Access Token
exports.refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      message: "Refresh token is required.",
    });
  }

  try {
    const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(refreshToken, secret);

    const payload = {
      id: decoded.id,
      email: decoded.email,
      phoneNumber: decoded.phoneNumber,
      iat: Math.floor(Date.now() / 1000),
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "8h",
    });

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        token,
      },
    });
  } catch (err) {
    console.error("Token refresh failed:", err.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token.",
    });
  }
});

// Exported OTP delivery helpers (reused by customer phone-change flow)
exports.sendEmailOtp = sendEmailOtp;
exports.sendShoutoutSms = sendShoutoutSms;

const userDao = require("../dao/auth.dao");
const jwt = require("jsonwebtoken");
const { loginSchema, signupSchema } = require("../validations/auth.validations");
const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Brute-force lockout & rate limiting
const signupLockouts = new Map(); // key -> lockoutUntil timestamp (ms)
const signupAttempts = new Map(); // primaryKey -> { count, firstAttemptAt }
const signupRequestAttempts = new Map(); // key -> array of request timestamps

const SIGNUP_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SIGNUP_ATTEMPTS = 5;

const getSignupLockoutKeys = (email, phoneCode, phoneNumber) => {
  const keys = [];
  if (email && String(email).trim()) {
    keys.push(`email:${String(email).trim().toLowerCase()}`);
  }
  if (phoneNumber && String(phoneNumber).trim()) {
    const rawDigits = String(phoneNumber).trim().replace(/[^0-9]/g, "");
    const noZero = rawDigits.replace(/^0+/, "");
    const codeDigits = String(phoneCode || "94").replace(/[^0-9]/g, "");

    if (noZero) {
      keys.push(`phone:${codeDigits}${noZero}`);
      keys.push(`phone:${codeDigits}${rawDigits}`);
      keys.push(`phone:${noZero}`);
      keys.push(`phone:${rawDigits}`);
    }
  }
  return [...new Set(keys)];
};

const checkSignupLockout = (keys) => {
  const now = Date.now();
  for (const key of keys) {
    const lockoutUntil = signupLockouts.get(key);
    if (lockoutUntil) {
      if (lockoutUntil > now) {
        const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
        return { locked: true, remainingSec, lockoutUntil };
      } else {
        signupLockouts.delete(key);
      }
    }
  }
  return { locked: false, remainingSec: 0 };
};

const setSignupLockout = (keys, durationMs = SIGNUP_LOCKOUT_MS) => {
  const now = Date.now();
  const lockoutUntil = now + durationMs;
  for (const key of keys) {
    signupLockouts.set(key, lockoutUntil);
  }
  return lockoutUntil;
};

const clearSignupLockout = (keys) => {
  for (const key of keys) {
    signupLockouts.delete(key);
    signupAttempts.delete(key);
    signupRequestAttempts.delete(key);
  }
};

// Forgot Password Lockout & Attempt Tracker
const forgotPasswordLockouts = new Map(); // key -> lockoutUntil timestamp (ms)
const forgotPasswordAttempts = new Map(); // primaryKey -> { count, firstAttemptAt }
const forgotPasswordRequestAttempts = new Map(); // key -> array of request timestamps

const FORGOT_PWD_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FORGOT_PWD_ATTEMPTS = 5;

const getForgotPwdLockoutKeys = (type, email, phoneCode, phoneNumber, userId) => {
  const keys = [];
  if (userId) keys.push(`user:${userId}`);
  if (email && email.trim()) {
    keys.push(`email:${email.trim().toLowerCase()}`);
  }
  if (phoneNumber && phoneNumber.trim()) {
    const rawDigits = String(phoneNumber).trim().replace(/[^0-9]/g, "");
    const noZero = rawDigits.replace(/^0+/, "");
    const codeDigits = String(phoneCode || "94").replace(/[^0-9]/g, "");

    if (noZero) {
      keys.push(`phone:${codeDigits}${noZero}`);
      keys.push(`phone:${codeDigits}${rawDigits}`);
      keys.push(`phone:${noZero}`);
      keys.push(`phone:${rawDigits}`);
    }
  }
  return [...new Set(keys)];
};

const checkForgotPwdLockout = (keys) => {
  const now = Date.now();
  for (const key of keys) {
    const lockoutUntil = forgotPasswordLockouts.get(key);
    if (lockoutUntil) {
      if (lockoutUntil > now) {
        const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
        return { locked: true, remainingSec, lockoutUntil };
      } else {
        forgotPasswordLockouts.delete(key);
      }
    }
  }
  return { locked: false, remainingSec: 0 };
};

const setForgotPwdLockout = (keys, durationMs = FORGOT_PWD_LOCKOUT_MS) => {
  const now = Date.now();
  const lockoutUntil = now + durationMs;
  for (const key of keys) {
    forgotPasswordLockouts.set(key, lockoutUntil);
  }
  return lockoutUntil;
};

const clearForgotPwdLockout = (keys) => {
  for (const key of keys) {
    forgotPasswordLockouts.delete(key);
    forgotPasswordRequestAttempts.delete(key);
    forgotPasswordAttempts.delete(key);
  }
};

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
      buyerType: result.buyerType,
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
        cusId: result.cusId,
        title: result.title,
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

// Update City Availability & broadcast to all clients via Socket.IO
exports.updateCityAvailability = asyncHandler(async (req, res) => {
  const { cityId, isAvailable, companyCenterId = 1 } = req.body;

  if (!cityId) {
    return res.status(400).json({
      status: false,
      message: "cityId is required",
    });
  }

  try {
    const updatedCities = await userDao.updateCityAvailabilityDao(
      cityId,
      Boolean(isAvailable),
      companyCenterId
    );

    return res.status(200).json({
      status: true,
      message: `City ${cityId} availability updated to ${isAvailable}`,
      data: updatedCities,
    });
  } catch (err) {
    console.error("Error updating city availability:", err.message);
    return res.status(500).json({
      status: false,
      message: "Failed to update city availability",
      error: err.message,
    });
  }
});

const sendEmailOtp = async (email, otp, options = {}) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("Email SMTP credentials not configured in env");
    throw new Error("Email service not configured.");
  }

  const title = options.title || "Complete Your Polygon Registration";
  const subject = options.subject || title;
  const introText = options.introText !== undefined ? options.introText : "Thank you for registering for Polygon.";
  const actionText = options.actionText || "To verify your email address and complete your registration, please use the following One-Time Password (OTP):";
  const instructionText = options.instructionText || (options.title && options.title.includes("Password")
    ? "Enter this OTP on the verification page to reset your password."
    : "Enter this OTP on the verification page to activate your account.");

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
  const introSectionHtml = introText && introText.trim().length > 0
    ? `<p style="margin: 0 0 12px; font-size: 14px; color: #02072C;">${introText}</p>`
    : "";

  if (fs.existsSync(templatePath)) {
    htmlContent = fs.readFileSync(templatePath, "utf8");

    const logoHtml = logoExists
      ? `<img src="cid:polygon_logo" alt="Polygon" style="max-width: 180px; height: auto;" />`
      : `<h2 style="margin:0; color:#FF7F00;">Polygon</h2>`;

    htmlContent = htmlContent
      .replace("{{logo_placeholder}}", logoHtml)
      .replace(/{{title}}/g, title)
      .replace("{{intro_section}}", introSectionHtml)
      .replace("{{action_text}}", actionText)
      .replace("{{instruction_text}}", instructionText)
      .replace("{{otp}}", otp)
      .replace("{{year}}", new Date().getFullYear().toString());
  } else {
    // Fallback if template doesn't exist
    htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>${title}</h2>
        ${introSectionHtml}
        <p>${actionText}</p>
        <div style="background-color: #FFF5E9; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 5px; text-align: center; display: inline-block; border-radius: 6px;">
          ${otp}
        </div>
        <p>This code is valid for <strong>4 minutes</strong>.</p>
        <p>${instructionText}</p>
      </div>
    `;
  }

  const mailOptions = {
    from: {
      name: "Polygon",
      address: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    },
    to: email,
    subject: subject,
    html: htmlContent,
    text: `Hello,\n\n${introText ? introText + '\n\n' : ''}${actionText}\n\n${otp}\n\nThis code is valid for 4 minutes.\n${instructionText}`,
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
    const conflictErrors = {};
    const errorMessages = [];

    // Check if user already exists
    const existingUser = await userDao.getUserByEmailDao(email);
    if (existingUser) {
      conflictErrors.email = "Email already exists.";
      errorMessages.push("Email already exists.");
    }

    // Check if phone number already exists in phoneNumber, phoneNumber2, or companyPhone
    const existingPhone = await userDao.getUserByPhoneDao(phoneCode, phoneNumber);
    if (existingPhone) {
      conflictErrors.phoneNumber = "Mobile Number already exists";
      errorMessages.push("Mobile Number already exists");
    }

    // Check secondary phone number if provided
    if (phoneNumber2) {
      const existingPhone2 = await userDao.getUserByPhoneDao(phoneCode2 || phoneCode, phoneNumber2);
      if (existingPhone2) {
        conflictErrors.phoneNumber2 = "Secondary Mobile Number already exists";
        errorMessages.push("Secondary Mobile Number already exists");
      }
    }

    // Check company phone number if provided
    if (companyPhoneNumber) {
      const existingCompanyPhone = await userDao.getUserByPhoneDao(companyPhoneCode || phoneCode, companyPhoneNumber);
      if (existingCompanyPhone) {
        conflictErrors.companyNumber = "Company Phone Number already exists";
        errorMessages.push("Company Phone Number already exists");
      }
    }

    // Check if NIC already exists
    if (nic) {
      const existingNic = await userDao.getUserByNicDao(nic);
      if (existingNic) {
        conflictErrors.nic = "NIC number already exists";
        errorMessages.push("NIC number already exists");
      }
    }

    if (errorMessages.length > 0) {
      return res.status(400).json({
        status: false,
        message: errorMessages.join(". "),
        errors: errorMessages,
        fieldErrors: conflictErrors,
      });
    }

    // Check if phone or email is currently locked out
    const lockoutKeys = getSignupLockoutKeys(email, phoneCode, phoneNumber);
    const lockoutStatus = checkSignupLockout(lockoutKeys);
    if (lockoutStatus.locked) {
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: lockoutStatus.remainingSec,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }

    // Rate limit request frequency (Max 5 signup OTP requests / 15 min)
    const primaryKey = lockoutKeys[0] || `signup:${email || phoneNumber}`;
    const now = Date.now();
    const requestTimestamps = (signupRequestAttempts.get(primaryKey) || [])
      .filter((ts) => now - ts < SIGNUP_LOCKOUT_MS);

    if (requestTimestamps.length >= MAX_SIGNUP_ATTEMPTS) {
      setSignupLockout(lockoutKeys);
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: 900,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }
    requestTimestamps.push(now);
    signupRequestAttempts.set(primaryKey, requestTimestamps);

    // Generate cryptographically secure 5-digit OTP code (Risk 4.B)
    const otp = crypto.randomInt(10000, 100000).toString();
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
    let decoded;
    try {
      decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Registration session has expired or is invalid.",
      });
    }

    const { signupData } = decoded || {};
    const lockoutKeys = getSignupLockoutKeys(
      signupData?.email,
      signupData?.phoneCode,
      signupData?.phoneNumber
    );

    const lockoutStatus = checkSignupLockout(lockoutKeys);
    if (lockoutStatus.locked) {
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: lockoutStatus.remainingSec,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }

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

    const primaryKey = lockoutKeys[0] || `signup:${signupData?.email || signupData?.phoneNumber || referenceId}`;

    if (otpRecord.otp !== code) {
      const now = Date.now();
      let attemptData = signupAttempts.get(primaryKey);
      if (attemptData && typeof attemptData === "object") {
        if (now - attemptData.firstAttemptAt > SIGNUP_LOCKOUT_MS) {
          attemptData = null;
        }
      } else if (typeof attemptData === "number") {
        attemptData = { count: attemptData, firstAttemptAt: now };
      }

      const currentAttempts = (attemptData ? attemptData.count : 0) + 1;
      signupAttempts.set(primaryKey, {
        count: currentAttempts,
        firstAttemptAt: attemptData ? attemptData.firstAttemptAt : now,
      });

      if (currentAttempts >= MAX_SIGNUP_ATTEMPTS) {
        signupAttempts.delete(primaryKey);
        await userDao.deleteOtpDao(referenceId);
        setSignupLockout(lockoutKeys);

        return res.status(429).json({
          status: false,
          isRateLimited: true,
          retryAfter: 900,
          message: "Too many verification attempts. Please try again after 15 minutes.",
        });
      }

      const remainingAttempts = MAX_SIGNUP_ATTEMPTS - currentAttempts;
      return res.status(400).json({
        status: false,
        message: `Incorrect verification code. ${remainingAttempts} attempts remaining.`,
      });
    }

    clearSignupLockout(lockoutKeys);

    // 2. Decode and check conflict errors
    const conflictErrors = {};
    const errorMessages = [];

    // Check again if email was taken since signup started
    const existingUser = await userDao.getUserByEmailDao(signupData.email);
    if (existingUser) {
      conflictErrors.email = "Email already in use.";
      errorMessages.push("Email already in use.");
    }

    // Check again if phone was taken since signup started
    const existingPhone = await userDao.getUserByPhoneDao(signupData.phoneCode, signupData.phoneNumber);
    if (existingPhone) {
      conflictErrors.phoneNumber = "Mobile Number already exists";
      errorMessages.push("Mobile Number already exists");
    }

    // Check again if secondary phone was taken
    if (signupData.phoneNumber2) {
      const existingPhone2 = await userDao.getUserByPhoneDao(signupData.phoneCode2 || signupData.phoneCode, signupData.phoneNumber2);
      if (existingPhone2) {
        conflictErrors.phoneNumber2 = "Secondary Mobile Number already exists";
        errorMessages.push("Secondary Mobile Number already exists");
      }
    }

    // Check again if company phone was taken
    if (signupData.companyPhoneNumber) {
      const existingCompanyPhone = await userDao.getUserByPhoneDao(signupData.companyPhoneCode || signupData.phoneCode, signupData.companyPhoneNumber);
      if (existingCompanyPhone) {
        conflictErrors.companyNumber = "Company Phone Number already exists";
        errorMessages.push("Company Phone Number already exists");
      }
    }

    // Check again if NIC was taken since signup started
    if (signupData.nic) {
      const existingNic = await userDao.getUserByNicDao(signupData.nic);
      if (existingNic) {
        conflictErrors.nic = "NIC number already exists";
        errorMessages.push("NIC number already exists");
      }
    }

    if (errorMessages.length > 0) {
      await userDao.deleteOtpDao(referenceId);
      return res.status(400).json({
        status: false,
        message: errorMessages.join(". "),
        errors: errorMessages,
        fieldErrors: conflictErrors,
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
        message: "Your Polygon account created successfully.",
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

    // Check lockout before resending
    const lockoutKeys = getSignupLockoutKeys(email, phoneCode, phoneNumber);
    const lockoutStatus = checkSignupLockout(lockoutKeys);
    if (lockoutStatus.locked) {
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: lockoutStatus.remainingSec,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }

    const primaryKey = lockoutKeys[0] || `signup:${email || phoneNumber}`;
    const now = Date.now();
    const requestTimestamps = (signupRequestAttempts.get(primaryKey) || [])
      .filter((ts) => now - ts < SIGNUP_LOCKOUT_MS);

    if (requestTimestamps.length >= MAX_SIGNUP_ATTEMPTS) {
      setSignupLockout(lockoutKeys);
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: 900,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }
    requestTimestamps.push(now);
    signupRequestAttempts.set(primaryKey, requestTimestamps);

    // Generate cryptographically secure 5-digit OTP code (Risk 4.B)
    const otp = crypto.randomInt(10000, 100000).toString();
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

  if (/\s/.test(currentPassword) || /\s/.test(newPassword) || /\s/.test(confirmNewPassword)) {
    return res.status(400).json({
      status: false,
      message: "Password cannot contain spaces.",
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
  const hasSymbol =
    /[@#$%&*\-=()?\/;:'"!~±×÷•°`´{}\]\[+_¥®\^€£©¡<>¢|\\¿,.]/.test(newPassword);

  if (!hasLetter || !hasNumber || !hasSymbol) {
    return res.status(400).json({
      status: false,
      message: "Password must contain a mix of letters, numbers, and symbols.",
    });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      status: false,
      message: "New password cannot be the same as your current password.",
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

    if (user.password && bcrypt.compareSync(newPassword, user.password)) {
      return res.status(400).json({
        status: false,
        message: "New password cannot be the same as your current password.",
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
      buyerType: decoded.buyerType,
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

// ─── Forgot Password Endpoints ──────────────────────────────────────────────────

// Request OTP for Forgot Password
exports.forgotPasswordRequestOtp = asyncHandler(async (req, res) => {
  const { type, email, phoneCode, phoneNumber } = req.body;

  if (!type || (type !== "email" && type !== "sms")) {
    return res.status(400).json({
      status: false,
      message: "Valid reset type ('email' or 'sms') is required.",
    });
  }

  try {
    let user = null;

    if (type === "email") {
      if (!email || !email.trim()) {
        return res.status(400).json({
          status: false,
          message: "Email address is required.",
        });
      }
      user = await userDao.getUserByEmailDao(email.trim());
      if (!user) {
        return res.status(404).json({
          status: false,
          message: "No account found with this email address.",
        });
      }
    } else if (type === "sms") {
      if (!phoneCode || !phoneNumber || !phoneNumber.trim()) {
        return res.status(400).json({
          status: false,
          message: "Country code and mobile number are required.",
        });
      }

      if (phoneCode !== "+94") {
        return res.status(400).json({
          status: false,
          message: "SMS OTP is only available for Sri Lankan mobile numbers (+94). Please use the email option.",
        });
      }

      user = await userDao.getUserByPhoneDao(phoneCode, phoneNumber.trim());
      if (!user) {
        return res.status(404).json({
          status: false,
          message: "No account found with this mobile number.",
        });
      }
    }

    // Check if this user/identifier is currently locked out
    const keys = getForgotPwdLockoutKeys(
      type,
      user.email || email,
      user.phoneCode || phoneCode,
      user.phoneNumber || phoneNumber,
      user.id
    );

    const lockoutStatus = checkForgotPwdLockout(keys);
    if (lockoutStatus.locked) {
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: lockoutStatus.remainingSec,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }

    // Rate limit request frequency (Max 5 OTP requests / 15 min)
    const primaryKey = keys[0] || `${type}:${email || phoneNumber}`;
    const now = Date.now();
    const requestTimestamps = (forgotPasswordRequestAttempts.get(primaryKey) || [])
      .filter((ts) => now - ts < FORGOT_PWD_LOCKOUT_MS);

    if (requestTimestamps.length >= MAX_FORGOT_PWD_ATTEMPTS) {
      setForgotPwdLockout(keys);
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: 900,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }
    requestTimestamps.push(now);
    forgotPasswordRequestAttempts.set(primaryKey, requestTimestamps);

    // Generate 5-digit OTP
    const otp = crypto.randomInt(10000, 100000).toString();
    const referenceId = uuidv4();
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000); // 4 minutes expiry

    // Save OTP to DB
    const otpIdentifier = type === "email" ? user.email : (user.email || user.phoneNumber);
    await userDao.saveOtpDao(referenceId, otpIdentifier, otp, expiresAt);

    // Create session reset token
    const resetToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        phoneCode: user.phoneCode || phoneCode,
        phoneNumber: user.phoneNumber,
        type: type,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    if (type === "email") {
      try {
        await sendEmailOtp(user.email, otp, {
          title: "Password Reset Verification OTP",
          subject: "Password Reset Verification OTP",
          introText: "",
          actionText: "To reset your Polygon account password, please use the following One-Time Password (OTP):",
          instructionText: "Enter this OTP on the verification page to reset your password.",
        });
        console.log(`[Forgot Password] Email OTP sent to ${user.email}`);
      } catch (mailErr) {
        console.error("Failed to send password reset email:", mailErr.message);
      }
    } else {
      try {
        const fullPhone = `${phoneCode}${phoneNumber.trim()}`.replace(/\+/g, "").replace(/\s+/g, "");
        await sendShoutoutSms(fullPhone, otp);
        console.log(`[Forgot Password] SMS OTP sent to ${fullPhone}`);
      } catch (smsErr) {
        console.error("Failed to send password reset SMS:", smsErr.message);
      }
    }

    return res.status(200).json({
      status: true,
      referenceId: referenceId,
      resetToken: resetToken,
      method: type,
      identifier: type === "email" ? user.email : `${phoneCode} ${phoneNumber.trim()}`,
      message: type === "email"
        ? "Verification code has been sent to your email address."
        : "Verification code has been sent to your mobile number.",
    });
  } catch (err) {
    console.error("Error in forgotPasswordRequestOtp:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred while requesting verification code.",
      error: err.message,
    });
  }
});

// Resend OTP for Forgot Password
exports.forgotPasswordResendOtp = asyncHandler(async (req, res) => {
  const { resetToken } = req.body;

  if (!resetToken) {
    return res.status(400).json({
      status: false,
      message: "resetToken is required.",
    });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Password reset session has expired or is invalid.",
      });
    }

    const { userId, email, phoneCode, phoneNumber, type } = decoded;

    // Check lockout before resending
    const keys = getForgotPwdLockoutKeys(type, email, phoneCode, phoneNumber, userId);
    const lockoutStatus = checkForgotPwdLockout(keys);
    if (lockoutStatus.locked) {
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: lockoutStatus.remainingSec,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }

    const primaryKey = keys[0] || `${type}:${email || phoneNumber}`;
    const now = Date.now();
    const requestTimestamps = (forgotPasswordRequestAttempts.get(primaryKey) || [])
      .filter((ts) => now - ts < FORGOT_PWD_LOCKOUT_MS);

    if (requestTimestamps.length >= MAX_FORGOT_PWD_ATTEMPTS) {
      setForgotPwdLockout(keys);
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: 900,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }
    requestTimestamps.push(now);
    forgotPasswordRequestAttempts.set(primaryKey, requestTimestamps);

    // Generate 5-digit OTP
    const otp = crypto.randomInt(10000, 100000).toString();
    const referenceId = uuidv4();
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000); // 4 minutes

    const otpIdentifier = type === "email" ? email : (email || phoneNumber);
    await userDao.saveOtpDao(referenceId, otpIdentifier, otp, expiresAt);

    const newResetToken = jwt.sign(
      { userId, email, phoneCode, phoneNumber, type },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    if (type === "email") {
      try {
        await sendEmailOtp(email, otp, {
          title: "Password Reset Verification OTP",
          subject: "Password Reset Verification OTP",
          introText: "",
          actionText: "To reset your Polygon account password, please use the following One-Time Password (OTP):",
          instructionText: "Enter this OTP on the verification page to reset your password.",
        });
      } catch (mailErr) {
        console.error("Failed to resend password reset email:", mailErr.message);
      }
    } else {
      try {
        const fullPhone = `${phoneCode}${phoneNumber}`.replace(/\+/g, "").replace(/\s+/g, "");
        await sendShoutoutSms(fullPhone, otp);
      } catch (smsErr) {
        console.error("Failed to resend password reset SMS:", smsErr.message);
      }
    }

    return res.status(200).json({
      status: true,
      referenceId: referenceId,
      resetToken: newResetToken,
      message: type === "email"
        ? "Verification code has been resent to your email address."
        : "Verification code has been resent to your mobile number.",
    });
  } catch (err) {
    console.error("Error in forgotPasswordResendOtp:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred while resending verification code.",
      error: err.message,
    });
  }
});

// Verify OTP for Forgot Password
exports.forgotPasswordVerifyOtp = asyncHandler(async (req, res) => {
  const { code, referenceId, resetToken } = req.body;

  if (!code || !referenceId || !resetToken) {
    return res.status(400).json({
      status: false,
      message: "code, referenceId, and resetToken are required.",
    });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Password reset session has expired or is invalid.",
      });
    }

    const keys = getForgotPwdLockoutKeys(
      decoded.type,
      decoded.email,
      decoded.phoneCode,
      decoded.phoneNumber,
      decoded.userId
    );

    const lockoutStatus = checkForgotPwdLockout(keys);
    if (lockoutStatus.locked) {
      return res.status(429).json({
        status: false,
        isRateLimited: true,
        retryAfter: lockoutStatus.remainingSec,
        message: "Too many verification attempts. Please try again after 15 minutes.",
      });
    }

    const primaryKey = keys[0] || `${decoded.type}:${decoded.email || decoded.phoneNumber}`;

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
        message: "Verification code has expired. Please request a new code.",
      });
    }

    if (otpRecord.otp !== code) {
      const now = Date.now();
      let attemptData = forgotPasswordAttempts.get(primaryKey);
      if (attemptData && typeof attemptData === "object") {
        if (now - attemptData.firstAttemptAt > FORGOT_PWD_LOCKOUT_MS) {
          attemptData = null;
        }
      } else if (typeof attemptData === "number") {
        attemptData = { count: attemptData, firstAttemptAt: now };
      }

      const currentAttempts = (attemptData ? attemptData.count : 0) + 1;
      forgotPasswordAttempts.set(primaryKey, {
        count: currentAttempts,
        firstAttemptAt: attemptData ? attemptData.firstAttemptAt : now,
      });

      if (currentAttempts >= MAX_FORGOT_PWD_ATTEMPTS) {
        forgotPasswordAttempts.delete(primaryKey);
        await userDao.deleteOtpDao(referenceId);
        setForgotPwdLockout(keys);

        return res.status(429).json({
          status: false,
          isRateLimited: true,
          retryAfter: 900,
          message: "Too many verification attempts. Please try again after 15 minutes.",
        });
      }

      const remainingAttempts = MAX_FORGOT_PWD_ATTEMPTS - currentAttempts;
      return res.status(400).json({
        status: false,
        message: `Incorrect verification code. ${remainingAttempts} attempts remaining.`,
      });
    }

    forgotPasswordAttempts.delete(primaryKey);

    // Delete OTP record since it's verified
    await userDao.deleteOtpDao(referenceId);

    // Issue verifiedResetToken for Reset Password step
    const verifiedResetToken = jwt.sign(
      {
        userId: decoded.userId,
        email: decoded.email,
        phoneCode: decoded.phoneCode,
        phoneNumber: decoded.phoneNumber,
        type: decoded.type,
        action: "password_reset",
        verified: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.status(200).json({
      status: true,
      message: "Verification successful.",
      verifiedResetToken: verifiedResetToken,
    });
  } catch (err) {
    console.error("Error in forgotPasswordVerifyOtp:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred during OTP verification.",
      error: err.message,
    });
  }
});

// Complete Password Reset
exports.forgotPasswordReset = asyncHandler(async (req, res) => {
  const { verifiedResetToken, newPassword, confirmNewPassword } = req.body;

  if (!verifiedResetToken || !newPassword || !confirmNewPassword) {
    return res.status(400).json({
      status: false,
      message: "All fields are required.",
    });
  }

  if (/\s/.test(newPassword) || /\s/.test(confirmNewPassword)) {
    return res.status(400).json({
      status: false,
      message: "Password cannot contain spaces.",
    });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({
      status: false,
      message: "Passwords do not match.",
    });
  }

  // Password requirements
  if (newPassword.length < 8) {
    return res.status(400).json({
      status: false,
      message: "Password must be at least 8 characters long.",
    });
  }

  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecialChar =
    /[@#$%&*\-=()?\/;:'"!~±×÷•°`´{}\]\[+_¥®\^€£©¡<>¢|\\¿,.]/.test(newPassword);

  if (!hasUppercase || !hasNumber || !hasSpecialChar) {
    return res.status(400).json({
      status: false,
      message: "Password must contain at least 1 uppercase letter, 1 number, and 1 special character.",
    });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(verifiedResetToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Password reset session has expired or is invalid.",
      });
    }

    if (!decoded.verified || decoded.action !== "password_reset" || !decoded.userId) {
      return res.status(400).json({
        status: false,
        message: "Invalid password reset authorization.",
      });
    }

    const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || "10", 10);
    const hashedPassword = bcrypt.hashSync(newPassword, SALT_ROUNDS);

    const success = await userDao.updatePasswordDao(decoded.userId, hashedPassword);

    if (success) {
      const keys = getForgotPwdLockoutKeys(
        decoded.type,
        decoded.email,
        decoded.phoneCode,
        decoded.phoneNumber,
        decoded.userId
      );
      clearForgotPwdLockout(keys);

      return res.status(200).json({
        status: true,
        message: "Your password has been successfully reset. Please log in with your new password.",
      });
    } else {
      return res.status(500).json({
        status: false,
        message: "Failed to reset password. Please try again.",
      });
    }
  } catch (err) {
    console.error("Error in forgotPasswordReset:", err);
    return res.status(500).json({
      status: false,
      message: "An unexpected error occurred while resetting the password.",
      error: err.message,
    });
  }
});

// Exported OTP delivery helpers (reused by customer phone-change flow)
exports.sendEmailOtp = sendEmailOtp;
exports.sendShoutoutSms = sendShoutoutSms;
exports.getSignupLockoutKeys = getSignupLockoutKeys;
exports.checkSignupLockout = checkSignupLockout;
exports.setSignupLockout = setSignupLockout;
exports.clearSignupLockout = clearSignupLockout;
exports.signupLockouts = signupLockouts;
exports.signupAttempts = signupAttempts;
exports.signupRequestAttempts = signupRequestAttempts;

const customerDao = require("../dao/customer.dao");
const authDao = require("../dao/auth.dao");
const userAuthEp = require("./auth.ep");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const asyncHandler = require("express-async-handler");

exports.getCustomerProfile = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getCustomerProfileDao(userId);
    if (results.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }
    return res.status(200).json({ status: true, data: results[0] });
  } catch (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.getSuggestions = asyncHandler(async (req, res) => {
  try {
    const results = await customerDao.getSuggestionsDao();
    return res.status(200).json({
      status: true,
      message: "Suggested items fetched successfully",
      items: results,
    });
  } catch (error) {
    console.error("Suggestions fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.getIncludeItems = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getIncludeItemsDao(userId);
    return res.status(200).json({
      status: true,
      items: results,
    });
  } catch (error) {
    console.error("Include items fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.addIncludeItems = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res
        .status(200)
        .json({ status: true, message: "No items to insert" });
    }
    await customerDao.addIncludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Included items saved successfully" });
  } catch (error) {
    console.error("Include items save error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.deleteIncluded = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res
        .status(200)
        .json({ status: true, message: "No items to delete" });
    }
    await customerDao.deleteIncludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Included items deleted successfully" });
  } catch (error) {
    console.error("Include items delete error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.getExcludeItems = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getExcludeItemsDao(userId);
    return res.status(200).json({
      status: true,
      items: results,
    });
  } catch (error) {
    console.error("Exclude items fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.addExcludeItems = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res
        .status(200)
        .json({ status: true, message: "No items to insert" });
    }
    await customerDao.addExcludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Excluded items saved successfully" });
  } catch (error) {
    console.error("Exclude items save error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.deleteExcluded = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res
        .status(200)
        .json({ status: true, message: "No items to delete" });
    }
    await customerDao.deleteExcludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Excluded items deleted successfully" });
  } catch (error) {
    console.error("Exclude items delete error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.updateUserStatus = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await customerDao.updateUserStatusDao(userId);
    return res.status(200).json({
      status: true,
      message: "User status updated successfully",
      result,
    });
  } catch (error) {
    console.error("Update status error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

exports.getSavedAddresses = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(401).json({
        status: false,
        message: "User not authenticated",
      });
    }

    const addresses =
      await customerDao.getSavedAddressesByCustomerIdDao(userId);

    if (!addresses || addresses.length === 0) {
      return res.status(200).json({
        status: false,
        message: "No saved addresses found",
        hasAddress: false,
      });
    }

    return res.status(200).json({
      status: true,
      message: "Saved addresses retrieved successfully",
      hasAddress: true,
      result: addresses,
    });
  } catch (error) {
    console.error("Error fetching saved addresses:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
      hasAddress: false,
      error: error.message,
    });
  }
});

exports.getAccountDetails = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getAccountDetailsDao(userId);
    if (results.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }
    return res.status(200).json({ status: true, data: results[0] });
  } catch (error) {
    console.error("Account details fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Add User Address ----------
exports.addAddress = asyncHandler(async (req, res) => {
  try {
    const customerId = req.user.id;
    const { buildingType } = req.body;

    if (!buildingType || !["Apartment", "House"].includes(buildingType)) {
      return res
        .status(400)
        .json({ status: false, message: "Valid buildingType is required" });
    }

    const result = await customerDao.addAddressDao(customerId, req.body);
    return res
      .status(201)
      .json({ status: true, message: "Address added successfully", result });
  } catch (error) {
    console.error("Add address error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Update User Address ----------
exports.updateAddress = asyncHandler(async (req, res) => {
  try {
    const customerId = req.user.id;
    const { addressId } = req.params;
    const { buildingType } = req.body;

    if (!buildingType || !["Apartment", "House"].includes(buildingType)) {
      return res
        .status(400)
        .json({ status: false, message: "Valid buildingType is required" });
    }

    const result = await customerDao.updateAddressDao(
      addressId,
      customerId,
      req.body,
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "Address not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "Address updated successfully" });
  } catch (error) {
    console.error("Update address error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Delete User Address ----------
exports.deleteAddress = asyncHandler(async (req, res) => {
  try {
    const customerId = req.user.id;
    const { addressId } = req.params;
    const { buildingType } = req.query;

    if (!buildingType || !["Apartment", "House"].includes(buildingType)) {
      return res
        .status(400)
        .json({ status: false, message: "Valid buildingType is required" });
    }

    const result = await customerDao.deleteAddressDao(
      addressId,
      customerId,
      buildingType,
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "Address not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "Address deleted successfully" });
  } catch (error) {
    console.error("Delete address error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Update User Details ----------
exports.updateUserDetails = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.body.nic) {
      const isNicTaken = await customerDao.isNicTakenDao(userId, req.body.nic);
      if (isNicTaken) {
        return res.status(400).json({ status: false, message: "NIC Number already exists" });
      }
    }

    const result = await customerDao.updateUserDetailsDao(userId, req.body);

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "User details updated successfully" });
  } catch (error) {
    console.error("Update user details error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Delete User Account ----------
exports.deleteUserAccount = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await customerDao.deleteUserAccountDao(userId);

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "Account deleted successfully" });
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Send OTP to verify a new phone number ----------
exports.sendPhoneChangeOtp = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { phoneCode, phoneNumber } = req.body;

    if (!phoneCode || !phoneNumber) {
      return res
        .status(400)
        .json({ status: false, message: "phoneCode and phoneNumber are required." });
    }

    const normalizedPhone = String(phoneNumber).replace(/[^0-9]/g, "");
    if (normalizedPhone.length < 9 || normalizedPhone.length > 10) {
      return res
        .status(400)
        .json({ status: false, message: "Invalid phone number." });
    }

    // Reject numbers already used by another account
    const taken = await customerDao.isPhoneTakenDao(userId, normalizedPhone);
    if (taken) {
      return res.status(400).json({
        status: false,
        message: "This phone number is already in use by another account.",
      });
    }

    // Generate 5-digit OTP
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const referenceId = uuidv4();
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000); // 4 minutes

    await authDao.saveOtpDao(referenceId, req.user.email || null, otp, expiresAt);

    // Stateless session token carrying the intended new phone
    const phoneChangeToken = jwt.sign(
      { userId, phoneCode, phoneNumber: normalizedPhone },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    const method = "sms";
    try {
      const fullPhone = `${phoneCode}${normalizedPhone}`
        .replace(/\+/g, "")
        .replace(/\s+/g, "");
      await userAuthEp.sendShoutoutSms(fullPhone, otp);
      console.log(`[SMS] Phone change OTP sent to ${fullPhone}`);
    } catch (smsErr) {
      console.error("Failed to send Shoutout SMS for phone change:", smsErr.message);
    }

    return res.status(200).json({
      status: true,
      method,
      referenceId,
      signupToken: phoneChangeToken,
      message: "Verification code has been sent to your new mobile number.",
    });
  } catch (error) {
    console.error("Send phone change OTP error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Verify phone change OTP and update the number ----------
exports.verifyPhoneChange = asyncHandler(async (req, res) => {
  try {
    const { code, referenceId, signupToken, accountDetails } = req.body;

    if (!code || !referenceId || !signupToken) {
      return res.status(400).json({
        status: false,
        message: "code, referenceId and signupToken are required.",
      });
    }

    const otpRecord = await authDao.getOtpDao(referenceId);
    if (!otpRecord) {
      return res.status(400).json({ status: false, message: "Invalid verification code." });
    }
    if (new Date() > new Date(otpRecord.expiresAt)) {
      await authDao.deleteOtpDao(referenceId);
      return res.status(400).json({ status: false, message: "Verification code has expired." });
    }
    if (otpRecord.otp !== code) {
      return res.status(400).json({ status: false, message: "Incorrect verification code." });
    }

    let decoded;
    try {
      decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Verification session has expired or is invalid.",
      });
    }

    const { userId, phoneCode, phoneNumber } = decoded;

    const updateResult = await customerDao.updateUserPhoneDao(
      userId,
      phoneCode,
      phoneNumber
    );
    if (!updateResult || updateResult.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "User not found." });
    }

    // Apply the rest of the edited account details (name, email, company, etc.)
    if (accountDetails && typeof accountDetails === "object") {
      await customerDao.updateUserDetailsDao(userId, accountDetails);
    }

    await authDao.deleteOtpDao(referenceId);

    return res.status(200).json({
      status: true,
      message: "Your mobile number has been updated successfully.",
    });
  } catch (error) {
    console.error("Verify phone change error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// ---------- Resend phone change OTP ----------
exports.resendPhoneChangeOtp = asyncHandler(async (req, res) => {
  try {
    const { signupToken } = req.body;

    if (!signupToken) {
      return res.status(400).json({ status: false, message: "signupToken is required." });
    }

    let decoded;
    try {
      decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(400).json({
        status: false,
        message: "Verification session has expired or is invalid.",
      });
    }

    const { userId, phoneCode, phoneNumber } = decoded;

    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const referenceId = uuidv4();
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000);

    await authDao.saveOtpDao(referenceId, req.user?.email || null, otp, expiresAt);

    const newSignupToken = jwt.sign(
      { userId, phoneCode, phoneNumber },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    try {
      const fullPhone = `${phoneCode}${phoneNumber}`
        .replace(/\+/g, "")
        .replace(/\s+/g, "");
      await userAuthEp.sendShoutoutSms(fullPhone, otp);
      console.log(`[SMS] Phone change OTP resent to ${fullPhone}`);
    } catch (smsErr) {
      console.error("Failed to send Shoutout SMS on phone change resend:", smsErr.message);
    }

    return res.status(200).json({
      status: true,
      referenceId,
      signupToken: newSignupToken,
      message: "Verification code has been resent to your new mobile number.",
    });
  } catch (error) {
    console.error("Resend phone change OTP error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

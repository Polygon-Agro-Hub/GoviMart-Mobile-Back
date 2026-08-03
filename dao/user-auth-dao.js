const db = require("../startup/database");
const bcrypt = require("bcrypt");

// Login User
exports.loginUser = async (identifier, password) => {
  try {
    let phone1 = identifier;
    let phone2 = identifier;
    let phone3 = identifier;

    // Normalise Sri Lankan mobile numbers
    if (/^[0-9+]+$/.test(identifier)) {
      const cleanNum = identifier.replace(/[^0-9]/g, ""); // Keep only numbers
      if (cleanNum.length === 9 && cleanNum.startsWith("7")) {
        phone1 = cleanNum;
        phone2 = "0" + cleanNum;
        phone3 = "+94" + cleanNum;
      } else if (cleanNum.length === 10 && cleanNum.startsWith("07")) {
        const suffix = cleanNum.substring(1);
        phone1 = suffix;
        phone2 = cleanNum;
        phone3 = "+94" + suffix;
      } else if (cleanNum.length === 11 && cleanNum.startsWith("947")) {
        const suffix = cleanNum.substring(2);
        phone1 = suffix;
        phone2 = "0" + suffix;
        phone3 = "+" + cleanNum;
      }
    }

    const sql = `
      SELECT 
        id, 
        firstName, 
        lastName, 
        email, 
        phoneNumber, 
        password, 
        image, 
        isMarketPlaceUser,
        firstTimeUser,
        buyerType
      FROM marketplaceusers
      WHERE (email = ? 
        OR phoneNumber = ? 
        OR phoneNumber = ? 
        OR phoneNumber = ?)
        AND isMarketPlaceUser = 1
    `;

    const [results] = await db.marketPlace.promise().query(sql, [
      identifier, // email
      phone1,     // phone normalized 1
      phone2,     // phone normalized 2
      phone3      // phone normalized 3
    ]);

    if (results.length === 0) {
      throw new Error("Invalid mobile number/email or password");
    }

    const user = results[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new Error("Invalid mobile number/email or password");
    }

    return {
      success: true,
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      image: user.image,
      firstTimeUser: user.firstTimeUser,
      buyerType: user.buyerType,
    };
  } catch (err) {
    throw new Error(err.message);
  }
};

// Search Cities
exports.searchCitiesDao = async (searchTerm) => {
  try {
    const sql = `
      SELECT 
        d.id,
        d.city,
        d.district,
        d.province,
        CASE WHEN MAX(c.id) IS NOT NULL THEN 1 ELSE 0 END AS isAvailable
      FROM deliverycharge d
      LEFT JOIN centerowncity c ON c.cityId = d.id
      WHERE d.city LIKE ?
      GROUP BY d.id, d.city, d.district, d.province
      ORDER BY isAvailable DESC, d.city ASC
      LIMIT 20
    `;

    const likeTerm = `%${searchTerm}%`;

    const [results] = await db.collectionofficer.promise().query(sql, [likeTerm]);
    return results.map(row => ({
      id: row.id,
      city: row.city,
      district: row.district || "",
      province: row.province || "",
      isAvailable: row.isAvailable === 1 || row.isAvailable === true,
    }));
  } catch (err) {
    console.error("Database error in searchCitiesDao:", err);
    throw new Error("Database error while searching cities: " + err.message);
  }
};

// Get All Cities
exports.getAllCitiesDao = async () => {
  try {
    const sql = `
      SELECT 
        d.id,
        d.city,
        d.district,
        d.province,
        CASE WHEN MAX(c.id) IS NOT NULL THEN 1 ELSE 0 END AS isAvailable
      FROM deliverycharge d
      LEFT JOIN centerowncity c ON c.cityId = d.id
      GROUP BY d.id, d.city, d.district, d.province
      ORDER BY d.city ASC
    `;

    const [results] = await db.collectionofficer.promise().query(sql);
    return results.map(row => ({
      id: row.id,
      city: row.city,
      district: row.district || "",
      province: row.province || "",
      isAvailable: row.isAvailable === 1 || row.isAvailable === true,
    }));
  } catch (err) {
    console.error("Database error in getAllCitiesDao:", err);
    throw new Error("Database error while fetching all cities: " + err.message);
  }
};

// Get Last Customer ID
exports.getMarketPlaceUserLastCusIdDao = async () => {
  try {
    const sql = `
      SELECT cusId
      FROM marketplaceusers
      WHERE cusId LIKE 'MAR-%'
      ORDER BY CAST(SUBSTRING(cusId, 5) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const [results] = await db.marketPlace.promise().query(sql);
    return results[0] ? results[0].cusId : null;
  } catch (err) {
    console.error("Database error in getMarketPlaceUserLastCusIdDao:", err);
    throw err;
  }
};

// Get User By Email
exports.getUserByEmailDao = async (email) => {
  try {
    const sql = "SELECT * FROM marketplaceusers WHERE email = ?";
    const [results] = await db.marketPlace.promise().query(sql, [email]);
    return results[0] || null;
  } catch (err) {
    console.error("Database error in getUserByEmailDao:", err);
    throw err;
  }
};

// Sign Up User
exports.signupUserDao = async (user, hashedPassword, nextId) => {
  try {
    const sql = `
      INSERT INTO marketplaceusers 
      (title, firstName, lastName, phoneCode, phoneNumber, phoneCode2, phoneNumber2, buyerType, email, password, isMarketPlaceUser, isSubscribe, companyName, companyPhoneCode, companyPhone, cusId, nearesCity) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      user.title,
      user.firstName,
      user.lastName,
      user.phoneCode,
      user.phoneNumber,
      user.phoneCode2 || null,
      user.phoneNumber2 || null,
      user.buyerType,
      user.email,
      hashedPassword,
      1,
      user.agreeToMarketing ? 1 : 0,
      user.companyName || null,
      user.companyPhoneCode || null,
      user.companyPhoneNumber || null,
      nextId,
      user.city || null,
    ];

    const [results] = await db.marketPlace.promise().query(sql, values);
    
    if (results.affectedRows === 1) {
      return {
        status: true,
        message: "User registered successfully.",
        data: { userId: results.insertId },
      };
    } else {
      return {
        status: false,
        message: "User registration failed, no rows affected.",
      };
    }
  } catch (err) {
    console.error("Database error in signupUserDao:", err);
    throw err;
  }
};

exports.saveOtpDao = async (referenceId, email, otp, expiresAt) => {
  try {
    const sql = `
      INSERT INTO resetpasswordtoken (userId, resetPasswordToken, otpCode, otpEmail, otpExpiresAt)
      VALUES (NULL, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        otpCode = VALUES(otpCode),
        otpEmail = VALUES(otpEmail),
        otpExpiresAt = VALUES(otpExpiresAt)
    `;
    const [result] = await db.marketPlace.promise().query(sql, [referenceId, otp, email, expiresAt]);
    return result;
  } catch (err) {
    console.error("Database error in saveOtpDao:", err);
    throw err;
  }
};

exports.getOtpDao = async (referenceId) => {
  try {
    const sql = `
      SELECT otpCode AS otp, otpExpiresAt AS expiresAt, otpEmail AS otpEmail
      FROM resetpasswordtoken
      WHERE resetPasswordToken = ? LIMIT 1
    `;
    const [results] = await db.marketPlace.promise().query(sql, [referenceId]);
    return results.length > 0 ? results[0] : null;
  } catch (err) {
    console.error("Database error in getOtpDao:", err);
    throw err;
  }
};

exports.deleteOtpDao = async (referenceId) => {
  try {
    const sql = "DELETE FROM resetpasswordtoken WHERE resetPasswordToken = ?";
    const [result] = await db.marketPlace.promise().query(sql, [referenceId]);
    return result;
  } catch (err) {
    console.error("Database error in deleteOtpDao:", err);
    throw err;
  }
};

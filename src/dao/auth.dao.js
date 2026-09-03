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
        nic,
        image, 
        isMarketPlaceUser,
        firstTimeUser,
        buyerType,
        isDashUser,
        isPswUpdateed
      FROM marketplaceusers
      WHERE (email = ? 
        OR phoneNumber = ? 
        OR phoneNumber = ? 
        OR phoneNumber = ?)
        AND (isMarketPlaceUser = 1 OR isDashUser = 1)
    `;

    const [results] = await db.collectionofficer.promise().query(sql, [
      identifier, // email
      phone1,     // phone normalized 1
      phone2,     // phone normalized 2
      phone3      // phone normalized 3
    ]);

    if (results.length === 0) {
      throw new Error("Invalid mobile number/email or password");
    }

    const user = results[0];

    let isPasswordValid = false;
    try {
      if (user.password) {
        isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid && /^[0-9]{9}[vVxX]$/.test(password)) {
          isPasswordValid = await bcrypt.compare(password.toUpperCase(), user.password);
        }
      }
    } catch (e) {
      // Ignored
    }

    // Fallback: Plain-text password check
    if (!isPasswordValid && password === user.password) {
      isPasswordValid = true;
    }

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
      isDashUser: user.isDashUser,
      isPswUpdateed: user.isPswUpdateed,
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

// Update City Availability (adds/removes mapping in centerowncity) and emits socket update
exports.updateCityAvailabilityDao = async (cityId, isAvailable, companyCenterId = 1) => {
  try {
    if (isAvailable) {
      const checkSql = `SELECT id FROM centerowncity WHERE cityId = ?`;
      const [existing] = await db.collectionofficer.promise().query(checkSql, [cityId]);
      if (!existing || existing.length === 0) {
        const insertSql = `INSERT INTO centerowncity (companyCenterId, cityId) VALUES (?, ?)`;
        await db.collectionofficer.promise().query(insertSql, [companyCenterId, cityId]);
      }
    } else {
      const deleteSql = `DELETE FROM centerowncity WHERE cityId = ?`;
      await db.collectionofficer.promise().query(deleteSql, [cityId]);
    }

    const updatedCities = await exports.getAllCitiesDao();
    const { emitCityAvailabilityUpdate } = require("../socket/socket");
    emitCityAvailabilityUpdate(updatedCities);

    return updatedCities;
  } catch (err) {
    console.error("Database error in updateCityAvailabilityDao:", err);
    throw new Error("Database error while updating city availability: " + err.message);
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
    const [results] = await db.collectionofficer.promise().query(sql);
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
    const [results] = await db.collectionofficer.promise().query(sql, [email]);
    return results[0] || null;
  } catch (err) {
    console.error("Database error in getUserByEmailDao:", err);
    throw err;
  }
};

// Get User By Phone across phoneNumber, phoneNumber2, and companyPhone
exports.getUserByPhoneDao = async (phoneCode, phoneNumber) => {
  try {
    const raw = String(phoneNumber || "").trim();
    if (!raw) return null;
    const cleanNum = raw.replace(/[^0-9]/g, "");
    const candidates = new Set([raw, cleanNum]);

    if (phoneCode === "+94" || cleanNum.startsWith("7") || cleanNum.startsWith("07") || cleanNum.startsWith("947")) {
      if (cleanNum.length === 9 && cleanNum.startsWith("7")) {
        candidates.add(cleanNum);
        candidates.add("0" + cleanNum);
        candidates.add("+94" + cleanNum);
        candidates.add("94" + cleanNum);
      } else if (cleanNum.length === 10 && cleanNum.startsWith("07")) {
        const suffix = cleanNum.substring(1);
        candidates.add(suffix);
        candidates.add(cleanNum);
        candidates.add("+94" + suffix);
        candidates.add("94" + suffix);
      } else if (cleanNum.length === 11 && cleanNum.startsWith("947")) {
        const suffix = cleanNum.substring(2);
        candidates.add(suffix);
        candidates.add("0" + suffix);
        candidates.add("+" + cleanNum);
        candidates.add(cleanNum);
      }
    }

    const phoneList = Array.from(candidates).filter(Boolean);
    if (phoneList.length === 0) return null;
    const placeholders = phoneList.map(() => "?").join(", ");
    const sql = `
      SELECT * FROM marketplaceusers 
      WHERE phoneNumber IN (${placeholders}) 
         OR phoneNumber2 IN (${placeholders}) 
         OR companyPhone IN (${placeholders}) 
      LIMIT 1
    `;
    const [results] = await db.collectionofficer.promise().query(sql, [
      ...phoneList,
      ...phoneList,
      ...phoneList,
    ]);
    return results[0] || null;
  } catch (err) {
    console.error("Database error in getUserByPhoneDao:", err);
    throw err;
  }
};

// Get User By NIC
exports.getUserByNicDao = async (nic) => {
  try {
    const rawNic = String(nic || "").trim();
    if (!rawNic) return null;
    const upperNic = rawNic.toUpperCase();
    const lowerNic = rawNic.toLowerCase();
    const candidates = [...new Set([rawNic, upperNic, lowerNic])];

    const placeholders = candidates.map(() => "?").join(", ");
    const sql = `SELECT * FROM marketplaceusers WHERE nic IN (${placeholders}) LIMIT 1`;
    const [results] = await db.collectionofficer.promise().query(sql, candidates);
    return results[0] || null;
  } catch (err) {
    console.error("Database error in getUserByNicDao:", err);
    throw err;
  }
};

// Sign Up User
exports.signupUserDao = async (user, hashedPassword, nextId) => {
  try {
    const sql = `
      INSERT INTO marketplaceusers 
      (title, firstName, lastName, phoneCode, phoneNumber, phoneCode2, phoneNumber2, buyerType, email, nic, password, isMarketPlaceUser, isSubscribe, companyName, companyPhoneCode, companyPhone, cusId, nearesCity) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      user.nic,
      hashedPassword,
      1,
      0,
      user.companyName || null,
      user.companyPhoneCode || null,
      user.companyPhoneNumber || null,
      nextId,
      user.city || null,
    ];

    const [results] = await db.collectionofficer.promise().query(sql, values);

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
    const [result] = await db.collectionofficer.promise().query(sql, [referenceId, otp, email, expiresAt]);
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
    const [results] = await db.collectionofficer.promise().query(sql, [referenceId]);
    return results.length > 0 ? results[0] : null;
  } catch (err) {
    console.error("Database error in getOtpDao:", err);
    throw err;
  }
};

exports.deleteOtpDao = async (referenceId) => {
  try {
    const sql = "DELETE FROM resetpasswordtoken WHERE resetPasswordToken = ?";
    const [result] = await db.collectionofficer.promise().query(sql, [referenceId]);
    return result;
  } catch (err) {
    console.error("Database error in deleteOtpDao:", err);
    throw err;
  }
};

exports.getUserPasswordByIdDao = async (userId) => {
  try {
    const sql = "SELECT id, password, nic FROM marketplaceusers WHERE id = ? LIMIT 1";
    const [results] = await db.collectionofficer.promise().query(sql, [userId]);
    return results[0] || null;
  } catch (err) {
    console.error("Database error in getUserPasswordByIdDao:", err);
    throw err;
  }
};

exports.updatePasswordDao = async (userId, hashedPassword) => {
  try {
    const sql = "UPDATE marketplaceusers SET password = ?, isPswUpdateed = 1 WHERE id = ?";
    const [result] = await db.collectionofficer.promise().query(sql, [hashedPassword, userId]);
    return result.affectedRows === 1;
  } catch (err) {
    console.error("Database error in updatePasswordDao:", err);
    throw err;
  }
};

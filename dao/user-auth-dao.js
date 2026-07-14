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
        isMarketPlaceUser
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
    };
  } catch (err) {
    throw new Error(err.message);
  }
};

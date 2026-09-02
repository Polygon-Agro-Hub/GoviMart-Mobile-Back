const db = require("../startup/database");

exports.getCustomerProfileDao = async (userId) => {
  const query =
    "SELECT id, cusId, title, firstName, lastName, phoneCode, phoneNumber, email, buyerType, companyName, creditBalance FROM marketplaceusers WHERE id = ?";
  const [results] = await db.marketPlace.promise().query(query, [userId]);
  return results;
};

exports.getSuggestionsDao = async () => {
  const query = `
    SELECT DISTINCT 
      mi.id,
      mi.displayName,
      cv.image
    FROM marketplaceitems mi
    JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
    WHERE mi.category = 'Retail'
    ORDER BY mi.displayName ASC
  `;
  const [results] = await db.marketPlace.promise().query(query);
  return results;
};

exports.getIncludeItemsDao = async (userId) => {
  const query = `
    SELECT DISTINCT 
      mi.id,
      mi.displayName, 
      cv.image
    FROM preferlist pl 
    JOIN marketplaceitems mi ON pl.mpItemId = mi.id
    JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
    WHERE pl.userId = ? AND mi.category = 'Retail'
    ORDER BY mi.displayName ASC
  `;
  const [results] = await db.marketPlace.promise().query(query, [userId]);
  return results;
};

exports.addIncludeItemsDao = async (userId, items) => {
  const placeholders = items.map(() => "?").join(",");
  const isIds = typeof items[0] === "number";
  const field = isIds ? "mi.id" : "mi.displayName";

  const query = `
    INSERT IGNORE INTO preferlist (userId, mpItemId)
    SELECT ?, mi.id
    FROM marketplaceitems mi
    WHERE mi.category = 'Retail' AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace
    .promise()
    .query(query, [userId, ...items]);
  return results;
};

exports.deleteIncludeItemsDao = async (userId, items) => {
  const placeholders = items.map(() => "?").join(",");
  const isIds = typeof items[0] === "number";
  const field = isIds ? "mi.id" : "mi.displayName";

  const query = `
    DELETE pl FROM preferlist pl
    JOIN marketplaceitems mi ON pl.mpItemId = mi.id
    WHERE pl.userId = ? AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace
    .promise()
    .query(query, [userId, ...items]);
  return results;
};

exports.getExcludeItemsDao = async (userId) => {
  const query = `
    SELECT DISTINCT 
      mi.id,
      mi.displayName, 
      cv.image
    FROM excludelist el 
    JOIN marketplaceitems mi ON el.mpItemId = mi.id
    JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
    WHERE el.userId = ? AND mi.category = 'Retail'
    ORDER BY mi.displayName ASC
  `;
  const [results] = await db.marketPlace.promise().query(query, [userId]);
  return results;
};

exports.addExcludeItemsDao = async (userId, items) => {
  const placeholders = items.map(() => "?").join(",");
  const isIds = typeof items[0] === "number";
  const field = isIds ? "mi.id" : "mi.displayName";

  const query = `
    INSERT IGNORE INTO excludelist (userId, mpItemId)
    SELECT ?, mi.id
    FROM marketplaceitems mi
    WHERE mi.category = 'Retail' AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace
    .promise()
    .query(query, [userId, ...items]);
  return results;
};

exports.deleteExcludeItemsDao = async (userId, items) => {
  const placeholders = items.map(() => "?").join(",");
  const isIds = typeof items[0] === "number";
  const field = isIds ? "mi.id" : "mi.displayName";

  const query = `
    DELETE el FROM excludelist el
    JOIN marketplaceitems mi ON el.mpItemId = mi.id
    WHERE el.userId = ? AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace
    .promise()
    .query(query, [userId, ...items]);
  return results;
};

exports.updateUserStatusDao = async (userId) => {
  const query = `
    UPDATE marketplaceusers
    SET firstTimeUser = 1
    WHERE id = ? AND firstTimeUser = 0
  `;
  const [result] = await db.marketPlace.promise().query(query, [userId]);
  return result;
};

exports.getSavedAddressesByCustomerIdDao = async (customerId) => {
  const apartmentQuery = `
    SELECT 
      id,
      'Apartment' as buildingType,
      saveAs,
      billingTitle as title,
      billingName as fullName,
      billingPhoneCode1 as phonecode1,
      billingPhone1 as phone1,
      billingPhoneCode2 as phonecode2,
      billingPhone2 as phone2,
      longitude,
      latitude,
      buildingNo,
      buildingName,
      unitNo,
      floorNo,
      houseNo,
      streetName,
      city
    FROM apartment
    WHERE customerId = ?
  `;

  const houseQuery = `
    SELECT 
      id,
      'House' as buildingType,
      saveAs,
      billingTitle as title,
      billingName as fullName,
      billingPhoneCode1 as phonecode1,
      billingPhone1 as phone1,
      billingPhoneCode2 as phonecode2,
      billingPhone2 as phone2,
      longitude,
      latitude,
      NULL as buildingNo,
      NULL as buildingName,
      NULL as unitNo,
      NULL as floorNo,
      houseNo,
      streetName,
      city
    FROM house
    WHERE customerId = ?
  `;

  const [apartmentResults] = await db.marketPlace
    .promise()
    .query(apartmentQuery, [customerId]);
  const [houseResults] = await db.marketPlace
    .promise()
    .query(houseQuery, [customerId]);

  const combined = [
    ...apartmentResults.map((r) => ({
      ...r,
      addressKey: `apartment_${r.id}`,
    })),
    ...houseResults.map((r) => ({
      ...r,
      addressKey: `house_${r.id}`,
    })),
  ];

  combined.sort((a, b) => {
    const aName = (a.saveAs || "").trim();
    const bName = (b.saveAs || "").trim();

    if (!aName && !bName) return 0;
    if (!aName) return 1;
    if (!bName) return -1;

    return aName.localeCompare(bName, undefined, { sensitivity: "base" });
  });

  return combined;
};

exports.getAccountDetailsDao = async (userId) => {
  const query = `
    SELECT 
      id,
      cusId,
      title,
      firstName,
      lastName,
      phoneCode,
      phoneNumber,
      phoneCode2,
      phoneNumber2,
      nic,
      buyerType,
      email,
      companyPhoneCode,
      companyPhone,
      companyName,
      rateofCus,
      creditBalance,
      nearesCity
    FROM marketplaceusers
    WHERE id = ?
  `;
  const [results] = await db.marketPlace.promise().query(query, [userId]);
  return results;
};

exports.addAddressDao = async (customerId, addressData) => {
  const {
    buildingType,
    saveAs,
    title,
    fullName,
    phonecode1,
    phone1,
    phonecode2,
    phone2,
    longitude,
    latitude,
    buildingNo,
    buildingName,
    unitNo,
    floorNo,
    houseNo,
    streetName,
    city,
  } = addressData;

  if (buildingType === "Apartment") {
    const query = `
      INSERT INTO apartment (
        customerId, saveAs, billingTitle, billingName,
        billingPhoneCode1, billingPhone1, billingPhoneCode2, billingPhone2,
        longitude, latitude, buildingNo, buildingName, unitNo, floorNo,
        houseNo, streetName, city
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.marketPlace
      .promise()
      .query(query, [
        customerId,
        saveAs,
        title,
        fullName,
        phonecode1,
        phone1,
        phonecode2,
        phone2,
        longitude,
        latitude,
        buildingNo,
        buildingName,
        unitNo,
        floorNo,
        houseNo,
        streetName,
        city,
      ]);
    return { insertId: result.insertId, buildingType };
  }

  // House
  const query = `
    INSERT INTO house (
      customerId, saveAs, billingTitle, billingName,
      billingPhoneCode1, billingPhone1, billingPhoneCode2, billingPhone2,
      longitude, latitude, houseNo, streetName, city
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await db.marketPlace
    .promise()
    .query(query, [
      customerId,
      saveAs,
      title,
      fullName,
      phonecode1,
      phone1,
      phonecode2,
      phone2,
      longitude,
      latitude,
      houseNo,
      streetName,
      city,
    ]);
  return { insertId: result.insertId, buildingType };
};

exports.updateAddressDao = async (addressId, customerId, addressData) => {
  const {
    buildingType,
    saveAs,
    title,
    fullName,
    phonecode1,
    phone1,
    phonecode2,
    phone2,
    longitude,
    latitude,
    buildingNo,
    buildingName,
    unitNo,
    floorNo,
    houseNo,
    streetName,
    city,
  } = addressData;

  if (buildingType === "Apartment") {
    const query = `
      UPDATE apartment
      SET saveAs = ?, billingTitle = ?, billingName = ?,
          billingPhoneCode1 = ?, billingPhone1 = ?, billingPhoneCode2 = ?, billingPhone2 = ?,
          longitude = ?, latitude = ?, buildingNo = ?, buildingName = ?, unitNo = ?, floorNo = ?,
          houseNo = ?, streetName = ?, city = ?
      WHERE id = ? AND customerId = ?
    `;
    const [result] = await db.marketPlace
      .promise()
      .query(query, [
        saveAs,
        title,
        fullName,
        phonecode1,
        phone1,
        phonecode2,
        phone2,
        longitude,
        latitude,
        buildingNo,
        buildingName,
        unitNo,
        floorNo,
        houseNo,
        streetName,
        city,
        addressId,
        customerId,
      ]);
    return result;
  }

  // House
  const query = `
    UPDATE house
    SET saveAs = ?, billingTitle = ?, billingName = ?,
        billingPhoneCode1 = ?, billingPhone1 = ?, billingPhoneCode2 = ?, billingPhone2 = ?,
        longitude = ?, latitude = ?, houseNo = ?, streetName = ?, city = ?
    WHERE id = ? AND customerId = ?
  `;
  const [result] = await db.marketPlace
    .promise()
    .query(query, [
      saveAs,
      title,
      fullName,
      phonecode1,
      phone1,
      phonecode2,
      phone2,
      longitude,
      latitude,
      houseNo,
      streetName,
      city,
      addressId,
      customerId,
    ]);
  return result;
};

exports.deleteAddressDao = async (addressId, customerId, buildingType) => {
  const table = buildingType === "Apartment" ? "apartment" : "house";
  const query = `DELETE FROM ${table} WHERE id = ? AND customerId = ?`;
  const [result] = await db.marketPlace
    .promise()
    .query(query, [addressId, customerId]);
  return result;
};

exports.updateUserDetailsDao = async (userId, userData) => {
  const {
    title,
    firstName,
    lastName,
    phoneCode,
    phoneNumber,
    phoneCode2,
    phoneNumber2,
    nic,
    email,
    companyPhoneCode,
    companyPhone,
    companyName,
    buyerType,
  } = userData;

  const query = `
    UPDATE marketplaceusers
    SET title = ?, firstName = ?, lastName = ?,
        phoneCode = ?, phoneNumber = ?, phoneCode2 = ?, phoneNumber2 = ?,
        nic = ?, email = ?, companyPhoneCode = ?, companyPhone = ?,
        companyName = ?, buyerType = ?
    WHERE id = ?
  `;
  const [result] = await db.marketPlace
    .promise()
    .query(query, [
      title,
      firstName,
      lastName,
      phoneCode,
      phoneNumber,
      phoneCode2,
      phoneNumber2,
      nic,
      email,
      companyPhoneCode,
      companyPhone,
      companyName,
      buyerType,
      userId,
    ]);
  return result;
};

exports.deleteUserAccountDao = async (userId) => {
  const query = `DELETE FROM marketplaceusers WHERE id = ?`;
  const [result] = await db.marketPlace.promise().query(query, [userId]);
  return result;
};

// Check if a phone number already belongs to another user (across phoneNumber, phoneNumber2, companyPhone)
exports.isPhoneTakenDao = async (userId, phoneNumber) => {
  if (!phoneNumber) return false;
  const raw = String(phoneNumber || "").trim();
  const cleanNum = raw.replace(/[^0-9]/g, "");
  const candidates = new Set([raw, cleanNum]);

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

  const phoneList = Array.from(candidates).filter(Boolean);
  if (phoneList.length === 0) return false;
  const placeholders = phoneList.map(() => "?").join(", ");
  const query = `
    SELECT id FROM marketplaceusers
    WHERE (phoneNumber IN (${placeholders}) OR phoneNumber2 IN (${placeholders}) OR companyPhone IN (${placeholders}))
      AND id != ?
    LIMIT 1
  `;
  const [results] = await db.marketPlace.promise().query(query, [
    ...phoneList,
    ...phoneList,
    ...phoneList,
    userId,
  ]);
  return results.length > 0;
};

// Check if an NIC already belongs to another user
exports.isNicTakenDao = async (userId, nic) => {
  if (!nic) return false;
  const rawNic = String(nic).trim();
  const upperNic = rawNic.toUpperCase();
  const lowerNic = rawNic.toLowerCase();
  const candidates = [...new Set([rawNic, upperNic, lowerNic])];
  const placeholders = candidates.map(() => "?").join(", ");
  const query = `
    SELECT id FROM marketplaceusers
    WHERE nic IN (${placeholders}) AND id != ?
    LIMIT 1
  `;
  const [results] = await db.marketPlace.promise().query(query, [...candidates, userId]);
  return results.length > 0;
};

// Update only the user's phone number (after OTP verification)
exports.updateUserPhoneDao = async (userId, phoneCode, phoneNumber) => {
  const query = `
    UPDATE marketplaceusers
    SET phoneCode = ?, phoneNumber = ?
    WHERE id = ?
  `;
  const [result] = await db.marketPlace.promise().query(query, [phoneCode, phoneNumber, userId]);
  return result;
};

// Update user credit balance (clear balance or adjust)
exports.updateCreditBalanceDao = async (userId, creditBalance) => {
  const query = `
    UPDATE marketplaceusers
    SET creditBalance = creditBalance + ?
    WHERE id = ?
  `;
  const [result] = await db.marketPlace.promise().query(query, [creditBalance, userId]);
  if (result.affectedRows === 0) {
    throw new Error("User not found");
  }

  const [rows] = await db.marketPlace.promise().query(
    "SELECT creditBalance FROM marketplaceusers WHERE id = ?",
    [userId]
  );

  return {
    userId,
    creditBalance: parseFloat(rows[0]?.creditBalance || 0),
    affectedRows: result.affectedRows,
  };
};

const db = require("../startup/database");

exports.getCustomerProfileDao = async (userId) => {
  const query = "SELECT id, cusId, title, firstName, lastName, phoneCode, phoneNumber, email, buyerType, companyName FROM marketplaceusers WHERE id = ?";
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
  const placeholders = items.map(() => '?').join(',');
  const isIds = typeof items[0] === 'number';
  const field = isIds ? 'mi.id' : 'mi.displayName';

  const query = `
    INSERT IGNORE INTO preferlist (userId, mpItemId)
    SELECT ?, mi.id
    FROM marketplaceitems mi
    WHERE mi.category = 'Retail' AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace.promise().query(query, [userId, ...items]);
  return results;
};

exports.deleteIncludeItemsDao = async (userId, items) => {
  const placeholders = items.map(() => '?').join(',');
  const isIds = typeof items[0] === 'number';
  const field = isIds ? 'mi.id' : 'mi.displayName';

  const query = `
    DELETE pl FROM preferlist pl
    JOIN marketplaceitems mi ON pl.mpItemId = mi.id
    WHERE pl.userId = ? AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace.promise().query(query, [userId, ...items]);
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
  const placeholders = items.map(() => '?').join(',');
  const isIds = typeof items[0] === 'number';
  const field = isIds ? 'mi.id' : 'mi.displayName';

  const query = `
    INSERT IGNORE INTO excludelist (userId, mpItemId)
    SELECT ?, mi.id
    FROM marketplaceitems mi
    WHERE mi.category = 'Retail' AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace.promise().query(query, [userId, ...items]);
  return results;
};

exports.deleteExcludeItemsDao = async (userId, items) => {
  const placeholders = items.map(() => '?').join(',');
  const isIds = typeof items[0] === 'number';
  const field = isIds ? 'mi.id' : 'mi.displayName';

  const query = `
    DELETE el FROM excludelist el
    JOIN marketplaceitems mi ON el.mpItemId = mi.id
    WHERE el.userId = ? AND ${field} IN (${placeholders})
  `;
  const [results] = await db.marketPlace.promise().query(query, [userId, ...items]);
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

const db = require("../startup/database");

exports.getAllSlidesDao = async () => {
  try {
    const query = "SELECT * FROM banners ORDER BY COALESCE(indexId, 999999) ASC, createdAt DESC";
    const [results] = await db.collectionofficer.promise().query(query);
    return results;
  } catch (err) {
    console.error("Database error in getAllSlidesDao:", err);
    throw err;
  }
};

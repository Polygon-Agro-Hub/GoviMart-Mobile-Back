const db = require("../startup/database");

exports.getAllSlidesDao = async () => {
  try {
    const query = "SELECT * FROM banners ORDER BY createdAt DESC";
    const [results] = await db.marketPlace.promise().query(query);
    return results;
  } catch (err) {
    console.error("Database error in getAllSlidesDao:", err);
    throw err;
  }
};

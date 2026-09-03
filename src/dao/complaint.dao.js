const db = require("../startup/database");

// Get All Complain Categories for App ID 9
exports.getComplainCategoriesDao = async () => {
  try {
    const sql = `
      SELECT 
        cc.id,
        cc.roleId,
        cc.appId,
        cc.categoryEnglish,
        cc.categorySinhala,
        cc.categoryTamil,
        cc.modifyBy
      FROM agro_world_admin.complaincategory cc
      WHERE cc.appId = 9
      ORDER BY cc.categoryEnglish ASC
    `;

    const [results] = await db.admin.promise().query(sql);
    return results;
  } catch (err) {
    console.error("Database error in getComplainCategoriesDao:", err);
    throw new Error(
      "Database error while fetching complain categories: " + err.message,
    );
  }
};

// Get Last Complain Ref ID
exports.getLastComplainRefIdDao = async () => {
  try {
    const sql = `
      SELECT refId
      FROM marcketplacecomplain
      WHERE refId LIKE 'CMP-%'
      ORDER BY CAST(SUBSTRING(refId, 5) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const [results] = await db.collectionofficer.promise().query(sql);
    return results[0] ? results[0].refId : null;
  } catch (err) {
    console.error("Database error in getLastComplainRefIdDao:", err);
    throw err;
  }
};

// Create Complain
exports.createComplainDao = async (
  userId,
  complaicategoryId,
  refId,
  complain,
) => {
  try {
    const sql = `
      INSERT INTO marcketplacecomplain 
      (userId, complaicategoryId, refId, complain, status, createdAt) 
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    const [result] = await db.collectionofficer
      .promise()
      .query(sql, [userId, complaicategoryId, refId, complain, "Pending"]);
    return result.insertId;
  } catch (err) {
    console.error("Database error in createComplainDao:", err);
    throw err;
  }
};

// Insert Complain Image
exports.addComplainImageDao = async (complainId, imageUrl) => {
  try {
    const sql = `
      INSERT INTO marcketplacecomplainimages (complainId, image, createdAt) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `;
    const [result] = await db.collectionofficer
      .promise()
      .query(sql, [complainId, imageUrl]);
    return result;
  } catch (err) {
    console.error("Database error in addComplainImageDao:", err);
    throw err;
  }
};

// Get Complain By ID (with category info + images)
exports.getComplainByIdDao = async (complainId) => {
  try {
    const complainSql = `
      SELECT 
        c.id,
        c.userId,
        c.complaicategoryId,
        cc.categoryEnglish,
        cc.categorySinhala,
        cc.categoryTamil,
        c.refId,
        c.complain,
        c.reply,
        c.status,
        c.replyBy,
        c.replyTime,
        c.createdAt
      FROM marcketplacecomplain c
      LEFT JOIN agro_world_admin.complaincategory cc ON cc.id = c.complaicategoryId
      WHERE c.id = ?
    `;
    const [complainResults] = await db.collectionofficer
      .promise()
      .query(complainSql, [complainId]);

    if (complainResults.length === 0) return null;

    const imagesSql = `SELECT id, image FROM marcketplacecomplainimages WHERE complainId = ?`;
    const [imageResults] = await db.collectionofficer
      .promise()
      .query(imagesSql, [complainId]);

    return {
      ...complainResults[0],
      images: imageResults,
    };
  } catch (err) {
    console.error("Database error in getComplainByIdDao:", err);
    throw new Error("Database error while fetching complain: " + err.message);
  }
};

exports.getComplainsByUserIdDao = async (userId) => {
  try {
    const complainSql = `
      SELECT 
        c.id,
        c.complaicategoryId,
        cc.categoryEnglish,
        cc.categorySinhala,
        cc.categoryTamil,
        c.refId,
        c.complain,
        c.reply,
        c.status,
        c.replyBy,
        c.replyTime,
        c.createdAt
      FROM marcketplacecomplain c
      LEFT JOIN agro_world_admin.complaincategory cc ON cc.id = c.complaicategoryId
      WHERE c.userId = ?
      ORDER BY c.createdAt DESC
    `;
    const [complains] = await db.collectionofficer
      .promise()
      .query(complainSql, [userId]);

    if (complains.length === 0) return [];

    const complainIds = complains.map((c) => c.id);
    const imagesSql = `
      SELECT id, complainId, image 
      FROM marcketplacecomplainimages 
      WHERE complainId IN (?)
    `;
    const [images] = await db.collectionofficer
      .promise()
      .query(imagesSql, [complainIds]);

    return complains.map((c) => ({
      ...c,
      images: images
        .filter((img) => img.complainId === c.id)
        .map((img) => ({
          id: img.id,
          image: img.image,
        })),
    }));
  } catch (err) {
    console.error("Database error in getComplainsByUserIdDao:", err);
    throw new Error(
      "Database error while fetching user complains: " + err.message,
    );
  }
};

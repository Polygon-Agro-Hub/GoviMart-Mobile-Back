const db = require("../startup/database");

exports.getProductsByCategoryDao = (category, search, buyerType = "Retail") => {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT 
        m.id,
        m.displayName,
        m.normalPrice,
        m.discountedPrice,
        m.discount,
        m.comPrice,
        m.promo,
        m.unitType,
        m.startValue,
        m.changeby,
        m.displayType,
        m.tags,
        v.varietyNameEnglish,
        v.varietyNameSinhala,
        v.varietyNameTamil,
        v.image,
        c.cropNameEnglish,
        c.cropNameSinhala,
        c.cropNameTamil,
        c.category
      FROM marketplaceitems m
      JOIN plant_care.cropvariety v ON m.varietyId = v.id
      JOIN plant_care.cropgroup c ON v.cropGroupId = c.id
      WHERE LOWER(m.category) = LOWER(?)
        AND m.isEnable = 1
    `;

    const params = [buyerType || "Retail"];

    if (category && (!search || search.trim() === "")) {
      let categoryCondition = "";

      if (category === "Vegetables") {
        categoryCondition = ` AND c.category IN (?, ?)`;
        params.push("Vegetables", "Mushrooms");
      } else if (category === "Cereals") {
        categoryCondition = ` AND c.category IN (?, ?, ?, ?)`;
        params.push("Cereals", "Legumes", "Pulses", "Grain");
      } else if (category === "Spices") {
        categoryCondition = ` AND c.category = ?`;
        params.push("Spices");
      } else if (category === "Fruits" || category === "Fruit") {
        categoryCondition = ` AND c.category = ?`;
        params.push("Fruit");
      } else {
        // For any other category, use exact match
        categoryCondition = ` AND c.category = ?`;
        params.push(category);
      }

      sql += categoryCondition;
    }

    // Add search condition if search is provided
    if (search && search.trim() !== "") {
      sql += ` AND (m.displayName LIKE ? OR m.tags LIKE ?)`;
      const searchParam = `%${search.trim()}%`;
      params.push(searchParam, searchParam);
    }

    sql += ` ORDER BY m.displayName ASC`;

    db.collectionofficer.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        // Format the results to handle discount price formatting and calculate discount percentage
        const formattedResults = results.map((item) => {
          // Calculate discount percentage
          let discountPercentage = null;
          if (
            item.normalPrice &&
            item.discountedPrice &&
            item.normalPrice > item.discountedPrice
          ) {
            const discount =
              ((item.normalPrice - item.discountedPrice) / item.normalPrice) *
              100;
            // Format percentage: if whole number, show as integer; if decimal, show with decimals
            discountPercentage =
              discount % 1 === 0
                ? Math.round(discount)
                : Math.round(discount * 100) / 100;
          }

          return {
            ...item,
            discountedPrice:
              item.discountedPrice % 1 === 0
                ? parseInt(item.discountedPrice)
                : item.discountedPrice,
            discount: discountPercentage,
          };
        });
        resolve(formattedResults);
      }
    });
  });
};

exports.getAllSlidesDao = () => {
  return new Promise((resolve, reject) => {
    db.collectionofficer.query(
      "SELECT * FROM banners ORDER BY COALESCE(indexId, 999999) ASC, createdAt DESC",
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      },
    );
  });
};

// Updated DAO Function for Wholesale
exports.getProductsByCategoryDaoWholesale = (category, search) => {
  return exports.getProductsByCategoryDao(category, search, "Wholesale");
};

exports.getAllProductDao = (search) => {
  return new Promise((resolve, reject) => {
    let sql = `
        SELECT mp.id, mp.displayName, mp.image, (mp.productPrice + mp.packingFee + mp.serviceFee) AS subTotal
        FROM marketplacepackages mp
        LEFT JOIN definepackage dp ON mp.id = dp.packageId
        WHERE mp.status = 'Enabled' 
        AND mp.isValid = 1 AND dp.id IS NOT NULL
        `;

    const params = [];

    if (search && search.trim() !== "") {
      sql += ` AND mp.displayName LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    sql += ` 
    GROUP BY mp.id, mp.displayName, mp.image
    ORDER BY mp.displayName ASC`;

    db.collectionofficer.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

/**
 * Given arrays of marketplace item IDs and package IDs,
 * returns a map of id → boolean indicating whether each is still available.
 */
exports.checkAvailabilityDao = (productIds, packageIds) => {
  return new Promise((resolve, reject) => {
    const result = { products: {}, packages: {} };
    let pending = 0;

    const done = (err) => {
      if (err) return reject(err);
      pending -= 1;
      if (pending === 0) resolve(result);
    };

    // Check products (marketplaceitems table — only isEnable = 1 count as available)
    if (productIds && productIds.length > 0) {
      pending += 1;
      const placeholders = productIds.map(() => "?").join(", ");
      const sql = `SELECT id FROM marketplaceitems WHERE id IN (${placeholders}) AND isEnable = 1`;
      db.collectionofficer.query(sql, productIds, (err, rows) => {
        if (err) return done(err);
        const existingIds = new Set(rows.map((r) => Number(r.id)));
        productIds.forEach((id) => {
          result.products[id] = existingIds.has(Number(id));
        });
        done(null);
      });
    }

    // Check packages (marketplacepackages — only Enabled + isValid ones count as available)
    if (packageIds && packageIds.length > 0) {
      pending += 1;
      const placeholders = packageIds.map(() => "?").join(", ");
      const sql = `SELECT id FROM marketplacepackages WHERE id IN (${placeholders}) AND status = 'Enabled' AND isValid = 1`;
      db.collectionofficer.query(sql, packageIds, (err, rows) => {
        if (err) return done(err);
        const existingIds = new Set(rows.map((r) => Number(r.id)));
        packageIds.forEach((id) => {
          result.packages[id] = existingIds.has(Number(id));
        });
        done(null);
      });
    }

    // Both arrays empty — resolve immediately
    if (pending === 0) resolve(result);
  });
};
exports.getAllPackageItemsDao = (packageId) => {
  return new Promise((resolve, reject) => {
    const sql = `
        SELECT 
            pd.id, 
            pd.packageId, 
            pd.qty as quantity, 
            pt.typeName as displayName,
            pt.shortCode,
            pd.productTypeId,
            pd.createdAt
        FROM packagedetails pd
        LEFT JOIN producttypes pt ON pd.productTypeId = pt.id
        WHERE pd.packageId = ?;
        `;
    db.collectionofficer.query(sql, [packageId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

/**
 * Get products filtered by productTypeId using producttypes table
 */
exports.getProductsByProductTypeDao = (productTypeId, buyerType = "Retail") => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        m.id,
        m.displayName,
        m.normalPrice,
        m.discountedPrice,
        m.discount,
        m.comPrice,
        m.promo,
        m.unitType,
        m.startValue,
        m.changeby,
        m.displayType,
        m.tags,
        m.productTypeId,
        pt.id AS typeId,
        pt.typeName AS productTypeName,
        pt.shortCode AS productTypeShortCode,
        v.varietyNameEnglish,
        v.image,
        c.cropNameEnglish,
        c.category
      FROM marketplaceitems m
      INNER JOIN producttypes pt ON m.productTypeId = pt.id
      LEFT JOIN plant_care.cropvariety v ON m.varietyId = v.id
      LEFT JOIN plant_care.cropgroup c ON v.cropGroupId = c.id
      WHERE (m.productTypeId = ? OR pt.typeName = ? OR pt.shortCode = ?)
        AND (m.isEnable = 1 OR m.isEnable IS NULL)
      ORDER BY m.displayName ASC
    `;
    db.collectionofficer.query(sql, [productTypeId, productTypeId, productTypeId], (err, results) => {
      if (err) return reject(err);
      resolve(results || []);
    });
  });
};

/**
 * Get all product types from producttypes table
 */
exports.getProductTypesDao = () => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, typeName, shortCode FROM producttypes ORDER BY id ASC`;
    db.collectionofficer.query(sql, [], (err, results) => {
      if (err) return reject(err);
      resolve(results || []);
    });
  });
};


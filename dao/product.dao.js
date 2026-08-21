const db = require("../startup/database");

exports.getProductsByCategoryDao = (category, search) => {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT 
        m.id,
        m.displayName,
        m.normalPrice,
        m.discountedPrice,
        m.discount,
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
      WHERE m.category = 'Retail'
    `;

    const params = [];

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
      } else if (category === "Fruits") {
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

    db.marketPlace.query(sql, params, (err, results) => {
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
    db.marketPlace.query(
      "SELECT * FROM banners  ORDER BY createdAt DESC",
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      },
    );
  });
};

// Updated DAO Function
exports.getProductsByCategoryDaoWholesale = (category, search) => {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT 
        m.id,
        m.displayName,
        m.normalPrice,
        m.discountedPrice,
        m.discount,
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
      WHERE m.category = 'Wholesale'
    `;

    const params = [];

    // Add category condition only if no search is provided or if search is empty
    if (category && (!search || search.trim() === "")) {
      // Normalize "fruits" to "Fruit" for category matching
      let normalizedCategory =
        category.toLowerCase() === "fruits" ? "Fruit" : category;

      // Handle grouped categories
      if (normalizedCategory === "Vegetables") {
        sql += ` AND (c.category = ? OR c.category = ?)`;
        params.push("Vegetables", "Mushrooms");
      } else if (normalizedCategory === "Cereals") {
        sql += ` AND (c.category = ? OR c.category = ? OR c.category = ? OR c.category = ?)`;
        params.push("Cereals", "Legumes", "Pulses", "Grain");
      } else {
        sql += ` AND c.category = ?`;
        params.push(normalizedCategory);
      }
    }

    // Add search condition if search is provided
    if (search && search.trim() !== "") {
      sql += ` AND (m.displayName LIKE ? OR m.tags LIKE ?)`;
      const searchParam = `%${search.trim()}%`;
      params.push(searchParam, searchParam);
    }

    sql += ` ORDER BY m.displayName ASC`;

    db.marketPlace.query(sql, params, (err, results) => {
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

    db.marketPlace.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
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
    db.marketPlace.query(sql, [packageId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

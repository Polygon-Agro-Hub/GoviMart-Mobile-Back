const db = require("../startup/database");

/**
 * Fetch active cart by userId from collectionofficer DB
 */
exports.getCartByUserIdDao = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, userId, buyerType, isCoupon, couponValue, createdAt FROM cart WHERE userId = ? ORDER BY id DESC LIMIT 1`;
    db.collectionofficer.query(sql, [userId], (err, results) => {
      if (err) return reject(err);
      resolve(results.length > 0 ? results[0] : null);
    });
  });
};

/**
 * Create new cart row for user
 */
exports.createCartDao = (userId, buyerType = "Retail") => {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO cart (userId, buyerType) VALUES (?, ?)`;
    db.collectionofficer.query(sql, [userId, buyerType], (err, results) => {
      if (err) return reject(err);
      resolve(results.insertId);
    });
  });
};

/**
 * Get ala carte products in cart with full marketplace details
 */
exports.getCartProductsDao = (cartId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        cai.id AS cartItemId,
        cai.productId,
        cai.qty AS quantity,
        cai.unit,
        cai.createdAt,
        mi.displayName AS name,
        mi.normalPrice,
        mi.discountedPrice,
        mi.comPrice,
        mi.startValue,
        mi.changeby,
        mi.unitType,
        mi.isEnable,
        cv.image,
        cg.category
      FROM cartadditionalitems cai
      JOIN marketplaceitems mi ON cai.productId = mi.id
      JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
      JOIN plant_care.cropgroup cg ON cv.cropGroupId = cg.id
      WHERE cai.cartId = ?
      ORDER BY cai.createdAt DESC
    `;
    db.collectionofficer.query(sql, [cartId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * Get package items in cart with package details
 */
exports.getCartPackagesDao = (cartId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        cp.id AS cartItemId,
        cp.packageId,
        cp.qty AS quantity,
        cp.createdAt,
        mp.displayName AS name,
        mp.image,
        (mp.productPrice + mp.packingFee + mp.serviceFee) AS price,
        mp.status,
        mp.isValid
      FROM cartpackage cp
      JOIN marketplacepackages mp ON cp.packageId = mp.id
      WHERE cp.cartId = ?
      ORDER BY cp.createdAt DESC
    `;
    db.collectionofficer.query(sql, [cartId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * Check if a product is in cart
 */
exports.checkProductInCartDao = (cartId, productId) => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, qty, unit FROM cartadditionalitems WHERE cartId = ? AND productId = ?`;
    db.collectionofficer.query(sql, [cartId, productId], (err, results) => {
      if (err) return reject(err);
      resolve(results.length > 0 ? results[0] : null);
    });
  });
};

/**
 * Add product item to cart
 */
exports.addProductToCartDao = (cartId, productId, qty, unit) => {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO cartadditionalitems (cartId, productId, qty, unit) VALUES (?, ?, ?, ?)`;
    db.collectionofficer.query(sql, [cartId, productId, qty, unit], (err, results) => {
      if (err) return reject(err);
      resolve(results.insertId);
    });
  });
};

/**
 * Update product item quantity/unit in cart
 */
exports.updateProductQtyInCartDao = (cartId, productId, qty, unit) => {
  return new Promise((resolve, reject) => {
    const sql = unit
      ? `UPDATE cartadditionalitems SET qty = ?, unit = ? WHERE cartId = ? AND productId = ?`
      : `UPDATE cartadditionalitems SET qty = ? WHERE cartId = ? AND productId = ?`;
    const params = unit ? [qty, unit, cartId, productId] : [qty, cartId, productId];
    db.collectionofficer.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * Remove product item from cart
 */
exports.removeProductFromCartDao = (cartId, productId) => {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM cartadditionalitems WHERE cartId = ? AND productId = ?`;
    db.collectionofficer.query(sql, [cartId, productId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * Check if package is in cart
 */
exports.checkPackageInCartDao = (cartId, packageId) => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, qty FROM cartpackage WHERE cartId = ? AND packageId = ?`;
    db.collectionofficer.query(sql, [cartId, packageId], (err, results) => {
      if (err) return reject(err);
      resolve(results.length > 0 ? results[0] : null);
    });
  });
};

/**
 * Add package item to cart
 */
exports.addPackageToCartDao = (cartId, packageId, qty = 1) => {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO cartpackage (cartId, packageId, qty) VALUES (?, ?, ?)`;
    db.collectionofficer.query(sql, [cartId, packageId, qty], (err, results) => {
      if (err) return reject(err);
      resolve(results.insertId);
    });
  });
};

/**
 * Update package item quantity in cart
 */
exports.updatePackageQtyInCartDao = (cartId, packageId, qty) => {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE cartpackage SET qty = ? WHERE cartId = ? AND packageId = ?`;
    db.collectionofficer.query(sql, [qty, cartId, packageId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * Remove package item from cart
 */
exports.removePackageFromCartDao = (cartId, packageId) => {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM cartpackage WHERE cartId = ? AND packageId = ?`;
    db.collectionofficer.query(sql, [cartId, packageId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * Clear all items and delete cart row
 */
exports.clearCartDao = (cartId) => {
  return new Promise((resolve, reject) => {
    db.collectionofficer.query(`DELETE FROM cartadditionalitems WHERE cartId = ?`, [cartId], (err) => {
      if (err) return reject(err);
      db.collectionofficer.query(`DELETE FROM cartpackage WHERE cartId = ?`, [cartId], (err) => {
        if (err) return reject(err);
        db.collectionofficer.query(`DELETE FROM cart WHERE id = ?`, [cartId], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });
    });
  });
};

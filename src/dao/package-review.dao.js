const db = require("../startup/database");

/**
 * Fetch full package review data for an order or process order.
 * Includes orderpackage instances, orderpackageitems, prevdefineproduct baselines,
 * lock status (isLock), and scheduling info.
 */
exports.getOrderPackageReviewDao = (orderIdOrProcessOrderId, userId) => {
    return new Promise((resolve, reject) => {
        if (!orderIdOrProcessOrderId || !userId) {
            return reject(new Error("orderId and userId are required"));
        }

        // 1. Resolve order and processorder
        const orderSql = `
            SELECT 
                o.id AS actualOrderId,
                o.userId,
                o.delivaryMethod,
                o.sheduleDate,
                po.id AS processOrderId,
                po.invNo,
                po.amount,
                po.paymentMethod,
                po.isPaid,
                po.status,
                po.packagePackStatus,
                po.sheduleDate AS processScheduleDate
            FROM processorders po
            INNER JOIN orders o ON po.orderId = o.id
            WHERE (po.id = ? OR o.id = ?) AND o.userId = ?
            ORDER BY po.id DESC
            LIMIT 1
        `;

        db.collectionofficer.query(orderSql, [orderIdOrProcessOrderId, orderIdOrProcessOrderId, userId], async (err, orderRows) => {
            if (err) return reject(err);
            if (!orderRows || orderRows.length === 0) {
                return resolve(null);
            }

            const orderInfo = orderRows[0];
            const actualOrderId = orderInfo.actualOrderId;
            const processOrderId = orderInfo.processOrderId;

            try {
                // 2. Fetch packages for this process order (orderpackage)
                const packagesSql = `
                    SELECT 
                        op.id AS orderPackageId,
                        op.orderId AS processOrderId,
                        op.packageId,
                        op.packingStatus,
                        COALESCE(op.isLock, 0) AS isLock,
                        op.qty,
                        op.createdAt,
                        mp.displayName AS packageName,
                        mp.image AS packageImage,
                        mp.description AS packageDescription,
                        mp.packageType,
                        mp.productPrice AS unitPrice,
                        mp.packingFee,
                        mp.serviceFee,
                        (mp.productPrice + mp.packingFee + mp.serviceFee) AS packageTotalUnit
                    FROM orderpackage op
                    INNER JOIN marketplacepackages mp ON op.packageId = mp.id
                    WHERE op.orderId = ? OR op.orderId = ?
                `;

                const packages = await new Promise((res, rej) => {
                    db.collectionofficer.query(packagesSql, [processOrderId, actualOrderId], (e, r) => e ? rej(e) : res(r || []));
                });

                if (packages.length === 0) {
                    return resolve({
                        orderInfo,
                        packages: [],
                        additionalItems: [],
                    });
                }

                const orderPackageIds = packages.map(p => p.orderPackageId);
                const placeholders = orderPackageIds.map(() => "?").join(", ");

                // 3. Fetch active package items (orderpackageitems)
                const itemsSql = `
                    SELECT 
                        opi.id AS itemId,
                        opi.orderPackageId,
                        COALESCE(opi.productType, mi.productTypeId) AS productType,
                        COALESCE(opi.productType, mi.productTypeId, pt.id) AS productTypeId,
                        opi.productId,
                        opi.packId,
                        opi.qty,
                        opi.price,
                        opi.isPacked,
                        opi.packingTime,
                        mi.displayName AS productName,
                        mi.normalPrice AS baseUnitPrice,
                        mi.discountedPrice,
                        mi.unitType,
                        mi.startValue,
                        mi.changeby AS step,
                        cv.image AS productImage,
                        pt.typeName AS productTypeName,
                        pt.shortCode AS productTypeShortCode,
                        COALESCE(pt.typeName, cg.category, mi.category, 'Package Item') AS categoryName
                    FROM orderpackageitems opi
                    LEFT JOIN marketplaceitems mi ON opi.productId = mi.id
                    LEFT JOIN producttypes pt ON COALESCE(opi.productType, mi.productTypeId) = pt.id
                    LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
                    LEFT JOIN plant_care.cropgroup cg ON cv.cropGroupId = cg.id
                    WHERE opi.orderPackageId IN (${placeholders})
                `;

                // 4. Fetch baseline products (prevdefineproduct)
                const baselineSql = `
                    SELECT 
                        pdp.id AS baselineId,
                        pdp.orderPackageId,
                        pdp.replceId,
                        COALESCE(pdp.productType, mi.productTypeId) AS productType,
                        COALESCE(pdp.productType, mi.productTypeId, pt.id) AS productTypeId,
                        pdp.productId,
                        pdp.qty,
                        pdp.price,
                        mi.displayName AS productName,
                        mi.normalPrice AS baseUnitPrice,
                        mi.unitType,
                        cv.image AS productImage,
                        pt.typeName AS productTypeName,
                        pt.shortCode AS productTypeShortCode,
                        COALESCE(pt.typeName, cg.category, mi.category, 'Baseline Item') AS categoryName
                    FROM prevdefineproduct pdp
                    LEFT JOIN marketplaceitems mi ON pdp.productId = mi.id
                    LEFT JOIN producttypes pt ON COALESCE(pdp.productType, mi.productTypeId) = pt.id
                    LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
                    LEFT JOIN plant_care.cropgroup cg ON cv.cropGroupId = cg.id
                    WHERE pdp.orderPackageId IN (${placeholders})
                `;


                // 5. Fetch replace requests (replacerequest)
                const replaceRequestsSql = `
                    SELECT 
                        rr.id AS requestId,
                        rr.orderPackageId,
                        rr.userId,
                        rr.replceId,
                        rr.productType,
                        rr.productId,
                        rr.qty,
                        rr.price,
                        rr.status,
                        rr.createdAt
                    FROM replacerequest rr
                    WHERE rr.orderPackageId IN (${placeholders})
                    ORDER BY rr.id DESC
                `;

                // 6. Fetch additional items (orderadditionalitems)
                const additionalSql = `
                    SELECT 
                        oai.id,
                        oai.orderId,
                        oai.productId,
                        oai.qty,
                        oai.unit,
                        oai.normalPrice,
                        oai.price,
                        oai.discount,
                        mi.displayName AS productName,
                        cv.image AS productImage
                    FROM orderadditionalitems oai
                    LEFT JOIN marketplaceitems mi ON oai.productId = mi.id
                    LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
                    WHERE oai.orderId = ?
                `;

                const [items, baselineItems, replaceRequests, additionalItems] = await Promise.all([
                    new Promise((res, rej) => db.collectionofficer.query(itemsSql, orderPackageIds, (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(baselineSql, orderPackageIds, (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(replaceRequestsSql, orderPackageIds, (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(additionalSql, [actualOrderId], (e, r) => e ? rej(e) : res(r || []))),
                ]);

                // Assemble packages with nested items and baselines
                const structuredPackages = packages.map((pkg) => {
                    const pkgItems = items.filter((i) => i.orderPackageId === pkg.orderPackageId);
                    const pkgBaselines = baselineItems.filter((b) => b.orderPackageId === pkg.orderPackageId);
                    const pkgRequests = replaceRequests.filter((r) => r.orderPackageId === pkg.orderPackageId);

                    const enrichedItems = pkgItems.map((item) => {
                        // Find matching baseline
                        const baseline = pkgBaselines.find(
                            (b) => b.replceId === item.itemId || b.productId === item.productId || (b.productType && b.productType === item.productType)
                        );

                        const isReplaced = baseline ? baseline.productId !== item.productId : false;

                        return {
                            ...item,
                            isReplaced,
                            originalProduct: baseline ? {
                                id: baseline.productId,
                                name: baseline.productName,
                                image: baseline.productImage,
                                price: baseline.price,
                                quantity: baseline.qty,
                                unit: baseline.unitType || "kg",
                                category: baseline.categoryName || item.categoryName,
                            } : null,
                        };
                    });

                    return {
                        ...pkg,
                        items: enrichedItems,
                        baselineProducts: pkgBaselines,
                        replaceRequests: pkgRequests,
                    };
                });

                resolve({
                    orderInfo,
                    packages: structuredPackages,
                    additionalItems,
                });
            } catch (queryErr) {
                reject(queryErr);
            }
        });
    });
};

/**
 * Replace a product within an orderpackage (updates orderpackageitems and records in replacerequest)
 */
exports.replacePackageItemDao = ({ orderPackageId, userId, replceId, newProductId, productType, newQty, newPrice }) => {
    return new Promise((resolve, reject) => {
        db.collectionofficer.getConnection((connErr, connection) => {
            if (connErr) return reject(connErr);

            connection.beginTransaction(async (txErr) => {
                if (txErr) {
                    connection.release();
                    return reject(txErr);
                }

                try {
                    // 1. Verify lock status on orderpackage
                    const [pkgRows] = await new Promise((res, rej) => {
                        connection.query("SELECT id, isLock, packingStatus FROM orderpackage WHERE id = ? FOR UPDATE", [orderPackageId], (e, r) => e ? rej(e) : res([r]));
                    });

                    if (!pkgRows || pkgRows.length === 0) {
                        throw new Error("Order package not found");
                    }

                    if (pkgRows[0].isLock === 1) {
                        throw new Error("Package is locked for editing. Packing has commenced or review period expired.");
                    }

                    // 2. Insert into replacerequest
                    const insertRequestSql = `
                        INSERT INTO replacerequest (orderPackageId, userId, replceId, productType, productId, qty, price, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'Approved')
                    `;
                    const requestResult = await new Promise((res, rej) => {
                        connection.query(insertRequestSql, [orderPackageId, userId, replceId || null, productType || null, newProductId, newQty, newPrice], (e, r) => e ? rej(e) : res(r));
                    });

                    // 3. Update orderpackageitems row
                    if (replceId) {
                        const updateItemSql = `
                            UPDATE orderpackageitems 
                            SET productId = ?, productType = COALESCE(?, productType), qty = ?, price = ?
                            WHERE id = ? AND orderPackageId = ?
                        `;
                        await new Promise((res, rej) => {
                            connection.query(updateItemSql, [newProductId, productType, newQty, newPrice, replceId, orderPackageId], (e, r) => e ? rej(e) : res(r));
                        });
                    }

                    connection.commit((commitErr) => {
                        if (commitErr) {
                            return connection.rollback(() => {
                                connection.release();
                                reject(commitErr);
                            });
                        }
                        connection.release();
                        resolve({
                            status: true,
                            requestId: requestResult.insertId,
                            message: "Package item replaced successfully",
                        });
                    });
                } catch (err) {
                    connection.rollback(() => {
                        connection.release();
                        reject(err);
                    });
                }
            });
        });
    });
};

/**
 * Reset a package item back to its default baseline state (from prevdefineproduct)
 */
exports.resetPackageItemDao = ({ orderPackageId, userId, replceId, originalBaselineId }) => {
    return new Promise((resolve, reject) => {
        db.collectionofficer.getConnection((connErr, connection) => {
            if (connErr) return reject(connErr);

            connection.beginTransaction(async (txErr) => {
                if (txErr) {
                    connection.release();
                    return reject(txErr);
                }

                try {
                    // 1. Check lock
                    const [pkgRows] = await new Promise((res, rej) => {
                        connection.query("SELECT id, isLock FROM orderpackage WHERE id = ? FOR UPDATE", [orderPackageId], (e, r) => e ? rej(e) : res([r]));
                    });

                    if (!pkgRows || pkgRows.length === 0 || pkgRows[0].isLock === 1) {
                        throw new Error("Package is locked or not found");
                    }

                    // 2. Fetch baseline data
                    const baselineSql = `
                        SELECT productId, productType, qty, price 
                        FROM prevdefineproduct 
                        WHERE (id = ? OR replceId = ?) AND orderPackageId = ?
                        LIMIT 1
                    `;
                    const baselines = await new Promise((res, rej) => {
                        connection.query(baselineSql, [originalBaselineId || 0, replceId || 0, orderPackageId], (e, r) => e ? rej(e) : res(r || []));
                    });

                    if (baselines.length > 0) {
                        const base = baselines[0];
                        // Restore in orderpackageitems
                        const restoreSql = `
                            UPDATE orderpackageitems
                            SET productId = ?, productType = ?, qty = ?, price = ?
                            WHERE id = ? AND orderPackageId = ?
                        `;
                        await new Promise((res, rej) => {
                            connection.query(restoreSql, [base.productId, base.productType, base.qty, base.price, replceId, orderPackageId], (e, r) => e ? rej(e) : res(r));
                        });

                        // Update replacerequest status to 'Reverted'
                        const updateReqSql = `
                            UPDATE replacerequest 
                            SET status = 'Reverted' 
                            WHERE orderPackageId = ? AND replceId = ?
                        `;
                        await new Promise((res, rej) => {
                            connection.query(updateReqSql, [orderPackageId, replceId], (e, r) => e ? rej(e) : res(r));
                        });
                    }

                    connection.commit((commitErr) => {
                        if (commitErr) {
                            return connection.rollback(() => {
                                connection.release();
                                reject(commitErr);
                            });
                        }
                        connection.release();
                        resolve({
                            status: true,
                            message: "Package item reset to original successfully",
                        });
                    });
                } catch (err) {
                    connection.rollback(() => {
                        connection.release();
                        reject(err);
                    });
                }
            });
        });
    });
};

/**
 * Finalize/confirm package review:
 * Sets isLock = 1 on orderpackage (if specified), adjusts processorders amount, and completes review.
 */
exports.confirmPackageReviewDao = ({ orderId, processOrderId, userId, lockNow = true, additionalAmount = 0 }) => {
    return new Promise((resolve, reject) => {
        db.collectionofficer.getConnection((connErr, connection) => {
            if (connErr) return reject(connErr);

            connection.beginTransaction(async (txErr) => {
                if (txErr) {
                    connection.release();
                    return reject(txErr);
                }

                try {
                    // 1. Lock order packages
                    if (lockNow) {
                        const lockSql = `UPDATE orderpackage SET isLock = 1 WHERE orderId = ? OR orderId = ?`;
                        await new Promise((res, rej) => {
                            connection.query(lockSql, [processOrderId || 0, orderId || 0], (e, r) => e ? rej(e) : res(r));
                        });
                    }

                    // 2. Adjust processorders amount if delta > 0
                    if (additionalAmount > 0 && processOrderId) {
                        const updateAmountSql = `
                            UPDATE processorders 
                            SET amount = amount + ? 
                            WHERE id = ?
                        `;
                        await new Promise((res, rej) => {
                            connection.query(updateAmountSql, [parseFloat(additionalAmount), processOrderId], (e, r) => e ? rej(e) : res(r));
                        });
                    }

                    connection.commit((commitErr) => {
                        if (commitErr) {
                            return connection.rollback(() => {
                                connection.release();
                                reject(commitErr);
                            });
                        }
                        connection.release();
                        resolve({
                            status: true,
                            message: "Package review finalized successfully",
                        });
                    });
                } catch (err) {
                    connection.rollback(() => {
                        connection.release();
                        reject(err);
                    });
                }
            });
        });
    });
};

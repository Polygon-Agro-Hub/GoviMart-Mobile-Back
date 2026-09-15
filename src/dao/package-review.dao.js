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
                COALESCE(o.deliveryCharge, 0) AS deliveryCharge,
                o.sheduleTime,
                o.sheduleType,
                po.id AS processOrderId,
                po.invNo,
                po.amount,
                po.creditPaid,
                po.moneyPaid,
                po.paymentMethod,
                po.isPaid,
                po.status,
                po.packagePackStatus,
                po.sheduleDate AS processScheduleDate,
                po.sheduleDate AS sheduleDate
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
                // orderpackage.orderId references processorders.id
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
                    WHERE op.orderId = ?
                `;

                const packages = await new Promise((res, rej) => {
                    db.collectionofficer.query(packagesSql, [processOrderId], (e, r) => e ? rej(e) : res(r || []));
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


                // 5. Fetch additional items (orderadditionalitems)
                // Use proOrderId (the specific processorders.id) for precise matching.
                // Falling back to orderId only when proOrderId is NULL (legacy rows).
                const additionalSql = `
                    SELECT 
                        oai.id,
                        oai.orderId,
                        oai.proOrderId,
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
                    WHERE oai.proOrderId = ?
                      OR (oai.proOrderId IS NULL AND oai.orderId = ?)
                `;

                const [items, baselineItems, additionalItems] = await Promise.all([
                    new Promise((res, rej) => db.collectionofficer.query(itemsSql, orderPackageIds, (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(baselineSql, orderPackageIds, (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(additionalSql, [processOrderId, actualOrderId], (e, r) => e ? rej(e) : res(r || []))),
                ]);

                // Assemble packages with nested items and baselines
                const structuredPackages = packages.map((pkg) => {
                    const pkgItems = items.filter((i) => i.orderPackageId === pkg.orderPackageId);
                    const pkgBaselines = baselineItems.filter((b) => b.orderPackageId === pkg.orderPackageId);

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
                    };
                });

                // 7. Calculate slot availability and unread reminder cycle
                let packingSlots = {
                    targetLimit: 50,
                    acceptedOrdersCount: 0,
                    availableSlots: 50,
                    isLimitReached: false,
                    unreadReminderDays: 1,
                    scheduleDate: orderInfo.sheduleDate || orderInfo.processScheduleDate || new Date().toISOString().split("T")[0],
                };
                try {
                    packingSlots = await exports.getPackingSlotAvailabilityDao(
                        orderInfo.sheduleDate || orderInfo.processScheduleDate,
                        processOrderId
                    );
                } catch (slotErr) {
                    console.warn("[getOrderPackageReviewDao] Packing slot calculation error:", slotErr.message);
                }

                resolve({
                    orderInfo,
                    packages: structuredPackages,
                    additionalItems,
                    packingSlots,
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

                    // 2. Update orderpackageitems row directly
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
                            message: "Package item reset to original baseline successfully",
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
 * Applies any batch replacements, inserts additional items, adjusts processorders amount, and locks packages.
 */
exports.confirmPackageReviewDao = ({
    orderId,
    processOrderId,
    userId,
    lockNow = false,
    additionalAmount = 0,
    newScheduleDate = null,
    paymentMethod = null,
    newTotal = null,
    creditToAdd = 0,
    replacements = [],
    additionalItems = [],
}) => {
    return new Promise((resolve, reject) => {
        console.log("\n================ [confirmPackageReviewDao] START ================");
        console.log("[confirmPackageReviewDao] Input Parameters:", {
            orderId,
            processOrderId,
            userId,
            lockNow,
            additionalAmount,
            newScheduleDate,
            paymentMethod,
            newTotal,
            creditToAdd,
            replacementsCount: Array.isArray(replacements) ? replacements.length : 0,
            additionalItemsCount: Array.isArray(additionalItems) ? additionalItems.length : 0,
        });
        console.log("[confirmPackageReviewDao] Replacements Data:", JSON.stringify(replacements, null, 2));
        console.log("[confirmPackageReviewDao] Additional Items Data:", JSON.stringify(additionalItems, null, 2));

        db.collectionofficer.getConnection((connErr, connection) => {
            if (connErr) {
                console.error("[confirmPackageReviewDao] DB Connection Error:", connErr);
                return reject(connErr);
            }

            connection.beginTransaction(async (txErr) => {
                if (txErr) {
                    console.error("[confirmPackageReviewDao] Begin Transaction Error:", txErr);
                    connection.release();
                    return reject(txErr);
                }

                try {
                    // 1. Process batch replacements (if any)
                    if (Array.isArray(replacements) && replacements.length > 0) {
                        console.log(`[confirmPackageReviewDao] Processing ${replacements.length} replacement(s)...`);
                        for (let i = 0; i < replacements.length; i++) {
                            const rep = replacements[i];
                            const { orderPackageId, replceId, newProductId, productType, newQty, newPrice } = rep;
                            console.log(`[confirmPackageReviewDao] -> Replacement #${i + 1}:`, rep);

                            if (!orderPackageId || !newProductId) {
                                console.warn(`[confirmPackageReviewDao] -> Skipped Replacement #${i + 1} (missing orderPackageId or newProductId)`);
                                continue;
                            }

                            let targetReplceId = replceId;
                            let targetProductType = productType;

                            const [matchingItems] = await new Promise((res, rej) => {
                                connection.query(
                                    "SELECT id, productType FROM orderpackageitems WHERE orderPackageId = ? AND (id = ? OR productId = ?) LIMIT 1",
                                    [orderPackageId, replceId || 0, replceId || 0],
                                    (e, r) => e ? rej(e) : res([r])
                                );
                            });

                            if (matchingItems && matchingItems.length > 0) {
                                targetReplceId = matchingItems[0].id;
                                if (!targetProductType) targetProductType = matchingItems[0].productType;
                                console.log(`[confirmPackageReviewDao] -> Resolved orderpackageitems row ID: ${targetReplceId}, productType: ${targetProductType}`);
                            } else {
                                console.warn(`[confirmPackageReviewDao] -> No matching item row found for orderPackageId: ${orderPackageId}, replceId/productId: ${replceId}`);
                            }

                            // Update orderpackageitems directly
                            if (targetReplceId) {
                                const updateItemSql = `
                                    UPDATE orderpackageitems 
                                    SET productId = ?, productType = COALESCE(?, productType), qty = ?, price = ?
                                    WHERE id = ? AND orderPackageId = ?
                                `;
                                const updateRes = await new Promise((res, rej) => {
                                    connection.query(
                                        updateItemSql,
                                        [newProductId, targetProductType, newQty, newPrice, targetReplceId, orderPackageId],
                                        (e, r) => e ? rej(e) : res(r)
                                    );
                                });
                                console.log(`[confirmPackageReviewDao] -> Updated orderpackageitems (id: ${targetReplceId}):`, updateRes.affectedRows, "affected");
                            }
                        }
                    }

                    // 2. Process added Ala Carte items (orderadditionalitems)
                    if (Array.isArray(additionalItems) && additionalItems.length > 0) {
                        console.log(`[confirmPackageReviewDao] Inserting ${additionalItems.length} additional item(s)...`);
                        for (let j = 0; j < additionalItems.length; j++) {
                            const item = additionalItems[j];
                            console.log(`[confirmPackageReviewDao] -> Additional Item #${j + 1}:`, item);

                            const insertAddSql = `
                                INSERT INTO orderadditionalitems (orderId, proOrderId, productId, qty, unit, normalPrice, price, discount)
                                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                            `;
                            const addRes = await new Promise((res, rej) => {
                                connection.query(
                                    insertAddSql,
                                    [
                                        orderId || processOrderId || 0,
                                        processOrderId || orderId || 0,
                                        item.productId,
                                        item.qty || 1,
                                        item.unit || "kg",
                                        item.normalPrice || item.price || 0,
                                        item.price || 0,
                                    ],
                                    (e, r) => e ? rej(e) : res(r)
                                );
                            });
                            console.log(`[confirmPackageReviewDao] -> Inserted orderadditionalitems row ID:`, addRes.insertId);
                        }
                    }

                    // 3. Lock order packages (only if explicitly requested)
                    if (lockNow === true || lockNow === 1 || lockNow === "true") {
                        console.log(`[confirmPackageReviewDao] Setting isLock = 1 on orderpackage for orderId: ${orderId} / processOrderId: ${processOrderId}`);
                        const lockSql = `UPDATE orderpackage SET isLock = 1 WHERE orderId = ? OR orderId = ?`;
                        const lockRes = await new Promise((res, rej) => {
                            connection.query(lockSql, [processOrderId || 0, orderId || 0], (e, r) => e ? rej(e) : res(r));
                        });
                        console.log(`[confirmPackageReviewDao] Packages locked:`, lockRes.affectedRows, "row(s) updated");
                    } else {
                        console.log(`[confirmPackageReviewDao] lockNow is false. Packages will remain unlocked.`);
                    }

                    // 4. Update schedule date on processorders if changed
                    if (newScheduleDate) {
                        console.log(`[confirmPackageReviewDao] Updating processorders sheduleDate to ${newScheduleDate} for orderId: ${orderId} / processOrderId: ${processOrderId}`);
                        const updateScheduleSql = `
                            UPDATE processorders 
                            SET sheduleDate = ? 
                            WHERE id = ? OR orderId = ?
                        `;
                        const scheduleRes = await new Promise((res, rej) => {
                            connection.query(updateScheduleSql, [new Date(newScheduleDate), processOrderId || 0, orderId || 0], (e, r) => e ? rej(e) : res(r));
                        });
                        console.log(`[confirmPackageReviewDao] Schedule date updated:`, scheduleRes.affectedRows, "row(s)");
                    }

                    // 5. Payment-aware order total updates
                    // Resolve the actual processOrderId and orderId from DB if not provided
                    let targetProcessOrderId = processOrderId ? parseInt(processOrderId) : null;
                    let targetOrderId = orderId ? parseInt(orderId) : null;

                    const [orderCheckRows] = await new Promise((res, rej) => {
                        connection.query(
                            "SELECT id, orderId FROM processorders WHERE id = ? OR orderId = ? LIMIT 1",
                            [targetProcessOrderId || 0, targetOrderId || 0],
                            (e, r) => e ? rej(e) : res([r])
                        );
                    });

                    if (orderCheckRows && orderCheckRows.length > 0) {
                        if (!targetProcessOrderId) targetProcessOrderId = orderCheckRows[0].id;
                        if (!targetOrderId) targetOrderId = orderCheckRows[0].orderId;
                    }

                    // Determine payment method type
                    const pMethod = (paymentMethod || "").trim().toLowerCase();
                    const isCard = pMethod.includes("card") || pMethod.includes("payhere") ||
                        (pMethod !== "" && !pMethod.includes("cash") && !pMethod.includes("cod") && !pMethod.includes("credit"));
                    const parsedNewTotal = newTotal != null ? parseFloat(newTotal) : null;
                    const parsedAdditional = parseFloat(additionalAmount) || 0;

                    console.log(`[confirmPackageReviewDao] Payment method: "${paymentMethod}" → isCard: ${isCard}, newTotal: ${parsedNewTotal}, additionalAmount: ${parsedAdditional}`);

                    // 5a. If Card — update processorders (moneypaid + amount)
                    if (isCard && targetProcessOrderId && parsedAdditional > 0) {
                        console.log(`[confirmPackageReviewDao] CARD: Updating processorders (moneypaid +${parsedAdditional}, amount +${parsedAdditional}) for processOrderId: ${targetProcessOrderId}`);
                        const updateProcessSql = `
                            UPDATE processorders
                            SET amount = amount + ?, moneyPaid = moneyPaid + ?
                            WHERE id = ?
                        `;
                        const processRes = await new Promise((res, rej) => {
                            connection.query(updateProcessSql, [parsedAdditional, parsedAdditional, targetProcessOrderId], (e, r) => e ? rej(e) : res(r));
                        });
                        console.log(`[confirmPackageReviewDao] processorders updated:`, processRes.affectedRows, "row(s)");
                    }

                    // 5b. Update orders table (total, fullTotal, discount) — for both Card and Cash
                    if (targetOrderId && parsedNewTotal != null) {
                        console.log(`[confirmPackageReviewDao] Updating orders table with newTotal: ${parsedNewTotal} for orderId: ${targetOrderId}`);
                        const updateOrderSql = `
                            UPDATE orders
                            SET
                                total     = ?,
                                fullTotal = ?,
                                discount  = GREATEST(0, fullTotal - ?)
                            WHERE id = ?
                        `;
                        const orderRes = await new Promise((res, rej) => {
                            connection.query(
                                updateOrderSql,
                                [parsedNewTotal, parsedNewTotal, parsedNewTotal, targetOrderId],
                                (e, r) => e ? rej(e) : res(r)
                            );
                        });
                        console.log(`[confirmPackageReviewDao] orders total/fullTotal updated:`, orderRes.affectedRows, "row(s)");
                    } else if (targetOrderId && parsedAdditional > 0) {
                        // Fallback: if newTotal not provided, use delta approach (legacy behavior)
                        console.log(`[confirmPackageReviewDao] Fallback: incrementing orders total by ${parsedAdditional} for orderId: ${targetOrderId}`);
                        const fallbackSql = `
                            UPDATE orders
                            SET
                                total     = total + ?,
                                fullTotal = fullTotal + ?,
                                discount  = GREATEST(0, fullTotal + ? - (total + ?))
                            WHERE id = ?
                        `;
                        const fallRes = await new Promise((res, rej) => {
                            connection.query(
                                fallbackSql,
                                [parsedAdditional, parsedAdditional, parsedAdditional, parsedAdditional, targetOrderId],
                                (e, r) => e ? rej(e) : res(r)
                            );
                        });
                        console.log(`[confirmPackageReviewDao] orders fallback update:`, fallRes.affectedRows, "row(s)");
                    }

                    // 6. Credit balance top-up for savings (negative diff)
                    const parsedCreditToAdd = parseFloat(creditToAdd) || 0;
                    if (parsedCreditToAdd > 0 && userId) {
                        console.log(`[confirmPackageReviewDao] Adding ${parsedCreditToAdd} savings credit to marketplaceusers for userId: ${userId}`);

                        // Check if marketplaceusers row exists for this user
                        const [muRows] = await new Promise((res, rej) => {
                            connection.query(
                                "SELECT id, creditBalance FROM marketplaceusers WHERE id = ? LIMIT 1",
                                [userId],
                                (e, r) => e ? rej(e) : res([r])
                            );
                        });

                        if (muRows && muRows.length > 0) {
                            // Row exists - increment creditBalance
                            const creditRes = await new Promise((res, rej) => {
                                connection.query(
                                    "UPDATE marketplaceusers SET creditBalance = creditBalance + ? WHERE id = ?",
                                    [parsedCreditToAdd, userId],
                                    (e, r) => e ? rej(e) : res(r)
                                );
                            });
                            const oldBalance = muRows[0].creditBalance || 0;
                            console.log(`[confirmPackageReviewDao] marketplaceusers creditBalance updated: ${creditRes.affectedRows} row(s). New balance = ${oldBalance} + ${parsedCreditToAdd}`);
                        } else {
                            // No row - insert new record
                            const insertCreditRes = await new Promise((res, rej) => {
                                connection.query(
                                    "INSERT INTO marketplaceusers (id, creditBalance) VALUES (?, ?) ON DUPLICATE KEY UPDATE creditBalance = creditBalance + ?",
                                    [userId, parsedCreditToAdd, parsedCreditToAdd],
                                    (e, r) => e ? rej(e) : res(r)
                                );
                            });
                            console.log(`[confirmPackageReviewDao] marketplaceusers credit inserted/upserted:`, insertCreditRes.affectedRows, "row(s)");
                        }
                    }

                    connection.commit((commitErr) => {
                        if (commitErr) {
                            console.error("[confirmPackageReviewDao] Commit Error:", commitErr);
                            return connection.rollback(() => {
                                connection.release();
                                reject(commitErr);
                            });
                        }
                        connection.release();
                        console.log("[confirmPackageReviewDao] Transaction committed successfully!");
                        console.log("================ [confirmPackageReviewDao] END ================\n");
                        resolve({
                            status: true,
                            message: "Package review finalized successfully",
                        });
                    });
                } catch (err) {
                    console.error("[confirmPackageReviewDao] Execution Error (Rolling back):", err);
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
 * Fetch latest packing target limit, count accepted orders for the date,
 * and check unread reminder history for an order.
 */
exports.getPackingSlotAvailabilityDao = (targetDate, processOrderId) => {
    return new Promise(async (resolve) => {
        try {
            // 1. Fetch latest target limit from packingtargetlimit
            const limitSql = `SELECT tarValue FROM packingtargetlimit ORDER BY id DESC LIMIT 1`;
            const limitRows = await new Promise((res) => {
                db.collectionofficer.query(limitSql, [], (err, rows) => {
                    if (err) {
                        console.warn("[getPackingSlotAvailabilityDao] Error querying packingtargetlimit:", err.message);
                        return res([]);
                    }
                    res(rows || []);
                });
            });

            const targetLimit = limitRows.length > 0 && limitRows[0].tarValue != null
                ? (parseInt(limitRows[0].tarValue, 10) || 50)
                : 50;

            // 2. Count accepted orders for schedule date from processorders
            let countSql = `
                SELECT COUNT(*) AS acceptedCount 
                FROM processorders 
                WHERE (status IS NULL OR status NOT IN ('Cancelled', 'Return', 'Return Received'))
            `;
            const countParams = [];
            if (targetDate) {
                countSql += ` AND DATE(sheduleDate) = DATE(?)`;
                countParams.push(targetDate);
            } else {
                countSql += ` AND (DATE(sheduleDate) = CURDATE() OR sheduleDate IS NULL)`;
            }

            const countRows = await new Promise((res) => {
                db.collectionofficer.query(countSql, countParams, (err, rows) => {
                    if (err) {
                        console.warn("[getPackingSlotAvailabilityDao] Error querying accepted orders:", err.message);
                        return res([]);
                    }
                    res(rows || []);
                });
            });

            const acceptedOrdersCount = countRows.length > 0 && countRows[0].acceptedCount != null
                ? (parseInt(countRows[0].acceptedCount, 10) || 0)
                : 0;
            const availableSlots = Math.max(0, targetLimit - acceptedOrdersCount);

            // 3. Check unread reminder notifications count if processOrderId given
            let unreadReminderDays = 1;
            if (processOrderId) {
                const notifSql = `
                    SELECT COUNT(*) AS unreadCount 
                    FROM ordernotfication 
                    WHERE orderId = ? AND isRead = 0
                `;
                const notifRows = await new Promise((res) => {
                    db.collectionofficer.query(notifSql, [processOrderId], (err, rows) => {
                        if (err) return res([]);
                        res(rows || []);
                    });
                });
                if (notifRows.length > 0 && notifRows[0].unreadCount > 0) {
                    unreadReminderDays = Math.min(3, parseInt(notifRows[0].unreadCount, 10) || 1);
                }
            }

            const isLimitReached = availableSlots <= 0 || unreadReminderDays >= 3;

            resolve({
                targetLimit,
                acceptedOrdersCount,
                availableSlots,
                isLimitReached,
                unreadReminderDays,
                scheduleDate: targetDate || new Date().toISOString().split("T")[0],
            });
        } catch (err) {
            console.error("[getPackingSlotAvailabilityDao] Error:", err);
            resolve({
                targetLimit: 50,
                acceptedOrdersCount: 0,
                availableSlots: 50,
                isLimitReached: false,
                unreadReminderDays: 1,
                scheduleDate: targetDate || new Date().toISOString().split("T")[0],
            });
        }
    });
};

/**
 * Cancel an order / process order and convert paid balance to credit balance in marketplaceusers.
 */
exports.cancelOrderDao = ({ orderId, processOrderId, userId }) => {
    return new Promise((resolve, reject) => {
        if ((!orderId && !processOrderId) || !userId) {
            return reject(new Error("orderId or processOrderId and userId are required"));
        }

        const findSql = `
            SELECT 
                po.id AS processOrderId,
                po.orderId AS actualOrderId,
                po.invNo,
                po.amount,
                po.creditPaid,
                po.moneyPaid,
                po.paymentMethod,
                po.isPaid,
                po.status,
                o.userId
            FROM processorders po
            INNER JOIN orders o ON po.orderId = o.id
            WHERE (po.id = ? OR o.id = ?) AND o.userId = ?
            ORDER BY po.id DESC
            LIMIT 1
        `;

        const searchId = processOrderId || orderId;

        db.collectionofficer.query(findSql, [searchId, searchId, userId], async (err, rows) => {
            if (err) return reject(err);
            if (!rows || rows.length === 0) {
                return reject(new Error("Order not found or you do not have permission to cancel this order"));
            }

            const order = rows[0];
            const currentStatus = order.status ? order.status.trim().toLowerCase() : "";
            if (currentStatus === "cancelled") {
                return reject(new Error("Order is already cancelled"));
            }
            if (currentStatus === "delivered" || currentStatus === "picked up") {
                return reject(new Error("Completed order cannot be cancelled"));
            }

            const pOrderId = order.processOrderId;
            const pMethod = (order.paymentMethod || "").trim().toLowerCase();
            const rawAmount = parseFloat(order.amount) || 0;
            const rawCreditPaid = parseFloat(order.creditPaid) || 0;
            const rawMoneyPaid = parseFloat(order.moneyPaid) || 0;
            const isPaid = parseInt(order.isPaid, 10) === 1;

            // Calculate refundable credit amount to add back to marketplaceusers
            let refundCreditAmount = 0;
            if (pMethod === "card" || pMethod === "payhere" || (isPaid && pMethod !== "cash")) {
                // Paid via Card / Online payment (full amount refunded as credit)
                refundCreditAmount = rawAmount > 0 ? rawAmount : (rawMoneyPaid + rawCreditPaid);
            } else if (pMethod === "credit") {
                // 100% paid by credit balance
                refundCreditAmount = rawCreditPaid > 0 ? rawCreditPaid : rawAmount;
            } else {
                // Cash order (only refund creditPaid if partial credit was used at checkout)
                refundCreditAmount = rawCreditPaid > 0 ? rawCreditPaid : 0;
            }

            db.collectionofficer.getConnection(async (connErr, connection) => {
                if (connErr) return reject(connErr);

                try {
                    await new Promise((res, rej) => connection.beginTransaction(e => (e ? rej(e) : res())));

                    // 1. Update processorders status to Cancelled
                    const updateOrderSql = `
                        UPDATE processorders 
                        SET status = 'Cancelled' 
                        WHERE id = ?
                    `;
                    await new Promise((res, rej) => {
                        connection.query(updateOrderSql, [pOrderId], (e, r) => (e ? rej(e) : res(r)));
                    });

                    // 2. If refundable amount > 0, update marketplaceusers creditBalance
                    let newCreditBalance = null;
                    if (refundCreditAmount > 0) {
                        const updateCreditSql = `
                            UPDATE marketplaceusers 
                            SET creditBalance = creditBalance + ? 
                            WHERE id = ?
                        `;
                        await new Promise((res, rej) => {
                            connection.query(updateCreditSql, [refundCreditAmount, userId], (e, r) => (e ? rej(e) : res(r)));
                        });

                        const fetchCreditSql = `
                            SELECT creditBalance 
                            FROM marketplaceusers 
                            WHERE id = ?
                        `;
                        const creditRows = await new Promise((res, rej) => {
                            connection.query(fetchCreditSql, [userId], (e, r) => (e ? rej(e) : res(r)));
                        });
                        if (creditRows && creditRows.length > 0) {
                            newCreditBalance = parseFloat(creditRows[0].creditBalance || 0);
                        }
                    }

                    // 4. Insert notifications into both ordernotfication and dashnotification
                    const invNoDisplay = order.invNo || `ORD-${order.actualOrderId}`;
                    const notifMsg = `Your order #${invNoDisplay} has been cancelled successfully.`;

                    const notifSql = `
                        INSERT INTO ordernotfication (orderId, Title, message, isRead, createdAt)
                        VALUES (?, 'Order Cancelled', ?, 0, NOW())
                    `;
                    await new Promise((res) => {
                        connection.query(notifSql, [pOrderId, notifMsg], (notifErr) => {
                            if (notifErr) console.error("Error inserting ordernotfication on cancel:", notifErr);
                            res();
                        });
                    });

                    const dashNotifSql = `
                        INSERT INTO dashnotification (orderId, title, readStatus, createdAt)
                        VALUES (?, 'Order is Cancelled', 0, NOW())
                    `;
                    await new Promise((res) => {
                        connection.query(dashNotifSql, [pOrderId], (dashErr) => {
                            if (dashErr) console.error("Error inserting dashnotification on cancel:", dashErr);
                            res();
                        });
                    });

                    await new Promise((res, rej) => connection.commit(e => (e ? rej(e) : res())));
                    connection.release();

                    resolve({
                        success: true,
                        orderId: order.actualOrderId,
                        processOrderId: pOrderId,
                        invoiceNo: order.invNo,
                        status: "Cancelled",
                        refundCreditAmount,
                        newCreditBalance,
                        message: refundCreditAmount > 0
                            ? `Order cancelled. Rs. ${refundCreditAmount.toFixed(2)} added to your credit balance.`
                            : "Order cancelled successfully.",
                    });
                } catch (txErr) {
                    connection.rollback(() => connection.release());
                    reject(txErr);
                }
            });
        });
    });
};



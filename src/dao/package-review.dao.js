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
                const packageIds = Array.from(new Set(packages.map(p => p.packageId)));
                const placeholders = orderPackageIds.map(() => "?").join(", ");
                const pkgPlaceholders = packageIds.map(() => "?").join(", ");

                // 3. Fetch active package items (orderpackageitems) if already exist
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

                // 3b. Fetch default items from latest definepackage for each packageId (fallback for Todo packages)
                const defineItemsSql = `
                    SELECT 
                        dfi.id AS itemId,
                        df.packageId,
                        dfi.productType,
                        COALESCE(dfi.productType, pt.id) AS productTypeId,
                        dfi.productId,
                        dfi.qty,
                        dfi.price,
                        COALESCE(dfi.price, mi.normalPrice, 0) AS baseUnitPrice,
                        mi.displayName AS productName,
                        mi.normalPrice,
                        mi.discountedPrice,
                        mi.unitType,
                        mi.startValue,
                        mi.changeby AS step,
                        cv.image AS productImage,
                        pt.typeName AS productTypeName,
                        pt.shortCode AS productTypeShortCode,
                        COALESCE(pt.typeName, cg.category, mi.category, 'Package Item') AS categoryName
                    FROM definepackage df
                    INNER JOIN (
                        SELECT packageId, MAX(createdAt) AS max_createdAt
                        FROM definepackage
                        WHERE packageId IN (${pkgPlaceholders})
                        GROUP BY packageId
                    ) df_latest ON df.packageId = df_latest.packageId AND df.createdAt = df_latest.max_createdAt
                    INNER JOIN definepackageitems dfi ON df.id = dfi.definePackageId
                    LEFT JOIN producttypes pt ON pt.id = dfi.productType
                    LEFT JOIN marketplaceitems mi ON mi.id = dfi.productId
                    LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
                    LEFT JOIN plant_care.cropgroup cg ON cv.cropGroupId = cg.id
                    WHERE df.packageId IN (${pkgPlaceholders})
                      AND (mi.id IS NULL OR mi.category = 'Retail')
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
                        mi.discountedPrice,
                        mi.unitType,
                        mi.startValue,
                        mi.changeby AS step,
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
                        mi.unitType,
                        mi.startValue,
                        mi.changeby,
                        cv.image AS productImage
                    FROM orderadditionalitems oai
                    LEFT JOIN marketplaceitems mi ON oai.productId = mi.id
                    LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
                    WHERE oai.proOrderId = ?
                      OR (oai.proOrderId IS NULL AND oai.orderId = ?)
                `;

                // 6. Fetch user's excludelist for warning badges
                const excludeSql = `
                    SELECT 
                        MPI.id AS productId,
                        MPI.displayName AS productName
                    FROM excludelist XL
                    JOIN marketplaceitems MPI ON XL.mpItemId = MPI.id
                    WHERE XL.userId = ? 
                        AND MPI.category = 'Retail'
                `;

                const [items, defineItems, baselineItems, additionalItems, excludeRows] = await Promise.all([
                    new Promise((res, rej) => db.collectionofficer.query(itemsSql, orderPackageIds, (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(defineItemsSql, [...packageIds, ...packageIds], (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(baselineSql, orderPackageIds, (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(additionalSql, [processOrderId, actualOrderId], (e, r) => e ? rej(e) : res(r || []))),
                    new Promise((res, rej) => db.collectionofficer.query(excludeSql, [userId], (e, r) => e ? rej(e) : res(r || []))),
                ]);

                const excludedProductIds = new Set((excludeRows || []).map(x => Number(x.productId)));

                // Assemble packages with nested items and baselines
                const structuredPackages = packages.map((pkg) => {
                    let pkgItems = items.filter((i) => i.orderPackageId === pkg.orderPackageId);
                    let pkgBaselines = baselineItems.filter((b) => b.orderPackageId === pkg.orderPackageId);

                    // Fallback to definepackageitems if orderpackageitems is empty (e.g. Todo packingStatus)
                    if (pkgItems.length === 0) {
                        const fallbackItems = defineItems.filter((d) => d.packageId === pkg.packageId);
                        pkgItems = fallbackItems.map((d) => ({
                            ...d,
                            orderPackageId: pkg.orderPackageId,
                        }));
                        if (pkgBaselines.length === 0) {
                            pkgBaselines = fallbackItems.map((d) => ({
                                baselineId: d.itemId,
                                orderPackageId: pkg.orderPackageId,
                                replceId: d.itemId,
                                productType: d.productType,
                                productTypeId: d.productTypeId,
                                productId: d.productId,
                                qty: d.qty,
                                price: d.price,
                                productName: d.productName,
                                baseUnitPrice: d.baseUnitPrice,
                                unitType: d.unitType,
                                startValue: d.startValue,
                                step: d.step,
                                productImage: d.productImage,
                                productTypeName: d.productTypeName,
                                productTypeShortCode: d.productTypeShortCode,
                                categoryName: d.categoryName,
                            }));
                        }
                    }

                    // Sequential category numbering (e.g. "Low Country Fruit (1)", "Low Country Fruit (2)")
                    const catIndex = {};
                    pkgItems.forEach((it) => {
                        const rawCat = it.categoryName || "Package Item";
                        catIndex[rawCat] = (catIndex[rawCat] || 0) + 1;
                        it.categoryName = `${rawCat} (${catIndex[rawCat]})`;
                    });

                    // Add excludedWarning if product is on user's exclude list
                    pkgItems.forEach((it) => {
                        if (excludedProductIds.has(Number(it.productId))) {
                            it.excludedWarning = `You marked ${it.productName} as an exclude product for your packages. Please Change Product if you don't need this.`;
                        }
                    });

                    const enrichedItems = pkgItems.map((item) => {
                        // Match baseline using itemId (replceId) first — most specific.
                        // Fall back to productId match only if replceId is unavailable.
                        // Do NOT use productType as a match criterion — multiple items
                        // in the same package can share a productType, causing the wrong
                        // baseline to be selected and isReplaced to become true incorrectly.
                        const baseline =
                            pkgBaselines.find((b) => b.replceId != null && b.replceId === item.itemId) ||
                            pkgBaselines.find((b) => b.productId === item.productId);

                        // Only flag as replaced when the baseline exists in prevdefineproduct
                        // AND it carries a different product than what is currently active.
                        // When there is no real baseline (i.e. baseline === item itself as fallback)
                        // or it's a definepackage default, isReplaced must be false.
                        const isReplaced =
                            baseline &&
                            baseline !== item &&
                            baseline.productId != null &&
                            item.productId != null &&
                            baseline.productId !== item.productId;

                        return {
                            ...item,
                            isReplaced: !!isReplaced,
                            originalProduct: isReplaced && baseline ? {
                                id: baseline.productId,
                                itemId: baseline.replceId || baseline.itemId || item.itemId,
                                productId: baseline.productId,
                                name: baseline.productName,
                                image: baseline.productImage,
                                price: baseline.price || baseline.baseUnitPrice,
                                quantity: baseline.qty,
                                unit: "kg",
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
    deletedAdditionalItemIds = [],
    packages = [],
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
            deletedAdditionalItemsCount: Array.isArray(deletedAdditionalItemIds) ? deletedAdditionalItemIds.length : 0,
            packagesCount: Array.isArray(packages) ? packages.length : 0,
        });
        console.log("[confirmPackageReviewDao] Replacements Data:", JSON.stringify(replacements, null, 2));
        console.log("[confirmPackageReviewDao] Additional Items Data:", JSON.stringify(additionalItems, null, 2));
        console.log("[confirmPackageReviewDao] Deleted Additional Item IDs:", JSON.stringify(deletedAdditionalItemIds, null, 2));
        console.log("[confirmPackageReviewDao] Packages Data:", JSON.stringify(packages, null, 2));

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
                    // 0. Resolve all orderpackage rows from DB for this order
                    const dbPackages = await new Promise((res, rej) => {
                        const pkgLookupSql = `
                            SELECT op.id AS orderPackageId, op.packageId, op.qty, op.packingStatus
                            FROM orderpackage op
                            WHERE op.orderId = ? OR op.orderId = ?
                        `;
                        connection.query(pkgLookupSql, [processOrderId || 0, orderId || 0], (e, r) => (e ? rej(e) : res(r || [])));
                    });
                    console.log(`[confirmPackageReviewDao] Found ${dbPackages.length} package(s) in DB for orderId: ${orderId} / processOrderId: ${processOrderId}:`, dbPackages);

                    // Combine packages from payload and dbPackages
                    const allTargetPackages = dbPackages.length > 0 ? dbPackages : (Array.isArray(packages) ? packages : []);

                    for (const dbPkg of allTargetPackages) {
                        const targetPkgDbId = dbPkg.orderPackageId || dbPkg.id;
                        if (!targetPkgDbId) continue;

                        // Find items from frontend payload (matched by orderPackageId or packageId)
                        let pkgItems = [];
                        if (Array.isArray(packages)) {
                            const matched = packages.find(
                                (p) => Number(p.orderPackageId) === Number(targetPkgDbId) || Number(p.packageId) === Number(dbPkg.packageId)
                            );
                            if (matched && Array.isArray(matched.items) && matched.items.length > 0) {
                                pkgItems = matched.items;
                            }
                        }

                        // Fallback: If no items in payload, fetch from definepackage / definepackageitems for dbPkg.packageId
                        if (pkgItems.length === 0 && dbPkg.packageId) {
                            console.log(`[confirmPackageReviewDao] Loading default definepackageitems for packageId: ${dbPkg.packageId}`);
                            const defaultItems = await new Promise((res) => {
                                const defSql = `
                                    SELECT 
                                        dfi.productType, 
                                        dfi.productId, 
                                        dfi.qty, 
                                        dfi.price
                                    FROM definepackage df
                                    INNER JOIN (
                                        SELECT packageId, MAX(createdAt) AS max_createdAt
                                        FROM definepackage
                                        WHERE packageId = ?
                                        GROUP BY packageId
                                    ) df_latest ON df.packageId = df_latest.packageId AND df.createdAt = df_latest.max_createdAt
                                    INNER JOIN definepackageitems dfi ON df.id = dfi.definePackageId
                                    WHERE df.packageId = ?
                                `;
                                connection.query(defSql, [dbPkg.packageId, dbPkg.packageId], (e, r) => res(r || []));
                            });
                            pkgItems = defaultItems;
                        }

                        // Sync orderpackageitems
                        if (pkgItems.length > 0) {
                            console.log(`[confirmPackageReviewDao] Syncing ${pkgItems.length} item(s) to orderpackageitems for orderPackageId: ${targetPkgDbId}`);
                            await new Promise((res, rej) => {
                                connection.query("DELETE FROM orderpackageitems WHERE orderPackageId = ?", [targetPkgDbId], (e, r) => (e ? rej(e) : res(r)));
                            });

                            for (const item of pkgItems) {
                                const prodId = item.productId ? parseInt(Number(item.productId), 10) : null;
                                if (!prodId) continue;

                                let finalProductType = null;
                                if (item.productType != null && !isNaN(Number(item.productType)) && Number(item.productType) > 0) {
                                    finalProductType = parseInt(Number(item.productType), 10);
                                }
                                if (!finalProductType) {
                                    const [ptRow] = await new Promise((res) => {
                                        connection.query("SELECT productTypeId FROM marketplaceitems WHERE id = ? LIMIT 1", [prodId], (e, r) => res([r]));
                                    });
                                    if (ptRow && ptRow[0] && ptRow[0].productTypeId) {
                                        finalProductType = ptRow[0].productTypeId;
                                    }
                                }

                                const qty = item.qty != null && !isNaN(Number(item.qty)) ? parseFloat(Number(item.qty).toFixed(3)) : 1.0;
                                const price = item.price != null && !isNaN(Number(item.price)) ? parseFloat(Number(item.price).toFixed(2)) : 0.0;

                                const insertItemSql = `
                                    INSERT INTO orderpackageitems (orderPackageId, productType, productId, qty, price, isPacked, packingTime, createdAt)
                                    VALUES (?, ?, ?, ?, ?, 0, NULL, NOW())
                                `;
                                const insertRes = await new Promise((res, rej) => {
                                    connection.query(
                                        insertItemSql,
                                        [targetPkgDbId, finalProductType, prodId, qty, price],
                                        (e, r) => (e ? rej(e) : res(r))
                                    );
                                });
                                const newItemId = insertRes.insertId;

                                // Also insert baseline record into prevdefineproduct with replceId = newItemId
                                const insertBaselineSql = `
                                    INSERT INTO prevdefineproduct (orderPackageId, replceId, productType, productId, qty, price)
                                    VALUES (?, ?, ?, ?, ?, ?)
                                `;
                                await new Promise((res, rej) => {
                                    connection.query(
                                        insertBaselineSql,
                                        [targetPkgDbId, newItemId, finalProductType, prodId, qty, price],
                                        (e, r) => (e ? rej(e) : res(r))
                                    );
                                });
                            }
                        }

                        // Specifically update each resolved orderpackage row to 'Dispatch' and isLock = 1
                        await new Promise((res, rej) => {
                            connection.query(
                                "UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE id = ?",
                                [targetPkgDbId],
                                (e, r) => (e ? rej(e) : res(r))
                            );
                        });
                        console.log(`[confirmPackageReviewDao] Updated orderpackage id ${targetPkgDbId} packingStatus = 'Dispatch' and isLock = 1`);
                    }

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

                    // 2b. Process deleted Ala Carte items (orderadditionalitems)
                    if (Array.isArray(deletedAdditionalItemIds) && deletedAdditionalItemIds.length > 0) {
                        const validDeleteIds = deletedAdditionalItemIds
                            .map((id) => Number(id))
                            .filter((id) => !isNaN(id) && id > 0);

                        if (validDeleteIds.length > 0) {
                            console.log(`[confirmPackageReviewDao] Deleting ${validDeleteIds.length} removed additional item(s) from DB:`, validDeleteIds);
                            const deleteAddSql = `
                                DELETE FROM orderadditionalitems 
                                WHERE id IN (?) AND (proOrderId = ? OR orderId = ?)
                            `;
                            const deleteRes = await new Promise((res, rej) => {
                                connection.query(
                                    deleteAddSql,
                                    [validDeleteIds, processOrderId || 0, orderId || 0],
                                    (e, r) => e ? rej(e) : res(r)
                                );
                            });
                            console.log(`[confirmPackageReviewDao] -> Deleted orderadditionalitems:`, deleteRes.affectedRows, "row(s)");
                        }
                    }

                    // 3. Update orderpackage packingStatus to 'Dispatch' and isLock = 1
                    console.log(`[confirmPackageReviewDao] Updating orderpackage packingStatus to 'Dispatch' and isLock = 1 for orderId: ${orderId} / processOrderId: ${processOrderId}`);
                    const dispatchSql = `UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE orderId = ? OR orderId = ?`;
                    const dispatchRes = await new Promise((res, rej) => {
                        connection.query(dispatchSql, [processOrderId || 0, orderId || 0], (e, r) => e ? rej(e) : res(r));
                    });
                    console.log(`[confirmPackageReviewDao] orderpackage updated to 'Dispatch':`, dispatchRes.affectedRows, "row(s)");

                    if (Array.isArray(packages) && packages.length > 0) {
                        const pkgDbIds = packages.map((p) => p.orderPackageId).filter(Boolean);
                        if (pkgDbIds.length > 0) {
                            const pkgPlaceholders = pkgDbIds.map(() => "?").join(", ");
                            await new Promise((res, rej) => {
                                connection.query(
                                    `UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE id IN (${pkgPlaceholders})`,
                                    pkgDbIds,
                                    (e, r) => (e ? rej(e) : res(r))
                                );
                            });
                            console.log(`[confirmPackageReviewDao] Specifically updated orderpackage IDs to 'Dispatch':`, pkgDbIds);
                        }
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
                    // Resolve processorders and orders records from DB
                    const searchId1 = processOrderId ? parseInt(processOrderId) : (orderId ? parseInt(orderId) : 0);
                    const searchId2 = orderId ? parseInt(orderId) : (processOrderId ? parseInt(processOrderId) : 0);

                    const [orderCheckRows] = await new Promise((res, rej) => {
                        const checkSql = `
                            SELECT 
                                po.id AS processOrderId, 
                                po.orderId AS actualOrderId, 
                                po.paymentMethod, 
                                po.isPaid, 
                                po.amount, 
                                po.moneyPaid, 
                                po.creditPaid,
                                o.userId,
                                o.total AS orderTotal,
                                o.fullTotal AS orderFullTotal
                            FROM processorders po
                            INNER JOIN orders o ON po.orderId = o.id
                            WHERE po.id = ? OR po.orderId = ? OR o.id = ?
                            ORDER BY po.id DESC 
                            LIMIT 1
                        `;
                        connection.query(checkSql, [searchId1, searchId2, searchId2], (e, r) => (e ? rej(e) : res([r])));
                    });

                    const matchedOrder = orderCheckRows && orderCheckRows.length > 0 ? orderCheckRows[0] : null;
                    const targetProcessOrderId = matchedOrder ? matchedOrder.processOrderId : (processOrderId ? parseInt(processOrderId) : null);
                    const targetOrderId = matchedOrder ? matchedOrder.actualOrderId : (orderId ? parseInt(orderId) : null);
                    const targetUserId = matchedOrder && matchedOrder.userId ? matchedOrder.userId : userId;

                    // Determine payment method (prefer DB record, fallback to payload)
                    const dbPaymentMethod = (matchedOrder?.paymentMethod || paymentMethod || "").trim().toLowerCase();
                    const isDbPaid = matchedOrder?.isPaid === 1 || matchedOrder?.isPaid === true || String(matchedOrder?.isPaid) === "1";
                    const isCard = dbPaymentMethod.includes("card") ||
                        dbPaymentMethod.includes("payhere") ||
                        dbPaymentMethod.includes("online") ||
                        (isDbPaid && !dbPaymentMethod.includes("cash") && !dbPaymentMethod.includes("cod"));

                    const parsedNewTotal = newTotal != null ? parseFloat(newTotal) : null;
                    const parsedAdditional = parseFloat(additionalAmount) || 0;

                    console.log(`[confirmPackageReviewDao] Order lookup: processOrderId=${targetProcessOrderId}, orderId=${targetOrderId}, userId=${targetUserId}`);
                    console.log(`[confirmPackageReviewDao] Payment method: "${dbPaymentMethod}" -> isCard: ${isCard}, isDbPaid: ${isDbPaid}, newTotal: ${parsedNewTotal}, additionalAmount: ${parsedAdditional}`);

                    // 5a. If Card payment - update processorders (amount and moneyPaid)
                    if (isCard && targetProcessOrderId && parsedNewTotal != null) {
                        const targetCreditPaid = parseFloat(matchedOrder?.creditPaid) || 0;
                        const newMoneyPaid = Math.max(0, parsedNewTotal - targetCreditPaid);
                        console.log(`[confirmPackageReviewDao] CARD: Updating processorders (amount=${parsedNewTotal}, moneyPaid=${newMoneyPaid}, isFinalized=1) for processOrderId: ${targetProcessOrderId}`);
                        const updateProcessSql = `
                            UPDATE processorders
                            SET amount = ?, moneyPaid = ?, isFinalized = 1
                            WHERE id = ?
                        `;
                        const processRes = await new Promise((res, rej) => {
                            connection.query(updateProcessSql, [parsedNewTotal, newMoneyPaid, targetProcessOrderId], (e, r) => (e ? rej(e) : res(r)));
                        });
                        console.log(`[confirmPackageReviewDao] processorders updated (card amount, moneyPaid & isFinalized=1):`, processRes.affectedRows, "row(s)");
                    } else {
                        // For non-card / cash orders or when amount not updating, ensure isFinalized is marked 1
                        const finalProcId = targetProcessOrderId || processOrderId;
                        console.log(`[confirmPackageReviewDao] Updating processorders isFinalized = 1 for processOrderId: ${finalProcId} / orderId: ${orderId}`);
                        const updateFinalizedSql = `
                            UPDATE processorders
                            SET isFinalized = 1
                            WHERE id = ? OR orderId = ?
                        `;
                        const finalizeRes = await new Promise((res, rej) => {
                            connection.query(updateFinalizedSql, [finalProcId || 0, orderId || 0], (e, r) => (e ? rej(e) : res(r)));
                        });
                        console.log(`[confirmPackageReviewDao] processorders isFinalized set to 1:`, finalizeRes.affectedRows, "row(s)");
                    }

                    // 5b. Update orders table (total, fullTotal, discount) - for both Card and Cash
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
                                (e, r) => (e ? rej(e) : res(r))
                            );
                        });
                        console.log(`[confirmPackageReviewDao] orders total/fullTotal updated:`, orderRes.affectedRows, "row(s)");
                    } else if (targetOrderId && parsedAdditional > 0) {
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
                                (e, r) => (e ? rej(e) : res(r))
                            );
                        });
                        console.log(`[confirmPackageReviewDao] orders fallback update:`, fallRes.affectedRows, "row(s)");
                    }

                    // 6. Credit balance top-up for savings (negative diff)
                    const parsedCreditToAdd = parseFloat(creditToAdd) || 0;
                    if (parsedCreditToAdd > 0 && targetUserId) {
                        console.log(`[confirmPackageReviewDao] Adding ${parsedCreditToAdd} savings credit to marketplaceusers for userId: ${targetUserId}`);

                        // Check current creditBalance in marketplaceusers
                        const [muRows] = await new Promise((res, rej) => {
                            connection.query(
                                "SELECT id, creditBalance FROM marketplaceusers WHERE id = ? LIMIT 1",
                                [targetUserId],
                                (e, r) => (e ? rej(e) : res([r]))
                            );
                        });

                        if (muRows && muRows.length > 0) {
                            const oldBalance = parseFloat(muRows[0].creditBalance) || 0;
                            const newBalance = Number((oldBalance + parsedCreditToAdd).toFixed(2));
                            const creditRes = await new Promise((res, rej) => {
                                connection.query(
                                    "UPDATE marketplaceusers SET creditBalance = ? WHERE id = ?",
                                    [newBalance, targetUserId],
                                    (e, r) => (e ? rej(e) : res(r))
                                );
                            });
                            console.log(`[confirmPackageReviewDao] marketplaceusers creditBalance updated: ${creditRes.affectedRows} row(s). Old balance = ${oldBalance}, Added = ${parsedCreditToAdd}, New balance = ${newBalance}`);
                        } else {
                            const insertCreditRes = await new Promise((res, rej) => {
                                connection.query(
                                    "INSERT INTO marketplaceusers (id, creditBalance) VALUES (?, ?) ON DUPLICATE KEY UPDATE creditBalance = creditBalance + ?",
                                    [targetUserId, parsedCreditToAdd, parsedCreditToAdd],
                                    (e, r) => (e ? rej(e) : res(r))
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



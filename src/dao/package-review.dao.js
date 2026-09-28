const db = require("../startup/database");

/**
 * Fetch full package review data for an order or process order.
 * Includes orderpackage instances, orderpackageitems, prevdefineproduct baselines,
 * lock status (isLock), and scheduling info.
 */
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
                //
                // definePackagePrice  = definepackage.price (latest define per package)
                // discountPerUnit     = definepackage.price - marketplacepackages.productPrice (never negative)
                // packageTotalUnit    = productPrice + packingFee + serviceFee  (Full Total per unit)
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
                        (mp.productPrice + mp.packingFee + mp.serviceFee) AS packageTotalUnit,
                        dfp.price AS definePackagePrice,
                        GREATEST(COALESCE(dfp.price, mp.productPrice) - mp.productPrice, 0) AS discountPerUnit
                    FROM orderpackage op
                    INNER JOIN marketplacepackages mp ON op.packageId = mp.id
                    LEFT JOIN (
                        SELECT d.packageId, MAX(d.price) AS price
                        FROM definepackage d
                        INNER JOIN (
                            SELECT packageId, MAX(createdAt) AS max_createdAt
                            FROM definepackage
                            GROUP BY packageId
                        ) l ON d.packageId = l.packageId AND d.createdAt = l.max_createdAt
                        GROUP BY d.packageId
                    ) dfp ON dfp.packageId = op.packageId
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
                //
                // qty            = definepackageitems.qty
                // definePrice    = definepackageitems.price (line total for that qty)
                // baseUnitPrice  = definePrice / qty  (per-kg price, so price * quantity = line total)
                // discountedPrice is forced NULL so the marketplace price never overrides the define price
                const defineItemsSql = `
                    SELECT 
                        dfi.id AS itemId,
                        df.packageId,
                        dfi.productType,
                        COALESCE(dfi.productType, pt.id) AS productTypeId,
                        dfi.productId,
                        dfi.qty,
                        dfi.price AS definePrice,
                        ROUND(dfi.price / NULLIF(dfi.qty, 0), 4) AS baseUnitPrice,
                        NULL AS discountedPrice,
                        mi.displayName AS productName,
                        mi.normalPrice,
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
                //
                // oai.normalPrice / oai.price / oai.discount are LINE TOTALS for oai.qty.
                // perKgNormalPrice / perKgDiscountedPrice are the current PER-KG marketplace
                // rates, used by the app so qty/unit changes reprice correctly.
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
                        mi.normalPrice AS perKgNormalPrice,
                        mi.discountedPrice AS perKgDiscountedPrice,
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
                            // definepackageitems.qty and price (line total) are kept as-is;
                            // baseUnitPrice (per-kg) is already computed in SQL
                            price: d.definePrice,
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
                                price: d.definePrice,
                                productName: d.productName,
                                baseUnitPrice: d.baseUnitPrice,
                                discountedPrice: null,
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
exports.replacePackageItemDao = ({
    orderPackageId,
    userId,
    replceId,
    newProductId,
    productType,
    newQty,
    newPrice,
}) => {
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
                        connection.query(
                            "SELECT id, isLock, packingStatus FROM orderpackage WHERE id = ? FOR UPDATE",
                            [orderPackageId],
                            (e, r) => (e ? rej(e) : res([r])),
                        );
                    });

                    if (!pkgRows || pkgRows.length === 0) {
                        throw new Error("Order package not found");
                    }

                    if (pkgRows[0].isLock === 1) {
                        throw new Error(
                            "Package is locked for editing. Packing has commenced or review period expired.",
                        );
                    }

                    // 2. Update orderpackageitems row directly
                    if (replceId) {
                        const updateItemSql = `
                            UPDATE orderpackageitems 
                            SET productId = ?, productType = COALESCE(?, productType), qty = ?, price = ?
                            WHERE id = ? AND orderPackageId = ?
                        `;
                        await new Promise((res, rej) => {
                            connection.query(
                                updateItemSql,
                                [
                                    newProductId,
                                    productType,
                                    newQty,
                                    newPrice,
                                    replceId,
                                    orderPackageId,
                                ],
                                (e, r) => (e ? rej(e) : res(r)),
                            );
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
exports.resetPackageItemDao = ({
    orderPackageId,
    userId,
    replceId,
    originalBaselineId,
}) => {
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
                        connection.query(
                            "SELECT id, isLock FROM orderpackage WHERE id = ? FOR UPDATE",
                            [orderPackageId],
                            (e, r) => (e ? rej(e) : res([r])),
                        );
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
                        connection.query(
                            baselineSql,
                            [originalBaselineId || 0, replceId || 0, orderPackageId],
                            (e, r) => (e ? rej(e) : res(r || [])),
                        );
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
                            connection.query(
                                restoreSql,
                                [
                                    base.productId,
                                    base.productType,
                                    base.qty,
                                    base.price,
                                    replceId,
                                    orderPackageId,
                                ],
                                (e, r) => (e ? rej(e) : res(r)),
                            );
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
 * Applies any batch replacements, inserts/merges additional items, adjusts processorders amount, and locks packages.
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
            deletedAdditionalItemsCount: Array.isArray(deletedAdditionalItemIds)
                ? deletedAdditionalItemIds.length
                : 0,
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

            const q = (sql, params = []) =>
                new Promise((res, rej) =>
                    connection.query(sql, params, (e, r) => (e ? rej(e) : res(r || []))),
                );

            connection.beginTransaction(async (txErr) => {
                if (txErr) {
                    console.error("[confirmPackageReviewDao] Begin Transaction Error:", txErr);
                    connection.release();
                    return reject(txErr);
                }

                try {
                    // -1. Resolve the REAL ids from the DB.
                    //     orderadditionalitems.orderId    -> orders.id
                    //     orderadditionalitems.proOrderId -> processorders.id
                    //     orderpackage.orderId            -> processorders.id
                    const idSql = `
                        SELECT
                            po.id AS processOrderId,
                            po.orderId AS actualOrderId,
                            po.paymentMethod,
                            po.isPaid,
                            po.amount,
                            po.moneyPaid,
                            po.creditPaid,
                            o.userId
                        FROM processorders po
                        INNER JOIN orders o ON po.orderId = o.id
                        WHERE ${processOrderId ? "po.id = ?" : "o.id = ?"}
                          AND o.userId = ?
                        ORDER BY po.id DESC
                        LIMIT 1
                    `;
                    const idRows = await q(idSql, [processOrderId || orderId, userId]);
                    if (idRows.length === 0) {
                        throw new Error("Order not found. Please reload the review screen and try again.");
                    }
                    const matchedOrder = idRows[0];
                    const realProcessOrderId = matchedOrder.processOrderId;
                    const realOrderId = matchedOrder.actualOrderId;
                    const targetUserId = matchedOrder.userId || userId;
                    console.log(
                        `[confirmPackageReviewDao] Resolved ids: orderId=${realOrderId}, processOrderId=${realProcessOrderId}, userId=${targetUserId}`,
                    );

                    // 0. Resolve orderpackage rows from DB (source of truth)
                    const dbPackages = await q(
                        `SELECT op.id AS orderPackageId, op.packageId, op.qty, op.packingStatus
                         FROM orderpackage op
                         WHERE op.orderId = ? OR op.orderId = ?`,
                        [realProcessOrderId, realOrderId],
                    );
                    console.log(
                        `[confirmPackageReviewDao] Found ${dbPackages.length} package(s) in DB for orderId: ${realOrderId} / processOrderId: ${realProcessOrderId}:`,
                        dbPackages,
                    );

                    if (dbPackages.length === 0 && Array.isArray(packages) && packages.length > 0) {
                        // Payload references orderpackage rows that do not exist (stale screen data).
                        throw new Error(
                            "Package data has changed for this order. Please reload the review screen and try again.",
                        );
                    }

                    for (const dbPkg of dbPackages) {
                        const targetPkgDbId = dbPkg.orderPackageId;
                        if (!targetPkgDbId) continue;

                        // Items from frontend payload (matched by orderPackageId or packageId)
                        let pkgItems = [];
                        if (Array.isArray(packages)) {
                            const matched = packages.find(
                                (p) =>
                                    Number(p.orderPackageId) === Number(targetPkgDbId) ||
                                    Number(p.packageId) === Number(dbPkg.packageId),
                            );
                            if (matched && Array.isArray(matched.items) && matched.items.length > 0) {
                                pkgItems = matched.items;
                            }
                        }

                        // Fallback: default items from latest definepackage
                        if (pkgItems.length === 0 && dbPkg.packageId) {
                            console.log(
                                `[confirmPackageReviewDao] Loading default definepackageitems for packageId: ${dbPkg.packageId}`,
                            );
                            pkgItems = await q(
                                `SELECT dfi.productType, dfi.productId, dfi.qty, dfi.price
                                 FROM definepackage df
                                 INNER JOIN (
                                     SELECT packageId, MAX(createdAt) AS max_createdAt
                                     FROM definepackage
                                     WHERE packageId = ?
                                     GROUP BY packageId
                                 ) df_latest ON df.packageId = df_latest.packageId AND df.createdAt = df_latest.max_createdAt
                                 INNER JOIN definepackageitems dfi ON df.id = dfi.definePackageId
                                 WHERE df.packageId = ?`,
                                [dbPkg.packageId, dbPkg.packageId],
                            );
                        }

                        // Sync orderpackageitems
                        if (pkgItems.length > 0) {
                            console.log(
                                `[confirmPackageReviewDao] Syncing ${pkgItems.length} item(s) to orderpackageitems for orderPackageId: ${targetPkgDbId}`,
                            );
                            await q("DELETE FROM orderpackageitems WHERE orderPackageId = ?", [targetPkgDbId]);

                            for (const item of pkgItems) {
                                const prodId = item.productId ? parseInt(Number(item.productId), 10) : null;
                                if (!prodId) continue;

                                let finalProductType = null;
                                if (
                                    item.productType != null &&
                                    !isNaN(Number(item.productType)) &&
                                    Number(item.productType) > 0
                                ) {
                                    finalProductType = parseInt(Number(item.productType), 10);
                                }
                                if (!finalProductType) {
                                    const ptRows = await q(
                                        "SELECT productTypeId FROM marketplaceitems WHERE id = ? LIMIT 1",
                                        [prodId],
                                    );
                                    if (ptRows[0] && ptRows[0].productTypeId) {
                                        finalProductType = ptRows[0].productTypeId;
                                    }
                                }

                                const qty =
                                    item.qty != null && !isNaN(Number(item.qty))
                                        ? parseFloat(Number(item.qty).toFixed(3))
                                        : 1.0;
                                const price =
                                    item.price != null && !isNaN(Number(item.price))
                                        ? parseFloat(Number(item.price).toFixed(2))
                                        : 0.0;

                                const insertRes = await q(
                                    `INSERT INTO orderpackageitems (orderPackageId, productType, productId, qty, price, isPacked, packingTime, createdAt)
                                     VALUES (?, ?, ?, ?, ?, 0, NULL, NOW())`,
                                    [targetPkgDbId, finalProductType, prodId, qty, price],
                                );
                                const newItemId = insertRes.insertId;

                                // Baseline record into prevdefineproduct with replceId = newItemId
                                await q(
                                    `INSERT INTO prevdefineproduct (orderPackageId, replceId, productType, productId, qty, price)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [targetPkgDbId, newItemId, finalProductType, prodId, qty, price],
                                );
                            }
                        }

                        await q(
                            "UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE id = ?",
                            [targetPkgDbId],
                        );
                        console.log(
                            `[confirmPackageReviewDao] Updated orderpackage id ${targetPkgDbId} packingStatus = 'Dispatch' and isLock = 1`,
                        );
                    }

                    // 1. Process batch replacements (if any)
                    if (Array.isArray(replacements) && replacements.length > 0) {
                        console.log(`[confirmPackageReviewDao] Processing ${replacements.length} replacement(s)...`);
                        const validPkgIds = new Set(dbPackages.map((p) => Number(p.orderPackageId)));

                        for (let i = 0; i < replacements.length; i++) {
                            const rep = replacements[i];
                            const { orderPackageId, replceId, newProductId, productType, newQty, newPrice } = rep;
                            console.log(`[confirmPackageReviewDao] -> Replacement #${i + 1}:`, rep);

                            if (!orderPackageId || !newProductId || !validPkgIds.has(Number(orderPackageId))) {
                                console.warn(
                                    `[confirmPackageReviewDao] -> Skipped Replacement #${i + 1} (missing/unknown orderPackageId or newProductId)`,
                                );
                                continue;
                            }

                            let targetReplceId = replceId;
                            let targetProductType = productType;

                            const matchingItems = await q(
                                "SELECT id, productType FROM orderpackageitems WHERE orderPackageId = ? AND (id = ? OR productId = ?) LIMIT 1",
                                [orderPackageId, replceId || 0, replceId || 0],
                            );

                            if (matchingItems.length > 0) {
                                targetReplceId = matchingItems[0].id;
                                if (!targetProductType) targetProductType = matchingItems[0].productType;
                                console.log(
                                    `[confirmPackageReviewDao] -> Resolved orderpackageitems row ID: ${targetReplceId}, productType: ${targetProductType}`,
                                );
                            } else {
                                console.warn(
                                    `[confirmPackageReviewDao] -> No matching item row found for orderPackageId: ${orderPackageId}, replceId/productId: ${replceId}`,
                                );
                            }

                            if (targetReplceId) {
                                const updateRes = await q(
                                    `UPDATE orderpackageitems
                                     SET productId = ?, productType = COALESCE(?, productType), qty = ?, price = ?
                                     WHERE id = ? AND orderPackageId = ?`,
                                    [newProductId, targetProductType, newQty, newPrice, targetReplceId, orderPackageId],
                                );
                                console.log(
                                    `[confirmPackageReviewDao] -> Updated orderpackageitems (id: ${targetReplceId}):`,
                                    updateRes.affectedRows,
                                    "affected",
                                );
                            }
                        }
                    }

                    // 2. Delete removed Ala Carte items (runs BEFORE the insert/merge step)
                    if (Array.isArray(deletedAdditionalItemIds) && deletedAdditionalItemIds.length > 0) {
                        const validDeleteIds = deletedAdditionalItemIds
                            .map((id) => Number(id))
                            .filter((id) => !isNaN(id) && id > 0);

                        if (validDeleteIds.length > 0) {
                            const deleteRes = await q(
                                `DELETE FROM orderadditionalitems
                                 WHERE id IN (?) AND (proOrderId = ? OR (proOrderId IS NULL AND orderId = ?))`,
                                [validDeleteIds, realProcessOrderId, realOrderId],
                            );
                            console.log(
                                `[confirmPackageReviewDao] -> Deleted orderadditionalitems:`,
                                deleteRes.affectedRows,
                                "row(s)",
                            );
                        }
                    }

                    // 3. Added Ala Carte items: one row per productId,
                    //    normalPrice / price / discount recalculated from the FINAL quantity.
                    if (Array.isArray(additionalItems) && additionalItems.length > 0) {
                        const round2 = (n) => Number((Number(n) || 0).toFixed(2));
                        const toGrams = (qty, unit) => {
                            const n = Number(qty) || 0;
                            return String(unit || "kg").toLowerCase() === "g" ? n : n * 1000;
                        };
                        const fromGrams = (grams, unit) =>
                            String(unit || "kg").toLowerCase() === "g"
                                ? Math.round(grams)
                                : Number((grams / 1000).toFixed(3));

                        // 3a. Merge duplicates inside the payload
                        const mergedItems = new Map();
                        for (const item of additionalItems) {
                            const pid = Number(item.productId);
                            if (!pid) continue;
                            const grams = toGrams(item.qty, item.unit);
                            const existingMerged = mergedItems.get(pid);
                            if (existingMerged) {
                                existingMerged.grams += grams;
                                existingMerged.payloadPrice += Number(item.price) || 0;
                            } else {
                                mergedItems.set(pid, {
                                    productId: pid,
                                    grams,
                                    unit: item.unit || "kg",
                                    payloadPrice: Number(item.price) || 0,
                                });
                            }
                        }

                        console.log(
                            `[confirmPackageReviewDao] Processing ${mergedItems.size} unique additional product(s)...`,
                        );

                        // 3b. UPDATE existing row or INSERT new row
                        for (const m of mergedItems.values()) {
                            const miRows = await q(
                                "SELECT normalPrice, discountedPrice FROM marketplaceitems WHERE id = ? LIMIT 1",
                                [m.productId],
                            );
                            const perKgNormal = miRows.length ? parseFloat(miRows[0].normalPrice) || 0 : 0;
                            const perKgDiscounted = miRows.length ? parseFloat(miRows[0].discountedPrice) || 0 : 0;
                            const perKgEffective = perKgDiscounted > 0 ? perKgDiscounted : perKgNormal;
                            const hasMarketPrice = perKgNormal > 0;

                            const calcLine = (grams) => {
                                const kg = grams / 1000;
                                const normalPrice = round2(perKgNormal * kg);
                                const price = round2(perKgEffective * kg);
                                const discount = round2(Math.max(0, normalPrice - price));
                                return { normalPrice, price, discount };
                            };

                            const existingRows = await q(
                                `SELECT id, qty, unit, price
                                 FROM orderadditionalitems
                                 WHERE productId = ?
                                   AND (proOrderId = ? OR (proOrderId IS NULL AND orderId = ?))
                                 ORDER BY id ASC
                                 LIMIT 1
                                 FOR UPDATE`,
                                [m.productId, realProcessOrderId, realOrderId],
                            );

                            if (existingRows.length > 0) {
                                const ex = existingRows[0];
                                const totalGrams = toGrams(ex.qty, ex.unit) + m.grams;
                                const newQty = fromGrams(totalGrams, ex.unit);

                                let line;
                                if (hasMarketPrice) {
                                    line = calcLine(totalGrams);
                                } else {
                                    const sum = round2((parseFloat(ex.price) || 0) + m.payloadPrice);
                                    line = { normalPrice: sum, price: sum, discount: 0 };
                                }

                                await q(
                                    `UPDATE orderadditionalitems
                                     SET qty = ?, normalPrice = ?, price = ?, discount = ?
                                     WHERE id = ?`,
                                    [newQty, line.normalPrice, line.price, line.discount, ex.id],
                                );
                                console.log(
                                    `[confirmPackageReviewDao] -> Merged product ${m.productId} into row ${ex.id}: qty=${newQty} ${ex.unit}, normal=${line.normalPrice}, price=${line.price}, discount=${line.discount}`,
                                );
                            } else {
                                let line;
                                if (hasMarketPrice) {
                                    line = calcLine(m.grams);
                                } else {
                                    const p = round2(m.payloadPrice);
                                    line = { normalPrice: p, price: p, discount: 0 };
                                }

                                const addRes = await q(
                                    `INSERT INTO orderadditionalitems (orderId, proOrderId, productId, qty, unit, normalPrice, price, discount)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [
                                        realOrderId,
                                        realProcessOrderId,
                                        m.productId,
                                        fromGrams(m.grams, m.unit),
                                        m.unit,
                                        line.normalPrice,
                                        line.price,
                                        line.discount,
                                    ],
                                );
                                console.log(
                                    `[confirmPackageReviewDao] -> Inserted new row ID ${addRes.insertId} for product ${m.productId}: normal=${line.normalPrice}, price=${line.price}, discount=${line.discount}`,
                                );
                            }
                        }
                    }

                    // 4. Lock all packages of this order
                    const dispatchRes = await q(
                        "UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE orderId = ? OR orderId = ?",
                        [realProcessOrderId, realOrderId],
                    );
                    console.log(
                        `[confirmPackageReviewDao] orderpackage updated to 'Dispatch':`,
                        dispatchRes.affectedRows,
                        "row(s)",
                    );

                    // 5. Update schedule date on processorders if changed
                    if (newScheduleDate) {
                        const scheduleRes = await q(
                            "UPDATE processorders SET sheduleDate = ? WHERE id = ?",
                            [new Date(newScheduleDate), realProcessOrderId],
                        );
                        console.log(
                            `[confirmPackageReviewDao] Schedule date updated:`,
                            scheduleRes.affectedRows,
                            "row(s)",
                        );
                    }

                    // 6. Payment-aware order total updates
                    const dbPaymentMethod = (matchedOrder.paymentMethod || paymentMethod || "")
                        .trim()
                        .toLowerCase();
                    const isDbPaid =
                        matchedOrder.isPaid === 1 ||
                        matchedOrder.isPaid === true ||
                        String(matchedOrder.isPaid) === "1";
                    const isCard =
                        dbPaymentMethod.includes("card") ||
                        dbPaymentMethod.includes("payhere") ||
                        dbPaymentMethod.includes("online") ||
                        (isDbPaid &&
                            !dbPaymentMethod.includes("cash") &&
                            !dbPaymentMethod.includes("cod"));

                    const parsedNewTotal = newTotal != null ? parseFloat(newTotal) : null;
                    const parsedAdditional = parseFloat(additionalAmount) || 0;

                    console.log(
                        `[confirmPackageReviewDao] Payment method: "${dbPaymentMethod}" -> isCard: ${isCard}, isDbPaid: ${isDbPaid}, newTotal: ${parsedNewTotal}, additionalAmount: ${parsedAdditional}`,
                    );

                    // 6a. processorders
                    if (isCard && parsedNewTotal != null) {
                        const targetCreditPaid = parseFloat(matchedOrder.creditPaid) || 0;
                        const newMoneyPaid = Math.max(0, parsedNewTotal - targetCreditPaid);
                        const processRes = await q(
                            "UPDATE processorders SET amount = ?, moneyPaid = ?, isFinalized = 1 WHERE id = ?",
                            [parsedNewTotal, newMoneyPaid, realProcessOrderId],
                        );
                        console.log(
                            `[confirmPackageReviewDao] processorders updated (card amount=${parsedNewTotal}, moneyPaid=${newMoneyPaid}, isFinalized=1):`,
                            processRes.affectedRows,
                            "row(s)",
                        );
                    } else {
                        const finalizeRes = await q(
                            "UPDATE processorders SET isFinalized = 1 WHERE id = ?",
                            [realProcessOrderId],
                        );
                        console.log(
                            `[confirmPackageReviewDao] processorders isFinalized set to 1:`,
                            finalizeRes.affectedRows,
                            "row(s)",
                        );
                    }

                    // 6b. orders (total, fullTotal, discount)
                    if (parsedNewTotal != null) {
                        const orderRes = await q(
                            `UPDATE orders
                             SET total = ?, fullTotal = ?, discount = GREATEST(0, fullTotal - ?)
                             WHERE id = ?`,
                            [parsedNewTotal, parsedNewTotal, parsedNewTotal, realOrderId],
                        );
                        console.log(
                            `[confirmPackageReviewDao] orders total/fullTotal updated:`,
                            orderRes.affectedRows,
                            "row(s)",
                        );
                    } else if (parsedAdditional > 0) {
                        const fallRes = await q(
                            `UPDATE orders
                             SET total = total + ?, fullTotal = fullTotal + ?,
                                 discount = GREATEST(0, fullTotal + ? - (total + ?))
                             WHERE id = ?`,
                            [parsedAdditional, parsedAdditional, parsedAdditional, parsedAdditional, realOrderId],
                        );
                        console.log(
                            `[confirmPackageReviewDao] orders fallback update:`,
                            fallRes.affectedRows,
                            "row(s)",
                        );
                    }

                    // 7. Credit balance top-up for savings (negative diff)
                    const parsedCreditToAdd = parseFloat(creditToAdd) || 0;
                    if (parsedCreditToAdd > 0 && targetUserId) {
                        const muRows = await q(
                            "SELECT id, creditBalance FROM marketplaceusers WHERE id = ? LIMIT 1",
                            [targetUserId],
                        );

                        if (muRows.length > 0) {
                            const oldBalance = parseFloat(muRows[0].creditBalance) || 0;
                            const newBalance = Number((oldBalance + parsedCreditToAdd).toFixed(2));
                            await q("UPDATE marketplaceusers SET creditBalance = ? WHERE id = ?", [
                                newBalance,
                                targetUserId,
                            ]);
                            console.log(
                                `[confirmPackageReviewDao] creditBalance: old=${oldBalance}, added=${parsedCreditToAdd}, new=${newBalance}`,
                            );
                        } else {
                            await q(
                                "INSERT INTO marketplaceusers (id, creditBalance) VALUES (?, ?) ON DUPLICATE KEY UPDATE creditBalance = creditBalance + ?",
                                [targetUserId, parsedCreditToAdd, parsedCreditToAdd],
                            );
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
                        console.warn(
                            "[getPackingSlotAvailabilityDao] Error querying packingtargetlimit:",
                            err.message,
                        );
                        return res([]);
                    }
                    res(rows || []);
                });
            });

            const targetLimit =
                limitRows.length > 0 && limitRows[0].tarValue != null
                    ? parseInt(limitRows[0].tarValue, 10) || 50
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
                        console.warn(
                            "[getPackingSlotAvailabilityDao] Error querying accepted orders:",
                            err.message,
                        );
                        return res([]);
                    }
                    res(rows || []);
                });
            });

            const acceptedOrdersCount =
                countRows.length > 0 && countRows[0].acceptedCount != null
                    ? parseInt(countRows[0].acceptedCount, 10) || 0
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
                    db.collectionofficer.query(
                        notifSql,
                        [processOrderId],
                        (err, rows) => {
                            if (err) return res([]);
                            res(rows || []);
                        },
                    );
                });
                if (notifRows.length > 0 && notifRows[0].unreadCount > 0) {
                    unreadReminderDays = Math.min(
                        3,
                        parseInt(notifRows[0].unreadCount, 10) || 1,
                    );
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
            return reject(
                new Error("orderId or processOrderId and userId are required"),
            );
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

        db.collectionofficer.query(
            findSql,
            [searchId, searchId, userId],
            async (err, rows) => {
                if (err) return reject(err);
                if (!rows || rows.length === 0) {
                    return reject(
                        new Error(
                            "Order not found or you do not have permission to cancel this order",
                        ),
                    );
                }

                const order = rows[0];
                const currentStatus = order.status
                    ? order.status.trim().toLowerCase()
                    : "";
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
                if (
                    pMethod === "card" ||
                    pMethod === "payhere" ||
                    (isPaid && pMethod !== "cash")
                ) {
                    // Paid via Card / Online payment (full amount refunded as credit)
                    refundCreditAmount =
                        rawAmount > 0 ? rawAmount : rawMoneyPaid + rawCreditPaid;
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
                        await new Promise((res, rej) =>
                            connection.beginTransaction((e) => (e ? rej(e) : res())),
                        );

                        // 1. Update processorders status to Cancelled
                        const updateOrderSql = `
                        UPDATE processorders 
                        SET status = 'Cancelled' 
                        WHERE id = ?
                    `;
                        await new Promise((res, rej) => {
                            connection.query(updateOrderSql, [pOrderId], (e, r) =>
                                e ? rej(e) : res(r),
                            );
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
                                connection.query(
                                    updateCreditSql,
                                    [refundCreditAmount, userId],
                                    (e, r) => (e ? rej(e) : res(r)),
                                );
                            });

                            const fetchCreditSql = `
                            SELECT creditBalance 
                            FROM marketplaceusers 
                            WHERE id = ?
                        `;
                            const creditRows = await new Promise((res, rej) => {
                                connection.query(fetchCreditSql, [userId], (e, r) =>
                                    e ? rej(e) : res(r),
                                );
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
                                if (notifErr)
                                    console.error(
                                        "Error inserting ordernotfication on cancel:",
                                        notifErr,
                                    );
                                res();
                            });
                        });

                        const dashNotifSql = `
                        INSERT INTO dashnotification (orderId, title, readStatus, createdAt)
                        VALUES (?, 'Order is Cancelled', 0, NOW())
                    `;
                        await new Promise((res) => {
                            connection.query(dashNotifSql, [pOrderId], (dashErr) => {
                                if (dashErr)
                                    console.error(
                                        "Error inserting dashnotification on cancel:",
                                        dashErr,
                                    );
                                res();
                            });
                        });

                        await new Promise((res, rej) =>
                            connection.commit((e) => (e ? rej(e) : res())),
                        );
                        connection.release();

                        resolve({
                            success: true,
                            orderId: order.actualOrderId,
                            processOrderId: pOrderId,
                            invoiceNo: order.invNo,
                            status: "Cancelled",
                            refundCreditAmount,
                            newCreditBalance,
                            message:
                                refundCreditAmount > 0
                                    ? `Order cancelled. Rs. ${refundCreditAmount.toFixed(2)} added to your credit balance.`
                                    : "Order cancelled successfully.",
                        });
                    } catch (txErr) {
                        connection.rollback(() => connection.release());
                        reject(txErr);
                    }
                });
            },
        );
    });
};

const db = require("../startup/database");
const { getRemainingPackingTarget } = require("./packing-target.dao");

// ============================================================================
// NOTES
//  - total / fullTotal / discount / couponValue / deliveryCharge live ONLY on
//    `processorders`. Nothing in this file reads/writes them on `orders`.
//  - orderadditionalitems is matched only by proOrderId (no oai.orderId).
// ============================================================================

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

/**
 * Card / online order? Credit-only and cash(+credit) orders return false.
 */
const isCardPayment = (paymentMethod, isPaid) => {
    const m = (paymentMethod || "").trim().toLowerCase();
    const paid = isPaid === 1 || isPaid === true || String(isPaid) === "1";
    if (m.includes("card") || m.includes("payhere") || m.includes("online")) return true;
    return paid && !m.includes("cash") && !m.includes("cod") && !m.includes("credit");
};

/**
 * Adds `change` to marketplaceusers.creditBalance (inside the transaction).
 * A negative change is capped at the available balance, so the confirm never
 * fails and the balance never goes below 0.
 * Returns the part that could NOT be taken from credit (the shortfall).
 */
const applyCreditChange = async (q, userId, change) => {
    if (!userId || !change) return 0;
    let applied = change;
    let shortfall = 0;

    if (change < 0) {
        const rows = await q(
            "SELECT creditBalance FROM marketplaceusers WHERE id = ? FOR UPDATE",
            [userId],
        );
        const available = Math.max(0, parseFloat(rows[0]?.creditBalance) || 0);
        const take = Math.min(available, Math.abs(change));
        shortfall = round2(Math.abs(change) - take);
        applied = -take;
    }

    if (applied !== 0) {
        await q(
            "UPDATE marketplaceusers SET creditBalance = creditBalance + ? WHERE id = ?",
            [applied, userId],
        );
    }
    return shortfall;
};

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
                po.isFinalized,
                po.isConfirmed,
                po.packagePackStatus,
                po.sheduleDate AS processScheduleDate,
                po.sheduleDate AS sheduleDate
            FROM processorders po
            INNER JOIN orders o ON po.orderId = o.id
            WHERE (po.id = ? OR o.id = ?) AND o.userId = ?
            ORDER BY po.id DESC
            LIMIT 1
        `;

        db.collectionofficer.query(
            orderSql,
            [orderIdOrProcessOrderId, orderIdOrProcessOrderId, userId],
            async (err, orderRows) => {
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
                        db.collectionofficer.query(
                            packagesSql,
                            [processOrderId, actualOrderId],
                            (e, r) => (e ? rej(e) : res(r || [])),
                        );
                    });

                    if (packages.length === 0) {
                        const emptySlots = await exports.getPackingSlotAvailabilityDao(
                            orderInfo.sheduleDate || orderInfo.processScheduleDate,
                            processOrderId,
                        );
                        return resolve({
                            orderInfo,
                            packages: [],
                            additionalItems: [],
                            packingSlots: emptySlots,
                        });
                    }

                    const orderPackageIds = packages.map((p) => p.orderPackageId);
                    const packageIds = Array.from(new Set(packages.map((p) => p.packageId)));
                    const placeholders = orderPackageIds.map(() => "?").join(", ");
                    const pkgPlaceholders = packageIds.map(() => "?").join(", ");

                    // 3. Active package items (orderpackageitems)
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

                    // 3b. Default items from latest definepackage (fallback for Todo packages)
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

                    // 4. Baseline products (prevdefineproduct)
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

                    // 5. Additional items (orderadditionalitems)
                    const additionalSql = `
                        SELECT 
                            oai.id,
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
                    `;

                    // 6. User's excludelist for warning badges
                    const excludeSql = `
                        SELECT 
                            MPI.id AS productId,
                            MPI.displayName AS productName
                        FROM excludelist XL
                        JOIN marketplaceitems MPI ON XL.mpItemId = MPI.id
                        WHERE XL.userId = ? 
                            AND MPI.category = 'Retail'
                    `;

                    const [items, defineItems, baselineItems, additionalItems, excludeRows] =
                        await Promise.all([
                            new Promise((res, rej) =>
                                db.collectionofficer.query(itemsSql, orderPackageIds, (e, r) =>
                                    e ? rej(e) : res(r || []),
                                ),
                            ),
                            new Promise((res, rej) =>
                                db.collectionofficer.query(
                                    defineItemsSql,
                                    [...packageIds, ...packageIds],
                                    (e, r) => (e ? rej(e) : res(r || [])),
                                ),
                            ),
                            new Promise((res, rej) =>
                                db.collectionofficer.query(baselineSql, orderPackageIds, (e, r) =>
                                    e ? rej(e) : res(r || []),
                                ),
                            ),
                            new Promise((res, rej) =>
                                db.collectionofficer.query(
                                    additionalSql,
                                    [processOrderId],
                                    (e, r) => (e ? rej(e) : res(r || [])),
                                ),
                            ),
                            new Promise((res, rej) =>
                                db.collectionofficer.query(excludeSql, [userId], (e, r) =>
                                    e ? rej(e) : res(r || []),
                                ),
                            ),
                        ]);

                    const excludedProductIds = new Set(
                        (excludeRows || []).map((x) => Number(x.productId)),
                    );

                    // Assemble packages with nested items and baselines
                    const structuredPackages = packages.map((pkg) => {
                        let pkgItems = items.filter((i) => i.orderPackageId === pkg.orderPackageId);
                        let pkgBaselines = baselineItems.filter(
                            (b) => b.orderPackageId === pkg.orderPackageId,
                        );

                        // Fallback to definepackageitems if orderpackageitems is empty (Todo packages)
                        if (pkgItems.length === 0) {
                            const fallbackItems = defineItems.filter(
                                (d) => d.packageId === pkg.packageId,
                            );
                            pkgItems = fallbackItems.map((d) => ({
                                ...d,
                                orderPackageId: pkg.orderPackageId,
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

                        // Sequential category numbering
                        const catIndex = {};
                        pkgItems.forEach((it) => {
                            const rawCat = it.categoryName || "Package Item";
                            catIndex[rawCat] = (catIndex[rawCat] || 0) + 1;
                            it.categoryName = `${rawCat} (${catIndex[rawCat]})`;
                        });

                        // excludedWarning if product is on user's exclude list
                        pkgItems.forEach((it) => {
                            if (excludedProductIds.has(Number(it.productId))) {
                                it.excludedWarning = `You marked ${it.productName} as an exclude product for your packages. Please Change Product if you don't need this.`;
                            }
                        });

                        const enrichedItems = pkgItems.map((item) => {
                            // Match baseline by replceId first, then productId.
                            const baseline =
                                pkgBaselines.find(
                                    (b) => b.replceId != null && b.replceId === item.itemId,
                                ) || pkgBaselines.find((b) => b.productId === item.productId);

                            const isReplaced =
                                baseline &&
                                baseline !== item &&
                                baseline.productId != null &&
                                item.productId != null &&
                                baseline.productId !== item.productId;

                            return {
                                ...item,
                                isReplaced: !!isReplaced,
                                originalProduct:
                                    isReplaced && baseline
                                        ? {
                                            id: baseline.productId,
                                            itemId:
                                                baseline.replceId || baseline.itemId || item.itemId,
                                            productId: baseline.productId,
                                            name: baseline.productName,
                                            image: baseline.productImage,
                                            price: baseline.price || baseline.baseUnitPrice,
                                            quantity: baseline.qty,
                                            unit: "kg",
                                            category: baseline.categoryName || item.categoryName,
                                        }
                                        : null,
                            };
                        });

                        return {
                            ...pkg,
                            items: enrichedItems,
                            baselineProducts: pkgBaselines,
                        };
                    });

                    // 7. Packing slot availability
                    const packingSlots = await exports.getPackingSlotAvailabilityDao(
                        orderInfo.sheduleDate || orderInfo.processScheduleDate,
                        processOrderId,
                    );

                    resolve({
                        orderInfo,
                        packages: structuredPackages,
                        additionalItems,
                        packingSlots,
                    });
                } catch (queryErr) {
                    reject(queryErr);
                }
            },
        );
    });
};

/**
 * Replace a product within an orderpackage (updates orderpackageitems).
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
                                [newProductId, productType, newQty, newPrice, replceId, orderPackageId],
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
                        const restoreSql = `
                            UPDATE orderpackageitems
                            SET productId = ?, productType = ?, qty = ?, price = ?
                            WHERE id = ? AND orderPackageId = ?
                        `;
                        await new Promise((res, rej) => {
                            connection.query(
                                restoreSql,
                                [base.productId, base.productType, base.qty, base.price, replceId, orderPackageId],
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
 *  0. Sync orderpackageitems (+ baseline in prevdefineproduct) from payload / define defaults
 *  1. Batch replacements (only for packages NOT already synced from the payload)
 *  2. Delete removed ala carte rows
 *  2b. UPDATE edited EXISTING ala carte rows by id
 *  3. Insert / merge newly added ala carte items
 *  4. Lock packages
 *  5. Schedule date
 *  6. Totals on processorders (fullTotal, total, discount, + amount/moneyPaid for card)
 *  7. Credit balance (card orders): creditBalance += oldFullTotal - newFullTotal (capped at 0)
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
    updatedAdditionalItems = [],
    deletedAdditionalItemIds = [],
    packages = [],
}) => {
    return new Promise((resolve, reject) => {
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
                    connection.release();
                    return reject(txErr);
                }

                try {
                    // -1. Resolve real ids
                    const idRows = await q(
                        `SELECT
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
                         LIMIT 1`,
                        [processOrderId || orderId, userId],
                    );
                    if (idRows.length === 0) {
                        throw new Error("Order not found. Please reload the review screen and try again.");
                    }
                    const matchedOrder = idRows[0];
                    const realProcessOrderId = matchedOrder.processOrderId;
                    const realOrderId = matchedOrder.actualOrderId;
                    const targetUserId = matchedOrder.userId || userId;

                    // -1b. Snapshot from processorders (locked)
                    const orderRows = await q(
                        `SELECT total, fullTotal, discount, couponValue, deliveryCharge
                         FROM processorders
                         WHERE id = ?
                         FOR UPDATE`,
                        [realProcessOrderId],
                    );
                    if (orderRows.length === 0) {
                        throw new Error("Order not found. Please reload the review screen and try again.");
                    }
                    const orderSnap = orderRows[0];

                    const alacartDiscountSql = `
                        SELECT COALESCE(SUM(discount), 0) AS totalDiscount
                        FROM orderadditionalitems
                        WHERE proOrderId = ?
                    `;
                    const beforeDiscRows = await q(alacartDiscountSql, [realProcessOrderId]);
                    const oldAlacartDiscount = parseFloat(beforeDiscRows[0]?.totalDiscount) || 0;

                    // 0. orderpackage rows from DB
                    const dbPackages = await q(
                        `SELECT op.id AS orderPackageId, op.packageId, op.qty, op.packingStatus
                         FROM orderpackage op
                         WHERE op.orderId = ? OR op.orderId = ?`,
                        [realProcessOrderId, realOrderId],
                    );

                    if (dbPackages.length === 0 && Array.isArray(packages) && packages.length > 0) {
                        throw new Error(
                            "Package data has changed for this order. Please reload the review screen and try again.",
                        );
                    }

                    const syncedFromPayload = new Set();

                    for (const dbPkg of dbPackages) {
                        const targetPkgDbId = dbPkg.orderPackageId;
                        if (!targetPkgDbId) continue;

                        let pkgItems = [];
                        let fromPayload = false;
                        if (Array.isArray(packages)) {
                            const matched = packages.find(
                                (p) =>
                                    Number(p.orderPackageId) === Number(targetPkgDbId) ||
                                    Number(p.packageId) === Number(dbPkg.packageId),
                            );
                            if (matched && Array.isArray(matched.items) && matched.items.length > 0) {
                                pkgItems = matched.items;
                                fromPayload = true;
                            }
                        }

                        if (pkgItems.length === 0 && dbPkg.packageId) {
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

                        if (pkgItems.length > 0) {
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

                                await q(
                                    `INSERT INTO prevdefineproduct (orderPackageId, replceId, productType, productId, qty, price)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [targetPkgDbId, insertRes.insertId, finalProductType, prodId, qty, price],
                                );
                            }

                            if (fromPayload) syncedFromPayload.add(Number(targetPkgDbId));
                        }

                        await q(
                            "UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE id = ?",
                            [targetPkgDbId],
                        );
                    }

                    // 1. Replacements (only packages not synced from payload)
                    if (Array.isArray(replacements) && replacements.length > 0) {
                        const validPkgIds = new Set(dbPackages.map((p) => Number(p.orderPackageId)));

                        for (const rep of replacements) {
                            const { orderPackageId, replceId, newProductId, productType, newQty, newPrice } = rep;

                            if (!orderPackageId || !newProductId || !validPkgIds.has(Number(orderPackageId))) continue;
                            if (syncedFromPayload.has(Number(orderPackageId))) continue;

                            let targetReplceId = replceId;
                            let targetProductType = productType;

                            const matchingItems = await q(
                                "SELECT id, productType FROM orderpackageitems WHERE orderPackageId = ? AND (id = ? OR productId = ?) LIMIT 1",
                                [orderPackageId, replceId || 0, replceId || 0],
                            );
                            if (matchingItems.length > 0) {
                                targetReplceId = matchingItems[0].id;
                                if (!targetProductType) targetProductType = matchingItems[0].productType;
                            }

                            if (targetReplceId) {
                                await q(
                                    `UPDATE orderpackageitems
                                     SET productId = ?, productType = COALESCE(?, productType), qty = ?, price = ?
                                     WHERE id = ? AND orderPackageId = ?`,
                                    [newProductId, targetProductType, newQty, newPrice, targetReplceId, orderPackageId],
                                );
                            }
                        }
                    }

                    // 2. Delete removed ala carte rows
                    if (Array.isArray(deletedAdditionalItemIds) && deletedAdditionalItemIds.length > 0) {
                        const validDeleteIds = deletedAdditionalItemIds
                            .map((id) => Number(id))
                            .filter((id) => !isNaN(id) && id > 0);

                        if (validDeleteIds.length > 0) {
                            await q(
                                `DELETE FROM orderadditionalitems WHERE id IN (?) AND proOrderId = ?`,
                                [validDeleteIds, realProcessOrderId],
                            );
                        }
                    }

                    // 2b. Update edited existing ala carte rows
                    if (Array.isArray(updatedAdditionalItems) && updatedAdditionalItems.length > 0) {
                        for (const u of updatedAdditionalItems) {
                            const rowId = Number(u.id);
                            const qty = parseFloat(u.qty);
                            if (!rowId || isNaN(qty) || qty <= 0) continue;

                            const unit = String(u.unit || "kg").toLowerCase() === "g" ? "g" : "kg";

                            const rows = await q(
                                `SELECT id, productId
                                 FROM orderadditionalitems
                                 WHERE id = ? AND proOrderId = ?
                                 LIMIT 1
                                 FOR UPDATE`,
                                [rowId, realProcessOrderId],
                            );
                            if (rows.length === 0) continue;

                            const miRows = await q(
                                "SELECT normalPrice, discountedPrice FROM marketplaceitems WHERE id = ? LIMIT 1",
                                [rows[0].productId],
                            );
                            const perKgNormal = miRows.length ? parseFloat(miRows[0].normalPrice) || 0 : 0;
                            const perKgDiscounted = miRows.length ? parseFloat(miRows[0].discountedPrice) || 0 : 0;
                            const perKgEffective = perKgDiscounted > 0 ? perKgDiscounted : perKgNormal;
                            const kg = unit === "g" ? qty / 1000 : qty;

                            let normalPrice, price, discount;
                            if (perKgNormal > 0) {
                                normalPrice = round2(perKgNormal * kg);
                                price = round2(perKgEffective * kg);
                                discount = round2(Math.max(0, normalPrice - price));
                            } else {
                                normalPrice = round2(u.price);
                                price = normalPrice;
                                discount = 0;
                            }

                            await q(
                                `UPDATE orderadditionalitems
                                 SET qty = ?, unit = ?, normalPrice = ?, price = ?, discount = ?
                                 WHERE id = ?`,
                                [qty, unit, normalPrice, price, discount, rowId],
                            );
                        }
                    }

                    // 3. Newly added ala carte items (one row per productId)
                    if (Array.isArray(additionalItems) && additionalItems.length > 0) {
                        const toGrams = (qty, unit) => {
                            const n = Number(qty) || 0;
                            return String(unit || "kg").toLowerCase() === "g" ? n : n * 1000;
                        };
                        const fromGrams = (grams, unit) =>
                            String(unit || "kg").toLowerCase() === "g"
                                ? Math.round(grams)
                                : Number((grams / 1000).toFixed(3));

                        const mergedItems = new Map();
                        for (const item of additionalItems) {
                            const pid = Number(item.productId);
                            if (!pid) continue;
                            const grams = toGrams(item.qty, item.unit);
                            const ex = mergedItems.get(pid);
                            if (ex) {
                                ex.grams += grams;
                                ex.payloadPrice += Number(item.price) || 0;
                            } else {
                                mergedItems.set(pid, {
                                    productId: pid,
                                    grams,
                                    unit: item.unit || "kg",
                                    payloadPrice: Number(item.price) || 0,
                                });
                            }
                        }

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
                                return { normalPrice, price, discount: round2(Math.max(0, normalPrice - price)) };
                            };

                            const existingRows = await q(
                                `SELECT id, qty, unit, price
                                 FROM orderadditionalitems
                                 WHERE productId = ? AND proOrderId = ?
                                 ORDER BY id ASC
                                 LIMIT 1
                                 FOR UPDATE`,
                                [m.productId, realProcessOrderId],
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
                            } else {
                                let line;
                                if (hasMarketPrice) {
                                    line = calcLine(m.grams);
                                } else {
                                    const p = round2(m.payloadPrice);
                                    line = { normalPrice: p, price: p, discount: 0 };
                                }

                                await q(
                                    `INSERT INTO orderadditionalitems (proOrderId, productId, qty, unit, normalPrice, price, discount)
                                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                    [
                                        realProcessOrderId,
                                        m.productId,
                                        fromGrams(m.grams, m.unit),
                                        m.unit,
                                        line.normalPrice,
                                        line.price,
                                        line.discount,
                                    ],
                                );
                            }
                        }
                    }

                    // 3c. Refresh ALL ala carte rows with today's live prices
                    const allAlaCarteRows = await q(
                        `SELECT oai.id, oai.qty, oai.unit,
                                mi.normalPrice AS perKgNormal, mi.discountedPrice AS perKgDiscounted
                         FROM orderadditionalitems oai
                         JOIN marketplaceitems mi ON oai.productId = mi.id
                         WHERE oai.proOrderId = ?`,
                        [realProcessOrderId],
                    );
                    for (const row of allAlaCarteRows) {
                        const qty = parseFloat(row.qty) || 0;
                        const unit = String(row.unit || "kg").toLowerCase() === "g" ? "g" : "kg";
                        const perKgNormal = parseFloat(row.perKgNormal) || 0;
                        const perKgDiscounted = parseFloat(row.perKgDiscounted) || 0;
                        const perKgEffective = perKgDiscounted > 0 ? perKgDiscounted : perKgNormal;
                        const kg = unit === "g" ? qty / 1000 : qty;

                        if (perKgNormal > 0) {
                            const normalPrice = round2(perKgNormal * kg);
                            const price = round2(perKgEffective * kg);
                            const discount = round2(Math.max(0, normalPrice - price));
                            await q(
                                `UPDATE orderadditionalitems SET normalPrice = ?, price = ?, discount = ? WHERE id = ?`,
                                [normalPrice, price, discount, row.id],
                            );
                        }
                    }

                    // 4. Lock all packages
                    await q(
                        "UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE orderId = ? OR orderId = ?",
                        [realProcessOrderId, realOrderId],
                    );

                    // 5. Schedule date
                    if (newScheduleDate) {
                        await q("UPDATE processorders SET sheduleDate = ? WHERE id = ?", [
                            new Date(newScheduleDate),
                            realProcessOrderId,
                        ]);
                    }

                    // 6. Totals (processorders only)
                    const isCard = isCardPayment(
                        matchedOrder.paymentMethod || paymentMethod,
                        matchedOrder.isPaid,
                    );

                    const parsedNewTotal = newTotal != null ? parseFloat(newTotal) : null;
                    const parsedAdditional = parseFloat(additionalAmount) || 0;

                    // app's newTotal has NO coupon -> subtract it here
                    const couponValue = parseFloat(orderSnap.couponValue) || 0;
                    const netNewTotal =
                        parsedNewTotal != null && !isNaN(parsedNewTotal)
                            ? round2(Math.max(0, parsedNewTotal - couponValue))
                            : null;

                    const afterDiscRows = await q(alacartDiscountSql, [realProcessOrderId]);
                    const newAlacartDiscount = parseFloat(afterDiscRows[0]?.totalDiscount) || 0;

                    const oldOrderDiscount = parseFloat(orderSnap.discount) || 0;
                    const newOrderDiscount = round2(
                        Math.max(0, oldOrderDiscount + (newAlacartDiscount - oldAlacartDiscount)),
                    );

                    const oldFullTotal = parseFloat(orderSnap.fullTotal) || 0;
                    let newFullTotal = null;
                    if (netNewTotal != null) newFullTotal = netNewTotal;
                    else if (parsedAdditional > 0) newFullTotal = round2(oldFullTotal + parsedAdditional);

                    const finalFullTotal = newFullTotal != null ? newFullTotal : oldFullTotal;
                    const finalTotal =
                        newFullTotal != null
                            ? round2(newFullTotal + newOrderDiscount)
                            : parseFloat(orderSnap.total) || 0;

                    let creditPaid = parseFloat(matchedOrder.creditPaid) || 0;
                    let creditRefundOnDrop = 0;
                    if (newFullTotal != null && creditPaid > newFullTotal) {
                        creditRefundOnDrop = round2(creditPaid - newFullTotal);
                        creditPaid = newFullTotal;
                    }

                    if (isCard && newFullTotal != null) {
                        const newMoneyPaid = round2(Math.max(0, newFullTotal - creditPaid));
                        await q(
                            `UPDATE processorders
                             SET amount = ?, moneyPaid = ?, creditPaid = ?, fullTotal = ?, total = ?, discount = ?,
                                 isConfirmed = 1
                             WHERE id = ?`,
                            [newFullTotal, newMoneyPaid, creditPaid, finalFullTotal, finalTotal, newOrderDiscount, realProcessOrderId],
                        );
                    } else {
                        await q(
                            `UPDATE processorders
                             SET creditPaid = ?, fullTotal = ?, total = ?, discount = ?,
                                 isConfirmed = 1
                             WHERE id = ?`,
                            [creditPaid, finalFullTotal, finalTotal, newOrderDiscount, realProcessOrderId],
                        );
                    }

                    // 7. Credit balance
                    let creditChange =
                        isCard && newFullTotal != null ? round2(oldFullTotal - newFullTotal) : 0;
                    creditChange = round2(creditChange + creditRefundOnDrop);
                    const shortfall = await applyCreditChange(q, targetUserId, creditChange);

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
                            creditShortfall: shortfall,
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
 * Never rejects: resolves safe defaults on error.
 */
exports.getPackingSlotAvailabilityDao = (targetDate, processOrderId) => {
    return new Promise(async (resolve) => {
        try {
            let dateToUse = targetDate;
            if (!dateToUse && processOrderId) {
                const poRows = await new Promise((res) => {
                    db.collectionofficer.query(
                        "SELECT sheduleDate FROM processorders WHERE id = ? LIMIT 1",
                        [processOrderId],
                        (err, rows) => res(rows || []),
                    );
                });
                if (poRows.length > 0 && poRows[0].sheduleDate) {
                    dateToUse = poRows[0].sheduleDate;
                }
            }

            const targetInfo = await getRemainingPackingTarget(dateToUse);

            // Unread reminder notification count
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

            const remaining = targetInfo.remaining;
            const availableSlots = remaining;
            const isLimitReached = remaining <= 0 || unreadReminderDays >= 3;

            resolve({
                targetLimit: targetInfo.packingTargetLimit,
                acceptedOrdersCount: targetInfo.confirmOrders,
                availableSlots,
                remaining,
                isLimitReached,
                unreadReminderDays,
                scheduleDate: targetInfo.sheduleDate,
                additionalItems: targetInfo.additionalItems,
                packageFinalizeImdt: targetInfo.packageFinalizeImdt,
                packageReview: targetInfo.packageReview,
                confirmOrders: targetInfo.confirmOrders,
            });
        } catch (err) {
            console.error("[getPackingSlotAvailabilityDao] Error:", err);
            resolve({
                targetLimit: 50,
                acceptedOrdersCount: 0,
                availableSlots: 50,
                remaining: 50,
                isLimitReached: false,
                unreadReminderDays: 1,
                scheduleDate: targetDate || new Date().toISOString().split("T")[0],
            });
        }
    });
};

exports.getRemainingPackingTarget = getRemainingPackingTarget;

/**
 * Cancel order and refund the paid amount as credit balance.
 */
exports.cancelOrderDao = async ({ orderId, processOrderId, userId }) => {
    if ((!orderId && !processOrderId) || !userId) {
        throw new Error("orderId or processOrderId and userId are required");
    }

    const pool = db.collectionofficer;

    // Promise helpers
    const poolQuery = (sql, params) =>
        new Promise((res, rej) =>
            pool.query(sql, params, (e, r) => (e ? rej(e) : res(r))),
        );
    const getConnection = () =>
        new Promise((res, rej) =>
            pool.getConnection((e, c) => (e ? rej(e) : res(c))),
        );
    const run = (conn, sql, params) =>
        new Promise((res, rej) =>
            conn.query(sql, params, (e, r) => (e ? rej(e) : res(r))),
        );
    const begin = (conn) =>
        new Promise((res, rej) => conn.beginTransaction((e) => (e ? rej(e) : res())));
    const commit = (conn) =>
        new Promise((res, rej) => conn.commit((e) => (e ? rej(e) : res())));
    const rollback = (conn) =>
        new Promise((res) => conn.rollback(() => res()));

    // 0. Find the process order + verify ownership (read-only)
    const findSql = `
        SELECT
            po.id AS processOrderId,
            po.orderId AS actualOrderId,
            po.invNo
        FROM processorders po
        INNER JOIN orders o ON po.orderId = o.id
        WHERE (po.id = ? OR o.id = ?) AND o.userId = ?
        ORDER BY po.id DESC
        LIMIT 1
    `;
    const searchId = processOrderId || orderId;
    const found = await poolQuery(findSql, [searchId, searchId, userId]);

    if (!found || found.length === 0) {
        throw new Error(
            "Order not found or you do not have permission to cancel this order",
        );
    }

    const pOrderId = found[0].processOrderId;
    const actualOrderId = found[0].actualOrderId;
    const invNo = found[0].invNo;

    const connection = await getConnection();

    try {
        await begin(connection);

        // 1. Lock the row and read the CURRENT values
        const lockedRows = await run(
            connection,
            `SELECT amount, creditPaid, moneyPaid, paymentMethod, isPaid, status
             FROM processorders
             WHERE id = ?
             FOR UPDATE`,
            [pOrderId],
        );

        if (!lockedRows || lockedRows.length === 0) {
            throw new Error("Order not found");
        }

        const order = lockedRows[0];

        const currentStatus = order.status ? order.status.trim().toLowerCase() : "";
        if (currentStatus === "cancelled") {
            throw new Error("Order is already cancelled");
        }
        if (currentStatus === "delivered" || currentStatus === "picked up") {
            throw new Error("Completed order cannot be cancelled");
        }

        // 2. Refundable credit from the locked (original) values
        const pMethod = (order.paymentMethod || "").trim().toLowerCase();
        const rawAmount = parseFloat(order.amount) || 0;
        const rawCreditPaid = parseFloat(order.creditPaid) || 0;
        const rawMoneyPaid = parseFloat(order.moneyPaid) || 0;

        let refundCreditAmount = 0;
        if (isCardPayment(order.paymentMethod, order.isPaid)) {
            // Card / online (also Card + Credit): full amount refunded as credit
            refundCreditAmount = rawAmount > 0 ? rawAmount : rawMoneyPaid + rawCreditPaid;
        } else if (pMethod.includes("credit") && !pMethod.includes("cash")) {
            // 100% paid by credit balance
            refundCreditAmount = rawCreditPaid > 0 ? rawCreditPaid : rawAmount;
        } else {
            // Cash (+ Credit): refund only the credit used at checkout
            refundCreditAmount = rawCreditPaid > 0 ? rawCreditPaid : 0;
        }

        // 3. Mark as Cancelled AND reset the payment columns
        const cancelResult = await run(
            connection,
            `UPDATE processorders
             SET status = 'Cancelled',
                 isPaid = 0,
                 amount = 0,
                 creditPaid = 0,
                 moneyPaid = 0
             WHERE id = ?
               AND LOWER(TRIM(status)) <> 'cancelled'`,
            [pOrderId],
        );

        if (cancelResult.affectedRows === 0) {
            throw new Error("Order is already cancelled");
        }

        // 4. Refund to marketplaceusers.creditBalance
        let newCreditBalance = null;
        if (refundCreditAmount > 0) {
            await run(
                connection,
                "UPDATE marketplaceusers SET creditBalance = creditBalance + ? WHERE id = ?",
                [refundCreditAmount, userId],
            );

            const creditRows = await run(
                connection,
                "SELECT creditBalance FROM marketplaceusers WHERE id = ?",
                [userId],
            );
            if (creditRows && creditRows.length > 0) {
                newCreditBalance = parseFloat(creditRows[0].creditBalance || 0);
            }
        }

        // 5. Notifications (failures are logged but don't block the cancel)
        const invNoDisplay = invNo || `ORD-${actualOrderId}`;
        const notifMsg = `Your order #${invNoDisplay} has been cancelled successfully.`;

        try {
            await run(
                connection,
                `INSERT INTO ordernotfication (orderId, Title, message, isRead, createdAt)
                 VALUES (?, 'Order Cancelled', ?, 0, NOW())`,
                [pOrderId, notifMsg],
            );
        } catch (notifErr) {
            console.error("Error inserting ordernotfication on cancel:", notifErr);
        }

        try {
            const updateDashResult = await run(
                connection,
                `UPDATE dashnotification
                 SET title = 'Order is Cancelled', readStatus = 0, createdAt = NOW()
                 WHERE orderId = ?`,
                [pOrderId],
            );

            if (!updateDashResult || updateDashResult.affectedRows === 0) {
                await run(
                    connection,
                    `INSERT INTO dashnotification (orderId, title, readStatus, createdAt)
                     VALUES (?, 'Order is Cancelled', 0, NOW())`,
                    [pOrderId],
                );
            }
        } catch (dashErr) {
            console.error("Error updating dashnotification on cancel:", dashErr);
        }

        await commit(connection);

        // Sales Dash real-time notification
        try {
            const salesdashNotificationService = require("../services/salesdash-notification-service");
            if (typeof salesdashNotificationService?.notifySalesDashOrderCancelled === "function") {
                salesdashNotificationService
                    .notifySalesDashOrderCancelled(pOrderId, invNoDisplay)
                    .catch((err) => {
                        console.warn("⚠️ [CancelOrder] SalesDash notification error:", err?.message);
                    });
            }
        } catch (sdErr) {
            console.warn("⚠️ [CancelOrder] SalesDash notification setup error:", sdErr?.message);
        }

        // Polygon customer app push notification (Expo/FCM) & Socket.IO
        try {
            const polygonNotificationService = require("../services/polygon-notification-service");
            if (typeof polygonNotificationService?.notifyPolygonOrderCancelled === "function") {
                polygonNotificationService
                    .notifyPolygonOrderCancelled(pOrderId, invNoDisplay, userId)
                    .catch((err) => {
                        console.warn("⚠️ [CancelOrder] Polygon customer background notification error:", err?.message);
                    });
            }
        } catch (polyErr) {
            console.warn("⚠️ [CancelOrder] Polygon customer notification setup error:", polyErr?.message);
        }

        return {
            success: true,
            orderId: actualOrderId,
            processOrderId: pOrderId,
            invoiceNo: invNo,
            status: "Cancelled",
            refundCreditAmount,
            newCreditBalance,
            message:
                refundCreditAmount > 0
                    ? `Order cancelled. Rs. ${refundCreditAmount.toFixed(2)} added to your credit balance.`
                    : "Order cancelled successfully.",
        };
    } catch (err) {
        await rollback(connection);
        throw err;
    } finally {
        connection.release();
    }
};

/**
 * Confirm order with live marketplace prices.
 * Recalculates and updates:
 *   - orderadditionalitems (normalPrice, price, discount) using today's marketplaceitems prices
 *   - processorders (fullTotal, total, discount, + amount/moneyPaid/creditPaid)
 *   - orderpackage (packingStatus = 'Dispatch', isLock = 1)
 * The `orders` table is NOT updated for totals.
 */
exports.confirmOrderWithLivePricesDao = ({ orderId, processOrderId, userId, newTotal = null }) => {
    return new Promise((resolve, reject) => {
        db.collectionofficer.getConnection((connErr, connection) => {
            if (connErr) return reject(connErr);

            const q = (sql, params = []) =>
                new Promise((res, rej) =>
                    connection.query(sql, params, (e, r) => (e ? rej(e) : res(r || []))),
                );

            connection.beginTransaction(async (txErr) => {
                if (txErr) {
                    connection.release();
                    return reject(txErr);
                }

                try {
                    // 1. Resolve + lock the processorders row
                    const searchId = processOrderId || orderId;
                    const idRows = await q(
                        `SELECT
                            po.id AS processOrderId,
                            po.orderId AS actualOrderId,
                            po.paymentMethod,
                            po.isPaid,
                            po.isConfirmed,
                            po.amount,
                            po.moneyPaid,
                            po.creditPaid,
                            po.isCoupon,
                            po.couponType,
                            po.couponValue,
                            po.deliveryCharge,
                            po.curDlvrCharge,
                            po.discount  AS oldOrderDiscount,
                            po.fullTotal AS oldOrderFullTotal,
                            o.userId
                         FROM processorders po
                         INNER JOIN orders o ON po.orderId = o.id
                         WHERE (po.id = ? OR o.id = ?) AND o.userId = ?
                         ORDER BY po.id DESC
                         LIMIT 1
                         FOR UPDATE`,
                        [searchId, searchId, userId],
                    );
                    if (idRows.length === 0) throw new Error("Order not found.");

                    const matchedOrder = idRows[0];
                    const realProcessOrderId = matchedOrder.processOrderId;
                    const targetUserId = matchedOrder.userId || userId;

                    // Prevents double credit adjustments on a second tap / retry
                    if (Number(matchedOrder.isConfirmed) === 1) {
                        throw new Error("This order has already been confirmed.");
                    }

                    // 2. Recalculate ala carte rows with today's marketplace prices
                    const alaRows = await q(
                        `SELECT oai.id, oai.qty, oai.unit,
                                oai.price AS storedPrice,
                                oai.discount AS originalDiscount,
                                mi.normalPrice AS perKgNormal,
                                mi.discountedPrice AS perKgDiscounted
                         FROM orderadditionalitems oai
                         JOIN marketplaceitems mi ON oai.productId = mi.id
                         WHERE oai.proOrderId = ?`,
                        [realProcessOrderId],
                    );

                    let alaPriceTotal = 0;
                    let alaDiscountTotal = 0;
                    let oldAlaDiscountTotal = 0;

                    for (const row of alaRows) {
                        oldAlaDiscountTotal += parseFloat(row.originalDiscount) || 0;

                        const qty = parseFloat(row.qty) || 0;
                        const unit = String(row.unit || "kg").toLowerCase() === "g" ? "g" : "kg";
                        const kg = unit === "g" ? qty / 1000 : qty;
                        const perKgNormal = parseFloat(row.perKgNormal) || 0;
                        const perKgDisc = parseFloat(row.perKgDiscounted) || 0;
                        const perKgEffective = perKgDisc > 0 ? perKgDisc : perKgNormal;

                        if (perKgNormal > 0 || perKgEffective > 0) {
                            // Only today's marketplace values (same rule as the app screen)
                            const price = round2(perKgEffective * kg);
                            const normalPrice = round2(Math.max(perKgNormal * kg, price));
                            const discount = round2(Math.max(0, normalPrice - price));

                            alaPriceTotal += price;
                            alaDiscountTotal += discount;

                            await q(
                                `UPDATE orderadditionalitems
                                 SET normalPrice = ?, price = ?, discount = ?
                                 WHERE id = ?`,
                                [normalPrice, price, discount, row.id],
                            );
                        } else {
                            // no live price: keep the stored row price in the total
                            alaPriceTotal += parseFloat(row.storedPrice) || 0;
                        }
                    }

                    // 3. Lock all packages of this order
                    await q(
                        "UPDATE orderpackage SET packingStatus = 'Dispatch', isLock = 1 WHERE orderId = ?",
                        [realProcessOrderId],
                    );

                    // 4. Packages total
                    const pkgRows = await q(
                        `SELECT COALESCE(SUM((mp.productPrice + mp.packingFee + mp.serviceFee) * op.qty), 0) AS packageTotal
                         FROM orderpackage op
                         JOIN marketplacepackages mp ON op.packageId = mp.id
                         WHERE op.orderId = ?`,
                        [realProcessOrderId],
                    );
                    const packagesTotal = parseFloat(pkgRows[0]?.packageTotal) || 0;

                    // 5. New totals
                    const couponValue = parseFloat(matchedOrder.couponValue) || 0;
                    const deliveryCharge =
                        matchedOrder.curDlvrCharge != null && matchedOrder.curDlvrCharge !== ""
                            ? parseFloat(matchedOrder.curDlvrCharge) || 0
                            : parseFloat(matchedOrder.deliveryCharge) || 0;

                    let finalFullTotal;
                    if (newTotal != null && !isNaN(parseFloat(newTotal))) {
                        // from the app: already includes discounts, coupon and delivery
                        finalFullTotal = round2(Math.max(0, parseFloat(newTotal)));
                    } else {
                        finalFullTotal = round2(
                            Math.max(0, packagesTotal + alaPriceTotal - alaDiscountTotal - couponValue + deliveryCharge),
                        );
                    }

                    // keep the old package discount, replace only the ala carte part
                    const oldOrderDiscount = parseFloat(matchedOrder.oldOrderDiscount) || 0;
                    const oldPackageDiscount = Math.max(0, oldOrderDiscount - oldAlaDiscountTotal);
                    const finalDiscount = round2(oldPackageDiscount + alaDiscountTotal);
                    const finalTotal = round2(finalFullTotal + finalDiscount);

                    // 6. Payment handling
                    const isCard = isCardPayment(matchedOrder.paymentMethod, matchedOrder.isPaid);
                    const oldFullTotal = parseFloat(matchedOrder.oldOrderFullTotal) || 0;
                    let creditPaid = parseFloat(matchedOrder.creditPaid) || 0;
                    let creditRefundOnDrop = 0;

                    // total dropped below the credit already applied (e.g. Cash + Credit)
                    if (creditPaid > finalFullTotal) {
                        creditRefundOnDrop = round2(creditPaid - finalFullTotal);
                        creditPaid = finalFullTotal;
                    }

                    if (isCard) {
                        const newMoneyPaid = round2(Math.max(0, finalFullTotal - creditPaid));
                        await q(
                            `UPDATE processorders
                             SET amount = ?, moneyPaid = ?, creditPaid = ?, fullTotal = ?, total = ?, discount = ?,
                                 isConfirmed = 1
                             WHERE id = ?`,
                            [finalFullTotal, newMoneyPaid, creditPaid, finalFullTotal, finalTotal, finalDiscount, realProcessOrderId],
                        );
                    } else {
                        await q(
                            `UPDATE processorders
                             SET creditPaid = ?, fullTotal = ?, total = ?, discount = ?,
                                 isConfirmed = 1
                             WHERE id = ?`,
                            [creditPaid, finalFullTotal, finalTotal, finalDiscount, realProcessOrderId],
                        );
                    }

                    // 7. Credit balance
                    //    card orders: creditBalance += oldFullTotal - newFullTotal
                    //    any order where credit was over-applied: give the excess back
                    let creditChange = isCard ? round2(oldFullTotal - finalFullTotal) : 0;
                    creditChange = round2(creditChange + creditRefundOnDrop);
                    const shortfall = await applyCreditChange(q, targetUserId, creditChange);

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
                            message: "Order confirmed and marketplace prices updated successfully",
                            fullTotal: finalFullTotal,
                            total: finalTotal,
                            discount: finalDiscount,
                            creditShortfall: shortfall, // > 0 = extra amount not covered by credit
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
const db = require("../startup/database");

// ─── ORDER PLACEMENT DAOs ─────────────────────────────────────────────────────
// Ported from Web project (D:\Polygon\Web Apps\Govi Mart Web\MarketPlace-Web-API\dao\Cart-dao.js)
// Note: QR code / S3 upload intentionally omitted for mobile (user decision)

/**
 * Verify that the cart belongs to the authenticated user.
 */
exports.validateCartDao = (cartId, userId) => {
    return new Promise((resolve, reject) => {
        const sql = `SELECT id FROM cart WHERE id = ? AND userId = ?`;
        db.collectionofficer.query(sql, [cartId, userId], (err, results) => {
            if (err) return reject(err);
            resolve(results.length > 0);
        });
    });
};

/**
 * Check if any cart items (products or packages) are no longer available.
 */
exports.checkCartItemsAvailabilityDao = (cartId) => {
    return new Promise((resolve, reject) => {
        const productSql = `
            SELECT COUNT(*) AS disabledCount
            FROM cartadditionalitems cai
            JOIN marketplaceitems mi ON cai.productId = mi.id
            WHERE cai.cartId = ? AND mi.isEnable = 0
        `;
        const packageSql = `
            SELECT COUNT(*) AS invalidCount
            FROM cartpackage cp
            JOIN marketplacepackages mp ON cp.packageId = mp.id
            WHERE cp.cartId = ? AND (mp.isValid = 0 OR mp.status = 'Disabled')
        `;
        Promise.all([
            new Promise((res, rej) => {
                db.collectionofficer.query(productSql, [cartId], (err, r) => {
                    if (err) return rej(err);
                    res(r[0].disabledCount);
                });
            }),
            new Promise((res, rej) => {
                db.collectionofficer.query(packageSql, [cartId], (err, r) => {
                    if (err) return rej(err);
                    res(r[0].invalidCount);
                });
            }),
        ])
            .then(([disabledCount, invalidCount]) => {
                resolve({
                    hasUnavailableItems: disabledCount > 0 || invalidCount > 0,
                    disabledCount,
                    invalidCount,
                });
            })
            .catch(reject);
    });
};

/**
 * Fetch all cart items (products + packages) for order creation.
 */
exports.getCartItemsForOrderDao = (cartId) => {
    return new Promise((resolve, reject) => {
        const productsSql = `
            SELECT productId, qty, unit, 'additional' AS itemType
            FROM cartadditionalitems WHERE cartId = ?
        `;
        const packagesSql = `
            SELECT packageId, qty, 'package' AS itemType
            FROM cartpackage WHERE cartId = ?
        `;
        Promise.all([
            new Promise((res, rej) => {
                db.collectionofficer.query(productsSql, [cartId], (err, r) => {
                    if (err) return rej(err);
                    res(r);
                });
            }),
            new Promise((res, rej) => {
                db.collectionofficer.query(packagesSql, [cartId], (err, r) => {
                    if (err) return rej(err);
                    res(r);
                });
            }),
        ])
            .then(([products, packages]) => resolve([...products, ...packages]))
            .catch(reject);
    });
};

/**
 * Insert a new row into `orders` within an open transaction.
 * For pickup orders, resolves assignCoMCenId from distributedcompanycenter.
 */
exports.createOrderWithTransactionDao = (connection, orderData) => {
    return new Promise((resolve, reject) => {
        const {
            userId, delivaryMethod, centerId, buildingType,
            title, fullName, phonecode1, phone1, phonecode2, phone2,
            isCoupon, couponValue, couponType, total, fullTotal, discount,
            sheduleType, sheduleDate, sheduleTime, isPackage,
            latitude, longitude, companycenterId, deliveryCharge, isFinalizeImdt,
        } = orderData;

        const formatMethod = (m) => {
            if (!m) return m;
            if (m.toLowerCase() === 'home') return 'Delivery';
            return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
        };
        const formatType = (t) => {
            if (!t) return t;
            return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
        };

        const formattedMethod = formatMethod(delivaryMethod);
        const formattedBuildingType = formatType(buildingType);
        const isPickup = delivaryMethod && delivaryMethod.toLowerCase() === 'pickup';

        const insertOrder = (assignCoMCenId) => {
            const sql = `
                INSERT INTO orders (
                    userId, orderApp, delivaryMethod, centerId, buildingType,
                    title, fullName, phonecode1, phone1, phonecode2, phone2,
                    isCoupon, couponType, couponValue, total, fullTotal, discount,
                    deliveryCharge, sheduleType, sheduleDate, sheduleTime,
                    isPackage, isFinalizeImdt, latitude, longitude, assignCoMCenId
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const values = [
                userId, 'Marketplace', formattedMethod, centerId || null, formattedBuildingType || null,
                title, fullName, phonecode1, phone1, phonecode2 || null, phone2 || null,
                isCoupon ? 1 : 0, isCoupon ? (couponType || null) : null, parseFloat(couponValue) || 0,
                total, fullTotal, discount,
                parseFloat(deliveryCharge) || 0,
                (sheduleType === 'One Time Order' ? 'One Time' : (sheduleType || 'One Time')),
                sheduleDate ? new Date(sheduleDate) : null, sheduleTime || null,
                isPackage ? 1 : 0, isFinalizeImdt ? 1 : 0,
                latitude ? parseFloat(latitude) : null, longitude ? parseFloat(longitude) : null,
                assignCoMCenId,
            ];
            connection.query(sql, values, (err, results) => {
                if (err) return reject(err);
                resolve(results.insertId);
            });
        };

        if (isPickup) {
            if (!centerId) return reject(new Error('centerId is required for pickup orders'));
            const lookupSql = `
                SELECT id FROM collection_officer.distributedcompanycenter
                WHERE centerId = ? LIMIT 1
            `;
            connection.query(lookupSql, [centerId], (err, rows) => {
                if (err) return reject(err);
                if (!rows || rows.length === 0) {
                    return reject(new Error(`No distributedcompanycenter mapping for centerId ${centerId}`));
                }
                insertOrder(rows[0].id);
            });
        } else {
            insertOrder(companycenterId || null);
        }
    });
};

/**
 * Insert order address (house or apartment) within a transaction.
 */
exports.createOrderAddressWithTransactionDao = (connection, orderId, addressData, buildingType) => {
    return new Promise((resolve, reject) => {
        if (buildingType === 'apartment') {
            const { buildingNo, buildingName, unitNo, floorNo, houseNo, streetName, city, saveAs } = addressData;
            const sql = `
                INSERT INTO orderapartment (orderId, saveAs, buildingNo, buildingName, unitNo, floorNo, houseNo, streetName, city)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            connection.query(sql, [orderId, saveAs || null, buildingNo, buildingName, unitNo, floorNo, houseNo || null, streetName, city], (err, r) => {
                if (err) return reject(err);
                resolve(r.insertId);
            });
        } else if (buildingType === 'house') {
            const { houseNo, streetName, city, saveAs } = addressData;
            const sql = `INSERT INTO orderhouse (orderId, saveAs, houseNo, streetName, city) VALUES (?, ?, ?, ?, ?)`;
            connection.query(sql, [orderId, saveAs || null, houseNo, streetName, city], (err, r) => {
                if (err) return reject(err);
                resolve(r.insertId);
            });
        } else {
            reject(new Error('Invalid building type'));
        }
    });
};

/**
 * Insert processorders row (invoice number via stored procedure) within a transaction.
 * QR code upload intentionally skipped for mobile.
 */
exports.createProcessOrderWithTransactionDao = (connection, processOrderData) => {
    return new Promise((resolve, reject) => {
        const {
            orderId, paymentMethod, isPaid, amount, creditPaid, moneyPaid, status, sheduleDate,
        } = processOrderData;

        const formatMethod = (m) => {
            if (!m) return m;
            return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
        };

        // Call stored procedure to generate invoice number
        connection.query('CALL `generate_invoice_number`(@new_inv_no)', [], (err) => {
            if (err) return reject(err);

            connection.query('SELECT @new_inv_no AS inv_no', [], (err2, rows) => {
                if (err2) return reject(err2);

                const invNo = rows?.[0]?.inv_no;
                if (!invNo) return reject(new Error('Failed to generate invoice number'));

                const formattedMethod = formatMethod(paymentMethod);
                const normalized = formattedMethod ? formattedMethod.toLowerCase() : '';

                let finalIsPaid = isPaid || 0;
                let finalAmount = parseFloat(amount) || 0;
                let finalMoneyPaid = parseFloat(moneyPaid) || 0;
                const finalCreditPaid = parseFloat(creditPaid) || 0;
                let finalMethod = formattedMethod;

                if (normalized === 'cash') {
                    finalIsPaid = 0;
                    finalAmount = 0;
                    finalMoneyPaid = 0;
                } else if (normalized === 'card') {
                    finalIsPaid = 1;
                }

                if (normalized !== 'cash' && finalCreditPaid > 0 && finalMoneyPaid === 0) {
                    finalIsPaid = 1;
                    finalMethod = 'Card';
                }

                const sql = `
                    INSERT INTO processorders (
                        orderId, invNo, transactionId, paymentMethod,
                        isPaid, amount, creditPaid, moneyPaid, status, reportStatus, qrCode, sheduleDate
                    ) VALUES (?, @new_inv_no, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const values = [
                    orderId, null, finalMethod, finalIsPaid,
                    finalAmount, finalCreditPaid, finalMoneyPaid,
                    status || 'Ordered', null, null,
                    sheduleDate ? new Date(sheduleDate) : null,
                ];

                connection.query(sql, values, (err3, insertResult) => {
                    if (err3) {
                        if (err3.code === 'ER_DUP_ENTRY' && err3.message.includes('invNo')) {
                            // Retry on duplicate invoice number (race condition)
                            return exports.createProcessOrderWithTransactionDao(connection, processOrderData)
                                .then(resolve)
                                .catch(reject);
                        }
                        return reject(err3);
                    }
                    resolve({ insertId: insertResult.insertId, invNo });
                });
            });
        });
    });
};

/**
 * Insert all order items (products + packages) within a transaction.
 */
exports.saveOrderItemsWithTransactionDao = (connection, orderId, processOrderId, items) => {
    return new Promise((resolve, reject) => {
        const promises = items.map((item) => {
            if (item.itemType === 'additional') {
                return exports.saveOrderAdditionalItemWithTransactionDao(connection, orderId, item);
            } else if (item.itemType === 'package') {
                return exports.saveOrderPackageWithTransactionDao(connection, processOrderId, item);
            }
            return Promise.resolve();
        });
        Promise.all(promises).then(() => resolve()).catch(reject);
    });
};

exports.saveOrderAdditionalItemWithTransactionDao = (connection, orderId, itemData) => {
    return new Promise((resolve, reject) => {
        const { productId, qty, unit } = itemData;

        const priceSql = `SELECT normalPrice, discount, unitType FROM marketplaceitems WHERE id = ?`;
        connection.query(priceSql, [productId], (err, rows) => {
            if (err) return reject(err);
            if (!rows.length) return reject(new Error(`Product ${productId} not found`));

            const { normalPrice, discount } = rows[0];
            const normalPerKg = parseFloat(normalPrice) || 0;
            const discountPerKg = parseFloat(discount) || 0;

            let qtyInKg, calcNormal, calcDiscount, calcPrice;
            if (unit.toLowerCase() === 'kg') {
                qtyInKg = parseFloat(qty);
            } else {
                qtyInKg = parseFloat(qty) / 1000;
            }
            calcNormal = normalPerKg * qtyInKg;
            calcDiscount = discountPerKg * qtyInKg;
            calcPrice = calcNormal - calcDiscount;

            const sql = `
                INSERT INTO orderadditionalitems (orderId, productId, qty, unit, normalPrice, price, discount)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            connection.query(sql, [orderId, productId, qty, unit, calcNormal, calcPrice, calcDiscount], (err2, r) => {
                if (err2) return reject(err2);
                resolve(r.insertId);
            });
        });
    });
};

exports.saveOrderPackageWithTransactionDao = (connection, processOrderId, packageData) => {
    return new Promise((resolve, reject) => {
        const { packageId, qty } = packageData;
        const sql = `INSERT INTO orderpackage (orderId, packageId, qty) VALUES (?, ?, ?)`;
        connection.query(sql, [processOrderId, packageId, qty || 1], (err, r) => {
            if (err) return reject(err);
            resolve(r.insertId);
        });
    });
};

/**
 * Clear the cart after successful order creation (outside transaction, best-effort).
 */
exports.clearCartAfterOrderDao = (cartId) => {
    return new Promise((resolve, reject) => {
        db.collectionofficer.query(`DELETE FROM cartadditionalitems WHERE cartId = ?`, [cartId], (err) => {
            if (err) return reject(err);
            db.collectionofficer.query(`DELETE FROM cartpackage WHERE cartId = ?`, [cartId], (err2) => {
                if (err2) return reject(err2);
                db.collectionofficer.query(`DELETE FROM cart WHERE id = ?`, [cartId], (err3, r) => {
                    if (err3) return reject(err3);
                    resolve(r.affectedRows > 0);
                });
            });
        });
    });
};

/**
 * Fetch all pickup centres that have a valid distributedcompanycenter mapping.
 */
exports.getPickupCentersDao = () => {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT
                dc.id AS centerId,
                dc.centerName,
                dc.longitude,
                dc.latitude,
                dc.city,
                dc.district,
                dc.province,
                dc.country
            FROM distributedcenter dc
            WHERE dc.longitude IS NOT NULL
              AND dc.latitude IS NOT NULL
              AND dc.centerName IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM distributedcompanycenter dcc
                  INNER JOIN centerowncity coc ON coc.companyCenterId = dcc.id
                  WHERE dcc.centerId = dc.id
              )
            ORDER BY dc.centerName ASC
        `;
        db.collectionofficer.query(sql, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

/**
 * Fetch delivery cities with their delivery charge and company centre mapping.
 */
exports.getDeliveryCitiesDao = () => {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT
                dc.id,
                dc.city,
                dc.charge,
                coc.companyCenterId AS companycenterId,
                dc.createdAt
            FROM deliverycharge dc
            INNER JOIN centerowncity coc ON dc.id = coc.cityId
            ORDER BY dc.city ASC
        `;
        db.collectionofficer.query(sql, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

exports.getRetailOrderHistoryDao = async (userId) => {
    return new Promise((resolve, reject) => {
        if (!userId) {
            return reject('Invalid userId');
        }

        const orderQuery = `
      SELECT 
        po.id AS orderId,
        o.sheduleDate AS scheduleDate,
        o.createdAt AS createdAt,
        o.sheduleTime AS scheduleTime,
        o.delivaryMethod AS delivaryMethod,
        o.discount AS orderDiscount,
        o.fulltotal AS fullTotal,
        po.invNo AS invoiceNo,
        po.status AS processStatus
      FROM orders o
      LEFT JOIN (
        SELECT *
        FROM processorders
        WHERE id IN (
          SELECT MAX(id)
          FROM processorders
          GROUP BY orderId
        )
      ) po ON o.id = po.orderId
      WHERE o.userId = ?
      ORDER BY o.createdAt DESC
    `;

        const familyPackItemsQuery = `
      SELECT 
        op.id,
        mp.productPrice AS amount
      FROM orderpackage op
      JOIN marketplacepackages mp ON op.packageId = mp.id
      WHERE op.orderId = ?
    `;

        const additionalItemsQuery = `
      SELECT
        oai.price AS unitPrice,
        oai.qty AS quantity,
        (oai.price * oai.qty) AS amount,
        oai.discount AS itemDiscount
      FROM orderadditionalitems oai
      JOIN marketplaceitems mi ON oai.productId = mi.id
      WHERE oai.orderId = ?
    `;

        db.collectionofficer.query(orderQuery, [userId], async (err, orders) => {
            if (err) {
                return reject("Error fetching retail order history: " + err);
            }

            try {
                const normalizedOrders = await Promise.all(
                    orders.map(async (order) => {
                        // (Optional) Keep the below two fetches in case you want item breakdown later
                        const familyPackItems = await new Promise((res, rej) => {
                            db.collectionofficer.query(familyPackItemsQuery, [order.orderId], (err, items) => {
                                if (err) return rej("Family pack query error: " + err);
                                res(items || []);
                            });
                        });

                        const additionalItems = await new Promise((res, rej) => {
                            db.collectionofficer.query(additionalItemsQuery, [order.orderId], (err, items) => {
                                if (err) return rej("Additional items query error: " + err);
                                res(items || []);
                            });
                        });

                        // ✅ Use fullTotal directly from DB
                        const fullTotal = parseFloat(order.fullTotal || 0).toFixed(2);

                        return {
                            orderId: String(order.orderId) || 'N/A',
                            invoiceNo: order.invoiceNo ? String(order.invoiceNo) : 'N/A',
                            scheduleDate: order.scheduleDate || 'N/A',
                            scheduleTime: order.scheduleTime || 'N/A',
                            delivaryMethod: order.delivaryMethod || 'N/A',
                            fullTotal: `Rs. ${fullTotal}`,
                            createdAt: order.createdAt || 'N/A',
                            processStatus: order.processStatus || 'Pending',
                        };
                    })
                );

                resolve(normalizedOrders);
            } catch (err) {
                reject("Error processing order totals: " + err);
            }
        });
    });
};

exports.getRetailOrderByIdDao = async (orderId, userId) => {
    return new Promise((resolve, reject) => {
        if (!orderId || !userId) {
            return reject("Invalid orderId or userId");
        }

        const orderSql = `
      SELECT 
        o.*, 
        p.status AS processStatus,
        p.invNo AS invoiceNo,  
        CASE 
          WHEN o.delivaryMethod = 'PICKUP' THEN 'PICKUP'
          WHEN o.delivaryMethod = 'DELIVERY' THEN 'DELIVERY'
          ELSE 'UNKNOWN'
        END AS deliveryType
      FROM orders o
      LEFT JOIN processorders p ON o.id = p.orderId
      
      WHERE p.id = ? AND o.userId = ?
    `;

        const houseSql = `SELECT * FROM orderhouse WHERE orderId = ?`;
        const apartmentSql = `SELECT * FROM orderapartment WHERE orderId = ?`;

        db.collectionofficer.query(orderSql, [orderId, userId], (err, orders) => {
            if (err) return reject("Error fetching order: " + err);
            if (!orders || orders.length === 0) return reject("Order not found or unauthorized");

            const order = orders[0];

            // Handle Pickup Delivery
            if (order.deliveryType === 'PICKUP') {
                const pickupSql = `SELECT * FROM distributedcenter WHERE id = ?`;

                db.collectionofficer.query(pickupSql, [order.centerId], (err, centers) => {
                    if (err) return reject("Error fetching distributed center: " + err);
                    if (!centers || centers.length === 0) return reject("Distributed center not found");

                    const center = centers[0];

                    order.pickupInfo = {
                        centerId: center.id,
                        centerName: center.centerName || center.name || "Unknown",
                        contact01: center.contact01 || center.phone || "Not Available",
                        address: {
                            street: center.street || "",
                            city: center.city || "",
                            district: center.district || "",
                            province: center.province || "",
                            country: center.country || "",
                            zipCode: center.zipCode || ""
                        },
                        pickupPerson: {
                            fullName: order.fullName || "Not specified",
                            phoneCode: order.phoneCode || "+94", // fallback default
                            phone1: order.phone1 || "Not provided",
                            phone2: order.phone2 || "Not provided"
                        }
                    };

                    return resolve(order);
                });

                // Handle Delivery
            } else if (order.deliveryType === 'DELIVERY') {
                if (order.buildingType === 'House') {
                    db.collectionofficer.query(houseSql, [order.id], (err, result) => {
                        if (err) return reject("Error fetching house delivery: " + err);
                        if (!result || result.length === 0) return reject("House delivery address not found");

                        order.deliveryInfo = {
                            buildingType: 'House',
                            ...result[0]
                        };
                        return resolve(order);
                    });

                } else if (order.buildingType === 'Apartment') {
                    db.collectionofficer.query(apartmentSql, [order.id], (err, result) => {
                        if (err) return reject("Error fetching apartment delivery: " + err);
                        if (!result || result.length === 0) return reject("Apartment delivery address not found");

                        const apartmentDetails = result[0]; // Get the apartment delivery details

                        order.deliveryInfo = {
                            // Delivery address from apartment details
                            buildingType: apartmentDetails.buildingType || 'Apartment',
                            houseNo: apartmentDetails.houseNo || '--',
                            street: apartmentDetails.streetName || '--',
                            city: apartmentDetails.city || '--',
                            buildingNo: apartmentDetails.buildingNo || '--',
                            buildingName: apartmentDetails.buildingName || '--',
                            flatNo: apartmentDetails.unitNo || '--',
                            floorNo: apartmentDetails.floorNo || '--',
                            // Receiving person information from retailorder
                            fullName: order.fullName || '--',
                            phone: order.phone1
                                ? `+${order.phonecode1 || ''} ${order.phone1}`
                                : order.userPhoneNumber
                                    ? `+${order.userPhoneCode || ''} ${order.userPhoneNumber}`
                                    : 'N/A', // Use retailorder phone, fallback to marketplaceusers
                        };
                        // Debug log to check deliveryInfo
                        console.log('deliveryInfo at 03:40 PM +0530, May 27, 2025:', order.deliveryInfo);
                        // Remove the old deliveryAddress field to avoid redundancy
                        delete order.deliveryAddress;
                        resolve(order);
                    });

                } else {
                    return reject("Invalid buildingType for delivery");
                }

            } else {
                return resolve(order); // Unknown delivery method
            }
        });
    });
};

exports.getOrderPackageDetailsDao = async (orderId) => {
    return new Promise((resolve, reject) => {
        if (!orderId) {
            return reject(new Error("Invalid orderId"));
        }

        const sql = `
      SELECT 
        op.id AS orderPackageId,    -- unique row for each package instance in the order
        op.packageId,
        op.qty AS packageQty,       -- quantity of this package in the order
        mp.displayName,
        (mp.productPrice + mp.packingFee + mp.serviceFee) AS productPrice,
        pd.qty AS itemQty,
        pt.typeName
      FROM orderpackage op
      JOIN marketplacepackages mp ON op.packageId = mp.id
      JOIN packagedetails pd ON mp.id = pd.packageId
      JOIN producttypes pt ON pd.productTypeId = pt.id
      WHERE op.orderId = ?
      ORDER BY op.id
    `;

        db.collectionofficer.query(sql, [orderId], (err, results) => {
            if (err) {
                return reject(new Error("Database error: " + err.message));
            }

            // First group by orderPackageId to get package details with products
            const groupedPackages = {};

            results.forEach(row => {
                const key = row.orderPackageId;

                if (!groupedPackages[key]) {
                    groupedPackages[key] = {
                        packageId: row.packageId,
                        displayName: row.displayName,
                        productPrice: parseFloat(row.productPrice || '0'),
                        packageQty: parseInt(row.packageQty || '1'),
                        products: []
                    };
                }

                groupedPackages[key].products.push({
                    typeName: row.typeName,
                    qty: parseInt(row.itemQty || '1')
                });
            });

            // Now create separate entries for each package quantity
            const packages = [];

            Object.values(groupedPackages).forEach(pack => {
                // Create separate entries based on packageQty
                for (let i = 0; i < pack.packageQty; i++) {
                    packages.push({
                        packageId: pack.packageId,
                        displayName: pack.displayName,
                        productPrice: `Rs. ${pack.productPrice.toFixed(2)}`,
                        products: pack.products.map(p => ({
                            typeName: p.typeName,
                            qty: String(p.qty).padStart(2, '0'),
                        }))
                    });
                }
            });

            resolve(packages);
        });
    });
};



exports.getOrderAdditionalItemsDao = async (processOrderId) => {
    console.log("getOrderAdditionalItemsDao called with processOrderId:", processOrderId);

    return new Promise((resolve, reject) => {
        if (!processOrderId) {
            return reject(new Error("Invalid processOrderId"));
        }

        // CORRECTED: Join on cv.id instead of cv.cropGroupId
        const sql = `
      SELECT
        oai.qty,
        oai.unit,
        mi.discountedprice AS price,
        oai.discount,
        mi.displayName,
        cv.image,
        oai.productId,
        mi.varietyId,
        cv.id as cropVarietyId,
        cv.cropGroupId
      FROM orderadditionalitems oai
      JOIN processorders po ON po.orderId = oai.orderId
      JOIN marketplaceitems mi ON oai.productId = mi.id
      LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
      WHERE po.id = ?
      ORDER BY oai.id
    `;

        console.log("Executing corrected query:", sql);
        console.log("With processOrderId:", processOrderId);

        db.collectionofficer.query(sql, [processOrderId], (err, results) => {
            if (err) {
                console.error("Database error:", err);
                return reject(new Error("Database error: " + err.message));
            }

            console.log("Query results count:", results?.length || 0);
            console.log("Query results:", JSON.stringify(results, null, 2));

            resolve(results || []);
        });
    });
};

/**
 * Fetch a single coupon by its code
 */
exports.getCouponDetailsDao = (code) => {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT 
                id, code, type, percentage, status, checkLimit, priceLimit, fixDiscount, startDate, endDate
            FROM coupon
            WHERE code = ?
            LIMIT 1
        `;
        db.collectionofficer.query(sql, [code], (err, results) => {
            if (err) return reject(err);
            resolve(results && results.length > 0 ? results[0] : null);
        });
    });
};

/**
 * Fetch all available/enabled coupons from database
 */
exports.getAvailableCouponsDao = () => {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT 
                id, code, type, percentage, status, checkLimit, priceLimit, fixDiscount, startDate, endDate, createdAt
            FROM coupon
            WHERE status = 'Enabled' OR status = 'Active'
            ORDER BY id DESC
        `;
        db.collectionofficer.query(sql, (err, results) => {
            if (err) return reject(err);
            resolve(results || []);
        });
    });
};

/**
 * Compute user cart total (packages + items)
 */
exports.getUserCartTotalDao = (userId, cartId) => {
    return new Promise((resolve) => {
        const sql = `
            SELECT 
                (
                    SELECT COALESCE(SUM((mp.productPrice + mp.packingFee + mp.serviceFee) * cp.qty), 0)
                    FROM cartpackage cp
                    JOIN marketplacepackages mp ON cp.packageId = mp.id
                    JOIN cart c ON cp.cartId = c.id
                    WHERE ${cartId ? 'c.id = ?' : 'c.userId = ?'}
                ) AS packageTotal,
                (
                    SELECT COALESCE(SUM(
                        CASE 
                            WHEN cai.unit = 'g' THEN mpi.discountedPrice * (cai.qty / 1000)
                            ELSE mpi.discountedPrice * cai.qty
                        END
                    ), 0)
                    FROM cartadditionalitems cai
                    JOIN marketplaceitems mpi ON cai.productId = mpi.id
                    JOIN cart c ON cai.cartId = c.id
                    WHERE ${cartId ? 'c.id = ?' : 'c.userId = ?'}
                ) AS itemTotal
        `;
        const param = cartId || userId;
        db.collectionofficer.query(sql, [param, param], (err, rows) => {
            if (err || !rows || rows.length === 0) {
                return resolve({ price: 0, count: 0 });
            }
            const packageTotal = parseFloat(rows[0].packageTotal) || 0;
            const itemTotal = parseFloat(rows[0].itemTotal) || 0;
            resolve({
                price: packageTotal + itemTotal,
                packageTotal,
                itemTotal
            });
        });
    });
};

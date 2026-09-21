const db = require("../startup/database");
const QRCode = require("qrcode");
const uploadFileToS3 = require("../middlewares/s3upload");

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
            sheduleType, sheduleDate, sheduleTime, validityPeriod, validityWeeks, selectedDays, recurringDays, isPackage,
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

        // Normalize schedule type
        let normalizedScheduleType = 'One Time';
        if (sheduleType === 'Once a Week' || sheduleType === 'Twice a Week') {
            normalizedScheduleType = sheduleType;
        } else if (sheduleType === 'One Time' || sheduleType === 'One Time Order') {
            normalizedScheduleType = 'One Time';
        }

        const isRecurring = normalizedScheduleType === 'Once a Week' || normalizedScheduleType === 'Twice a Week';
        const parsedValidityPeriod = isRecurring ? (parseInt(validityPeriod || validityWeeks, 10) || null) : null;
        const daysToStore = selectedDays || recurringDays;
        const parsedSelectedDays = isRecurring && daysToStore
            ? (typeof daysToStore === 'string' ? daysToStore : JSON.stringify(daysToStore))
            : null;

        const insertOrder = (assignCoMCenId) => {
            const sql = `
                INSERT INTO orders (
                    userId, orderApp, delivaryMethod, centerId, buildingType,
                    title, fullName, phonecode1, phone1, phonecode2, phone2,
                    isCoupon, couponType, couponValue, total, fullTotal, discount,
                    deliveryCharge, sheduleType, validityPeriod, selectedDays, sheduleTime,
                    isPackage, isFinalizeImdt, latitude, longitude, assignCoMCenId
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const values = [
                userId, 'Marketplace', formattedMethod, centerId || null, formattedBuildingType || null,
                title, fullName, phonecode1, phone1, phonecode2 || null, phone2 || null,
                isCoupon ? 1 : 0, isCoupon ? (couponType || null) : null, parseFloat(couponValue) || 0,
                total, fullTotal, discount,
                parseFloat(deliveryCharge) || 0,
                normalizedScheduleType,
                parsedValidityPeriod,
                parsedSelectedDays,
                sheduleTime || null,
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

        const generateAndUploadQRCode = async (invoiceNum) => {
            try {
                const qrCodeBuffer = await QRCode.toBuffer(invoiceNum, {
                    errorCorrectionLevel: 'H',
                    type: 'png',
                    width: 300,
                    margin: 1,
                });

                const qrCodeUrl = await uploadFileToS3(
                    qrCodeBuffer,
                    `qr-${invoiceNum}.png`,
                    'qrcodes/invoices'
                );

                return qrCodeUrl;
            } catch (error) {
                console.error('Error generating or uploading QR code:', error);
                return null;
            }
        };

        // Call stored procedure to generate invoice number
        connection.query('CALL `generate_invoice_number`(@new_inv_no)', [], (err) => {
            if (err) return reject(err);

            connection.query('SELECT @new_inv_no AS inv_no', [], (err2, rows) => {
                if (err2) return reject(err2);

                const invNo = rows?.[0]?.inv_no;
                if (!invNo) return reject(new Error('Failed to generate invoice number'));

                generateAndUploadQRCode(invNo)
                    .then((qrCodeUrl) => {
                        const formattedMethod = formatMethod(paymentMethod);
                        const normalized = formattedMethod ? formattedMethod.toLowerCase() : '';

                        const rawCreditPaid = parseFloat(creditPaid) || 0;
                        const rawMoneyPaid = parseFloat(moneyPaid) || 0;
                        const rawAmount = parseFloat(amount) || 0;

                        let finalMethod = formattedMethod;
                        let finalIsPaid = 0;
                        let finalAmount = 0;   // only set for full card-only payment
                        let finalMoneyPaid = 0;  // only set for full card-only payment
                        let finalCreditPaid = rawCreditPaid;

                        if (normalized === 'card' || normalized === 'payhere' || normalized === 'credit' || (rawCreditPaid > 0 && rawAmount > 0 && rawCreditPaid >= rawAmount)) {
                            // Card payment (with or without credit balance, or 100% credit balance)
                            finalMethod = 'Card';
                            finalIsPaid = 1;
                            finalAmount = rawAmount;                         // grandTotal
                            finalCreditPaid = rawCreditPaid;                   // credit used (may be 0)
                            finalMoneyPaid = Math.max(0, rawAmount - rawCreditPaid); // grandTotal - creditUsed (0 if 100% credit)
                        } else {
                            // Cash (with or without partial credit)
                            finalMethod = 'Cash';
                            finalIsPaid = 0;
                            finalAmount = 0;
                            finalMoneyPaid = 0;
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
                            status || 'Ordered', null, qrCodeUrl,
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
                            resolve({ insertId: insertResult.insertId, invNo, qrCodeUrl });
                        });
                    })
                    .catch(reject);
            });
        });
    });
};

/**
 * Deduct used credit balance from marketplaceusers within transaction.
 */
exports.deductUserCreditBalanceWithTransactionDao = (connection, userId, creditAmount) => {
    return new Promise((resolve, reject) => {
        const sql = `
            UPDATE marketplaceusers
            SET creditBalance = GREATEST(0, creditBalance - ?)
            WHERE id = ?
        `;
        connection.query(sql, [creditAmount, userId], (err, result) => {
            if (err) return reject(err);
            resolve(result);
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
                return exports.saveOrderAdditionalItemWithTransactionDao(connection, orderId, item, processOrderId);
            } else if (item.itemType === 'package') {
                return exports.saveOrderPackageWithTransactionDao(connection, processOrderId, item);
            }
            return Promise.resolve();
        });
        Promise.all(promises).then(() => resolve()).catch(reject);
    });
};

exports.saveOrderAdditionalItemWithTransactionDao = (connection, orderId, itemData, proOrderId = null) => {
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
                INSERT INTO orderadditionalitems (orderId, proOrderId, productId, qty, unit, normalPrice, price, discount)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            connection.query(sql, [orderId, proOrderId || null, productId, qty, unit, calcNormal, calcPrice, calcDiscount], (err2, r) => {
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
        po.sheduleDate AS scheduleDate,
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
        p.id AS processOrderId,
        p.status AS processStatus,
        p.invNo AS invoiceNo,  
        p.paymentMethod,
        p.isPaid,
        p.amount AS processOrderAmount,
        p.creditPaid,
        p.moneyPaid,
        p.curDlvrCharge,
        p.sheduleDate,
        p.packTime,
        p.outDlvrDate,
        p.deliveredTime,
        ohf.fee AS returnHandlingFee,
        dro.note AS returnNote,
        rr.rsnEnglish AS returnReason,
        dro.createdAt AS returnTime,
        do_order.id AS driverOrderId,
        do_order.startTime AS driverStartTime,
        do_order.createdAt AS driverCollectedTime,
        CASE 
          WHEN UPPER(o.delivaryMethod) = 'PICKUP' THEN 'PICKUP'
          WHEN UPPER(o.delivaryMethod) = 'DELIVERY' THEN 'DELIVERY'
          ELSE 'UNKNOWN'
        END AS deliveryType
      FROM orders o
      LEFT JOIN processorders p ON o.id = p.orderId
      LEFT JOIN orderhandlingfee ohf ON ohf.orderId = p.id
      LEFT JOIN driverorders do_order ON do_order.orderId = p.id
      LEFT JOIN driverreturnorders dro ON dro.drvOrderId = do_order.id
      LEFT JOIN returnreason rr ON rr.id = dro.returnReasonId
      WHERE (p.id = ? OR o.id = ?) AND o.userId = ?
      ORDER BY p.id DESC
    `;

        const houseSql = `SELECT * FROM orderhouse WHERE orderId = ?`;
        const apartmentSql = `SELECT * FROM orderapartment WHERE orderId = ?`;

        // Helper: fetch all hold events for a given driverOrderId
        const fetchHoldHistory = (driverOrderId) => {
            return new Promise((res) => {
                if (!driverOrderId) return res([]);
                db.collectionofficer.query(
                    'SELECT dho.id, dho.holdReasonId, dho.restartedTime, ' +
                    'dho.createdAt AS holdTime, ' +
                    'hr.rsnEnglish AS holdReason, ' +
                    'hr.rsnSinhala AS holdReasonSinhala, ' +
                    'hr.rsnTamil AS holdReasonTamil ' +
                    'FROM driverholdorders dho ' +
                    'LEFT JOIN holdreason hr ON hr.id = dho.holdReasonId ' +
                    'WHERE dho.drvOrderId = ? ORDER BY dho.id ASC',
                    [driverOrderId],
                    (hErr, hRows) => res(hErr ? [] : (hRows || []))
                );
            });
        };

        db.collectionofficer.query(orderSql, [orderId, orderId, userId], (err, orders) => {
            if (err) return reject("Error fetching order: " + err);
            if (!orders || orders.length === 0) return reject("Order not found or unauthorized");

            const order = orders[0];
            if (order.returnReason && order.returnReason.toLowerCase() === "other" && order.returnNote) {
                order.returnReason = order.returnNote;
            }

            // Attach hold history and then resolve
            const resolveWithHolds = (finalOrder) => {
                fetchHoldHistory(finalOrder.driverOrderId).then((holdHistory) => {
                    finalOrder.holdHistory = holdHistory;
                    resolve(finalOrder);
                });
            };

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

                    return resolveWithHolds(order);
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
                        return resolveWithHolds(order);
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
                        resolveWithHolds(order);
                    });

                } else {
                    return reject("Invalid buildingType for delivery");
                }

            } else {
                return resolveWithHolds(order); // Unknown delivery method
            }
        });
    });
};

exports.getOrderPackageDetailsDao = async (orderId) => {
    return new Promise((resolve, reject) => {
        if (!orderId) {
            return reject(new Error("Invalid orderId"));
        }

        const poSql = "SELECT id, orderId FROM processorders WHERE id = ? OR orderId = ? ORDER BY (id = ?) DESC LIMIT 1";
        db.collectionofficer.query(poSql, [orderId, orderId, orderId], (poErr, poRows) => {
            if (poErr) return reject(new Error("Database error: " + poErr.message));

            const processOrderId = poRows?.[0]?.id || orderId;
            const actualOrderId = poRows?.[0]?.orderId || orderId;

            // Select the raw fee components separately so we can log/inspect them,
            // instead of only ever seeing the pre-summed total.
            const packagesSql = `
              SELECT 
                op.id AS orderPackageId,
                op.orderId,
                op.packageId,
                op.qty AS packageQty,
                mp.displayName,
                mp.image AS packageImage,
                mp.productPrice AS rawProductPrice,
                mp.packingFee AS rawPackingFee,
                mp.serviceFee AS rawServiceFee,
                (mp.productPrice + mp.packingFee + mp.serviceFee) AS productPrice
              FROM orderpackage op
              JOIN marketplacepackages mp ON op.packageId = mp.id
              WHERE op.orderId = ? OR op.orderId = ?
              ORDER BY op.id
            `;

            db.collectionofficer.query(packagesSql, [processOrderId, actualOrderId], (err, packRows) => {
                if (err) {
                    return reject(new Error("Database error: " + err.message));
                }

                if (!packRows || packRows.length === 0) {
                    return resolve([]);
                }

                // Defensive check: flag any package whose price components look
                // suspicious (null, zero, or suspiciously uniform) so it shows up
                // in server logs instead of silently reaching the client.
                packRows.forEach((p) => {
                    const rawProduct = parseFloat(p.rawProductPrice);
                    const rawPacking = parseFloat(p.rawPackingFee);
                    const rawService = parseFloat(p.rawServiceFee);
                    if (
                        Number.isNaN(rawProduct) || Number.isNaN(rawPacking) || Number.isNaN(rawService) ||
                        (rawProduct === 0 && rawPacking === 0 && rawService === 0)
                    ) {
                        console.warn(
                            `[getOrderPackageDetailsDao] Suspicious fee data for packageId=${p.packageId} ` +
                            `(orderPackageId=${p.orderPackageId}): productPrice=${p.rawProductPrice}, ` +
                            `packingFee=${p.rawPackingFee}, serviceFee=${p.rawServiceFee}`
                        );
                    }
                });

                const opIds = packRows.map(p => p.orderPackageId);

                const itemsSql = `
                  SELECT 
                    opi.id,
                    opi.orderPackageId,
                    opi.productType,
                    opi.productId,
                    opi.qty,
                    opi.price,
                    opi.createdAt,
                    mi.displayName AS itemName,
                    mi.unitType,
                    cv.image,
                    pt.typeName
                  FROM orderpackageitems opi
                  LEFT JOIN marketplaceitems mi ON opi.productId = mi.id
                  LEFT JOIN producttypes pt ON opi.productType = pt.id
                  LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
                  WHERE opi.orderPackageId IN (?)
                  ORDER BY opi.id ASC, opi.orderPackageId ASC, opi.productType ASC, opi.productId ASC, opi.qty ASC, opi.price ASC, opi.createdAt ASC
                `;

                db.collectionofficer.query(itemsSql, [opIds], (itemErr, itemRows) => {
                    if (itemErr) {
                        return reject(new Error("Database error: " + itemErr.message));
                    }

                    const itemsByPackId = {};
                    (itemRows || []).forEach(item => {
                        if (!itemsByPackId[item.orderPackageId]) {
                            itemsByPackId[item.orderPackageId] = [];
                        }
                        const unit = item.unitType ? String(item.unitType).trim() : 'kg';
                        itemsByPackId[item.orderPackageId].push({
                            itemName: item.itemName || item.typeName || 'Item',
                            quantity: `${parseFloat(item.qty || 1)} ${unit}`,
                            image: item.image || "https://images.unsplash.com/photo-1542838132-92c53300491e?w=200",
                            price: parseFloat(item.price || 0)
                        });
                    });

                    const fallbackPackIds = packRows
                        .filter(p => !itemsByPackId[p.orderPackageId] || itemsByPackId[p.orderPackageId].length === 0)
                        .map(p => p.packageId);

                    if (fallbackPackIds.length > 0) {
                        const fallbackSql = `
                          SELECT pd.packageId, pd.qty AS itemQty, pt.typeName
                          FROM packagedetails pd
                          JOIN producttypes pt ON pd.productTypeId = pt.id
                          WHERE pd.packageId IN (?)
                        `;
                        db.collectionofficer.query(fallbackSql, [fallbackPackIds], (fbErr, fbRows) => {
                            if (!fbErr && fbRows) {
                                packRows.forEach(pack => {
                                    if (!itemsByPackId[pack.orderPackageId] || itemsByPackId[pack.orderPackageId].length === 0) {
                                        itemsByPackId[pack.orderPackageId] = fbRows
                                            .filter(r => r.packageId === pack.packageId)
                                            .map(r => ({
                                                itemName: r.typeName,
                                                quantity: `${r.itemQty} units`,
                                                image: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=200",
                                                price: 0
                                            }));
                                    }
                                });
                            }

                            const packages = buildPackageList(packRows, itemsByPackId);
                            resolve(packages);
                        });
                    } else {
                        const packages = buildPackageList(packRows, itemsByPackId);
                        resolve(packages);
                    }
                });
            });
        });
    });
};

function buildPackageList(packRows, itemsByPackId) {
    const packages = [];
    packRows.forEach(pack => {
        const qty = parseInt(pack.packageQty || 1);
        const priceVal = parseFloat(pack.productPrice || 0);
        for (let i = 0; i < qty; i++) {
            packages.push({
                orderPackageId: pack.orderPackageId,
                packageId: pack.packageId,
                displayName: pack.displayName,
                packageImage: pack.packageImage,
                productPrice: `Rs. ${priceVal.toFixed(2)}`,
                priceNum: priceVal,
                products: itemsByPackId[pack.orderPackageId] || []
            });
        }
    });
    return packages;
}

exports.getOrderAdditionalItemsDao = async (orderId) => {
    return new Promise((resolve, reject) => {
        if (!orderId) {
            return reject(new Error("Invalid orderId"));
        }

        const poSql = "SELECT id, orderId FROM processorders WHERE id = ? OR orderId = ? ORDER BY (id = ?) DESC LIMIT 1";
        db.collectionofficer.query(poSql, [orderId, orderId, orderId], (err, poRows) => {
            if (err) return reject(new Error("Database error: " + err.message));

            const processOrderId = poRows?.[0]?.id || orderId;
            const actualOrderId = poRows?.[0]?.orderId || orderId;

            const sql = `
              SELECT
                oai.id,
                oai.qty,
                oai.unit,
                COALESCE(oai.price, mi.discountedPrice, mi.normalPrice, 0) AS price,
                COALESCE(oai.normalPrice, mi.normalPrice, 0) AS normalPrice,
                oai.discount,
                mi.displayName,
                cv.image,
                oai.productId,
                mi.varietyId,
                cv.id as cropVarietyId,
                cv.cropGroupId
              FROM orderadditionalitems oai
              JOIN marketplaceitems mi ON oai.productId = mi.id
              LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
              WHERE oai.orderId = ? OR oai.proOrderId = ?
              ORDER BY oai.id
            `;

            db.collectionofficer.query(sql, [actualOrderId, processOrderId], (err2, results) => {
                if (err2) {
                    return reject(new Error("Database error: " + err2.message));
                }
                resolve(results || []);
            });
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
            WHERE (LOWER(status) = 'enabled' OR LOWER(status) = 'active')
              AND (startDate IS NULL OR DATE(startDate) <= CURDATE())
              AND (endDate IS NULL OR DATE(endDate) >= CURDATE())
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

/**
 * Fetch invoice data for an order matching web format
 */
const formatBillingInfo = (info) => {
    if (!info) return {};
    return {
        title: info.title || "",
        fullName: info.fullName || "",
        phone: info.phone1 ? `+${info.phoneCode1 || "94"} ${info.phone1}` : "N/A",
        email: info.email || "N/A",
        buildingType: info.buildingType || "House",
        houseNo: info.houseNo || "N/A",
        street: info.street || "N/A",
        city: info.city || "N/A",
        buildingNo: info.buildingNo || "N/A",
        apartmentName: info.buildingName || "N/A",
        flatNo: info.flatNo || "N/A",
        floorNo: info.floorNo || "N/A",
    };
};

const getDeliveryChargeDao = (isPickup, hasDeliveryItems, city, isFreeDelivery = false, fallbackCharge = 0) => {
    return new Promise((resolve) => {
        if (isFreeDelivery || isPickup || !hasDeliveryItems) {
            return resolve("0.00");
        }
        if (fallbackCharge && parseFloat(fallbackCharge) > 0) {
            return resolve(parseFloat(fallbackCharge).toFixed(2));
        }
        if (!city || city === "N/A") {
            return resolve("50.00");
        }
        const deliveryChargeQuery = `SELECT charge FROM deliverycharge WHERE LOWER(city) LIKE LOWER(?)`;
        db.collectionofficer.query(deliveryChargeQuery, [`%${city}%`], (err, chargeResult) => {
            if (err || !chargeResult || chargeResult.length === 0) {
                return resolve("50.00");
            }
            const charge = parseFloat(chargeResult[0].charge || 50.00).toFixed(2);
            resolve(charge);
        });
    });
};

const getPickupInfoDao = (isPickup, centerId) => {
    return new Promise((resolve) => {
        if (!isPickup || !centerId) return resolve(null);
        const sql = `
            SELECT c.id, c.name, c.phone1, c.street, c.city, c.district, c.province, c.country, c.zipcode
            FROM collectioncenter c
            WHERE c.id = ?
            LIMIT 1
        `;
        db.collectionofficer.query(sql, [centerId], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve(null);
            const r = rows[0];
            resolve({
                centerId: String(r.id),
                centerName: r.name || "Unknown",
                contact01: r.phone1 || "Not Available",
                address: {
                    street: r.street || "",
                    city: r.city || "",
                    district: r.district || "",
                    province: r.province || "",
                    country: r.country || "Sri Lanka",
                    zipCode: r.zipcode || "",
                },
            });
        });
    });
};

const getPackageDetailsForProcessedItemsDao = (processedFamilyPackItems) => {
    return new Promise((resolve, reject) => {
        const packageDetailsMap = {};
        if (!Array.isArray(processedFamilyPackItems) || processedFamilyPackItems.length === 0) {
            return resolve(packageDetailsMap);
        }
        const uniquePackageIds = [...new Set(processedFamilyPackItems.map((item) => item.packageId))];
        const packageDetailsQuery = `
            SELECT pd.packageId, pt.id AS productTypeId, pt.typeName, pd.qty
            FROM packagedetails pd
            JOIN producttypes pt ON pd.productTypeId = pt.id
            WHERE pd.packageId = ?
        `;
        const promises = uniquePackageIds.map((packageId) => {
            return new Promise((res, rej) => {
                db.collectionofficer.query(packageDetailsQuery, [packageId], (err, details) => {
                    if (err) return rej(err);
                    processedFamilyPackItems.forEach((item) => {
                        if (item.packageId === packageId) {
                            packageDetailsMap[item.originalId] = details || [];
                        }
                    });
                    res();
                });
            });
        });
        Promise.all(promises).then(() => resolve(packageDetailsMap)).catch(reject);
    });
};

exports.getInvoiceByOrderIdDao = (orderIdOrProcessOrderId, userId) => {
    return new Promise((resolve, reject) => {
        if (!orderIdOrProcessOrderId || !userId) {
            return reject(new Error("Invalid orderId or userId"));
        }

        const invoiceQuery = `
            SELECT 
                o.id AS actualOrderId,
                o.centerId,
                o.delivaryMethod AS deliveryMethod,
                o.discount AS orderDiscount,
                o.createdAt AS invoiceDate,
                po.sheduleDate AS scheduledDate,
                o.buildingType,
                o.fullTotal AS fullTotal,
                o.isCoupon,
                o.couponValue,
                o.couponType,
                o.deliveryCharge,
                po.id AS processOrderId,
                po.invNo AS invoiceNumber,
                po.paymentMethod AS paymentMethod,
                po.amount AS processOrderAmount,
                po.isPaid,
                po.creditPaid,
                po.moneyPaid,
                po.qrCode
            FROM processorders po
            INNER JOIN orders o ON po.orderId = o.id
            WHERE (po.id = ? OR o.id = ?) AND o.userId = ?
            ORDER BY po.id DESC
            LIMIT 1
        `;

        db.collectionofficer.query(invoiceQuery, [orderIdOrProcessOrderId, orderIdOrProcessOrderId, userId], (err, invoiceResult) => {
            if (err) return reject(err);
            if (!invoiceResult || invoiceResult.length === 0) return resolve(null);

            const invoice = invoiceResult[0];
            const actualOrderId = invoice.actualOrderId;
            const processOrderId = invoice.processOrderId;

            const familyPackItemsQuery = `
                SELECT 
                    op.id,
                    mp.id AS packageId,
                    mp.displayName AS name,
                    mp.productPrice,
                    mp.packingFee,
                    mp.serviceFee,
                    (mp.productPrice + mp.packingFee + mp.serviceFee) AS unitPrice,
                    op.qty AS quantity,
                    ((mp.productPrice + mp.packingFee + mp.serviceFee) * op.qty) AS amount
                FROM orderpackage op
                JOIN marketplacepackages mp ON op.packageId = mp.id
                WHERE op.orderId = ?
            `;

            const additionalItemsQuery = `
                SELECT
                    oai.id,
                    mi.displayName AS name,
                    oai.unit,
                    COALESCE(mi.normalPrice, mi.normalprice, 0) AS unitPrice,
                    oai.qty AS quantity,
                    COALESCE(oai.normalPrice, oai.normalprice, 0) AS amount,
                    oai.discount AS itemDiscount,
                    COALESCE(oai.price, oai.normalPrice, oai.normalprice, 0) AS finalPrice,
                    cv.image AS image
                FROM orderadditionalitems oai
                JOIN marketplaceitems mi ON oai.productId = mi.id
                LEFT JOIN plant_care.cropvariety cv ON mi.varietyId = cv.id
                WHERE oai.orderId = ?
            `;

            const billingQuery = `
                SELECT 
                    o.title,
                    o.fullName,
                    o.phonecode1 AS phoneCode1,
                    o.phone1,
                    o.buildingType,
                    mu.email,
                    COALESCE(oh.houseNo, oa.houseNo, 'N/A') AS houseNo,
                    COALESCE(oh.streetName, oa.streetName, 'N/A') AS street,
                    COALESCE(oh.city, oa.city, 'N/A') AS city,
                    oa.buildingNo,
                    oa.buildingName,
                    oa.unitNo AS flatNo,
                    oa.floorNo
                FROM orders o
                LEFT JOIN marketplaceusers mu ON o.userId = mu.id
                LEFT JOIN orderhouse oh ON o.id = oh.orderId
                LEFT JOIN orderapartment oa ON o.id = oa.orderId
                WHERE o.id = ?
                LIMIT 1
            `;

            Promise.all([
                new Promise((res, rej) => {
                    db.collectionofficer.query(familyPackItemsQuery, [processOrderId], (e, r) => (e ? rej(e) : res(r || [])));
                }),
                new Promise((res, rej) => {
                    db.collectionofficer.query(additionalItemsQuery, [actualOrderId], (e, r) => (e ? rej(e) : res(r || [])));
                }),
                new Promise((res, rej) => {
                    db.collectionofficer.query(billingQuery, [actualOrderId], (e, r) => (e ? rej(e) : res(r?.[0] || {})));
                }),
            ]).then(async ([familyPackItems, additionalItems, billingInfo]) => {
                const isPickup = (invoice.deliveryMethod || "").toUpperCase() === "PICKUP";
                const isFreeDeliveryCoupon = invoice.isCoupon && (invoice.couponType === "Free Delivery" || invoice.couponType === "Free Delivary");
                const hasDeliveryItems = (Array.isArray(familyPackItems) && familyPackItems.length > 0) || (Array.isArray(additionalItems) && additionalItems.length > 0);
                
                const deliveryFee = await getDeliveryChargeDao(
                    isPickup,
                    hasDeliveryItems,
                    billingInfo.city,
                    isFreeDeliveryCoupon,
                    invoice.deliveryCharge
                );
                
                const pickupInfo = await getPickupInfoDao(isPickup, invoice.centerId);

                const processedFamilyPackItems = [];
                if (Array.isArray(familyPackItems)) {
                    familyPackItems.forEach((item) => {
                        const qty = parseInt(item.quantity) || 1;
                        const unitPrice = parseFloat(item.unitPrice) || 0;
                        for (let i = 0; i < qty; i++) {
                            processedFamilyPackItems.push({
                                id: `${item.id}_${i + 1}`,
                                originalId: item.id,
                                packageId: item.packageId,
                                name: item.name || "Family Pack",
                                unitPrice: unitPrice,
                                quantity: 1,
                                amount: unitPrice,
                            });
                        }
                    });
                }

                const packageDetailsMap = await getPackageDetailsForProcessedItemsDao(processedFamilyPackItems);

                const familyPackTotal = processedFamilyPackItems.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0).toFixed(2);
                const additionalItemsTotal = additionalItems.reduce((sum, i) => sum + parseFloat(i.finalPrice || i.amount || 0), 0).toFixed(2);
                const orderDiscount = parseFloat(invoice.orderDiscount || 0).toFixed(2);
                const couponDiscount = invoice.isCoupon && invoice.couponValue ? parseFloat(invoice.couponValue || 0).toFixed(2) : "0.00";

                const calculatedGrandTotal = (
                    parseFloat(additionalItemsTotal) +
                    parseFloat(familyPackTotal) +
                    parseFloat(deliveryFee || 0) -
                    parseFloat(orderDiscount) -
                    parseFloat(couponDiscount)
                ).toFixed(2);

                let formattedDeliveryMethod = invoice.deliveryMethod || "N/A";
                if (formattedDeliveryMethod.toUpperCase() === "PICKUP") formattedDeliveryMethod = "Instore Pickup";
                else if (formattedDeliveryMethod.toUpperCase() === "DELIVERY" || formattedDeliveryMethod.toLowerCase() === "home") formattedDeliveryMethod = "Home Delivery";

                const invoiceData = {
                    invoiceNumber: invoice.invoiceNumber || `INV-${new Date(invoice.invoiceDate).getFullYear()}-${String(processOrderId).padStart(3, "0")}`,
                    invoiceDate: invoice.invoiceDate || "N/A",
                    scheduledDate: invoice.scheduledDate || "N/A",
                    deliveryMethod: formattedDeliveryMethod,
                    paymentMethod: invoice.paymentMethod || "N/A",
                    isPaid: invoice.isPaid,
                    creditPaid: invoice.creditPaid,
                    moneyPaid: invoice.moneyPaid,
                    qrCode: invoice.qrCode || null,
                    amountDue: `Rs. ${parseFloat(invoice.fullTotal || 0).toFixed(2)}`,
                    isFreeDeliveryCoupon: !!isFreeDeliveryCoupon,
                    familyPackItems: processedFamilyPackItems.map((item) => ({
                        id: item.id,
                        name: item.name,
                        unitPrice: `Rs. ${parseFloat(item.unitPrice).toFixed(2)}`,
                        quantity: String(item.quantity).padStart(2, "0"),
                        amount: `Rs. ${parseFloat(item.amount).toFixed(2)}`,
                        packageDetails: packageDetailsMap[item.originalId] || [],
                    })),
                    additionalItems: Array.isArray(additionalItems)
                        ? additionalItems.map((item) => ({
                            id: item.id,
                            name: item.name || "Unknown",
                            unit: item.unit || "kg",
                            unitPrice: `Rs. ${parseFloat(item.unitPrice || 0).toFixed(2)}`,
                            quantity: String(item.quantity || 0).padStart(2, "0"),
                            amount: `Rs. ${parseFloat(item.finalPrice || item.amount || 0).toFixed(2)}`,
                            image: item.image || null,
                        }))
                        : [],
                    familyPackTotal: `Rs. ${familyPackTotal}`,
                    additionalItemsTotal: `Rs. ${additionalItemsTotal}`,
                    deliveryFee: `Rs. ${deliveryFee || "0.00"}`,
                    discount: `Rs. ${orderDiscount}`,
                    couponDiscount: `Rs. ${couponDiscount}`,
                    grandTotal: `Rs. ${calculatedGrandTotal}`,
                    billingInfo: formatBillingInfo(billingInfo),
                    pickupInfo: pickupInfo,
                };

                resolve({ status: true, invoice: invoiceData });
            }).catch(reject);
        });
    });
};

exports.getDeliveredOrdersTotal = async (userId) => {
    let connection;
    try {
        connection = await db.collectionofficer.promise().getConnection();
        const [rows] = await connection.query(
            `SELECT COALESCE(SUM(p.amount), 0) AS deliveredTotal
       FROM processorders p
       INNER JOIN orders o ON o.id = p.orderId
       WHERE o.userId = ?
         AND p.status IN ('Delivered', 'Picked up')`,
            [userId],
        );
        const deliveredTotal = parseFloat(rows[0]?.deliveredTotal || 0);
        // Base 2000, +250 for every full 25000 in total order value
        const tiersEarned = Math.floor(deliveredTotal / 25000);
        const creditBalance = 2000 + tiersEarned * 250;
        return { deliveredTotal, creditBalance };
    } catch (err) {
        console.error("Error in getDeliveredOrdersTotal:", err);
        throw err;
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Marks processorders record as paid via PayHere webhook or direct card settlement.
 * Accepts invNo, orderId, or processorders.id as identifier.
 */
exports.markOrderPaidDao = async (identifier, transactionId) => {
    let connection;
    try {
        connection = await db.collectionofficer.promise().getConnection();
        const [result] = await connection.query(
            `UPDATE processorders 
             SET isPaid = 1, paymentMethod = 'Card', transactionId = COALESCE(?, transactionId)
             WHERE invNo = ? OR orderId = ? OR id = ?`,
            [transactionId || null, identifier, identifier, identifier]
        );
        return result.affectedRows > 0;
    } catch (err) {
        console.error("Error in markOrderPaidDao:", err);
        throw err;
    } finally {
        if (connection) connection.release();
    }
};


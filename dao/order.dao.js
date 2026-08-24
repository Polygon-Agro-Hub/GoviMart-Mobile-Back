const db = require("../startup/database");

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

        db.marketPlace.query(orderQuery, [userId], async (err, orders) => {
            if (err) {
                return reject("Error fetching retail order history: " + err);
            }

            try {
                const normalizedOrders = await Promise.all(
                    orders.map(async (order) => {
                        // (Optional) Keep the below two fetches in case you want item breakdown later
                        const familyPackItems = await new Promise((res, rej) => {
                            db.marketPlace.query(familyPackItemsQuery, [order.orderId], (err, items) => {
                                if (err) return rej("Family pack query error: " + err);
                                res(items || []);
                            });
                        });

                        const additionalItems = await new Promise((res, rej) => {
                            db.marketPlace.query(additionalItemsQuery, [order.orderId], (err, items) => {
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

        db.marketPlace.query(orderSql, [orderId, userId], (err, orders) => {
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
                    db.marketPlace.query(houseSql, [order.id], (err, result) => {
                        if (err) return reject("Error fetching house delivery: " + err);
                        if (!result || result.length === 0) return reject("House delivery address not found");

                        order.deliveryInfo = {
                            buildingType: 'House',
                            ...result[0]
                        };
                        return resolve(order);
                    });

                } else if (order.buildingType === 'Apartment') {
                    db.marketPlace.query(apartmentSql, [order.id], (err, result) => {
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

        db.marketPlace.query(sql, [orderId], (err, results) => {
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

        db.marketPlace.query(sql, [processOrderId], (err, results) => {
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



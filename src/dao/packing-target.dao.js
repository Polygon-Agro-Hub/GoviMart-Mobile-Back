const db = require("../startup/database").collectionofficer.promise();

async function getRemainingPackingTarget(sheduleDate) {
  let formattedDate = sheduleDate;
  if (formattedDate instanceof Date) {
    formattedDate = formattedDate.toISOString().split("T")[0];
  } else if (typeof formattedDate === "string" && formattedDate.includes("T")) {
    formattedDate = formattedDate.split("T")[0];
  }
  if (!formattedDate) {
    formattedDate = new Date().toISOString().split("T")[0];
  }

  // 1) Count the 3 confirmed-order groups for this schedule date
  const [rows] = await db.query(
    `
    SELECT
      -- orders that are NOT package (isPackage = 0)
      COALESCE(SUM(o.isPackage = 0), 0) AS additionalItems,

      -- package + finalize immediately
      COALESCE(SUM(o.isPackage = 1 AND o.isFinalizeImdt = 1), 0) AS packageFinalizeImdt,

      -- package + not immediate, but finalized after review
      COALESCE(SUM(o.isPackage = 1 AND o.isFinalizeImdt = 0 AND po.isFinalized = 1), 0) AS packageReview
    FROM collection_officer.processorders po
    JOIN collection_officer.orders o ON o.id = po.orderId
    WHERE DATE(po.sheduleDate) = ?
    `,
    [formattedDate]
  );

  const additionalItems     = Number(rows[0].additionalItems);
  const packageFinalizeImdt = Number(rows[0].packageFinalizeImdt);
  const packageReview       = Number(rows[0].packageReview);

  const confirmOrders = additionalItems + packageFinalizeImdt + packageReview;

  // 2) Latest packingtargetlimit row
  const [targets] = await db.query(
    `SELECT tarValue, createdAt
       FROM collection_officer.packingtargetlimit
      ORDER BY createdAt DESC
      LIMIT 1`
  );

  if (!targets.length) {
    throw new Error("No packingtargetlimit record found");
  }

  const tarValue = Number(targets[0].tarValue);

  // 3) Remaining = target - confirmed
  const remaining = tarValue - confirmOrders;

  return {
    sheduleDate: formattedDate,
    packingTargetLimit: tarValue,
    additionalItems,
    packageFinalizeImdt,
    packageReview,
    confirmOrders,
    remaining, 
  };
}

module.exports = { getRemainingPackingTarget };

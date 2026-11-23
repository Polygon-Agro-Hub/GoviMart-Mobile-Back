const db = require("../startup/database");

/**
 * Data Access Object for user_saved_cards in collection_officer DB
 */
class SavedCardDao {
  /**
   * Retrieves the active saved card for a specific user
   */
  async getActiveCardByUserId(userId) {
    const query = `
      SELECT 
        id, 
        userId, 
        cardToken, 
        cardScheme, 
        last4, 
        cardHolder, 
        expiryMonth, 
        expiryYear, 
        isDefault, 
        status, 
        paymentId, 
        mode, 
        createdAt 
      FROM user_saved_cards 
      WHERE userId = ? AND status = 'active' 
      ORDER BY id DESC 
      LIMIT 1
    `;
    const [rows] = await db.collectionofficer.promise().query(query, [userId]);
    return rows[0] || null;
  }

  /**
   * Saves a new card for the user. Enforces the 1 active card rule idempotently.
   */
  async saveUserCard(userId, cardData) {
    const connection = db.collectionofficer.promise();

    // 1. Format expiry
    let expiryMonth = "";
    let expiryYear = "";
    if (cardData.expiry && typeof cardData.expiry === "object") {
      expiryMonth = String(cardData.expiry.month || "").padStart(2, "0");
      expiryYear = String(cardData.expiry.year || "").slice(-2);
    } else {
      expiryMonth = String(cardData.expiryMonth || "12").padStart(2, "0");
      expiryYear = String(cardData.expiryYear || "28").slice(-2);
    }

    const cardToken = cardData.cardToken || cardData.id || cardData.token || `crd_${Date.now()}`;
    const cardScheme = (cardData.scheme || cardData.cardScheme || cardData.brand || "visa").toLowerCase();
    const last4 = String(cardData.last4 || (cardData.maskedNumber ? cardData.maskedNumber.slice(-4) : "0000"));
    // card.saved webhook has no name — fall back to customerEmail
    const cardHolder = cardData.cardHolder || cardData.customerName || cardData.name || cardData.customerEmail || "Cardholder";
    const paymentId = cardData.paymentId || null;
    const mode = cardData.mode || "test";
    // Store consent timestamp from card.saved webhook (consent.agreedAt per Payments.lk docs)
    let consentAgreedAt = null;
    const rawConsent = cardData.consent?.agreedAt || cardData.consentAgreedAt;
    if (rawConsent) {
      const parsedDate = new Date(rawConsent);
      if (!isNaN(parsedDate.getTime())) {
        consentAgreedAt = parsedDate; // mysql2 automatically serializes Date instances to MySQL timestamps
      }
    }

    // 2. IDEMPOTENCY CHECK:
    // If this exact cardToken already exists in DB (e.g. Sync API created it and Webhook arrives concurrently):
    const [existingTokens] = await connection.query(
      `SELECT id, userId FROM user_saved_cards WHERE cardToken = ? LIMIT 1`,
      [cardToken]
    );

    if (existingTokens && existingTokens.length > 0) {
      const existingId = existingTokens[0].id;
      console.log(
        `[SavedCardDao] cardToken ${cardToken} already exists (id: ${existingId}). Updating existing record instead of inserting duplicate.`
      );

      // Ensure this record is assigned to this user and active — DO NOT insert duplicate row!
      await connection.query(
        `UPDATE user_saved_cards 
         SET userId = ?, status = 'active', isDefault = 1, cardHolder = ?, paymentId = COALESCE(?, paymentId) 
         WHERE id = ?`,
        [userId, cardHolder, paymentId, existingId]
      );

      // Purge any older cards for this user or duplicate token rows
      await connection.query(
        `DELETE FROM user_saved_cards WHERE (userId = ? OR cardToken = ?) AND id != ?`,
        [userId, cardToken, existingId]
      );

      const [updatedRows] = await connection.query(`SELECT * FROM user_saved_cards WHERE id = ?`, [existingId]);
      return updatedRows[0];
    }

    // 3. Purge all previous cards for this user or token before inserting the fresh one (enforces 1 card per user)
    console.log(`[SavedCardDao] Purging previous card records for user ${userId} to maintain strictly 1 active card.`);
    await connection.query(`DELETE FROM user_saved_cards WHERE userId = ? OR cardToken = ?`, [userId, cardToken]);

    // 4. Insert new active card (with consent timestamp if column exists)
    const insertQuery = `
      INSERT INTO user_saved_cards (
        userId, 
        cardToken, 
        cardScheme, 
        last4, 
        cardHolder, 
        expiryMonth, 
        expiryYear, 
        isDefault, 
        status, 
        paymentId, 
        mode,
        consentAgreedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)
    `;

    const insertValues = [
      userId,
      cardToken,
      cardScheme.includes("master") ? "mastercard" : "visa",
      last4,
      cardHolder,
      expiryMonth,
      expiryYear,
      paymentId,
      mode,
      consentAgreedAt,
    ];

    let insertResult;
    try {
      [insertResult] = await connection.query(insertQuery, insertValues);
    } catch (insertErr) {
      // Graceful fallback: if consentAgreedAt column doesn't exist or has formatting issues, retry without it
      if (
        (insertErr.code === "ER_BAD_FIELD_ERROR" && insertErr.message.includes("consentAgreedAt")) ||
        insertErr.code === "ER_TRUNCATED_WRONG_VALUE"
      ) {
        console.warn("⚠️ [SavedCardDao] Retrying card insert without consentAgreedAt column:", insertErr.message);
        const fallbackQuery = `
          INSERT INTO user_saved_cards (
            userId, cardToken, cardScheme, last4, cardHolder,
            expiryMonth, expiryYear, isDefault, status, paymentId, mode
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
        `;
        [insertResult] = await connection.query(fallbackQuery, insertValues.slice(0, -1));
      } else {
        throw insertErr;
      }
    }

    // 5. Return the inserted card
    const selectQuery = `SELECT * FROM user_saved_cards WHERE id = ?`;
    const [savedRows] = await connection.query(selectQuery, [insertResult.insertId]);
    return savedRows[0];
  }

  /**
   * Retrieves all saved cards for a specific user
   */
  async getAllCardsByUserId(userId) {
    const query = `SELECT * FROM user_saved_cards WHERE userId = ? ORDER BY id DESC`;
    const [rows] = await db.collectionofficer.promise().query(query, [userId]);
    return rows;
  }

  /**
   * Retrieves a card for a user by id, token, or active card
   */
  async getCardForUser(userId, cardIdOrToken = null) {
    const connection = db.collectionofficer.promise();
    let query = `SELECT * FROM user_saved_cards WHERE userId = ?`;
    const params = [userId];

    if (cardIdOrToken && cardIdOrToken !== "current") {
      const isNumeric = /^\d+$/.test(String(cardIdOrToken));
      if (isNumeric) {
        query += ` AND (id = ? OR cardToken = ?)`;
        params.push(Number(cardIdOrToken), String(cardIdOrToken));
      } else {
        query += ` AND cardToken = ?`;
        params.push(String(cardIdOrToken));
      }
    }
    query += ` ORDER BY (status = 'active') DESC, id DESC LIMIT 1`;

    const [rows] = await connection.query(query, params);
    return rows[0] || null;
  }

  /**
   * Permanently deletes saved card(s) for a user from database
   */
  async removeUserCard(userId, cardIdOrToken = null) {
    const connection = db.collectionofficer.promise();
    let query = `DELETE FROM user_saved_cards WHERE userId = ?`;
    const params = [userId];

    if (cardIdOrToken && cardIdOrToken !== "current") {
      const isNumeric = /^\d+$/.test(String(cardIdOrToken));
      if (isNumeric) {
        query += ` AND (id = ? OR cardToken = ?)`;
        params.push(Number(cardIdOrToken), String(cardIdOrToken));
      } else {
        query += ` AND cardToken = ?`;
        params.push(String(cardIdOrToken));
      }
    }

    const [result] = await connection.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Retrieves a saved card by token
   */
  async getCardByToken(cardToken) {
    const query = `SELECT * FROM user_saved_cards WHERE cardToken = ? AND status = 'active' LIMIT 1`;
    const [rows] = await db.collectionofficer.promise().query(query, [cardToken]);
    return rows[0] || null;
  }
}

module.exports = new SavedCardDao();

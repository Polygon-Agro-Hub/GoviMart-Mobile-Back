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
   * Saves a new card for the user. Enforces the 1 active card rule.
   */
  async saveUserCard(userId, cardData) {
    const connection = db.collectionofficer.promise();

    // 1. Deactivate existing active cards for this user (1-card limit)
    const deactivateQuery = `
      UPDATE user_saved_cards 
      SET status = 'revoked', isDefault = 0 
      WHERE userId = ?
    `;
    await connection.query(deactivateQuery, [userId]);

    // 2. Format expiry
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
    const consentAgreedAt = cardData.consent?.agreedAt || cardData.consentAgreedAt || null;

    // 3. Insert new active card (with consent timestamp if column exists)
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
      // Graceful fallback: if consentAgreedAt column doesn't exist in older schema, retry without it
      if (insertErr.code === "ER_BAD_FIELD_ERROR" && insertErr.message.includes("consentAgreedAt")) {
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

    // 4. Return the inserted card
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

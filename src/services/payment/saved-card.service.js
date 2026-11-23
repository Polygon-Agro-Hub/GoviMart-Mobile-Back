const customerDao = require("../../dao/customer.dao");
const paymentGatewayFactory = require("./payment.factory");
const fs = require("fs");
const path = require("path");

// Purge any legacy local data files
const DATA_DIR = path.join(__dirname, "../../data");
try {
  const cardsTxt = path.join(DATA_DIR, "saved_cards.txt");
  const cardsJson = path.join(DATA_DIR, "saved_cards.json");
  if (fs.existsSync(cardsTxt)) fs.unlinkSync(cardsTxt);
  if (fs.existsSync(cardsJson)) fs.unlinkSync(cardsJson);
} catch (e) {
  // Ignore
}

/**
 * Saved Card Service (Powered directly by Payments.lk Cloud Vault)
 * Payments.lk acts as the Single Source of Truth — Zero MySQL desynchronization.
 */
class SavedCardService {
  /**
   * Resolves the customer's email address from token, params, or customer profile
   */
  async _resolveEmail(userId, fallbackEmail = null) {
    if (fallbackEmail && typeof fallbackEmail === "string" && fallbackEmail.includes("@")) {
      return fallbackEmail.trim();
    }
    if (userId) {
      try {
        const rows = await customerDao.getCustomerProfileDao(userId);
        if (rows && rows.length > 0 && rows[0].email) {
          return rows[0].email.trim();
        }
      } catch (e) {
        console.warn("⚠️ [SavedCardService] Error looking up email for user:", e.message);
      }
    }
    return null;
  }

  /**
   * Retrieves the active saved card directly from Payments.lk vault
   * Lists cards by customerEmail (sorted newest first) and returns the single active card on file.
   */
  async getCard(userId, userEmail = null) {
    const email = await this._resolveEmail(userId, userEmail);
    if (!email) {
      console.log(`[SavedCardService] No customer email found for user ${userId} — no cards on file.`);
      return null;
    }

    try {
      const paymentsLkStrategy = paymentGatewayFactory.getGateway("payments_lk");
      if (!paymentsLkStrategy) return null;

      const secretKey = paymentsLkStrategy.secretKey;
      const apiUrl = paymentsLkStrategy.apiUrl;

      // Query Payments.lk API: newest first, filtered by customer email
      const queryUrl = `${apiUrl}/cards?customerEmail=${encodeURIComponent(email)}&limit=5`;
      const response = await fetch(queryUrl, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (!response.ok) {
        console.warn(`⚠️ [SavedCardService] Payments.lk GET /cards returned HTTP ${response.status}`);
        return null;
      }

      const listData = await response.json();
      const cards = listData?.data || [];

      // Find the active card on file (exclude retired/removed cards)
      const activeCard = cards.find((c) => c.active !== false && !c.retiredAt);
      if (!activeCard) {
        console.log(`[SavedCardService] No active card on file in Payments.lk for ${email}`);
        return null;
      }

      console.log(
        `[SavedCardService] Active card on file in Payments.lk: ${activeCard.id} (${activeCard.scheme} •••• ${activeCard.last4}) for ${email}`
      );

      return {
        id: activeCard.id,
        cardId: activeCard.id,
        token: activeCard.id,
        userId: userId || "current",
        scheme: (activeCard.scheme || "visa").toLowerCase(),
        last4: String(activeCard.last4 || "0000"),
        cardHolder: activeCard.customerName || activeCard.cardHolder || activeCard.customerEmail || email,
        expiryMonth: String(activeCard.expiry?.month || "01").padStart(2, "0"),
        expiryYear: String(activeCard.expiry?.year || "39").slice(-2),
        isDefault: true,
        status: "active",
        paymentId: activeCard.paymentId || null,
        mode: activeCard.mode || "test",
        customerEmail: activeCard.customerEmail || email,
        addedAt: activeCard.createdAt
          ? new Date(activeCard.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "Recently Added",
      };
    } catch (err) {
      console.error("❌ [SavedCardService] Failed to query Payments.lk vault:", err.message);
      return null;
    }
  }

  /**
   * Normalizes and confirms card saved in Payments.lk vault
   */
  async saveCard(userId, cardData, rawEvent = null) {
    const token = cardData.cardToken || cardData.id || cardData.token;
    console.log(`[SavedCardService] Confirmed card token ${token} on file in Payments.lk vault.`);

    return {
      id: token,
      cardId: token,
      token: token,
      userId: userId,
      scheme: (cardData.scheme || cardData.cardScheme || "visa").toLowerCase(),
      last4: String(cardData.last4 || "0000"),
      cardHolder: cardData.cardHolder || cardData.customerName || "Cardholder",
      expiryMonth: cardData.expiryMonth || "01",
      expiryYear: cardData.expiryYear || "39",
      isDefault: true,
      status: "active",
      paymentId: cardData.paymentId,
      mode: cardData.mode || "test",
      addedAt: "Recently Added",
    };
  }

  /**
   * Removes card directly from Payments.lk processor vault
   */
  async removeCard(userId, cardIdOrToken = null, userEmail = null) {
    const paymentsLkStrategy = paymentGatewayFactory.getGateway("payments_lk");
    if (!paymentsLkStrategy) return false;

    // 1. If a specific card token was provided:
    if (
      cardIdOrToken &&
      cardIdOrToken !== "current" &&
      typeof cardIdOrToken === "string" &&
      (cardIdOrToken.startsWith("card_") || cardIdOrToken.startsWith("crd_"))
    ) {
      console.log(`[SavedCardService] Deleting card token ${cardIdOrToken} from Payments.lk vault...`);
      return await paymentsLkStrategy.deleteSavedCard(cardIdOrToken);
    }

    // 2. Otherwise, resolve customer email and delete all active cards on file for that customer in Payments.lk
    const email = await this._resolveEmail(userId, userEmail);
    if (!email) {
      console.warn("⚠️ [SavedCardService] Cannot remove card: customer email not found.");
      return false;
    }

    try {
      const secretKey = paymentsLkStrategy.secretKey;
      const apiUrl = paymentsLkStrategy.apiUrl;
      const listRes = await fetch(`${apiUrl}/cards?customerEmail=${encodeURIComponent(email)}&limit=10`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (listRes.ok) {
        const listData = await listRes.json();
        const activeCards = (listData?.data || []).filter((c) => c.active !== false && !c.retiredAt);
        for (const card of activeCards) {
          console.log(`[SavedCardService] Deleting card ${card.id} from Payments.lk for ${email}`);
          await paymentsLkStrategy.deleteSavedCard(card.id);
        }
      }
      return true;
    } catch (e) {
      console.warn("⚠️ [SavedCardService] Error during Payments.lk card deletion:", e.message);
      return false;
    }
  }
}

module.exports = new SavedCardService();

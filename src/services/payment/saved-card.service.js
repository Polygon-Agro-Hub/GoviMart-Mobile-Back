const savedCardDao = require("../../dao/saved-card.dao");
const fs = require("fs");
const path = require("path");

// Automatically purge legacy local files
const DATA_DIR = path.join(__dirname, "../../data");
try {
  const cardsTxt = path.join(DATA_DIR, "saved_cards.txt");
  const cardsJson = path.join(DATA_DIR, "saved_cards.json");
  if (fs.existsSync(cardsTxt)) fs.unlinkSync(cardsTxt);
  if (fs.existsSync(cardsJson)) fs.unlinkSync(cardsJson);
} catch (e) {
  // Ignore file purge errors
}

/**
 * Saved Card Service (Backed by MySQL user_saved_cards in collection_officer DB)
 */
class SavedCardService {
  /**
   * Retrieves the active saved card for user from MySQL DB
   */
  async getCard(userId) {
    if (!userId) return null;
    const card = await savedCardDao.getActiveCardByUserId(userId);
    if (!card) return null;

    return {
      id: card.cardToken,
      cardId: card.id,
      userId: card.userId,
      scheme: card.cardScheme,
      last4: card.last4,
      cardHolder: card.cardHolder,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      isDefault: Boolean(card.isDefault),
      status: card.status,
      paymentId: card.paymentId,
      mode: card.mode,
      addedAt: new Date(card.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
  }

  /**
   * Saves or replaces user active card in MySQL DB (user_saved_cards)
   */
  async saveCard(userId, cardData, rawEvent = null) {
    if (!userId) {
      console.warn("[SavedCardService] Cannot save card without userId");
      return null;
    }

    const saved = await savedCardDao.saveUserCard(userId, cardData);
    console.log(
      `[SavedCardService] Card ${saved.cardScheme.toUpperCase()} ending in ${saved.last4} saved in MySQL DB for user ${userId}`
    );

    return {
      id: saved.cardToken,
      cardId: saved.id,
      userId: saved.userId,
      scheme: saved.cardScheme,
      last4: saved.last4,
      cardHolder: saved.cardHolder,
      expiryMonth: saved.expiryMonth,
      expiryYear: saved.expiryYear,
      isDefault: Boolean(saved.isDefault),
      status: saved.status,
      paymentId: saved.paymentId,
      mode: saved.mode,
      addedAt: new Date(saved.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
  }

  /**
   * Removes saved card for user from both Payments.lk vault and MySQL DB
   */
  async removeCard(userId, cardIdOrToken = null) {
    if (!userId) return false;

    // 1. Gather tokens to delete from Payments.lk
    let tokensToDelete = [];
    if (cardIdOrToken && cardIdOrToken !== "current") {
      const card = await savedCardDao.getCardForUser(userId, cardIdOrToken);
      if (card && card.cardToken) {
        tokensToDelete.push(card.cardToken);
      } else if (
        typeof cardIdOrToken === "string" &&
        (cardIdOrToken.startsWith("card_") || cardIdOrToken.startsWith("crd_"))
      ) {
        tokensToDelete.push(cardIdOrToken);
      }
    } else {
      // Deleting current/all cards for this user
      const userCards = await savedCardDao.getAllCardsByUserId(userId);
      tokensToDelete = userCards
        .map((c) => c.cardToken)
        .filter((token) => Boolean(token));
    }

    // 2. Call Payments.lk DELETE /cards/{id} for each token
    if (tokensToDelete.length > 0) {
      try {
        const paymentGatewayFactory = require("./payment.factory");
        const paymentsLkStrategy = paymentGatewayFactory.getGateway("payments_lk");
        if (paymentsLkStrategy && typeof paymentsLkStrategy.deleteSavedCard === "function") {
          for (const token of tokensToDelete) {
            console.log(`[SavedCardService] Requesting Payments.lk to delete card token: ${token}`);
            await paymentsLkStrategy.deleteSavedCard(token);
          }
        }
      } catch (err) {
        console.warn(`[SavedCardService] Error during Payments.lk card deletion:`, err.message);
      }
    }

    // 3. Remove permanently from MySQL DB
    const result = await savedCardDao.removeUserCard(userId, cardIdOrToken);
    console.log(`[SavedCardService] Card permanently removed from MySQL DB for user ${userId}`);
    return result;
  }
}

module.exports = new SavedCardService();

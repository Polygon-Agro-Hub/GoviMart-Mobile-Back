/**
 * DEPRECATED: user_saved_cards table is permanently discontinued.
 * All saved card vaulting, charging, and management are handled directly
 * by Payments.lk Cloud Vault (Single Source of Truth) via SavedCardService.
 *
 * This DAO is completely neutered and performs zero SQL queries.
 */
class SavedCardDao {
  async getActiveCardByUserId(userId) {
    console.warn("⚠️ [SavedCardDao] DEPRECATED: user_saved_cards table is discontinued. Use savedCardService instead.");
    return null;
  }

  async saveUserCard(userId, cardData) {
    console.warn("⚠️ [SavedCardDao] DEPRECATED: user_saved_cards table is discontinued. Use savedCardService instead.");
    return null;
  }

  async updateCardToken(id, cardToken) {
    return null;
  }

  async getUserCards(userId) {
    return [];
  }

  async setDefaultCard(userId, cardId) {
    return false;
  }

  async deleteCard(userId, cardId) {
    return false;
  }

  async getCardByToken(cardToken) {
    return null;
  }
}

module.exports = new SavedCardDao();

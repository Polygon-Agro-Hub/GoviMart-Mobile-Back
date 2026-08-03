const customerDao = require("../dao/customer-dao");

exports.getCustomerProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getCustomerProfileDao(userId);
    if (results.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }
    return res.status(200).json({ status: true, data: results[0] });
  } catch (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getSuggestions = async (req, res) => {
  try {
    const results = await customerDao.getSuggestionsDao();
    return res.status(200).json({
      status: true,
      message: "Suggested items fetched successfully",
      items: results
    });
  } catch (error) {
    console.error("Suggestions fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getIncludeItems = async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getIncludeItemsDao(userId);
    return res.status(200).json({
      status: true,
      items: results
    });
  } catch (error) {
    console.error("Include items fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.addIncludeItems = async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(200).json({ status: true, message: "No items to insert" });
    }
    await customerDao.addIncludeItemsDao(userId, items);
    return res.status(200).json({ status: true, message: "Included items saved successfully" });
  } catch (error) {
    console.error("Include items save error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.deleteIncluded = async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(200).json({ status: true, message: "No items to delete" });
    }
    await customerDao.deleteIncludeItemsDao(userId, items);
    return res.status(200).json({ status: true, message: "Included items deleted successfully" });
  } catch (error) {
    console.error("Include items delete error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getExcludeItems = async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getExcludeItemsDao(userId);
    return res.status(200).json({
      status: true,
      items: results
    });
  } catch (error) {
    console.error("Exclude items fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.addExcludeItems = async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(200).json({ status: true, message: "No items to insert" });
    }
    await customerDao.addExcludeItemsDao(userId, items);
    return res.status(200).json({ status: true, message: "Excluded items saved successfully" });
  } catch (error) {
    console.error("Exclude items save error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.deleteExcluded = async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(200).json({ status: true, message: "No items to delete" });
    }
    await customerDao.deleteExcludeItemsDao(userId, items);
    return res.status(200).json({ status: true, message: "Excluded items deleted successfully" });
  } catch (error) {
    console.error("Exclude items delete error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await customerDao.updateUserStatusDao(userId);
    return res.status(200).json({
      status: true,
      message: "User status updated successfully",
      result
    });
  } catch (error) {
    console.error("Update status error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

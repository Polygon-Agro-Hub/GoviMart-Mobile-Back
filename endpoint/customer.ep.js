const customerDao = require("../dao/customer.dao");

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
      items: results,
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
      items: results,
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
      return res
        .status(200)
        .json({ status: true, message: "No items to insert" });
    }
    await customerDao.addIncludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Included items saved successfully" });
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
      return res
        .status(200)
        .json({ status: true, message: "No items to delete" });
    }
    await customerDao.deleteIncludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Included items deleted successfully" });
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
      items: results,
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
      return res
        .status(200)
        .json({ status: true, message: "No items to insert" });
    }
    await customerDao.addExcludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Excluded items saved successfully" });
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
      return res
        .status(200)
        .json({ status: true, message: "No items to delete" });
    }
    await customerDao.deleteExcludeItemsDao(userId, items);
    return res
      .status(200)
      .json({ status: true, message: "Excluded items deleted successfully" });
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
      result,
    });
  } catch (error) {
    console.error("Update status error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

exports.getSavedAddresses = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(401).json({
        status: false,
        message: "User not authenticated",
      });
    }

    const addresses =
      await customerDao.getSavedAddressesByCustomerIdDao(userId);

    if (!addresses || addresses.length === 0) {
      return res.status(200).json({
        status: false,
        message: "No saved addresses found",
        hasAddress: false,
      });
    }

    return res.status(200).json({
      status: true,
      message: "Saved addresses retrieved successfully",
      hasAddress: true,
      result: addresses,
    });
  } catch (error) {
    console.error("Error fetching saved addresses:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
      hasAddress: false,
      error: error.message,
    });
  }
};

exports.getAccountDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const results = await customerDao.getAccountDetailsDao(userId);
    if (results.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }
    return res.status(200).json({ status: true, data: results[0] });
  } catch (error) {
    console.error("Account details fetch error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ---------- Add User Address ----------
exports.addAddress = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { buildingType } = req.body;

    if (!buildingType || !["Apartment", "House"].includes(buildingType)) {
      return res
        .status(400)
        .json({ status: false, message: "Valid buildingType is required" });
    }

    const result = await customerDao.addAddressDao(customerId, req.body);
    return res
      .status(201)
      .json({ status: true, message: "Address added successfully", result });
  } catch (error) {
    console.error("Add address error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ---------- Update User Address ----------
exports.updateAddress = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { addressId } = req.params;
    const { buildingType } = req.body;

    if (!buildingType || !["Apartment", "House"].includes(buildingType)) {
      return res
        .status(400)
        .json({ status: false, message: "Valid buildingType is required" });
    }

    const result = await customerDao.updateAddressDao(
      addressId,
      customerId,
      req.body,
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "Address not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "Address updated successfully" });
  } catch (error) {
    console.error("Update address error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ---------- Delete User Address ----------
exports.deleteAddress = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { addressId } = req.params;
    const { buildingType } = req.query;

    if (!buildingType || !["Apartment", "House"].includes(buildingType)) {
      return res
        .status(400)
        .json({ status: false, message: "Valid buildingType is required" });
    }

    const result = await customerDao.deleteAddressDao(
      addressId,
      customerId,
      buildingType,
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "Address not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "Address deleted successfully" });
  } catch (error) {
    console.error("Delete address error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ---------- Update User Details ----------
exports.updateUserDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await customerDao.updateUserDetailsDao(userId, req.body);

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "User details updated successfully" });
  } catch (error) {
    console.error("Update user details error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ---------- Delete User Account ----------
exports.deleteUserAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await customerDao.deleteUserAccountDao(userId);

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    return res
      .status(200)
      .json({ status: true, message: "Account deleted successfully" });
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

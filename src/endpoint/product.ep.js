const ProductDao = require("../dao/product.dao");
const ProductValidate = require("../validations/product.validations");
const packageCache = require("../services/package-cache");

exports.getAllProduct = async (req, res) => {
  const { search, buyerType = "Retail", userType } = req.query;
  const effectiveBuyerType = buyerType || userType || "Retail";
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  console.log(fullUrl, "search:", search, "buyerType:", effectiveBuyerType);

  if (effectiveBuyerType.toLowerCase() !== "retail") {
    return res.status(200).json({
      status: true,
      message: "Packages are only available for Retail buyers",
      product: [],
    });
  }

  try {
    const productData = await ProductDao.getAllProductDao(search);
    if (productData.length === 0) {
      return res.json({
        status: false,
        message: search
          ? `No packages found matching "${search}"`
          : "No product found",
        product: [],
      });
    }

    res.status(200).json({
      status: true,
      message: "Product found.",
      product: productData,
    });
  } catch (err) {
    console.error("Error during get product:", err);
    res.status(500).json({ error: "An error occurred during retrieval." });
  }
};

exports.getProductsByCategory = async (req, res) => {
  const { category, search, buyerType, userType } = req.query;
  const effectiveBuyerType = buyerType || userType || "Retail";

  console.log("category", category, "search", search, "buyerType", effectiveBuyerType);

  // Only require category if no search parameter is provided
  if (!category && (!search || search.trim() === "")) {
    return res.status(400).json({
      status: false,
      message: "Category parameter is required when no search term is provided",
    });
  }

  try {
    const products = await ProductDao.getProductsByCategoryDao(
      category,
      search,
      effectiveBuyerType,
    );

    if (products.length === 0) {
      return res.json({
        status: false,
        message: search
          ? `No products found matching "${search}"`
          : "No products found for this category",
        products: [],
      });
    }

    res.status(200).json({
      status: true,
      message: "Products found.",
      products: products,
    });
  } catch (err) {
    console.error("Error fetching products by category:", err);
    res.status(500).json({
      status: false,
      error: "An error occurred while fetching products.",
    });
  }
};

exports.getPackageDetails = async (req, res) => {
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  console.log(fullUrl);

  try {
    const { packageId } =
      await ProductValidate.packageDetailsSchema.validateAsync(req.params);

    console.log("pkg Id", packageId);

    // const {packageId} = req.params
    // const packageIdNum = parseInt(packageId, 10);
    // console.log(packageIdNum);

    const [packageItemData, packageInfo] = await Promise.all([
      ProductDao.getAllPackageItemsDao(packageId),
      ProductDao.getPackageDetailsByIdDao(packageId),
    ]);

    if ((!packageItemData || packageItemData.length === 0) && !packageInfo) {
      return res.json({
        status: false,
        message: "No package data found",
        product: [],
      });
    }

    res.status(200).json({
      status: true,
      message: "Product found.",
      packageItems: packageItemData || [],
      packageInfo: packageInfo || null,
      packageType: packageInfo?.packageType || null,
      endDate: packageInfo?.endDate || null,
    });
  } catch (err) {
    console.error("Error during get product:", err);
    res.status(500).json({ error: "An error occurred during signup." });
  }
};

exports.getAllSlides = async (req, res) => {
  try {
    const slides = await ProductDao.getAllSlidesDao();
    res.status(200).json({
      status: true,
      message: "Slides fetched successfully",
      slides,
    });
  } catch (err) {
    console.error("Error fetching slides:", err);
    res.status(500).json({ status: false, error: "Failed to fetch slides" });
  }
};

/**
 * POST /api/product/check-availability
 * Body: { productIds: number[], packageIds: number[] }
 * Returns which IDs are still active/available in the database.
 */
exports.checkAvailability = async (req, res) => {
  try {
    const { productIds = [], packageIds = [] } = req.body;

    if (!Array.isArray(productIds) || !Array.isArray(packageIds)) {
      return res.status(400).json({
        status: false,
        message: "productIds and packageIds must be arrays",
      });
    }

    const result = await ProductDao.checkAvailabilityDao(productIds, packageIds);

    return res.status(200).json({
      status: true,
      products: result.products,
      packages: result.packages,
    });
  } catch (err) {
    console.error("Error checking availability:", err);
    res.status(500).json({ status: false, error: "Failed to check availability" });
  }
};

exports.getProductsByProductType = async (req, res) => {
  const { productTypeId } = req.params;
  const { buyerType = "Retail" } = req.query;

  if (!productTypeId) {
    return res.status(400).json({
      status: false,
      message: "productTypeId parameter is required",
    });
  }

  try {
    const products = await ProductDao.getProductsByProductTypeDao(
      productTypeId,
      buyerType
    );

    return res.status(200).json({
      status: true,
      message: "Products fetched for product type successfully",
      products: products || [],
    });
  } catch (err) {
    console.error("Error fetching products by product type:", err);
    return res.status(500).json({
      status: false,
      error: "An error occurred while fetching products by product type.",
    });
  }
};

/**
 * POST /polygon/api/product/notify-update
 * Webhook called by Admin Panel when packages or products are created, updated, or status-changed.
 * Broadcasts real-time 'packages_updated' and 'catalog_updated' WebSocket events to all connected Polygon/GoviMart mobile apps.
 */
exports.notifyPackageUpdate = async (req, res) => {
  try {
    const payload = req.body || {};
    const { action, packageId, extra } = payload;
    console.log(`📦 [ProductService] Received package notify-update: action=${action}, packageId=${packageId}`);

    // Refresh or clear in-memory package cache
    try {
      await packageCache.refreshPackageCache();
    } catch (_) {
      packageCache.clearPackageCache();
    }

    const { emitCatalogUpdate } = require("../socket/socket");
    emitCatalogUpdate({
      type: "package",
      action: action || "update",
      packageId: packageId || null,
      timestamp: new Date().toISOString(),
      ...(extra || {}),
    });

    return res.status(200).json({
      status: true,
      message: `Package update broadcasted successfully (action: ${action || "update"})`,
      data: payload,
    });
  } catch (error) {
    console.error("Error broadcasting package update:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to broadcast package update",
      error: error.message,
    });
  }
};


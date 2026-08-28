const ProductDao = require("../dao/product.dao");
const ProductValidate = require("../validations/product.validations");

exports.getAllProduct = async (req, res) => {
  const { search } = req.query;
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  console.log(fullUrl, "search:", search);

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
  const { category, search } = req.query;

  console.log("category", category, "search", search);

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

    const packageItemData = await ProductDao.getAllPackageItemsDao(packageId);
    if (packageItemData.length === 0) {
      return res.json({
        status: false,
        message: "No package data found",
        product: [],
      });
    }
    // console.log(packageItemData);

    res.status(200).json({
      status: true,
      message: "Product found.",
      packageItems: packageItemData,
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


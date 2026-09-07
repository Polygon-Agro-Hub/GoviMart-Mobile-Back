const asyncHandler = require("express-async-handler");
const cartDao = require("../dao/cart.dao");
const productDao = require("../dao/product.dao");

/**
 * Helper to get or create cart for user
 */
const getOrCreateCart = async (userId, buyerType = "Retail") => {
  let cart = await cartDao.getCartByUserIdDao(userId);
  if (!cart) {
    const cartId = await cartDao.createCartDao(userId, buyerType);
    cart = { id: cartId, userId, buyerType };
  }
  return cart;
};

/**
 * GET /api/cart/user-cart
 * Retrieves current active cart from DB for authenticated user
 */
exports.getUserCart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const cart = await cartDao.getCartByUserIdDao(userId);

  if (!cart) {
    return res.status(200).json({
      status: true,
      message: "Cart is empty",
      data: {
        cartId: 0,
        packages: [],
        products: [],
      },
    });
  }

  const products = await cartDao.getCartProductsDao(cart.id);
  const packages = await cartDao.getCartPackagesDao(cart.id);

  // Format packages to include totalItems
  const formattedPackages = await Promise.all(
    packages.map(async (pkg) => {
      const items = await productDao.getAllPackageItemsDao(pkg.packageId);
      const totalItems = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
      return {
        id: pkg.packageId,
        name: pkg.name,
        image: pkg.image,
        price: parseFloat(pkg.price) || 0,
        quantity: pkg.quantity,
        totalItems: totalItems || 1,
        isUnavailable: pkg.status !== "Enabled" || pkg.isValid !== 1,
      };
    })
  );

  // Format products
  const formattedProducts = products.map((prod) => {
    const rawStartVal = parseFloat(prod.startValue) || 1;
    const dbUnitType = (prod.unitType || "g").toLowerCase();
    const currentUnit = (prod.unit || dbUnitType).toLowerCase();

    let minWeight = rawStartVal;
    if (rawStartVal < 1 && currentUnit === "g") {
      minWeight = Math.round(rawStartVal * 1000);
    } else if (dbUnitType === "kg" && currentUnit === "g") {
      minWeight = Math.round(rawStartVal * 1000);
    } else if (dbUnitType === "g" && currentUnit === "kg") {
      minWeight = parseFloat((rawStartVal / 1000).toFixed(3));
    }

    const currentWeight = parseFloat(prod.quantity) || minWeight;

    return {
      id: prod.productId,
      name: prod.name,
      image: prod.image,
      price: parseFloat(prod.discountedPrice || prod.normalPrice) || 0,
      normalPrice: parseFloat(prod.normalPrice) || 0,
      weight: currentWeight,
      unit: currentUnit,
      minimumWeight: minWeight,
      step: currentUnit === "kg" ? 0.5 : (minWeight >= 500 ? 500 : 100),
      isUnavailable: prod.isEnable !== 1,
    };
  });

  return res.status(200).json({
    status: true,
    message: "Cart retrieved successfully",
    data: {
      cartId: cart.id,
      packages: formattedPackages,
      products: formattedProducts,
    },
  });
});

/**
 * POST /api/cart/product
 * Adds or updates an ala carte product in DB cart
 */
exports.addOrUpdateCartProduct = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { productId, quantity, unit = "g" } = req.body;

  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({
      status: false,
      message: "Valid productId and quantity are required",
    });
  }

  const cart = await getOrCreateCart(userId);
  const existing = await cartDao.checkProductInCartDao(cart.id, productId);

  if (existing) {
    await cartDao.updateProductQtyInCartDao(cart.id, productId, quantity, unit);
  } else {
    await cartDao.addProductToCartDao(cart.id, productId, quantity, unit);
  }

  return res.status(200).json({
    status: true,
    message: "Cart product updated successfully",
    data: { cartId: cart.id, productId, quantity, unit },
  });
});

/**
 * POST /api/cart/package
 * Adds or updates a package in DB cart
 */
exports.addOrUpdateCartPackage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { packageId, quantity = 1 } = req.body;

  if (!packageId || !quantity || quantity <= 0) {
    return res.status(400).json({
      status: false,
      message: "Valid packageId and quantity are required",
    });
  }

  const cart = await getOrCreateCart(userId);
  const existing = await cartDao.checkPackageInCartDao(cart.id, packageId);

  if (existing) {
    await cartDao.updatePackageQtyInCartDao(cart.id, packageId, quantity);
  } else {
    await cartDao.addPackageToCartDao(cart.id, packageId, quantity);
  }

  return res.status(200).json({
    status: true,
    message: "Cart package updated successfully",
    data: { cartId: cart.id, packageId, quantity },
  });
});

/**
 * DELETE /api/cart/product/:productId
 * Removes product from DB cart
 */
exports.removeCartProduct = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const productId = req.params.productId || req.body.productId;

  if (!productId) {
    return res.status(400).json({ status: false, message: "productId is required" });
  }

  const cart = await cartDao.getCartByUserIdDao(userId);
  if (cart) {
    await cartDao.removeProductFromCartDao(cart.id, productId);
  }

  return res.status(200).json({
    status: true,
    message: "Product removed from cart",
  });
});

/**
 * DELETE /api/cart/package/:packageId
 * Removes package from DB cart
 */
exports.removeCartPackage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const packageId = req.params.packageId || req.body.packageId;

  if (!packageId) {
    return res.status(400).json({ status: false, message: "packageId is required" });
  }

  const cart = await cartDao.getCartByUserIdDao(userId);
  if (cart) {
    await cartDao.removePackageFromCartDao(cart.id, packageId);
  }

  return res.status(200).json({
    status: true,
    message: "Package removed from cart",
  });
});

/**
 * DELETE /api/cart/clear
 * Clears entire cart for user
 */
exports.clearCart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const cart = await cartDao.getCartByUserIdDao(userId);

  if (cart) {
    await cartDao.clearCartDao(cart.id);
  }

  return res.status(200).json({
    status: true,
    message: "Cart cleared successfully",
  });
});

const express = require('express');
const router = express.Router();
const productEp = require("../endpoint/product.ep");

//----------------------package-product function routes ------------------------
router.get("/all-product", productEp.getAllProduct);
//get all product by category
router.get("/by-category", productEp.getProductsByCategory);

router.get("/package-details/:packageId", productEp.getPackageDetails);
router.get("/by-product-type/:productTypeId", productEp.getProductsByProductType);

//Get all banners
router.get("/slides", productEp.getAllSlides);

// Check availability of cart items (products + packages) by their IDs
router.post("/check-availability", productEp.checkAvailability);

module.exports = router;
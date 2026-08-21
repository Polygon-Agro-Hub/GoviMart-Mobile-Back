const express = require('express');
const router = express.Router();
const productEp = require("../endpoint/product.ep");

//----------------------package-product function routes ------------------------
router.get("/all-product", productEp.getAllProduct);
//get all product by category
router.get("/by-category", productEp.getProductsByCategory);

router.get("/package-details/:packageId", productEp.getPackageDetails);

//Get all banners
router.get("/slides", productEp.getAllSlides);

module.exports = router;
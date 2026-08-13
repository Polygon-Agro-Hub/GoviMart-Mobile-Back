const express = require("express");
const router = express.Router();
const homeEp = require("../endpoint/home.ep");

router.get("/slides", homeEp.getAllSlides);

module.exports = router;

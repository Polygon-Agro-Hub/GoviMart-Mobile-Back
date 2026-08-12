const homeDao = require("../dao/home-dao");

exports.getAllSlides = async (req, res) => {
  try {
    const slides = await homeDao.getAllSlidesDao();
    return res.status(200).json({
      status: true,
      message: "Slides fetched successfully",
      slides,
    });
  } catch (err) {
    console.error("Error in getAllSlides endpoint:", err);
    return res.status(500).json({ status: false, error: "Failed to fetch slides" });
  }
};

/**
 * Global Error Handling Middleware
 */
const errorHandler = (err, req, res, next) => {
  // Handle Multer upload errors
  if (err && err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        status: false,
        message: "Image size must not exceed 5MB. Please choose a smaller image.",
      });
    }
    return res.status(400).json({
      status: false,
      message: err.message || "File upload error",
    });
  }

  // Handle custom file filter errors
  if (err && err.message === "Only images are allowed") {
    return res.status(400).json({
      status: false,
      message: "Only images (JPG, PNG) are allowed.",
    });
  }

  // Log error stack or message based on environment
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  } else {
    console.error(`[Error] ${err.message}`);
  }

  return res.status(500).json({
    status: false,
    message: err.message || "Something broke!!",
  });
};

module.exports = errorHandler;

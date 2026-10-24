const path = require('path');

let upload;

try {
  const multer = require('multer');

  // Memory storage keeps file buffer in RAM for streaming directly to Cloudinary
  const storage = multer.memoryStorage();

  // File filter strictly enforces .png, .jpg, and .jpeg extensions and mime-types
  const fileFilter = (req, file, cb) => {
    const allowedExtensions = ['.png', '.jpg', '.jpeg'];
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg'];

    const fileExt = path.extname(file.originalname).toLowerCase();
    const isValidExt = allowedExtensions.includes(fileExt);
    const isValidMime = allowedMimeTypes.includes(file.mimetype.toLowerCase());

    if (isValidExt && isValidMime) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file format. Only .png, .jpg, and .jpeg images are allowed.'
        ),
        false
      );
    }
  };

  upload = multer({
    storage,
    limits: {
      fileSize: 5 * 1024 * 1024 // 5 MB max file size
    },
    fileFilter
  });
} catch (err) {
  // Graceful fallback if multer is not yet installed in node_modules
  upload = {
    single: (fieldName) => (req, res, next) => {
      return next(
        new Error(
          'The "multer" package is not installed. Please run "npm install multer" in the CampusAI_backend directory.'
        )
      );
    }
  };
}

module.exports = upload;

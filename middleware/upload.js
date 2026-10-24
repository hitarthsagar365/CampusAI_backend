const multer = require('multer');
const path = require('path');

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

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB max file size
  },
  fileFilter
});

module.exports = upload;

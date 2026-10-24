let cloudinary;

try {
  cloudinary = require('cloudinary').v2;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
} catch (err) {
  // Graceful fallback if cloudinary package is not yet installed in node_modules
  cloudinary = null;
}

module.exports = cloudinary;

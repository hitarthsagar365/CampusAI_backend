const { Readable } = require('stream');
const cloudinary = require('../config/cloudinary');
const User = require('../models/User');

/**
 * Helper to upload buffer to Cloudinary via upload stream
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {string} userId - Current user ID for public_id tagging
 * @returns {Promise<object>} - Cloudinary upload result
 */
const uploadToCloudinary = (buffer, userId) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'campus_ai/profile_pictures',
        public_id: `user_${userId}_${Date.now()}`,
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};

/**
 * @desc    Upload profile picture to Cloudinary and update User avatar
 * @route   POST /api/auth/profile-picture (or /api/profile/picture)
 * @access  Private (Student & Teacher)
 */
exports.uploadProfilePicture = async (req, res) => {
  try {
    if (!cloudinary) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary is not installed or configured. Please run "npm install cloudinary" in the backend directory.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a .png, .jpg, or .jpeg image.'
      });
    }

    const userId = req.user?.userId || req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. User information not found.'
      });
    }

    // Upload buffer to Cloudinary via stream
    const uploadResult = await uploadToCloudinary(req.file.buffer, userId);

    if (!uploadResult || !uploadResult.secure_url) {
      return res.status(502).json({
        success: false,
        message: 'Cloudinary upload failed. No secure URL returned.'
      });
    }

    // Persist new avatar URL into MongoDB User document
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { avatar: uploadResult.secure_url },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found in database.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully!',
      avatarUrl: uploadResult.secure_url,
      user: updatedUser.toSafeObject()
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error uploading profile picture.'
    });
  }
};

const express = require('express');
const router = express.Router();
const {
  registerStudent,
  registerFaculty,
  login,
  loginAdmin,
  loginFaculty,
  loginStudent,
  refresh,
  getMe,
  logout,
  logoutAll,
  getStudents,
  getFaculty
} = require('../controllers/authController');
const { uploadProfilePicture } = require('../controllers/profileController');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Wrapper to handle Multer validation errors gracefully
const handleAvatarUpload = (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload failed. Ensure format is .png, .jpg, or .jpeg and size is under 5MB.'
      });
    }
    next();
  });
};

// Public authentication routes
router.post('/register-student', registerStudent);
router.post('/register-faculty', registerFaculty);
router.post('/login', login);
router.post('/login/admin', loginAdmin);
router.post('/login/faculty', loginFaculty);
router.post('/login/student', loginStudent);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Protected routes (require valid JWT access token)
router.get('/me', authMiddleware, getMe);
router.post('/logout-all', authMiddleware, logoutAll);
router.get('/students', authMiddleware, getStudents);
router.get('/faculty', authMiddleware, getFaculty);

// Profile picture upload route (Students and Teachers/Faculty)
router.post('/profile-picture', authMiddleware, handleAvatarUpload, uploadProfilePicture);

module.exports = router;

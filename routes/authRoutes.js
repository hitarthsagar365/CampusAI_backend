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

// Helper to support both POST and query-based GET logins, while preventing 404s
const loginWithFallback = (controllerFn) => (req, res) => {
  if (req.method === 'GET') {
    if (req.query.identifier || req.query.email || req.query.username || req.query.enrollment) {
      req.body = { ...req.query, ...req.body };
      return controllerFn(req, res);
    }
    return res.status(405).json({
      success: false,
      message: `Method Not Allowed: ${req.method} ${req.originalUrl}. Login requires an HTTP POST request with user credentials (email/enrollment/username & password) in the JSON body.`
    });
  }
  return controllerFn(req, res);
};

// Public authentication routes
router.post('/register-student', registerStudent);
router.post('/register-faculty', registerFaculty);

router.route('/login')
  .post(login)
  .get(loginWithFallback(login));

router.route('/login/admin')
  .post(loginAdmin)
  .get(loginWithFallback(loginAdmin));

router.route('/login/faculty')
  .post(loginFaculty)
  .get(loginWithFallback(loginFaculty));

router.route('/login/student')
  .post(loginStudent)
  .get(loginWithFallback(loginStudent));

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

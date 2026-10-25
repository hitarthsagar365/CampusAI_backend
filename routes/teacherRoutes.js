const express = require('express');
const router = express.Router();
const {
  getAllocatedSubjects,
  assignSubjects
} = require('../controllers/teacherController');
const { protect, requireRole } = require('../middleware/auth');

// Requirement 2: Fetch allocated subjects for currently logged-in teacher
router.get(
  '/allocated-subjects',
  protect,
  requireRole('teacher', 'faculty', 'admin'),
  getAllocatedSubjects
);

// Admin route to allocate multiple subjects & semesters to a teacher
router.post(
  '/assign-subjects',
  protect,
  requireRole('admin'),
  assignSubjects
);

module.exports = router;

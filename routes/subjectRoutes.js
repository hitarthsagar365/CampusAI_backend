const express = require('express');
const router = express.Router();
const {
  getSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject
} = require('../controllers/academicController');
const { protect, requireRole } = require('../middleware/auth');

// Public/Open route so registration form and admin can both fetch subjects
router.get('/', getSubjects);
router.get('/:id', getSubjectById);

// Admin-only protected mutation routes
router.post('/', protect, requireRole('admin'), createSubject);
router.put('/:id', protect, requireRole('admin'), updateSubject);
router.delete('/:id', protect, requireRole('admin'), deleteSubject);

module.exports = router;

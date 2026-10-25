const express = require('express');
const router = express.Router();
const {
  getFaculty,
  getFacultyById,
  createFaculty,
  updateFaculty,
  deleteFaculty
} = require('../controllers/facultyController');
const { getAllocatedSubjects } = require('../controllers/teacherController');
const { requireRole } = require('../middleware/auth');

router.get('/allocated-subjects', requireRole('faculty', 'teacher', 'admin'), getAllocatedSubjects);
router.get('/', getFaculty);
router.get('/:id', getFacultyById);
router.post('/', requireRole('admin'), createFaculty);
router.put('/:id', requireRole('admin'), updateFaculty);
router.delete('/:id', requireRole('admin'), deleteFaculty);

module.exports = router;

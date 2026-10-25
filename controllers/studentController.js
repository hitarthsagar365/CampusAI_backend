const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Helper to sanitize semester
const normalizeSemester = (sem) => {
  if (!sem) return 'Semester 1';
  if (/^semester\s*\d+/i.test(sem)) return sem;
  if (/^\d+$/.test(sem)) return `Semester ${sem}`;
  return sem;
};

// @desc    Get all students (with optional department, semester, section filters)
// @route   GET /api/students
// @access  Private
exports.getStudents = async (req, res) => {
  try {
    const { department, semester, section, classSection, division, search } = req.query;
    const conditions = [{ role: { $in: ['student', 'Student'] } }];

    // 1. Department / Course Filter
    if (department && department !== 'All' && department !== 'All Departments') {
      const escapedDept = department.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      conditions.push({
        $or: [
          { department: new RegExp(`^${escapedDept}$`, 'i') },
          { course: new RegExp(`^${escapedDept}$`, 'i') }
        ]
      });
    }

    // 2. Semester Filter (matches numeric, string, or "Semester X")
    if (semester && semester !== 'All') {
      const cleanSem = normalizeSemester(semester);
      if (cleanSem) {
        conditions.push({
          $or: [
            { semester: cleanSem },
            { semester: String(cleanSem) },
            { semester: `Semester ${cleanSem}` },
            { semester: new RegExp(`^\\s*(?:semester|sem)?\\s*${cleanSem}\\s*$`, 'i') }
          ]
        });
      }
    }

    // 3. Section / Division Filter
    const sec = (section || classSection || division || '').trim();
    if (sec && sec !== 'All' && sec !== 'General') {
      const cleanSec = sec.replace(/^(Section|Division)\s+/i, '').trim();
      const escapedSec = cleanSec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      conditions.push({
        $or: [
          { classSection: new RegExp(`^(?:Section\\s+|Division\\s+)?${escapedSec}$`, 'i') },
          { section: new RegExp(`^(?:Section\\s+|Division\\s+)?${escapedSec}$`, 'i') },
          { division: new RegExp(`^(?:Section\\s+|Division\\s+)?${escapedSec}$`, 'i') }
        ]
      });
    }

    // 4. Search Filter
    if (search && search.trim()) {
      const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      conditions.push({
        $or: [
          { name: searchRegex },
          { enrollment: searchRegex },
          { email: searchRegex },
          { username: searchRegex }
        ]
      });
    }

    const query = conditions.length === 1 ? conditions[0] : { $and: conditions };

    // Total records count for pagination metadata
    const totalRecords = await User.countDocuments(query);

    // Pagination: page and limit
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.limit !== undefined
      ? Math.max(0, parseInt(req.query.limit, 10))
      : (req.query.page ? 10 : 0);

    let studentsQuery = User.find(query).sort({ enrollment: 1, name: 1 });
    if (limit > 0) {
      const skip = (page - 1) * limit;
      studentsQuery = studentsQuery.skip(skip).limit(limit);
    }

    const students = await studentsQuery;
    const formatted = students.map((s) => s.toSafeObject());
    const totalPages = limit > 0 ? Math.ceil(totalRecords / limit) : 1;

    res.status(200).json({
      success: true,
      count: formatted.length,
      totalRecords,
      currentPage: page,
      totalPages,
      limit: limit || totalRecords,
      data: formatted,
      students: formatted
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ success: false, message: 'Server error fetching students.' });
  }
};

// @desc    Get single student by ID
// @route   GET /api/students/:id
// @access  Private
exports.getStudentById = async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    res.status(200).json({ success: true, data: student.toSafeObject() });
  } catch (error) {
    console.error('Error fetching student by ID:', error);
    res.status(500).json({ success: false, message: 'Server error fetching student.' });
  }
};

// @desc    Create new student
// @route   POST /api/students
// @access  Private (Admin)
exports.createStudent = async (req, res) => {
  try {
    const { name, enrollment, email, department, course, semester, classSection, section, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Student full name is required.' });
    }
    if (!enrollment || !enrollment.trim()) {
      return res.status(400).json({ success: false, message: 'Enrollment number is required.' });
    }

    const cleanEnrollment = enrollment.trim();
    const existing = await User.findOne({
      $or: [
        { enrollment: cleanEnrollment },
        { username: cleanEnrollment }
      ]
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A student or user with enrollment '${cleanEnrollment}' already exists.`
      });
    }

    const resolvedDept = department || course || 'AIML';
    const resolvedSem = normalizeSemester(semester);
    const resolvedSection = (classSection || section || 'A').trim();

    // Password hashing
    const pwdToHash = password && password.trim() ? password.trim() : cleanEnrollment;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(pwdToHash, salt);

    const student = await User.create({
      name: name.trim(),
      role: 'student',
      enrollment: cleanEnrollment,
      username: cleanEnrollment,
      email: email ? email.trim().toLowerCase() : '',
      department: resolvedDept,
      course: resolvedDept,
      semester: resolvedSem,
      classSection: resolvedSection,
      section: resolvedSection,
      passwordHash
    });

    res.status(201).json({
      success: true,
      message: 'Student created successfully.',
      data: student.toSafeObject()
    });
  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error creating student.' });
  }
};

// @desc    Update student by ID
// @route   PUT /api/students/:id
// @access  Private (Admin)
exports.updateStudent = async (req, res) => {
  try {
    const { name, enrollment, email, department, course, semester, classSection, section, password } = req.body;

    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    if (enrollment && enrollment.trim() !== student.enrollment) {
      const cleanEnrollment = enrollment.trim();
      const existing = await User.findOne({
        _id: { $ne: student._id },
        $or: [{ enrollment: cleanEnrollment }, { username: cleanEnrollment }]
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Enrollment number '${cleanEnrollment}' is already taken by another user.`
        });
      }
      student.enrollment = cleanEnrollment;
      student.username = cleanEnrollment;
    }

    if (name) student.name = name.trim();
    if (email !== undefined) student.email = email.trim().toLowerCase();
    if (department) {
      student.department = department;
      student.course = department;
    } else if (course) {
      student.department = course;
      student.course = course;
    }
    if (semester) student.semester = normalizeSemester(semester);
    if (classSection !== undefined) {
      student.classSection = classSection.trim();
      student.section = classSection.trim();
    } else if (section !== undefined) {
      student.classSection = section.trim();
      student.section = section.trim();
    }

    if (password && password.trim()) {
      const salt = await bcrypt.genSalt(10);
      student.passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    await student.save();

    res.status(200).json({
      success: true,
      message: 'Student updated successfully.',
      data: student.toSafeObject()
    });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error updating student.' });
  }
};

// @desc    Delete student by ID
// @route   DELETE /api/students/:id
// @access  Private (Admin)
exports.deleteStudent = async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: `Student '${student.name}' (${student.enrollment}) was deleted successfully.`
    });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ success: false, message: 'Server error deleting student.' });
  }
};

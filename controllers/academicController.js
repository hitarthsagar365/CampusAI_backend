const Course = require('../models/Course');
const Subject = require('../models/Subject');
const Class = require('../models/Class');

// --- COURSES ---
exports.getCourses = async (req, res) => {
  try {
    const { dept } = req.query;
    let query = {};
    if (dept && dept !== 'All Departments') {
      query.dept = { $in: [dept, 'All Departments'] };
    }
    const courses = await Course.find(query).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: courses.length, data: courses });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ success: false, message: 'Server error fetching courses.' });
  }
};

exports.createCourse = async (req, res) => {
  try {
    const { code, title, dept, credits } = req.body;
    if (!code || !title || !dept || credits === undefined) {
      return res.status(400).json({ success: false, message: 'Code, title, dept, and credits are required.' });
    }
    const course = await Course.create({
      code: code.trim(),
      title: title.trim(),
      dept,
      credits: Number(credits)
    });
    res.status(201).json({ success: true, message: 'Course created successfully.', data: course });
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error creating course.' });
  }
};

// @desc    Get course by ID
// @route   GET /api/courses/:id
// @access  Private
exports.getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }
    res.status(200).json({ success: true, data: course });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ success: false, message: 'Server error fetching course.' });
  }
};

// @desc    Update course by ID
// @route   PUT /api/courses/:id
// @access  Private (Admin)
exports.updateCourse = async (req, res) => {
  try {
    const { code, title, dept, credits } = req.body;
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }
    if (code) course.code = code.trim();
    if (title) course.title = title.trim();
    if (dept) course.dept = dept;
    if (credits !== undefined) course.credits = Number(credits);

    await course.save();
    res.status(200).json({ success: true, message: 'Course updated successfully.', data: course });
  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error updating course.' });
  }
};

exports.deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }
    await Course.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Course deleted successfully.' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ success: false, message: 'Server error deleting course.' });
  }
};

// --- SUBJECTS ---
// @desc    Get all subjects (dynamically filterable by course and semester)
// @route   GET /api/subjects?course=AIML&semester=3
// @access  Public
exports.getSubjects = async (req, res) => {
  try {
    const { dept, course, semester } = req.query;
    const filterCourse = (course || dept || '').trim();
    const filterSemester = semester !== undefined && semester !== null ? String(semester).trim() : '';

    const conditions = [];

    // 1. Course Filter (e.g. AIML, Cyber Security)
    if (filterCourse && filterCourse !== 'All' && filterCourse !== 'All Departments') {
      const cleaned = filterCourse.replace(/[^a-zA-Z0-9]/g, '');
      const pattern = cleaned ? cleaned.split('').join('\\s*') : filterCourse;
      const courseRegex = new RegExp(`^${pattern}$`, 'i');

      conditions.push({
        $or: [
          { course: courseRegex },
          { dept: courseRegex },
          { course: 'All Departments' },
          { dept: 'All Departments' },
          { course: 'All' },
          { dept: 'All' }
        ]
      });
    }

    // 2. Semester Filter (e.g. 1, 2, 3, or "Semester 3")
    if (filterSemester && filterSemester !== 'All') {
      const semNum = parseInt(filterSemester.replace(/\D/g, ''), 10);
      if (!isNaN(semNum) && semNum > 0) {
        conditions.push({
          $or: [
            { semester: semNum },
            { semester: String(semNum) },
            { semester: `Semester ${semNum}` },
            { semester: new RegExp(`^\\s*semester\\s*${semNum}\\s*$`, 'i') }
          ]
        });
      }
    }

    const query = conditions.length === 1
      ? conditions[0]
      : conditions.length > 1
      ? { $and: conditions }
      : {};

    const subjects = await Subject.find(query).sort({ semester: 1, code: 1, name: 1, createdAt: -1 });
    res.status(200).json({ success: true, count: subjects.length, data: subjects });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ success: false, message: 'Server error fetching subjects.' });
  }
};

// @desc    Get subject by ID
// @route   GET /api/subjects/:id
// @access  Private
exports.getSubjectById = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found.' });
    }
    res.status(200).json({ success: true, data: subject });
  } catch (error) {
    console.error('Error fetching subject:', error);
    res.status(500).json({ success: false, message: 'Server error fetching subject.' });
  }
};

exports.createSubject = async (req, res) => {
  try {
    const { code, name, dept, course, semester, type } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'Subject code and name are required.' });
    }
    const resolvedDept = dept || course || 'All Departments';
    const resolvedCourse = course || (dept && dept !== 'All Departments' ? dept : '') || '';

    const subject = await Subject.create({
      code: code.trim(),
      name: name.trim(),
      dept: resolvedDept,
      course: resolvedCourse,
      semester: semester ? Number(semester) : undefined,
      type: (type || 'Core').trim()
    });
    res.status(201).json({ success: true, message: 'Subject created successfully.', data: subject });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error creating subject.' });
  }
};

// @desc    Update subject by ID
// @route   PUT /api/subjects/:id
// @access  Private (Admin)
exports.updateSubject = async (req, res) => {
  try {
    const { code, name, dept, course, semester, type } = req.body;
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found.' });
    }
    if (code) subject.code = code.trim();
    if (name) subject.name = name.trim();
    if (dept !== undefined) subject.dept = dept;
    if (course !== undefined) subject.course = course;
    if (semester !== undefined) subject.semester = Number(semester);
    if (type) subject.type = type.trim();

    await subject.save();
    res.status(200).json({ success: true, message: 'Subject updated successfully.', data: subject });
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error updating subject.' });
  }
};

exports.deleteSubject = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found.' });
    }
    await Subject.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Subject deleted successfully.' });
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({ success: false, message: 'Server error deleting subject.' });
  }
};

// --- CLASSES ---
exports.getClasses = async (req, res) => {
  try {
    const { dept, faculty } = req.query;
    let query = {};
    if (dept && dept !== 'All Departments') {
      query.dept = { $in: [dept, 'All Departments'] };
    }
    if (faculty) {
      query.faculty = { $regex: new RegExp(faculty.trim(), 'i') };
    }
    const classes = await Class.find(query).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: classes.length, data: classes });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ success: false, message: 'Server error fetching classes.' });
  }
};

exports.createClass = async (req, res) => {
  try {
    const { name, section, room, faculty, dept } = req.body;
    if (!name || !section || !room || !faculty) {
      return res.status(400).json({ success: false, message: 'Name, section, room, and faculty are required.' });
    }
    const newClass = await Class.create({
      name: name.trim(),
      section: section.trim(),
      room: room.trim(),
      faculty: faculty.trim(),
      dept: dept || 'All Departments'
    });
    res.status(201).json({ success: true, message: 'Class created successfully.', data: newClass });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error creating class.' });
  }
};

exports.deleteClass = async (req, res) => {
  try {
    const cls = await Class.findById(req.params.id);
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found.' });
    }
    await Class.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Class deleted successfully.' });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ success: false, message: 'Server error deleting class.' });
  }
};

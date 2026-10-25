const mongoose = require('mongoose');
const User = require('../models/User');
const Subject = require('../models/Subject');
const FacultySubjectAssignment = require('../models/FacultySubjectAssignment');
const bcrypt = require('bcryptjs');

// @desc    Get all faculty members
// @route   GET /api/faculty
// @access  Private
exports.getFaculty = async (req, res) => {
  try {
    const { department, search } = req.query;
    let query = { role: { $in: ['faculty', 'teacher', 'Faculty', 'Teacher'] } };

    if (department && department !== 'All' && department !== 'All Departments') {
      query.department = new RegExp(`^${department}$`, 'i');
    }

    if (search && search.trim()) {
      const s = search.trim();
      const searchRegex = new RegExp(s, 'i');
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { name: searchRegex },
            { username: searchRegex },
            { email: searchRegex },
            { assignedSubject: searchRegex },
            { 'assignedSubjects.course': searchRegex }
          ]
        }
      ];
    }

    // Total records count for pagination metadata
    const totalRecords = await User.countDocuments(query);

    // Pagination: page and limit
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.limit !== undefined
      ? Math.max(0, parseInt(req.query.limit, 10))
      : (req.query.page ? 10 : 0);

    let facultyQuery = User.find(query)
      .populate({
        path: 'assignedSubjects.subject',
        select: '_id name code dept course type'
      })
      .sort({ createdAt: -1 });
    if (limit > 0) {
      const skip = (page - 1) * limit;
      facultyQuery = facultyQuery.skip(skip).limit(limit);
    }

    const faculty = await facultyQuery;
    const formatted = faculty.map((f) => f.toSafeObject());
    const totalPages = limit > 0 ? Math.ceil(totalRecords / limit) : 1;

    res.status(200).json({
      success: true,
      count: formatted.length,
      totalRecords,
      currentPage: page,
      totalPages,
      limit: limit || totalRecords,
      data: formatted
    });
  } catch (error) {
    console.error('Error fetching faculty:', error);
    res.status(500).json({ success: false, message: 'Server error fetching faculty.' });
  }
};

// @desc    Get single faculty by ID
// @route   GET /api/faculty/:id
// @access  Private
exports.getFacultyById = async (req, res) => {
  try {
    const faculty = await User.findOne({
      _id: req.params.id,
      role: { $in: ['faculty', 'teacher'] }
    }).populate({
      path: 'assignedSubjects.subject',
      select: '_id name code dept course type'
    });
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty member not found.' });
    }
    res.status(200).json({ success: true, data: faculty.toSafeObject() });
  } catch (error) {
    console.error('Error fetching faculty by ID:', error);
    res.status(500).json({ success: false, message: 'Server error fetching faculty.' });
  }
};

// @desc    Create new faculty member
// @route   POST /api/faculty
// @access  Private (Admin)
exports.createFaculty = async (req, res) => {
  try {
    const {
      name,
      username,
      email,
      department,
      semester,
      classSection,
      section,
      assignedSubject,
      assignedSubjects,
      password
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Faculty full name is required.' });
    }

    const cleanUsername = (username || name.trim().toLowerCase().replace(/\s+/g, '.')).trim();

    const existing = await User.findOne({
      $or: [
        { username: cleanUsername },
        ...(email ? [{ email: email.trim().toLowerCase() }] : [])
      ]
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Faculty with username/email '${cleanUsername}' already exists.`
      });
    }

    const resolvedDept = department || 'AIML';
    const resolvedSection = (classSection || section || 'A').trim();
    const resolvedSemester = semester || 'Semester 1';

    // Format assignedSubjects array if provided
    let formattedSubjects = [];
    if (Array.isArray(assignedSubjects) && assignedSubjects.length > 0) {
      formattedSubjects = assignedSubjects.map((as) => ({
        subject: as.subject?._id || as.subject,
        semester: Number(as.semester) || 1,
        course: (as.course || resolvedDept).trim(),
        classSection: (as.classSection || resolvedSection).trim()
      }));
    } else if (assignedSubject && assignedSubject.trim()) {
      // Find subject doc by name if possible
      const foundSub = await Subject.findOne({
        name: new RegExp(`^${assignedSubject.trim()}$`, 'i')
      });
      if (foundSub) {
        formattedSubjects.push({
          subject: foundSub._id,
          semester: parseInt(resolvedSemester.replace(/\D/g, ''), 10) || 1,
          course: resolvedDept,
          classSection: resolvedSection
        });
      }
    }

    // Password hashing
    const pwdToHash = password && password.trim() ? password.trim() : 'Faculty@123';
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(pwdToHash, salt);

    const faculty = await User.create({
      name: name.trim(),
      role: 'faculty',
      username: cleanUsername,
      email: email ? email.trim().toLowerCase() : `${cleanUsername}@campus.edu`,
      department: resolvedDept,
      semester: resolvedSemester,
      classSection: resolvedSection,
      section: resolvedSection,
      assignedSubject: (assignedSubject || '').trim(),
      assignedSubjects: formattedSubjects,
      passwordHash
    });

    // Sync to FacultySubjectAssignment for roster and attendance
    if (formattedSubjects.length > 0) {
      for (const item of formattedSubjects) {
        let subjName = assignedSubject || 'Subject';
        if (item.subject && mongoose.Types.ObjectId.isValid(item.subject)) {
          const subDoc = await Subject.findById(item.subject);
          if (subDoc?.name) subjName = subDoc.name;
        } else if (typeof item.subject === 'string' && item.subject.trim()) {
          const subDoc = await Subject.findOne({ name: new RegExp(`^${item.subject.trim()}$`, 'i') });
          if (subDoc?.name) subjName = subDoc.name;
        }
        await FacultySubjectAssignment.findOneAndUpdate(
          {
            facultyId: faculty._id,
            subject: subjName,
            department: item.course || resolvedDept,
            semester: item.semester,
            classSection: item.classSection || resolvedSection
          },
          {
            facultyId: faculty._id,
            facultyName: faculty.name,
            facultyUsername: faculty.username,
            department: item.course || resolvedDept,
            semester: item.semester,
            classSection: item.classSection || resolvedSection,
            subject: subjName,
            status: 'Active'
          },
          { upsert: true, new: true }
        );
      }
    } else if (assignedSubject && assignedSubject.trim()) {
      try {
        await FacultySubjectAssignment.findOneAndUpdate(
          {
            facultyId: faculty._id,
            subject: assignedSubject.trim(),
            department: resolvedDept,
            semester: resolvedSemester,
            division: resolvedSection
          },
          {
            facultyId: faculty._id,
            facultyName: faculty.name,
            facultyUsername: faculty.username,
            department: resolvedDept,
            semester: resolvedSemester,
            division: resolvedSection,
            subject: assignedSubject.trim(),
            status: 'active'
          },
          { upsert: true, new: true }
        );
      } catch (mappingErr) {
        console.warn('Academic mapping notice:', mappingErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Faculty created successfully.',
      data: faculty.toSafeObject()
    });
  } catch (error) {
    console.error('Error creating faculty:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error creating faculty.' });
  }
};

// @desc    Update faculty by ID
// @route   PUT /api/faculty/:id
// @access  Private (Admin)
exports.updateFaculty = async (req, res) => {
  try {
    const {
      name,
      username,
      email,
      department,
      semester,
      classSection,
      section,
      assignedSubject,
      assignedSubjects,
      password
    } = req.body;

    const faculty = await User.findOne({
      _id: req.params.id,
      role: { $in: ['faculty', 'teacher'] }
    });
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty member not found.' });
    }

    if (username && username.trim() !== faculty.username) {
      const cleanUsername = username.trim();
      const existing = await User.findOne({
        _id: { $ne: faculty._id },
        username: cleanUsername
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Username '${cleanUsername}' is already taken.`
        });
      }
      faculty.username = cleanUsername;
    }

    if (name) faculty.name = name.trim();
    if (email !== undefined) faculty.email = email.trim().toLowerCase();
    if (department) faculty.department = department;
    if (semester !== undefined) faculty.semester = semester;
    if (classSection !== undefined) {
      faculty.classSection = classSection.trim();
      faculty.section = classSection.trim();
    } else if (section !== undefined) {
      faculty.classSection = section.trim();
      faculty.section = section.trim();
    }
    if (assignedSubject !== undefined) faculty.assignedSubject = assignedSubject.trim();

    if (Array.isArray(assignedSubjects)) {
      faculty.assignedSubjects = assignedSubjects.map((as) => ({
        subject: as.subject?._id || as.subject,
        semester: Number(as.semester) || 1,
        course: (as.course || faculty.department || 'AIML').trim(),
        classSection: (as.classSection || faculty.classSection || 'A').trim()
      }));

      // Sync updated assignments
      for (const item of faculty.assignedSubjects) {
        let subjName = 'Subject';
        if (item.subject && mongoose.Types.ObjectId.isValid(item.subject)) {
          const subDoc = await Subject.findById(item.subject);
          if (subDoc?.name) subjName = subDoc.name;
        } else if (typeof item.subject === 'string' && item.subject.trim()) {
          const subDoc = await Subject.findOne({ name: new RegExp(`^${item.subject.trim()}$`, 'i') });
          if (subDoc?.name) subjName = subDoc.name;
        }
        await FacultySubjectAssignment.findOneAndUpdate(
          {
            facultyId: faculty._id,
            subject: subjName,
            department: item.course,
            semester: item.semester,
            classSection: item.classSection
          },
          {
            facultyId: faculty._id,
            facultyName: faculty.name,
            facultyUsername: faculty.username,
            department: item.course,
            semester: item.semester,
            classSection: item.classSection,
            subject: subjName,
            status: 'Active'
          },
          { upsert: true, new: true }
        );
      }
    }

    if (password && password.trim()) {
      const salt = await bcrypt.genSalt(10);
      faculty.passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    await faculty.save();

    // Sync academic mapping if assigned subject is updated
    if (faculty.assignedSubject) {
      try {
        await FacultySubjectAssignment.findOneAndUpdate(
          { facultyId: faculty._id },
          {
            facultyName: faculty.name,
            facultyUsername: faculty.username,
            department: faculty.department || 'AIML',
            semester: faculty.semester || 'Semester 1',
            division: faculty.classSection || 'A',
            subject: faculty.assignedSubject,
            status: 'active'
          },
          { upsert: true }
        );
      } catch (err) {
        console.warn('Academic mapping update notice:', err.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Faculty updated successfully.',
      data: faculty.toSafeObject()
    });
  } catch (error) {
    console.error('Error updating faculty:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error updating faculty.' });
  }
};

// @desc    Delete faculty by ID
// @route   DELETE /api/faculty/:id
// @access  Private (Admin)
exports.deleteFaculty = async (req, res) => {
  try {
    const faculty = await User.findOne({
      _id: req.params.id,
      role: { $in: ['faculty', 'teacher'] }
    });
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty member not found.' });
    }

    await User.findByIdAndDelete(req.params.id);
    // Optionally clean up assignments
    await FacultySubjectAssignment.deleteMany({ facultyId: req.params.id });

    res.status(200).json({
      success: true,
      message: `Faculty '${faculty.name}' was deleted successfully.`
    });
  } catch (error) {
    console.error('Error deleting faculty:', error);
    res.status(500).json({ success: false, message: 'Server error deleting faculty.' });
  }
};

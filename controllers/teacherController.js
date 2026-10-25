const User = require('../models/User');
const Subject = require('../models/Subject');
const FacultySubjectAssignment = require('../models/FacultySubjectAssignment');

/**
 * @desc    Get subjects allocated to the currently logged-in teacher based on assignedSubjects array
 * @route   GET /api/teacher/allocated-subjects
 * @access  Private (Teacher / Faculty / Admin)
 */
exports.getAllocatedSubjects = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No user identity found.'
      });
    }

    // 1. Fetch teacher record and populate subject details
    const teacher = await User.findById(userId).populate({
      path: 'assignedSubjects.subject',
      select: '_id name code dept course type credits'
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher profile not found.'
      });
    }

    let allocatedSubjects = [];

    // 2. Extract and format from new assignedSubjects array
    if (Array.isArray(teacher.assignedSubjects) && teacher.assignedSubjects.length > 0) {
      for (const item of teacher.assignedSubjects) {
        if (!item || !item.subject) continue;

        const subjectDoc = item.subject;
        const subjectId = subjectDoc._id || subjectDoc;
        const subjectName = subjectDoc.name || item.subjectName || 'Subject';
        const subjectCode = subjectDoc.code || '';
        const course = item.course || subjectDoc.course || subjectDoc.dept || teacher.department || 'All Departments';
        const semester = Number(item.semester) || 1;
        const classSection = item.classSection || teacher.classSection || 'A';

        // Auto-sync into FacultySubjectAssignment so daily attendance roster lookup works smoothly
        let syncedAssignment;
        try {
          syncedAssignment = await FacultySubjectAssignment.findOneAndUpdate(
            {
              facultyId: teacher._id,
              subject: subjectName,
              semester: semester,
              department: course,
              classSection: classSection
            },
            {
              facultyId: teacher._id,
              facultyName: teacher.name,
              facultyUsername: teacher.username || '',
              department: course,
              semester: semester,
              classSection: classSection,
              subject: subjectName,
              subjectCode: subjectCode,
              status: 'Active'
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch (syncErr) {
          console.warn('Assignment sync notice:', syncErr.message);
        }

        allocatedSubjects.push({
          _id: syncedAssignment?._id || item._id,
          assignmentId: syncedAssignment?._id || item._id,
          subDocId: item._id,
          subject: {
            _id: subjectId,
            name: subjectName,
            code: subjectCode,
            type: subjectDoc.type || 'Core',
            dept: subjectDoc.dept || course,
            course: subjectDoc.course || course
          },
          subjectName: subjectName,
          subjectCode: subjectCode,
          semester: semester,
          course: course,
          department: course,
          classSection: classSection
        });
      }
    }

    // 3. Fallback: If assignedSubjects array is empty, check legacy FacultySubjectAssignment
    if (allocatedSubjects.length === 0) {
      const legacyAssignments = await FacultySubjectAssignment.find({
        $or: [
          { facultyId: teacher._id },
          ...(teacher.username ? [{ facultyUsername: teacher.username }] : []),
          ...(teacher.name ? [{ facultyName: teacher.name }] : [])
        ],
        status: { $ne: 'Inactive' }
      }).sort({ semester: 1, subject: 1 });

      if (legacyAssignments.length > 0) {
        allocatedSubjects = legacyAssignments.map((a) => ({
          _id: a._id,
          assignmentId: a._id,
          subject: {
            name: a.subject,
            code: a.subjectCode || '',
            dept: a.department,
            course: a.department
          },
          subjectName: a.subject,
          subjectCode: a.subjectCode || '',
          semester: a.semester,
          course: a.department,
          department: a.department,
          classSection: a.classSection || 'General'
        }));
      }
    }

    // 4. Fallback 2: Check legacy single assignedSubject field on user
    if (allocatedSubjects.length === 0 && teacher.assignedSubject) {
      allocatedSubjects.push({
        _id: teacher._id,
        assignmentId: teacher._id,
        subject: {
          name: teacher.assignedSubject,
          dept: teacher.department,
          course: teacher.department
        },
        subjectName: teacher.assignedSubject,
        subjectCode: '',
        semester: Number(teacher.semester) || 1,
        course: teacher.department || 'All Departments',
        department: teacher.department || 'All Departments',
        classSection: teacher.classSection || 'A'
      });
    }

    res.status(200).json({
      success: true,
      count: allocatedSubjects.length,
      data: allocatedSubjects
    });
  } catch (error) {
    console.error('Error fetching allocated subjects for teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving teacher allocated subjects.'
    });
  }
};

/**
 * @desc    Assign multiple subjects across multiple semesters to a teacher (Admin action)
 * @route   POST /api/teacher/assign-subjects
 * @access  Private (Admin)
 */
exports.assignSubjects = async (req, res) => {
  try {
    const { teacherId, assignedSubjects } = req.body;

    if (!teacherId) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID is required.'
      });
    }

    if (!Array.isArray(assignedSubjects)) {
      return res.status(400).json({
        success: false,
        message: 'assignedSubjects must be an array of { subject, semester, course, classSection } objects.'
      });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found.'
      });
    }

    // Validate each subject item
    const formatted = [];
    for (const item of assignedSubjects) {
      if (!item.subject) {
        return res.status(400).json({
          success: false,
          message: 'Each assigned subject must have a valid subject ID.'
        });
      }
      formatted.push({
        subject: item.subject,
        semester: Number(item.semester) || 1,
        course: (item.course || teacher.department || 'All Departments').trim(),
        classSection: (item.classSection || 'A').trim()
      });
    }

    teacher.assignedSubjects = formatted;
    await teacher.save();

    // Populate for response
    await teacher.populate({
      path: 'assignedSubjects.subject',
      select: '_id name code dept course type'
    });

    res.status(200).json({
      success: true,
      message: 'Subjects successfully allocated to teacher.',
      data: teacher.toSafeObject()
    });
  } catch (error) {
    console.error('Error assigning subjects to teacher:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error allocating subjects.'
    });
  }
};

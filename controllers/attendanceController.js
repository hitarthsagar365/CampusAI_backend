const Attendance = require('../models/Attendance');
const AttendanceSession = require('../models/AttendanceSession');
const FacultySubjectAssignment = require('../models/FacultySubjectAssignment');
const User = require('../models/User');
const Subject = require('../models/Subject');
const { normalizeSemester, getSemesterQueryFilter } = require('../utils/academicHelper');

// Helper to format today's date as YYYY-MM-DD in IST
const getTodayIST = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().split('T')[0];
};

// ============================================================================
// 1. FACULTY: GET MY ASSIGNED SUBJECTS
// ============================================================================
// @desc    Get all subjects assigned to logged-in faculty (or all for admin)
// @route   GET /api/attendance/my-subjects
// @access  Private (Faculty / Admin)
exports.getMySubjects = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    let filter = { status: 'Active' };

    if (userRole !== 'admin') {
      // If user has assignedSubjects array, ensure synced to FacultySubjectAssignment
      if (Array.isArray(req.user.assignedSubjects) && req.user.assignedSubjects.length > 0) {
        for (const item of req.user.assignedSubjects) {
          if (!item || !item.subject) continue;
          let subjName = item.subjectName;
          let subjCode = '';
          if (!subjName) {
            const sDoc = await Subject.findById(item.subject);
            subjName = sDoc?.name || 'Subject';
            subjCode = sDoc?.code || '';
          }
          await FacultySubjectAssignment.findOneAndUpdate(
            {
              facultyId: req.user._id,
              subject: subjName,
              semester: Number(item.semester) || 1,
              department: item.course || req.user.department || 'AIML'
            },
            {
              facultyId: req.user._id,
              facultyName: req.user.name,
              facultyUsername: req.user.username || '',
              department: item.course || req.user.department || 'AIML',
              semester: Number(item.semester) || 1,
              classSection: item.classSection || 'A',
              subject: subjName,
              subjectCode: subjCode,
              status: 'Active'
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      }

      // Match by facultyId OR facultyName / facultyUsername
      filter.$or = [
        { facultyId: req.user._id },
        { facultyUsername: req.user.username },
        { facultyName: req.user.name }
      ];
    }

    const assignments = await FacultySubjectAssignment.find(filter).sort({ department: 1, semester: 1, subject: 1 });

    res.status(200).json({
      success: true,
      count: assignments.length,
      data: assignments
    });
  } catch (error) {
    console.error('Error fetching faculty subjects:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving faculty subjects.'
    });
  }
};

// ============================================================================
// 2. FACULTY: GET STUDENT ROSTER FOR ASSIGNED SUBJECT ON A SPECIFIC DATE
// ============================================================================
// @desc    Get student roster for authorized subject + date (pre-fills existing if marked)
// @route   GET /api/attendance/roster
// @access  Private (Faculty / Admin)
exports.getSubjectRoster = async (req, res) => {
  try {
    const { assignmentId, date } = req.query;
    if (!assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required.'
      });
    }

    const lectureDate = (date || getTodayIST()).trim();

    // 1. Verify Assignment
    let assignment = await FacultySubjectAssignment.findById(assignmentId);
    if (!assignment) {
      // Check if assignmentId is a subdocument ID from assignedSubjects on User/Teacher
      const user = await User.findOne({
        $or: [
          { 'assignedSubjects._id': assignmentId },
          { _id: assignmentId }
        ]
      }).populate('assignedSubjects.subject');

      if (user && Array.isArray(user.assignedSubjects)) {
        const subDoc = user.assignedSubjects.id ? user.assignedSubjects.id(assignmentId) : user.assignedSubjects.find(s => s._id?.toString() === assignmentId.toString());
        const target = subDoc || user.assignedSubjects[0];
        if (target) {
          const sName = target.subject?.name || target.subjectName || 'Subject';
          const deptCourse = target.course || user.department || 'AIML';
          assignment = await FacultySubjectAssignment.findOneAndUpdate(
            {
              facultyId: user._id,
              subject: sName,
              semester: Number(target.semester) || 1,
              department: deptCourse
            },
            {
              facultyId: user._id,
              facultyName: user.name,
              facultyUsername: user.username || '',
              department: deptCourse,
              semester: Number(target.semester) || 1,
              classSection: target.classSection || 'A',
              subject: sName,
              status: 'Active'
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      }
    }

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Faculty subject assignment not found.'
      });
    }

    // 2. Authorization Check: Faculty must teach this assignment (Admin is exempted)
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'admin') {
      const isOwner =
        assignment.facultyId.toString() === req.user._id.toString() ||
        (assignment.facultyUsername && assignment.facultyUsername === req.user.username) ||
        assignment.facultyName === req.user.name;

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You are not authorized to view the roster for another faculty member.'
        });
      }
    }

    // 3. Find ONLY students matching Department + Semester
    const semNum = normalizeSemester(assignment.semester) || assignment.semester;
    const semFilter = getSemesterQueryFilter(semNum);

    const escapedDept = (assignment.department || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const studentFilter = {
      role: { $in: ['student', 'Student'] },
      $or: [
        { department: { $regex: new RegExp(`^${escapedDept}$`, 'i') } },
        { course: { $regex: new RegExp(`^${escapedDept}$`, 'i') } }
      ]
    };

    if (Object.keys(semFilter).length > 0) {
      studentFilter.semester = semFilter;
    }

    const students = await User.find(studentFilter)
      .select('name enrollment email department semester classSection section')
      .sort({ enrollment: 1, name: 1 });

    const cleanSection = (assignment.classSection || '').trim().replace(/^Section\s+/i, '');
    const filteredStudents = cleanSection && cleanSection !== 'General'
      ? students.filter((s) => {
          const sSec = (s.classSection || s.section || '').trim().replace(/^Section\s+/i, '');
          if (sSec) {
            return sSec.toLowerCase() === cleanSection.toLowerCase();
          }
          return true;
        })
      : students;

    // 4. Check if an AttendanceSession already exists on this date
    const existingSession = await AttendanceSession.findOne({
      assignmentId: assignment._id,
      date: lectureDate
    });

    let existingRecordsMap = new Map();
    if (existingSession) {
      const records = await Attendance.find({
        subject: assignment.subject,
        department: assignment.department,
        semester: semNum,
        date: lectureDate
      });
      records.forEach((r) => {
        existingRecordsMap.set(r.enrollment.toLowerCase(), r.status);
      });
    }

    // 5. Build Roster with status
    const roster = filteredStudents.map((student) => {
      const enrollLower = (student.enrollment || '').toLowerCase();
      const existingStatus = existingRecordsMap.get(enrollLower);
      return {
        studentId: student._id,
        studentName: student.name,
        enrollment: student.enrollment,
        department: student.department || assignment.department,
        semester: semNum,
        status: existingStatus || 'Present'
      };
    });

    const presentCount = roster.filter((r) => r.status === 'Present').length;
    const absentCount = roster.filter((r) => r.status === 'Absent').length;

    res.status(200).json({
      success: true,
      assignment,
      date: lectureDate,
      isExisting: Boolean(existingSession),
      session: existingSession || null,
      stats: {
        totalStudents: roster.length,
        presentCount,
        absentCount
      },
      roster,
      students: roster
    });
  } catch (error) {
    console.error('Error fetching subject roster:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving student roster.'
    });
  }
};

// ============================================================================
// 3. FACULTY: SAVE / UPDATE ATTENDANCE SESSION FOR A DATE
// ============================================================================
// @desc    Record/Update daily attendance session and students roster
// @route   POST /api/attendance/session
// @access  Private (Faculty / Admin)
exports.saveAttendanceSession = async (req, res) => {
  try {
    const { assignmentId, date, records, lectureTopic } = req.body;

    if (!assignmentId || !date || !Array.isArray(records)) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID, date, and student records are required.'
      });
    }

    const lectureDate = date.trim();

    // 1. Verify Assignment
    const assignment = await FacultySubjectAssignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Faculty subject assignment not found.'
      });
    }

    // 2. Authorization Check
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'admin') {
      const isOwner =
        assignment.facultyId.toString() === req.user._id.toString() ||
        (assignment.facultyUsername && assignment.facultyUsername === req.user.username) ||
        assignment.facultyName === req.user.name;

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You cannot mark attendance for another faculty member.'
        });
      }
    }

    const semNum = normalizeSemester(assignment.semester) || assignment.semester;
    const presentCount = records.filter((r) => r.status === 'Present').length;
    const absentCount = records.filter((r) => r.status === 'Absent').length;

    // 3. Upsert AttendanceSession record (prevents duplicates)
    const session = await AttendanceSession.findOneAndUpdate(
      {
        assignmentId: assignment._id,
        date: lectureDate
      },
      {
        $set: {
          facultyId: req.user._id,
          facultyName: req.user.name || assignment.facultyName,
          subject: assignment.subject,
          department: assignment.department,
          semester: semNum,
          classSection: assignment.classSection,
          date: lectureDate,
          lectureTopic: lectureTopic || '',
          totalStudents: records.length,
          presentCount,
          absentCount
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 4. Upsert individual student attendance records
    for (const rec of records) {
      if (!rec.enrollment) continue;
      const cleanEnroll = rec.enrollment.trim();
      const status = rec.status === 'Absent' ? 'Absent' : 'Present';

      await Attendance.findOneAndUpdate(
        {
          subject: assignment.subject,
          department: assignment.department,
          semester: semNum,
          date: lectureDate,
          enrollment: cleanEnroll
        },
        {
          $set: {
            sessionId: session._id,
            studentId: rec.studentId || undefined,
            student: (rec.studentName || cleanEnroll).trim(),
            enrollment: cleanEnroll,
            subject: assignment.subject,
            department: assignment.department,
            semester: semNum,
            classSection: assignment.classSection,
            date: lectureDate,
            status,
            facultyId: req.user._id,
            markedBy: req.user.name || assignment.facultyName
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Attendance saved successfully.',
      session,
      stats: {
        totalStudents: records.length,
        presentCount,
        absentCount
      }
    });
  } catch (error) {
    console.error('Error saving attendance session:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error saving attendance.'
    });
  }
};

// ============================================================================
// 4. STUDENT: GET MY SUBJECT-WISE ATTENDANCE SUMMARY & PERCENTAGES
// ============================================================================
// @desc    Get logged-in student's subject-wise attendance summary and history
// @route   GET /api/attendance/my
// @access  Private (Student)
exports.getMyAttendance = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'student' && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Only students can view personal attendance.'
      });
    }

    const studentEnrollment = (req.user?.enrollment || '').trim();
    if (!studentEnrollment) {
      return res.status(400).json({
        success: false,
        message: 'Student enrollment number is missing from user profile.'
      });
    }

    const studentDept = req.user.department || req.user.course || 'AIML';
    const studentSem = normalizeSemester(req.user.semester) || 7;
    const studentSection = (req.user.classSection || req.user.section || '').trim().replace(/^Section\s+/i, '');

    // 1. Get all assigned subjects for student's department + semester
    const assignedSubjects = await FacultySubjectAssignment.find({
      department: studentDept,
      status: 'Active'
    });

    const relevantAssignments = assignedSubjects.filter((a) => {
      const matchSem = (normalizeSemester(a.semester) || a.semester) === studentSem;
      if (!matchSem) return false;
      const assignSec = (a.classSection || '').trim().replace(/^Section\s+/i, '');
      if (assignSec && studentSection && assignSec !== 'General') {
        return assignSec.toLowerCase() === studentSection.toLowerCase();
      }
      return true;
    });

    // 2. Fetch all student's attendance records from MongoDB
    const studentRecords = await Attendance.find({
      enrollment: { $regex: new RegExp(`^${studentEnrollment}$`, 'i') }
    }).sort({ date: -1 });

    // Map records by subject (case-insensitive)
    const recordsBySubject = new Map();
    studentRecords.forEach((rec) => {
      const key = (rec.subject || '').trim().toLowerCase();
      if (!key) return;
      if (!recordsBySubject.has(key)) {
        recordsBySubject.set(key, []);
      }
      recordsBySubject.get(key).push(rec);
    });

    // Pre-fetch verified faculty list to ensure students are NEVER displayed as faculty
    const verifiedFaculty = await User.find({ role: { $in: ['faculty', 'teacher'] } }).select('name username _id');
    const facultyNamesSet = new Set(verifiedFaculty.map(f => f.name.toLowerCase()));

    // 3. Build summary per assigned subject
    const handledSubjectKeys = new Set();
    const summary = relevantAssignments.map((assignment) => {
      const key = assignment.subject.trim().toLowerCase();
      handledSubjectKeys.add(key);

      const records = recordsBySubject.get(key) || [];
      const presentCount = records.filter((r) => r.status === 'Present').length;
      const absentCount = records.filter((r) => r.status === 'Absent').length;
      const totalLectures = presentCount + absentCount;
      const percentage =
        totalLectures > 0 ? ((presentCount / totalLectures) * 100).toFixed(2) + '%' : '0.00%';

      const dailyHistory = records
        .slice()
        .reverse()
        .map((r, idx) => {
          const markedByName = (r.markedBy || '').trim();
          const isMarkedByFaculty = markedByName && facultyNamesSet.has(markedByName.toLowerCase());
          return {
            id: r._id,
            date: r.date,
            lecture: `Lecture ${idx + 1}`,
            status: r.status,
            markedBy: isMarkedByFaculty ? r.markedBy : assignment.facultyName
          };
        })
        .reverse();

      return {
        assignmentId: assignment._id,
        subject: assignment.subject,
        subjectCode: assignment.subjectCode || '',
        facultyName: assignment.facultyName,
        department: assignment.department,
        semester: assignment.semester,
        totalLectures,
        present: presentCount,
        absent: absentCount,
        percentage,
        percentageNumber: totalLectures > 0 ? (presentCount / totalLectures) * 100 : 0,
        dailyHistory
      };
    });

    // 4. Include any other subjects student has records in (fallback support)
    // ONLY display verified faculty names, NEVER student names
    for (const [key, records] of recordsBySubject.entries()) {
      if (!handledSubjectKeys.has(key) && records.length > 0) {
        const first = records[0];
        const presentCount = records.filter((r) => r.status === 'Present').length;
        const absentCount = records.filter((r) => r.status === 'Absent').length;
        const totalLectures = presentCount + absentCount;
        const percentage =
          totalLectures > 0 ? ((presentCount / totalLectures) * 100).toFixed(2) + '%' : '0.00%';

        // Resolve real faculty: check FacultySubjectAssignment or verified faculty
        const matchingAssignment = await FacultySubjectAssignment.findOne({
          subject: { $regex: new RegExp(`^${first.subject.trim()}$`, 'i') },
          status: 'Active'
        });

        let resolvedFacultyName = 'Faculty';
        if (matchingAssignment?.facultyName) {
          resolvedFacultyName = matchingAssignment.facultyName;
        } else if (first.markedBy && facultyNamesSet.has(first.markedBy.toLowerCase())) {
          resolvedFacultyName = first.markedBy;
        }

        const dailyHistory = records
          .slice()
          .reverse()
          .map((r, idx) => {
            const markedByName = (r.markedBy || '').trim();
            const isFaculty = markedByName && facultyNamesSet.has(markedByName.toLowerCase());
            return {
              id: r._id,
              date: r.date,
              lecture: `Lecture ${idx + 1}`,
              status: r.status,
              markedBy: isFaculty ? r.markedBy : resolvedFacultyName
            };
          })
          .reverse();

        summary.push({
          assignmentId: matchingAssignment?._id || null,
          subject: first.subject,
          subjectCode: matchingAssignment?.subjectCode || '',
          facultyName: resolvedFacultyName,
          department: first.department || studentDept,
          semester: first.semester || studentSem,
          totalLectures,
          present: presentCount,
          absent: absentCount,
          percentage,
          percentageNumber: totalLectures > 0 ? (presentCount / totalLectures) * 100 : 0,
          dailyHistory
        });
      }
    }

    // Compute overall institution metrics for student
    const totalConducted = summary.reduce((acc, curr) => acc + curr.totalLectures, 0);
    const totalAttended = summary.reduce((acc, curr) => acc + curr.present, 0);
    const totalMissed = summary.reduce((acc, curr) => acc + curr.absent, 0);
    const overallPercentage =
      totalConducted > 0 ? ((totalAttended / totalConducted) * 100).toFixed(2) + '%' : '0.00%';

    res.status(200).json({
      success: true,
      student: {
        id: req.user._id,
        name: req.user.name,
        enrollment: studentEnrollment,
        department: studentDept,
        semester: studentSem
      },
      overallStats: {
        totalConducted,
        totalAttended,
        totalMissed,
        overallPercentage
      },
      summary
    });
  } catch (error) {
    console.error('Error fetching student attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving student attendance summary.'
    });
  }
};

// ============================================================================
// 5. ADMIN / MANAGEMENT: ACADEMIC MAPPING & OVERVIEW
// ============================================================================
// @desc    Get all faculty subject assignments (Admin)
// @route   GET /api/attendance/assignments
// @access  Private (Admin)
exports.getAllAssignments = async (req, res) => {
  try {
    const { department, semester } = req.query;
    let query = {};
    if (department && department !== 'All Departments') query.department = department;
    if (semester) query.semester = normalizeSemester(semester) || semester;

    const assignments = await FacultySubjectAssignment.find(query).sort({ department: 1, semester: 1, subject: 1 });
    res.status(200).json({
      success: true,
      count: assignments.length,
      data: assignments
    });
  } catch (error) {
    console.error('Error fetching all assignments:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching faculty assignments.'
    });
  }
};

// @desc    Create a new faculty subject assignment (Admin)
// @route   POST /api/attendance/assignments
// @access  Private (Admin)
exports.createFacultyAssignment = async (req, res) => {
  try {
    const { facultyId, facultyName, subject, subjectCode, department, semester, classSection } = req.body;

    if (!subject || !department || !semester) {
      return res.status(400).json({
        success: false,
        message: 'Subject, Department, and Semester are required.'
      });
    }

    let resolvedFacultyId = facultyId;
    let resolvedFacultyName = facultyName;
    let resolvedFacultyUsername = '';

    if (facultyId) {
      const fac = await User.findOne({
        _id: facultyId,
        role: { $in: ['faculty', 'teacher'] }
      });
      if (fac) {
        resolvedFacultyName = fac.name;
        resolvedFacultyUsername = fac.username || '';
      } else {
        return res.status(400).json({
          success: false,
          message: 'The selected user is not a valid faculty member. Students cannot be assigned to teach.'
        });
      }
    } else if (facultyName) {
      const fac = await User.findOne({
        role: { $in: ['faculty', 'teacher'] },
        name: { $regex: new RegExp(`^${facultyName.trim()}$`, 'i') }
      });
      if (fac) {
        resolvedFacultyId = fac._id;
        resolvedFacultyName = fac.name;
        resolvedFacultyUsername = fac.username || '';
      }
    }

    if (!resolvedFacultyId) {
      return res.status(400).json({
        success: false,
        message: 'A valid faculty member must be assigned.'
      });
    }

    const semNum = normalizeSemester(semester) || 7;

    const assignment = await FacultySubjectAssignment.findOneAndUpdate(
      {
        facultyId: resolvedFacultyId,
        subject: subject.trim(),
        department: department.trim(),
        semester: semNum
      },
      {
        $set: {
          facultyName: resolvedFacultyName,
          facultyUsername: resolvedFacultyUsername,
          subject: subject.trim(),
          subjectCode: subjectCode ? subjectCode.trim() : '',
          department: department.trim(),
          semester: semNum,
          classSection: classSection ? classSection.trim() : `${department} - Sem ${semNum}`,
          status: 'Active'
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await User.findByIdAndUpdate(resolvedFacultyId, {
      department: department.trim(),
      semester: String(semNum),
      classSection: classSection ? classSection.trim() : 'A',
      section: classSection ? classSection.trim() : 'A',
      assignedSubject: subject.trim()
    });

    res.status(201).json({
      success: true,
      message: 'Faculty subject assignment created successfully.',
      data: assignment
    });
  } catch (error) {
    console.error('Error creating faculty assignment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error creating faculty assignment.'
    });
  }
};

// ============================================================================
// 6. LEGACY COMPATIBILITY ENDPOINTS (Safe fallback for any existing modules)
// ============================================================================
exports.getAttendance = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const { enrollment, student, subject, date, department } = req.query;
    let query = {};

    // 1. Role Scoping: Students MUST ONLY see their own attendance records
    if (userRole === 'student') {
      const studentEnrollment = (req.user?.enrollment || '').trim();
      if (!studentEnrollment) {
        return res.status(200).json({ success: true, count: 0, data: [] });
      }
      query.$or = [
        { enrollment: { $regex: new RegExp(`^${studentEnrollment}$`, 'i') } },
        { student: { $regex: new RegExp(`^${studentEnrollment}$`, 'i') } }
      ];
    } else if (userRole === 'faculty' || userRole === 'teacher') {
      // Faculty scopes to their department and assigned subject by default
      if (req.user.assignedSubject && !subject) {
        query.subject = { $regex: new RegExp(`^${req.user.assignedSubject.trim()}$`, 'i') };
      }
      if (req.user.department && !department && req.user.department !== 'All Departments') {
        query.department = req.user.department;
      }
      if (enrollment) {
        query.enrollment = { $regex: new RegExp(enrollment.trim(), 'i') };
      }
    } else {
      // Admin or explicit filter
      if (enrollment) {
        query.$or = [
          { enrollment: { $regex: new RegExp(enrollment.trim(), 'i') } },
          { student: { $regex: new RegExp(enrollment.trim(), 'i') } }
        ];
      } else if (student) {
        query.student = { $regex: new RegExp(student.trim(), 'i') };
      }
    }

    if (subject) {
      query.subject = { $regex: new RegExp(subject.trim(), 'i') };
    }

    if (date) {
      query.date = date;
    }

    if (department && department !== 'All Departments') {
      query.department = department;
    }

    const records = await Attendance.find(query).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching attendance.'
    });
  }
};

exports.createAttendance = async (req, res) => {
  try {
    const { student, enrollment, subject, date, status, department, markedBy } = req.body;

    if (!student || !subject || !date || !status) {
      return res.status(400).json({
        success: false,
        message: 'Student, subject, date, and status are required.'
      });
    }

    const record = await Attendance.create({
      student: student.trim(),
      enrollment: (enrollment || student).trim(),
      subject: subject.trim(),
      date,
      status,
      department: department || '',
      markedBy: markedBy || req.user?.name || 'Teacher'
    });

    res.status(201).json({
      success: true,
      message: 'Attendance record created successfully.',
      data: record
    });
  } catch (error) {
    console.error('Error creating attendance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error creating attendance.'
    });
  }
};

exports.deleteAttendance = async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found.'
      });
    }

    await Attendance.findByIdAndDelete(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Attendance record deleted successfully.'
    });
  } catch (error) {
    console.error('Error deleting attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting attendance.'
    });
  }
};

const Mark = require('../models/Mark');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const FacultySubjectAssignment = require('../models/FacultySubjectAssignment');

// Helper to escape regex special characters
const escapeRegex = (str = '') => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Helper to extract clean numerical marks and max marks
const parseMarkRecord = (record) => {
  const isAbsent =
    (record.attendanceStatus || '').toLowerCase() === 'absent' ||
    String(record.marksObtained || '').trim().toUpperCase() === 'AB' ||
    String(record.score || '').trim().toUpperCase() === 'AB';

  let max = Number(record.maxMarks) || 30;
  let obtained = 0;

  if (isAbsent) {
    obtained = 0;
  } else {
    const rawObtained = String(record.marksObtained || '').trim();
    if (rawObtained && !isNaN(parseFloat(rawObtained))) {
      obtained = parseFloat(rawObtained);
    } else {
      // Fallback: parse score string like "28/30" or "75/A"
      const scoreParts = String(record.score || '').split('/');
      if (scoreParts.length > 0 && !isNaN(parseFloat(scoreParts[0]))) {
        obtained = parseFloat(scoreParts[0]);
        if (scoreParts.length > 1 && !isNaN(parseFloat(scoreParts[1]))) {
          max = parseFloat(scoreParts[1]);
        }
      }
    }
  }

  // Cap obtained between 0 and max
  obtained = Math.max(0, Math.min(obtained, max));
  const percentage = max > 0 ? Number(((obtained / max) * 100).toFixed(1)) : 0;

  // Grade calculation fallback if grade is missing
  let grade = record.grade || '';
  if (!grade || grade === '—') {
    if (isAbsent) grade = 'AB';
    else if (percentage >= 90) grade = 'A+';
    else if (percentage >= 80) grade = 'A';
    else if (percentage >= 70) grade = 'B+';
    else if (percentage >= 60) grade = 'B';
    else if (percentage >= 50) grade = 'C';
    else if (percentage >= 40) grade = 'D';
    else grade = 'F';
  }

  return {
    id: record._id?.toString() || record.id,
    student: record.student,
    enrollment: record.enrollment,
    subject: record.subject,
    exam: record.exam,
    maxMarks: max,
    marksObtained: isAbsent ? 'AB' : obtained,
    numericMarks: obtained,
    percentage,
    grade,
    isAbsent,
    attendanceStatus: isAbsent ? 'Absent' : 'Present',
    department: record.department || '',
    semester: record.semester || '',
    division: record.division || '',
    academicYear: record.academicYear || '2026-2027',
    enteredBy: record.enteredBy || 'Faculty',
    createdAt: record.createdAt
  };
};

/**
 * Helper to fetch all subjects assigned to a faculty member
 */
const getFacultyAssignedSubjects = async (user) => {
  const subjectsSet = new Set();

  if (user.assignedSubject && user.assignedSubject.trim()) {
    subjectsSet.add(user.assignedSubject.trim());
  }

  const assignments = await FacultySubjectAssignment.find({
    $or: [
      { facultyId: user._id },
      { facultyUsername: user.username },
      { facultyName: user.name }
    ],
    status: 'Active'
  });

  for (const a of assignments) {
    if (a.subject && a.subject.trim()) {
      subjectsSet.add(a.subject.trim());
    }
  }

  return Array.from(subjectsSet);
};

// =============================================================================
// 1. GET /api/marks/analytics/student-performance
// Strict RBAC: Student (own data only), Faculty (own subject only), Admin (full access)
// =============================================================================
exports.getStudentPerformanceAnalytics = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const isStudent = userRole === 'student';
    const isFaculty = userRole === 'faculty' || userRole === 'teacher';
    const isAdmin = userRole === 'admin';

    let targetEnrollment = '';
    let filteredSubject = (req.query.subject || '').trim();

    // -------------------------------------------------------------------------
    // RBAC Enforcements
    // -------------------------------------------------------------------------
    if (isStudent) {
      // Rule: Student can ONLY view their own evaluation records. Ignore any passed enrollment parameter.
      targetEnrollment = (req.user?.enrollment || '').trim();
      if (!targetEnrollment) {
        return res.status(400).json({
          success: false,
          message: 'Student account has no registered enrollment number. Please contact the administrator.'
        });
      }
    } else if (isFaculty) {
      // Rule: Faculty can only see subjects they teach.
      const allowedSubjects = await getFacultyAssignedSubjects(req.user);

      if (allowedSubjects.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You currently have no assigned subjects. Please contact the department head.'
        });
      }

      if (filteredSubject) {
        const hasAccess = allowedSubjects.some(
          (s) => s.toLowerCase() === filteredSubject.toLowerCase()
        );
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: `Access Denied: You are not authorized to view performance data for '${filteredSubject}'. You can only view subjects you teach.`
          });
        }
      } else {
        filteredSubject = allowedSubjects[0]; // Default to faculty's primary subject
      }

      // Target student for faculty
      if (req.query.enrollment) {
        targetEnrollment = req.query.enrollment.trim();
      } else {
        // Find first student having marks in this faculty subject
        const firstMark = await Mark.findOne({
          subject: { $regex: new RegExp(`^${escapeRegex(filteredSubject)}$`, 'i') }
        });
        targetEnrollment = firstMark?.enrollment || '';
      }
    } else if (isAdmin) {
      // Rule: Admin has global access.
      if (req.query.enrollment) {
        targetEnrollment = req.query.enrollment.trim();
      } else {
        // Pick first student in system for default view
        const firstStudent = await User.findOne({ role: 'student' }).sort({ name: 1 });
        targetEnrollment = firstStudent?.enrollment || '';
      }
    }

    if (!targetEnrollment) {
      return res.status(200).json({
        success: true,
        role: userRole,
        student: null,
        metrics: {
          overallPercentage: 0,
          cgpa: 0,
          totalMarksObtained: 0,
          totalMaxMarks: 0,
          totalEvaluations: 0,
          strongestSubject: { name: 'N/A', percentage: 0, grade: '—' },
          weakestSubject: { name: 'N/A', percentage: 0, grade: '—' },
          attendance: { percentage: 0, attended: 0, totalSessions: 0, absent: 0 }
        },
        summary: {
          cgpa: 0,
          gpa: 0,
          overallPercentage: 0,
          totalSubjects: 0,
          totalEvaluations: 0
        },
        currentSemester: '',
        currentSemesterSubjects: [],
        semesterTrends: [],
        performanceTrend: [],
        facultyComparison: null,
        detailedMarks: []
      });
    }

    // Fetch Student User Profile
    const studentUser = await User.findOne({
      $or: [
        { enrollment: targetEnrollment },
        { username: targetEnrollment },
        { name: targetEnrollment }
      ]
    });

    const studentInfo = {
      name: studentUser?.name || targetEnrollment,
      enrollment: studentUser?.enrollment || targetEnrollment,
      department: studentUser?.department || '',
      semester: studentUser?.semester || '',
      classSection: studentUser?.classSection || '',
      course: studentUser?.course || ''
    };

    // -------------------------------------------------------------------------
    // Query Marks from DB
    // -------------------------------------------------------------------------
    const markQuery = {
      $or: [
        { enrollment: { $regex: new RegExp(`^${escapeRegex(targetEnrollment)}$`, 'i') } },
        { student: { $regex: new RegExp(`^${escapeRegex(targetEnrollment)}$`, 'i') } }
      ]
    };

    if (studentUser?.name) {
      markQuery.$or.push({
        student: { $regex: new RegExp(`^${escapeRegex(studentUser.name)}$`, 'i') }
      });
    }

    // For faculty view: restrict marks specifically to faculty's subject(s)
    if (isFaculty && filteredSubject) {
      markQuery.subject = { $regex: new RegExp(`^${escapeRegex(filteredSubject)}$`, 'i') };
    }

    const rawMarks = await Mark.find(markQuery).sort({ semester: 1, createdAt: 1 });
    const parsedMarks = rawMarks.map(parseMarkRecord);

    // -------------------------------------------------------------------------
    // Aggregation 1: Key Metric Cards & Semester SGPAs
    // -------------------------------------------------------------------------
    const validMarks = parsedMarks.filter((m) => !m.isAbsent);
    const totalObtained = validMarks.reduce((acc, m) => acc + m.numericMarks, 0);
    const totalMax = validMarks.reduce((acc, m) => acc + m.maxMarks, 0);
    const overallPercentage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;

    // Calculate Semester-wise Breakdown and SGPAs (strictly bounded to [0, 10.0])
    const semesterMap = {};
    for (const m of parsedMarks) {
      const semKey = m.semester || studentInfo.semester || 'General';
      if (!semesterMap[semKey]) {
        semesterMap[semKey] = {
          semester: semKey,
          totalObtained: 0,
          totalMax: 0,
          examsCount: 0
        };
      }
      if (!m.isAbsent) {
        semesterMap[semKey].totalObtained += m.numericMarks;
        semesterMap[semKey].totalMax += m.maxMarks;
      }
      semesterMap[semKey].examsCount++;
    }

    const semesterTrends = Object.values(semesterMap)
      .map((s) => {
        const semNum = parseInt(String(s.semester).replace(/\D/g, ''), 10) || 0;
        const pct = s.totalMax > 0 ? Number(((s.totalObtained / s.totalMax) * 100).toFixed(1)) : 0;
        // Semester SGPA capped strictly at 10.0 scale using Math.min
        const rawSgpa = pct > 0 ? Number((pct / 9.5).toFixed(2)) : 0;
        const sgpa = Number(Math.min(Math.max(rawSgpa, 0), 10.0).toFixed(2));
        return {
          semester: s.semester,
          label: `Sem ${semNum || s.semester}`,
          semOrder: semNum,
          percentage: pct,
          sgpa,
          totalObtained: s.totalObtained,
          totalMax: s.totalMax,
          examsCount: s.examsCount
        };
      })
      .sort((a, b) => a.semOrder - b.semOrder);

    // Calculate CGPA by averaging SGPAs across evaluated semesters (or fallback to overallPercentage)
    const evaluatedSemesters = semesterTrends.filter((s) => s.totalMax > 0);
    let calculatedCGPA = 0;
    if (evaluatedSemesters.length > 0) {
      const sumSgpa = evaluatedSemesters.reduce((acc, s) => acc + s.sgpa, 0);
      calculatedCGPA = sumSgpa / evaluatedSemesters.length;
    } else if (overallPercentage > 0) {
      calculatedCGPA = overallPercentage / 9.5;
    }

    // Strictly cap CGPA to 10.0 (and minimum 0.0) rounded to 2 decimal places
    const cgpa = Number(Math.min(Math.max(calculatedCGPA, 0), 10.0).toFixed(2));

    // Synchronize capped CGPA with student User profile
    if (studentUser && studentUser.cgpa !== cgpa) {
      studentUser.cgpa = cgpa;
      studentUser.gpa = cgpa;
      studentUser.save().catch(() => {});
    }

    // Strongest & Weakest Subjects aggregation
    const subjectStats = {};
    for (const m of parsedMarks) {
      const sub = m.subject;
      if (!subjectStats[sub]) {
        subjectStats[sub] = { subject: sub, obtained: 0, max: 0, count: 0 };
      }
      if (!m.isAbsent) {
        subjectStats[sub].obtained += m.numericMarks;
        subjectStats[sub].max += m.maxMarks;
      }
      subjectStats[sub].count++;
    }

    const subjectAverages = Object.values(subjectStats).map((s) => ({
      subject: s.subject,
      percentage: s.max > 0 ? Number(((s.obtained / s.max) * 100).toFixed(1)) : 0,
      totalObtained: s.obtained,
      totalMax: s.max
    }));

    subjectAverages.sort((a, b) => b.percentage - a.percentage);

    const strongestSubject =
      subjectAverages.length > 0
        ? {
            name: subjectAverages[0].subject,
            percentage: subjectAverages[0].percentage,
            grade: subjectAverages[0].percentage >= 90 ? 'A+' : subjectAverages[0].percentage >= 80 ? 'A' : 'B+'
          }
        : { name: 'N/A', percentage: 0, grade: '—' };

    const weakestSubject =
      subjectAverages.length > 0
        ? {
            name: subjectAverages[subjectAverages.length - 1].subject,
            percentage: subjectAverages[subjectAverages.length - 1].percentage,
            grade:
              subjectAverages[subjectAverages.length - 1].percentage >= 70
                ? 'B'
                : subjectAverages[subjectAverages.length - 1].percentage >= 50
                ? 'C'
                : 'D'
          }
        : { name: 'N/A', percentage: 0, grade: '—' };

    // Total Attendance Calculation from DB
    const attendanceRecords = await Attendance.find({
      $or: [
        { enrollment: { $regex: new RegExp(`^${escapeRegex(targetEnrollment)}$`, 'i') } },
        { student: { $regex: new RegExp(`^${escapeRegex(studentInfo.name)}$`, 'i') } },
        ...(studentUser ? [{ studentId: studentUser._id }] : [])
      ]
    });

    const totalAttendanceSessions = attendanceRecords.length;
    const presentCount = attendanceRecords.filter((a) => a.status === 'Present').length;
    const lateCount = attendanceRecords.filter((a) => a.status === 'Late').length;
    const absentCount = attendanceRecords.filter((a) => a.status === 'Absent').length;
    const attendedSessions = presentCount + lateCount;
    const attendancePercentage =
      totalAttendanceSessions > 0
        ? Number(((attendedSessions / totalAttendanceSessions) * 100).toFixed(1))
        : 0;

    // -------------------------------------------------------------------------
    // Aggregation 2: Bar Chart (Marks Obtained vs Max Marks for Current Semester)
    // -------------------------------------------------------------------------
    // Determine student's active semester
    let currentSemester = studentInfo.semester || '';
    const distinctSemesters = [...new Set(parsedMarks.map((m) => m.semester).filter(Boolean))];
    if (distinctSemesters.length > 0) {
      // Sort semesters and pick latest
      distinctSemesters.sort((a, b) => {
        const numA = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });
      currentSemester = distinctSemesters[distinctSemesters.length - 1];
    }

    // Filter marks for current semester
    const currentSemMarks = parsedMarks.filter(
      (m) =>
        m.semester.toLowerCase() === currentSemester.toLowerCase() ||
        (isFaculty && filteredSubject && m.subject.toLowerCase() === filteredSubject.toLowerCase())
    );

    // Group by subject for bar chart
    const currentSemSubjectsMap = {};
    for (const m of currentSemMarks) {
      if (!currentSemSubjectsMap[m.subject]) {
        currentSemSubjectsMap[m.subject] = {
          subject: m.subject,
          marksObtained: 0,
          maxMarks: 0,
          examCount: 0
        };
      }
      if (!m.isAbsent) {
        currentSemSubjectsMap[m.subject].marksObtained += m.numericMarks;
        currentSemSubjectsMap[m.subject].maxMarks += m.maxMarks;
      } else {
        currentSemSubjectsMap[m.subject].maxMarks += m.maxMarks;
      }
      currentSemSubjectsMap[m.subject].examCount++;
    }

    // Compute Class Average for each current semester subject across all students in MongoDB
    const currentSemesterSubjects = [];
    for (const subKey of Object.keys(currentSemSubjectsMap)) {
      const item = currentSemSubjectsMap[subKey];
      const pct = item.maxMarks > 0 ? Number(((item.marksObtained / item.maxMarks) * 100).toFixed(1)) : 0;

      // Aggregation for class average in this subject
      const allCohortMarks = await Mark.find({
        subject: { $regex: new RegExp(`^${escapeRegex(subKey)}$`, 'i') }
      });
      let cohortObtained = 0;
      let cohortMax = 0;
      for (const cm of allCohortMarks) {
        const parsed = parseMarkRecord(cm);
        if (!parsed.isAbsent) {
          cohortObtained += parsed.numericMarks;
          cohortMax += parsed.maxMarks;
        }
      }
      const classAvgPct = cohortMax > 0 ? Number(((cohortObtained / cohortMax) * 100).toFixed(1)) : 0;

      currentSemesterSubjects.push({
        subject: item.subject,
        marksObtained: Math.round(item.marksObtained),
        maxMarks: Math.round(item.maxMarks),
        percentage: pct,
        classAverage: classAvgPct,
        grade: pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B+' : pct >= 60 ? 'B' : 'C'
      });
    }

    // -------------------------------------------------------------------------
    // Aggregation 3: Line Graph (Performance Trend over Past Semesters/Exams)
    // -------------------------------------------------------------------------
    // If only one semester trend exists, create a granular exam-by-exam trend
    let performanceTrend = semesterTrends;
    if (semesterTrends.length <= 1) {
      performanceTrend = parsedMarks.map((m, idx) => ({
        label: `${m.exam} (${m.subject.substring(0, 10)})`,
        exam: m.exam,
        subject: m.subject,
        percentage: m.percentage,
        marksObtained: m.numericMarks,
        maxMarks: m.maxMarks
      }));
    }

    // -------------------------------------------------------------------------
    // Aggregation 4: Faculty Specific Subject vs Class Average Comparison
    // -------------------------------------------------------------------------
    let facultyComparison = null;
    if (isFaculty || filteredSubject) {
      const subjectToCompare = filteredSubject || (parsedMarks[0] ? parsedMarks[0].subject : '');

      if (subjectToCompare) {
        // All evaluations of this student in that subject
        const studentSubMarks = parsedMarks.filter(
          (m) => m.subject.toLowerCase() === subjectToCompare.toLowerCase()
        );
        const subObtained = studentSubMarks.reduce((acc, m) => acc + (m.isAbsent ? 0 : m.numericMarks), 0);
        const subMax = studentSubMarks.reduce((acc, m) => acc + m.maxMarks, 0);
        const studentSubPct = subMax > 0 ? Number(((subObtained / subMax) * 100).toFixed(1)) : 0;

        // Class-wide evaluations in that subject
        const allClassMarks = await Mark.find({
          subject: { $regex: new RegExp(`^${escapeRegex(subjectToCompare)}$`, 'i') }
        });
        const parsedClassMarks = allClassMarks.map(parseMarkRecord);
        const classObtained = parsedClassMarks.reduce((acc, m) => acc + (m.isAbsent ? 0 : m.numericMarks), 0);
        const classMax = parsedClassMarks.reduce((acc, m) => acc + m.maxMarks, 0);
        const classAvgPct = classMax > 0 ? Number(((classObtained / classMax) * 100).toFixed(1)) : 0;

        // Exam-by-exam breakdown
        const examComparisons = studentSubMarks.map((sm) => {
          const cohortSameExam = parsedClassMarks.filter(
            (cm) => cm.exam.toLowerCase() === sm.exam.toLowerCase()
          );
          const cohortSameExamObtained = cohortSameExam.reduce(
            (acc, cm) => acc + (cm.isAbsent ? 0 : cm.numericMarks),
            0
          );
          const cohortSameExamMax = cohortSameExam.reduce((acc, cm) => acc + cm.maxMarks, 0);
          const examAvgPct =
            cohortSameExamMax > 0
              ? Number(((cohortSameExamObtained / cohortSameExamMax) * sm.maxMarks).toFixed(1))
              : 0;

          return {
            exam: sm.exam,
            studentScore: sm.numericMarks,
            classAverageScore: examAvgPct,
            maxMarks: sm.maxMarks,
            studentPercentage: sm.percentage,
            grade: sm.grade
          };
        });

        facultyComparison = {
          subject: subjectToCompare,
          studentPercentage: studentSubPct,
          classAveragePercentage: classAvgPct,
          difference: Number((studentSubPct - classAvgPct).toFixed(1)),
          isAboveAverage: studentSubPct >= classAvgPct,
          totalExams: studentSubMarks.length,
          examComparisons
        };
      }
    }

    // -------------------------------------------------------------------------
    // Response Payload
    // -------------------------------------------------------------------------
    res.status(200).json({
      success: true,
      role: userRole,
      student: studentInfo,
      metrics: {
        overallPercentage,
        cgpa,
        totalMarksObtained: totalObtained,
        totalMaxMarks: totalMax,
        totalEvaluations: parsedMarks.length,
        strongestSubject,
        weakestSubject,
        attendance: {
          percentage: attendancePercentage,
          attended: attendedSessions,
          totalSessions: totalAttendanceSessions,
          absent: absentCount
        }
      },
      summary: {
        cgpa,
        gpa: cgpa,
        overallPercentage,
        totalSubjects: Object.keys(subjectStats).length,
        totalEvaluations: parsedMarks.length
      },
      currentSemester,
      currentSemesterSubjects,
      semesterTrends,
      performanceTrend,
      facultyComparison,
      detailedMarks: parsedMarks
    });
  } catch (error) {
    console.error('Error in getStudentPerformanceAnalytics:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error calculating student performance analytics.'
    });
  }
};

// =============================================================================
// 2. GET /api/marks/analytics/faculty-subjects
// Fetches the subjects taught by the logged-in faculty with class averages
// =============================================================================
exports.getFacultySubjectsAnalytics = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    let subjectsList = [];

    if (userRole === 'admin') {
      // Admin can select any subject
      const allDistinctSubjects = await Mark.distinct('subject');
      subjectsList = allDistinctSubjects;
    } else {
      // Faculty is strictly restricted to assigned subjects
      subjectsList = await getFacultyAssignedSubjects(req.user);
    }

    const subjectsSummary = [];

    for (const sub of subjectsList) {
      const marks = await Mark.find({
        subject: { $regex: new RegExp(`^${escapeRegex(sub)}$`, 'i') }
      });
      const parsed = marks.map(parseMarkRecord);
      const uniqueStudents = [...new Set(parsed.map((m) => m.enrollment).filter(Boolean))];

      const valid = parsed.filter((m) => !m.isAbsent);
      const totalObtained = valid.reduce((acc, m) => acc + m.numericMarks, 0);
      const totalMax = valid.reduce((acc, m) => acc + m.maxMarks, 0);
      const classAverage = totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(1)) : 0;

      // Find department and semester metadata from assignment
      const assignment = await FacultySubjectAssignment.findOne({
        subject: { $regex: new RegExp(`^${escapeRegex(sub)}$`, 'i') }
      });

      subjectsSummary.push({
        subject: sub,
        department: assignment?.department || (marks[0] ? marks[0].department : ''),
        semester: assignment?.semester ? `Semester ${assignment.semester}` : marks[0]?.semester || '',
        classSection: assignment?.classSection || '',
        studentCount: uniqueStudents.length,
        evaluationsCount: marks.length,
        classAverage
      });
    }

    res.status(200).json({
      success: true,
      count: subjectsSummary.length,
      data: subjectsSummary
    });
  } catch (error) {
    console.error('Error in getFacultySubjectsAnalytics:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching faculty subjects.'
    });
  }
};

// =============================================================================
// 3. GET /api/marks/analytics/faculty-students
// Fetches list of students taking the faculty's subject with their marks summary
// =============================================================================
exports.getFacultySubjectStudentsAnalytics = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const subject = (req.query.subject || '').trim();

    if (!subject) {
      return res.status(400).json({
        success: false,
        message: 'Subject parameter is required.'
      });
    }

    // RBAC: Verify faculty teaches this subject
    if (userRole !== 'admin') {
      const allowedSubjects = await getFacultyAssignedSubjects(req.user);
      const isAllowed = allowedSubjects.some((s) => s.toLowerCase() === subject.toLowerCase());
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: `Access Denied: You do not teach subject '${subject}'.`
        });
      }
    }

    // Fetch all marks for this subject
    const marks = await Mark.find({
      subject: { $regex: new RegExp(`^${escapeRegex(subject)}$`, 'i') }
    }).sort({ createdAt: -1 });

    const studentMap = {};

    for (const m of marks) {
      const parsed = parseMarkRecord(m);
      const key = parsed.enrollment || parsed.student;

      if (!studentMap[key]) {
        studentMap[key] = {
          enrollment: parsed.enrollment,
          name: parsed.student,
          department: parsed.department,
          semester: parsed.semester,
          division: parsed.division,
          marksObtained: 0,
          maxMarks: 0,
          examCount: 0,
          latestGrade: parsed.grade,
          latestExam: parsed.exam
        };
      }

      if (!parsed.isAbsent) {
        studentMap[key].marksObtained += parsed.numericMarks;
        studentMap[key].maxMarks += parsed.maxMarks;
      } else {
        studentMap[key].maxMarks += parsed.maxMarks;
      }
      studentMap[key].examCount++;
    }

    const students = Object.values(studentMap).map((s) => ({
      ...s,
      percentage: s.maxMarks > 0 ? Number(((s.marksObtained / s.maxMarks) * 100).toFixed(1)) : 0
    }));

    // Sort by name
    students.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.status(200).json({
      success: true,
      subject,
      count: students.length,
      data: students
    });
  } catch (error) {
    console.error('Error in getFacultySubjectStudentsAnalytics:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching faculty students.'
    });
  }
};

// =============================================================================
// 4. GET /api/marks/analytics/search-students
// Global student autocomplete search (Name or Enrollment No.)
// =============================================================================
exports.searchStudentsForAnalytics = async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    const query = { role: 'student' };

    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i');
      query.$or = [{ name: regex }, { enrollment: regex }, { username: regex }];
    }

    const students = await User.find(query)
      .select('name enrollment department semester classSection email')
      .sort({ name: 1 })
      .limit(15);

    const formatted = students.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      enrollment: s.enrollment || '',
      department: s.department || 'AIML',
      semester: s.semester || 'Semester 7',
      classSection: s.classSection || 'A'
    }));

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted
    });
  } catch (error) {
    console.error('Error in searchStudentsForAnalytics:', error);
    res.status(500).json({
      success: false,
      message: 'Server error searching students.'
    });
  }
};

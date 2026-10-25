const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const User = require('../models/User');
const FacultySubjectAssignment = require('../models/FacultySubjectAssignment');
const { isDuePassed, parseDueDateTime } = require('../utils/dateHelper');
const { normalizeSemester, getSemesterQueryFilter } = require('../utils/academicHelper');

// Allowed departments and roles
const VALID_DEPARTMENTS = ['AIML', 'Cyber Security', 'All Departments'];
const VALID_TARGET_ROLES = ['Students', 'Faculty', 'Students & Faculty'];

// ============================================================================
// 1. GET ASSIGNMENTS (WITH STRICT FACULTY ISOLATION & STUDENT TARGETING)
// ============================================================================
// @desc    Get assignments
// @route   GET /api/assignments
// @access  Private (Authenticated)
exports.getAssignments = async (req, res) => {
  try {
    const { department, class: className, subject, status, facultyId, teacherUsername, teacherName, teacher } = req.query;
    const targetTeacher = (teacherName || teacher || '').trim();
    const userRole = (req.user?.role || '').toLowerCase();
    const userDept = (req.user?.department || req.user?.course || '').trim();
    const userEnrollment = (req.user?.enrollment || '').trim();
    const userSemester = normalizeSemester(req.user?.semester);

    let query = {
      status: { $ne: 'Archived' }
    };

    // 1. ADMIN: Full visibility across the institution
    if (userRole === 'admin') {
      if (department && department !== 'All Departments') {
        query.$or = [
          { department: { $in: [department, 'All Departments'] } },
          { targetDepartment: { $in: [department, 'All Departments'] } }
        ];
      }
      if (facultyId) {
        query.facultyId = facultyId;
      }
    } else if (userRole === 'faculty' || userRole === 'teacher') {
      // 2. FACULTY: STRICTLY ONLY THEIR OWN ASSIGNMENTS
      // Harsh Shah must see ONLY Harsh Shah's assignments. Faculty A never sees Faculty B's assignments.
      const myId = req.user._id;
      const myName = req.user.name;
      const myUsername = req.user.username;

      const facultyMatchConditions = [
        { facultyId: myId },
        { createdBy: myName }
      ];
      if (myUsername) {
        facultyMatchConditions.push({ facultyUsername: myUsername });
      }

      query.$or = facultyMatchConditions;
    } else if (userRole === 'student') {
      // 3. STUDENT: MUST MATCH DEPARTMENT + SEMESTER + TARGETING
      const deptMatches = ['All Departments'];
      if (userDept) deptMatches.push(userDept);

      const conditions = [
        // Role targeting: Students or Students & Faculty
        {
          $or: [
            { targetRole: { $in: ['Students', 'Students & Faculty', 'Everyone'] } },
            { audience: { $in: ['Students', 'Students & Faculty', 'Everyone', 'All Students'] } },
            { targetRole: { $exists: false } }
          ]
        },
        // Scope targeting (Department matching or Individual assignment)
        {
          $or: [
            // A. Explicit individual targeting
            { targetStudentEnrollment: userEnrollment },
            { student: userEnrollment },
            // B. Department-wide or Public assignment
            {
              $and: [
                {
                  $or: [
                    { department: { $in: deptMatches } },
                    { targetDepartment: { $in: deptMatches } }
                  ]
                },
                {
                  $or: [
                    { targetType: { $ne: 'individual' } },
                    { targetType: { $exists: false } }
                  ]
                },
                {
                  $or: [
                    { targetStudentEnrollment: '' },
                    { targetStudentEnrollment: null },
                    { targetStudentEnrollment: { $exists: false } }
                  ]
                }
              ]
            }
          ]
        }
      ];

      // Semester targeting: If student has a semester, they must NOT see other semesters' assignments
      if (userSemester) {
        conditions.push({
          $or: [
            { semester: userSemester },
            { semester: String(userSemester) },
            { semester: `Semester ${userSemester}` },
            { semester: null },
            { semester: { $exists: false } }
          ]
        });
      }

      // If student is querying assignments for a specific teacher
      if (facultyId && targetTeacher) {
        conditions.push({
          $or: [
            { facultyId },
            { createdBy: targetTeacher }
          ]
        });
      } else if (facultyId) {
        conditions.push({ facultyId });
      } else if (teacherUsername) {
        conditions.push({ facultyUsername: teacherUsername });
      } else if (targetTeacher) {
        conditions.push({ createdBy: targetTeacher });
      }

      query.$and = conditions;
    }

    if (className) {
      query.class = { $regex: new RegExp(className.trim(), 'i') };
    }
    if (subject) {
      query.subject = { $regex: new RegExp(subject.trim(), 'i') };
    }
    if (status && status !== 'all') {
      query.status = status;
    }

    const assignments = await Assignment.find(query).sort({ createdAt: -1 });

    // For students, attach their submission and due-date status
    let results = assignments.map((a) => a.toObject());
    if (userRole === 'student' && userEnrollment) {
      const mySubmissions = await Submission.find({
        studentEnrollment: userEnrollment,
        assignmentId: { $in: assignments.map((a) => a._id) }
      });

      const submissionMap = new Map();
      mySubmissions.forEach((sub) => {
        submissionMap.set(sub.assignmentId.toString(), sub);
      });

      results = results.map((a) => {
        const sub = submissionMap.get(a._id.toString());
        const isPast = isDuePassed(a.dueDate, a.dueTime);
        const isSubmitted = Boolean(sub) || (Array.isArray(a.submittedBy) && a.submittedBy.includes(userEnrollment));

        let computedStatus = 'Pending';
        if (isSubmitted) {
          computedStatus = sub?.status === 'Graded' ? 'Graded' : 'Submitted';
        } else if (isPast) {
          computedStatus = 'Closed';
        }

        return {
          ...a,
          isSubmitted,
          status: computedStatus,
          submittedAt: sub ? sub.submittedAt : null,
          submissionId: sub ? sub._id : null,
          answers: sub ? sub.answers : null,
          answersList: sub ? sub.answersList : [],
          marks: sub ? sub.marks : null,
          feedback: sub ? sub.feedback : null,
          isDuePassed: isPast,
          mySubmission: sub || null
        };
      });
    }

    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching assignments.'
    });
  }
};

// ============================================================================
// 2. GET TEACHERS FOR STUDENT (TEACHER-FIRST ASSIGNMENTS VIEW)
// ============================================================================
// @desc    Get relevant teachers for logged in student
// @route   GET /api/assignments/teachers
// @access  Private (Student)
exports.getTeachersForStudent = async (req, res) => {
  try {
    const studentDept = (req.user?.department || req.user?.course || '').trim();
    const studentSem = normalizeSemester(req.user?.semester) || 7;
    const studentEnrollment = (req.user?.enrollment || '').trim();

    // 1. Find all active Faculty-Subject Assignments for this student's Dept + Sem
    const academicAssignments = await FacultySubjectAssignment.find({
      department: studentDept,
      semester: studentSem,
      status: 'Active'
    });

    // 2. Fetch all assignments visible to this student
    const deptMatches = ['All Departments'];
    if (studentDept) deptMatches.push(studentDept);

    const assignmentFilter = {
      status: { $ne: 'Archived' },
      $and: [
        {
          $or: [
            { targetRole: { $in: ['Students', 'Students & Faculty', 'Everyone'] } },
            { audience: { $in: ['Students', 'Students & Faculty', 'Everyone', 'All Students'] } },
            { targetRole: { $exists: false } }
          ]
        },
        {
          $or: [
            { targetStudentEnrollment: studentEnrollment },
            { student: studentEnrollment },
            {
              $and: [
                {
                  $or: [
                    { department: { $in: deptMatches } },
                    { targetDepartment: { $in: deptMatches } }
                  ]
                },
                {
                  $or: [
                    { targetType: { $ne: 'individual' } },
                    { targetType: { $exists: false } }
                  ]
                }
              ]
            }
          ]
        },
        {
          $or: [
            { semester: studentSem },
            { semester: null },
            { semester: { $exists: false } }
          ]
        }
      ]
    };

    const studentAssignments = await Assignment.find(assignmentFilter).sort({ createdAt: -1 });

    // 3. Fetch student's submissions to calculate pending/submitted
    const studentSubmissions = await Submission.find({ studentEnrollment });
    const submittedAssignmentIds = new Set(
      studentSubmissions.map((s) => s.assignmentId.toString())
    );

    // Group teachers
    const teacherMap = new Map();

    // First: seed from academic assignments for this student
    academicAssignments.forEach((asg) => {
      const key = `${asg.facultyName}_${asg.subject}`.toLowerCase();
      teacherMap.set(key, {
        facultyId: asg.facultyId,
        facultyName: asg.facultyName,
        facultyUsername: asg.facultyUsername,
        subject: asg.subject,
        subjectCode: asg.subjectCode || '',
        department: asg.department,
        semester: asg.semester,
        classSection: asg.classSection || '',
        totalAssignments: 0,
        pendingAssignments: 0,
        submittedAssignments: 0,
        latestAssignment: null
      });
    });

    // Second: correlate actual published assignments
    studentAssignments.forEach((asg) => {
      const teacherName = asg.createdBy || 'Faculty';
      const subjectName = asg.subject || 'Coursework';
      const key = `${teacherName}_${subjectName}`.toLowerCase();

      let teacherEntry = teacherMap.get(key);
      if (!teacherEntry) {
        teacherEntry = {
          facultyId: asg.facultyId || null,
          facultyName: teacherName,
          facultyUsername: asg.facultyUsername || '',
          subject: subjectName,
          subjectCode: '',
          department: asg.department || studentDept,
          semester: asg.semester || studentSem,
          classSection: asg.class || '',
          totalAssignments: 0,
          pendingAssignments: 0,
          submittedAssignments: 0,
          latestAssignment: null
        };
        teacherMap.set(key, teacherEntry);
      }

      teacherEntry.totalAssignments += 1;
      const isSub =
        submittedAssignmentIds.has(asg._id.toString()) ||
        (Array.isArray(asg.submittedBy) && asg.submittedBy.includes(studentEnrollment));

      if (isSub) {
        teacherEntry.submittedAssignments += 1;
      } else {
        teacherEntry.pendingAssignments += 1;
      }

      if (!teacherEntry.latestAssignment) {
        teacherEntry.latestAssignment = {
          id: asg._id,
          title: asg.title,
          dueDate: asg.dueDate,
          dueTime: asg.dueTime
        };
      }
    });

    const teachersList = Array.from(teacherMap.values()).sort((a, b) =>
      a.facultyName.localeCompare(b.facultyName)
    );

    res.status(200).json({
      success: true,
      count: teachersList.length,
      data: teachersList
    });
  } catch (error) {
    console.error('Error fetching teachers for student:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving faculty list.'
    });
  }
};

// ============================================================================
// 3. GET SINGLE ASSIGNMENT BY ID
// ============================================================================
// @desc    Get single assignment details with optional student submission
// @route   GET /api/assignments/:id
// @access  Private (Authenticated)
exports.getAssignmentById = async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment || assignment.status === 'Archived') {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found.'
      });
    }

    const userRole = (req.user?.role || '').toLowerCase();
    const userEnrollment = (req.user?.enrollment || '').trim();
    const userDept = (req.user?.department || req.user?.course || '').trim();
    const userSemester = normalizeSemester(req.user?.semester);

    // Visibility verification for Student
    if (userRole === 'student') {
      if (
        assignment.department !== 'All Departments' &&
        userDept &&
        assignment.department !== userDept
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: This assignment is not available for your department.'
        });
      }
      if (assignment.semester && userSemester && assignment.semester !== userSemester) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: This assignment is not available for your semester.'
        });
      }
    }

    let mySubmission = null;
    if (userRole === 'student' && userEnrollment) {
      mySubmission = await Submission.findOne({
        assignmentId: assignment._id,
        studentEnrollment: userEnrollment
      });
    }

    const isPast = isDuePassed(assignment.dueDate, assignment.dueTime);
    const isSubmitted =
      Boolean(mySubmission) ||
      (Array.isArray(assignment.submittedBy) && assignment.submittedBy.includes(userEnrollment));

    // Ensure questionsList exists
    let questionsList = assignment.questionsList || [];
    if (questionsList.length === 0 && assignment.questions) {
      // Split questions string into items if questionsList was not set
      const lines = assignment.questions
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      questionsList = lines.map((q, idx) => ({
        id: `q-${idx + 1}`,
        question: q.replace(/^Q?\d+[\.:\s-]+/i, '').trim() || q,
        marks: 5
      }));
    }

    res.status(200).json({
      success: true,
      data: {
        ...assignment.toObject(),
        questionsList,
        isDuePassed: isPast,
        isSubmitted,
        status: isSubmitted ? (mySubmission?.status === 'Graded' ? 'Graded' : 'Submitted') : (isPast ? 'Closed' : 'Pending'),
        mySubmission
      }
    });
  } catch (error) {
    console.error('Error fetching assignment by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching assignment details.'
    });
  }
};

// ============================================================================
// 4. CREATE ASSIGNMENT (FACULTY / ADMIN)
// ============================================================================
// @desc    Create new assignment
// @route   POST /api/assignments
// @access  Private (Teacher/Faculty/Admin)
exports.createAssignment = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'admin' && userRole !== 'faculty' && userRole !== 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Faculty and Administrators can create assignments.'
      });
    }

    const {
      title,
      class: className,
      subject,
      description,
      instructions,
      questions,
      questionsList,
      totalMarks,
      dueDate,
      dueTime,
      priority,
      status,
      department,
      semester,
      targetDepartment,
      targetRole,
      audience,
      targetType,
      targetStudentEnrollment,
      student,
      fileName,
      fileType,
      fileSize,
      fileData,
      allowLate,
      notify
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Assignment title is required.'
      });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required.'
      });
    }

    if (!dueDate || !dueTime) {
      return res.status(400).json({
        success: false,
        message: 'Due date and Due time are required.'
      });
    }

    // Parse & normalize questions
    let parsedQuestionsList = [];
    if (Array.isArray(questionsList) && questionsList.length > 0) {
      parsedQuestionsList = questionsList
        .filter((q) => q && q.question && q.question.trim())
        .map((q, idx) => ({
          id: q.id || `q-${idx + 1}-${Date.now()}`,
          question: q.question.trim(),
          marks: Number(q.marks) || 5
        }));
    } else if (questions && typeof questions === 'string' && questions.trim()) {
      const lines = questions
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      parsedQuestionsList = lines.map((line, idx) => ({
        id: `q-${idx + 1}-${Date.now()}`,
        question: line.replace(/^Q?\d+[\.:\s-]+/i, '').trim() || line,
        marks: 5
      }));
    } else if (description && typeof description === 'string' && description.trim()) {
      parsedQuestionsList = [
        {
          id: `q-1-${Date.now()}`,
          question: description.trim(),
          marks: 10
        }
      ];
    }

    if (parsedQuestionsList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one assignment question.'
      });
    }

    const joinedQuestions = parsedQuestionsList
      .map((q, idx) => `Q${idx + 1}. ${q.question}`)
      .join('\n');

    // Resolve department and semester
    const resolvedDept = department || targetDepartment || req.user?.department || 'AIML';
    const semNum = normalizeSemester(semester) || 7;
    const resolvedRole = targetRole || audience || 'Students';
    const resolvedEnrollment = (targetStudentEnrollment || student || '').trim();

    let resolvedTargetType = targetType || 'department';
    if (resolvedEnrollment) {
      resolvedTargetType = 'individual';
    } else if (resolvedDept === 'All Departments') {
      resolvedTargetType = 'all';
    }

    const assignment = await Assignment.create({
      title: title.trim(),
      facultyId: req.user?._id,
      facultyUsername: req.user?.username || '',
      class: (className || `${resolvedDept} - Sem ${semNum}`).trim(),
      subject: subject.trim(),
      description: description ? description.trim() : instructions ? instructions.trim() : '',
      instructions: instructions ? instructions.trim() : description ? description.trim() : '',
      questionsList: parsedQuestionsList,
      questions: joinedQuestions,
      totalMarks: Number(totalMarks) || parsedQuestionsList.reduce((acc, q) => acc + (q.marks || 5), 0),
      dueDate,
      dueTime,
      priority: priority || 'Med',
      status: status || 'Published',
      department: resolvedDept,
      semester: semNum,
      targetDepartment: resolvedDept,
      targetRole: resolvedRole,
      audience: resolvedRole,
      targetType: resolvedTargetType,
      targetStudentEnrollment: resolvedEnrollment,
      student: resolvedEnrollment,
      fileName: fileName || null,
      fileType: fileType || null,
      fileSize: fileSize || null,
      fileData: fileData || null,
      allowLate: allowLate !== undefined ? Boolean(allowLate) : false,
      notify: notify !== undefined ? Boolean(notify) : true,
      createdBy: req.user?.name || 'Faculty',
      createdByRole: userRole === 'admin' ? 'admin' : 'faculty'
    });

    res.status(201).json({
      success: true,
      message: 'Assignment created and published successfully.',
      data: assignment
    });
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error creating assignment.'
    });
  }
};

// ============================================================================
// 5. UPDATE ASSIGNMENT (CREATOR FACULTY / ADMIN)
// ============================================================================
// @desc    Update assignment
// @route   PUT /api/assignments/:id
// @access  Private (Creator Faculty / Admin)
exports.updateAssignment = async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found.'
      });
    }

    const userRole = (req.user?.role || '').toLowerCase();
    const isOwner =
      userRole === 'admin' ||
      (assignment.facultyId && assignment.facultyId.toString() === req.user._id.toString()) ||
      assignment.createdBy === req.user.name ||
      (assignment.facultyUsername && assignment.facultyUsername === req.user.username);

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You cannot modify another faculty member\'s assignment.'
      });
    }

    const updateData = { ...req.body };

    // If questionsList is updated, also update joined questions string
    if (Array.isArray(updateData.questionsList) && updateData.questionsList.length > 0) {
      updateData.questions = updateData.questionsList
        .map((q, idx) => `Q${idx + 1}. ${q.question}`)
        .join('\n');
    }

    if (updateData.semester) {
      updateData.semester = normalizeSemester(updateData.semester);
    }

    const updated = await Assignment.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Assignment updated successfully.',
      data: updated
    });
  } catch (error) {
    console.error('Error updating assignment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error updating assignment.'
    });
  }
};

// ============================================================================
// 6. DELETE ASSIGNMENT (CREATOR FACULTY / ADMIN SAFE-DELETE)
// ============================================================================
// @desc    Delete or archive assignment
// @route   DELETE /api/assignments/:id
// @access  Private (Teacher/Faculty/Admin)
exports.deleteAssignment = async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found.'
      });
    }

    const userRole = (req.user?.role || '').toLowerCase();
    const isOwner =
      userRole === 'admin' ||
      (assignment.facultyId && assignment.facultyId.toString() === req.user._id.toString()) ||
      assignment.createdBy === req.user.name ||
      (assignment.facultyUsername && assignment.facultyUsername === req.user.username);

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You cannot delete another faculty member\'s assignment.'
      });
    }

    const submissionCount = await Submission.countDocuments({ assignmentId: req.params.id });

    // If submissions exist and force !== 'true', soft delete/archive to preserve submission records
    if (submissionCount > 0 && req.query.force !== 'true') {
      assignment.status = 'Archived';
      await assignment.save();
      return res.status(200).json({
        success: true,
        message: `Assignment archived safely to preserve ${submissionCount} student submission record(s).`
      });
    }

    await Assignment.findByIdAndDelete(req.params.id);
    await Submission.deleteMany({ assignmentId: req.params.id });

    res.status(200).json({
      success: true,
      message: 'Assignment and related submissions deleted successfully.'
    });
  } catch (error) {
    console.error('Error deleting assignment:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting assignment.'
    });
  }
};

// ============================================================================
// 7. SUBMIT ASSIGNMENT (STUDENT ONLY WITH STRICT DUE DATE CHECK)
// ============================================================================
// @desc    Submit or edit student answers for an assignment
// @route   POST /api/assignments/:id/submit
// @access  Private (Student only)
exports.submitAssignment = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Only registered students can submit assignments.'
      });
    }

    const studentEnrollment = (req.user?.enrollment || '').trim();
    if (!studentEnrollment) {
      return res.status(400).json({
        success: false,
        message: 'Student enrollment number is missing from user profile.'
      });
    }

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment || assignment.status === 'Archived') {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found.'
      });
    }

    // Verify due date and due time server-side (India / Asia/Kolkata timezone)
    const duePassed = isDuePassed(assignment.dueDate, assignment.dueTime);
    if (duePassed) {
      return res.status(400).json({
        success: false,
        message: 'Due date has passed. Submission is closed for this assignment.'
      });
    }

    const { answers, answersList, fileName, fileType, fileSize, fileData } = req.body;

    // Validate that answers were provided
    let parsedAnswersList = [];
    if (Array.isArray(answersList) && answersList.length > 0) {
      parsedAnswersList = answersList.map((a) => ({
        questionId: a.questionId || 'q-1',
        question: a.question || '',
        answer: (a.answer || '').trim()
      }));
    }

    let summaryAnswer = (answers || '').trim();
    if (!summaryAnswer && parsedAnswersList.length > 0) {
      summaryAnswer = parsedAnswersList
        .map((a, i) => `Q${i + 1}: ${a.answer}`)
        .join('\n\n');
    }

    if (!summaryAnswer && parsedAnswersList.every((a) => !a.answer)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide answers before submitting the assignment.'
      });
    }

    // Upsert submission record
    let submission = await Submission.findOne({
      assignmentId: assignment._id,
      studentEnrollment
    });

    if (submission) {
      submission.answers = summaryAnswer;
      submission.answersList = parsedAnswersList;
      submission.submittedAt = new Date();
      submission.status = 'Submitted';
      if (fileName !== undefined) submission.fileName = fileName;
      if (fileType !== undefined) submission.fileType = fileType;
      if (fileSize !== undefined) submission.fileSize = fileSize;
      if (fileData !== undefined) submission.fileData = fileData;
      await submission.save();
    } else {
      submission = await Submission.create({
        assignmentId: assignment._id,
        studentId: req.user._id,
        studentName: req.user.name || 'Student',
        studentEnrollment,
        answers: summaryAnswer,
        answersList: parsedAnswersList,
        submittedAt: new Date(),
        status: 'Submitted',
        fileName: fileName || null,
        fileType: fileType || null,
        fileSize: fileSize || null,
        fileData: fileData || null
      });
    }

    // Maintain backward-compatible array on assignment
    if (!assignment.submittedBy.includes(studentEnrollment)) {
      assignment.submittedBy.push(studentEnrollment);
      assignment.submissions.push({
        studentEnrollment,
        submittedAt: new Date(),
        status: 'Submitted'
      });
      await assignment.save();
    }

    res.status(200).json({
      success: true,
      message: 'Assignment submitted successfully!',
      data: submission
    });
  } catch (error) {
    console.error('Error submitting assignment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while submitting assignment.'
    });
  }
};

// ============================================================================
// 8. GET LOGGED IN STUDENT'S SUBMISSION
// ============================================================================
// @desc    Get logged in student's submission for an assignment
// @route   GET /api/assignments/:id/my-submission
// @access  Private (Student)
exports.getMySubmission = async (req, res) => {
  try {
    const studentEnrollment = (req.user?.enrollment || '').trim();
    if (!studentEnrollment) {
      return res.status(400).json({
        success: false,
        message: 'Student enrollment is required.'
      });
    }

    const submission = await Submission.findOne({
      assignmentId: req.params.id,
      studentEnrollment
    });

    res.status(200).json({
      success: true,
      data: submission || null
    });
  } catch (error) {
    console.error('Error getting student submission:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving submission.'
    });
  }
};

// ============================================================================
// 9. GET ASSIGNMENT SUBMISSIONS & STUDENT ROSTER (FACULTY / ADMIN)
// ============================================================================
// @desc    Get all submissions and full student roster for an assignment
// @route   GET /api/assignments/:id/submissions
// @access  Private (Faculty / Admin)
exports.getAssignmentSubmissions = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'admin' && userRole !== 'faculty' && userRole !== 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Faculty and Administrators can view assignment submissions.'
      });
    }

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found.'
      });
    }

    if (userRole !== 'admin') {
      const isCreator =
        (assignment.facultyId && assignment.facultyId.toString() === req.user._id.toString()) ||
        assignment.createdBy === req.user?.name ||
        assignment.facultyUsername === req.user?.username;

      if (!isCreator) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You cannot view submissions for another faculty member\'s assignment.'
        });
      }
    }

    // Get all submissions for this assignment from Submission collection
    const submissions = await Submission.find({ assignmentId: assignment._id }).sort({ submittedAt: -1 });

    // Determine eligible students roster based on targeting
    let studentFilter = { role: { $in: ['student', 'Student'] } };
    const resolvedEnrollment = (assignment.targetStudentEnrollment || assignment.student || '').trim();

    if (assignment.targetType === 'individual' || resolvedEnrollment) {
      studentFilter.enrollment = resolvedEnrollment;
    } else {
      const dept = assignment.department || assignment.targetDepartment;
      if (dept && dept !== 'All Departments') {
        const escapedDept = dept.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        studentFilter.$or = [
          { department: { $regex: new RegExp(`^${escapedDept}$`, 'i') } },
          { course: { $regex: new RegExp(`^${escapedDept}$`, 'i') } }
        ];
      }
      if (assignment.semester) {
        const semFilter = getSemesterQueryFilter(assignment.semester);
        if (Object.keys(semFilter).length > 0) {
          studentFilter.semester = semFilter;
        }
      }
    }

    const eligibleStudents = await User.find(studentFilter)
      .select('name enrollment email department course semester')
      .sort({ name: 1 });

    // Map submissions by enrollment
    const submissionMap = new Map();
    submissions.forEach((sub) => {
      submissionMap.set(sub.studentEnrollment.toLowerCase(), sub);
    });

    const roster = eligibleStudents.map((student) => {
      const sub = submissionMap.get(student.enrollment.toLowerCase());
      return {
        studentId: student._id,
        studentName: student.name,
        studentEnrollment: student.enrollment,
        studentDepartment: student.department || student.course || 'General',
        semester: student.semester || assignment.semester,
        email: student.email,
        isSubmitted: Boolean(sub),
        status: sub ? sub.status : 'Not Submitted',
        submittedAt: sub ? sub.submittedAt : null,
        answers: sub ? sub.answers : null,
        answersList: sub ? sub.answersList : [],
        marks: sub ? sub.marks : null,
        feedback: sub ? sub.feedback : null,
        fileName: sub ? sub.fileName : null,
        fileType: sub ? sub.fileType : null,
        fileSize: sub ? sub.fileSize : null,
        fileData: sub ? sub.fileData : null,
        submissionId: sub ? sub._id : null
      };
    });

    const submittedCount = roster.filter((s) => s.isSubmitted).length;
    const notSubmittedCount = roster.length - submittedCount;
    const gradedCount = roster.filter((s) => s.status === 'Graded').length;

    res.status(200).json({
      success: true,
      assignment,
      stats: {
        totalAssigned: roster.length,
        submittedCount,
        notSubmittedCount,
        gradedCount
      },
      submissions,
      roster
    });
  } catch (error) {
    console.error('Error fetching assignment submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving assignment submissions.'
    });
  }
};

// ============================================================================
// 10. REVIEW SUBMISSION / ADD MARKS & FEEDBACK (FACULTY / ADMIN)
// ============================================================================
// @desc    Add marks and feedback for a student submission
// @route   PUT /api/assignments/submissions/:submissionId/review
// @access  Private (Faculty / Admin)
exports.reviewSubmission = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'admin' && userRole !== 'faculty' && userRole !== 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Faculty and Administrators can grade assignments.'
      });
    }

    const { marks, feedback } = req.body;
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found.'
      });
    }

    const assignment = await Assignment.findById(submission.assignmentId);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Parent assignment not found.'
      });
    }

    if (userRole !== 'admin') {
      const isOwner =
        (assignment.facultyId && assignment.facultyId.toString() === req.user._id.toString()) ||
        assignment.createdBy === req.user?.name ||
        assignment.facultyUsername === req.user?.username;

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You cannot grade submissions for another faculty member\'s assignment.'
        });
      }
    }

    submission.marks = marks !== undefined ? String(marks).trim() : submission.marks;
    submission.feedback = feedback !== undefined ? String(feedback).trim() : submission.feedback;
    submission.gradedBy = req.user.name || 'Faculty';
    submission.gradedAt = new Date();
    submission.status = 'Graded';

    await submission.save();

    res.status(200).json({
      success: true,
      message: 'Grade and feedback saved successfully.',
      data: submission
    });
  } catch (error) {
    console.error('Error reviewing submission:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while reviewing submission.'
    });
  }
};

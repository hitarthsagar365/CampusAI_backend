const Mark = require('../models/Mark');
const User = require('../models/User');
const nodemailer = require('nodemailer');
const { normalizeSemester } = require('../utils/academicHelper');

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Get marks / grade records (with optional filters)
// @route   GET /api/marks
// @access  Private (Authenticated)
exports.getMarks = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const { enrollment, student, subject, exam, department, semester, division } = req.query;
    let query = {};

    // 1. Role Scoping: Students MUST ONLY see their own evaluation records
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
      // Faculty scopes by default to their assigned subjects
      if (!subject) {
        const allowedSubjects = new Set();
        if (req.user?.assignedSubject && req.user.assignedSubject.trim()) {
          allowedSubjects.add(req.user.assignedSubject.trim());
        }
        if (Array.isArray(req.user?.assignedSubjects)) {
          for (const item of req.user.assignedSubjects) {
            if (item?.subjectName) allowedSubjects.add(item.subjectName.trim());
            if (item?.subject?.name) allowedSubjects.add(item.subject.name.trim());
            if (typeof item?.subject === 'string' && item.subject.trim()) {
              allowedSubjects.add(item.subject.trim());
            }
          }
        }
        if (allowedSubjects.size > 0) {
          const regexes = Array.from(allowedSubjects).map((s) => new RegExp(`^${escapeRegex(s)}$`, 'i'));
          query.subject = { $in: regexes };
        }
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

    if (exam) {
      query.exam = { $regex: new RegExp(exam.trim(), 'i') };
    }

    if (department && department !== 'All' && department !== 'All Departments') {
      const escapedDept = escapeRegex(department.trim());
      query.department = { $regex: new RegExp(`^${escapedDept}$`, 'i') };
    }

    if (semester && semester !== 'All') {
      const semNum = normalizeSemester(semester);
      if (semNum) {
        query.semester = {
          $in: [
            semNum,
            String(semNum),
            `Semester ${semNum}`,
            `semester ${semNum}`,
            `Sem ${semNum}`,
            `Sem-${semNum}`,
            `sem ${semNum}`
          ]
        };
      } else {
        query.semester = String(semester).trim();
      }
    }

    if (division && division.toLowerCase() !== 'all') {
      query.division = { $regex: new RegExp(`^${division.trim()}$`, 'i') };
    }

    // Total marks records count for pagination metadata
    const totalRecords = await Mark.countDocuments(query);

    // Pagination: page and limit
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.limit !== undefined
      ? Math.max(0, parseInt(req.query.limit, 10))
      : (req.query.page ? 10 : 0);

    let marksQuery = Mark.find(query).sort({ createdAt: -1 });
    if (limit > 0) {
      const skip = (page - 1) * limit;
      marksQuery = marksQuery.skip(skip).limit(limit);
    }

    const records = await marksQuery;
    const totalPages = limit > 0 ? Math.ceil(totalRecords / limit) : 1;

    res.status(200).json({
      success: true,
      count: records.length,
      totalRecords,
      currentPage: page,
      totalPages,
      limit: limit || totalRecords,
      data: records
    });
  } catch (error) {
    console.error('Error fetching marks:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching marks.'
    });
  }
};

// @desc    Create new single mark / grade record
// @route   POST /api/marks
// @access  Private (Teacher/Admin)
exports.createMark = async (req, res) => {
  try {
    const { student, enrollment, subject, exam, score, department, enteredBy, semester, division, maxMarks, attendanceStatus, grade } = req.body;

    if (!student || !subject || !exam || !score) {
      return res.status(400).json({
        success: false,
        message: 'Student, subject, exam, and score are required.'
      });
    }

    // Verify student is not a faculty or admin
    const targetEnrollment = (enrollment || student).trim();
    const existingFacultyOrAdmin = await User.findOne({
      role: { $in: ['faculty', 'teacher', 'admin'] },
      $or: [
        { enrollment: targetEnrollment },
        { username: targetEnrollment },
        { name: student.trim() }
      ]
    });
    if (existingFacultyOrAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Marks can only be recorded for students. Cannot assign marks to faculty or admin.'
      });
    }

    const record = await Mark.create({
      student: student.trim(),
      enrollment: targetEnrollment,
      subject: subject.trim(),
      exam: exam.trim(),
      score: score.trim(),
      maxMarks: Number(maxMarks) || 30,
      marksObtained: score.trim(),
      attendanceStatus: attendanceStatus || 'Present',
      grade: grade || '',
      department: department || '',
      semester: semester || '',
      division: division || '',
      enteredBy: enteredBy || req.user?.name || 'Faculty'
    });

    res.status(201).json({
      success: true,
      message: 'Marks record created successfully.',
      data: record
    });
  } catch (error) {
    console.error('Error creating mark:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error creating mark.'
    });
  }
};

// @desc    Bulk Save / Update Student Marks with Strict Role-Based Constraints
// @route   POST /api/marks/bulk
// @access  Private (Faculty / Admin)
exports.bulkSaveMarks = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const {
      department,
      semester,
      division,
      subject,
      exam,
      maxMarks,
      enteredBy,
      marksData
    } = req.body;

    if (!department || !subject || !exam || !Array.isArray(marksData)) {
      return res.status(400).json({
        success: false,
        message: 'Department, subject, exam type, and marksData array are required.'
      });
    }

    const cleanExam = exam.trim();
    const cleanMax = Number(maxMarks) || 30;

    // =========================================================================
    // 1. STRICT FACULTY RBAC VALIDATION
    // =========================================================================
    if (userRole !== 'admin') {
      // Rule 1: Locked strictly to 'Mid Term'. Faculty cannot see or select 'Final Exam'
      if (cleanExam.toLowerCase() !== 'mid term' && cleanExam.toLowerCase() !== 'midterm') {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: Faculty role is strictly locked to Mid Term evaluations. Final Exam entry is restricted to Administrators.'
        });
      }

      // Rule 2: Max Marks hardcoded/restricted to 30 marks for Mid Term exams
      if (cleanMax > 30) {
        return res.status(400).json({
          success: false,
          message: 'Policy Violation: Mid Term evaluations for faculty cannot exceed the 30 marks limit.'
        });
      }

      // Rule 3: Class Access restricted solely to logged-in Faculty's assigned department / courses
      const userDept = (req.user?.department || '').trim();
      const allowedDepts = [userDept];
      if (Array.isArray(req.user?.assignedSubjects)) {
        req.user.assignedSubjects.forEach((as) => {
          if (as?.course) allowedDepts.push(as.course.trim());
          if (as?.department) allowedDepts.push(as.department.trim());
        });
      }
      const isAllowedDept =
        !userDept ||
        userDept === 'All Departments' ||
        allowedDepts.some((d) => d && d.toLowerCase() === department.trim().toLowerCase());

      if (!isAllowedDept) {
        return res.status(403).json({
          success: false,
          message: `Access Denied: You are only authorized to evaluate students in your assigned departments/courses (${allowedDepts.filter(Boolean).join(', ')}). Cannot access ${department}.`
        });
      }
    }

    // =========================================================================
    // 2. PROCESS AND VALIDATE EACH STUDENT MARK RECORD
    // =========================================================================
    const savedRecords = [];

    for (const item of marksData) {
      const enrollment = (item.enrollment || item.student || '').trim();
      const studentName = (item.student || item.name || enrollment).trim();
      const attendance = (item.attendanceStatus || item.attendance || 'Present').trim();
      const isAbsent = attendance.toLowerCase() === 'absent';

      let marksObtained = '';
      let scoreStr = '';
      let grade = item.grade || '—';

      if (isAbsent) {
        marksObtained = 'AB';
        scoreStr = 'AB';
        grade = 'AB';
      } else {
        const rawScore = item.marks !== undefined && item.marks !== null ? String(item.marks).trim() : '0';
        const numScore = parseFloat(rawScore);

        if (isNaN(numScore)) {
          marksObtained = '0';
          scoreStr = `0/${cleanMax}`;
        } else {
          // Validate against Max Marks
          if (numScore < 0 || numScore > cleanMax) {
            return res.status(400).json({
              success: false,
              message: `Validation Error for ${studentName} (${enrollment}): Marks (${numScore}) must be between 0 and maximum marks (${cleanMax}).`
            });
          }
          marksObtained = String(numScore);
          scoreStr = `${numScore}/${cleanMax}`;

          // Calculate grade if not provided
          if (!grade || grade === '—') {
            const pct = (numScore / cleanMax) * 100;
            if (pct >= 90) grade = 'A+';
            else if (pct >= 80) grade = 'A';
            else if (pct >= 70) grade = 'B+';
            else if (pct >= 60) grade = 'B';
            else if (pct >= 50) grade = 'C';
            else if (pct >= 40) grade = 'D';
            else grade = 'F';
          }
        }
      }

      const markDoc = {
        student: studentName,
        enrollment,
        subject: subject.trim(),
        exam: cleanExam,
        score: scoreStr,
        maxMarks: cleanMax,
        marksObtained,
        attendanceStatus: isAbsent ? 'Absent' : 'Present',
        grade,
        department: department.trim(),
        semester: semester ? String(semester).trim() : '',
        division: division ? String(division).trim() : '',
        enteredBy: enteredBy || req.user?.name || (userRole === 'admin' ? 'Administrator' : 'Faculty')
      };

      // Upsert: update existing student record for this subject & exam or insert new
      const updated = await Mark.findOneAndUpdate(
        {
          enrollment: enrollment,
          subject: { $regex: new RegExp(`^${subject.trim()}$`, 'i') },
          exam: { $regex: new RegExp(`^${cleanExam}$`, 'i') }
        },
        { $set: markDoc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      savedRecords.push(updated);
    }

    res.status(200).json({
      success: true,
      message: `Successfully saved marks for ${savedRecords.length} students.`,
      count: savedRecords.length,
      data: savedRecords
    });
  } catch (error) {
    console.error('Error in bulkSaveMarks:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error saving bulk marks.'
    });
  }
};

// @desc    Send marksheet report email to Department / HOD via Nodemailer
// @route   POST /api/marks/send-email
// @access  Private (Faculty / Admin)
exports.sendMarksheetEmail = async (req, res) => {
  try {
    const {
      department,
      semester,
      division,
      subject,
      examType,
      maxMarks,
      targetEmail,
      notes,
      enteredBy,
      studentMarks,
      stats,
      pdfBase64
    } = req.body;

    if (!department || !subject || !examType) {
      return res.status(400).json({
        success: false,
        message: 'Department, subject, and exam type are required.'
      });
    }

    // Resolve target email (specific to selected department & division)
    let recipient = (targetEmail || '').trim();
    if (!recipient) {
      const hodUser = await User.findOne({
        department: { $regex: new RegExp(`^${department.trim()}$`, 'i') },
        role: { $in: ['admin', 'faculty', 'teacher'] }
      });
      recipient = hodUser?.email || `hod.${department.toLowerCase().replace(/\s+/g, '')}@campus.edu`;
    }

    // Configure Nodemailer Transporter
    let transporter;
    let isTestAccount = false;

    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      try {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass
          }
        });
        isTestAccount = true;
      } catch (e) {
        transporter = nodemailer.createTransport({
          jsonTransport: true
        });
      }
    }

    // Build Table Rows HTML
    const marksList = Array.isArray(studentMarks) ? studentMarks : [];
    const tableRowsHtml = marksList
      .map(
        (m, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
          <td style="padding: 8px 12px; text-align: center; color: #64748b;">${idx + 1}</td>
          <td style="padding: 8px 12px; font-family: monospace; font-weight: bold; color: #1e293b;">${m.enrollment || '—'}</td>
          <td style="padding: 8px 12px; font-weight: 600; color: #0f172a;">${m.name || m.student || '—'}</td>
          <td style="padding: 8px 12px; text-align: center;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-weight: bold; font-size: 11px; ${
              m.attendance === 'Absent' ? 'background: #fee2e2; color: #dc2626;' : 'background: #dcfce7; color: #16a34a;'
            }">
              ${m.attendance || 'Present'}
            </span>
          </td>
          <td style="padding: 8px 12px; text-align: center; font-weight: bold; color: #4338ca;">
            ${m.marks !== undefined ? m.marks : '—'} / ${maxMarks}
          </td>
          <td style="padding: 8px 12px; text-align: center; font-weight: bold; color: #1e293b;">
            ${m.grade || '—'}
          </td>
        </tr>
      `
      )
      .join('');

    // HTML Email Template
    const htmlEmail = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #4338ca 0%, #312e81 100%); padding: 24px 28px; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">CAMPUS AI INSTITUTE OF TECHNOLOGY</h1>
          <p style="margin: 4px 0 0; font-size: 12px; color: #c7d2fe;">Approved by AICTE | Official Examination & Academic Assessment Report</p>
        </div>

        <div style="padding: 24px 28px;">
          <h2 style="margin: 0 0 16px; font-size: 16px; color: #1e293b; font-weight: 700;">
            Official Marksheet Submission: ${department} — Div ${division || 'A'}
          </h2>
          
          <!-- Metadata Card -->
          <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; font-size: 13px;">
            <tr>
              <td style="padding: 10px 14px; font-weight: bold; color: #64748b; width: 25%;">Department:</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; width: 25%;">${department}</td>
              <td style="padding: 10px 14px; font-weight: bold; color: #64748b; width: 25%;">Semester & Div:</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; width: 25%;">Sem ${semester} - Div ${division || 'A'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; font-weight: bold; color: #64748b;">Subject:</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1e293b;">${subject}</td>
              <td style="padding: 10px 14px; font-weight: bold; color: #64748b;">Exam Type:</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #4338ca;">${examType} (Max: ${maxMarks})</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; font-weight: bold; color: #64748b;">Submitted By:</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1e293b;">${enteredBy || req.user?.name || 'Faculty'}</td>
              <td style="padding: 10px 14px; font-weight: bold; color: #64748b;">Date:</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1e293b;">${new Date().toLocaleDateString()}</td>
            </tr>
          </table>

          ${
            notes
              ? `<div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
                  <strong style="color: #1e40af; font-size: 13px;">Faculty Remarks / Notes:</strong>
                  <p style="margin: 4px 0 0; color: #1e3a8a; font-size: 13px;">${notes}</p>
                </div>`
              : ''
          }

          <!-- Statistics Summary -->
          ${
            stats
              ? `<div style="display: flex; gap: 12px; margin-bottom: 20px;">
                  <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 12px;">
                    <tr style="background: #f1f5f9;">
                      <th style="padding: 8px; border: 1px solid #e2e8f0; color: #475569;">Total Students</th>
                      <th style="padding: 8px; border: 1px solid #e2e8f0; color: #16a34a;">Present</th>
                      <th style="padding: 8px; border: 1px solid #e2e8f0; color: #dc2626;">Absent</th>
                      <th style="padding: 8px; border: 1px solid #e2e8f0; color: #4338ca;">Class Average</th>
                      <th style="padding: 8px; border: 1px solid #e2e8f0; color: #16a34a;">Pass Rate</th>
                    </tr>
                    <tr>
                      <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">${stats.total || marksList.length}</td>
                      <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #16a34a;">${stats.presentCount || '—'}</td>
                      <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #dc2626;">${stats.absentCount || '0'}</td>
                      <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #4338ca;">${stats.average || '—'} / ${maxMarks}</td>
                      <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #16a34a;">${stats.passRate || '0'}%</td>
                    </tr>
                  </table>
                </div>`
              : ''
          }

          <!-- Evaluation Table -->
          <h3 style="margin: 16px 0 8px; font-size: 14px; color: #1e293b;">Student Performance Breakdown</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <thead>
              <tr style="background: #4338ca; color: #ffffff; font-size: 12px;">
                <th style="padding: 8px 12px; width: 40px;">#</th>
                <th style="padding: 8px 12px; text-align: left;">Enrollment No</th>
                <th style="padding: 8px 12px; text-align: left;">Student Name</th>
                <th style="padding: 8px 12px; text-align: center;">Attendance</th>
                <th style="padding: 8px 12px; text-align: center;">Score</th>
                <th style="padding: 8px 12px; text-align: center;">Grade</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>

          <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">
            This email was automatically generated by the Campus AI Academic Management System.
          </p>
        </div>
      </div>
    `;

    // Prepare Attachments
    const attachments = [];
    if (pdfBase64) {
      const base64Data = pdfBase64.replace(/^data:[a-zA-Z0-9/]+;base64,/, '');
      attachments.push({
        filename: `Marksheet_${department}_Sem${semester}_Div${division || 'A'}_${subject.replace(/[^a-zA-Z0-9]/g, '_')}_${examType}.pdf`,
        content: Buffer.from(base64Data, 'base64'),
        contentType: 'application/pdf'
      });
    }

    // Send Mail
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Campus AI Examination Office" <exams@campus.edu>',
      to: recipient,
      subject: `[Official Marksheet] ${department} Sem ${semester} Div ${division || 'A'} - ${subject} (${examType})`,
      html: htmlEmail,
      attachments
    };

    const info = await transporter.sendMail(mailOptions);
    let previewUrl = null;
    if (isTestAccount) {
      previewUrl = nodemailer.getTestMessageUrl(info);
    }

    res.status(200).json({
      success: true,
      message: `Marksheet report successfully emailed to ${recipient}.`,
      recipient,
      messageId: info.messageId,
      previewUrl
    });
  } catch (error) {
    console.error('Error in sendMarksheetEmail:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error sending marksheet email.'
    });
  }
};

// @desc    Delete mark record
// @route   DELETE /api/marks/:id
// @access  Private (Teacher/Admin)
exports.deleteMark = async (req, res) => {
  try {
    const record = await Mark.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Marks record not found.'
      });
    }

    await Mark.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Marks record deleted successfully.'
    });
  } catch (error) {
    console.error('Error deleting mark:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting mark.'
    });
  }
};

const axios = require('axios');
const Attendance = require('../models/Attendance');
const Mark = require('../models/Mark');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-2.5-flash',
];

/**
 * Fetch the logged-in user's real data from MongoDB and return a summary string.
 * Keeps it concise to stay within free-tier token limits.
 */
const fetchUserContext = async (user) => {
  const role = (user.role || '').toLowerCase();
  const userId = user._id;
  const enrollment = user.enrollment || '';
  const name = user.name || 'User';
  const department = user.department || '';
  const semester = user.semester || '';

  let dataContext = `\n\n--- CURRENT USER DATA ---\nName: ${name}\nRole: ${role}\nDepartment: ${department}\nSemester: ${semester}\nEnrollment: ${enrollment}\n`;

  try {
    if (role === 'student' && enrollment) {
      // 1. Attendance summary by subject
      const attendanceRecords = await Attendance.find({ enrollment }).lean();
      if (attendanceRecords.length > 0) {
        const subjectStats = {};
        for (const rec of attendanceRecords) {
          if (!subjectStats[rec.subject]) {
            subjectStats[rec.subject] = { total: 0, present: 0, absent: 0, late: 0 };
          }
          subjectStats[rec.subject].total++;
          if (rec.status === 'Present') subjectStats[rec.subject].present++;
          else if (rec.status === 'Absent') subjectStats[rec.subject].absent++;
          else if (rec.status === 'Late') subjectStats[rec.subject].late++;
        }
        dataContext += '\nAttendance Summary:\n';
        for (const [subj, stats] of Object.entries(subjectStats)) {
          const pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
          dataContext += `- ${subj}: ${stats.present}/${stats.total} present (${pct}%), ${stats.absent} absent, ${stats.late} late\n`;
        }
      } else {
        dataContext += '\nAttendance: No records found yet.\n';
      }

      // 2. Marks/Grades
      const marks = await Mark.find({ enrollment }).lean();
      if (marks.length > 0) {
        dataContext += '\nMarks/Grades:\n';
        for (const m of marks) {
          dataContext += `- ${m.subject} (${m.exam}): ${m.marksObtained || m.score}/${m.maxMarks || '?'}${m.grade ? ' [Grade: ' + m.grade + ']' : ''}\n`;
        }
      } else {
        dataContext += '\nMarks: No marks recorded yet.\n';
      }

      // 3. Assignments (pending + submitted)
      const assignments = await Assignment.find({
        department: { $in: [department, 'All Departments'] },
        status: 'Published',
      }).sort({ dueDate: -1 }).limit(10).lean();

      const submissions = await Submission.find({ studentEnrollment: enrollment }).lean();
      const submittedIds = new Set(submissions.map(s => s.assignmentId.toString()));

      if (assignments.length > 0) {
        dataContext += '\nRecent Assignments:\n';
        for (const a of assignments) {
          const submitted = submittedIds.has(a._id.toString());
          const sub = submitted ? submissions.find(s => s.assignmentId.toString() === a._id.toString()) : null;
          let line = `- ${a.title} (${a.subject}) — Due: ${a.dueDate} ${a.dueTime} — Priority: ${a.priority}`;
          if (submitted) {
            line += ` — SUBMITTED`;
            if (sub?.marks) line += ` — Marks: ${sub.marks}`;
            if (sub?.feedback) line += ` — Feedback: ${sub.feedback}`;
          } else {
            line += ` — NOT SUBMITTED`;
          }
          dataContext += line + '\n';
        }
      }

    } else if (role === 'faculty' || role === 'teacher') {
      // Faculty: show classes they teach, recent attendance sessions
      const assignments = await Assignment.find({ facultyId: userId })
        .sort({ createdAt: -1 }).limit(5).lean();
      if (assignments.length > 0) {
        dataContext += '\nYour Recent Assignments:\n';
        for (const a of assignments) {
          const subCount = (a.submissions || []).length;
          dataContext += `- ${a.title} (${a.subject}) — Due: ${a.dueDate} — Submissions: ${subCount} — Status: ${a.status}\n`;
        }
      }

      const attendanceSessions = await Attendance.find({ facultyId: userId })
        .sort({ date: -1 }).limit(20).lean();
      if (attendanceSessions.length > 0) {
        const dates = [...new Set(attendanceSessions.map(a => a.date))].slice(0, 5);
        dataContext += `\nRecent Attendance Sessions: ${dates.join(', ')}\n`;
        dataContext += `Total attendance records marked by you: ${attendanceSessions.length}\n`;
      }

    } else if (role === 'admin') {
      // Admin: show overview counts
      const User = require('../models/User');
      const [studentCount, facultyCount, assignmentCount, attendanceCount] = await Promise.all([
        User.countDocuments({ role: 'student' }),
        User.countDocuments({ role: { $in: ['faculty', 'teacher'] } }),
        Assignment.countDocuments({}),
        Attendance.countDocuments({}),
      ]);
      dataContext += `\nPlatform Overview:\n- Total Students: ${studentCount}\n- Total Faculty: ${facultyCount}\n- Total Assignments: ${assignmentCount}\n- Total Attendance Records: ${attendanceCount}\n`;
    }
  } catch (err) {
    console.warn('[AI Chatbot] Error fetching user data:', err.message);
    dataContext += '\n(Could not fetch some user data)\n';
  }

  return dataContext;
};

const buildSystemContext = (role, userDataContext) =>
  `You are a helpful and smart AI assistant for CampusAI, a college management platform.

Roles:
- STUDENT: Dashboard, attendance, assignments, marks, notes/materials, messages to faculty, profile, settings.
- TEACHER: Dashboard, manage classes, create assignments, mark attendance, gradebook, upload materials, notices, messages.
- ADMIN: Full platform control — students, faculty, courses, subjects, classes, attendance, marks, notices, events, materials, assignments, timetables, messages.

Current user is a ${role.toUpperCase()}.

You have access to this user's REAL DATA from the database below. Use it to give personalized, data-driven answers. For example, if a student asks "how is my attendance?", reference their actual attendance percentages. If they ask about marks, reference their actual scores.

${userDataContext}

Guidelines:
- Give personalized answers using the real data above.
- Be encouraging but honest about areas that need improvement.
- Suggest specific actions the user can take within the CampusAI platform.
- Keep answers concise and use bullet points for steps.
- If the data section shows "No records found", tell the user data hasn't been recorded yet.
- Only answer questions about the CampusAI application and the user's academic data.`;

const callModel = async (apiKey, modelName, body, timeoutMs) => {
  const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${apiKey}`;
  const response = await axios.post(url, body, { timeout: timeoutMs });
  const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error('Empty response');
  return reply;
};

/**
 * POST /api/ai-chatbot/ask
 */
const askChatbot = async (req, res) => {
  const { message, role = 'student', history = [] } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message is required.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'GEMINI_API_KEY is not configured.' });
  }

  // Fetch real user data from MongoDB
  const userDataContext = await fetchUserContext(req.user);
  const systemContext = buildSystemContext(role, userDataContext);

  const contents = [];
  for (const h of (history || [])) {
    contents.push({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: message.trim() }] });

  const body = {
    systemInstruction: { parts: [{ text: systemContext }] },
    contents,
    generationConfig: { maxOutputTokens: 600, temperature: 0.7 },
  };

  const envModel = process.env.GEMINI_MODEL;
  const modelsToTry = envModel ? [envModel, ...MODELS.filter(m => m !== envModel)] : MODELS;

  let lastError;
  for (const modelName of modelsToTry) {
    try {
      const reply = await callModel(apiKey, modelName, body, 35000);
      console.log(`[AI Chatbot] OK — ${modelName}`);
      return res.status(200).json({ success: true, reply });
    } catch (err) {
      const status = err?.response?.status;
      console.warn(`[AI Chatbot] ${modelName} failed (${status || 'timeout'}): ${err?.response?.data?.error?.message || err?.message}`);
      lastError = err;
      if (status === 401 || status === 403) break;
    }
  }

  console.error('[AI Chatbot] All models failed:', lastError?.message);
  return res.status(500).json({
    success: false,
    message: 'AI service is temporarily unavailable. Please try again in a moment.',
  });
};

/**
 * GET /api/ai-chatbot/test
 */
const testChatbot = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'GEMINI_API_KEY not set.' });

  const results = [];
  for (const modelName of MODELS) {
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
        generationConfig: { maxOutputTokens: 10 },
      };
      const reply = await callModel(apiKey, modelName, body, 30000);
      results.push({ model: modelName, status: 'ok', reply });
      return res.status(200).json({ success: true, keyPrefix: apiKey.substring(0, 8) + '...', workingModel: modelName, results });
    } catch (err) {
      results.push({ model: modelName, status: 'error', error: err?.response?.data?.error?.message || err?.message });
    }
  }
  return res.status(500).json({ success: false, message: 'All models failed.', results });
};

/**
 * GET /api/ai-chatbot/models
 */
const listModels = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'GEMINI_API_KEY not set.' });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await axios.get(url, { timeout: 15000 });
    const models = (response.data?.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({ name: m.name, displayName: m.displayName }));
    return res.status(200).json({ success: true, count: models.length, models });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.response?.data?.error?.message || err?.message });
  }
};

module.exports = { askChatbot, testChatbot, listModels };

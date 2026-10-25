const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');
const FacultySubjectAssignment = require('../models/FacultySubjectAssignment');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Admin = require('../models/Admin');
const { sendEmail, getPasswordResetTemplate } = require('../utils/sendEmail');
const { getSemesterQueryFilter, normalizeSemester } = require('../utils/academicHelper');

// Helper to generate a short-lived access JWT
// JWT payload contains { userId, role, sessionId }
const generateAccessToken = (user, sessionId = null) => {
  const userId = user._id ? user._id.toString() : user.toString();
  const role = user.role === 'teacher' ? 'faculty' : (user.role || 'student');
  const payload = {
    userId,
    role
  };
  if (sessionId) {
    payload.sessionId = sessionId.toString();
  }
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'campus_ai_super_secret_jwt_key_2026',
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m'
    }
  );
};

// Helper to generate a secure random refresh token & its SHA-256 hash
const generateRefreshToken = () => {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
};

// Cookie options for HttpOnly refresh cookie
const getRefreshCookieOptions = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
  };
};

// @desc    Register a new student
// @route   POST /api/auth/register-student
// @access  Public
exports.registerStudent = async (req, res) => {
  try {
    const { name, enrollment, email, course, semester, department, classSection, section, password } = req.body;

    if (!name || !enrollment) {
      return res.status(400).json({
        success: false,
        message: 'Name and Enrollment number are required.'
      });
    }

    const cleanEnrollment = enrollment.trim();
    const existingUser = await User.findOne({
      role: 'student',
      enrollment: { $regex: new RegExp(`^${cleanEnrollment}$`, 'i') }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A student with this enrollment number already exists.'
      });
    }

    // Hash password with bcrypt into passwordHash (NEVER store plaintext password)
    let passwordHash = undefined;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    }

    const cleanSection = (classSection || section || '').trim();

    const user = await User.create({
      name: name.trim(),
      role: 'student',
      enrollment: cleanEnrollment,
      email: email ? email.trim() : '',
      course: course || '',
      semester: semester || '',
      department: department || '',
      classSection: cleanSection,
      section: cleanSection,
      passwordHash
    });

    res.status(201).json({
      success: true,
      message: 'Student registration successful!',
      user: user.toSafeObject()
    });
  } catch (error) {
    console.error('Error in registerStudent:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error registering student.'
    });
  }
};

// @desc    Register a new faculty member with academic mapping
// @route   POST /api/auth/register-faculty
// @access  Public
exports.registerFaculty = async (req, res) => {
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
      subject,
      password
    } = req.body;

    if (!name || !username) {
      return res.status(400).json({
        success: false,
        message: 'Name and Username are required.'
      });
    }

    const cleanUsername = username.trim();
    const existingUser = await User.findOne({
      role: { $in: ['faculty', 'teacher'] },
      username: { $regex: new RegExp(`^${cleanUsername}$`, 'i') }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A faculty member with this username already exists.'
      });
    }

    // Hash password with bcrypt into passwordHash (NEVER store plaintext password)
    let passwordHash = undefined;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    }

    const resolvedSec = (classSection || section || 'A').trim();
    const resolvedSubj = (assignedSubject || subject || '').trim();
    const resolvedDept = department || 'AIML';
    const resolvedSem = semester ? String(semester) : '7';

    const user = await User.create({
      name: name.trim(),
      role: 'faculty',
      username: cleanUsername,
      email: email ? email.trim() : '',
      department: resolvedDept,
      semester: resolvedSem,
      classSection: resolvedSec,
      section: resolvedSec,
      assignedSubject: resolvedSubj,
      passwordHash
    });

    // Automatically create / sync FacultySubjectAssignment if assigned subject is provided
    if (resolvedSubj) {
      const semNum = Number(resolvedSem) || 1;
      await FacultySubjectAssignment.findOneAndUpdate(
        {
          facultyId: user._id,
          subject: resolvedSubj,
          department: resolvedDept,
          semester: semNum
        },
        {
          $set: {
            facultyId: user._id,
            facultyName: user.name,
            facultyUsername: user.username,
            department: resolvedDept,
            semester: semNum,
            classSection: resolvedSec,
            subject: resolvedSubj,
            status: 'Active'
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Faculty registration and academic mapping successful!',
      user: user.toSafeObject()
    });
  } catch (error) {
    console.error('Error in registerFaculty:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error registering faculty.'
    });
  }
};

// Helper to issue session in MongoDB and sign JWT access token
const issueSessionAndTokens = async (user, req, res, roleLabel) => {
  // 1. Generate secure refresh token & hash it with SHA-256
  const { rawToken, tokenHash } = generateRefreshToken();

  // 2. Store individual session/token record in MongoDB Session collection
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const session = await Session.create({
    userId: user._id,
    userName: user.name || user.username || 'User',
    role: user.role === 'teacher' ? 'faculty' : user.role,
    sessionToken: rawToken,
    refreshTokenHash: tokenHash,
    status: 'active',
    expiresAt,
    userAgent: req.headers['user-agent'] || '',
    ipAddress: req.ip || req.socket?.remoteAddress || ''
  });

  // 3. Generate short-lived JWT access token tied directly to this MongoDB session
  const accessToken = generateAccessToken(user, session._id);

  // 4. Send raw refresh token in secure HttpOnly cookie
  res.cookie('refreshToken', rawToken, getRefreshCookieOptions());

  // 5. Return safe user info + access token
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DevAuth Login] User: ${user.name} | Role: ${user.role} | ID: ${user._id} | Session: ${session._id}`);
  }

  const label = roleLabel || (user.role.charAt(0).toUpperCase() + user.role.slice(1));
  return res.status(200).json({
    success: true,
    message: `${label} login successful!`,
    accessToken,
    token: accessToken, // for backwards compatibility
    user: user.toSafeObject()
  });
};

// @desc    Login Admin
// @route   POST /api/auth/login/admin
// @access  Public
exports.loginAdmin = async (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.username || req.body.email || '').trim();
    const password = req.body.password;

    if (!identifier) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Retrieve the admin record from the database
    const user = await User.findOne({
      role: 'admin',
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') }
      ]
    }).select('+passwordHash +password');

    // If user is not found, return 401 Unauthorized: Invalid credentials
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Retrieve stored hashed password
    const storedHash = user.passwordHash || user.password;
    if (!storedHash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Strictly verify entered plaintext password against stored hash using bcrypt
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, storedHash);
    } catch (err) {
      isMatch = false;
    }

    // If bcrypt.compare returns false, immediately block the login
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // ONLY generate and return the JWT token if bcrypt comparison strictly returns true
    return await issueSessionAndTokens(user, req, res, 'Admin');
  } catch (error) {
    console.error('Error in loginAdmin:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during admin login.'
    });
  }
};

// @desc    Login Faculty / Teacher
// @route   POST /api/auth/login/faculty
// @access  Public
exports.loginFaculty = async (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.username || req.body.email || '').trim();
    const password = req.body.password;

    if (!identifier) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Retrieve faculty record from database based on provided username/email
    const user = await User.findOne({
      role: { $in: ['faculty', 'teacher'] },
      $or: [
        { username: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') },
        { name: new RegExp(`^${identifier}$`, 'i') }
      ]
    }).select('+passwordHash +password');

    // If faculty is not found, return 401 Unauthorized: Invalid credentials
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Retrieve stored hashed password
    const storedHash = user.passwordHash || user.password;
    if (!storedHash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Strictly verify entered plaintext password against stored hash using bcrypt
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, storedHash);
    } catch (err) {
      isMatch = false;
    }

    // If bcrypt.compare returns false, immediately block the login
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // ONLY generate and return the JWT token if bcrypt comparison strictly returns true
    return await issueSessionAndTokens(user, req, res, 'Faculty');
  } catch (error) {
    console.error('Error in loginFaculty:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during faculty login.'
    });
  }
};

// @desc    Login Student
// @route   POST /api/auth/login/student
// @access  Public
exports.loginStudent = async (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.enrollment || req.body.email || req.body.username || '').trim();
    const password = req.body.password;

    if (!identifier) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Retrieve student record from database based on provided enrollment/email/username
    const user = await User.findOne({
      role: 'student',
      $or: [
        { enrollment: new RegExp(`^${identifier}$`, 'i') },
        { email: new RegExp(`^${identifier}$`, 'i') },
        { username: new RegExp(`^${identifier}$`, 'i') },
        { name: new RegExp(`^${identifier}$`, 'i') }
      ]
    }).select('+passwordHash +password');

    // If student is not found, return 401 Unauthorized: Invalid credentials
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Retrieve stored hashed password
    const storedHash = user.passwordHash || user.password;
    if (!storedHash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Strictly verify entered plaintext password against stored hash using bcrypt
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, storedHash);
    } catch (err) {
      isMatch = false;
    }

    // If bcrypt.compare returns false, immediately block the login
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // ONLY generate and return the JWT token if bcrypt comparison strictly returns true
    return await issueSessionAndTokens(user, req, res, 'Student');
  } catch (error) {
    console.error('Error in loginStudent:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during student login.'
    });
  }
};

// @desc    Unified Login user (Student, Faculty, Admin)
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  const role = (req.body.role || '').toLowerCase();

  if (role === 'admin') {
    return exports.loginAdmin(req, res);
  }
  if (role === 'faculty' || role === 'teacher') {
    return exports.loginFaculty(req, res);
  }
  if (role === 'student') {
    return exports.loginStudent(req, res);
  }

  // If no role is explicitly passed in body, resolve by identifier
  const rawId = (req.body.identifier || req.body.username || req.body.enrollment || req.body.email || '').trim();
  if (rawId.toLowerCase() === 'admin') {
    return exports.loginAdmin(req, res);
  }

  const matchedUser = await User.findOne({
    $or: [
      { enrollment: new RegExp(`^${rawId}$`, 'i') },
      { username: new RegExp(`^${rawId}$`, 'i') },
      { email: new RegExp(`^${rawId}$`, 'i') }
    ]
  });

  if (matchedUser) {
    if (matchedUser.role === 'admin') return exports.loginAdmin(req, res);
    if (matchedUser.role === 'student') return exports.loginStudent(req, res);
    if (matchedUser.role === 'faculty' || matchedUser.role === 'teacher') return exports.loginFaculty(req, res);
  }

  return res.status(400).json({
    success: false,
    message: 'Valid user role (student, faculty, or admin) and login identifier are required.'
  });
};

// @desc    Refresh session & generate new access token
// @route   POST /api/auth/refresh
// @access  Public (Requires valid HttpOnly refresh cookie)
exports.refresh = async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;

    if (!rawRefreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token provided.'
      });
    }

    // Hash the incoming raw token to look up in MongoDB Session collection
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const session = await Session.findOne({
      refreshTokenHash: tokenHash,
      revokedAt: null
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or revoked session. Please log in again.'
      });
    }

    // Check if session has expired
    if (new Date() > new Date(session.expiresAt)) {
      await Session.findByIdAndUpdate(session._id, { revokedAt: new Date(), status: 'expired' });
      return res.status(401).json({
        success: false,
        message: 'Session has expired. Please log in again.'
      });
    }

    // Fetch user associated with session
    const user = await User.findById(session.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists.'
      });
    }

    // Generate new short-lived access JWT tied to this session
    const accessToken = generateAccessToken(user, session._id);

    return res.status(200).json({
      success: true,
      accessToken,
      token: accessToken, // backwards compatibility
      user: user.toSafeObject()
    });
  } catch (error) {
    console.error('Error in refresh:', error);
    res.status(500).json({
      success: false,
      message: 'Server error refreshing session.'
    });
  }
};

// @desc    Get current authenticated user profile
// @route   GET /api/auth/me
// @access  Private (Requires valid JWT access token)
exports.getMe = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized.'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    // NEVER return passwordHash or password
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DevAuth Verified] User: ${user.name} | Role: ${user.role} | ID: ${user._id}`);
    }

    return res.status(200).json({
      success: true,
      user: user.toSafeObject()
    });
  } catch (error) {
    console.error('Error in getMe:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error fetching user profile.'
    });
  }
};

// @desc    Logout current session
// @route   POST /api/auth/logout
// @access  Public / Private
exports.logout = async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;

    if (rawRefreshToken) {
      const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
      // Revoke this specific session in MongoDB
      await Session.findOneAndUpdate(
        { refreshTokenHash: tokenHash, revokedAt: null },
        { revokedAt: new Date(), status: 'revoked' }
      );
    }

    // Also revoke session matching Bearer token if provided
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const secret = process.env.JWT_SECRET || 'campus_ai_super_secret_jwt_key_2026';
        const decoded = jwt.verify(token, secret);
        if (decoded.sessionId) {
          await Session.findByIdAndUpdate(decoded.sessionId, { revokedAt: new Date(), status: 'revoked' });
        } else if (decoded.userId) {
          await Session.findOneAndUpdate(
            { userId: decoded.userId, revokedAt: null },
            { revokedAt: new Date(), status: 'revoked' },
            { sort: { createdAt: -1 } }
          );
        }
      } catch (tokenErr) {
        // Token might already be expired or invalid
      }
    }

    // Clear HttpOnly refresh cookie
    res.clearCookie('refreshToken', getRefreshCookieOptions());

    if (process.env.NODE_ENV !== 'production') {
      console.log('[DevAuth Logout] Session revoked and cookie cleared.');
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (error) {
    console.error('Error in logout:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout.'
    });
  }
};

// @desc    Logout from all devices (revoke all active sessions for current user)
// @route   POST /api/auth/logout-all
// @access  Private (Requires valid JWT access token)
exports.logoutAll = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;

    if (userId) {
      // Revoke all active sessions for this user in MongoDB
      await Session.updateMany(
        { userId, revokedAt: null },
        { revokedAt: new Date(), status: 'revoked' }
      );
    }

    // Clear HttpOnly refresh cookie
    res.clearCookie('refreshToken', getRefreshCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'All active sessions have been revoked successfully.'
    });
  } catch (error) {
    console.error('Error in logoutAll:', error);
    res.status(500).json({
      success: false,
      message: 'Server error revoking sessions.'
    });
  }
};

// @desc    Get all students
// @desc    Get students (filtered for faculty to only mapped group, full for admin)
// @route   GET /api/auth/students
// @access  Private
exports.getStudents = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const { department, semester, division, section } = req.query;
    let query = { role: { $in: ['student', 'Student'] } };

    // 1. Department Filtering
    const rawDept = (department || (userRole !== 'admin' ? req.user?.department : '') || '').trim();
    if (rawDept && rawDept.toLowerCase() !== 'all' && rawDept !== 'All Departments') {
      const escapedDept = rawDept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { department: { $regex: new RegExp(`^${escapedDept}$`, 'i') } },
        { course: { $regex: new RegExp(`^${escapedDept}$`, 'i') } }
      ];
    }

    // 2. Semester Filtering
    const rawSem = (semester || (userRole !== 'admin' ? req.user?.semester : '') || '').trim();
    if (rawSem && rawSem.toLowerCase() !== 'all') {
      const semFilter = getSemesterQueryFilter(rawSem);
      if (Object.keys(semFilter).length > 0) {
        query.semester = semFilter;
      } else {
        query.semester = { $regex: new RegExp(rawSem, 'i') };
      }
    }

    // Role safety for students: can only see their own record
    if (userRole === 'student') {
      query._id = req.user._id;
    }

    const students = await User.find(query).sort({ enrollment: 1, name: 1 });

    // 3. Division / Section Filtering
    const rawDiv = (division || section || (userRole !== 'admin' ? req.user?.classSection || req.user?.section : '') || '').trim();
    const cleanDiv = rawDiv.replace(/^(Section|Division)\s+/i, '').trim();

    let filteredStudents = students;
    if (cleanDiv && cleanDiv.toLowerCase() !== 'all' && cleanDiv.toLowerCase() !== 'general') {
      filteredStudents = students.filter((s) => {
        const sSec = (s.classSection || s.section || '').trim().replace(/^(Section|Division)\s+/i, '');
        if (sSec) {
          return sSec.toLowerCase() === cleanDiv.toLowerCase();
        }
        // If student has no section explicitly recorded in DB, include them in 'A'
        return cleanDiv.toLowerCase() === 'a';
      });
    }

    const formatted = filteredStudents.map((s) => ({
      _id: s._id.toString(),
      id: s._id.toString(),
      name: s.name || 'Student',
      enrollment: s.enrollment || s.username || '',
      department: s.department || s.course || '',
      semester: s.semester || '',
      classSection: s.classSection || s.section || 'General',
      section: s.section || s.classSection || 'General',
      email: s.email || ''
    }));

    // Total matching records count
    const totalRecords = formatted.length;

    // Pagination: page and limit
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.limit !== undefined
      ? Math.max(0, parseInt(req.query.limit, 10))
      : (req.query.page ? 10 : 0);

    const paginated = limit > 0
      ? formatted.slice((page - 1) * limit, page * limit)
      : formatted;
    const totalPages = limit > 0 ? Math.ceil(totalRecords / limit) : 1;

    res.status(200).json({
      success: true,
      count: paginated.length,
      totalRecords,
      currentPage: page,
      totalPages,
      limit: limit || totalRecords,
      data: paginated,
      students: paginated
    });
  } catch (error) {
    console.error('Error in getStudents:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching students.'
    });
  }
};

// @desc    Get all faculty
// @route   GET /api/auth/faculty
// @access  Private
exports.getFaculty = async (req, res) => {
  try {
    const query = { role: { $in: ['faculty', 'teacher', 'Faculty', 'Teacher'] } };
    const totalRecords = await User.countDocuments(query);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.limit !== undefined
      ? Math.max(0, parseInt(req.query.limit, 10))
      : (req.query.page ? 10 : 0);

    let facultyQuery = User.find(query).sort({ createdAt: -1 });
    if (limit > 0) {
      facultyQuery = facultyQuery.skip((page - 1) * limit).limit(limit);
    }

    const faculty = await facultyQuery;
    const totalPages = limit > 0 ? Math.ceil(totalRecords / limit) : 1;

    res.status(200).json({
      success: true,
      count: faculty.length,
      totalRecords,
      currentPage: page,
      totalPages,
      limit: limit || totalRecords,
      data: faculty.map((f) => f.toSafeObject())
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching faculty.'
    });
  }
};

// @desc    Forgot Password - Request reset link across Student, Faculty, and Admin models
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid registered email address.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Search for provided email across ALL THREE database models: Student, Faculty, and Admin
    const userModels = [
      { name: 'Student', model: Student },
      { name: 'Faculty', model: Faculty },
      { name: 'Admin', model: Admin }
    ];

    let user = null;
    let userRole = null;
    let MatchedModel = null;

    for (const item of userModels) {
      if (item.model) {
        const found = await item.model.findOne({ email: cleanEmail });
        if (found) {
          user = found;
          userRole = item.name;
          MatchedModel = item.model;
          break;
        }
      }
    }

    // Fallback: If not found in individual models, check unified User model if present
    if (!user && User) {
      const foundInUser = await User.findOne({ email: cleanEmail });
      if (foundInUser) {
        user = foundInUser;
        userRole = foundInUser.role ? (foundInUser.role.charAt(0).toUpperCase() + foundInUser.role.slice(1)) : 'User';
        MatchedModel = User;
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address across Student, Faculty, or Admin records.'
      });
    }

    // 2. Generate a secure, URL-safe random reset token using crypto
    const rawResetToken = crypto.randomBytes(32).toString('hex');

    // 3. Hash the token with SHA-256 and store on the user document along with 15-minute expiration
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(rawResetToken)
      .digest('hex');

    const expireTime = Date.now() + 15 * 60 * 1000; // 15 minutes

    user.resetPasswordToken = hashedResetToken;
    user.resetPasswordExpire = expireTime;
    await user.save({ validateBeforeSave: false });

    // 4. Construct reset link using FRONTEND_URL: ${process.env.FRONTEND_URL}/reset-password/${resetToken}
    const frontendBaseUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL).replace(/\/+$/, '');
    const resetUrl = `${frontendBaseUrl}/reset-password/${rawResetToken}`;

    // 5. Send email containing reset link via Brevo SMTP
    const textMessage = `You requested a password reset for your Campus AI (${userRole}) account.\n\nPlease click or open the link below to set a new password:\n${resetUrl}\n\nThis link will expire in 15 minutes.\nIf you did not request this, please disregard this email.`;
    const htmlMessage = getPasswordResetTemplate(user.name || userRole, resetUrl, 15);

    try {
      await sendEmail({
        to: user.email,
        subject: 'Campus AI - Password Reset Request',
        text: textMessage,
        html: htmlMessage
      });

      return res.status(200).json({
        success: true,
        message: 'Password reset link has been sent to your email.'
      });
    } catch (emailError) {
      console.error('Brevo SMTP email sending failed:', emailError);

      // Revert token fields on failure so user is not locked in invalid state
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        message: 'Failed to send password reset email. Please ensure Brevo SMTP credentials are valid.'
      });
    }
  } catch (error) {
    console.error('Error in forgotPassword controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error processing password reset.'
    });
  }
};

// @desc    Reset password using token across Student, Faculty, and Admin models
// @route   POST /api/auth/reset-password/:token
// @route   PUT /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is required in URL parameters.'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a new password.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match.'
      });
    }

    // 1. Hash the incoming URL token to compare with the SHA-256 hash stored in DB
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // 2. Search across ALL THREE database models (Student, Faculty, Admin)
    const userModels = [
      { name: 'Student', model: Student },
      { name: 'Faculty', model: Faculty },
      { name: 'Admin', model: Admin }
    ];

    let user = null;
    let userRole = null;
    let MatchedModel = null;

    for (const item of userModels) {
      if (item.model) {
        const found = await item.model.findOne({
          resetPasswordToken: hashedResetToken,
          resetPasswordExpire: { $gt: Date.now() }
        }).select('+password +passwordHash +resetPasswordToken +resetPasswordExpire');

        if (found) {
          user = found;
          userRole = item.name;
          MatchedModel = item.model;
          break;
        }
      }
    }

    // Fallback: If not found in individual models, check unified User model
    if (!user && User) {
      const foundInUser = await User.findOne({
        resetPasswordToken: hashedResetToken,
        resetPasswordExpire: { $gt: Date.now() }
      }).select('+password +passwordHash +resetPasswordToken +resetPasswordExpire');

      if (foundInUser) {
        user = foundInUser;
        userRole = foundInUser.role ? (foundInUser.role.charAt(0).toUpperCase() + foundInUser.role.slice(1)) : 'User';
        MatchedModel = User;
      }
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired. Please request a new link.'
      });
    }

    // 3. Hash the new password using bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 4. Update that specific user's record and clear reset token & expiration
    user.password = hashedPassword;
    user.passwordHash = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully! You can now log in with your new password.',
      role: userRole
    });
  } catch (error) {
    console.error('Error in resetPassword controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error resetting password.'
    });
  }
};


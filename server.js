const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with robust CORS settings
const io = new Server(server, {
  cors: {
    origin: [process.env.CLIENT_URL || 'http://localhost:3000', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST']
  }
});
app.set('io', io);

// Setup Socket.io real-time chat event handlers
const { setupChatSocket } = require('./socket/chatSocket');
setupChatSocket(io);

const cookieParser = require('cookie-parser');

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://campus-ai-frontend-five.vercel.app'
].filter(Boolean).map(url => url.replace(/\/$/, ''));

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(normalized)) {
      return callback(null, true);
    }
    return callback(null, true); // Allow dev access
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json()); // Body parser

// Route files
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const timetableRoutes = require('./routes/timetableRoutes');
const noticeRoutes = require('./routes/noticeRoutes');
const eventRoutes = require('./routes/eventRoutes');
const materialRoutes = require('./routes/materialRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const markRoutes = require('./routes/markRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const messageRoutes = require('./routes/messageRoutes');
const courseRoutes = require('./routes/courseRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const classRoutes = require('./routes/classRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const searchRoutes = require('./routes/searchRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const studentRoutes = require('./routes/studentRoutes');
const facultyRoutes = require('./routes/facultyRoutes');
const aiChatbotRoutes = require('./routes/aiChatbotRoutes');

// Middleware for route protection
const { protect } = require('./middleware/auth');

// Root API Route
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: "Backend API is running perfectly!" });
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/students', protect, studentRoutes);
app.use('/api/faculty', protect, facultyRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/timetable', protect, timetableRoutes);
app.use('/api/notices', protect, noticeRoutes);
app.use('/api/announcements', protect, announcementRoutes);
app.use('/api/events', protect, eventRoutes);
app.use('/api/materials', protect, materialRoutes);
app.use('/api/attendance', protect, attendanceRoutes);
app.use('/api/marks', protect, markRoutes);
app.use('/api/analytics', protect, analyticsRoutes);
app.use('/api/assignments', protect, assignmentRoutes);
app.use('/api/messages', protect, messageRoutes);
app.use('/api/chat', protect, chatRoutes);
app.use('/api/courses', protect, courseRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/classes', protect, classRoutes);
app.use('/api/ai-chatbot', protect, aiChatbotRoutes);

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Backend API is running successfully!',
    timestamp: new Date().toISOString()
  });
});

// Fallback 404 for unknown API routes
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `API Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 5000;
const { startAutoExpireCron } = require('./utils/autoExpireCron');

server.listen(PORT, () => {
  console.log('Server with Socket.io running on port ' + PORT);
  // Start auto-expire background monitor
  startAutoExpireCron();
});
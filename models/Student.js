const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide student name'],
      trim: true
    },
    role: {
      type: String,
      default: 'student'
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      trim: true,
      lowercase: true
    },
    password: {
      type: String,
      select: false
    },
    passwordHash: {
      type: String,
      select: false
    },
    enrollment: {
      type: String,
      trim: true,
      sparse: true
    },
    department: {
      type: String,
      default: ''
    },
    course: {
      type: String,
      default: ''
    },
    semester: {
      type: String,
      default: ''
    },
    classSection: {
      type: String,
      default: ''
    },
    section: {
      type: String,
      default: ''
    },
    avatar: {
      type: String,
      default: ''
    },
    // Academic Performance metrics strictly capped at 10.0 scale
    cgpa: {
      type: Number,
      min: [0, 'CGPA cannot be less than 0.0'],
      max: [10, 'CGPA cannot exceed 10.0'],
      default: 0
    },
    gpa: {
      type: Number,
      min: [0, 'GPA cannot be less than 0.0'],
      max: [10, 'GPA cannot exceed 10.0'],
      default: 0
    },
    resetPasswordToken: {
      type: String,
      select: false
    },
    resetPasswordExpire: {
      type: Date,
      select: false
    }
  },
  {
    timestamps: true
  }
);

// Pre-save validation & clamping to ensure CGPA strictly stays at or below 10.0
StudentSchema.pre('save', function (next) {
  if (this.cgpa !== undefined && this.cgpa !== null) {
    this.cgpa = Math.min(Math.max(Number(this.cgpa), 0), 10.0);
  }
  if (this.gpa !== undefined && this.gpa !== null) {
    this.gpa = Math.min(Math.max(Number(this.gpa), 0), 10.0);
  }
  if (typeof next === 'function') {
    next();
  }
});

module.exports = mongoose.models.Student || mongoose.model('Student', StudentSchema);

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

module.exports = mongoose.models.Student || mongoose.model('Student', StudentSchema);

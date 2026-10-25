const mongoose = require('mongoose');

const FacultySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide faculty name'],
      trim: true
    },
    role: {
      type: String,
      default: 'faculty'
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      trim: true,
      lowercase: true
    },
    username: {
      type: String,
      trim: true,
      sparse: true
    },
    password: {
      type: String,
      select: false
    },
    passwordHash: {
      type: String,
      select: false
    },
    department: {
      type: String,
      default: ''
    },
    // Requirement 1: Allow Multiple Subjects and Semesters for a Single Teacher
    assignedSubjects: [
      {
        subject: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Subject',
          required: [true, 'Subject reference is required']
        },
        semester: {
          type: Number,
          required: [true, 'Semester number is required'],
          min: 1,
          max: 8
        },
        course: {
          type: String,
          required: [true, 'Course name is required'],
          trim: true
        },
        classSection: {
          type: String,
          trim: true,
          default: 'A'
        }
      }
    ],
    // Legacy single assignment fields preserved for backward compatibility
    assignedSubject: {
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

module.exports = mongoose.models.Faculty || mongoose.model('Faculty', FacultySchema);

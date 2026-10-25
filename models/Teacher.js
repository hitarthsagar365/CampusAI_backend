const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AssignedSubjectItemSchema = new mongoose.Schema(
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
  },
  { _id: true, timestamps: true }
);

const TeacherSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide teacher name'],
      trim: true
    },
    role: {
      type: String,
      default: 'teacher',
      enum: ['teacher', 'faculty']
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
    // Requirement 1: Multiple subjects and semesters for a single teacher
    assignedSubjects: [AssignedSubjectItemSchema],

    // Legacy fields preserved for backward compatibility
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

// Method to verify password strictly using bcrypt
TeacherSchema.methods.matchPassword = async function (enteredPassword) {
  const hash = this.passwordHash || this.password;
  if (!hash || !enteredPassword) return false;
  try {
    return await bcrypt.compare(enteredPassword, hash);
  } catch (err) {
    return false;
  }
};

// Safe serializer (strips passwords)
TeacherSchema.methods.toSafeObject = function () {
  return {
    id: this._id.toString(),
    _id: this._id.toString(),
    name: this.name,
    email: this.email || '',
    username: this.username || '',
    department: this.department || '',
    role: this.role || 'teacher',
    assignedSubjects: this.assignedSubjects || [],
    assignedSubject: this.assignedSubject || (this.assignedSubjects?.[0]?.subject?.name || ''),
    semester: this.semester || (this.assignedSubjects?.[0]?.semester ? `Semester ${this.assignedSubjects[0].semester}` : ''),
    classSection: this.classSection || this.assignedSubjects?.[0]?.classSection || 'A',
    avatar: this.avatar || '',
    createdAt: this.createdAt
  };
};

module.exports = mongoose.models.Teacher || mongoose.model('Teacher', TeacherSchema);

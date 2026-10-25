const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true
    },
    role: {
      type: String,
      enum: ['student', 'faculty', 'teacher', 'admin'],
      required: [true, 'Please specify a role']
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    // Store ONLY passwordHash; never store plaintext passwords
    passwordHash: {
      type: String,
      select: false
    },
    // Legacy support for existing records during migration
    password: {
      type: String,
      select: false
    },
    resetPasswordToken: {
      type: String,
      select: false
    },
    resetPasswordExpire: {
      type: Date,
      select: false
    },
    enrollment: {
      type: String,
      trim: true,
      sparse: true
    },
    username: {
      type: String,
      trim: true,
      sparse: true
    },
    department: {
      type: String,
      enum: ['AIML', 'Cyber Security', 'All Departments', ''],
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
      trim: true,
      default: ''
    },
    section: {
      type: String,
      trim: true,
      default: ''
    },
    assignedSubject: {
      type: String,
      trim: true,
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
    }
  },
  {
    timestamps: true
  }
);

// Pre-save validation & clamping to ensure CGPA strictly stays at or below 10.0
UserSchema.pre('save', function (next) {
  if (this.cgpa !== undefined && this.cgpa !== null) {
    this.cgpa = Math.min(Math.max(Number(this.cgpa), 0), 10.0);
  }
  if (this.gpa !== undefined && this.gpa !== null) {
    this.gpa = Math.min(Math.max(Number(this.gpa), 0), 10.0);
  }
  next();
});

// Method to verify password strictly using bcrypt
UserSchema.methods.matchPassword = async function (enteredPassword) {
  const hash = this.passwordHash || this.password;
  if (!hash || !enteredPassword) return false;
  try {
    return await bcrypt.compare(enteredPassword, hash);
  } catch (err) {
    return false;
  }
};

// Safe user serializer (NEVER returns password or passwordHash)
UserSchema.methods.toSafeObject = function () {
  return {
    id: this._id.toString(),
    _id: this._id.toString(),
    name: this.name,
    email: this.email || '',
    username: this.username || '',
    enrollment: this.enrollment || '',
    department: this.department || '',
    course: this.course || '',
    semester: this.semester || '',
    classSection: this.classSection || this.section || '',
    assignedSubject: this.assignedSubject || (this.assignedSubjects?.[0]?.subject?.name || ''),
    assignedSubjects: this.assignedSubjects || [],
    cgpa: this.cgpa !== undefined && this.cgpa !== null ? Math.min(Math.max(Number(this.cgpa), 0), 10.0) : 0,
    gpa: this.gpa !== undefined && this.gpa !== null ? Math.min(Math.max(Number(this.gpa), 0), 10.0) : 0,
    avatar: this.avatar || '',
    role: this.role === 'teacher' ? 'faculty' : this.role,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', UserSchema);

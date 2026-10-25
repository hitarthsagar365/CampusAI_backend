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
    }
  },
  {
    timestamps: true
  }
);

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
    avatar: this.avatar || '',
    role: this.role === 'teacher' ? 'faculty' : this.role,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', UserSchema);

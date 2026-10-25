const mongoose = require('mongoose');

const SemesterEvaluationSchema = new mongoose.Schema(
  {
    semester: {
      type: String,
      required: true
    },
    sgpa: {
      type: Number,
      min: [0, 'SGPA cannot be less than 0.0'],
      max: [10, 'SGPA cannot exceed 10.0'],
      required: true
    },
    percentage: {
      type: Number,
      min: [0, 'Percentage cannot be less than 0.0'],
      max: [100, 'Percentage cannot exceed 100.0'],
      default: 0
    },
    totalObtained: {
      type: Number,
      default: 0
    },
    totalMax: {
      type: Number,
      default: 0
    },
    examsCount: {
      type: Number,
      default: 0
    }
  },
  { _id: false }
);

const PerformanceSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    enrollment: {
      type: String,
      required: [true, 'Student enrollment number is required'],
      trim: true,
      index: true
    },
    studentName: {
      type: String,
      trim: true,
      default: ''
    },
    department: {
      type: String,
      default: ''
    },
    currentSemester: {
      type: String,
      default: ''
    },
    // Cumulative Grade Point Average strictly capped between 0.0 and 10.0
    cgpa: {
      type: Number,
      required: [true, 'CGPA is required'],
      min: [0, 'CGPA cannot be less than 0.0'],
      max: [10, 'CGPA cannot exceed 10.0'],
      default: 0
    },
    overallPercentage: {
      type: Number,
      min: [0, 'Overall percentage cannot be less than 0.0'],
      max: [100, 'Overall percentage cannot exceed 100.0'],
      default: 0
    },
    totalMarksObtained: {
      type: Number,
      default: 0
    },
    totalMaxMarks: {
      type: Number,
      default: 0
    },
    totalEvaluations: {
      type: Number,
      default: 0
    },
    semesterEvaluations: [SemesterEvaluationSchema],
    strongestSubject: {
      name: { type: String, default: 'N/A' },
      percentage: { type: Number, default: 0 },
      grade: { type: String, default: '—' }
    },
    weakestSubject: {
      name: { type: String, default: 'N/A' },
      percentage: { type: Number, default: 0 },
      grade: { type: String, default: '—' }
    }
  },
  {
    timestamps: true
  }
);

// Pre-save validation & clamping to ensure CGPA and SGPA strictly stay <= 10.0
PerformanceSchema.pre('save', function (next) {
  if (this.cgpa !== undefined && this.cgpa !== null) {
    this.cgpa = Math.min(Math.max(Number(this.cgpa), 0), 10.0);
  }
  if (this.semesterEvaluations && Array.isArray(this.semesterEvaluations)) {
    this.semesterEvaluations.forEach((sem) => {
      if (sem.sgpa !== undefined && sem.sgpa !== null) {
        sem.sgpa = Math.min(Math.max(Number(sem.sgpa), 0), 10.0);
      }
    });
  }
  next();
});

module.exports = mongoose.models.Performance || mongoose.model('Performance', PerformanceSchema);

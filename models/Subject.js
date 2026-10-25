const mongoose = require('mongoose');

const SubjectSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Subject code is required'],
      trim: true
    },
    name: {
      type: String,
      required: [true, 'Subject name is required'],
      trim: true
    },
    dept: {
      type: String,
      default: 'All Departments',
      trim: true
    },
    course: {
      type: String,
      trim: true,
      default: ''
    },
    semester: {
      type: Number,
      min: 1,
      max: 8
    },
    type: {
      type: String,
      required: [true, 'Subject type is required'],
      trim: true,
      default: 'Core'
    }
  },
  {
    timestamps: true
  }
);

// Pre-save hook: sync course and dept if one is provided
SubjectSchema.pre('save', function (next) {
  if (!this.course && this.dept && this.dept !== 'All Departments') {
    this.course = this.dept;
  }
  if ((!this.dept || this.dept === 'All Departments') && this.course) {
    this.dept = this.course;
  }
  next();
});

module.exports = mongoose.models.Subject || mongoose.model('Subject', SubjectSchema);

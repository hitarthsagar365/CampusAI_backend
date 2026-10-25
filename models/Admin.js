const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide admin name'],
      trim: true
    },
    role: {
      type: String,
      default: 'admin'
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

module.exports = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);

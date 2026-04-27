const mongoose = require('mongoose');
const { normalizeRole } = require('../utils/roles');

const UserSchema = new mongoose.Schema({

  name: { 
    type: String, 
    required: [true, 'Please add a name'], 
    trim: true 
  },
  email: { 
    type: String, 
    required: [true, 'Please add an email'], 
    unique: true, 
    lowercase: true 
  },
  mobile: { 
    type: String, 
    required: [true, 'Please add a mobile number'] 
    // Removed unique: true here to prevent "Ghost Index" errors during testing
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 8,
    select: false 
    // I removed the strict Regex 'match' so you can use simpler passwords for testing.
    // You can add it back after the demo is stable!
  },
  
  // Demographics
  gender: { 
    type: String, 
    enum: ['Male', 'Female', 'Other'],
    default: 'Male' 
  },
  dob: { 
    type: String, // Changed from Date to String to prevent "Cast Error" from React
    required: [true, 'Please add a date of birth'] 
  },
  
  // Role-Based System
  role: { 
    type: String, 
    enum: ['donor', 'ngo', 'delivery_partner', 'admin'],
    default: 'donor',
    set: normalizeRole
  },
  otp: { type: String },
otpExpire: { type: Date },
  
  
  // Status & Security
  isVerified: { type: Boolean, default: false }, 
  kycStatus: {
    type: String,
    enum: ['not_required', 'pending', 'approved', 'rejected'],
    default: 'not_required'
  },
  isBlocked: { type: Boolean, default: false },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  impactPoints: { type: Number, default: 0 },
  availabilityStatus: {
    type: String,
    enum: ['available', 'busy', 'offline'],
    default: 'available'
  },
  govtIdUrl: { type: String, default: '' },
  organizationName: { type: String, default: '' },
  photo: { type: String, default: '' },
  city: { type: String, default: '' },
  coupons: {
    type: [String],
    default: []
  },
  bio: {
    type: String,
    default: ''
  },
  vehicleType: {
    type: String,
    default: ''
  },
  preferredRadiusKm: {
    type: Number,
    default: 10
  },
  workingDays: {
    type: [String],
    default: []
  },
  shiftStart: {
    type: String,
    default: ''
  },
  shiftEnd: {
    type: String,
    default: ''
  },
  deliveryCapacityPerDay: {
    type: Number,
    default: 6
  },
  trustScore: {
    type: Number,
    default: 80
  },
  kycNotes: {
    type: String,
    default: ''
  },
  approvalHistory: {
    type: [{
      action: String,
      note: String,
      actorName: String,
      createdAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  suspensionReason: {
    type: String,
    default: ''
  },
  
  address: { 
    type: String, 
    required: [true, 'Please add an address'] 
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [77.1025, 28.7041]
    }
  },
  createdAt: { type: Date, default: Date.now }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

UserSchema.index({ location: '2dsphere' });

// Age calculation logic remains the same
UserSchema.virtual('age').get(function() {
  if (!this.dob) return 0;
  return Math.floor((new Date() - new Date(this.dob).getTime()) / 3.15576e+10);
});

module.exports = mongoose.model('User', UserSchema);

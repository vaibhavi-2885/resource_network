const mongoose = require('mongoose');

const NGORequestSchema = new mongoose.Schema({
  ngo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true
  },
  quantityNeeded: {
    type: Number,
    default: 0
  },
  unit: {
    type: String,
    default: 'units'
  },
  description: {
    type: String,
    default: ''
  },
  urgency: {
    type: String,
    enum: ['Normal', 'Urgent', 'Critical'],
    default: 'Normal'
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
  status: {
    type: String,
    enum: ['Open', 'Fulfilled', 'Closed'],
    default: 'Open'
  },
  matchedDonations: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Donation'
    }],
    default: []
  },
  fulfillmentStatus: {
    type: String,
    enum: ['Unmatched', 'Partially Matched', 'Matched', 'Delivered'],
    default: 'Unmatched'
  },
  neededBy: {
    type: Date,
    default: null
  }
}, { timestamps: true });

NGORequestSchema.index({ location: '2dsphere' });

module.exports = mongoose.models.NGORequest || mongoose.model('NGORequest', NGORequestSchema);

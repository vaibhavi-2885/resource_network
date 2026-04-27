const mongoose = require('mongoose');

const DeliveryRunSchema = new mongoose.Schema({
  donation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Donation',
    required: true
  },
  ngoRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NGORequest',
    default: null
  },
  donor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  ngo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Missed', 'Cancelled', 'Rescue Needed'],
    default: 'Scheduled'
  },
  pickupWindowStart: {
    type: Date,
    default: null
  },
  pickupWindowEnd: {
    type: Date,
    default: null
  },
  cancellationReason: {
    type: String,
    default: ''
  },
  failureReason: {
    type: String,
    default: ''
  },
  interventionNotes: {
    type: [{
      note: String,
      createdBy: String,
      createdAt: { type: Date, default: Date.now }
    }],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.models.DeliveryRun || mongoose.model('DeliveryRun', DeliveryRunSchema);

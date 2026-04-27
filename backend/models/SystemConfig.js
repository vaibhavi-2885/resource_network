const mongoose = require('mongoose');

const SystemConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    default: 'global',
    unique: true
  },
  freshnessHours: {
    type: Number,
    default: 6
  },
  matchingRadiusKm: {
    type: Number,
    default: 10
  },
  escalationEmailEnabled: {
    type: Boolean,
    default: true
  },
  escalationSmsEnabled: {
    type: Boolean,
    default: false
  },
  defaultPickupLeadHours: {
    type: Number,
    default: 2
  },
  enabledCategories: {
    type: [String],
    default: ['Food', 'Medicine', 'Clothes', 'Books', 'Toys', 'E-Waste']
  }
}, { timestamps: true });

module.exports = mongoose.models.SystemConfig || mongoose.model('SystemConfig', SystemConfigSchema);

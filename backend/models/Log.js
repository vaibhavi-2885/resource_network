const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  type: { type: String, enum: ['Email', 'SMS', 'Activity'], required: true },
  recipient: { type: String, required: true },
  trigger: { type: String, required: true }, // e.g., "NGO Verification"
  status: { type: String, default: 'Sent' },
  message: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Log', LogSchema);

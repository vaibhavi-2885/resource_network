const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['system', 'donation', 'delivery', 'request', 'verification', 'reward'],
    default: 'system'
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info'
  },
  channels: {
    type: [String],
    default: ['in_app']
  },
  link: {
    type: String,
    default: '/dashboard'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  escalatedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);

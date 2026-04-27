const Notification = require('../models/Notification');
const sendEmail = require('./sendEmail');
const sendSMS = require('./sendSMS');
const { logActivity } = require('./activityLogger');
const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');

const createNotification = async (req, payload = {}) => {
  try {
    const users = Array.isArray(payload.users) ? payload.users.filter(Boolean) : [];
    if (!users.length) {
      return [];
    }

    const notifications = await Notification.insertMany(
      users.map((userId) => ({
        user: userId,
        title: payload.title || 'Resource Network Update',
        message: payload.message || '',
        type: payload.type || 'system',
        severity: payload.severity || 'info',
        channels: payload.channels || ['in_app'],
        link: payload.link || '/dashboard'
      }))
    );

    const io = req?.app?.get('socketio');
    if (io) {
      notifications.forEach((notification) => {
        io.to(String(notification.user)).emit('notification_created', notification);
      });
    }

    const config = await SystemConfig.findOne({ key: 'global' });
    const shouldEscalateEmail = payload.channels?.includes('email') && config?.escalationEmailEnabled;
    const shouldEscalateSms = payload.channels?.includes('sms') && config?.escalationSmsEnabled;

    if (shouldEscalateEmail || shouldEscalateSms) {
      const usersWithContacts = await User.find({ _id: { $in: users } }, 'email mobile name');

      await Promise.all(usersWithContacts.map(async (user) => {
        if (shouldEscalateEmail && user.email) {
          try {
            await sendEmail({
              email: user.email,
              subject: payload.title || 'Resource Network Notification',
              message: payload.message || 'A new notification is available in Resource Network.'
            });
          } catch (error) {
            await logActivity({
              recipient: user.email,
              type: 'Email',
              trigger: payload.title || 'Notification Escalation',
              status: 'Failed',
              message: error.message
            });
          }
        }

        if (shouldEscalateSms && user.mobile) {
          try {
            await sendSMS(user.mobile.startsWith('+') ? user.mobile : `+91${user.mobile}`, payload.message || payload.title);
            await logActivity({
              recipient: user.mobile,
              type: 'SMS',
              trigger: payload.title || 'Notification Escalation',
              status: 'Sent',
              message: payload.message || ''
            });
          } catch (error) {
            await logActivity({
              recipient: user.mobile,
              type: 'SMS',
              trigger: payload.title || 'Notification Escalation',
              status: 'Failed',
              message: error.message
            });
          }
        }
      }));

      await Notification.updateMany(
        { _id: { $in: notifications.map((item) => item._id) } },
        { escalatedAt: new Date() }
      );
    }

    return notifications;
  } catch (error) {
    console.error('Notification creation failed:', error.message);
    return [];
  }
};

module.exports = {
  createNotification
};

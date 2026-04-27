const Log = require('../models/Log');

const logActivity = async ({
  type = 'Activity',
  recipient = 'system',
  trigger,
  status = 'Success',
  message = '',
  metadata = {}
}) => {
  try {
    await Log.create({
      type,
      recipient,
      trigger,
      status,
      message,
      metadata
    });
  } catch (error) {
    console.error('Activity log failed:', error.message);
  }
};

module.exports = {
  logActivity
};

const twilio = require('twilio');

const sendSMS = async (to, message) => {
    const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    
    await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE,
        to: to // Must include country code, e.g., +919876543210
    });
};

module.exports = sendSMS;
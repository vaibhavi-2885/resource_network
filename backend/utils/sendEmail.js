const nodemailer = require('nodemailer');
const Log = require('../models/Log'); // 🚀 Import the Log model

const sendEmail = async (options) => {
    // 1. Create Transporter
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER, 
          pass: process.env.EMAIL_PASS  
        }
    });

    // 2. Define Mail Options
    const mailOptions = {
        from: `"Resource Network" <${process.env.EMAIL_USER}>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html 
    };

    // 3. Send the Mail with Real-Time Logging
    try {
        await transporter.sendMail(mailOptions);
        
        // ✅ AUTO-LOGGING: Save record to DB for the Analytics Dashboard
        await Log.create({
            type: 'Email',
            recipient: options.email,
            trigger: options.subject, // This will show "NGO Verification" or "Welcome"
            status: 'Sent'
        });

        console.log(`📧 Real-time log created for: ${options.email}`);
    } catch (error) {
        console.error("❌ Nodemailer Error:", error.message);
        throw new Error("Email could not be sent");
    }
};

module.exports = sendEmail;
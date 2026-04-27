const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sendEmail = require('../utils/sendEmail');
const sendSMS = require('../utils/sendSMS');
const { normalizeRole } = require('../utils/roles');
const { logActivity } = require('../utils/activityLogger');
const Notification = require('../models/Notification');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const buildAuthPayload = (user) => ({
    success: true,
    token: generateToken(user._id),
    role: normalizeRole(user.role),
    userId: user._id,
    name: user.name
});

const sendSmsSafely = async (mobile, message) => {
    try {
        await sendSMS(mobile.startsWith('+') ? mobile : `+91${mobile}`, message);
        await logActivity({
            type: 'SMS',
            recipient: mobile,
            trigger: 'OTP Verification',
            status: 'Sent',
            message
        });
    } catch (error) {
        await logActivity({
            type: 'SMS',
            recipient: mobile,
            trigger: 'OTP Verification',
            status: 'Failed',
            message: error.message
        });
        console.error('SMS failed:', error.message);
    }
};

exports.register = async (req, res) => {
    try {
        const {
            name,
            email,
            mobile,
            password,
            gender,
            dob,
            address,
            role,
            organizationName,
            govtIdUrl,
            city,
            coordinates
        } = req.body;

        if (!name || !email || !mobile || !password || !dob || !address) {
            return res.status(400).json({ message: 'All required fields must be filled' });
        }

        const normalizedRole = normalizeRole(role);
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpire = Date.now() + 10 * 60 * 1000;
        const hashedPassword = await bcrypt.hash(password, 10);
        const locationCoordinates = Array.isArray(coordinates) && coordinates.length === 2 ? coordinates : [77.1025, 28.7041];

        let user = await User.findOne({ email: email.toLowerCase() });

        if (user && user.isVerified) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        const nextPayload = {
            name,
            email: email.toLowerCase(),
            mobile,
            password: hashedPassword,
            gender,
            dob,
            address,
            role: normalizedRole,
            otp: generatedOtp,
            otpExpire,
            isVerified: false,
            organizationName: organizationName || '',
            govtIdUrl: govtIdUrl || '',
            city: city || '',
            location: {
                type: 'Point',
                coordinates: locationCoordinates
            },
            kycStatus: normalizedRole === 'ngo' ? 'pending' : 'not_required'
        };

        if (user) {
            Object.assign(user, nextPayload);
            await user.save();
        } else {
            user = await User.create(nextPayload);
        }

        await sendSmsSafely(user.mobile, `Your Resource Network OTP is ${generatedOtp}. It is valid for 10 minutes.`);

        await logActivity({
            recipient: user.email,
            trigger: 'User Registration Started',
            message: `${user.name} started registration as ${normalizedRole}`,
            metadata: { userId: user._id, role: normalizedRole }
        });

        res.status(200).json({
            success: true,
            message: 'OTP sent to your mobile number',
            userId: user._id
        });
    } catch (error) {
        console.error('REGISTRATION ERROR:', error.message);
        res.status(500).json({ message: 'Registration failed', error: error.message });
    }
};

exports.verifyOTP = async (req, res) => {
    try {
        const { userId, otp } = req.body;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.otp !== otp || user.otpExpire < Date.now()) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpire = undefined;
        await user.save();

        try {
            await sendEmail({
                email: user.email,
                subject: 'Welcome to Resource Network',
                message: `Hello ${user.name}, your account is now active in Resource Network.`
            });
        } catch (error) {
            console.error('Welcome email failed:', error.message);
        }

        await logActivity({
            recipient: user.email,
            trigger: 'User Registration Completed',
            message: `${user.name} verified the account`,
            metadata: { userId: user._id, role: normalizeRole(user.role) }
        });

        res.status(200).json(buildAuthPayload(user));
    } catch (error) {
        res.status(500).json({ message: 'Verification failed', error: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!user.isVerified) {
            return res.status(403).json({ message: 'Please verify your mobile number first' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ message: 'Your account has been suspended. Please contact admin.' });
        }

        res.status(200).json(buildAuthPayload(user));
    } catch (error) {
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email.toLowerCase() });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
        user.resetPasswordToken = resetOtp;
        user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
        await user.save({ validateBeforeSave: false });

        await sendEmail({
            email: user.email,
            subject: 'Resource Network Password Reset OTP',
            message: `Your OTP for resetting the password is ${resetOtp}. It expires in 10 minutes.`
        });

        res.status(200).json({ success: true, message: 'OTP sent to your email' });
    } catch (error) {
        res.status(500).json({ message: 'Error', error: error.message });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, password } = req.body;

        const user = await User.findOne({
            email: email.toLowerCase(),
            resetPasswordToken: otp,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        user.password = await bcrypt.hash(password, 10);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Reset failed', error: error.message });
    }
};

exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({
            success: true,
            data: {
                ...user.toObject(),
                role: normalizeRole(user.role)
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Auth error', error: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const allowedUpdates = {
            name: req.body.name,
            mobile: req.body.mobile,
            address: req.body.address,
            city: req.body.city,
            photo: req.body.photo,
            availabilityStatus: req.body.availabilityStatus,
            organizationName: req.body.organizationName,
            bio: req.body.bio,
            vehicleType: req.body.vehicleType,
            preferredRadiusKm: req.body.preferredRadiusKm,
            workingDays: req.body.workingDays,
            shiftStart: req.body.shiftStart,
            shiftEnd: req.body.shiftEnd
        };

        Object.keys(allowedUpdates).forEach((key) => allowedUpdates[key] === undefined && delete allowedUpdates[key]);

        const user = await User.findByIdAndUpdate(req.user.id, allowedUpdates, {
            new: true,
            runValidators: true
        });

        res.status(200).json({
            success: true,
            data: {
                ...user.toObject(),
                role: normalizeRole(user.role)
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Update failed', error: error.message });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.user.id })
            .sort({ createdAt: -1 })
            .limit(30);

        res.status(200).json({
            success: true,
            data: notifications,
            unreadCount: notifications.filter((item) => !item.isRead).length
        });
    } catch (error) {
        res.status(500).json({ message: 'Unable to fetch notifications', error: error.message });
    }
};

exports.markNotificationsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { user: req.user.id, isRead: false },
            { isRead: true }
        );

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Unable to update notifications', error: error.message });
    }
};

exports.verifyNGO = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user || normalizeRole(user.role) !== 'ngo') {
            return res.status(400).json({ message: 'Invalid NGO account' });
        }

        user.isVerified = true;
        user.kycStatus = 'approved';
        await user.save();

        try {
            await sendEmail({
                email: user.email,
                subject: 'Resource Network NGO Verification Approved',
                message: `Hello ${user.name}, your NGO account has been approved and is now active.`
            });
        } catch (error) {
            console.error('Approval email failed:', error.message);
        }

        await logActivity({
            recipient: user.email,
            trigger: 'NGO Verification Approved',
            message: `${user.name} was approved by admin`,
            metadata: { ngoId: user._id }
        });

        res.status(200).json({ success: true, message: 'NGO verified successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Verification failed', error: error.message });
    }
};

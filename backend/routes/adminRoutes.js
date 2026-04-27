const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Donation = require('../models/Donation');
const Log = require('../models/Log');
const SystemConfig = require('../models/SystemConfig');
const NGORequest = require('../models/NGORequest');
const DeliveryRun = require('../models/DeliveryRun');
const { protect, authorize } = require('../middleware/authMiddleware');
const { normalizeRole } = require('../utils/roles');
const { logActivity } = require('../utils/activityLogger');
const { generateSimplePdfBuffer } = require('../utils/pdfReport');
const { recommendPartners } = require('../utils/matchingEngine');

router.use(protect, authorize('admin'));

router.get('/stats', async (req, res) => {
    try {
        const users = await User.find({}, 'role isVerified kycStatus');
        const donations = await Donation.find({}, 'quantityValue status');

        const donors = users.filter((user) => normalizeRole(user.role) === 'donor').length;
        const ngos = users.filter((user) => normalizeRole(user.role) === 'ngo' && user.kycStatus === 'approved').length;
        const deliveryPartners = users.filter((user) => normalizeRole(user.role) === 'delivery_partner').length;
        const impactTotal = donations
            .filter((donation) => donation.status === 'Delivered')
            .reduce((acc, curr) => acc + (Number(curr.quantityValue) || 0), 0);

        res.status(200).json({
            donors,
            ngos,
            deliveryPartners,
            donations: donations.length,
            impactMetric: impactTotal,
            pendingNGOs: users.filter((user) => normalizeRole(user.role) === 'ngo' && user.kycStatus === 'pending').length,
            activeDeliveries: donations.filter((donation) => ['Assigned', 'Picked Up', 'In Transit'].includes(donation.status)).length
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching dashboard statistics', error: error.message });
    }
});

router.get('/live-donations', async (req, res) => {
    try {
        const liveFeed = await Donation.find()
            .populate('donor', 'name email')
            .populate('claimedBy', 'name organizationName')
            .populate('assignedPartner', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json(liveFeed);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching live feed', error: error.message });
    }
});

router.get('/analytics', async (req, res) => {
    try {
        const categoryTotals = await Donation.aggregate([
            {
                $group: {
                    _id: '$category',
                    value: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    name: '$_id',
                    value: 1
                }
            }
        ]);

        const requestHotspots = await NGORequest.aggregate([
            { $match: { status: 'Open' } },
            {
                $group: {
                    _id: '$category',
                    openRequests: { $sum: 1 },
                    urgentRequests: {
                        $sum: {
                            $cond: [{ $in: ['$urgency', ['Urgent', 'Critical']] }, 1, 0]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    category: '$_id',
                    openRequests: 1,
                    urgentRequests: 1
                }
            }
        ]);

        res.status(200).json({
            categoryTotals,
            requestHotspots
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching analytics', error: error.message });
    }
});

router.get('/users', async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 }).lean();
        const payload = users.map((user) => ({
            ...user,
            role: normalizeRole(user.role)
        }));
        res.status(200).json(payload);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user list', error: error.message });
    }
});

router.put('/verify-ngo/:id', async (req, res) => {
    try {
        const ngo = await User.findById(req.params.id);
        if (!ngo || normalizeRole(ngo.role) !== 'ngo') {
            return res.status(404).json({ message: 'NGO not found' });
        }

        ngo.isVerified = true;
        ngo.kycStatus = 'approved';
        if (req.body.note) {
            ngo.kycNotes = req.body.note;
        }
        ngo.approvalHistory.push({
            action: 'approved',
            note: req.body.note || 'Approved by admin',
            actorName: req.user.name
        });
        await ngo.save();

        await logActivity({
            recipient: ngo.email,
            trigger: 'NGO Approved By Admin',
            message: `${ngo.name} approved from admin dashboard`,
            metadata: { ngoId: ngo._id }
        });

        res.status(200).json({ message: 'NGO verified', user: ngo });
    } catch (error) {
        res.status(500).json({ message: 'Verification failed', error: error.message });
    }
});

router.put('/reject-ngo/:id', async (req, res) => {
    try {
        const ngo = await User.findById(req.params.id);
        if (!ngo || normalizeRole(ngo.role) !== 'ngo') {
            return res.status(404).json({ message: 'NGO not found' });
        }

        ngo.isVerified = false;
        ngo.kycStatus = 'rejected';
        ngo.kycNotes = req.body.note || ngo.kycNotes;
        ngo.approvalHistory.push({
            action: 'rejected',
            note: req.body.note || 'Rejected by admin',
            actorName: req.user.name
        });
        await ngo.save();

        res.status(200).json({ message: 'NGO rejected', user: ngo });
    } catch (error) {
        res.status(500).json({ message: 'Rejection failed', error: error.message });
    }
});

router.put('/suspend/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.isBlocked = !user.isBlocked;
        user.suspensionReason = user.isBlocked ? (req.body.reason || 'Suspended by admin') : '';
        await user.save();

        res.status(200).json({
            message: user.isBlocked ? 'User suspended' : 'User restored',
            user: {
                ...user.toObject(),
                role: normalizeRole(user.role)
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Action failed', error: error.message });
    }
});

router.delete('/user/:id', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'User deleted permanently' });
    } catch (error) {
        res.status(500).json({ message: 'Delete failed', error: error.message });
    }
});

router.get('/config', async (req, res) => {
    try {
        const config = await SystemConfig.findOneAndUpdate(
            { key: 'global' },
            {},
            { upsert: true, new: true }
        );
        res.status(200).json(config);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch config', error: error.message });
    }
});

router.put('/config', async (req, res) => {
    try {
        const config = await SystemConfig.findOneAndUpdate(
            { key: 'global' },
            {
                freshnessHours: Number(req.body.freshnessHours) || 6,
                matchingRadiusKm: Number(req.body.matchingRadiusKm) || 10,
                escalationEmailEnabled: req.body.escalationEmailEnabled !== undefined ? Boolean(req.body.escalationEmailEnabled) : undefined,
                escalationSmsEnabled: req.body.escalationSmsEnabled !== undefined ? Boolean(req.body.escalationSmsEnabled) : undefined,
                defaultPickupLeadHours: Number(req.body.defaultPickupLeadHours) || 2,
                enabledCategories: Array.isArray(req.body.enabledCategories) ? req.body.enabledCategories : undefined
            },
            { upsert: true, new: true, runValidators: true }
        );
        res.status(200).json(config);
    } catch (error) {
        res.status(500).json({ message: 'Failed to update config', error: error.message });
    }
});

router.get('/logs', async (req, res) => {
    try {
        const logs = await Log.find().sort({ createdAt: -1 }).limit(100);
        res.status(200).json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch logs', error: error.message });
    }
});

router.get('/heatmap', async (req, res) => {
    try {
        const requests = await NGORequest.find({ status: 'Open' }).populate('ngo', 'organizationName city');
        const heatmap = requests.map((request) => ({
            id: request._id,
            category: request.category,
            urgency: request.urgency,
            city: request.ngo?.city || 'Unknown',
            ngo: request.ngo?.organizationName || 'NGO',
            coordinates: request.location?.coordinates || [],
            quantityNeeded: request.quantityNeeded,
            unit: request.unit
        }));

        res.status(200).json(heatmap);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch heatmap data', error: error.message });
    }
});

router.get('/impact-report', async (req, res) => {
    try {
        const [userCount, deliveredCount, openRequests, logsCount] = await Promise.all([
            User.countDocuments(),
            Donation.countDocuments({ status: 'Delivered' }),
            NGORequest.countDocuments({ status: 'Open' }),
            Log.countDocuments()
        ]);

        const deliveredVolume = await Donation.aggregate([
            { $match: { status: 'Delivered' } },
            { $group: { _id: null, total: { $sum: '$quantityValue' } } }
        ]);

        res.status(200).json({
            generatedAt: new Date().toISOString(),
            summary: {
                totalUsers: userCount,
                deliveredDonations: deliveredCount,
                openNgoRequests: openRequests,
                communicationLogs: logsCount,
                deliveredVolume: deliveredVolume[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch impact report', error: error.message });
    }
});

router.get('/impact-report/pdf', async (req, res) => {
    try {
        const [users, deliveredCount, openRequests, logsCount] = await Promise.all([
            User.countDocuments(),
            Donation.countDocuments({ status: 'Delivered' }),
            NGORequest.countDocuments({ status: 'Open' }),
            Log.countDocuments()
        ]);

        const reportLines = [
            `Generated at: ${new Date().toLocaleString()}`,
            `Total users: ${users}`,
            `Delivered donations: ${deliveredCount}`,
            `Open NGO requests: ${openRequests}`,
            `Communication logs: ${logsCount}`
        ];

        const pdfBuffer = generateSimplePdfBuffer('Resource Network Impact Report', reportLines);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=\"resource-network-impact-report.pdf\"');
        res.send(pdfBuffer);
    } catch (error) {
        res.status(500).json({ message: 'Failed to generate PDF report', error: error.message });
    }
});

router.get('/expiry-monitor', async (req, res) => {
    try {
        const now = new Date();
        const donations = await Donation.find({
            status: { $in: ['Available', 'Claimed', 'Assigned', 'Picked Up', 'In Transit'] },
            $or: [
                { category: 'Food', spoilAt: { $ne: null } },
                { category: 'Medicine', expiryDate: { $ne: '' } }
            ]
        }).populate('donor', 'name').sort({ createdAt: -1 });

        const payload = donations.map((donation) => {
            let risk = 'stable';
            let detail = donation.expiryDate || 'Not applicable';

            if (donation.category === 'Food' && donation.spoilAt) {
                const diffHours = (new Date(donation.spoilAt).getTime() - now.getTime()) / (1000 * 60 * 60);
                if (diffHours <= 0) risk = 'expired';
                else if (diffHours <= 2) risk = 'critical';
                else if (diffHours <= 6) risk = 'warning';
                detail = donation.spoilAt;
            }

            if (donation.category === 'Medicine') {
                const parsed = new Date(donation.expiryDate);
                if (!Number.isNaN(parsed.getTime())) {
                    if (parsed < now) risk = 'expired';
                }
            }

            return {
                _id: donation._id,
                item: donation.item,
                category: donation.category,
                donor: donation.donor,
                status: donation.status,
                risk,
                detail
            };
        });

        res.status(200).json(payload);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch expiry monitor', error: error.message });
    }
});

router.get('/delivery-runs', async (req, res) => {
    try {
        const runs = await DeliveryRun.find()
            .populate('donation', 'item category status')
            .populate('donor', 'name')
            .populate('ngo', 'name organizationName')
            .populate('partner', 'name vehicleType')
            .sort({ createdAt: -1 });

        res.status(200).json(runs);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch delivery runs', error: error.message });
    }
});

router.get('/recommend-partners/:donationId', async (req, res) => {
    try {
        const donation = await Donation.findById(req.params.donationId);
        if (!donation) {
            return res.status(404).json({ message: 'Donation not found' });
        }

        const config = await SystemConfig.findOne({ key: 'global' });
        const partners = await User.find({ role: 'delivery_partner', isBlocked: false });
        const ranked = await recommendPartners({ donation, partners, config });

        res.status(200).json(ranked.slice(0, 10).map((item) => ({
            partnerId: item.partner._id,
            name: item.partner.name,
            vehicleType: item.partner.vehicleType,
            trustScore: item.partner.trustScore,
            distanceKm: item.distanceKm,
            capacityLeft: item.capacityLeft,
            score: item.score,
            eligible: item.eligible
        })));
    } catch (error) {
        res.status(500).json({ message: 'Failed to recommend partners', error: error.message });
    }
});

router.put('/delivery-runs/:id/intervene', async (req, res) => {
    try {
        const run = await DeliveryRun.findById(req.params.id);
        if (!run) {
            return res.status(404).json({ message: 'Delivery run not found' });
        }

        run.interventionNotes.push({
            note: req.body.note || 'Admin intervention recorded',
            createdBy: req.user.name
        });
        if (req.body.status) {
            run.status = req.body.status;
        }
        await run.save();

        res.status(200).json(run);
    } catch (error) {
        res.status(500).json({ message: 'Failed to intervene on run', error: error.message });
    }
});

module.exports = router;

const Donation = require('../models/Donation');
const NGORequest = require('../models/NGORequest');
const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');
const DeliveryRun = require('../models/DeliveryRun');
const { normalizeRole, isDeliveryPartnerRole } = require('../utils/roles');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../utils/notify');
const { recommendPartners } = require('../utils/matchingEngine');

const DEFAULT_COORDINATES = [77.1025, 28.7041];

const emitDonationUpdate = async (req, donation, message) => {
    const io = req.app.get('socketio');
    if (!io || !donation) {
        return;
    }

    const populatedDonation = await Donation.findById(donation._id)
        .populate('donor', 'name email mobile role photo')
        .populate('claimedBy', 'name email mobile role')
        .populate('assignedPartner', 'name email mobile role photo');

    [populatedDonation.donor?._id, populatedDonation.claimedBy?._id, populatedDonation.assignedPartner?._id]
        .filter(Boolean)
        .forEach((userId) => {
            io.to(String(userId)).emit('donation_status_update', {
                message,
                donation: populatedDonation
            });
        });

    io.emit('admin_activity', {
        message,
        donation: populatedDonation
    });
};

const getSystemConfig = async () => {
    const config = await SystemConfig.findOne({ key: 'global' });
    if (config) {
        return config;
    }

    return SystemConfig.create({ key: 'global' });
};

const calculateSpoilAt = (cookedTime, freshnessHours) => {
    if (!cookedTime) {
        return null;
    }

    const cookedDate = new Date(cookedTime);
    if (Number.isNaN(cookedDate.getTime())) {
        return null;
    }

    return new Date(cookedDate.getTime() + freshnessHours * 60 * 60 * 1000);
};

const ensureFoodExpiryStatus = (donation) => {
    if (donation.status === 'Delivered' || donation.status === 'Cancelled') {
        return donation.status;
    }

    if (donation.spoilAt && donation.spoilAt < new Date()) {
        donation.status = 'Expired';
    }

    return donation.status;
};

const isWithinPartnerSchedule = (user) => {
    if (!user) return true;
    if (user.availabilityStatus && user.availabilityStatus !== 'available') {
        return false;
    }

    const now = new Date();
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
    if (Array.isArray(user.workingDays) && user.workingDays.length && !user.workingDays.includes(day)) {
        return false;
    }

    if (user.shiftStart && user.shiftEnd) {
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const [startHour, startMinute] = user.shiftStart.split(':').map(Number);
        const [endHour, endMinute] = user.shiftEnd.split(':').map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;
        if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
            return false;
        }
    }

    return true;
};

exports.createDonation = async (req, res) => {
    try {
        const {
            item,
            category,
            quantityValue,
            unit,
            image,
            address,
            expiryDate,
            cookedTime,
            coordinates,
            description,
            batchNumber,
            extractedText,
            pickupWindowStart,
            pickupWindowEnd,
            vehiclePreference
        } = req.body;

        if (!item || !category || !image) {
            return res.status(400).json({ success: false, message: 'Item, category, and image are required.' });
        }

        if (category === 'Medicine' && Boolean(req.body.isExpired)) {
            return res.status(400).json({ success: false, message: 'Expired medicines cannot be posted to Resource Network.' });
        }

        const config = await getSystemConfig();
        const locationCoordinates = Array.isArray(coordinates) && coordinates.length === 2 ? coordinates : DEFAULT_COORDINATES;
        const spoilAt = category === 'Food' ? calculateSpoilAt(cookedTime, config.freshnessHours) : null;

        const newDonation = await Donation.create({
            donor: req.user.id,
            item,
            category,
            quantityValue: Number(quantityValue) || 0,
            unit: unit || 'units',
            image,
            description: description || '',
            expiryDate: expiryDate || '',
            cookedTime: cookedTime || '',
            spoilAt,
            batchNumber: batchNumber || '',
            medicineVerification: {
                extractedText: extractedText || '',
                isExpired: Boolean(req.body.isExpired)
            },
            pickupWindowStart: pickupWindowStart || null,
            pickupWindowEnd: pickupWindowEnd || null,
            vehiclePreference: vehiclePreference || '',
            status: 'Available',
            publicAddressHint: address ? `${address.split(',')[0]}, area hidden until assignment` : 'Pickup area shared after assignment',
            location: {
                type: 'Point',
                coordinates: locationCoordinates,
                address: address || 'Location pinned on map'
            }
        });

        const donor = await User.findById(req.user.id);
        if (donor) {
            donor.impactPoints += 10;
            await donor.save();
        }

        await logActivity({
            recipient: donor?.email || String(req.user.id),
            trigger: 'Donation Created',
            message: `${item} posted in ${category}`,
            metadata: { donationId: newDonation._id, donorId: req.user.id }
        });

        await createNotification(req, {
            users: [req.user.id],
            title: 'Donation Posted',
            message: `${item} is now live in Resource Network and visible to nearby NGOs.`,
            type: 'donation',
            link: '/donor-dashboard'
        });

        await emitDonationUpdate(req, newDonation, 'A new donation is now live in Resource Network.');

        res.status(201).json({ success: true, data: newDonation });
    } catch (error) {
        console.error('Donation creation error:', error.message);
        res.status(500).json({ success: false, message: 'Database error: ' + error.message });
    }
};

exports.getMyActivity = async (req, res) => {
    try {
        const donations = await Donation.find({ donor: req.user.id })
            .populate('assignedPartner', 'name photo mobile role isVerified')
            .populate('claimedBy', 'name organizationName')
            .sort({ createdAt: -1 });

        donations.forEach(ensureFoodExpiryStatus);
        await Promise.all(donations.filter((donation) => donation.isModified()).map((donation) => donation.save()));

        const user = await User.findById(req.user.id);
        const deliveredDonations = donations.filter((donation) => donation.status === 'Delivered');
        const totalWeight = donations.reduce((acc, curr) => acc + (Number(curr.quantityValue) || 0), 0);

        const rewardCount = Math.floor(deliveredDonations.length / 3);
        const coupons = [];
        for (let index = 0; index < rewardCount; index += 1) {
            coupons.push(`RN-IMPACT-${String(index + 1).padStart(3, '0')}`);
        }

        res.status(200).json({
            success: true,
            donations,
            stats: {
                totalDonations: donations.length,
                livesTouched: deliveredDonations.length,
                totalImpactUnits: totalWeight,
                impactPoints: user ? user.impactPoints : 0,
                rewardsUnlocked: coupons
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Database error: ' + error.message });
    }
};

exports.getPublicDonations = async (req, res) => {
    try {
        const donations = await Donation.find({ status: { $in: ['Available', 'Claimed', 'Assigned', 'Picked Up', 'In Transit'] } })
            .populate('donor', 'name')
            .lean();

        const blurredDonations = donations
            .filter((donation) => {
                if (donation.spoilAt && new Date(donation.spoilAt) < new Date()) {
                    return false;
                }
                return true;
            })
            .map((donation) => ({
                ...donation,
                location: {
                    type: 'Point',
                    address: donation.publicAddressHint || 'Approximate pickup area',
                    coordinates: [
                        donation.location.coordinates[0] + (Math.random() - 0.5) * 0.01,
                        donation.location.coordinates[1] + (Math.random() - 0.5) * 0.01
                    ]
                }
            }));

        res.status(200).json(blurredDonations);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getMarketplace = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const config = await getSystemConfig();
        const radiusInMeters = Number(req.query.radiusKm || config.matchingRadiusKm) * 1000;

        let query = { status: 'Available' };
        if (user?.location?.coordinates?.length === 2) {
            query = {
                ...query,
                location: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: user.location.coordinates
                        },
                        $maxDistance: radiusInMeters
                    }
                }
            };
        }

        const donations = await Donation.find(query)
            .populate('donor', 'name')
            .sort({ createdAt: -1 })
            .lean();

        const payload = donations
            .filter((donation) => !donation.spoilAt || new Date(donation.spoilAt) > new Date())
            .map((donation) => ({
                ...donation,
                location: {
                    ...donation.location,
                    address: donation.publicAddressHint || 'Approximate pickup area'
                }
            }));

        res.status(200).json({ success: true, data: payload });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.claimDonation = async (req, res) => {
    try {
        const donation = await Donation.findById(req.params.id);
        if (!donation) {
            return res.status(404).json({ message: 'Donation not found' });
        }

        if (donation.status !== 'Available') {
            return res.status(400).json({ message: 'This donation has already been claimed or is unavailable' });
        }

        donation.claimedBy = req.user.id;
        donation.status = 'Claimed';
        await donation.save();

        const ngo = await User.findById(req.user.id);
        const config = await getSystemConfig();
        const partnerPool = await User.find({ role: 'delivery_partner', isBlocked: false });
        const recommendations = await recommendPartners({ donation, partners: partnerPool, config });
        const bestPartner = recommendations.find((item) => item.eligible)?.partner || null;

        const deliveryRun = await DeliveryRun.create({
            donation: donation._id,
            donor: donation.donor,
            ngo: req.user.id,
            partner: bestPartner?._id || null,
            status: bestPartner ? 'Assigned' : 'Scheduled',
            pickupWindowStart: donation.pickupWindowStart || null,
            pickupWindowEnd: donation.pickupWindowEnd || null
        });

        if (bestPartner) {
            donation.assignedPartner = bestPartner._id;
            donation.status = 'Assigned';
            await donation.save();
        }

        const matchingRequest = await NGORequest.findOne({
            ngo: req.user.id,
            status: 'Open',
            category: donation.category
        }).sort({ createdAt: -1 });

        if (matchingRequest) {
            matchingRequest.matchedDonations = Array.from(new Set([
                ...matchingRequest.matchedDonations.map((item) => String(item)),
                String(donation._id)
            ]));
            matchingRequest.fulfillmentStatus = matchingRequest.matchedDonations.length > 1 ? 'Partially Matched' : 'Matched';
            await matchingRequest.save();

            deliveryRun.ngoRequest = matchingRequest._id;
            await deliveryRun.save();
        }

        await logActivity({
            recipient: String(req.user.id),
            trigger: 'Donation Claimed',
            message: `${donation.item} claimed by NGO`,
            metadata: { donationId: donation._id, ngoId: req.user.id }
        });

        await createNotification(req, {
            users: [donation.donor, req.user.id],
            title: 'Donation Claimed',
            message: `${donation.item} has been claimed by an NGO and is ready for delivery coordination.`,
            type: 'donation',
            severity: 'warning',
            link: normalizeRole(req.user.role) === 'ngo' ? '/ngo-dashboard' : '/donor-dashboard'
        });

        if (bestPartner) {
            await createNotification(req, {
                users: [bestPartner._id, donation.donor, ngo?._id],
                title: 'Smart Assignment Created',
                message: `${donation.item} was automatically assigned using schedule, radius, capacity, and vehicle matching.`,
                type: 'delivery',
                severity: 'warning',
                channels: ['in_app', 'email'],
                link: '/delivery-dashboard'
            });
        }

        await emitDonationUpdate(req, donation, 'An NGO has claimed a donation.');
        res.status(200).json({
            success: true,
            data: donation,
            deliveryRun,
            recommendedPartners: recommendations.slice(0, 5).map((item) => ({
                partnerId: item.partner._id,
                name: item.partner.name,
                vehicleType: item.partner.vehicleType,
                distanceKm: item.distanceKm,
                capacityLeft: item.capacityLeft,
                score: item.score,
                eligible: item.eligible
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getMyClaims = async (req, res) => {
    try {
        const donations = await Donation.find({ claimedBy: req.user.id })
            .populate('donor', 'name mobile')
            .populate('assignedPartner', 'name mobile photo')
            .sort({ updatedAt: -1 });

        res.status(200).json({ success: true, data: donations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getDeliveryTasks = async (req, res) => {
    try {
        const partner = await User.findById(req.user.id);
        const tasks = await Donation.find({
            $or: [
                { status: 'Claimed', assignedPartner: null },
                { assignedPartner: req.user.id, status: { $in: ['Assigned', 'Picked Up', 'In Transit', 'Missed Pickup', 'Rescue Needed'] } }
            ]
        })
            .populate('donor', 'name mobile address')
            .populate('claimedBy', 'name organizationName mobile address')
            .sort({ updatedAt: -1 });

        const partnerAvailableNow = isWithinPartnerSchedule(partner);

        res.status(200).json({
            success: true,
            data: tasks,
            meta: {
                partnerAvailableNow,
                availabilityStatus: partner?.availabilityStatus || 'available',
                workingDays: partner?.workingDays || [],
                shiftStart: partner?.shiftStart || '',
                shiftEnd: partner?.shiftEnd || ''
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.acceptDeliveryTask = async (req, res) => {
    try {
        const donation = await Donation.findById(req.params.id);
        if (!donation) {
            return res.status(404).json({ message: 'Donation not found' });
        }

        if (!['Claimed', 'Assigned'].includes(donation.status)) {
            return res.status(400).json({ message: 'This task is not available for assignment' });
        }

        if (donation.assignedPartner && String(donation.assignedPartner) !== req.user.id) {
            return res.status(400).json({ message: 'Another delivery partner is already assigned' });
        }

        donation.assignedPartner = req.user.id;
        donation.status = 'Assigned';
        await donation.save();

        await logActivity({
            recipient: String(req.user.id),
            trigger: 'Delivery Task Accepted',
            message: `${donation.item} accepted by delivery partner`,
            metadata: { donationId: donation._id, partnerId: req.user.id }
        });

        await createNotification(req, {
            users: [donation.donor, donation.claimedBy, req.user.id],
            title: 'Delivery Partner Assigned',
            message: `${donation.item} now has an assigned delivery partner and pickup can be coordinated.`,
            type: 'delivery',
            link: '/delivery-dashboard'
        });

        await emitDonationUpdate(req, donation, 'A delivery partner has accepted a pickup task.');
        res.status(200).json({ success: true, data: donation });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateDeliveryStatus = async (req, res) => {
    try {
        const { status, pickupProofImage, deliveryProofImage, failureReason, cancellationReason } = req.body;
        const allowedStatuses = ['Picked Up', 'In Transit', 'Delivered', 'Missed Pickup', 'Rescue Needed', 'Cancelled'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid delivery status' });
        }

        const donation = await Donation.findById(req.params.id);
        if (!donation) {
            return res.status(404).json({ message: 'Donation not found' });
        }

        if (!donation.assignedPartner || String(donation.assignedPartner) !== req.user.id) {
            return res.status(403).json({ message: 'Only the assigned delivery partner can update this task' });
        }

        donation.status = status;
        if (pickupProofImage) {
            donation.pickupProofImage = pickupProofImage;
        }
        if (deliveryProofImage) {
            donation.deliveryProofImage = deliveryProofImage;
        }
        if (failureReason) {
            donation.failureReason = failureReason;
        }
        if (cancellationReason) {
            donation.cancellationReason = cancellationReason;
        }
        if (status === 'Rescue Needed') {
            donation.rescueRequested = true;
        }
        await donation.save();

        const partner = await User.findById(req.user.id);
        if (partner && status === 'Delivered') {
            partner.impactPoints += 15;
            await partner.save();
        }

        await logActivity({
            recipient: String(req.user.id),
            trigger: 'Delivery Status Updated',
            message: `${donation.item} updated to ${status}`,
            metadata: { donationId: donation._id, partnerId: req.user.id, status }
        });

        await DeliveryRun.findOneAndUpdate(
            { donation: donation._id },
            {
                status,
                failureReason: failureReason || '',
                cancellationReason: cancellationReason || ''
            }
        );

        await createNotification(req, {
            users: [donation.donor, donation.claimedBy, req.user.id],
            title: `Delivery Status: ${status}`,
            message: `${donation.item} is now marked as ${status}.`,
            type: 'delivery',
            severity: ['Missed Pickup', 'Rescue Needed', 'Cancelled'].includes(status) ? 'critical' : 'info',
            channels: ['in_app', ...(['Missed Pickup', 'Rescue Needed'].includes(status) ? ['email'] : [])],
            link: status === 'Delivered' ? '/donor-dashboard' : '/delivery-dashboard'
        });

        if (status === 'Delivered') {
            await NGORequest.updateMany(
                { matchedDonations: donation._id },
                { fulfillmentStatus: 'Delivered', status: 'Fulfilled' }
            );
        }

        await emitDonationUpdate(req, donation, `Donation status updated to ${status}.`);
        res.status(200).json({ success: true, data: donation });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.assignDeliveryPartner = async (req, res) => {
    try {
        const { partnerId } = req.body;
        const donation = await Donation.findById(req.params.id);
        const partner = await User.findById(partnerId);

        if (!donation) {
            return res.status(404).json({ message: 'Donation not found' });
        }

        if (!partner || !isDeliveryPartnerRole(partner.role)) {
            return res.status(400).json({ message: 'Invalid delivery partner' });
        }

        donation.assignedPartner = partner._id;
        donation.status = 'Assigned';
        await donation.save();

        await DeliveryRun.findOneAndUpdate(
            { donation: donation._id },
            {
                partner: partner._id,
                status: 'Assigned',
                $push: {
                    interventionNotes: {
                        note: 'Admin manually assigned delivery partner.',
                        createdBy: 'Admin'
                    }
                }
            },
            { upsert: true }
        );

        await logActivity({
            recipient: partner.email || String(partner._id),
            trigger: 'Delivery Partner Assigned',
            message: `${partner.name} assigned to ${donation.item}`,
            metadata: { donationId: donation._id, partnerId: partner._id }
        });

        await createNotification(req, {
            users: [donation.donor, donation.claimedBy, partner._id],
            title: 'Admin Assigned Delivery Partner',
            message: `${partner.name} has been assigned to ${donation.item}.`,
            type: 'delivery',
            severity: 'warning',
            link: '/delivery-dashboard'
        });

        await emitDonationUpdate(req, donation, 'Admin assigned a delivery partner to a donation.');
        res.status(200).json({ success: true, data: donation });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getPickupDetails = async (req, res) => {
    try {
        const donation = await Donation.findById(req.params.id)
            .populate('donor', 'name mobile email address')
            .populate('claimedBy', 'name organizationName mobile email address');

        if (!donation) {
            return res.status(404).json({ message: 'Donation not found' });
        }

        const role = normalizeRole(req.user.role);
        const isAssignedPartner = donation.assignedPartner && String(donation.assignedPartner) === req.user.id;
        const isClaimingNgo = donation.claimedBy && String(donation.claimedBy) === req.user.id;

        if (!isAssignedPartner && !(role === 'admin') && !(role === 'ngo' && isClaimingNgo)) {
            return res.status(403).json({ message: 'Access denied for pickup details' });
        }

        res.status(200).json({
            success: true,
            exactCoordinates: donation.location.coordinates,
            exactAddress: donation.location.address,
            donorContact: donation.donor,
            ngoContact: donation.claimedBy
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.createNgoRequest = async (req, res) => {
    try {
        const {
            title,
            category,
            quantityNeeded,
            unit,
            description,
            urgency,
            coordinates
        } = req.body;

        if (!title || !category) {
            return res.status(400).json({ success: false, message: 'Title and category are required.' });
        }

        const request = await NGORequest.create({
            ngo: req.user.id,
            title,
            category,
            quantityNeeded: Number(quantityNeeded) || 0,
            unit: unit || 'units',
            description: description || '',
            urgency: urgency || 'Normal',
            location: {
                type: 'Point',
                coordinates: Array.isArray(coordinates) && coordinates.length === 2 ? coordinates : DEFAULT_COORDINATES
            }
        });

        const ngo = await User.findById(req.user.id);
        await logActivity({
            recipient: ngo?.email || String(req.user.id),
            trigger: 'NGO Request Created',
            message: `${title} posted with ${urgency || 'Normal'} urgency`,
            metadata: { requestId: request._id, ngoId: req.user.id }
        });

        const io = req.app.get('socketio');
        if (io) {
            io.emit('ngo_request_created', {
                message: 'A new NGO emergency request has been posted.',
                request
            });
        }

        const donors = await User.find({ role: 'donor', isBlocked: false }, '_id').lean();
        await createNotification(req, {
            users: donors.map((item) => item._id).concat([req.user.id]),
            title: 'New NGO Broadcast',
            message: `${title} was posted as an NGO request with ${urgency || 'Normal'} urgency.`,
            type: 'request',
            severity: ['Urgent', 'Critical'].includes(urgency || 'Normal') ? 'critical' : 'info',
            channels: ['in_app', ...(['Urgent', 'Critical'].includes(urgency || 'Normal') ? ['email'] : [])],
            link: '/ngo-dashboard'
        });

        res.status(201).json({ success: true, data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOpenNgoRequests = async (req, res) => {
    try {
        const requests = await NGORequest.find({ status: 'Open' })
            .populate('ngo', 'name organizationName city')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getMyNgoRequests = async (req, res) => {
    try {
        const requests = await NGORequest.find({ ngo: req.user.id }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

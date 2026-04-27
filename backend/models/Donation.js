const mongoose = require('mongoose');

const DonationSchema = new mongoose.Schema({
    donor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    claimedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    assignedPartner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    item: { type: String, required: true },
    category: { type: String, required: true },
    quantityValue: { type: Number, default: 0 },
    unit: { type: String, default: 'units' },
    image: { type: String, required: true },
    description: { type: String, default: '' },
    expiryDate: { type: String, default: '' },
    cookedTime: { type: String, default: '' },
    spoilAt: { type: Date, default: null },
    batchNumber: { type: String, default: '' },
    medicineVerification: {
        extractedText: { type: String, default: '' },
        isExpired: { type: Boolean, default: false }
    },
    pickupProofImage: { type: String, default: '' },
    deliveryProofImage: { type: String, default: '' },
    pickupWindowStart: { type: Date, default: null },
    pickupWindowEnd: { type: Date, default: null },
    cancellationReason: { type: String, default: '' },
    failureReason: { type: String, default: '' },
    rescueRequested: { type: Boolean, default: false },
    vehiclePreference: { type: String, default: '' },
    status: {
        type: String,
        enum: ['Available', 'Claimed', 'Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Expired', 'Cancelled', 'Missed Pickup', 'Rescue Needed'],
        default: 'Available'
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            default: [74.7749, 20.9042]
        },
        address: {
            type: String,
            default: 'Location pinned on map'
        }
    },
    publicAddressHint: {
        type: String,
        default: 'Pickup point available after assignment'
    }
}, { timestamps: true });

DonationSchema.index({ location: '2dsphere' });

const Donation = mongoose.models.Donation || mongoose.model('Donation', DonationSchema);

module.exports = Donation;

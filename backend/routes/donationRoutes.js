const express = require('express');
const router = express.Router();
const {
    createDonation,
    getMyActivity,
    getPublicDonations,
    getPickupDetails,
    getMarketplace,
    claimDonation,
    getMyClaims,
    getDeliveryTasks,
    acceptDeliveryTask,
    updateDeliveryStatus,
    assignDeliveryPartner,
    createNgoRequest,
    getOpenNgoRequests,
    getMyNgoRequests
} = require('../controllers/donationController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/create', protect, authorize('donor', 'admin'), createDonation);
router.get('/my-activity', protect, authorize('donor', 'admin'), getMyActivity);
router.get('/public', getPublicDonations);

router.get('/marketplace', protect, authorize('ngo', 'admin'), getMarketplace);
router.post('/:id/claim', protect, authorize('ngo', 'admin'), claimDonation);
router.get('/my-claims', protect, authorize('ngo', 'admin'), getMyClaims);

router.get('/delivery-tasks', protect, authorize('delivery_partner', 'admin'), getDeliveryTasks);
router.post('/:id/accept-task', protect, authorize('delivery_partner', 'admin'), acceptDeliveryTask);
router.post('/:id/update-status', protect, authorize('delivery_partner', 'admin'), updateDeliveryStatus);
router.post('/:id/assign-partner', protect, authorize('admin'), assignDeliveryPartner);

router.get('/requests', getOpenNgoRequests);
router.get('/my-requests', protect, authorize('ngo', 'admin'), getMyNgoRequests);
router.post('/requests', protect, authorize('ngo', 'admin'), createNgoRequest);

router.get('/pickup/:id', protect, getPickupDetails);

module.exports = router;

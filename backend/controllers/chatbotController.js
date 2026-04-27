const Donation = require('../models/Donation');
const NGORequest = require('../models/NGORequest');
const SystemConfig = require('../models/SystemConfig');
const User = require('../models/User');

const intents = [
  {
    name: 'greeting',
    keywords: ['hello', 'hi', 'hey', 'namaste', 'good morning', 'good evening']
  },
  {
    name: 'project_overview',
    keywords: ['project', 'resource network', 'system', 'platform', 'overview', 'purpose', 'what is this']
  },
  {
    name: 'donor',
    keywords: ['donor', 'post donation', 'history', 'rewards', 'impact points', 'coupon', 'wizard']
  },
  {
    name: 'medicine',
    keywords: ['medicine', 'ocr', 'expiry', 'batch', 'expired']
  },
  {
    name: 'food',
    keywords: ['food', 'freshness', 'spoil', 'countdown', 'cooked time']
  },
  {
    name: 'ngo',
    keywords: ['ngo', 'claim', 'broadcast', 'request', 'marketplace', 'urgent need']
  },
  {
    name: 'delivery',
    keywords: ['delivery', 'partner', 'pickup', 'proof', 'route', 'in transit']
  },
  {
    name: 'admin',
    keywords: ['admin', 'verification', 'kyc', 'dashboard', 'config', 'logs']
  },
  {
    name: 'map',
    keywords: ['map', 'location', 'google map', 'nearby', 'radius', 'geo', 'geospatial']
  },
  {
    name: 'analytics',
    keywords: ['analytics', 'heatmap', 'report', 'pdf', 'insights']
  },
  {
    name: 'chatbot',
    keywords: ['chatbot', 'assistant', 'what can you answer', 'help']
  }
];

const detectIntent = (query) => {
  const scored = intents.map((intent) => ({
    name: intent.name,
    score: intent.keywords.reduce((total, keyword) => total + (query.includes(keyword) ? keyword.split(' ').length : 0), 0)
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].name : 'fallback';
};

const getDynamicContext = async () => {
  const [config, deliveredCount, activeDeliveries, openRequests, userCounts, totalDonations] = await Promise.all([
    SystemConfig.findOne({ key: 'global' }),
    Donation.countDocuments({ status: 'Delivered' }),
    Donation.countDocuments({ status: { $in: ['Assigned', 'Picked Up', 'In Transit'] } }),
    NGORequest.countDocuments({ status: 'Open' }),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Donation.countDocuments()
  ]);

  const countMap = userCounts.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  return {
    config,
    deliveredCount,
    activeDeliveries,
    openRequests,
    totalDonations,
    donorCount: countMap.donor || 0,
    ngoCount: countMap.ngo || 0,
    deliveryCount: countMap.delivery_partner || countMap.volunteer || 0
  };
};

const buildReply = async (message) => {
  const query = String(message || '').toLowerCase().trim();
  const intent = detectIntent(query);
  const context = await getDynamicContext();

  switch (intent) {
    case 'greeting':
      return `Hello. Resource Network currently tracks ${context.totalDonations} donations, ${context.openRequests} open NGO requests, and ${context.activeDeliveries} active deliveries. Ask me about donor posting, NGO claims, delivery proof, maps, or analytics.`;

    case 'project_overview':
      return `Resource Network is a MERN-based resource donation platform with four roles: donor, NGO, delivery partner, and super admin. Donors post resources, NGOs claim nearby items and broadcast urgent needs, delivery partners handle pickup and proof of delivery, and admins manage KYC, risk monitoring, heatmaps, and PDF reporting.`;

    case 'donor':
      return `The donor dashboard supports a smart donation wizard, OCR-assisted medicine validation, food freshness timing, a Google Map pickup selector, live donation history, and a rewards area for impact points and coupon-style milestones. Donor history and rewards are both live sections now, not placeholder tabs.`;

    case 'medicine':
      return `Medicine uploads are OCR-checked for expiry and batch details. If the detected expiry is already in the past, the backend blocks the post before it becomes visible, which prevents expired medicine from entering the marketplace.`;

    case 'food':
      return `Food donations use freshness timing based on the admin rule, currently ${context.config?.freshnessHours || 6} hours. The donor flow stores cooked time, the system calculates spoil timing, and admin monitoring highlights warning, critical, and expired states.`;

    case 'ngo':
      return `NGOs can browse nearby donations on the marketplace, claim a resource so it disappears from public competition, and publish emergency broadcasts for items like blankets, meals, or medicines. There are currently ${context.openRequests} open NGO requests in the network.`;

    case 'delivery':
      return `Delivery partners accept claimed tasks, reveal secure pickup details only after assignment, upload pickup proof, mark in-transit movement, and upload final delivery proof at the NGO. There are ${context.activeDeliveries} active deliveries right now.`;

    case 'admin':
      return `The super admin dashboard manages NGO KYC approval, user control, system freshness rules, delivery oversight, expiry risk monitoring, and communication logs. It is built to explain security, accountability, and operational control during your presentation.`;

    case 'map':
      return `Google Maps is used across the platform for donor pickup pinning, NGO marketplace visualization, delivery route coverage, and admin analytics. The smart matching radius is currently ${context.config?.matchingRadiusKm || 10} km, and donor privacy is protected until assignment.`;

    case 'analytics':
      return `Admin analytics include category trends, request hotspots, a live-style heatmap dataset, expiry monitoring, proof-of-delivery auditing, and a downloadable impact PDF report. Delivered donations so far: ${context.deliveredCount}.`;

    case 'chatbot':
      return 'I can answer questions about project architecture, donor posting, OCR expiry validation, freshness logic, NGO broadcasts, delivery partner workflow, geospatial matching, admin controls, heatmaps, and PDF reporting.';

    default:
      if (query.includes('how') && query.includes('work')) {
        return 'The workflow is donor posts a resource, NGO claims it, delivery partner accepts the logistics task, pickup and drop proof are uploaded, and admin can audit the full chain through logs, analytics, and monitoring screens.';
      }
      return `I did not detect a narrow topic in that question, so here is the short summary: Resource Network connects ${context.donorCount} donors, ${context.ngoCount} NGOs, and ${context.deliveryCount} delivery partners through verified donation posting, nearby claiming, delivery proof, maps, and admin reporting.`;
  }
};

exports.chat = async (req, res) => {
  try {
    const reply = await buildReply(req.body.message);
    res.status(200).json({ success: true, reply });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

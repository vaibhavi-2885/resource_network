const DeliveryRun = require('../models/DeliveryRun');

const toRadians = (value) => (value * Math.PI) / 180;

const getDistanceKm = (pointA = [], pointB = []) => {
  if (pointA.length !== 2 || pointB.length !== 2) return Number.MAX_SAFE_INTEGER;
  const [lng1, lat1] = pointA;
  const [lng2, lat2] = pointB;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const isWithinShift = (partner) => {
  const now = new Date();
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];

  if (partner.availabilityStatus && partner.availabilityStatus !== 'available') return false;
  if (Array.isArray(partner.workingDays) && partner.workingDays.length && !partner.workingDays.includes(day)) return false;

  if (partner.shiftStart && partner.shiftEnd) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMinute] = partner.shiftStart.split(':').map(Number);
    const [endHour, endMinute] = partner.shiftEnd.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    if (currentMinutes < startMinutes || currentMinutes > endMinutes) return false;
  }

  return true;
};

const vehicleScore = (partner, donation) => {
  const vehicle = String(partner.vehicleType || '').toLowerCase();
  const category = String(donation.category || '').toLowerCase();

  if (!vehicle) return 1;
  if (category === 'e-waste' && ['van', 'truck'].some((item) => vehicle.includes(item))) return 5;
  if (category === 'food' && ['bike', 'scooter', 'car', 'van'].some((item) => vehicle.includes(item))) return 4;
  if (category === 'medicine' && ['bike', 'car', 'van'].some((item) => vehicle.includes(item))) return 4;
  if (category === 'clothes' || category === 'books' || category === 'toys') return 3;
  return 1;
};

const recommendPartners = async ({ donation, partners, config }) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const activeRuns = await DeliveryRun.aggregate([
    {
      $match: {
        createdAt: { $gte: todayStart, $lt: tomorrowStart },
        status: { $in: ['Scheduled', 'Assigned', 'Picked Up', 'In Transit'] }
      }
    },
    {
      $group: {
        _id: '$partner',
        count: { $sum: 1 }
      }
    }
  ]);

  const loadMap = activeRuns.reduce((acc, item) => {
    acc[String(item._id)] = item.count;
    return acc;
  }, {});

  const radius = Number(config?.matchingRadiusKm || 10);

  return partners
    .map((partner) => {
      const distanceKm = getDistanceKm(partner.location?.coordinates || [], donation.location?.coordinates || []);
      const preferredRadius = Number(partner.preferredRadiusKm || radius);
      const loadCount = loadMap[String(partner._id)] || 0;
      const capacityLeft = Math.max(0, Number(partner.deliveryCapacityPerDay || 6) - loadCount);
      const eligible = isWithinShift(partner) && capacityLeft > 0 && distanceKm <= Math.max(radius, preferredRadius);
      const score =
        (eligible ? 100 : 0) +
        Math.max(0, 35 - distanceKm * 3) +
        vehicleScore(partner, donation) * 5 +
        capacityLeft * 4 +
        Number(partner.trustScore || 80) / 10;

      return {
        partner,
        distanceKm: Number(distanceKm.toFixed(2)),
        capacityLeft,
        eligible,
        score: Number(score.toFixed(2))
      };
    })
    .sort((a, b) => b.score - a.score);
};

module.exports = {
  recommendPartners,
  getDistanceKm,
  isWithinShift
};

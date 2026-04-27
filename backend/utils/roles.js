const ROLE_ALIASES = {
  donor: 'donor',
  ngo: 'ngo',
  volunteer: 'delivery_partner',
  'delivery partner': 'delivery_partner',
  delivery_partner: 'delivery_partner',
  admin: 'admin'
};

const normalizeRole = (role) => {
  if (!role) {
    return 'donor';
  }

  const normalizedKey = String(role).trim().toLowerCase();
  return ROLE_ALIASES[normalizedKey] || normalizedKey;
};

const isDeliveryPartnerRole = (role) => normalizeRole(role) === 'delivery_partner';

const formatRoleLabel = (role) => {
  const normalized = normalizeRole(role);

  if (normalized === 'delivery_partner') {
    return 'Delivery Partner';
  }

  if (normalized === 'ngo') {
    return 'NGO';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

module.exports = {
  normalizeRole,
  isDeliveryPartnerRole,
  formatRoleLabel
};

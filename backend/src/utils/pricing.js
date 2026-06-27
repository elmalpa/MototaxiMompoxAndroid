function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === undefined || v === null || v === '')) return null;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function estimatePrice({ pickup_lat, pickup_lng, destination_lat, destination_lng }) {
  const distanceKm = haversineKm(pickup_lat, pickup_lng, destination_lat, destination_lng);
  const base = 3000;
  const perKm = 1800;
  const minimum = 5000;

  if (!distanceKm) return minimum;
  return Math.max(minimum, Math.round((base + distanceKm * perKm) / 100) * 100);
}

module.exports = { estimatePrice, haversineKm };

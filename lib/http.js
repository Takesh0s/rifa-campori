import crypto from 'node:crypto';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Normalizes untrusted form input. Length limits mirror the DB constraints so
// invalid data is rejected here with a friendly message instead of a 500.
export function parseBuyer(body) {
  const digits = String(body.phone || '').replace(/\D/g, '');
  return {
    name: String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    publicName: String(body.publicName || '').trim().slice(0, 40),
    phone: digits.length >= 10 && digits.length <= 13 ? digits : null,
    email: String(body.email || '').trim().toLowerCase().slice(0, 120),
    showOnWall: body.showOnWall !== false,
    numbers: Array.isArray(body.numbers)
      ? [...new Set(body.numbers.map(Number).filter(Number.isInteger))].slice(0, 100)
      : [],
  };
}

export const isEmail = (value) => EMAIL_RE.test(value || '');

// Salted hash of the caller IP. Lets the DB rate-limit reservations without
// storing the raw IP (personal data under LGPD).
export function clientHash(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(`${process.env.IP_HASH_SALT || ''}:${ip}`).digest('hex');
}

export function reservationParams(buyer, method, req) {
  return {
    p_numbers: buyer.numbers,
    p_name: buyer.name,
    p_public_name: buyer.publicName,
    p_phone: buyer.phone,
    p_email: buyer.email || null,
    p_method: method,
    p_show: buyer.showOnWall,
    p_client_hash: clientHash(req),
  };
}

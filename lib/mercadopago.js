import crypto from 'node:crypto';

// Mercado Pago Payments API (Pix).
// https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-configuration/integrate-pix
const PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments';
const STATEMENT_DESCRIPTOR = 'RIFA CAMPORI';

const authHeaders = () => ({
  Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
});

// MP requires an explicit offset (yyyy-MM-ddTHH:mm:ss.SSS-03:00); a trailing "Z" is rejected.
function toBrasiliaIso(date) {
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return shifted.toISOString().replace('Z', '-03:00');
}

// "5561984936058" | "61984936058" -> { area_code: "61", number: "984936058" }
function splitPhone(digits) {
  if (!digits) return undefined;
  const national = digits.length > 11 ? digits.slice(2) : digits;
  return { area_code: national.slice(0, 2), number: national.slice(2) };
}

export async function createPixPayment({ order, buyer, minutes, unitPrice }) {
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  const [firstName, ...lastNames] = buyer.name.split(' ');
  const numbersLabel = order.numbers.join(', ');

  const body = {
    transaction_amount: Number(order.amount),
    description: `Rifa Campori 2027 - numeros ${numbersLabel}`.slice(0, 250),
    payment_method_id: 'pix',
    external_reference: order.id,
    date_of_expiration: toBrasiliaIso(expiresAt),
    statement_descriptor: STATEMENT_DESCRIPTOR,
    payer: {
      email: buyer.email,
      first_name: firstName,
      last_name: lastNames.join(' ') || undefined,
    },
    additional_info: {
      items: [{
        id: 'rifa-campori-2027',
        title: 'Rifa Solidária Campori 2027',
        description: `Números ${numbersLabel}`.slice(0, 250),
        category_id: 'tickets',
        quantity: order.numbers.length,
        unit_price: Number(unitPrice),
      }],
      payer: {
        first_name: firstName,
        last_name: lastNames.join(' ') || undefined,
        phone: splitPhone(buyer.phone),
      },
    },
  };
  if (process.env.SITE_URL) body.notification_url = `${process.env.SITE_URL}/api/mp-webhook`;

  const response = await fetch(PAYMENTS_URL, {
    method: 'POST',
    // Same key on retries makes MP return the original payment instead of charging twice.
    headers: { ...authHeaders(), 'X-Idempotency-Key': order.id },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`MP ${response.status}: ${data.message || data.error || 'unknown error'}`);
  }

  const tx = data.point_of_interaction?.transaction_data || {};
  return {
    paymentId: String(data.id),
    qrCode: tx.qr_code,
    qrCodeBase64: tx.qr_code_base64,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getPayment(id) {
  const response = await fetch(`${PAYMENTS_URL}/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`MP ${response.status} fetching payment ${id}`);
  return response.json();
}

// Validates the x-signature header (HMAC-SHA256 of id, request id and timestamp).
// Without a configured secret we still accept the call: the handler never trusts
// the payload and always re-reads the payment from the MP API.
export function isValidSignature(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;

  const parts = Object.fromEntries(
    String(req.headers['x-signature'] || '').split(',').map((p) => p.trim().split('='))
  );
  if (!parts.ts || !parts.v1) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${req.headers['x-request-id'] || ''};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const received = Buffer.from(parts.v1);
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), received);
}

// Applies an MP payment to its order. Safe to call repeatedly (webhook retries,
// status polling): confirm_order is idempotent in the database.
export async function syncPayment(db, payment) {
  const orderId = payment.external_reference;
  if (!orderId || payment.status !== 'approved') return payment.status;

  const { data: order } = await db.from('orders').select('amount').eq('id', orderId).maybeSingle();
  if (!order) return 'order_not_found';
  if (Number(payment.transaction_amount) + 0.001 < Number(order.amount)) {
    console.error('[mp] amount mismatch', { orderId, paid: payment.transaction_amount, expected: order.amount });
    return 'amount_mismatch';
  }

  const { data, error } = await db.rpc('confirm_order', { p_order_id: orderId, p_payment_id: String(payment.id) });
  if (error) throw error;
  return data;
}

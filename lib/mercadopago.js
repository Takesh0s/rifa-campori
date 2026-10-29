import crypto from 'node:crypto';

// Mercado Pago Orders API (Checkout Transparente), Pix.
// https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
// Notifications are not set per request in this API: configure the webhook
// URL (topic "Order") in the application panel.
const ORDERS_URL = 'https://api.mercadopago.com/v1/orders';
const MIN_PIX_MINUTES = 30; // API minimum for expiration_time

const authHeaders = () => ({
  Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

const money = (value) => Number(value).toFixed(2);

// "5561984936058" | "61984936058" -> { area_code: "61", number: "984936058" }
function splitPhone(digits) {
  if (!digits) return undefined;
  const national = digits.length > 11 ? digits.slice(2) : digits;
  return { area_code: national.slice(0, 2), number: national.slice(2) };
}

export async function createPixOrder({ order, buyer, minutes, unitPrice }) {
  const holdMinutes = Math.max(MIN_PIX_MINUTES, minutes);
  const [firstName, ...lastNames] = buyer.name.split(' ');
  const numbersLabel = order.numbers.join(', ');

  const body = {
    type: 'online',
    processing_mode: 'automatic',
    external_reference: order.id,
    total_amount: money(order.amount),
    description: `Rifa Campori 2027 - numeros ${numbersLabel}`.slice(0, 250),
    payer: {
      email: buyer.email,
      first_name: firstName,
      last_name: lastNames.join(' ') || undefined,
      phone: splitPhone(buyer.phone),
    },
    items: [{
      title: 'Rifa Solidária Campori 2027',
      description: `Números ${numbersLabel}`.slice(0, 250),
      external_code: 'rifa-campori-2027',
      category_id: 'tickets',
      quantity: order.numbers.length,
      unit_price: money(unitPrice),
    }],
    transactions: {
      payments: [{
        amount: money(order.amount),
        payment_method: { id: 'pix', type: 'bank_transfer' },
        expiration_time: `PT${holdMinutes}M`,
      }],
    },
  };

  const response = await fetch(ORDERS_URL, {
    method: 'POST',
    // Same key on retries makes MP return the original order instead of charging twice.
    headers: { ...authHeaders(), 'X-Idempotency-Key': order.id },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.errors?.map((e) => e.code || e.message).join(', ') || data.message || 'unknown error';
    throw new Error(`MP ${response.status}: ${detail}`);
  }

  const pix = data.transactions?.payments?.[0]?.payment_method || {};
  return {
    mpOrderId: data.id,
    qrCode: pix.qr_code,
    qrCodeBase64: pix.qr_code_base64,
    expiresAt: new Date(Date.now() + holdMinutes * 60 * 1000).toISOString(),
  };
}

export async function getOrder(id) {
  const response = await fetch(`${ORDERS_URL}/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`MP ${response.status} fetching order ${id}`);
  return response.json();
}

// Validates the x-signature header (HMAC-SHA256 of id, request id and timestamp).
// Without a configured secret we still accept the call: the handler never trusts
// the payload and always re-reads the order from the MP API.
export function isValidSignature(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;

  const parts = Object.fromEntries(
    String(req.headers['x-signature'] || '').split(',').map((p) => p.trim().split('='))
  );
  if (!parts.ts || !parts.v1) return false;

  const requestId = req.headers['x-request-id'];
  const manifest = [
    dataId ? `id:${String(dataId).toLowerCase()};` : '',
    requestId ? `request-id:${requestId};` : '',
    `ts:${parts.ts};`,
  ].join('');
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const received = Buffer.from(parts.v1);
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), received);
}

const isPaid = (mpOrder) => mpOrder.status === 'processed'
  && Number(mpOrder.total_paid_amount ?? mpOrder.total_amount) >= Number(mpOrder.total_amount);

// Applies an MP order to our order. Safe to call repeatedly (webhook retries,
// status polling): confirm_order is idempotent in the database.
export async function syncOrder(db, mpOrder) {
  const orderId = mpOrder.external_reference;
  if (!orderId || !isPaid(mpOrder)) return mpOrder.status;

  const { data: order } = await db.from('orders').select('amount').eq('id', orderId).maybeSingle();
  if (!order) return 'order_not_found';
  const paid = Number(mpOrder.total_paid_amount ?? mpOrder.total_amount);
  if (paid + 0.001 < Number(order.amount)) {
    console.error('[mp] amount mismatch', { orderId, paid, expected: order.amount });
    return 'amount_mismatch';
  }

  const { data, error } = await db.rpc('confirm_order', { p_order_id: orderId, p_payment_id: String(mpOrder.id) });
  if (error) throw error;
  return data;
}

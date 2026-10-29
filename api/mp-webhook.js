import { db } from '../lib/supabase.js';
import { send, readJson } from '../lib/http.js';
import { getPayment, isValidSignature, syncPayment } from '../lib/mercadopago.js';

// POST /api/mp-webhook — Mercado Pago payment notifications.
// Only the payment id is taken from the request; status and amount are always
// re-read from the MP API, so a forged notification cannot mark anything paid.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido' });

  const body = readJson(req);
  const type = body.type || req.query?.type || req.query?.topic;
  // The signature manifest uses the id from the query string when present.
  const paymentId = req.query?.['data.id'] || body.data?.id || req.query?.id;

  if (type !== 'payment' || !paymentId) return send(res, 200, { ignored: true });
  if (!isValidSignature(req, paymentId)) return send(res, 401, { error: 'invalid signature' });

  try {
    const result = await syncPayment(db, await getPayment(paymentId));
    return send(res, 200, { result });
  } catch (err) {
    console.error('[mp-webhook]', err.message);
    // Non-2xx makes MP retry later.
    return send(res, 500, { error: 'retry' });
  }
}

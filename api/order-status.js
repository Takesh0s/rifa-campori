import { db } from '../lib/supabase.js';
import { send } from '../lib/http.js';
import { getOrder, syncOrder } from '../lib/mercadopago.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/order-status?id=<uuid> — polled by the Pix screen.
// Also asks MP directly, so a delayed or misconfigured webhook never blocks
// confirmation. Returns only the status: order ids are visible in the public
// tickets table, so nothing else about the order may leak through here.
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido' });
  const id = String(req.query?.id || '');
  if (!UUID_RE.test(id)) return send(res, 400, { error: 'Pedido inválido' });

  const { data: order } = await db.from('orders')
    .select('status, method, mp_payment_id, expires_at').eq('id', id).maybeSingle();
  if (!order) return send(res, 404, { error: 'Pedido não encontrado' });

  let { status } = order;
  if (status === 'pending' && order.method === 'pix' && order.mp_payment_id) {
    try {
      const result = await syncOrder(db, await getOrder(order.mp_payment_id));
      if (result === 'paid' || result === 'already_paid') status = 'paid';
      else if (result === 'conflict') status = 'conflict';
    } catch (err) {
      console.error('[order-status]', err.message);
    }
  }
  if (status === 'pending' && order.expires_at && new Date(order.expires_at) < new Date()) {
    await db.rpc('release_expired');
    status = 'expired';
  }
  return send(res, 200, { status });
}

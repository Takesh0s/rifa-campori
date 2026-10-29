import { db, toHttpError } from '../lib/supabase.js';
import { send, readJson, parseBuyer, reservationParams } from '../lib/http.js';

// POST /api/reserve — holds numbers for buyers who will pay in person.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido' });

  const buyer = parseBuyer(readJson(req));
  if (buyer.name.length < 2) return send(res, 400, { error: 'Informe seu nome.' });
  if (!buyer.phone) return send(res, 400, { error: 'Informe um WhatsApp válido com DDD.' });

  const { data, error } = await db.rpc('reserve_numbers', reservationParams(buyer, 'in_person', req));
  if (error) {
    const { status, ...body } = toHttpError(error);
    return send(res, status, body);
  }
  return send(res, 200, {
    code: data.code,
    numbers: data.numbers,
    amount: data.amount,
    expiresAt: data.expires_at,
    accessToken: data.access_token,
  });
}

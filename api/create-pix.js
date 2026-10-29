import { db, toHttpError } from '../lib/supabase.js';
import { send, readJson, parseBuyer, isEmail, reservationParams } from '../lib/http.js';
import { createPixPayment } from '../lib/mercadopago.js';

// POST /api/create-pix — reserves the numbers, then creates the Pix charge.
// Reserving first guarantees nobody else can take the numbers while the buyer pays.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido' });
  if (!process.env.MP_ACCESS_TOKEN) {
    return send(res, 503, { error: 'Pix automático ainda não configurado. Use a opção de pagar em mãos.' });
  }

  const buyer = parseBuyer(readJson(req));
  if (buyer.name.length < 2) return send(res, 400, { error: 'Informe seu nome.' });
  if (!buyer.phone) return send(res, 400, { error: 'Informe um WhatsApp válido com DDD.' });
  if (!isEmail(buyer.email)) return send(res, 400, { error: 'Informe um e-mail válido (o Mercado Pago exige para gerar o Pix).' });

  const { data: order, error } = await db.rpc('reserve_numbers', reservationParams(buyer, 'pix', req));
  if (error) {
    const { status, ...body } = toHttpError(error);
    return send(res, status, body);
  }

  const { data: settings } = await db.from('settings').select('pix_minutes, ticket_price').single();
  try {
    const pix = await createPixPayment({
      order,
      buyer,
      minutes: settings.pix_minutes,
      unitPrice: settings.ticket_price,
    });
    await db.from('orders').update({ mp_payment_id: pix.paymentId }).eq('id', order.id);
    return send(res, 200, {
      id: order.id,
      code: order.code,
      numbers: order.numbers,
      qrCode: pix.qrCode,
      qrCodeBase64: pix.qrCodeBase64,
      expiresAt: pix.expiresAt,
    });
  } catch (err) {
    // Release the hold so a provider outage does not lock numbers for 35 minutes.
    console.error('[create-pix]', err.message);
    await db.rpc('_cancel_order', { p_order_id: order.id, p_note: 'Falha ao gerar Pix' });
    return send(res, 502, { error: 'Não foi possível gerar o Pix agora. Tente novamente ou escolha pagar em mãos.' });
  }
}

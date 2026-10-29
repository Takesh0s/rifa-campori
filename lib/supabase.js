import { createClient } from '@supabase/supabase-js';

// Server-only client. The service_role key bypasses RLS, so this module must
// never be imported by browser code.
export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ERRORS = {
  NUMBERS_TAKEN: (d) => ({ status: 409, error: 'Alguns números acabaram de ser escolhidos por outra pessoa.', taken: d.split(',').filter(Boolean).map(Number) }),
  RATE_LIMITED: () => ({ status: 429, error: 'Você já tem reservas em aberto. Conclua o pagamento delas ou fale com o Luiz.' }),
  SALES_CLOSED: () => ({ status: 403, error: 'As vendas estão encerradas.' }),
  TOO_MANY: (d) => ({ status: 400, error: `Máximo de ${d} números por pedido.` }),
  EMPTY_SELECTION: () => ({ status: 400, error: 'Escolha pelo menos um número.' }),
  DUPLICATED_NUMBERS: () => ({ status: 400, error: 'Há números repetidos na seleção.' }),
  OUT_OF_RANGE: () => ({ status: 400, error: 'Número fora da rifa.' }),
  NAME_REQUIRED: () => ({ status: 400, error: 'Informe seu nome.' }),
  PHONE_REQUIRED: () => ({ status: 400, error: 'Informe um WhatsApp válido com DDD.' }),
};

// Maps the exception codes raised by the SQL functions to HTTP responses.
// Unknown errors are logged and returned as a generic 500 to avoid leaking internals.
export function toHttpError(error) {
  const key = Object.keys(ERRORS).find((k) => error?.message?.includes(k));
  if (key) return ERRORS[key](error.details || '');
  console.error('[db]', error);
  return { status: 500, error: 'Erro inesperado. Tente de novo em instantes.' };
}

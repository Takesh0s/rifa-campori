// Public client configuration. The anon/publishable key is designed to be
// exposed; data access is enforced by RLS and grants in supabase/schema.sql.
window.RIFA_CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_ANON_KEY',
};

// Until configured, the site runs in demo mode with local sample data.
window.RIFA_DEMO = window.RIFA_CONFIG.SUPABASE_URL.includes('SEU-PROJETO');

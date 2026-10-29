# ⛺ Rifa Solidária – Campori 2027

Site de rifa com **grade em tempo real**, **Pix automático (Mercado Pago)**, botão de **pagar em mãos pelo WhatsApp**, **barra de meta animada**, **mural de agradecimento** e **painel admin** para registrar vendas feitas fora do site.

Stack: HTML/CSS/JS puro + Supabase (Postgres, Auth, Realtime) + funções serverless da Vercel.

---

## 1. Arquitetura (como as peças conversam)

```
                 ┌──────────────────────────── navegador ────────────────────────────┐
                 │  index.html + app.js            admin.html + admin.js             │
                 │  • lê números/configs (anon)    • login Supabase Auth             │
                 │  • escuta Realtime              • lê pedidos (RLS: só admins)     │
                 │  • chama /api/*                 • chama funções admin_*           │
                 └───────┬───────────────────────────────┬───────────────────────────┘
                         │ POST /api/create-pix          │ (direto no Supabase,
                         │ POST /api/reserve             │  com o login do admin)
                         ▼                               ▼
   ┌──────── Vercel (servidor) ────────┐      ┌───────────── Supabase ──────────────┐
   │ api/create-pix.js ─┐              │      │ tickets  (300 números, público)     │
   │ api/reserve.js     ├─ service_role ────▶ │ orders   (compradores, privado)     │
   │ api/order-status.js│              │      │ settings (preço, meta, WhatsApp)    │
   │ api/mp-webhook.js ─┘              │      │ funções: reserve_numbers,           │
   └────────┬───────────────▲──────────┘      │ confirm_order, admin_* …            │
            │ cria Pix       │ "pagamento      └──────────────┬──────────────────────┘
            ▼                │  aprovado"                     │ Realtime (WebSocket)
       Mercado Pago ─────────┘                                ▼
                                                 todos os navegadores abertos
```

**Por que assim?**

| Decisão | Motivo |
|---|---|
| `tickets` separado de `orders` | A grade precisa ser pública e em tempo real, mas nome/telefone não. O público só enxerga `tickets` (número + status). |
| Escrita só por **funções SQL** (`security definer`) | O site nunca altera tabela direto. As regras (número livre? limite por pedido?) ficam num lugar só, dentro do banco. |
| `SELECT ... FOR UPDATE` na reserva | Se duas pessoas clicarem no mesmo número no mesmo segundo, só uma consegue; a outra recebe "acabou de ser escolhido". |
| Chave `service_role` só na Vercel | Ela ignora o RLS. Por isso fica em variável de ambiente, nunca no navegador nem no GitHub. |
| Webhook **reconsulta** o pagamento no MP | Não confiamos no corpo da notificação; pegamos só o ID e perguntamos ao Mercado Pago se está `approved` e com o valor certo. |
| `/api/order-status` também consulta o MP | Plano B: se o webhook atrasar, a tela do Pix confirma sozinha mesmo assim. |
| Reserva com prazo | Pix: 30 min (+5 de folga). Em mãos: 48 h. Vencido, o número volta a ficar livre automaticamente. |

**Ciclo de vida de um número**

```
available ──(Pix gerado / pedido "em mãos")──▶ reserved ──(pago)──▶ paid
    ▲                                              │
    └────────(venceu o prazo ou admin cancelou)─────┘
```

Se alguém pagar um Pix **depois** que a reserva venceu e outra pessoa já pegou o número, o pedido vira `conflict` e aparece na aba **Pedidos › Conflitos** para você resolver (trocar o número ou devolver).

---

## 2. Supabase (banco de dados)

1. Crie um projeto em <https://supabase.com> (plano Free serve).
2. Vá em **SQL Editor › New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
   - Isso cria as tabelas, as regras de segurança, as funções, liga o tempo real e **importa os 75 números da planilha** (R$ 1.125).
   - O script é **reexecutável**: sempre que ele mudar, basta rodar de novo. Ele atualiza o que já existe e nunca duplica a importação.
3. Vá em **Authentication › Users › Add user › Create new user**, crie seu login (e-mail + senha) e marque *Auto Confirm User*.
4. Em **Authentication › Sign In / Providers**, desligue **Allow new users to sign up** (ninguém mais consegue criar conta).
5. De volta ao **SQL Editor**, transforme seu usuário em admin:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'SEU_EMAIL_AQUI';
   ```
6. Em **Project Settings › API**, copie:
   - `Project URL` e `anon public` → vão no `assets/config.js`
   - `service_role` → vai **só** na Vercel (passo 4)

---

## 3. Mercado Pago (Pix automático)

1. Entre em <https://www.mercadopago.com.br/developers/panel/app> com a conta que vai receber o dinheiro e clique em **Criar aplicação** (tipo: pagamentos online / Checkout Transparente / API).
2. Em **Credenciais de produção**, copie o **Access Token** (`APP_USR-...`). Para testar antes, use as **credenciais de teste**.
3. Em **Webhooks › Configurar notificações**:
   - URL de produção: `https://SEU-SITE.vercel.app/api/mp-webhook`
   - Evento: **Pagamentos**
   - Salve e copie a **assinatura secreta** → `MP_WEBHOOK_SECRET`.
4. Sua conta precisa ter uma **chave Pix cadastrada** no Mercado Pago.

> **Custo:** a Vercel (Hobby) e o Supabase (Free) não cobram nada nesse tamanho de projeto. O Mercado Pago cobra uma taxa por Pix recebido via API (ver tabela atual no site deles). Pagamentos "em mãos" e Pix direto na sua chave do Inter não passam pelo MP, então não têm taxa.

> **Sem Mercado Pago ainda?** Pode publicar mesmo assim. Sem o `MP_ACCESS_TOKEN`, o botão de Pix mostra uma mensagem pedindo para usar "pagar em mãos" — o resto funciona normalmente.

---

## 4. Vercel (publicação)

1. Edite `assets/config.js` com a URL e a `anon key` do Supabase.
2. Suba o projeto para um repositório no GitHub.
3. Em <https://vercel.com/new>, importe o repositório (Framework: **Other**, sem build command).
4. Em **Settings › Environment Variables**, adicione (ver `.env.example`):

   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` |
   | `MP_ACCESS_TOKEN` | Access Token do Mercado Pago |
   | `MP_WEBHOOK_SECRET` | assinatura secreta do webhook |
   | `SITE_URL` | `https://seu-site.vercel.app` (sem `/` no final) |
   | `IP_HASH_SALT` | qualquer texto aleatório longo (ex.: gere em <https://1password.com/password-generator>) |

5. **Redeploy** (variáveis novas só valem depois de um novo deploy).
6. Volte ao Mercado Pago e confirme que a URL do webhook bate com o domínio final.

Páginas:
- `https://seu-site.vercel.app` → site público
- `https://seu-site.vercel.app/admin` → painel

---

## 5. Testar antes de divulgar

1. **Visual (local):** com `config.js` ainda sem preencher, rode `npx serve .` ou `python3 -m http.server` e abra `http://localhost:3000` (ou `:8000`). Abre em **modo demonstração** com os dados da planilha.
2. **Tempo real:** abra o site em duas abas. Registre uma venda no `/admin` e veja a outra aba marcar o "X", subir a barra e soltar o toast.
3. **Em mãos:** escolha um número, clique em *Pagar em mãos*. Confira que ficou amarelo (reservado) para todos, que o WhatsApp abriu com a mensagem e que o pedido apareceu em **Pedidos › Pendentes**. Confirme por lá.
4. **Pix:** com credenciais de **teste**, gere um Pix e simule o pagamento pelo painel do MP; depois troque para produção e faça um Pix real de R$ 15 para você mesmo (e cancele o pedido no admin depois, se quiser).

---

## 6. Usando o painel no dia a dia

- **Alguém pagou em dinheiro / Pix direto:** aba *Números* → clique nos números livres → preencha o nome → **Marcar como pago**.
- **Pedido "em mãos" chegou no WhatsApp e a pessoa pagou:** aba *Pedidos › Pendentes* → **✓ Pago**.
- **Desistiu / errou o número:** clique no número → **Cancelar pedido** ou *Liberar só alguns números*.
- **Nome estranho no mural:** clique no número → **Nome no mural**.
- **Mudar meta, data do sorteio, fechar vendas:** aba *Configurações*. Muda em tempo real no site.
- **Sorteio:** *Pedidos › Exportar CSV* gera a lista número → comprador (abre no Excel).

---

## 7. Segurança (o que protege o quê)

| Ameaça | Proteção |
|---|---|
| Alguém ler telefone/e-mail dos compradores | `orders` sem `SELECT` para `anon`; RLS libera só para quem está em `admins` |
| Alguém marcar número como pago pelo navegador | Nenhum `INSERT/UPDATE/DELETE` para `anon`; escrita só por funções `security definer` |
| Admin "quebrar" pedido editando direto | `UPDATE` liberado só nas colunas de exibição (nome, mural, telefone, observação) |
| Notificação de pagamento falsa | Assinatura HMAC conferida **e** pagamento sempre reconsultado na API do MP, com checagem de valor |
| Cobrança duplicada | `X-Idempotency-Key` = id do pedido |
| Uma pessoa reservar a rifa toda | Limite por IP (hash com sal, sem guardar o IP): até 5 pedidos / `max_per_order` números pendentes |
| Corrida entre duas pessoas no mesmo número | `SELECT … FOR UPDATE` em ordem crescente (também evita deadlock) |
| XSS / script de terceiros comprometido | Bibliotecas servidas localmente (`assets/vendor`), CSP `script-src 'self'`, todo texto do usuário escapado |
| Clickjacking | `frame-ancestors 'none'` |
| Função `security definer` sequestrada | `search_path = public, pg_temp` fixo em todas |

Chaves: `anon` é pública por design (vai no `config.js`); `service_role`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `IP_HASH_SALT` ficam **só** nas variáveis da Vercel.

---

## 8. Estrutura

```
├── index.html            site público
├── admin.html            painel
├── assets/
│   ├── config.js         URL + anon key do Supabase (público)
│   ├── app.js            lógica do site
│   ├── admin.js          lógica do painel
│   ├── style.css         visual (papel, barra animada, grade com "X")
│   ├── vendor/           supabase-js e canvas-confetti (versões fixas, sem CDN)
│   ├── tent.png          barraca recortada do cartaz
│   └── og.jpg            imagem de prévia do link no WhatsApp
├── api/                  funções serverless (Vercel)
│   ├── create-pix.js     reserva + gera Pix no Mercado Pago
│   ├── reserve.js        reserva para "pagar em mãos"
│   ├── order-status.js   status do pedido (com plano B consultando o MP)
│   └── mp-webhook.js     recebe notificação do MP e confirma
├── lib/                  código compartilhado das funções
├── supabase/schema.sql   banco completo + importação da planilha
├── vercel.json
└── .env.example
```

## 9. Commits sugeridos

```
feat: add raffle board with realtime updates and goal progress bar
feat: add Mercado Pago Pix checkout and payment webhook
feat: add WhatsApp in-person reservation flow
feat: add admin panel for manual sales, orders and settings
chore: add Supabase schema with RLS and spreadsheet import
docs: add setup guide and architecture overview
```

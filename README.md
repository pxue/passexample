# Pay-first SaaS demo (Cloudflare Worker + Stripe Checkout)

Live: https://passexample.pxue.workers.dev

Landing → pick plan → Stripe Checkout → Stripe confirms payment via webhook → account created → gated `/dashboard`.

One file (`src/index.js`), no dependencies. The Stripe API is called with plain `fetch`, accounts live in Cloudflare D1,
and the login session is an HMAC-signed cookie holding the account ID.

## How the pay-first flow works
1. `POST /checkout` creates a Stripe Checkout Session (subscription) with the plan in `metadata.plan`.
2. After payment, Stripe redirects the buyer to `/success?session_id=…`. **This redirect is not trusted.** It only shows
   a "Confirming your payment…" page that re-checks every 2 seconds.
3. Stripe sends `checkout.session.completed` to `POST /webhook`. The Worker verifies the `Stripe-Signature` header
   (HMAC, 5-minute replay window) and, if `payment_status` is `paid`, inserts the account into D1. This is the
   **only** place accounts are created. Inserts are idempotent per checkout session, because Stripe retries deliveries.
4. On its next refresh, `/success` finds the account, marks it claimed, sets the session cookie and redirects to
   `/dashboard`. Each checkout can be claimed once, so a leaked success URL can't be used to log in.

Not handled (demo): delayed payment methods such as bank debits, which arrive as `checkout.session.async_payment_succeeded`;
subscription cancellations; logging back in from another browser.

## Stripe setup

Prices are defined in code (`PLANS` in `src/index.js`) and sent to Checkout as inline `price_data`, so you don't
create Products or Prices in the dashboard. You need an API key and one webhook endpoint.

**Required**
1. Create a Stripe account (no business verification needed for test mode) and switch to a **Sandbox / test mode**.
2. Go to **Developers → API keys** and copy the **Secret key** (`sk_test_…`) into `.env` as `STRIPE_SECRET_KEY`.
   You can also use a restricted key (`rk_test_…`) with **Checkout Sessions: Write**. Only the secret key is needed;
   the publishable key is not used.
3. **Developers → Webhooks → Add endpoint:**
   - URL: `https://<your-worker>.workers.dev/webhook`
   - Events: **`checkout.session.completed`** only
   - Copy the endpoint's **Signing secret** (`whsec_…`) and store it with `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.
   Each endpoint has its own secret, which is different from the one `stripe listen` prints for local dev.
   If deliveries fail, the endpoint page in the dashboard shows each attempt and its response.

**Optional, but affects what buyers see**
- **Settings → Business → Public details:** the business name shown at the top of the Checkout page.
- **Settings → Branding:** logo, icon and colours on the Checkout page.
- **Settings → Payments → Adaptive Pricing:** when this is on, Checkout converts prices into the buyer's local
  currency (e.g. CAD in Canada). Turn it off to always charge in USD.
- **Settings → Payments → Payment methods:** which methods appear (card, Apple Pay, Link, …).

**Where to look after a test purchase**
- **Customers:** one new customer per checkout, with the email entered at Checkout.
- **Subscriptions:** one active monthly subscription named "Acme \<Plan\>". Cancel test ones here.
- **Payments:** the first invoice payment.

**Going live**
1. Activate the account (Settings → Business details, bank account, identity verification).
2. Switch off test mode, copy the live `sk_live_…` key and upload it with `npx wrangler secret put STRIPE_SECRET_KEY`.
3. Repeat the optional branding and settings steps in live mode. Test-mode and live-mode settings are separate.
4. Create the webhook endpoint again in live mode (step 3 above). It gets a new signing secret: upload it with
   `wrangler secret put STRIPE_WEBHOOK_SECRET`.
5. Before taking real money, also handle `customer.subscription.updated` / `.deleted` so access follows cancellations.

## Cloudflare setup (once)
    npx wrangler d1 create passexample                 # put the database_id in wrangler.toml
    npx wrangler d1 execute passexample --remote --file schema.sql

## Run locally
    cp .env.example .env                                # add sk_test_ key + a random SESSION_SECRET
    npx wrangler d1 execute passexample --local --file schema.sql
    stripe listen --events checkout.session.completed --forward-to localhost:8787/webhook
                                                        # copy the whsec_ it prints into .env
    npx wrangler dev

Pay with the test card `4242 4242 4242 4242`.

## Deploy
    npx wrangler secret put STRIPE_SECRET_KEY
    npx wrangler secret put SESSION_SECRET
    npx wrangler secret put STRIPE_WEBHOOK_SECRET      # the dashboard endpoint's whsec_, not the `stripe listen` one
    npx wrangler deploy

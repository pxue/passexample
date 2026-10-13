# Pay-first SaaS demo (Cloudflare Worker + Stripe Checkout)

Live: https://passexample.pxue.workers.dev

Landing → pick plan → Stripe Checkout → account created on success → gated `/dashboard`.

One file (`src/index.js`), no dependencies, no database. The Stripe API is called with plain `fetch`, and the
"account" is the Stripe customer plus an HMAC-signed session cookie.

## Run locally
    cp .env.example .env   # add your sk_test_ key + a random SESSION_SECRET
    npx wrangler dev

Pay with the test card `4242 4242 4242 4242`.

## Deploy
    npx wrangler secret bulk .env   # uploads STRIPE_SECRET_KEY + SESSION_SECRET
    npx wrangler deploy

// Pay-first SaaS demo: landing → pick plan → Stripe Checkout → account created → gated dashboard.
// No database: the "account" is the Stripe customer + a signed session cookie.

const PLANS = {
  starter: { name: "Starter", price: 900, blurb: "For side projects", features: ["1 project", "Community support"] },
  pro: { name: "Pro", price: 2900, blurb: "For growing teams", features: ["10 projects", "Email support", "Analytics"] },
  scale: { name: "Scale", price: 9900, blurb: "For serious business", features: ["Unlimited projects", "Priority support", "SSO"] },
};

const COOKIE = "session";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /") return html(landing());
    if (route === "POST /checkout") return checkout(req, env, url);
    if (route === "GET /success") return success(env, url);
    if (route === "GET /dashboard") return dashboard(req, env);
    if (route === "POST /logout") return redirect("/", clearCookie());
    return new Response("Not found", { status: 404 });
  },
};

async function checkout(req, env, url) {
  const form = await req.formData();
  const planId = form.get("plan");
  const plan = PLANS[planId];
  if (!plan) return new Response("Unknown plan", { status: 400 });

  // Inline price_data so no products need to exist in Stripe beforehand.
  const session = await stripe(env, "POST", "checkout/sessions", {
    mode: "subscription",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(plan.price),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": `Acme ${plan.name}`,
    "metadata[plan]": planId,
    success_url: `${url.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${url.origin}/#pricing`,
  });
  return redirect(session.url);
}

async function success(env, url) {
  const id = url.searchParams.get("session_id");
  if (!id) return redirect("/");

  // Never trust the redirect alone — confirm with Stripe that it was paid.
  const s = await stripe(env, "GET", `checkout/sessions/${encodeURIComponent(id)}`);
  if (s.status !== "complete" || s.payment_status !== "paid") {
    return html(page("Payment not completed", `<p>Your payment didn't go through. <a href="/#pricing">Try again</a>.</p>`), 402);
  }

  // "Create the account": for this demo the account is the Stripe customer, stamped into a signed cookie.
  const account = {
    email: s.customer_details?.email,
    name: s.customer_details?.name,
    customer: s.customer,
    subscription: s.subscription,
    plan: s.metadata.plan,
    created: Date.now(),
  };
  const token = await sign(account, env.SESSION_SECRET);
  return redirect("/dashboard", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
}

async function dashboard(req, env) {
  const account = await readSession(req, env);
  if (!account) return redirect("/#pricing");
  const plan = PLANS[account.plan];

  return html(page("Dashboard", `
    <nav><strong>Acme</strong><form method="post" action="/logout"><button class="link">Log out</button></form></nav>
    <h1>Welcome${account.name ? `, ${esc(account.name.split(" ")[0])}` : ""} 👋</h1>
    <p class="muted">Your account was created after payment succeeded.</p>
    <div class="card">
      <span class="badge">${esc(plan.name)} plan</span>
      <h2>$${plan.price / 100}<small>/mo</small></h2>
      <ul>${plan.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <dl>
        <dt>Email</dt><dd>${esc(account.email ?? "—")}</dd>
        <dt>Stripe customer</dt><dd><code>${esc(account.customer ?? "—")}</code></dd>
        <dt>Subscription</dt><dd><code>${esc(account.subscription ?? "—")}</code></dd>
        <dt>Member since</dt><dd>${new Date(account.created).toUTCString()}</dd>
      </dl>
    </div>`));
}

// ---------- Stripe (plain fetch, no SDK) ----------

async function stripe(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message}`);
  return data;
}

// ---------- Signed cookie session (HMAC-SHA256) ----------

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function sign(payload, secret) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

async function readSession(req, env) {
  const token = req.headers.get("Cookie")?.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))?.[1];
  if (!token) return null;
  const [body, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), fromB64url(sig), new TextEncoder().encode(body));
    return ok ? JSON.parse(new TextDecoder().decode(fromB64url(body))) : null;
  } catch {
    return null;
  }
}

const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ---------- HTML ----------

function landing() {
  const cards = Object.entries(PLANS)
    .map(([id, p]) => `
      <form class="card${id === "pro" ? " featured" : ""}" method="post" action="/checkout">
        <h3>${p.name}</h3>
        <p class="muted">${p.blurb}</p>
        <h2>$${p.price / 100}<small>/mo</small></h2>
        <ul>${p.features.map((f) => `<li>${f}</li>`).join("")}</ul>
        <button name="plan" value="${id}">Get ${p.name}</button>
      </form>`)
    .join("");

  return page("Acme — ship faster", `
    <nav><strong>Acme</strong><a href="/dashboard">Dashboard</a></nav>
    <header>
      <h1>The tool your team<br>didn't know it needed.</h1>
      <p class="muted">Pay, and your account is ready instantly. No sign-up form.</p>
      <a class="btn" href="#pricing">See pricing</a>
    </header>
    <section id="pricing"><div class="grid">${cards}</div></section>
    <p class="muted center">Test mode — use card 4242 4242 4242 4242, any future date, any CVC.</p>`);
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  :root { --fg:#111; --muted:#666; --bg:#fafafa; --card:#fff; --line:#e5e5e5; --accent:#635bff; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --muted:#999; --bg:#111; --card:#1a1a1a; --line:#2a2a2a; } }
  * { box-sizing:border-box } body { margin:0 auto; max-width:960px; padding:0 16px 48px; font:16px/1.5 system-ui,sans-serif; color:var(--fg); background:var(--bg); }
  nav { display:flex; justify-content:space-between; align-items:center; padding:20px 0; } nav a, .link { color:var(--fg); background:none; border:0; padding:0; font:inherit; cursor:pointer; text-decoration:underline; }
  header { text-align:center; padding:64px 0; } h1 { font-size:clamp(2rem,6vw,3.2rem); line-height:1.1; margin:0 0 12px; }
  .muted { color:var(--muted); } .center { text-align:center; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:24px; display:flex; flex-direction:column; }
  .featured { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .card h2 { margin:8px 0; } small { font-size:.9rem; color:var(--muted); font-weight:400; } ul { padding-left:18px; flex:1; }
  button:not(.link), .btn { display:inline-block; background:var(--accent); color:#fff; border:0; border-radius:8px; padding:12px 20px; font:600 15px system-ui; cursor:pointer; text-decoration:none; }
  .badge { align-self:flex-start; background:var(--accent); color:#fff; border-radius:999px; padding:2px 10px; font-size:.8rem; font-weight:600; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:6px 16px; margin:16px 0 0; } dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }
</style></head><body>${body}</body></html>`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const html = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
const redirect = (location, cookie) => {
  const headers = new Headers({ Location: location });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
};

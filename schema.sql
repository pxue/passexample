-- One row per paid checkout. Written only by the Stripe webhook.
CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  checkout_session TEXT NOT NULL UNIQUE,
  email            TEXT,
  name             TEXT,
  customer         TEXT,
  subscription     TEXT,
  plan             TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  claimed_at       INTEGER          -- set when /success first logs the buyer in
);

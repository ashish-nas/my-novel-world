-- ============================================================================
-- MY NOVEL WORLD — Razorpay switch
-- Run this in Supabase → SQL Editor. Safe to run whether or not you'd
-- already run the Stripe version of Part 3 in schema-v2.sql — every
-- statement below is idempotent (IF EXISTS / IF NOT EXISTS), so it either
-- cleans up the Stripe-era columns or simply confirms they were never
-- there, and either way ends up in the same correct state.
--
-- New model: donations are collected into YOUR single Razorpay account,
-- not routed automatically to each Writer. You pay Writers out yourself
-- (monthly, via UPI) and mark their balance as settled here once you have.
-- ============================================================================

-- Remove the Stripe Connect fields — no longer relevant, nothing reads them.
ALTER TABLE profiles DROP COLUMN IF EXISTS stripe_account_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS stripe_charges_enabled;

-- Where a Writer's payout actually goes.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS upi_id text;

-- donations: rename the gateway-reference column (was Stripe-specific),
-- default currency to inr, and add payout tracking. Guarded so this is
-- safe to run again later — RENAME COLUMN has no IF EXISTS form, so this
-- checks first rather than assuming it hasn't already happened.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'donations'
      AND column_name = 'stripe_payment_intent_id'
  ) THEN
    ALTER TABLE donations RENAME COLUMN stripe_payment_intent_id TO razorpay_payment_id;
  END IF;
END $$;

ALTER TABLE donations ALTER COLUMN currency SET DEFAULT 'inr';
ALTER TABLE donations ADD COLUMN IF NOT EXISTS paid_out boolean DEFAULT false;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS paid_out_at timestamptz;

-- Only admin can mark a donation as paid out — column-level grant, same
-- pattern as everywhere else sensitive in this project. A Writer can still
-- SELECT their own donations (existing policy, unchanged) and will see
-- paid_out/paid_out_at like any other column on a row they can already read.
REVOKE UPDATE ON donations FROM authenticated;
GRANT UPDATE (paid_out, paid_out_at) ON donations TO authenticated;

-- CREATE POLICY has no IF NOT EXISTS form either — drop-then-create is
-- the standard idiom for making it re-runnable.
DROP POLICY IF EXISTS "Only admins mark donations as paid out" ON donations;
CREATE POLICY "Only admins mark donations as paid out"
  ON donations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- A Writer can set their own UPI id (already covered by the existing
-- column grant on profiles from the main migration — upi_id needs adding
-- to that whitelist explicitly, since grants are per-column, not inherited).
GRANT UPDATE (upi_id) ON profiles TO authenticated;
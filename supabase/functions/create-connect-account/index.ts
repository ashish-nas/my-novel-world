// supabase/functions/create-connect-account/index.ts
//
// Called from /write/earnings.html by a signed-in, approved Writer. Creates
// their Stripe Express connected account on first use, then always returns
// a fresh onboarding/dashboard link for the frontend to redirect to.

import Stripe from "https://esm.sh/stripe@17?target=denonext";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-11-20",
});
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Your deployed site origin, no trailing slash.
const SITE_URL = Deno.env.get("SITE_URL")!;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "not signed in" }), {
        status: 401,
      });
    }

    // Identify the caller from their own session JWT.
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "not signed in" }), {
        status: 401,
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("profiles")
      .select("role, stripe_account_id, suspended")
      .eq("id", user.id)
      .single();

    if (!profile || !["writer", "admin"].includes(profile.role) || profile.suspended) {
      return new Response(
        JSON.stringify({ error: "not an approved, active Writer/Author" }),
        { status: 403 },
      );
    }

    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({ type: "express" });
      accountId = account.id;
      await admin
        .from("profiles")
        .update({ stripe_account_id: accountId })
        .eq("id", user.id);
    }

    // account_onboarding also works to resume an incomplete signup, so this
    // link is safe to request every time the Writer clicks "Connect Stripe".
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${SITE_URL}/write/earnings.html`,
      return_url: `${SITE_URL}/write/earnings.html`,
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ url: link.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});

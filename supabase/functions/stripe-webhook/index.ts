// supabase/functions/stripe-webhook/index.ts
//
// Registered in Stripe → Developers → Webhooks, listening for
// checkout.session.completed and account.updated. This is the ONLY place
// a donations row is ever written — never trust the browser to self-report
// a successful payment. verify_jwt is off for this function (Stripe
// doesn't send Supabase JWTs); the Stripe-Signature header is verified
// here instead, which is what actually proves a request is genuinely
// from Stripe.

import Stripe from "https://esm.sh/stripe@17?target=denonext";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-11-20",
});
// Web Crypto-based verifier — required in Deno/edge runtimes, since the
// default constructEvent() relies on Node's synchronous crypto module.
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text(); // raw text — signature verification needs it unparsed

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error("Webhook signature check failed:", err.message);
    return new Response(err.message, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const md = session.metadata ?? {};
      const { error } = await admin.from("donations").insert({
        donor_id: md.donor_id || null,
        writer_id: md.writer_id || null,
        book_id: md.book_id || null,
        amount_cents: session.amount_total,
        platform_fee_cents: Number(md.platform_fee_cents ?? 0),
        currency: session.currency,
        stripe_payment_intent_id: session.payment_intent,
        status: "succeeded",
      });
      if (error) console.error("Failed to record donation:", error.message);
    }

    if (event.type === "account.updated") {
      const account = event.data.object;
      const { error } = await admin
        .from("profiles")
        .update({ stripe_charges_enabled: !!account.charges_enabled })
        .eq("stripe_account_id", account.id);
      if (error) console.error("Failed to sync charges_enabled:", error.message);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});

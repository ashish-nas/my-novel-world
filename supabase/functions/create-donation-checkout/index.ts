// supabase/functions/create-donation-checkout/index.ts
//
// Called from the Support widget on author.html / book.html. Creates a
// Stripe Checkout Session as a destination charge: the reader pays the
// full amount, Stripe routes it to the Writer's connected account minus
// the platform's application_fee_amount. Returns session.url directly —
// no Stripe.js needed client-side, just redirect the browser to it.

import Stripe from "https://esm.sh/stripe@17?target=denonext";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-11-20",
});
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL")!;
const PLATFORM_FEE_PCT = 0.05;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "not signed in" }), {
        status: 401,
      });
    }

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

    const { writer_id, book_id, amount_cents } = await req.json();
    // Stripe's own practical minimum for a USD charge is 50 cents.
    if (!writer_id || !amount_cents || amount_cents < 50) {
      return new Response(JSON.stringify({ error: "invalid amount" }), {
        status: 400,
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: writer } = await admin
      .from("profiles")
      .select("pen_name, stripe_account_id, stripe_charges_enabled, suspended")
      .eq("id", writer_id)
      .single();

    if (!writer?.stripe_charges_enabled || !writer.stripe_account_id || writer.suspended) {
      return new Response(
        JSON.stringify({ error: "This Writer isn't currently accepting donations" }),
        { status: 400 },
      );
    }

    const feeCents = Math.round(amount_cents * PLATFORM_FEE_PCT);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Support ${writer.pen_name}` },
            unit_amount: amount_cents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: writer.stripe_account_id },
      },
      metadata: {
        donor_id: user.id,
        writer_id,
        book_id: book_id ?? "",
        platform_fee_cents: String(feeCents),
      },
      success_url: `${SITE_URL}/author.html?id=${writer_id}&donated=1`,
      cancel_url: `${SITE_URL}/author.html?id=${writer_id}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
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

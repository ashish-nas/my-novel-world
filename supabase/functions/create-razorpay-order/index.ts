// supabase/functions/create-razorpay-order/index.ts
//
// Called from the Support widget on author.html / book.html. Creates a
// Razorpay Order — money is collected into YOUR single Razorpay account,
// not routed to the Writer automatically (see schema-v2-razorpay.sql for
// why: Route, Razorpay's auto-split product, needs revenue this project
// doesn't have yet). You pay Writers out yourself, monthly, via UPI.
//
// Returns {order_id, key_id, amount, currency} — the frontend uses these
// to open Razorpay's Checkout.js modal directly; no redirect involved.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SB_SECRET_KEY")!;
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const PLATFORM_FEE_PCT = 0.05;

// This function is called directly from the browser (the Support widget),
// not server-to-server, so it has to answer CORS preflight requests
// itself — Supabase does not add these headers automatically. Without
// this, every call fails at the preflight stage with a CORS error before
// the function's own code (auth check, amount validation, etc.) ever
// runs — which is exactly what was happening: no toast, no modal, just
// a silently failed fetch in the browser console.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function basicAuthHeader() {
  return "Basic " + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
}

Deno.serve(async (req) => {
  // Browsers send an OPTIONS preflight before the real POST. Answer it
  // immediately with just the CORS headers — no auth check, no body.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "not signed in" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { writer_id, book_id, amount_cents } = await req.json();
    // amount_cents here means paise (INR's smallest unit) — same column
    // name as before, since it's the same "smallest currency unit" concept.
    // Razorpay's own practical minimum for an INR order is 100 paise (₹1).
    if (!writer_id || !amount_cents || amount_cents < 100) {
      return new Response(JSON.stringify({ error: "invalid amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: writer } = await admin
      .from("profiles")
      .select("pen_name, upi_id, suspended, role")
      .eq("id", writer_id)
      .single();

    if (
      !writer?.upi_id ||
      writer.suspended ||
      !["writer", "admin"].includes(writer.role)
    ) {
      return new Response(
        JSON.stringify({
          error: "This Writer isn't currently accepting donations",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const feePaise = Math.round(amount_cents * PLATFORM_FEE_PCT);

    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amount_cents,
        currency: "INR",
        receipt: `donation_${Date.now()}`,
        notes: {
          donor_id: user.id,
          writer_id,
          book_id: book_id ?? "",
          platform_fee_cents: String(feePaise),
        },
      }),
    });

    const order = await orderRes.json();
    if (!orderRes.ok) {
      console.error("Razorpay order creation failed:", order);
      return new Response(
        JSON.stringify({
          error: order?.error?.description ?? "order creation failed",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        order_id: order.id,
        key_id: RAZORPAY_KEY_ID,
        amount: amount_cents,
        currency: "INR",
        writer_name: writer.pen_name,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

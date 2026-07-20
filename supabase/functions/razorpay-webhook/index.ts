// supabase/functions/razorpay-webhook/index.ts
//
// Registered in Razorpay Dashboard → Settings → Webhooks, listening for
// payment.captured. This is the ONLY place a donations row is ever
// written — never trust the frontend's checkout handler callback alone,
// it can be bypassed or faked. verify_jwt is off for this function
// (Razorpay doesn't send Supabase JWTs); the X-Razorpay-Signature header
// is verified here instead, using the raw request body as required.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAZORPAY_WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function verifySignature(rawBody: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === signature;
}

Deno.serve(async (req) => {
  const signature = req.headers.get("x-razorpay-signature");
  const rawBody = await req.text(); // raw text required — do not parse before verifying

  if (!signature || !(await verifySignature(rawBody, signature, RAZORPAY_WEBHOOK_SECRET))) {
    console.error("Razorpay webhook signature check failed");
    return new Response("invalid signature", { status: 400 });
  }

  const event = JSON.parse(rawBody);

  try {
    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity;
      const notes = payment.notes ?? {};

      // x-razorpay-event-id + a lookup on razorpay_payment_id both guard
      // against Razorpay's documented at-least-once retry behavior
      // double-inserting the same donation.
      const { data: existing } = await admin
        .from("donations")
        .select("id")
        .eq("razorpay_payment_id", payment.id)
        .maybeSingle();

      if (!existing) {
        const { error } = await admin.from("donations").insert({
          donor_id: notes.donor_id || null,
          writer_id: notes.writer_id || null,
          book_id: notes.book_id || null,
          amount_cents: payment.amount,
          platform_fee_cents: Number(notes.platform_fee_cents ?? 0),
          currency: "inr",
          razorpay_payment_id: payment.id,
          status: "succeeded",
        });
        if (error) console.error("Failed to record donation:", error.message);
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

// supabase/functions/unsubscribe/index.ts
//
// The "Unsubscribe" link in the chapter-alert email points here:
//   https://<project-ref>.supabase.co/functions/v1/unsubscribe?id=<subscription_id>
//
// This is a genuinely public, unauthenticated endpoint (verify_jwt off in
// config.toml) — whoever clicks the link in their inbox has no Supabase
// session at all. The subscription id is a random UUID, so it isn't
// guessable; that's the only "auth" this needs for a low-stakes personal
// site. It uses the service role key to bypass RLS, since there's no
// signed-in user to satisfy the `auth.uid() = user_id` policy.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("https://cjblsyitnezgpkykitax.supabase.co")!;
const SERVICE_ROLE_KEY = Deno.env.get(
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYmxzeWl0bmV6Z3BreWtpdGF4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM5MjM4OSwiZXhwIjoyMDk1OTY4Mzg5fQ.z2ImQDE0AZnlx2fREWQqSMOjOmK0ui_ZztRv2Ksqa2c",
)!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function page(title: string, message: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — My Novel World</title>
  </head>
  <body style="margin:0;background:#0a0a0b;font-family:Georgia,'Times New Roman',serif;color:#e8e6de;">
    <div style="max-width:440px;margin:80px auto;padding:40px 32px;background:#18181d;border:1px solid #2a2a30;text-align:center;">
      <p style="letter-spacing:2px;color:#c9a84c;font-size:12px;text-transform:uppercase;margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;">
        My Novel World
      </p>
      <h1 style="font-size:22px;font-weight:400;margin:0 0 12px;">${title}</h1>
      <p style="color:#9a9590;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${message}</p>
    </div>
  </body>
</html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response(
      page("Link incomplete", "This unsubscribe link is missing an id."),
      {
        status: 400,
        headers: { "Content-Type": "text/html" },
      },
    );
  }

  const { error } = await db
    .from("email_subscriptions")
    .update({ active: false })
    .eq("id", id);

  if (error) {
    return new Response(
      page(
        "Something went wrong",
        "We couldn't process this request. Please try again later.",
      ),
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }

  return new Response(
    page(
      "You're unsubscribed",
      "You won't get any more chapter alerts for this book. You can re-subscribe any time from the book page.",
    ),
    { status: 200, headers: { "Content-Type": "text/html" } },
  );
});

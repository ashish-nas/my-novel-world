// supabase/functions/send-chapter-email/index.ts
//
// Called by the `on_chapter_published` Postgres trigger (see schema.sql)
// whenever a chapter's `published` column flips to true. Looks up every
// active subscriber for that book (plus "all books" subscribers) and
// sends each one a chapter-alert email through Resend.
//
// This function is NOT reachable by the browser or by signed-in users —
// only by the trigger, which authenticates with a shared secret (see
// TRIGGER_SECRET below). verify_jwt is off for this function (config.toml),
// since the trigger call carries no Supabase user session to verify.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("https://cjblsyitnezgpkykitax.supabase.co")!;
const SERVICE_ROLE_KEY = Deno.env.get(
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYmxzeWl0bmV6Z3BreWtpdGF4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM5MjM4OSwiZXhwIjoyMDk1OTY4Mzg5fQ.z2ImQDE0AZnlx2fREWQqSMOjOmK0ui_ZztRv2Ksqa2c",
)!;
const RESEND_API_KEY = Deno.env.get("re_AzRrDwrJ_E92xNXAkJ6Bc634G57chVhjA")!;
const TRIGGER_SECRET = Deno.env.get(
  "70686c65a9fbd095a010302081c60e323e98a236b5f462ab",
)!;
// Your deployed site, no trailing slash — e.g. https://mynovelworld.vercel.app
const SITE_URL = Deno.env.get("https://my-novel-world.vercel.app/")!;
// Must be an address on a domain you've verified in Resend.
// resend.dev / onboarding@resend.dev can only send to YOUR OWN account
// email — see SETUP.md before you rely on this for real subscribers.
const FROM_ADDRESS = "My Novel World <updates@mynovelworld.com>";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function escapeHtml(s: string) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

// Dark-cinematic template, built for email-client support: inline styles,
// table layout, web-safe serif fallback (Google Fonts don't reliably load
// in email clients, so this doesn't try to load Cormorant Garamond/Cinzel).
function emailHtml(opts: {
  bookTitle: string;
  chapterTitle: string;
  teaser: string;
  readUrl: string;
  unsubscribeUrl: string;
}) {
  const { bookTitle, chapterTitle, teaser, readUrl, unsubscribeUrl } = opts;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;">
      <tr>
        <td align="center" style="padding:40px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
            <tr>
              <td align="center" style="padding-bottom:24px;font-family:Georgia,'Times New Roman',serif;">
                <span style="letter-spacing:2px;color:#c9a84c;font-size:13px;text-transform:uppercase;">My Novel World</span>
              </td>
            </tr>
            <tr>
              <td style="background:#18181d;border:1px solid #2a2a30;padding:36px 32px;font-family:Georgia,'Times New Roman',serif;">
                <p style="margin:0 0 6px;color:#9a9590;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">
                  ${escapeHtml(bookTitle)} &middot; New Chapter
                </p>
                <h1 style="margin:0 0 18px;color:#e8e6de;font-size:28px;font-weight:400;line-height:1.25;">
                  ${escapeHtml(chapterTitle)}
                </h1>
                <p style="margin:0 0 28px;color:#c9c6bd;font-size:15px;line-height:1.6;">
                  ${escapeHtml(teaser)}
                </p>
                <a href="${readUrl}" style="display:inline-block;background:#c9a84c;color:#0a0a0b;text-decoration:none;padding:12px 28px;font-size:14px;letter-spacing:0.5px;font-family:Arial,Helvetica,sans-serif;">
                  Read Now
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:20px;font-family:Arial,Helvetica,sans-serif;">
                <a href="${unsubscribeUrl}" style="color:#5a5750;font-size:11px;text-decoration:underline;">
                  Unsubscribe from ${escapeHtml(bookTitle)} alerts
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-trigger-secret") !== TRIGGER_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 401,
    });
  }

  try {
    const { chapter_id } = await req.json();
    if (!chapter_id) {
      return new Response(JSON.stringify({ error: "chapter_id required" }), {
        status: 400,
      });
    }

    const { data: chapter, error: chapterErr } = await db
      .from("chapters")
      .select("id, title, teaser, book_id, books(title)")
      .eq("id", chapter_id)
      .single();

    if (chapterErr || !chapter) {
      return new Response(JSON.stringify({ error: "chapter not found" }), {
        status: 404,
      });
    }

    const { data: subs, error: subsErr } = await db
      .from("email_subscriptions")
      .select("id, email")
      .eq("active", true)
      .or(`book_id.eq.${chapter.book_id},book_id.is.null`);

    if (subsErr) {
      return new Response(JSON.stringify({ error: subsErr.message }), {
        status: 500,
      });
    }

    const uniqueSubs = Array.from(
      new Map((subs ?? []).map((s) => [s.email, s])).values(),
    );

    if (uniqueSubs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
        status: 200,
      });
    }

    const bookTitle = (chapter as any).books?.title ?? "";
    const readUrl = `${SITE_URL}/chapter.html?id=${chapter.id}`;

    const batch = uniqueSubs.map((s) => ({
      from: FROM_ADDRESS,
      to: [s.email],
      subject: `New chapter: ${chapter.title}`,
      html: emailHtml({
        bookTitle,
        chapterTitle: chapter.title,
        teaser: chapter.teaser ?? "",
        readUrl,
        unsubscribeUrl: `${SUPABASE_URL}/functions/v1/unsubscribe?id=${s.id}`,
      }),
    }));

    // Resend's batch endpoint takes up to 100 emails per call and the
    // account-wide rate limit is 2 requests/second — chunk + pace just
    // in case the subscriber list ever gets large.
    let sent = 0;
    for (let i = 0; i < batch.length; i += 100) {
      const chunk = batch.slice(i, i + 100);
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      if (res.ok) {
        sent += chunk.length;
      } else {
        console.error("Resend batch failed:", res.status, await res.text());
      }
      if (i + 100 < batch.length) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    return new Response(JSON.stringify({ sent, total: uniqueSubs.length }), {
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

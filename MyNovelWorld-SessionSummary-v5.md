# My Novel World — Session Summary v5

*Picks up from MyNovelWorld-SessionSummary-v4.md. That session got the site deployed and live for the first time. This session actually used it — clicked through real flows as a real reader — and, exactly as v4 predicted, found real problems that only showed up under actual use. The same pattern held all session: check the live site, the live database, the actual error text, before trusting what a comment or a prior summary claims. Two more phantom documents got added to that list this session; don't let this one become a third.*

**If you're a new Claude session reading this: read the whole thing before doing anything else — same instruction v4 gave, still true.**

---

## Update, later the same session: Notify / email alerts removed entirely

Everything below about the email-alert pipeline working end to end is an accurate account of what was tested and confirmed *at the time*. But reaching real subscribers turned out to require either buying a real domain or rewriting the whole thing around Gmail SMTP, and the decision was made to remove the feature entirely instead of doing either. Removed, for good, as of the end of this session:

- The Notify button and its two JS functions (`checkNotify`, `toggleNotify`) in `book.html`
- The `send-chapter-email` and `unsubscribe` Edge Functions — folders deleted from the repo; still need deleting from Supabase itself via `supabase functions delete send-chapter-email` and `supabase functions delete unsubscribe`, if that hasn't been done yet — check before assuming
- Their two entries in `supabase/config.toml`
- The `on_chapter_published` trigger and `notify_chapter_published()` function — dropped via `schema-v2-remove-notify.sql`

**Not removed, left as a deliberate choice:** the `email_subscriptions` table itself. It's harmless sitting empty and unused. `schema-v2-drop-email-subscriptions.sql` exists if it's ever worth actually dropping, but nothing requires it.

Don't try to "fix" or re-enable any of this without a fresh conversation about whether to bring the feature back — this was intentional, not an oversight.

---

## Where things stand right now

Everything below is *confirmed*, not assumed — each item was independently verified this session, not just fixed and trusted:

- The Vercel deployment is live and serving current code (confirmed by fetching it directly, and by seeing this session's own fixes show up on it after each push).
- The homepage renders correctly. It previously showed a literal broken `${Array(4).fill(...)}.join('')}` string as visible page text — fixed.
- The homepage shows real published books, to both logged-in and logged-out visitors. It previously showed "0 novels" always, regardless of what was published — fixed.
- The exposed `TRIGGER_SECRET` from v4's own session (hardcoded in plaintext in `schema-v2-email-trigger.sql`, committed and pushed to the public repo) has been rotated. New value is set as the Supabase secret and matches what the trigger function sends.
- The full donation pipeline works end to end: checkout modal opens, `create-razorpay-order` succeeds (after a CORS fix — see below), a Netbanking test payment shows as **Captured** in the Razorpay dashboard, and the admin Payouts page correctly shows the pending balance owed to the writer (₹95 on a ₹100 donation — the 5% platform fee calculating correctly). Confirmed via an actual test transaction, not just code review. Card payments specifically fail with "Business – International Card Not Allowed" — a real, current Razorpay account-level restriction, not a bug; not worth fixing unless international donors ever become a real need.
- ~~The full chapter-publish -> email-alert pipeline works end to end~~ — true when written, but the entire feature was removed later this same session (see the update note above). Nothing here needs fixing; it's gone on purpose, not broken.

**What's NOT confirmed:** Razorpay KYC status was resolved this session (see below) — what's left unconfirmed is the writer-application flow and the 7-day account-age gate. Whether `mynovelworld.com` will ever be usable is moot — see the update note above, the feature that needed it is gone.

---

## What actually happened this session (narrative version)

**It started, again, with a document that turned out to be wrong.** v4 listed `DEPLOYMENT-GUIDE.md` as a companion file that should already be in the project folder and pushed to GitHub. It isn't — not in the working tree, not anywhere in git history, on any branch. `CHANGELOG-v2.md` references it twice as if it exists. A second phantom document turned up later the same way: a code comment in `send-chapter-email/index.ts` pointed to a `SETUP.md` for guidance on the Resend sandbox limitation — also never committed, anywhere. Neither has been rebuilt yet; see "Still open."

**The exposed secret from v4's own fixes turned out to still be exposed.** v4's "seventh pass" correctly moved `TRIGGER_SECRET` out of hardcoded source in two Edge Function files. But building the Postgres trigger that calls those functions was a separate fix in the same pass, and Postgres has no `Deno.env.get()` equivalent — so the real secret value went straight into `schema-v2-email-trigger.sql` instead, and that file *was* committed and pushed to the public repo. Rotated properly this time: new value generated locally, set as the Supabase secret first (closing the public exposure immediately), then the trigger function updated to match, then the tracked file replaced with a placeholder version so this can't recur silently.

**`mynovelworld.com` turned out to never have been a real purchase.** The original v1.0 design doc mentions it exactly once, as an illustrative example ("e.g. mynovelworld.com") of what a custom domain *could* look like — never as something bought. Somewhere along the way, `send-chapter-email`'s `FROM_ADDRESS` got hardcoded to that exact address as if it were real. Confirmed three independent ways: a live, unrelated website already sits at that URL; Resend showed the domain stuck at "Pending" for 14 days (well past normal DNS propagation); and a GoDaddy transfer-in attempt returned "domain already at GoDaddy" — which is a registrar-level fact, not proof of ownership, and it wasn't in the account's own domain list. Decision: use Resend's sandbox address (`onboarding@resend.dev`) for now — this only delivers to the Resend account's own email, never to real subscribers, so it proves the pipeline works but does not make chapter alerts functional for actual readers. A real, owned, verified domain is still needed before that's true.

**The "0 novels" homepage bug was actually two separate bugs stacked on top of each other.** First: a JS template literal (`${Array(4).fill(...)}.join('')}`, meant to generate skeleton-loader placeholder cards) had been written directly into static HTML instead of inside a `<script>` tag, so it never evaluated — it just rendered as broken text on every single page load, for every visitor, the whole time the site's been live. Fixed by moving the identical logic into the actual script block, where it now runs immediately on page load. Second, independent bug underneath it: no tracked file anywhere grants public `SELECT` access to `books`, `volumes`, or `chapters` — there's no v1.0 baseline `schema.sql` in this repo or its git history, same "run directly in the SQL Editor, never saved" pattern v4 already flagged for two other files. A real published book (`The Missing Boy`, 4 chapters, published 2026-07-01 — invisible to every reader for a full month) confirmed the fix once the policy was added.

**Testing the reader-facing "Notify" button surfaced the same pattern twice more, back to back.** First error: `there is no unique or exclusion constraint matching the ON CONFLICT specification` — the front-end's upsert targets `(user_id, book_id)`, but `email_subscriptions` had no such constraint. Fixed, with a dedup pass first in case any conflicting rows already existed. Immediately after: `new row violates row-level security policy for table "email_subscriptions"` — RLS was enabled on the table (confirmed by the error itself) but no policy had ever been added granting users access to their own rows. Fixed, scoped tightly to `auth.uid() = user_id` — deliberately not opening a path for anonymous/guest inserts, since no code in this repo currently uses one and this project already has a flagged, deliberately-deferred gap around rate-limiting on public write endpoints.

**The first real end-to-end send failed, and that failure was actually good news.** A Resend `422` on `/emails/batch` — not a `401`. That distinction mattered: it meant the request had already gotten past the trigger's auth check and reached Resend correctly, which confirmed the secret rotation and the `send-chapter-email` redeploy had both actually worked. The 422 itself turned out to be a one-character-order typo: the subscriber's stored email was a transposition of the real Resend account email (two names swapped), and sandbox mode only delivers to the exact account address. Fixed by correcting the stored row directly. Resent, arrived, confirmed.

**Razorpay KYC turned out to already be resolved — the real blocker was one step further along.** v4 described KYC as "submitted, pending review." It wasn't pending anymore — Activation details showed the account activated as of Jul 28, 2026 — but Account Access showed "Limited," which specifically meant API access (Orders API, the actual mechanism the checkout flow depends on) was restricted to "Payment Links and Invoices" only, pending a website link being submitted for verification. That verification, in turn, listed five mandatory pages the live site didn't have: Terms and Conditions, Privacy Policy, Shipping Policy, Cancellation and Refunds, and Contact Us. Built as a single `policies.html`, matching the site's existing dark cinematic design system, linked from the homepage footer. Needed a real contact email to put on it — a second Gmail account hit Google's per-phone-number verification limit immediately, so `mynovelworldteam@outlook.com` was created instead. Website submitted, verified, API access granted — confirmed both in the dashboard and via an official "Update on API key access" email from Razorpay directly.

**The first donation attempt failed completely silently — no toast, no modal, nothing.** Console showed why: `create-razorpay-order` had zero CORS handling anywhere in it — no OPTIONS handling, no `Access-Control-Allow-Origin` on any response path. Since the function is called directly from the browser, every single call was dying at the CORS preflight stage, before the function's own code (auth check, amount validation) ever ran. Rewritten with proper CORS headers on every response path. After that fix, the checkout modal opened correctly. Card payments then failed with "Business – International Card Not Allowed" — confirmed in Razorpay's own dashboard as a real, current account-level restriction (new Indian accounts don't get international cards enabled by default), not a bug or a wrong test card. Netbanking succeeded: **Captured** in the Razorpay dashboard, and the admin Payouts page correctly showed a ₹95 pending balance on the ₹100 test donation — exact 5% platform fee math, confirming the webhook fired and wrote the record correctly. Full pipeline confirmed end to end.

---

## Still open

- ~~`mynovelworld.com` / a real domain for email~~ — moot now that the email feature is gone. If email alerts ever come back, this exact problem (domain isn't owned or controllable) will need solving from scratch; nothing about it actually got fixed, it just stopped being relevant.
- **`DEPLOYMENT-GUIDE.md` and `SETUP.md`.** Confirmed to not exist anywhere, twice this session. Never rebuilt. If a next session needs either, don't assume a past reference to them means they're real — check first, same as everything else in this document.
- **A proper schema reconciliation.** Three separate times this session, the live database had something no tracked file knew about (the books/volumes/chapters read policy, the email_subscriptions constraint, the email_subscriptions RLS policy). That's a strong pattern, not a coincidence, and there could easily be more waiting. Worth a single dedicated pass — `supabase db dump --project-ref cjblsyitnezgpkykitax`, or manually working through each table's RLS policies tab in Table Editor — instead of finding the rest of them one user-facing error at a time.
- **Razorpay KYC status.** Never checked this session. Still just "go look at the dashboard."
- **Untested flows, carried forward unchanged from v4:** the writer-application flow, the 7-day account-age gate. (The donation/checkout modal was tested this session and works — see above.)
- **Known gaps carried forward from v4, still untouched:** no full account self-deletion (still a real product decision, not just missing code); no rate-limiting on public write endpoints (still known and deliberately deferred).
- **New files this session, need confirming as actually committed:** `schema-v2-public-read.sql`, `schema-v2-email-subscriptions-constraint.sql`, `schema-v2-email-subscriptions-rls.sql`, `schema-v2-remove-notify.sql`, `policies.html`. All were run directly in the SQL Editor (the .sql ones) or delivered as files (`policies.html`, and the CORS fix to `create-razorpay-order/index.ts`). Whether all of it actually got saved into the local project folder and pushed to git — the exact same gap v4 caught for `schema-v2.sql` and `schema-v2-razorpay.sql` — hasn't been checked yet this time. (`schema-v2-drop-email-subscriptions.sql` is separate and optional — see the update note at the top — it may never get run at all.)

---

## Reference facts (changes from v4 only — see v4 for everything else, still accurate)

- ~~`FROM_ADDRESS` in `send-chapter-email`~~ — moot, that function is deleted.
- **`TRIGGER_SECRET`:** was rotated this session — a real, worthwhile security fix that stays true regardless of anything after it — but the trigger that used it is now dropped, so nothing currently depends on it. Fine to leave it set in Supabase as-is.
- **`mynovelworld.com`:** confirmed not owned/controllable by this account. No longer relevant to anything active in this project.

---

## Companion documents

- **`CHANGELOG-v2.md`** — still the source of truth for v4's session, unchanged.
- **`MyNovelWorld-SessionSummary-v4.md`** — the document this one continues from.

This file itself should be saved into the project folder and committed alongside everything else — check it's actually there before a future session assumes it is. That check has been necessary every single time so far.

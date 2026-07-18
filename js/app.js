// ── app.js — shared across all pages ─────────
// v2.0 changes are marked "NEW". Everything else is byte-for-byte what
// you already have — copy this over your existing js/app.js.
import db from "./supabase.js";

export let currentUser = null;
export let currentProfile = null;

// ── Core: get session + profile once ──
async function getSessionAndProfile() {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session?.user) return { user: null, profile: null };

  const user = session.user;

  // Check localStorage cache first (avoids slow DB round-trip)
  const cached = localStorage.getItem("mnw_profile");
  if (cached) {
    try {
      const p = JSON.parse(cached);
      if (p.id === user.id) return { user, profile: p };
    } catch (e) {}
  }

  // Fetch from DB
  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile) {
    localStorage.setItem("mnw_profile", JSON.stringify(profile));
    return { user, profile };
  }

  // Profile missing — create it. New accounts always start as 'reader';
  // promote your own account to 'admin' once in Supabase → Table Editor (see design doc §10.4).
  const newP = {
    id: user.id,
    username: user.email.split("@")[0],
    role: "reader",
  };
  await db.from("profiles").insert(newP);
  localStorage.setItem("mnw_profile", JSON.stringify(newP));
  return { user, profile: newP };
}

// NEW — force a fresh profile fetch and re-cache it. Used by profile.html
// right after checking application status, since role changes (reader →
// writer) happen server-side (via approve_writer_application) and the
// localStorage cache above has no way to know that on its own.
export async function refreshProfile() {
  if (!currentUser) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();
  if (profile) {
    currentProfile = profile;
    localStorage.setItem("mnw_profile", JSON.stringify(profile));
    renderNav();
  }
  return profile;
}

// ── Reveal page content once an auth gate has passed.
// Pages that shouldn't flash their content to unauthorized visitors add
// `<script>document.documentElement.classList.add('auth-pending')</script>`
// at the very top of <head>; this removes it once requireAuth/requireAdmin succeeds.
function revealGatedContent() {
  document.documentElement.classList.remove("auth-pending");
}

// ── initAuth — for public pages ──
export async function initAuth() {
  const { user, profile } = await getSessionAndProfile();
  currentUser = user;
  currentProfile = profile;
  renderNav();
}

// ── requireAuth — redirect to login if not signed in ──
export async function requireAuth() {
  const { user, profile } = await getSessionAndProfile();
  if (!user) {
    location.href =
      "/login.html?redirect=" + encodeURIComponent(location.pathname);
    return false;
  }
  currentUser = user;
  currentProfile = profile;
  renderNav();
  revealGatedContent();
  return true;
}

// ── requireAdmin — redirect to home if not admin ──
export async function requireAdmin() {
  const { user, profile } = await getSessionAndProfile();

  if (!user) {
    location.href =
      "/login.html?redirect=" + encodeURIComponent(location.pathname);
    return false;
  }

  currentUser = user;
  currentProfile = profile;
  renderNav();

  if (currentProfile?.role !== "admin") {
    location.href = "/";
    return false;
  }

  revealGatedContent();
  return true;
}

// NEW — requireWriter: redirect home unless role is 'writer' or 'admin'
// (admin implicitly has every Writer capability — see design doc v2.0 §1.3).
// Also blocks a suspended account even if their role was never revoked.
export async function requireWriter() {
  const { user, profile } = await getSessionAndProfile();

  if (!user) {
    location.href =
      "/login.html?redirect=" + encodeURIComponent(location.pathname);
    return false;
  }

  currentUser = user;
  currentProfile = profile;
  renderNav();

  if (!["writer", "admin"].includes(currentProfile?.role) || currentProfile?.suspended) {
    location.href = "/profile.html";
    return false;
  }

  revealGatedContent();
  return true;
}

export function isAdmin() {
  return currentProfile?.role === "admin";
}

// NEW
export function isWriter() {
  return (
    (currentProfile?.role === "writer" || currentProfile?.role === "admin") &&
    !currentProfile?.suspended
  );
}

// ── Nav render ──
function renderNav() {
  const right = document.getElementById("nav-right");
  if (!right) return;
  if (currentUser) {
    right.innerHTML = `
      <a href="/profile.html" class="nav-username" title="View profile">${escapeHtml(currentProfile?.username ?? currentUser.email)}</a>
      ${isWriter() ? `<a href="/write/" class="btn-nav gold">Write</a>` : ""}
      ${isAdmin() ? `<a href="/admin/" class="btn-nav gold">Admin</a>` : ""}
      <a href="/my-library.html" class="btn-nav">My Library</a>
      <button class="btn-nav" onclick="signOut()">Sign out</button>`;
  } else {
    right.innerHTML = `
      <a href="/login.html" class="btn-nav">Sign in</a>
      <a href="/login.html#register" class="btn-nav gold">Join free</a>`;
  }
  checkNewPosts();
}

// ── "New" badge on the Updates nav link. Compares the newest published
// author_posts.created_at against a per-browser "last seen" timestamp.
// No-ops on pages without a nav-links list (admin, login) since the
// badge element simply won't exist there. ──
const UPDATES_SEEN_KEY = "mnw_updates_last_seen";

async function checkNewPosts() {
  const badge = document.getElementById("updates-badge");
  if (!badge) return;
  const lastSeen =
    localStorage.getItem(UPDATES_SEEN_KEY) || "1970-01-01T00:00:00.000Z";
  const { count, error } = await db
    .from("author_posts")
    .select("id", { count: "exact", head: true })
    .eq("published", true)
    .gt("created_at", lastSeen);
  if (error) {
    console.error("New-post check failed:", error.message);
    return;
  }
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.classList.add("show");
  }
}

// ── Sign out — clear cache ──
window.signOut = async () => {
  localStorage.removeItem("mnw_profile");
  await db.auth.signOut();
  location.href = "/";
};

// ── Scroll nav border ──
window.addEventListener("scroll", () => {
  document
    .querySelector(".nav")
    ?.classList.toggle("scrolled", window.scrollY > 20);
});

// ── Toast ──
export function toast(msg, type = "default") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "·";
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

// ── Confirm dialog ──
export function confirm(title, msg) {
  return new Promise((resolve) => {
    let ov = document.getElementById("confirm-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "confirm-overlay";
      ov.className = "overlay";
      ov.innerHTML = `
        <div class="dialog">
          <h3 id="confirm-title"></h3>
          <p id="confirm-msg"></p>
          <div class="dialog-btns">
            <button class="btn btn-danger" id="confirm-yes">Delete</button>
            <button class="btn" id="confirm-no">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
    }
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-msg").textContent = msg;
    ov.classList.add("show");
    const done = (val) => {
      ov.classList.remove("show");
      resolve(val);
    };
    document.getElementById("confirm-yes").onclick = () => done(true);
    document.getElementById("confirm-no").onclick = () => done(false);
  });
}

// NEW — call one of the v2.0 Edge Functions with the signed-in user's
// own access token attached. Used by the Stripe connect flow and the
// donate widget.
export async function callFunction(name, body) {
  const {
    data: { session },
  } = await db.auth.getSession();
  const res = await fetch(`${db.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── Helpers ──
export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function wordCount(html) {
  return (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

export function readTime(wc) {
  return Math.max(1, Math.round(wc / 200));
}

// Escape untrusted, reader-supplied text (comment content, usernames) before
// inserting it via innerHTML, so a comment containing HTML/script can't execute.
export function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

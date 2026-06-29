// ── app.js — shared across all pages ─────────
import db from './supabase.js';

// ── Auth state ──
export let currentUser = null;
export let currentProfile = null;

export async function initAuth() {
  // Get session once — await fully before doing anything else
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    const { data } = await db.from('profiles').select('*').eq('id', session.user.id).single();
    currentProfile = data;
  }
  renderNav();
  // Do NOT set up onAuthStateChange here — it causes flicker loops
}

export async function requireAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
    return false;
  }
  currentUser = session.user;
  const { data } = await db.from('profiles').select('*').eq('id', session.user.id).single();
  currentProfile = data;
  renderNav();
  return true;
}

export async function requireAdmin() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
    return false;
  }
  currentUser = session.user;

  // Try fetching profile up to 3 times
  let profile = null;
  for (let i = 0; i < 3; i++) {
    const { data } = await db.from('profiles').select('*').eq('id', session.user.id).single();
    if (data) { profile = data; break; }
    await new Promise(r => setTimeout(r, 600));
  }

  // If profile missing — create it as admin
  if (!profile) {
    const { data: newProfile } = await db.from('profiles')
      .insert({ id: session.user.id, username: session.user.email.split('@')[0], role: 'admin' })
      .select().single();
    profile = newProfile;
  }

  currentProfile = profile;
  renderNav();

  // Only redirect if role is definitely not admin after all retries
  if (!currentProfile || currentProfile.role !== 'admin') {
    location.href = '/';
    return false;
  }
  return true;
}

export function isAdmin() {
  return currentProfile?.role === 'admin';
}

// ── Nav render ──
function renderNav() {
  const right = document.getElementById('nav-right');
  if (!right) return;
  if (currentUser) {
    right.innerHTML = `
      <span class="nav-user text-muted text-sm">${currentProfile?.username ?? currentUser.email}</span>
      ${isAdmin() ? `<a href="/admin/" class="btn-nav gold">Admin</a>` : ''}
      <a href="/my-library.html" class="btn-nav">My Library</a>
      <button class="btn-nav" onclick="signOut()">Sign out</button>`;
  } else {
    right.innerHTML = `
      <a href="/login.html" class="btn-nav">Sign in</a>
      <a href="/login.html#register" class="btn-nav gold">Join free</a>`;
  }
}

window.signOut = async () => {
  await db.auth.signOut();
  window.location.href = '/';
};

// ── Scroll nav border ──
window.addEventListener('scroll', () => {
  document.querySelector('.nav')?.classList.toggle('scrolled', window.scrollY > 20);
});

// ── Toast ──
export function toast(msg, type = 'default') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '·';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Confirm dialog ──
export function confirm(title, msg) {
  return new Promise(resolve => {
    let ov = document.getElementById('confirm-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'confirm-overlay';
      ov.className = 'overlay';
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
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    ov.classList.add('show');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    const done = (val) => { ov.classList.remove('show'); resolve(val); };
    yes.onclick = () => done(true);
    no.onclick  = () => done(false);
  });
}

// ── Slug generator ──
export function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ── Word count ──
export function wordCount(html) {
  return (html ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

// ── Read time ──
export function readTime(wc) {
  return Math.max(1, Math.round(wc / 200));
}
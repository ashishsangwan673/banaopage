/* BanaoPage — single-file SPA logic. All data in localStorage (key banaopage_db_v1). */
'use strict';
const DB_KEY = 'banaopage_db_v1';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const slugify = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
const fmtDate = ts => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDT = ts => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getTime(); };
function hashPw(pw) { let h = 0; const s = 'banaopage-salt::' + pw; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return 'h' + (h >>> 0).toString(36); }
function visitorId() { let v = sessionStorage.getItem('bp_visitor'); if (!v) { v = uid(); sessionStorage.setItem('bp_visitor', v); } return v; }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._tm); t._tm = setTimeout(() => { t.hidden = true; }, 2800); }
function copyText(text, label) {
  const done = () => toast((label || 'Copied') + ' to clipboard');
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done)); }
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select and copy manually'); } document.body.removeChild(ta); }

/* ---------- DB ---------- */
function defaultDB() { return { users: [], session: null, pages: [], events: [], leads: [], seeded: false }; }
function loadDB() { try { const raw = localStorage.getItem(DB_KEY); if (raw) return JSON.parse(raw); } catch (e) { console.warn('DB parse failed, resetting', e); } return defaultDB(); }
let DB = loadDB();
function saveDB() { try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) { toast('Could not save — browser storage full or blocked'); } }
function currentUser() { return DB.users.find(u => u.id === DB.session) || null; }
function planOf(user) { return user ? (user.plan || 'free') : 'free'; }
const PLANS = {
  free:    { name: 'Free',    price: 0,   pages: 3,        smart: 1 },
  starter: { name: 'Starter', price: 499, pages: 10,       smart: 2 },
  pro:     { name: 'Pro',     price: 999, pages: Infinity, smart: 10 }
};
function smartPages(user) { return DB.pages.filter(p => p.owner === user.id && p.tracking && p.tracking.smart); }

function logEvent(pageId, type, extra) {
  const ev = Object.assign({ id: uid(), pageId, type, ts: Date.now(), visitor: visitorId() }, extra || {});
  DB.events.push(ev); saveDB(); return ev;
}

/* ---------- Block library ---------- */
const BLOCK_TYPES = [
  { type: 'hero', icon: '🦸', label: 'Hero', def: () => ({ title: 'Your headline goes here', sub: 'A short, clear line that tells visitors exactly what they get — and why they should care.', btnLabel: 'Get Started', btnUrl: '#', bg: '#EEF2FF', color: '#111827', align: 'center' }) },
  { type: 'text', icon: '📝', label: 'Text', def: () => ({ title: 'Section heading', body: 'Write a few lines here. Keep it simple — one idea per paragraph, plain words, no jargon.', align: 'left' }) },
  { type: 'image', icon: '🖼️', label: 'Image', def: () => ({ src: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=900&q=80', alt: 'Your image', align: 'center' }) },
  { type: 'button', icon: '🔘', label: 'Button / CTA', def: () => ({ label: 'Join Now', url: 'https://t.me/banaopage', bg: '#4F46E5', color: '#ffffff', align: 'center' }) },
  { type: 'features', icon: '✨', label: 'Features', def: () => ({ title: 'Why this works', items: ['Fast to set up — live in 10 minutes', 'No code, no designer needed', 'Real join tracking, not just clicks'] }) },
  { type: 'testimonial', icon: '💬', label: 'Testimonial', def: () => ({ quote: 'This page paid for itself in the first week. Setup took ten minutes.', name: 'Rohit Sharma, Delhi', role: 'Course creator' }) },
  { type: 'pricing', icon: '💰', label: 'Pricing', def: () => ({ title: 'Simple pricing', price: '₹499', period: '/month', note: 'Everything included. Cancel anytime.', btnLabel: 'Buy Now', btnUrl: '#' }) },
  { type: 'faq', icon: '❓', label: 'FAQ', def: () => ({ title: 'Frequently asked questions', items: [{ q: 'How do I get access after paying?', a: 'You get instant access on WhatsApp / Telegram right after payment.' }, { q: 'Is there a refund?', a: 'Yes — 7-day no-questions-asked refund.' }] }) },
  { type: 'countdown', icon: '⏳', label: 'Countdown', def: () => ({ title: 'Offer ends soon', date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 16) }) },
  { type: 'form', icon: '📋', label: 'Lead Form', def: () => ({ title: 'Get the details on WhatsApp', sub: 'Fill this in — we will message you within an hour.', btnLabel: 'Send Details', success: 'Thanks! We will message you soon.' }) },
  { type: 'video', icon: '🎬', label: 'Video Embed', def: () => ({ url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', title: 'Watch this first' }) },
  { type: 'divider', icon: '➖', label: 'Divider', def: () => ({}) },
  { type: 'telegram', icon: '✈️', label: 'Telegram Join Button', def: () => ({ channel: 'banaopage', label: 'Join our Telegram Channel', sub: 'Free signals, updates and support — inside Telegram.' }) }
];
function newBlock(type) { const t = BLOCK_TYPES.find(b => b.type === type); return { id: uid(), type, data: t ? t.def() : {} }; }

/* ---------- Templates ---------- */
const TEMPLATES = [
  { id: 'telegram-channel', name: 'Telegram Channel', emoji: '✈️', desc: 'Grow a Telegram channel with a join button and real join tracking.', blocks: ['hero', 'telegram', 'features', 'testimonial', 'faq'] },
  { id: 'trading-signals', name: 'Trading Signals', emoji: '📈', desc: 'Sell signals or a trading community — with a countdown for urgency.', blocks: ['hero', 'countdown', 'features', 'pricing', 'telegram', 'faq'] },
  { id: 'online-course', name: 'Online Course', emoji: '🎓', desc: 'Sell a course: what students learn, price, and a lead form.', blocks: ['hero', 'video', 'features', 'pricing', 'form', 'testimonial'] },
  { id: 'ebook-sale', name: 'Ebook Sale', emoji: '📚', desc: 'Sell an ebook with a cover image, benefits and a buy button.', blocks: ['hero', 'image', 'features', 'pricing', 'testimonial', 'faq'] },
  { id: 'product-launch', name: 'Product Launch', emoji: '🚀', desc: 'Launch a product: hero, countdown, features and early-bird price.', blocks: ['hero', 'countdown', 'image', 'features', 'pricing', 'form'] },
  { id: 'webinar-event', name: 'Webinar / Event', emoji: '🎤', desc: 'Fill seats for a live webinar or event with a countdown + form.', blocks: ['hero', 'countdown', 'video', 'features', 'form', 'faq'] }
];
function pageFromTemplate(tpl, owner) {
  const title = tpl.name + ' Page';
  return {
    id: uid(), owner, template: tpl.id, title, slug: slugify(title) + '-' + Math.random().toString(36).slice(2, 5),
    seoTitle: title + ' | BanaoPage', seoDesc: tpl.desc, status: 'draft',
    blocks: tpl.blocks.map(b => newBlock(b)),
    tracking: { smart: false, botToken: '', channel: '', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: null },
    createdAt: Date.now()
  };
}

/* ---------- Seed demo data ---------- */
function seedDemo() {
  if (DB.seeded) return;
  DB.seeded = true;
  let demo = DB.users.find(u => u.email === 'demo@banaopage.in');
  if (!demo) { demo = { id: uid(), name: 'Demo User', email: 'demo@banaopage.in', pw: hashPw('demo1234'), plan: 'free', createdAt: Date.now() }; DB.users.push(demo); }
  const p1 = pageFromTemplate(TEMPLATES[0], demo.id);
  p1.title = 'Trading Signals — Free Telegram Channel'; p1.slug = 'free-trading-signals'; p1.status = 'live';
  p1.blocks[0].data = { title: 'Free NIFTY & BankNIFTY Signals, Daily', sub: 'Join 12,000+ traders getting free levels every morning before market open. No spam, only levels.', btnLabel: 'Join Free on Telegram', btnUrl: 'https://t.me/banaopage', bg: '#EEF2FF', color: '#111827', align: 'center' };
  p1.blocks[1].data = { channel: 'banaopage', label: 'Join the Free Channel', sub: 'Tap below — it opens Telegram. Join request is tracked, so we know real members, not just clicks.' };
  p1.tracking = { smart: true, botToken: '', channel: 'banaopage', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: Date.now() };
  const p2 = pageFromTemplate(TEMPLATES[2], demo.id);
  p2.title = 'Spoken English Course — Batch 12'; p2.slug = 'spoken-english-batch-12'; p2.status = 'live';
  p2.blocks[0].data = { title: 'Speak English Confidently in 60 Days', sub: 'Live classes, daily practice and personal feedback — in simple Hinglish, for beginners.', btnLabel: 'Book Free Demo Class', btnUrl: '#', bg: '#ECFDF5', color: '#111827', align: 'center' };
  p2.tracking = { smart: false, botToken: '', channel: '', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: null };
  DB.pages.push(p1, p2);
  // Sample analytics: last 7 days of views/clicks/joins
  const types = ['view', 'view', 'view', 'click', 'view', 'click', 'join_request', 'view', 'join'];
  for (let d = 6; d >= 0; d--) {
    const n = 6 + Math.floor(Math.random() * 9);
    for (let i = 0; i < n; i++) {
      const page = Math.random() < 0.6 ? p1 : p2;
      const type = types[Math.floor(Math.random() * types.length)];
      DB.events.push({ id: uid(), pageId: page.id, type, ts: daysAgo(d) + Math.floor(Math.random() * 864e5), visitor: 'v_' + Math.floor(Math.random() * 40) });
    }
  }
  DB.leads.push(
    { id: uid(), pageId: p2.id, name: 'Aarav Mehta', contact: '9876543210', ts: daysAgo(1) + 3600e3 },
    { id: uid(), pageId: p2.id, name: 'Priya Nair', contact: 'priya@gmail.com', ts: daysAgo(2) + 7200e3 },
    { id: uid(), pageId: p1.id, name: 'Karan Singh', contact: 'karan.s@gmail.com', ts: daysAgo(0) + 1800e3 }
  );
  saveDB();
}
seedDemo();

/* ---------- Auth ---------- */
function signup(name, email, pw) {
  email = email.trim().toLowerCase();
  if (DB.users.some(u => u.email === email)) return { ok: false, msg: 'An account with this email already exists. Try logging in.' };
  const u = { id: uid(), name: name.trim(), email, pw: hashPw(pw), plan: 'free', createdAt: Date.now() };
  DB.users.push(u); DB.session = u.id; saveDB(); return { ok: true, user: u };
}
function login(email, pw) {
  const u = DB.users.find(x => x.email === email.trim().toLowerCase());
  if (!u || u.pw !== hashPw(pw)) return { ok: false, msg: 'Wrong email or password. (Demo: demo@banaopage.in / demo1234)' };
  DB.session = u.id; saveDB(); return { ok: true, user: u };
}
function logout() { DB.session = null; saveDB(); location.hash = '#/'; render(); }
function loginDemo() { const r = login('demo@banaopage.in', 'demo1234'); if (r.ok) { toast('Welcome back, Demo User!'); location.hash = '#/dashboard'; render(); } else toast(r.msg); }
function requireAuth() { if (!currentUser()) { location.hash = '#/login'; return false; } return true; }

/* ---------- Router ---------- */
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  return { raw: h, parts };
}
window.addEventListener('hashchange', render);
document.addEventListener('click', e => {
  const a = e.target.closest('[data-copy]');
  if (a) { e.preventDefault(); copyText(a.getAttribute('data-copy'), a.getAttribute('data-copy-label') || 'Link'); }
  const nav = e.target.closest('[data-goto]');
  if (nav) { location.hash = nav.getAttribute('data-goto'); }
});

function render() {
  const { parts } = route();
  const app = $('#app');
  const user = currentUser();
  renderHeader(user);
  window.scrollTo(0, 0);
  if (parts[0] === 'p' && parts[1]) { renderPublicPage(parts[1], app); return; }
  if (parts[0] === 'builder' && parts[1]) { renderBuilder(parts[1], app); return; }
  switch (parts[0] || '') {
    case '': renderHome(app); break;
    case 'pricing': renderHome(app, 'pricing'); break;
    case 'faq': renderHome(app, 'faq'); break;
    case 'login': renderAuth(app, 'login'); break;
    case 'signup': renderAuth(app, 'signup'); break;
    case 'dashboard': if (requireAuth()) renderDashboard(app); break;
    case 'templates': if (requireAuth()) renderTemplates(app); break;
    case 'analytics': if (requireAuth()) renderAnalytics(app); break;
    case 'leads': if (requireAuth()) renderLeads(app); break;
    case 'settings': if (requireAuth()) renderSettings(app); break;
    default: renderHome(app);
  }
}

function renderHeader(user) {
  const el = $('#header-actions');
  if (user) {
    el.innerHTML = '<span class="user-chip">Hi, ' + esc(user.name.split(' ')[0]) + ' <span class="tag tag-smart">' + esc(PLANS[planOf(user)].name) + '</span></span>' +
      '<a class="btn btn-sm" href="#/dashboard">Dashboard</a>' +
      '<button class="btn btn-sm" onclick="logout()">Logout</button>';
  } else {
    el.innerHTML = '<a class="btn btn-sm" href="#/login">Login</a><a class="btn btn-sm btn-primary" href="#/signup">Get Started</a>';
  }
  $('#menu-btn').onclick = () => $('#main-nav').classList.toggle('open');
  $$('#main-nav a').forEach(a => a.onclick = () => $('#main-nav').classList.remove('open'));
}

/* ---------- Home ---------- */
const FAQS = [
  { q: 'What do I get on the Free plan?', a: '3 landing pages in total, and 1 Smart Tracking page on a 72-hour free trial. No card needed — just sign up and start building. When the trial ends, upgrade to Starter (₹499/mo) to keep Smart Tracking on.' },
  { q: 'What is Smart Tracking?', a: 'Normal page builders only count button clicks. Smart Tracking connects your Telegram bot and counts real join requests and confirmed joins — so you know how many people actually joined your channel, not just how many tapped the button.' },
  { q: 'Do I need to know coding?', a: 'Bilkul nahi. Pick a template, click any block to edit its text, drag blocks to reorder, hit Publish. That is it — your page is live at banaopage.in/p/your-page.' },
  { q: 'What is the difference between a click and a join?', a: 'A click means someone tapped your Telegram button. A join request means Telegram actually received their request to join. A confirmed join means they are now a member. Clicks are easy to fake; joins are real.' },
  { q: 'Are repeat join requests counted again?', a: 'By default, no — each person is counted once (unique). If you want, turn on "Count repeat requests" in the page\'s Tracking settings and every repeat request is counted too.' },
  { q: 'Can I collect leads from my page?', a: 'Yes. Add a Form block to any page. Every submission lands in your Leads inbox in the dashboard, with name and phone/email and the page it came from.' },
  { q: 'How do I connect my Telegram channel?', a: 'Create a bot with @BotFather, paste its token in the page\'s Tracking settings, add your channel username, and set the webhook URL we show you as your bot webhook. Then use "Test Telegram Bot" to verify the connection.' }
];
function renderHome(app, anchor) {
  app.innerHTML = `
  <section class="hero">
    <div class="wrap">
      <span class="pill">✈️ Now with Smart Telegram Tracking</span>
      <h1>Build landing pages that<br>actually bring <span style="color:var(--indigo)">members</span>.</h1>
      <p class="lead">BanaoPage builds beautiful landing pages in minutes — no code — and tracks real Telegram join requests, not just button clicks. Made simple for India.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#/signup" style="padding:13px 26px;font-size:1.05rem">Start Free — No Card Needed</a>
        <a class="btn" href="#/templates" style="padding:13px 26px;font-size:1.05rem">Browse Templates</a>
      </div>
      <div class="hero-stats">
        <div><b>6</b><span>Ready templates</span></div>
        <div><b>10 min</b><span>Average setup</span></div>
        <div><b>₹0</b><span>To start</span></div>
        <div><b>100%</b><span>No-code builder</span></div>
      </div>
    </div>
  </section>

  <section class="section" id="features">
    <div class="wrap">
      <h2 class="center">Everything you need to launch</h2>
      <p class="center muted">No designer. No developer. No waiting for anyone.</p>
      <div class="grid grid-3" style="margin-top:26px">
        <div class="card"><div class="icon">🧱</div><h3>Drag-and-drop builder</h3><p class="muted">Hero, features, pricing, FAQ, countdown, forms, video — add blocks, click to edit, drag to reorder.</p></div>
        <div class="card"><div class="icon">✈️</div><h3>Smart Telegram Tracking</h3><p class="muted">Count real join requests and confirmed joins from your channel — not just clicks that mean nothing.</p></div>
        <div class="card"><div class="icon">📊</div><h3>Simple analytics</h3><p class="muted">Views, clicks, join requests and confirmed joins — per page, last 7 days, with CSV export.</p></div>
        <div class="card"><div class="icon">🎨</div><h3>6 ready templates</h3><p class="muted">Telegram channel, trading signals, course, ebook, product launch and webinar — start from one, make it yours.</p></div>
        <div class="card"><div class="icon">📋</div><h3>Lead forms built in</h3><p class="muted">Add a form block anywhere. Every submission lands in your Leads inbox automatically.</p></div>
        <div class="card"><div class="icon">📱</div><h3>Mobile-first pages</h3><p class="muted">Every page is responsive. Preview desktop and mobile right inside the builder before you publish.</p></div>
      </div>
    </div>
  </section>

  <section class="section soft">
    <div class="wrap">
      <h2 class="center">How it works</h2>
      <div class="grid grid-3" style="margin-top:26px">
        <div class="card"><div class="step-num">1</div><h3>Pick a template</h3><p class="muted">Choose from 6 templates built for Indian creators — Telegram, trading, courses, ebooks, launches, webinars.</p></div>
        <div class="card"><div class="step-num">2</div><h3>Edit in minutes</h3><p class="muted">Click any block to change text, colours and links. Drag to reorder. Preview on desktop and mobile.</p></div>
        <div class="card"><div class="step-num">3</div><h3>Publish &amp; track</h3><p class="muted">Hit Publish, share your link, and watch real views, clicks and Telegram joins roll into analytics.</p></div>
      </div>
    </div>
  </section>

  <section class="section" id="templates-preview">
    <div class="wrap">
      <h2 class="center">Start from a template</h2>
      <p class="center muted">Every template is a full page — just swap in your own text and links.</p>
      <div class="grid grid-3" style="margin-top:26px">
        ${TEMPLATES.map(t => `<div class="card tpl-card" data-goto="#/templates"><div class="tpl-thumb">${t.emoji}</div><h3>${esc(t.name)}</h3><p class="muted small">${esc(t.desc)}</p></div>`).join('')}
      </div>
      <p class="center" style="margin-top:22px"><a class="btn btn-primary" href="#/templates">Use a template →</a></p>
    </div>
  </section>

  <section class="section soft" id="pricing">
    <div class="wrap">
      <h2 class="center">Simple, honest pricing</h2>
      <p class="center muted">Start free. Upgrade only when you need more.</p>
      <div class="grid grid-3" style="margin-top:30px">
        <div class="price-card">
          <h3>Free</h3><div class="price">₹0 <span>/ forever</span></div>
          <ul><li>3 landing pages total</li><li>1 Smart Tracking page (72-hour trial)</li><li>All 6 templates</li><li>Lead forms + Leads inbox</li><li>Basic analytics</li></ul>
          <a class="btn btn-block" href="#/signup">Start Free</a>
        </div>
        <div class="price-card popular">
          <span class="pop-tag">MOST POPULAR</span>
          <h3>Starter</h3><div class="price">₹499 <span>/ month</span></div>
          <ul><li>10 landing pages</li><li>2 Smart Tracking pages</li><li>Everything in Free</li><li>Meta Pixel + Conversions API</li><li>CSV export</li></ul>
          <button class="btn btn-primary btn-block" onclick="upgradePlan('starter')">Choose Starter</button>
        </div>
        <div class="price-card">
          <h3>Pro</h3><div class="price">₹999 <span>/ month</span></div>
          <ul><li>Unlimited landing pages</li><li>10 Smart Tracking pages</li><li>Everything in Starter</li><li>Priority support</li><li>Repeat-request counting</li></ul>
          <button class="btn btn-block" onclick="upgradePlan('pro')">Choose Pro</button>
        </div>
      </div>
      <p class="center muted small" style="margin-top:16px">Prices in INR. Upgrades here are simulated in this demo — no payment is taken.</p>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="wrap" style="max-width:760px">
      <h2 class="center">Frequently asked questions</h2>
      <div style="margin-top:24px">
        ${FAQS.map(f => `<details class="faq-item"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
      </div>
    </div>
  </section>`;
  if (anchor) { setTimeout(() => { const el = document.getElementById(anchor); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 50); }
}

/* ---------- Auth views ---------- */
function renderAuth(app, mode) {
  const isLogin = mode === 'login';
  app.innerHTML = `
  <div class="wrap"><div class="form-card">
    <h2>${isLogin ? 'Welcome back' : 'Create your free account'}</h2>
    <p class="muted">${isLogin ? 'Log in to your BanaoPage dashboard.' : 'Free plan: 3 pages + 1 Smart Tracking page (72h trial). No card needed.'}</p>
    <form id="auth-form">
      ${isLogin ? '' : '<label>Your name</label><input id="f-name" required placeholder="e.g. Ashish Sangwan">'}
      <label>Email</label><input id="f-email" type="email" required placeholder="you@example.com">
      <label>Password</label><input id="f-pw" type="password" required minlength="6" placeholder="At least 6 characters">
      <div id="auth-error" class="small" style="color:var(--red);margin-top:10px"></div>
      <button class="btn btn-primary btn-block" style="margin-top:18px">${isLogin ? 'Login' : 'Create account'}</button>
    </form>
    <button class="btn btn-block" style="margin-top:10px" onclick="loginDemo()">Try the demo account — demo@banaopage.in</button>
    <p class="center small muted" style="margin-top:16px">${isLogin ? 'New here? <a href="#/signup">Create a free account</a>' : 'Already have an account? <a href="#/login">Login</a>'}</p>
    <p class="center small muted">Demo login: demo@banaopage.in / demo1234 — comes with 2 sample pages + analytics.</p>
  </div></div>`;
  $('#auth-form').addEventListener('submit', e => {
    e.preventDefault();
    const email = $('#f-email').value, pw = $('#f-pw').value;
    const r = isLogin ? login(email, pw) : signup($('#f-name').value, email, pw);
    if (!r.ok) { $('#auth-error').textContent = r.msg; return; }
    toast(isLogin ? 'Welcome back!' : 'Account created — welcome to BanaoPage!');
    location.hash = '#/dashboard'; render();
  });
}

/* ---------- Dashboard ---------- */
function myPages(user) { return DB.pages.filter(p => p.owner === user.id); }
function pageStats(pageId) {
  const evs = DB.events.filter(e => e.pageId === pageId);
  const c = t => evs.filter(e => e.type === t).length;
  return { views: c('view'), clicks: c('click'), joins: c('join_request'), confirmed: c('join') };
}
function renderDashboard(app) {
  const user = currentUser();
  const pages = myPages(user).slice().sort((a, b) => b.createdAt - a.createdAt);
  const plan = PLANS[planOf(user)];
  const totals = pages.reduce((acc, p) => { const s = pageStats(p.id); acc.views += s.views; acc.clicks += s.clicks; acc.joins += s.joins; acc.confirmed += s.confirmed; return acc; }, { views: 0, clicks: 0, joins: 0, confirmed: 0 });
  const limitLabel = plan.pages === Infinity ? 'Unlimited' : plan.pages;
  const pct = plan.pages === Infinity ? 8 : Math.min(100, Math.round(pages.length / plan.pages * 100));
  app.innerHTML = `
  <div class="wrap page-pad">
    <div class="dash-head">
      <div><h2 style="margin:0">Dashboard</h2><p class="muted" style="margin:4px 0 0">${esc(user.name)} · ${esc(PLANS[planOf(user)].name)} plan</p></div>
      <div class="inline-row">
        <a class="btn" href="#/templates">+ New from template</a>
        <button class="btn btn-primary" onclick="createBlankPage()">+ Blank page</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${pages.length}</b><span>Pages</span></div>
      <div class="stat"><b>${totals.views}</b><span>Views</span></div>
      <div class="stat"><b>${totals.clicks}</b><span>Button clicks</span></div>
      <div class="stat"><b>${totals.joins}</b><span>Join requests (${totals.confirmed} confirmed)</span></div>
    </div>
    <div class="usage">
      <div class="inline-row" style="justify-content:space-between"><span class="small"><b>Plan usage:</b> ${pages.length} / ${limitLabel} pages · ${smartPages(user).length} / ${plan.smart} Smart Tracking pages</span>
      <a class="small" href="#/settings">Upgrade plan →</a></div>
      <div class="usage-bar" style="margin-top:6px"><i style="width:${pct}%"></i></div>
    </div>
    <div class="tabs">
      <a class="btn btn-sm active" href="#/dashboard">My Pages</a>
      <a class="btn btn-sm" href="#/analytics">Analytics</a>
      <a class="btn btn-sm" href="#/leads">Leads</a>
      <a class="btn btn-sm" href="#/settings">Settings</a>
    </div>
    <div class="inline-row" style="margin-bottom:14px">
      <input class="search-input" id="page-search" placeholder="Search pages…" oninput="renderDashboardList()">
    </div>
    <div id="page-list"></div>
  </div>`;
  renderDashboardList();
}
function renderDashboardList() {
  const user = currentUser(); if (!user) return;
  const q = ($('#page-search') ? $('#page-search').value : '').toLowerCase();
  let pages = myPages(user).slice().sort((a, b) => b.createdAt - a.createdAt);
  if (q) pages = pages.filter(p => (p.title + ' ' + p.slug).toLowerCase().includes(q));
  const el = $('#page-list'); if (!el) return;
  if (!pages.length) { el.innerHTML = '<div class="card center muted">No pages yet. Create your first page from a template or blank.</div>'; return; }
  el.innerHTML = pages.map(p => {
    const s = pageStats(p.id);
    const url = location.origin + location.pathname + '#/p/' + p.slug;
    return `<div class="page-row">
      <div><div class="title">${esc(p.title)}</div>
      <div class="small muted">/${esc(p.slug)} · ${p.template ? esc(p.template) : 'blank'} · created ${fmtDate(p.createdAt)}</div>
      <div class="small" style="margin-top:4px"><span class="tag ${p.status === 'live' ? 'tag-live' : 'tag-draft'}">${p.status === 'live' ? '● Live' : '○ Draft'}</span>
      ${p.tracking && p.tracking.smart ? '<span class="tag tag-smart">✈️ Smart Tracking</span>' : ''}
      <span class="muted"> ${s.views} views · ${s.clicks} clicks · ${s.joins} joins</span></div></div>
      <div class="inline-row">
        <a class="btn btn-sm" href="#/p/${esc(p.slug)}" target="_blank">View</a>
        <button class="btn btn-sm" data-copy="${esc(url)}" data-copy-label="Public link">Copy link</button>
        <a class="btn btn-sm btn-primary" href="#/builder/${p.id}">Edit</a>
        <button class="btn btn-sm" onclick="duplicatePage('${p.id}')">Duplicate</button>
        <button class="btn btn-sm btn-danger" onclick="deletePage('${p.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}
function createBlankPage() {
  const user = currentUser(); if (!user) return;
  const plan = PLANS[planOf(user)];
  if (myPages(user).length >= plan.pages) { toast('Page limit reached on the ' + plan.name + ' plan. Upgrade in Settings.'); return; }
  const p = { id: uid(), owner: user.id, template: 'blank', title: 'Untitled Page', slug: slugify('untitled-' + Math.random().toString(36).slice(2, 5)), seoTitle: 'Untitled Page | BanaoPage', seoDesc: '', status: 'draft', blocks: [newBlock('hero'), newBlock('text'), newBlock('button')], tracking: { smart: false, botToken: '', channel: '', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: null }, createdAt: Date.now() };
  DB.pages.push(p); saveDB(); toast('Blank page created'); location.hash = '#/builder/' + p.id; render();
}
function duplicatePage(id) {
  const user = currentUser(); const src = DB.pages.find(p => p.id === id && p.owner === user.id); if (!src) return;
  const plan = PLANS[planOf(user)];
  if (myPages(user).length >= plan.pages) { toast('Page limit reached on the ' + plan.name + ' plan. Upgrade in Settings.'); return; }
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid(); copy.title = src.title + ' (copy)'; copy.slug = slugify(copy.title) + '-' + Math.random().toString(36).slice(2, 5); copy.status = 'draft'; copy.createdAt = Date.now();
  DB.pages.push(copy); saveDB(); toast('Page duplicated'); render();
}
function deletePage(id) {
  if (!confirm('Delete this page? Its analytics and leads will also be removed.')) return;
  DB.pages = DB.pages.filter(p => p.id !== id);
  DB.events = DB.events.filter(e => e.pageId !== id);
  DB.leads = DB.leads.filter(l => l.pageId !== id);
  saveDB(); toast('Page deleted'); render();
}

/* ---------- Templates ---------- */
function renderTemplates(app) {
  const user = currentUser();
  app.innerHTML = `
  <div class="wrap page-pad">
    <h2>Choose a template</h2>
    <p class="muted">Click any template to create a page from it. You can change every block afterwards.</p>
    <div class="grid grid-3" style="margin-top:20px">
      ${TEMPLATES.map(t => `<div class="card tpl-card" onclick="createFromTemplate('${t.id}')">
        <div class="tpl-thumb">${t.emoji}</div>
        <h3>${esc(t.name)}</h3><p class="muted small">${esc(t.desc)}</p>
        <span class="small" style="color:var(--indigo);font-weight:700">Use this template →</span>
      </div>`).join('')}
    </div>
    <p style="margin-top:20px"><a class="btn" href="#/dashboard">← Back to dashboard</a> <button class="btn" onclick="createBlankPage()">Or start blank</button></p>
  </div>`;
}
function createFromTemplate(tplId) {
  const user = currentUser(); if (!user) return;
  const plan = PLANS[planOf(user)];
  if (myPages(user).length >= plan.pages) { toast('Page limit reached on the ' + plan.name + ' plan. Upgrade in Settings.'); return; }
  const tpl = TEMPLATES.find(t => t.id === tplId); if (!tpl) return;
  const p = pageFromTemplate(tpl, user.id);
  DB.pages.push(p); saveDB(); toast(tpl.name + ' page created'); location.hash = '#/builder/' + p.id; render();
}
function upgradePlan(planKey) {
  const user = currentUser();
  if (!user) { toast('Create a free account first, then upgrade.'); location.hash = '#/signup'; render(); return; }
  user.plan = planKey; saveDB();
  toast('Upgraded to ' + PLANS[planKey].name + ' (simulated — no payment taken)');
  render();
}

/* ---------- Block rendering (shared by builder + public page) ---------- */
function ytEmbed(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return 'https://www.youtube.com/embed/' + m[1];
  if (/youtube\.com\/embed\//.test(url)) return url;
  return url;
}
function blockHTML(b, page, mode) {
  const d = b.data || {};
  const align = d.align ? ' align-' + d.align : '';
  switch (b.type) {
    case 'hero': return `<section class="blk-hero${align}" style="background:${esc(d.bg || '#EEF2FF')};color:${esc(d.color || '#111827')}">
      <h1>${esc(d.title)}</h1><p>${esc(d.sub)}</p>
      <a class="btn btn-primary" href="${esc(d.btnUrl || '#')}" data-cta data-page="${page ? page.id : ''}" data-url="${esc(d.btnUrl || '#')}">${esc(d.btnLabel || 'Get Started')}</a></section>`;
    case 'text': return `<section class="blk-text${align}"><h2>${esc(d.title)}</h2><p class="muted">${esc(d.body)}</p></section>`;
    case 'image': return `<section class="blk-image${align}"><img src="${esc(d.src)}" alt="${esc(d.alt || '')}" loading="lazy" onerror="this.style.display='none'"></section>`;
    case 'button': return `<section class="blk-cta${align}"><a class="btn" style="background:${esc(d.bg || '#4F46E5')};color:${esc(d.color || '#fff')};border-color:${esc(d.bg || '#4F46E5')};padding:13px 28px;font-size:1.05rem" href="${esc(d.url || '#')}" data-cta data-page="${page ? page.id : ''}" data-url="${esc(d.url || '#')}">${esc(d.label || 'Click here')}</a></section>`;
    case 'features': return `<section class="blk-features"><h2 class="center">${esc(d.title)}</h2><div class="feat-grid">${(d.items || []).map(it => `<div class="feat"><b>${esc(it)}</b></div>`).join('')}</div></section>`;
    case 'testimonial': return `<section class="blk-testimonial"><p style="font-size:1.15rem">“${esc(d.quote)}”</p><div class="who">${esc(d.name)}</div><div class="muted small">${esc(d.role)}</div></section>`;
    case 'pricing': return `<section class="blk-pricing"><h2>${esc(d.title)}</h2><div class="price">${esc(d.price)}</div><div class="muted">${esc(d.period || '')}</div><p class="muted">${esc(d.note)}</p><a class="btn btn-emerald" href="${esc(d.btnUrl || '#')}" data-cta data-page="${page ? page.id : ''}" data-url="${esc(d.btnUrl || '#')}">${esc(d.btnLabel || 'Buy Now')}</a></section>`;
    case 'faq': return `<section class="blk-faq"><h2>${esc(d.title)}</h2>${(d.items || []).map(it => `<details class="faq-item"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join('')}</section>`;
    case 'countdown': return `<section class="blk-countdown"><h2>${esc(d.title)}</h2><div class="countdown-digits" data-countdown="${esc(d.date || '')}"><div><b class="cd-d">--</b><span>Days</span></div><div><b class="cd-h">--</b><span>Hours</span></div><div><b class="cd-m">--</b><span>Mins</span></div><div><b class="cd-s">--</b><span>Secs</span></div></div></section>`;
    case 'form': return `<section class="blk-form"><h2 class="center">${esc(d.title)}</h2><p class="muted center">${esc(d.sub)}</p>
      <form data-lead-form data-page="${page ? page.id : ''}">
        <label>Your name</label><input name="name" required placeholder="Full name">
        <label>Phone or email</label><input name="contact" required placeholder="98765 43210 or you@mail.com">
        <button class="btn btn-primary btn-block" style="margin-top:16px">${esc(d.btnLabel || 'Send Details')}</button>
        <p class="small muted center" data-form-msg></p>
      </form></section>`;
    case 'video': return `<section class="blk-video"><h3 class="center">${esc(d.title)}</h3><iframe src="${esc(ytEmbed(d.url))}" allowfullscreen title="Video"></iframe></section>`;
    case 'divider': return `<section class="blk-divider"><hr></section>`;
    case 'telegram': return `<section class="blk-telegram"><h2>${esc(d.label || 'Join our Telegram Channel')}</h2><p class="muted">${esc(d.sub || '')}</p>
      <a class="tg-btn" href="https://t.me/${esc(d.channel || 'banaopage')}" target="_blank" rel="noopener" data-tg-join data-page="${page ? page.id : ''}" data-channel="${esc(d.channel || 'banaopage')}">✈️ Join @${esc(d.channel || 'banaopage')}</a></section>`;
    default: return `<section class="blk-text"><p class="muted">Unknown block: ${esc(b.type)}</p></section>`;
  }
}
function tickCountdowns() {
  $$('[data-countdown]').forEach(el => {
    const target = new Date(el.getAttribute('data-countdown')).getTime();
    if (!target) return;
    let diff = Math.max(0, target - Date.now());
    const d = Math.floor(diff / 864e5); diff -= d * 864e5;
    const h = Math.floor(diff / 36e5); diff -= h * 36e5;
    const m = Math.floor(diff / 6e4); const s = Math.floor((diff - m * 6e4) / 1000);
    const set = (cls, v) => { const n = el.querySelector(cls); if (n) n.textContent = String(v).padStart(2, '0'); };
    set('.cd-d', d); set('.cd-h', h); set('.cd-m', m); set('.cd-s', s);
  });
}
setInterval(tickCountdowns, 1000);

/* Global click delegation: CTA clicks, Telegram join, lead forms */
document.addEventListener('click', e => {
  if (e.target.closest('#builder-canvas')) return; // builder canvas: selection only, no tracking
  const tg = e.target.closest('[data-tg-join]');
  if (tg) {
    const pageId = tg.getAttribute('data-page');
    logEvent(pageId, 'click', { label: 'telegram_join_button' });
    openJoinModal(pageId, tg.getAttribute('data-channel'));
    return;
  }
  const cta = e.target.closest('[data-cta]');
  if (cta) {
    const pageId = cta.getAttribute('data-page');
    if (pageId) logEvent(pageId, 'click', { label: 'cta', url: cta.getAttribute('data-url') || '' });
    const url = cta.getAttribute('data-url') || cta.getAttribute('href') || '#';
    if (url === '#' || url.startsWith('#')) { e.preventDefault(); toast('This button has no link yet — edit it in the builder.'); }
    return;
  }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-lead-form]');
  if (!f) return;
  if (f.closest('#builder-canvas')) { e.preventDefault(); toast('This is a preview — publish the page to collect real leads.'); return; }
  e.preventDefault();
  const pageId = f.getAttribute('data-page');
  const name = f.querySelector('[name=name]').value.trim();
  const contact = f.querySelector('[name=contact]').value.trim();
  if (!name || !contact) return;
  DB.leads.push({ id: uid(), pageId, name, contact, ts: Date.now() });
  logEvent(pageId, 'click', { label: 'lead_form_submit' });
  saveDB();
  const blk = (DB.pages.find(p => p.id === pageId) || {}).blocks || [];
  const formBlk = blk.find(b => b.type === 'form');
  const msg = f.querySelector('[data-form-msg]');
  if (msg) msg.textContent = (formBlk && formBlk.data.success) || 'Thanks! We will message you soon.';
  f.reset();
  toast('Lead saved to your inbox');
});

/* ---------- Join simulation modal ---------- */
function openJoinModal(pageId, channel) {
  const page = DB.pages.find(p => p.id === pageId);
  const smart = page && page.tracking && page.tracking.smart;
  $('#modal-root').innerHTML = `
  <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
    <div class="modal">
      <h3 style="margin-top:0">✈️ Join @${esc(channel)}</h3>
      <p class="muted">Telegram opened in a new tab. In a real setup, your bot would receive the join request and confirm it automatically.</p>
      ${smart ? '<p><span class="tag tag-smart">✈️ Smart Tracking ON</span> — this page tracks real joins.</p>' : '<p class="small muted">Smart Tracking is OFF for this page — only the click was counted. Turn it on in the builder → Tracking tab.</p>'}
      <div id="join-status"></div>
      <button class="btn btn-primary btn-block" id="simulate-join-btn" onclick="simulateJoin('${pageId}')">Simulate join request arriving</button>
      <button class="btn btn-block" style="margin-top:8px" onclick="closeModal()">Close</button>
    </div>
  </div>`;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function simulateJoin(pageId) {
  const page = DB.pages.find(p => p.id === pageId);
  const btn = $('#simulate-join-btn'); if (btn) btn.disabled = true;
  const status = $('#join-status');
  // Repeat counting: if countRepeats is off and this visitor already requested, note it
  const already = page && page.tracking && !page.tracking.countRepeats && DB.events.some(ev => ev.pageId === pageId && ev.type === 'join_request' && ev.visitor === visitorId());
  if (already) { if (status) status.innerHTML = '<p class="small" style="color:var(--amber)">You already sent a join request — repeat counting is OFF, so this is not counted again. (Toggle it in Tracking settings.)</p>'; if (btn) btn.disabled = false; return; }
  logEvent(pageId, 'join_request', { channel: page && page.tracking ? page.tracking.channel : '' });
  if (status) status.innerHTML = '<p>✅ <b>Join request received</b> — waiting for approval…</p>';
  toast('Join request logged — see Analytics move');
  setTimeout(() => {
    logEvent(pageId, 'join', { channel: page && page.tracking ? page.tracking.channel : '' });
    if (status) status.innerHTML = '<p>🎉 <b>Confirmed join!</b> You are now counted as a member. Check Analytics → this page.</p>';
    if (btn) btn.textContent = 'Done — see Analytics';
    toast('Confirmed join logged');
  }, 2000);
}

/* ---------- Builder ---------- */
let B = { pageId: null, selected: null, device: 'desktop', tab: 'design', undo: [] };
function builderPage() { return DB.pages.find(p => p.id === B.pageId); }
function pushUndo() { const p = builderPage(); if (!p) return; B.undo.push(JSON.stringify(p.blocks)); if (B.undo.length > 30) B.undo.shift(); }
function undoBuilder() {
  if (!B.undo.length) { toast('Nothing to undo'); return; }
  const p = builderPage(); if (!p) return;
  p.blocks = JSON.parse(B.undo.pop()); saveDB(); renderBuilderCanvas(); renderInspector();
}
function saveBuilder(silent) {
  const p = builderPage(); if (!p) return;
  saveDB();
  const el = $('#autosave'); if (el) el.textContent = 'Saved ✓ ' + new Date().toLocaleTimeString('en-IN');
  if (!silent) toast('Page saved');
}
function renderBuilder(pageId, app) {
  const user = currentUser();
  const p = DB.pages.find(x => x.id === pageId && x.owner === (user && user.id));
  if (!p) { app.innerHTML = '<div class="wrap page-pad"><div class="card">Page not found or not yours. <a href="#/dashboard">Back to dashboard</a></div></div>'; return; }
  B.pageId = pageId; if (!p.blocks.some(b => b.id === B.selected)) B.selected = null;
  const url = location.origin + location.pathname + '#/p/' + p.slug;
  app.innerHTML = `
  <div class="builder">
    <aside class="palette">
      <h4>Blocks</h4>
      <p class="small muted">Click to add to the bottom of the page.</p>
      ${BLOCK_TYPES.map(t => `<button class="palette-btn" onclick="addBlock('${t.type}')">${t.icon} ${t.label}</button>`).join('')}
      <hr style="margin:16px 0">
      <a class="btn btn-sm btn-block" href="#/dashboard">← Dashboard</a>
      <a class="btn btn-sm btn-block" href="#/p/${esc(p.slug)}" target="_blank" style="margin-top:8px">View live page ↗</a>
    </aside>
    <div class="canvas-col">
      <div class="builder-bar">
        <b>${esc(p.title)}</b>
        <span class="tag ${p.status === 'live' ? 'tag-live' : 'tag-draft'}">${p.status === 'live' ? '● Live' : '○ Draft'}</span>
        <span class="autosave" id="autosave"></span>
        <span class="spacer"></span>
        <div class="seg">
          <button class="${B.device === 'desktop' ? 'active' : ''}" onclick="setDevice('desktop')">🖥️ Desktop</button>
          <button class="${B.device === 'mobile' ? 'active' : ''}" onclick="setDevice('mobile')">📱 Mobile</button>
        </div>
        <button class="btn btn-sm" onclick="undoBuilder()" title="Undo last change">↩ Undo</button>
        <button class="btn btn-sm" onclick="saveBuilder()">💾 Save</button>
        <button class="btn btn-sm ${p.status === 'live' ? '' : 'btn-emerald'}" onclick="togglePublish()">${p.status === 'live' ? 'Unpublish' : 'Publish'}</button>
        <button class="btn btn-sm btn-primary" data-copy="${esc(url)}" data-copy-label="Public link">Copy link</button>
      </div>
      <div class="canvas ${B.device === 'mobile' ? 'mobile' : ''}" id="builder-canvas"></div>
      <p class="small muted center" style="margin-top:12px">Click a block to edit it · Drag blocks to reorder · Changes autosave when you edit fields</p>
    </div>
    <aside class="inspector" id="inspector"></aside>
  </div>`;
  renderBuilderCanvas();
  renderInspector();
  saveBuilder(true);
}
function renderBuilderCanvas() {
  const p = builderPage(); const c = $('#builder-canvas'); if (!p || !c) return;
  if (!p.blocks.length) { c.innerHTML = '<div style="padding:60px 20px;text-align:center" class="muted">This page is empty. Add a block from the left palette.</div>'; return; }
  c.innerHTML = p.blocks.map((b, i) => `
    <div class="block ${B.selected === b.id ? 'selected' : ''}" draggable="true" data-block-id="${b.id}" data-index="${i}">
      <div class="block-tools">
        <button onclick="event.stopPropagation();moveBlock('${b.id}',-1)" title="Move up">↑</button>
        <button onclick="event.stopPropagation();moveBlock('${b.id}',1)" title="Move down">↓</button>
        <button onclick="event.stopPropagation();dupBlock('${b.id}')" title="Duplicate">⧉</button>
        <button onclick="event.stopPropagation();delBlock('${b.id}')" title="Delete">✕</button>
      </div>
      ${blockHTML(b, p, 'builder')}
    </div>`).join('');
  $$('.block', c).forEach(el => {
    el.addEventListener('click', e => { if (e.target.closest('.block-tools')) return; e.preventDefault(); B.selected = el.getAttribute('data-block-id'); B.tab = 'design'; renderBuilderCanvas(); renderInspector(); });
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.getAttribute('data-index')); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to = parseInt(el.getAttribute('data-index'), 10);
      if (isNaN(from) || from === to) return;
      pushUndo();
      const p2 = builderPage();
      const [moved] = p2.blocks.splice(from, 1);
      p2.blocks.splice(to, 0, moved);
      saveDB(); renderBuilderCanvas(); renderInspector(); saveBuilder(true);
    });
  });
  tickCountdowns();
}
function setDevice(d) { B.device = d; render(); }
function addBlock(type) {
  const p = builderPage(); if (!p) return;
  pushUndo();
  const b = newBlock(type); p.blocks.push(b); B.selected = b.id; B.tab = 'design';
  saveDB(); renderBuilderCanvas(); renderInspector(); saveBuilder(true);
  toast(BLOCK_TYPES.find(t => t.type === type).label + ' added');
}
function moveBlock(id, dir) {
  const p = builderPage(); const i = p.blocks.findIndex(b => b.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= p.blocks.length) return;
  pushUndo();
  const [b] = p.blocks.splice(i, 1); p.blocks.splice(j, 0, b);
  saveDB(); renderBuilderCanvas(); saveBuilder(true);
}
function dupBlock(id) {
  const p = builderPage(); const i = p.blocks.findIndex(b => b.id === id); if (i < 0) return;
  pushUndo();
  const copy = JSON.parse(JSON.stringify(p.blocks[i])); copy.id = uid();
  p.blocks.splice(i + 1, 0, copy); B.selected = copy.id;
  saveDB(); renderBuilderCanvas(); renderInspector(); saveBuilder(true);
}
function delBlock(id) {
  const p = builderPage(); pushUndo();
  p.blocks = p.blocks.filter(b => b.id !== id);
  if (B.selected === id) B.selected = null;
  saveDB(); renderBuilderCanvas(); renderInspector(); saveBuilder(true);
}
function togglePublish() {
  const p = builderPage(); if (!p) return;
  p.status = p.status === 'live' ? 'draft' : 'live';
  saveDB(); toast(p.status === 'live' ? 'Published! Your page is live.' : 'Unpublished — page now shows "not published"');
  render();
}
function selectedBlock() { const p = builderPage(); return p ? p.blocks.find(b => b.id === B.selected) : null; }
function updateBlockField(field, value) {
  const b = selectedBlock(); if (!b) return;
  pushUndoLight();
  b.data[field] = value; saveDB(); renderBuilderCanvas(); saveBuilder(true);
}
let _undoLight = 0;
function pushUndoLight() { const now = Date.now(); if (now - _undoLight > 800) { pushUndo(); _undoLight = now; } }
function updateBlockList(field, text) {
  const b = selectedBlock(); if (!b) return;
  pushUndoLight();
  b.data[field] = text.split('\n').map(s => s.trim()).filter(Boolean);
  saveDB(); renderBuilderCanvas(); saveBuilder(true);
}
function updateFaqItems(text) {
  const b = selectedBlock(); if (!b) return;
  pushUndoLight();
  b.data.items = text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const parts = line.split('|'); return { q: (parts[0] || '').trim(), a: (parts[1] || '').trim() };
  });
  saveDB(); renderBuilderCanvas(); saveBuilder(true);
}
function fieldRow(label, field, value, type) {
  return `<label>${esc(label)}</label><input type="${type || 'text'}" value="${esc(value == null ? '' : value)}" oninput="updateBlockField('${field}', this.value)">`;
}
function renderInspector() {
  const p = builderPage(); const el = $('#inspector'); if (!p || !el) return;
  const tabs = `<div class="tabs"><button class="btn btn-sm ${B.tab === 'design' ? 'active' : ''}" onclick="setInspectorTab('design')">Design</button>
    <button class="btn btn-sm ${B.tab === 'seo' ? 'active' : ''}" onclick="setInspectorTab('seo')">SEO &amp; Link</button>
    <button class="btn btn-sm ${B.tab === 'tracking' ? 'active' : ''}" onclick="setInspectorTab('tracking')">Tracking ✈️</button></div>`;
  if (B.tab === 'seo') { el.innerHTML = tabs + renderSeoTab(p); return; }
  if (B.tab === 'tracking') { el.innerHTML = tabs + renderTrackingTab(p); return; }
  const b = selectedBlock();
  if (!b) { el.innerHTML = tabs + '<p class="muted">Click any block on the canvas to edit it here.</p><h4>Page</h4><label>Page title</label><input value="' + esc(p.title) + '" oninput="renamePage(this.value)"><p class="small muted">Title is shown in your dashboard and in the browser tab of the public page.</p>'; return; }
  const d = b.data || {};
  let fields = '<h4>' + esc((BLOCK_TYPES.find(t => t.type === b.type) || {}).label || b.type) + ' block</h4>';
  if (b.type === 'hero') fields += fieldRow('Headline', 'title', d.title) + `<label>Subtext</label><textarea rows="3" oninput="updateBlockField('sub', this.value)">${esc(d.sub)}</textarea>` + fieldRow('Button label', 'btnLabel', d.btnLabel) + fieldRow('Button link', 'btnUrl', d.btnUrl) + fieldRow('Background colour', 'bg', d.bg, 'color') + fieldRow('Text colour', 'color', d.color, 'color') + alignRow(d.align);
  else if (b.type === 'text') fields += fieldRow('Heading', 'title', d.title) + `<label>Body text</label><textarea rows="4" oninput="updateBlockField('body', this.value)">${esc(d.body)}</textarea>` + alignRow(d.align);
  else if (b.type === 'image') fields += fieldRow('Image URL', 'src', d.src) + fieldRow('Alt text', 'alt', d.alt) + alignRow(d.align);
  else if (b.type === 'button') fields += fieldRow('Button label', 'label', d.label) + fieldRow('Link URL', 'url', d.url) + fieldRow('Background colour', 'bg', d.bg, 'color') + fieldRow('Text colour', 'color', d.color, 'color') + alignRow(d.align);
  else if (b.type === 'features') fields += fieldRow('Section title', 'title', d.title) + `<label>Features (one per line)</label><textarea rows="4" oninput="updateBlockList('items', this.value)">${esc((d.items || []).join('\n'))}</textarea>`;
  else if (b.type === 'testimonial') fields += `<label>Quote</label><textarea rows="3" oninput="updateBlockField('quote', this.value)">${esc(d.quote)}</textarea>` + fieldRow('Name', 'name', d.name) + fieldRow('Role', 'role', d.role);
  else if (b.type === 'pricing') fields += fieldRow('Title', 'title', d.title) + fieldRow('Price', 'price', d.price) + fieldRow('Period (e.g. /month)', 'period', d.period) + fieldRow('Note', 'note', d.note) + fieldRow('Button label', 'btnLabel', d.btnLabel) + fieldRow('Button link', 'btnUrl', d.btnUrl);
  else if (b.type === 'faq') fields += fieldRow('Title', 'title', d.title) + `<label>Questions — one per line, as "Question | Answer"</label><textarea rows="6" oninput="updateFaqItems(this.value)">${esc((d.items || []).map(i => i.q + ' | ' + i.a).join('\n'))}</textarea>`;
  else if (b.type === 'countdown') fields += fieldRow('Title', 'title', d.title) + fieldRow('Ends on (date & time)', 'date', d.date, 'datetime-local');
  else if (b.type === 'form') fields += fieldRow('Title', 'title', d.title) + fieldRow('Subtext', 'sub', d.sub) + fieldRow('Button label', 'btnLabel', d.btnLabel) + fieldRow('Success message', 'success', d.success);
  else if (b.type === 'video') fields += fieldRow('Section title', 'title', d.title) + fieldRow('YouTube URL', 'url', d.url);
  else if (b.type === 'divider') fields += '<p class="muted">A simple horizontal line. Nothing to edit.</p>';
  else if (b.type === 'telegram') fields += fieldRow('Channel username (without @)', 'channel', d.channel) + fieldRow('Heading', 'label', d.label) + fieldRow('Subtext', 'sub', d.sub) + '<p class="small muted">The button opens t.me/' + esc(d.channel || '…') + ' and logs a click. With Smart Tracking on, join requests are tracked too.</p>';
  fields += '<hr style="margin:18px 0"><div class="inline-row"><button class="btn btn-sm" onclick="dupBlock(\'' + b.id + '\')">Duplicate block</button><button class="btn btn-sm btn-danger" onclick="delBlock(\'' + b.id + '\')">Delete block</button></div>';
  el.innerHTML = tabs + fields;
}
function alignRow(current) {
  return `<label>Alignment</label><div class="seg">
    <button class="${current === 'left' ? 'active' : ''}" onclick="updateBlockField('align','left')">Left</button>
    <button class="${!current || current === 'center' ? 'active' : ''}" onclick="updateBlockField('align','center')">Center</button>
    <button class="${current === 'right' ? 'active' : ''}" onclick="updateBlockField('align','right')">Right</button></div>`;
}
function setInspectorTab(t) { B.tab = t; renderInspector(); }
function renamePage(v) { const p = builderPage(); if (!p) return; p.title = v; saveDB(); saveBuilder(true); const b = $('.builder-bar b'); if (b) b.textContent = v || 'Untitled'; }
function renderSeoTab(p) {
  const url = location.origin + location.pathname + '#/p/' + p.slug;
  return `<h4>SEO &amp; public link</h4>
  <label>URL slug</label><input value="${esc(p.slug)}" oninput="updateSlug(this.value)">
  <p class="small muted">Letters, numbers and hyphens only.</p>
  <label>SEO title (browser tab + Google)</label><input value="${esc(p.seoTitle)}" oninput="updatePageMeta('seoTitle', this.value)">
  <label>SEO description</label><textarea rows="3" oninput="updatePageMeta('seoDesc', this.value)">${esc(p.seoDesc)}</textarea>
  <label>Public link</label><div class="copy-row"><input readonly value="${esc(url)}"><button class="btn btn-sm" data-copy="${esc(url)}" data-copy-label="Public link">Copy</button></div>
  <p class="small muted" style="margin-top:10px">Status: <b>${p.status === 'live' ? 'Live — anyone with the link can see it' : 'Draft — visitors see "not published"'}</b></p>`;
}
function updateSlug(v) {
  const p = builderPage(); if (!p) return;
  const s = slugify(v);
  if (!s) return;
  const clash = DB.pages.some(x => x.id !== p.id && x.slug === s);
  if (clash) { toast('That slug is already used by another page'); return; }
  p.slug = s; saveDB(); saveBuilder(true);
}
function updatePageMeta(field, v) { const p = builderPage(); if (!p) return; p[field] = v; saveDB(); saveBuilder(true); }

/* ---------- Tracking tab ---------- */
function trialRemaining(p) {
  const t = p.tracking || {};
  if (!t.smart || !t.trialStart) return null;
  return Math.max(0, 72 * 3600e3 - (Date.now() - t.trialStart));
}
function renderTrackingTab(p) {
  const user = currentUser();
  const plan = PLANS[planOf(user)];
  const t = p.tracking || {};
  const smartCount = smartPages(user).filter(x => x.id !== p.id).length;
  const rem = trialRemaining(p);
  const remText = rem == null ? '' : (rem <= 0 ? 'Trial expired' : Math.floor(rem / 3600e3) + 'h ' + Math.floor((rem % 3600e3) / 60e3) + 'm left of 72h trial');
  const webhook = location.origin + location.pathname.replace(/\/[^/]*$/, '') + '/api/telegram-webhook';
  const webhookUrl = location.origin + '/api/telegram-webhook';
  return `<h4>✈️ Smart Tracking</h4>
  <div class="check-row"><input type="checkbox" id="tr-smart" ${t.smart ? 'checked' : ''} onchange="toggleSmart(this.checked)">
  <label for="tr-smart" style="margin:0">Enable Smart Tracking on this page</label></div>
  <p class="small muted">Free plan: ${plan.smart} Smart Tracking page(s). Currently using ${smartCount + (t.smart ? 1 : 0)} / ${plan.smart}. ${t.smart && planOf(user) === 'free' ? 'Trial: <b>' + esc(remText) + '</b>' : ''}</p>
  <label>Telegram Bot Token</label><input id="tr-token" type="password" placeholder="123456:ABC-DEF…" value="${esc(t.botToken || '')}" oninput="updateTracking('botToken', this.value)">
  <p class="small muted">From @BotFather. Stored only in your browser. <button class="btn btn-sm" onclick="testTelegramBot()">Test Telegram Bot</button> <span id="bot-test-result" class="small"></span></p>
  <label>Channel username or ID</label><input placeholder="e.g. mychannel (without @) or -1001234567890" value="${esc(t.channel || '')}" oninput="updateTracking('channel', this.value)">
  <label>Meta Pixel ID (optional)</label><input placeholder="e.g. 123456789012345" value="${esc(t.pixelId || '')}" oninput="updateTracking('pixelId', this.value)">
  <label>Meta Conversions API token (optional)</label><input type="password" placeholder="EAAG…" value="${esc(t.capiToken || '')}" oninput="updateTracking('capiToken', this.value)">
  <label>CAPI event name</label><input value="${esc(t.eventName || 'Lead')}" oninput="updateTracking('eventName', this.value)">
  <div class="check-row"><input type="checkbox" id="tr-repeats" ${t.countRepeats ? 'checked' : ''} onchange="updateTracking('countRepeats', this.checked)">
  <label for="tr-repeats" style="margin:0">Count repeat join requests (default: unique only)</label></div>
  <h4 style="margin-top:20px">Webhook</h4>
  <p class="small muted">Point your bot's webhook at this URL so Telegram sends join requests here:</p>
  <div class="copy-row"><input readonly value="${esc(webhookUrl)}"><button class="btn btn-sm" data-copy="${esc(webhookUrl)}" data-copy-label="Webhook URL">Copy</button></div>
  <p class="small muted">Set it with: <code>https://api.telegram.org/bot&lt;TOKEN&gt;/setWebhook?url=${esc(encodeURIComponent(webhookUrl))}</code></p>
  <button class="btn" style="margin-top:10px" onclick="sendTestCapi()">Send Test CAPI Event</button>
  <span id="capi-result" class="small"></span>`;
}
function updateTracking(field, value) { const p = builderPage(); if (!p) return; p.tracking = p.tracking || {}; p.tracking[field] = value; saveDB(); saveBuilder(true); }
function toggleSmart(on) {
  const p = builderPage(); const user = currentUser(); const plan = PLANS[planOf(user)];
  if (on) {
    const others = smartPages(user).filter(x => x.id !== p.id).length;
    if (others >= plan.smart) { toast('Smart Tracking limit reached on the ' + plan.name + ' plan (' + plan.smart + '). Upgrade in Settings.'); renderInspector(); return; }
    p.tracking = p.tracking || {};
    if (!p.tracking.trialStart) p.tracking.trialStart = Date.now();
    p.tracking.smart = true;
    toast('Smart Tracking ON — 72h trial started (Free plan)');
  } else { p.tracking.smart = false; toast('Smart Tracking OFF'); }
  saveDB(); renderInspector(); saveBuilder(true);
}
async function testTelegramBot() {
  const p = builderPage(); const token = (p.tracking && p.tracking.botToken || '').trim();
  const out = $('#bot-test-result'); if (!token) { if (out) out.textContent = ' Paste a bot token first.'; return; }
  if (out) out.textContent = ' Checking…';
  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/getMe');
    const data = await res.json();
    if (data.ok) { if (out) out.textContent = ' ✅ Connected as @' + data.result.username + ' (' + (data.result.first_name || '') + ')'; toast('Bot connected: @' + data.result.username); }
    else { if (out) out.textContent = ' ❌ ' + (data.description || 'Telegram rejected the token'); }
  } catch (err) { if (out) out.textContent = ' ❌ Network error: ' + err.message; }
}
async function sendTestCapi() {
  const p = builderPage(); const out = $('#capi-result');
  if (out) out.textContent = ' Sending…';
  try {
    const res = await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'test_capi', slug: p.slug, event: (p.tracking && p.tracking.eventName) || 'Lead', ts: Date.now() }) });
    const data = await res.json().catch(() => ({}));
    if (out) out.textContent = res.ok ? ' ✅ Test event accepted by /api/track (' + (data.ok ? 'ok' : 'see server logs') + ')' : ' ❌ Server returned ' + res.status;
    toast(res.ok ? 'Test CAPI event sent' : 'Test event failed (' + res.status + ')');
  } catch (err) { if (out) out.textContent = ' ❌ ' + err.message + ' (is the site running on Vercel / a server?)'; }
}

/* ---------- Public page ---------- */
function renderPublicPage(slug, app) {
  const p = DB.pages.find(x => x.slug === slug);
  if (!p) { document.title = 'Page not found | BanaoPage'; app.innerHTML = '<div class="wrap page-pad"><div class="card center"><h2>Page not found</h2><p class="muted">This link may be wrong, or the page was deleted.</p><a class="btn btn-primary" href="#/">Go to BanaoPage home</a></div></div>'; return; }
  document.title = (p.seoTitle || p.title) + '';
  if (p.status !== 'live') {
    app.innerHTML = '<div class="wrap page-pad"><div class="card center"><h2>This page is not published yet</h2><p class="muted">The owner has saved this page as a draft. Please check back later.</p><a class="btn" href="#/">Go to BanaoPage home</a></div></div>';
    return;
  }
  // Meta Pixel (only if the owner set one)
  if (p.tracking && p.tracking.pixelId) {
    if (!document.getElementById('bp-pixel')) {
      const s = document.createElement('script');
      s.id = 'bp-pixel';
      s.textContent = "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','" + p.tracking.pixelId.replace(/'/g, '') + "');fbq('track','PageView');";
      document.head.appendChild(s);
    }
  }
  app.innerHTML = `<div class="public-page">${p.blocks.map(b => blockHTML(b, p, 'public')).join('')}</div>
  <div class="wrap center small muted" style="padding:18px 0 30px">Made with <a href="#/">BanaoPage</a> — landing pages + Telegram tracking</div>`;
  logEvent(p.id, 'view');
  tickCountdowns();
  // Fire a CAPI-side ping for the view (best-effort, never blocks the page)
  if (p.tracking && p.tracking.capiToken) {
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'view', slug: p.slug, ts: Date.now() }) }).catch(() => {});
  }
}

/* ---------- Analytics ---------- */
function renderAnalytics(app) {
  const user = currentUser();
  const pages = myPages(user);
  const evs = DB.events.filter(e => pages.some(p => p.id === e.pageId));
  const c = t => evs.filter(e => e.type === t).length;
  const uniq = t => new Set(evs.filter(e => e.type === t).map(e => e.visitor)).size;
  app.innerHTML = `
  <div class="wrap page-pad">
    <div class="dash-head"><div><h2 style="margin:0">Analytics</h2><p class="muted" style="margin:4px 0 0">Last 7 days · all your pages</p></div>
    <div class="inline-row">
      <button class="btn" onclick="exportCSV()">⬇ Export CSV</button>
      <button class="btn btn-danger" onclick="clearDemoData()">Clear demo data</button>
    </div></div>
    <div class="stat-grid">
      <div class="stat"><b>${c('view')}</b><span>Views</span></div>
      <div class="stat"><b>${c('click')}</b><span>Clicks</span></div>
      <div class="stat"><b>${c('join_request')}</b><span>Join requests (${uniq('join_request')} unique)</span></div>
      <div class="stat"><b>${c('join')}</b><span>Confirmed joins (${uniq('join')} unique)</span></div>
    </div>
    <div class="card" style="margin-bottom:20px"><h3 style="margin-top:0">Events — last 7 days</h3><canvas id="chart" width="900" height="260" style="width:100%;height:260px"></canvas>
    <p class="small muted">Bars: views (indigo), clicks (emerald), join requests (amber).</p></div>
    <div class="card"><h3 style="margin-top:0">Per-page breakdown</h3>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Page</th><th>Views</th><th>Clicks</th><th>Join req.</th><th>Confirmed</th><th>Join rate*</th></tr></thead>
      <tbody>${pages.map(p => { const s = pageStats(p.id); const rate = s.views ? Math.round(s.joins / s.views * 100) : 0;
        return `<tr><td><a href="#/p/${esc(p.slug)}" target="_blank">${esc(p.title)}</a></td><td>${s.views}</td><td>${s.clicks}</td><td>${s.joins}</td><td>${s.confirmed}</td><td>${rate}%</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No pages yet.</td></tr>'}</tbody>
    </table></div>
    <p class="small muted">* Join rate = join requests ÷ views. Clicks include every CTA tap; joins are the real Telegram requests.</p></div>
  </div>`;
  drawChart(evs);
}
function drawChart(evs) {
  const cv = $('#chart'); if (!cv || typeof cv.getContext !== 'function') return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), key: d.toDateString() }); }
  const series = days.map(dy => {
    const dayEvs = evs.filter(e => new Date(e.ts).toDateString() === dy.key);
    return { label: dy.label, view: dayEvs.filter(e => e.type === 'view').length, click: dayEvs.filter(e => e.type === 'click').length, join: dayEvs.filter(e => e.type === 'join_request').length };
  });
  const max = Math.max(1, ...series.map(s => Math.max(s.view, s.click, s.join)));
  ctx.clearRect(0, 0, W, H);
  const padL = 36, padB = 26, padT = 12, bw = (W - padL - 20) / 7;
  ctx.strokeStyle = '#E5E7EB'; ctx.fillStyle = '#6B7280'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  for (let g = 0; g <= 4; g++) { const y = padT + (H - padB - padT) * (1 - g / 4); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 10, y); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(String(Math.round(max * g / 4)), padL - 6, y + 4); ctx.textAlign = 'center'; }
  const colors = { view: '#4F46E5', click: '#059669', join: '#D97706' };
  series.forEach((s, i) => {
    const x0 = padL + i * bw + 8; const w = (bw - 16) / 3;
    [['view', s.view], ['click', s.click], ['join', s.join]].forEach(([k, v], j) => {
      const h = (H - padB - padT) * (v / max);
      ctx.fillStyle = colors[k];
      ctx.fillRect(x0 + j * w, H - padB - h, w - 3, h);
    });
    ctx.fillStyle = '#111827'; ctx.fillText(s.label, padL + i * bw + bw / 2, H - 8);
  });
  ctx.textAlign = 'left'; ctx.fillStyle = '#4F46E5'; ctx.fillText('■ Views', padL, 12); ctx.fillStyle = '#059669'; ctx.fillText('■ Clicks', padL + 70, 12); ctx.fillStyle = '#D97706'; ctx.fillText('■ Join requests', padL + 140, 12);
}
function exportCSV() {
  const user = currentUser();
  const pages = myPages(user);
  const rows = [['page', 'slug', 'date', 'type', 'visitor']];
  DB.events.filter(e => pages.some(p => p.id === e.pageId)).forEach(e => {
    const p = pages.find(x => x.id === e.pageId);
    rows.push(['"' + (p ? p.title.replace(/"/g, '""') : '') + '"', p ? p.slug : '', new Date(e.ts).toISOString(), e.type, e.visitor]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'banaopage-analytics-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('CSV downloaded (' + (rows.length - 1) + ' events)');
}
function clearDemoData() {
  if (!confirm('Clear all analytics events and leads? Your pages stay. This cannot be undone.')) return;
  DB.events = []; DB.leads = []; saveDB(); toast('Analytics + leads cleared'); render();
}

/* ---------- Leads ---------- */
function renderLeads(app) {
  const user = currentUser();
  const pages = myPages(user);
  const leads = DB.leads.filter(l => pages.some(p => p.id === l.pageId)).slice().sort((a, b) => b.ts - a.ts);
  app.innerHTML = `
  <div class="wrap page-pad">
    <div class="dash-head"><div><h2 style="margin:0">Leads inbox</h2><p class="muted" style="margin:4px 0 0">${leads.length} submission(s) from your pages' forms</p></div>
    <a class="btn" href="#/dashboard">← Dashboard</a></div>
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr><th>Name</th><th>Phone / Email</th><th>Page</th><th>When</th><th></th></tr></thead>
      <tbody>${leads.map(l => { const p = pages.find(x => x.id === l.pageId);
        return `<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.contact)}</td><td>${p ? esc(p.title) : '—'}</td><td>${fmtDT(l.ts)}</td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteLead('${l.id}')">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No leads yet — add a Form block to a page and publish it.</td></tr>'}</tbody>
    </table></div></div>
  </div>`;
}
function deleteLead(id) { DB.leads = DB.leads.filter(l => l.id !== id); saveDB(); toast('Lead deleted'); render(); }

/* ---------- Settings ---------- */
function renderSettings(app) {
  const user = currentUser();
  const plan = planOf(user);
  const webhookUrl = location.origin + '/api/telegram-webhook';
  const trackUrl = location.origin + '/api/track';
  app.innerHTML = `
  <div class="wrap page-pad" style="max-width:760px">
    <h2>Settings</h2>
    <div class="card" style="margin-bottom:18px">
      <h3 style="margin-top:0">Profile</h3>
      <label>Your name</label><input id="set-name" value="${esc(user.name)}">
      <label>Email</label><input value="${esc(user.email)}" disabled>
      <p class="small muted">Email cannot be changed in this demo.</p>
      <button class="btn btn-primary" onclick="saveProfile()">Save profile</button>
    </div>
    <div class="card" style="margin-bottom:18px">
      <h3 style="margin-top:0">Plan — currently <span class="tag tag-smart">${esc(PLANS[plan].name)}</span></h3>
      <p class="muted">Free: 3 pages, 1 Smart Tracking (72h trial). Starter ₹499/mo: 10 pages, 2 Smart. Pro ₹999/mo: unlimited pages, 10 Smart.</p>
      <div class="inline-row">
        <button class="btn ${plan === 'free' ? 'btn-primary' : ''}" onclick="upgradePlan('free')">Free ₹0</button>
        <button class="btn ${plan === 'starter' ? 'btn-primary' : ''}" onclick="upgradePlan('starter')">Starter ₹499/mo</button>
        <button class="btn ${plan === 'pro' ? 'btn-primary' : ''}" onclick="upgradePlan('pro')">Pro ₹999/mo</button>
      </div>
      <p class="small muted">Upgrades here are simulated — they just change your limits in this browser. No payment is taken.</p>
    </div>
    <div class="card" style="margin-bottom:18px">
      <h3 style="margin-top:0">Webhooks &amp; API endpoints</h3>
      <label>Telegram webhook (set this as your bot webhook)</label>
      <div class="copy-row"><input readonly value="${esc(webhookUrl)}"><button class="btn btn-sm" data-copy="${esc(webhookUrl)}" data-copy-label="Webhook URL">Copy</button></div>
      <label>Tracking endpoint</label>
      <div class="copy-row"><input readonly value="${esc(trackUrl)}"><button class="btn btn-sm" data-copy="${esc(trackUrl)}" data-copy-label="Tracking endpoint">Copy</button></div>
      <p class="small muted">On Vercel these are live serverless functions. Locally (python http.server) they return nothing — the site still works, events are stored in your browser.</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Your data</h3>
      <p class="muted">Everything is stored in this browser's localStorage under key <code>banaopage_db_v1</code>. Clearing browser data wipes it. Published pages work for anyone who opens the link <i>in this browser</i> — cross-device publishing needs a real database (see README).</p>
      <button class="btn btn-danger" onclick="resetAllData()">Reset everything (logout + clear all data)</button>
    </div>
  </div>`;
}
function saveProfile() {
  const user = currentUser(); const v = $('#set-name').value.trim();
  if (!v) { toast('Name cannot be empty'); return; }
  user.name = v; saveDB(); toast('Profile saved'); render();
}
function resetAllData() {
  if (!confirm('This clears ALL BanaoPage data in this browser (accounts, pages, events, leads) and logs you out. Continue?')) return;
  localStorage.removeItem(DB_KEY);
  DB = defaultDB(); seedDemo();
  location.hash = '#/'; render(); toast('All data reset — demo content re-seeded');
}

/* ---------- Boot ---------- */
render();

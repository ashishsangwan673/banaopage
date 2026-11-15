/* BanaoPage — single-file SPA logic. Data lives in localStorage first
   (key banaopage_db_v1, instant + offline) and, when the cloud backend is
   configured, also in Supabase via /api/cloud — so a published page opens
   the same for everyone, in any browser. */
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
migrateDB();
function saveDB() { try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) { toast('Could not save — browser storage full or blocked'); } if (typeof Cloud !== 'undefined') Cloud.syncSoon(); }
function currentUser() { return DB.users.find(u => u.id === DB.session) || null; }
function planOf(user) { return user ? (user.plan || 'free') : 'free'; }
/* Real Pagebanao tiers (pagebanao.com/pricing, checked 15 Nov 2026). Yearly = ~20% off monthly x12. */
const PLANS = {
  free:    { name: 'Free',         monthly: 0,     yearly: 0,      pages: 3,        smart: 1,  templates: 5,   analyticsDays: 7,        csv: false, utm: false },
  starter: { name: 'Starter',      monthly: 1999,  yearly: 19190,  pages: 7,        smart: 2,  templates: 20,  analyticsDays: 30,       csv: true,  utm: false },
  growth:  { name: 'Growth',       monthly: 4999,  yearly: 47990,  pages: 20,       smart: 8,  templates: 50,  analyticsDays: 90,       csv: true,  utm: true },
  pro:     { name: 'Business Pro', monthly: 14999, yearly: 143990, pages: Infinity, smart: 50, templates: 100, analyticsDays: Infinity, csv: true,  utm: true }
};
let billingCycle = 'monthly'; /* 'monthly' | 'yearly' — homepage pricing toggle */
function planPrice(plan) { return billingCycle === 'yearly' ? plan.yearly : plan.monthly; }
function planPriceLabel(plan) {
  if (!plan.monthly) return '₹0';
  if (billingCycle === 'yearly') return '₹' + plan.yearly.toLocaleString('en-IN');
  return '₹' + plan.monthly.toLocaleString('en-IN');
}
function planPeriodLabel(plan) {
  if (!plan.monthly) return '/ forever';
  return billingCycle === 'yearly' ? '/ year (save 20%)' : '/ month';
}
/* Migrate pages created by older versions: mode / htmlCode / history fields. */
function migrateDB() {
  if (!DB.pages) DB.pages = [];
  DB.pages.forEach(p => {
    if (!p.mode) p.mode = 'blocks';
    if (p.htmlCode == null) p.htmlCode = '';
    if (!Array.isArray(p.history)) p.history = [];
    if (!p.tracking) p.tracking = { smart: false, botToken: '', channel: '', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: null };
    if (!Array.isArray(p.blocks)) p.blocks = [];
    if (!p.updatedAt) p.updatedAt = p.createdAt || Date.now();
  });
}
function smartPages(user) { return DB.pages.filter(p => p.owner === user.id && p.tracking && p.tracking.smart); }

function logEvent(pageId, type, extra) {
  const ev = Object.assign({ id: uid(), pageId, type, ts: Date.now(), visitor: visitorId() }, extra || {});
  if (type === 'view') {
    try {
      const q = new URLSearchParams(location.search);
      ev.utm_source = q.get('utm_source') || ''; ev.utm_medium = q.get('utm_medium') || ''; ev.utm_campaign = q.get('utm_campaign') || '';
    } catch (e) { /* URLSearchParams unavailable — skip UTM */ }
  }
  DB.events.push(ev); saveDB(); Cloud.sendEvent(ev); return ev;
}

/* ---------- Cloud backend (Supabase via /api/cloud) ---------- */
/* Pages live in localStorage first (instant + offline) and, when the cloud is
   configured (Vercel env vars set), also in Supabase — so a published page
   opens the same for everyone, in any browser. Cloud calls never throw and
   never block local behaviour: every failure just means "stay local". */
const Cloud = {
  enabled: null, _probe: null, _syncTimer: null, _slugWarned: null,
  probe() {
    if (this.enabled !== null) return Promise.resolve(this.enabled);
    if (typeof fetch !== 'function') { this.enabled = false; return Promise.resolve(false); }
    if (!this._probe) {
      this._probe = fetch('/api/cloud?op=status').then(r => r.json()).then(j => { this.enabled = !!j.cloud; return this.enabled; }).catch(() => { this.enabled = false; return false; });
    }
    return this._probe;
  },
  post(body) {
    return this.probe().then(enabled => {
      if (!enabled || typeof fetch !== 'function') return null;
      return fetch('/api/cloud', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null);
    });
  },
  getPage(slug) {
    /* No probe first: the page endpoint itself answers cloud_not_configured
       when the backend is off, so one fetch is enough. The probe round-trip
       used to delay every first open of a public page. */
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch('/api/cloud?op=page&slug=' + encodeURIComponent(slug)).then(r => (r.ok ? r.json() : null)).then(j => (j && j.ok ? j.page : null)).catch(() => null);
  },
  /* Push my pages up (debounced — saveDB fires on every keystroke). */
  syncSoon() {
    if (!currentUser()) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      const u = currentUser(); if (!u) return;
      this.post({ op: 'sync', owner: u.id, pages: DB.pages.filter(p => p.owner === u.id) }).then(j => {
        if (j && j.error === 'slug_taken' && this._slugWarned !== j.slug) {
          this._slugWarned = j.slug;
          toast('Page address "' + j.slug + '" is already used by another account — rename it in SEO & Link.');
        }
      });
    }, 900);
  },
  /* Pull my pages + their events/leads down; newest copy wins per page. */
  pull() {
    const user = currentUser();
    if (!user || typeof fetch !== 'function') return Promise.resolve();
    return this.probe().then(enabled => {
      if (!enabled) return;
      return fetch('/api/cloud?op=mine&owner=' + encodeURIComponent(user.id)).then(r => (r.ok ? r.json() : null)).then(j => {
        if (!j || !j.ok) return;
        const byId = {};
        DB.pages.forEach(p => { byId[p.id] = p; });
        (j.pages || []).forEach(cp => {
          const lp = byId[cp.id];
          if (!lp) { DB.pages.push(cp); return; }
          if ((cp.updatedAt || 0) > (lp.updatedAt || 0)) Object.assign(lp, cp);
        });
        const eIds = new Set(DB.events.map(e => e.id));
        (j.events || []).forEach(e => { if (!eIds.has(e.id)) DB.events.push(e); });
        const lIds = new Set(DB.leads.map(l => l.id));
        (j.leads || []).forEach(l => { if (!lIds.has(l.id)) DB.leads.push(l); });
        saveDB();
        const h = (location.hash || '').replace(/^#/, '');
        if (/^(dashboard|templates|analytics|leads|builder)/.test(h)) render();
      }).catch(() => {});
    });
  },
  sendEvent(ev) { this.post({ op: 'event', event: ev }); },
  sendLead(lead) { this.post({ op: 'lead', lead }); },
  deletePage(id) { const u = currentUser(); if (u) this.post({ op: 'delete', owner: u.id, id }); }
};

/* ---------- Auto-resizing HTML iframes ---------- */
/* BUG FIX (15 Nov 2026): Raw HTML iframes used a fixed 200px height, so any tall
   pasted page was clipped mid-content. Every HTML iframe now gets a tiny resize
   script injected into its srcdoc; the frame measures its own content height and
   reports it to the parent, which grows the iframe. Works with
   sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-forms" — postMessage needs no allow-same-origin. */
const BP_RESIZE_MAX = 20000; /* never grow taller than this */
const BP_RESIZE_FALLBACK_MS = 1500; /* no resize message by then -> use fallback height */
function bpResizeSnippet(frameId) {
  return '<script>/* BanaoPage auto-resize */\n' +
  '(function(){var id=' + JSON.stringify(frameId) + ';' +
  'function send(){try{var d=document.documentElement;var b=document.body;' +
  'var h=Math.max(d?d.scrollHeight:0,d?d.offsetHeight:0,b?b.scrollHeight:0,b?b.offsetHeight:0,0);' +
  'if(h>0)parent.postMessage({type:"banaopage-resize",id:id,height:h},"*");}catch(e){}}' +
  'function routeLinks(){try{var as=document.getElementsByTagName("a");for(var i=0;i<as.length;i++){var a=as[i];if(a._bpRouted)continue;a._bpRouted=true;' +
  'a.addEventListener("click",function(ev){var h=this.getAttribute("href")||"";var t=this.getAttribute("target");' +
  'if(!h||h.charAt(0)==="#"||h.indexOf("javascript:")===0||h.indexOf("mailto:")===0||h.indexOf("tel:")===0)return;' +
  'if(t&&t!=="_self")return;if(/^(https?:)?\\/\\//i.test(h)){try{ev.preventDefault();window.top.location.href=h;}catch(e){}}});}}catch(e){}}' +
  'function routeForms(){try{var fs=document.getElementsByTagName("form");for(var i=0;i<fs.length;i++){if(!fs[i].getAttribute("target"))fs[i].setAttribute("target","_top");}}catch(e){}}' +
  'function watch(){routeLinks();routeForms();try{var imgs=document.images;for(var i=0;i<imgs.length;i++){if(!imgs[i]._bpWatched){imgs[i]._bpWatched=true;imgs[i].addEventListener("load",send);}}}catch(e){}}' +
  'window.addEventListener("load",function(){watch();send();});' +
  'window.addEventListener("resize",send);' +
  'try{var mo=new MutationObserver(function(){watch();send();});mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true});}catch(e){}' +
  'var n=0;var iv=setInterval(function(){watch();send();if(++n>=10)clearInterval(iv);},500);' +
  'watch();send();})();</script>';
}
/* Inject the resize snippet before </body> (or append it for fragments / pages
   without a </body>). Never throws, never alters the user's own markup otherwise. */
function injectResizeScript(html, frameId) {
  const code = String(html || '');
  const snippet = bpResizeSnippet(frameId);
  if (/<\/body\s*>/i.test(code)) return code.replace(/<\/body\s*>/i, function () { return snippet + '</body>'; });
  return code + snippet;
}
/* Parent side: ONE listener, registered once at boot. Grows the matching iframe
   (found by data-frame-id) to the reported content height. */
window.addEventListener('message', function (e) {
  const d = e && e.data;
  if (!d || d.type !== 'banaopage-resize' || typeof d.id !== 'string') return;
  const h = parseInt(d.height, 10);
  if (!isFinite(h) || h <= 0) return;
  const frames = document.querySelectorAll('iframe[data-frame-id]');
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].getAttribute('data-frame-id') === d.id) {
      frames[i]._bpResized = true;
      frames[i].style.height = Math.max(200, Math.min(h, BP_RESIZE_MAX)) + 'px';
    }
  }
});
/* Give an iframe injected srcdoc + arm the fallback: if no resize message
   arrives within ~1.5s (scripts blocked etc.), grow to the fallback height so
   the frame is never left clipped at its small minimum. */
function setFrameSrcdoc(fr, html, frameId, minHeight, fallbackHeight) {
  if (!fr) return;
  const minH = minHeight || 200;
  fr.setAttribute('data-frame-id', frameId);
  fr.setAttribute('data-min-height', String(minH));
  fr.setAttribute('data-fallback-height', String(fallbackHeight || minH));
  fr._bpResized = false;
  fr.style.height = minH + 'px';
  fr.srcdoc = injectResizeScript(html || '', frameId);
  const fb = Math.max(minH, fallbackHeight || minH);
  setTimeout(function () {
    if (fr.isConnected && !fr._bpResized) fr.style.height = fb + 'px';
  }, BP_RESIZE_FALLBACK_MS);
}
/* Arm fallbacks for iframes already in the DOM (e.g. raw-html blocks rendered
   from an HTML string in blockHTML). */
function wireAutoFrames(root) {
  $$('iframe[data-frame-id]', root || document).forEach(function (fr) {
    const minH = parseInt(fr.getAttribute('data-min-height'), 10) || 200;
    const fb = parseInt(fr.getAttribute('data-fallback-height'), 10) || minH;
    fr._bpResized = false;
    if (!fr.style.height) fr.style.height = minH + 'px';
    setTimeout(function () {
      if (fr.isConnected && !fr._bpResized) fr.style.height = Math.max(minH, fb) + 'px';
    }, BP_RESIZE_FALLBACK_MS);
  });
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
  { type: 'telegram', icon: '✈️', label: 'Telegram Join Button', def: () => ({ channel: 'banaopage', label: 'Join our Telegram Channel', sub: 'Free signals, updates and support — inside Telegram.' }) },
  { type: 'rawhtml', icon: '</>', label: 'Raw HTML', def: () => ({ html: '<div style="text-align:center;padding:24px;background:#FFF7ED;border-radius:12px"><h3 style="margin:0 0 8px">Your custom HTML here</h3><p style="margin:0;color:#555">Paste any HTML / CSS / JS in the inspector — it goes live exactly as written.</p></div>', height: 200 }) },
  { type: 'survey', icon: '📊', label: 'Survey / Question', def: () => ({ question: 'Which topic should I cover next?', options: ['Trading', 'Crypto', 'Stocks', 'Mutual Funds'] }) },
  { type: 'social', icon: '🔗', label: 'Social Links', def: () => ({ links: [{ label: 'Telegram', url: 'https://t.me/banaopage' }, { label: 'Instagram', url: 'https://instagram.com/banaopage' }, { label: 'YouTube', url: 'https://youtube.com/@banaopage' }, { label: 'X', url: 'https://x.com/banaopage' }, { label: 'WhatsApp', url: 'https://wa.me/919999999999' }] }) },
  { type: 'menu', icon: '🧭', label: 'Menu', def: () => ({ links: [{ label: 'Home', url: '#' }, { label: 'Pricing', url: '#pricing' }, { label: 'FAQ', url: '#faq' }, { label: 'Join Telegram', url: 'https://t.me/banaopage' }] }) }
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
    seoTitle: title + ' | BanaoPage', seoDesc: tpl.desc, status: 'draft', mode: 'blocks', htmlCode: '', history: [],
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
  DB.users.push(u); DB.session = u.id; saveDB(); Cloud.pull(); return { ok: true, user: u };
}
function login(email, pw) {
  const u = DB.users.find(x => x.email === email.trim().toLowerCase());
  if (!u || u.pw !== hashPw(pw)) return { ok: false, msg: 'Wrong email or password. (Demo: demo@banaopage.in / demo1234)' };
  DB.session = u.id; saveDB(); Cloud.pull(); return { ok: true, user: u };
}
function logout() { DB.session = null; saveDB(); location.hash = '#/'; render(); }
function loginDemo() { const r = login('demo@banaopage.in', 'demo1234'); if (r.ok) { toast('Welcome back, Demo User!'); location.hash = '#/dashboard'; render(); } else toast(r.msg); }
function requireAuth() { if (!currentUser()) { location.hash = '#/login'; return false; } return true; }

/* ---------- Router ---------- */
/* ---------- Subdomain / path routing ---------- */
/* A page's slug IS its address: working link is /<slug>; the <slug>.banaopage.vercel.app
   form is the same address once a custom domain with wildcard DNS is connected. */
function subdomainFromHostname(host) {
  if (!host) return null;
  const h = String(host).toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return null;
  let m = h.match(/^([a-z0-9-]+)\.banaopage\.vercel\.app$/);
  if (m) return m[1];
  const parts = h.split('.');
  /* <page>.<custom-domain> (3 labels, not a vercel.app host, not www) */
  if (parts.length === 3 && parts[0] !== 'www' && !h.endsWith('.vercel.app')) return parts[0];
  return null;
}
/* The public slug implied by the current URL (path or hostname), or null.
   Only applies when no hash route is active — otherwise a hash navigation from
   a /<slug> page would be trapped on the public page, since the pathname stays. */
function publicSlugFromUrl() {
  const h = (location.hash || '').replace(/^#/, '');
  if (h && h !== '/') return null;
  const path = location.pathname.replace(/^\/+|\/+$/g, '');
  if (path && !path.includes('/')) return path;
  return subdomainFromHostname(location.hostname) || null;
}
/* Returns the public page implied by the current URL (path or hostname), or null. */
function resolvePublicPageFromUrl() {
  const slug = publicSlugFromUrl();
  return slug ? (DB.pages.find(x => x.slug === slug) || null) : null;
}
/* Local miss for a public slug: maybe the page lives in the shared cloud but
   not in this browser. Fetch it, cache it locally, render it — or fall back
   to the homepage when it truly doesn't exist. Never throws. */
function renderCloudPageOrHome(slug, app) {
  /* Minimal neutral loader — no BanaoPage header/card, so opening a landing
     page link never flashes the BanaoPage site first. */
  app.innerHTML = '<div class="public-loading"><div class="public-spinner"></div></div>';
  Cloud.getPage(slug).then(p => {
    if (publicSlugFromUrl() !== slug) return; /* user navigated away meanwhile */
    if (!p) { document.documentElement.classList.remove('public-mode'); document.body.classList.remove('public-mode'); renderHeader(currentUser()); renderHome(app); return; }
    const i = DB.pages.findIndex(x => x.id === p.id);
    if (i >= 0) DB.pages[i] = p; else DB.pages.push(p);
    saveDB();
    renderPublicPage(p.slug, app);
  });
}
function publicUrlFor(page) { return location.origin + '/' + page.slug; }
function subdomainUrlFor(page) { return 'https://' + page.slug + '.banaopage.vercel.app'; }
function slugStatus(slug, excludeId) {
  const raw = String(slug || '');
  if (!/[a-z0-9]/i.test(raw)) return { ok: false, msg: 'Type a page address — letters, numbers and hyphens only.' };
  const s = slugify(slug);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) return { ok: false, msg: 'Use lowercase letters, numbers and hyphens only (must start with a letter or number).' };
  if (DB.pages.some(x => x.id !== excludeId && x.slug === s)) return { ok: false, msg: '❌ "' + s + '" is already taken — try another name.' };
  return { ok: true, msg: '✅ "' + s + '" is available — live at ' + location.origin + '/' + s };
}

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
  /* Public landing-page links render FIRST, before the site header — so the
     BanaoPage site never flashes before the landing page. */
  const urlPage = resolvePublicPageFromUrl();
  if (urlPage) { document.documentElement.classList.add('public-mode'); document.body.classList.add('public-mode'); window.scrollTo(0, 0); renderPublicPage(urlPage.slug, app); return; }
  if (parts[0] === 'p' && parts[1]) {
    const local = DB.pages.find(x => x.slug === parts[1]);
    document.documentElement.classList.add('public-mode'); document.body.classList.add('public-mode'); window.scrollTo(0, 0);
    if (local) { renderPublicPage(parts[1], app); return; }
    renderCloudPageOrHome(parts[1], app); return;
  }
  const pubSlug = publicSlugFromUrl();
  if (pubSlug) { document.documentElement.classList.add('public-mode'); document.body.classList.add('public-mode'); window.scrollTo(0, 0); renderCloudPageOrHome(pubSlug, app); return; }
  renderHeader(user);
  document.documentElement.classList.remove('public-mode');
  document.body.classList.remove('public-mode');
  window.scrollTo(0, 0);
  if (parts[0] === 'builder' && parts[1]) { renderBuilder(parts[1], app); return; }
  if (parts[0] === 'external' && parts[1]) { renderExternalPage(parts[1], app); return; }
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
  { q: 'What do I get on the Free plan?', a: '3 landing pages in total, and 1 Smart Tracking page on a 72-hour free trial. No card needed — just sign up and start building. When the trial ends, upgrade to Starter (₹1,999/month) to keep Smart Tracking on.' },
  { q: 'What is Smart Tracking?', a: 'Normal page builders only count button clicks. Smart Tracking connects your Telegram bot and counts real join requests and confirmed joins — so you know how many people actually joined your channel, not just how many tapped the button.' },
  { q: 'Do I need to know coding?', a: 'Bilkul nahi. Pick a template, click any block to edit its text, drag blocks to reorder, hit Publish. That is it — your page is live at banaopage.vercel.app/your-page. And if you DO have code, paste it with the Raw HTML block or the "Paste HTML" page — it goes live exactly as written.' },
  { q: 'What is the difference between a click and a join?', a: 'A click means someone tapped your Telegram button. A join request means Telegram actually received their request to join. A confirmed join means they are now a member. Clicks are easy to fake; joins are real.' },
  { q: 'Can I use my own page address?', a: 'Yes. Every page gets its own address, like banaopage.vercel.app/trading-signals — you choose the name in the builder under SEO & Link, and it must be unique. The same name also works as trading-signals.banaopage.vercel.app once a custom domain with wildcard DNS is connected.' },
  { q: 'Can I paste my own HTML code?', a: 'Yes. Use the "Paste HTML" option when creating a page, or add a Raw HTML block inside any page. Your code is rendered in a sandboxed frame and goes live exactly as written when you publish.' },
  { q: 'Are repeat join requests counted again?', a: 'By default, no — each person is counted once (unique). If you want, turn on "Count repeat requests" in the page\'s Tracking settings and every repeat request is counted too.' },
  { q: 'Can I collect leads from my page?', a: 'Yes. Add a Form block to any page. Every submission lands in your Leads inbox in the dashboard, with name and phone/email and the page it came from.' },
  { q: 'How do I connect my Telegram channel?', a: 'Create a bot with @BotFather, paste its token in the page\'s Tracking settings, add your channel username, and set the webhook URL we show you as your bot webhook. Then use "Test Telegram Bot" to verify the connection.' }
];
function renderHome(app, anchor) {
  app.innerHTML = `
  <div class="offer-banner">🎉 <b>Launch offer:</b> Free Smart Tracking on 2 landing pages till <b>30 Nov, 11:59 pm</b> — no payment needed.</div>
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
        <div class="card"><div class="icon">&lt;/&gt;</div><h3>Paste your own HTML</h3><p class="muted">Got code? Paste a full HTML page or drop a Raw HTML block into any page — it goes live exactly as written.</p></div>
        <div class="card"><div class="icon">🌐</div><h3>Your own page address</h3><p class="muted">Every page gets its own address like /trading-signals — pick any available name, no extra cost.</p></div>
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
      <p class="center muted">Start free. Grow when your community does. Yearly billing saves 20%.</p>
      <div class="center" style="margin:18px 0 6px">
        <div class="billing-toggle">
          <button class="${billingCycle === 'monthly' ? 'active' : ''}" onclick="setBilling('monthly')">Monthly</button>
          <button class="${billingCycle === 'yearly' ? 'active' : ''}" onclick="setBilling('yearly')">Yearly — save 20%</button>
        </div>
      </div>
      <div class="grid grid-4" style="margin-top:26px">
        <div class="price-card">
          <h3>Free</h3><div class="price">₹0 <span>/ forever</span></div>
          <ul><li>3 landing pages</li><li>1 Smart Tracking page (72-hour trial)</li><li>Drag-drop builder + own subdomain</li><li>Analytics — 7 days</li><li>5 templates</li><li>Email support</li></ul>
          <a class="btn btn-block" href="#/signup">Start Free</a>
        </div>
        <div class="price-card">
          <h3>Starter</h3><div class="price">${planPriceLabel(PLANS.starter)} <span>${planPeriodLabel(PLANS.starter)}</span>${billingCycle === 'yearly' ? '<span class="strike">₹23,988 / year</span>' : ''}</div>
          <ul><li>7 landing pages</li><li>2 Smart Tracking pages</li><li>Analytics — 30 days + CSV export</li><li>20 templates</li><li>Chat + email support</li></ul>
          <button class="btn btn-block" onclick="upgradePlan('starter')">Choose Starter</button>
        </div>
        <div class="price-card popular">
          <span class="pop-tag">RECOMMENDED</span>
          <h3>Growth</h3><div class="price">${planPriceLabel(PLANS.growth)} <span>${planPeriodLabel(PLANS.growth)}</span>${billingCycle === 'yearly' ? '<span class="strike">₹59,988 / year</span>' : ''}</div>
          <ul><li>20 landing pages</li><li>8 Smart Tracking pages</li><li>Analytics — 90 days + CSV export</li><li>UTM source &amp; campaign reports</li><li>50 templates</li><li>Priority support</li></ul>
          <button class="btn btn-primary btn-block" onclick="upgradePlan('growth')">Choose Growth</button>
        </div>
        <div class="price-card">
          <h3>Business Pro</h3><div class="price">${planPriceLabel(PLANS.pro)} <span>${planPeriodLabel(PLANS.pro)}</span>${billingCycle === 'yearly' ? '<span class="strike">₹1,79,988 / year</span>' : ''}</div>
          <ul><li>Unlimited pages (fair use)</li><li>50 Smart Tracking pages</li><li>Analytics — full history + CSV</li><li>UTM reports</li><li>100 templates</li><li>Chat + call + priority support</li></ul>
          <button class="btn btn-block" onclick="upgradePlan('pro')">Choose Business Pro</button>
        </div>
      </div>
      <p class="center muted small" style="margin-top:16px">Prices in INR. Meta Pixel (PageView) on all plans; Telegram join-request tracking + Meta Conversions API on all plans (Free only via the 72-hour trial). Upgrades here are simulated in this demo — no payment is taken.</p>
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
        <button class="btn" onclick="createHtmlPage()">&lt;/&gt; Paste HTML</button>
        <button class="btn" onclick="createExternalPage()">↗ External page</button>
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
    const url = publicUrlFor(p);
    const subUrl = subdomainUrlFor(p);
    const isExt = p.mode === 'external';
    const viewUrl = (isExt && p.externalUrl) ? p.externalUrl : url;
    const editHref = isExt ? '#/external/' + p.id : '#/builder/' + p.id;
    return `<div class="page-row">
      <div><div class="title">${esc(p.title)} ${p.mode === 'html' ? '<span class="tag tag-smart">&lt;/&gt; HTML</span>' : ''}${isExt ? '<span class="tag tag-smart">↗ External</span>' : ''}</div>
      <div class="small muted">/${esc(p.slug)} · ${isExt ? (p.externalUrl ? '→ ' + esc(p.externalUrl) : 'your page URL not set yet') : (p.mode === 'html' ? 'paste-HTML page' : (p.template ? esc(p.template) : 'blank'))} · created ${fmtDate(p.createdAt)}</div>
      <div class="small" style="margin-top:4px"><span class="tag ${p.status === 'live' ? 'tag-live' : 'tag-draft'}">${p.status === 'live' ? '● Live' : '○ Draft'}</span>
      ${p.tracking && p.tracking.smart ? '<span class="tag tag-smart">✈️ Smart Tracking</span>' : ''}
      <span class="muted"> ${s.views} views · ${s.clicks} clicks · ${s.joins} joins</span></div>
      <div class="small" style="margin-top:4px">🔗 <a href="${esc(url)}" target="_blank">${esc(url.replace(/^https?:\/\//, ''))}</a>${isExt && p.externalUrl ? ` · <span class="muted">your page: <a href="${esc(p.externalUrl)}" target="_blank">${esc(p.externalUrl.replace(/^https?:\/\//, ''))}</a></span>` : ` · <span class="muted">subdomain: ${esc(subUrl.replace(/^https?:\/\//, ''))}</span>`}</div></div>
      <div class="inline-row">
        <a class="btn btn-sm" href="${esc(viewUrl)}" target="_blank">View</a>
        <button class="btn btn-sm" data-copy="${esc(url)}" data-copy-label="Live link">Copy link</button>
        <button class="btn btn-sm" onclick="copyEmbedCode('${p.id}')">Embed code</button>
        ${isExt ? '' : `<button class="btn btn-sm" onclick="exportPageHTML('${p.id}')">Export HTML</button>`}
        <a class="btn btn-sm btn-primary" href="${editHref}">Edit</a>
        <button class="btn btn-sm" onclick="duplicatePage('${p.id}')">Duplicate</button>
        <button class="btn btn-sm btn-danger" onclick="deletePage('${p.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}
const SAMPLE_HTML = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>My Offer Page</title>\n<style>\n  body { margin: 0; font-family: Arial, sans-serif; background: #0F172A; color: #fff; text-align: center; }\n  .box { max-width: 640px; margin: 0 auto; padding: 80px 20px; }\n  h1 { font-size: 42px; margin: 0 0 12px; }\n  p { color: #CBD5E1; font-size: 18px; }\n  a.btn { display: inline-block; margin-top: 24px; background: #22C55E; color: #fff;\n    padding: 16px 32px; border-radius: 999px; font-weight: bold; font-size: 18px; text-decoration: none; }\n</style>\n</head>\n<body>\n  <div class="box">\n    <h1>🔥 My Special Offer</h1>\n    <p>This is a complete HTML page pasted into BanaoPage. Edit this code —<br>change the text, colours and link — then publish it.</p>\n    <a class="btn" href="https://t.me/banaopage" target="_blank">Join on Telegram →</a>\n  </div>\n</body>\n</html>';
function createHtmlPage() {
  const user = currentUser(); if (!user) return;
  const plan = PLANS[planOf(user)];
  if (myPages(user).length >= plan.pages) { toast('Page limit reached on the ' + plan.name + ' plan. Upgrade in Settings.'); return; }
  const p = { id: uid(), owner: user.id, template: 'html', title: 'My HTML Page', slug: slugify('my-html-page-' + Math.random().toString(36).slice(2, 5)), seoTitle: 'My HTML Page | BanaoPage', seoDesc: 'A page built by pasting raw HTML.', status: 'draft', mode: 'html', htmlCode: SAMPLE_HTML, history: [], blocks: [], tracking: { smart: false, botToken: '', channel: '', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: null }, createdAt: Date.now() };
  DB.pages.push(p); saveDB(); toast('HTML page created — paste your code'); location.hash = '#/builder/' + p.id; render();
}
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/* Standalone .html export of a block-built page (no JS — countdowns/forms stay inert). */
const EXPORT_CSS = 'body{margin:0;font-family:Arial,sans-serif;color:#111827;line-height:1.55}' +
  '.blk-hero{padding:56px 24px;text-align:center}.blk-hero h1{margin:0 0 10px}.blk-hero p{color:#4B5563;max-width:560px;margin:0 auto 18px}' +
  '.blk-text{padding:22px 26px}.blk-image{padding:10px 26px}.blk-image img{max-width:100%;border-radius:12px;display:block;margin:0 auto}' +
  '.blk-cta{padding:22px 26px;text-align:center}.btn{display:inline-block;background:#4F46E5;color:#fff;padding:13px 28px;border-radius:10px;font-weight:700;text-decoration:none}' +
  '.blk-features{padding:28px 26px}.feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.feat{border:1px solid #E5E7EB;border-radius:12px;padding:16px}' +
  '.blk-testimonial{padding:28px 26px;text-align:center;font-style:italic}.blk-pricing{padding:28px 26px;text-align:center}.blk-faq{padding:24px 26px}' +
  '.blk-countdown{padding:28px 26px;text-align:center}.blk-form{padding:26px;max-width:460px;margin:0 auto}.blk-form input{width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;margin:6px 0}' +
  '.blk-video{padding:16px 26px}.blk-video iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:12px}.blk-divider hr{border:none;border-top:1px solid #E5E7EB}' +
  '.blk-telegram{padding:26px;text-align:center;background:#EEF2FF}.tg-btn{display:inline-block;background:#229ED9;color:#fff;font-weight:700;padding:13px 26px;border-radius:999px;text-decoration:none}' +
  '.blk-survey{padding:26px;text-align:center}.survey-opt{border:1px solid #4F46E5;background:#fff;color:#4F46E5;border-radius:999px;padding:10px 20px;font-weight:700;margin:4px}' +
  '.social-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:20px 26px}.social-btn{border:1px solid #E5E7EB;border-radius:999px;padding:9px 18px;font-weight:700;color:#111827;text-decoration:none}' +
  '.menu-row{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;padding:16px 26px;border-bottom:1px solid #E5E7EB}.menu-row a{color:#111827;font-weight:600;text-decoration:none}' +
  '.align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}.center{text-align:center}.muted{color:#6B7280}.small{font-size:.85rem}';
function buildExportHTML(p) {
  if (p.mode === 'html') return p.htmlCode || '';
  const body = p.blocks.map(b => blockHTML(b, p, 'public')).join('\n');
  return '<!DOCTYPE html>\n<!-- Exported from BanaoPage — countdowns and forms are inert in this file; use the live page for tracking. -->\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + esc(p.seoTitle || p.title) + '</title>\n<meta name="description" content="' + esc(p.seoDesc || '') + '">\n<style>\n' + EXPORT_CSS + '\n</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>';
}
function exportPageHTML(id) {
  const p = DB.pages.find(x => x.id === id); if (!p) return;
  downloadFile(p.slug + '.html', buildExportHTML(p), 'text/html');
  toast('Downloaded ' + p.slug + '.html');
}
function createBlankPage() {
  const user = currentUser(); if (!user) return;
  const plan = PLANS[planOf(user)];
  if (myPages(user).length >= plan.pages) { toast('Page limit reached on the ' + plan.name + ' plan. Upgrade in Settings.'); return; }
  const p = { id: uid(), owner: user.id, template: 'blank', title: 'Untitled Page', slug: slugify('untitled-' + Math.random().toString(36).slice(2, 5)), seoTitle: 'Untitled Page | BanaoPage', seoDesc: '', status: 'draft', mode: 'blocks', htmlCode: '', history: [], blocks: [newBlock('hero'), newBlock('text'), newBlock('button')], tracking: { smart: false, botToken: '', channel: '', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: null }, createdAt: Date.now() };
  DB.pages.push(p); saveDB(); toast('Blank page created'); location.hash = '#/builder/' + p.id; render();
}
/* ---------- Embed tracking for your OWN landing page ---------- */
/* One line of code pasted into any page you host anywhere — views, button
   clicks and Telegram join clicks flow back to this page's dashboard. */
function embedSnippetFor(p) {
  const channel = (p.tracking && p.tracking.channel) || '';
  return '<script src="' + location.origin + '/tracker.js" data-page="' + p.slug + '"' + (channel ? ' data-channel="' + channel + '"' : '') + '><\/script>';
}
function copyEmbedCode(id) {
  const p = DB.pages.find(x => x.id === id); if (!p) return;
  copyText(embedSnippetFor(p), 'Embed code');
}
function createExternalPage() {
  const user = currentUser(); if (!user) return;
  const plan = PLANS[planOf(user)];
  if (myPages(user).length >= plan.pages) { toast('Page limit reached on the ' + plan.name + ' plan. Upgrade in Settings.'); return; }
  const p = { id: uid(), owner: user.id, template: 'external', title: 'My External Page', slug: slugify('external-' + Math.random().toString(36).slice(2, 5)), seoTitle: 'My External Page | BanaoPage', seoDesc: '', status: 'live', mode: 'external', externalUrl: '', htmlCode: '', history: [], blocks: [], tracking: { smart: false, botToken: '', channel: '', pixelId: '', capiToken: '', eventName: 'Lead', countRepeats: false, trialStart: null }, createdAt: Date.now() };
  DB.pages.push(p); saveDB(); toast('External page added — paste the code on your own page'); location.hash = '#/external/' + p.id; render();
}
function renderExternalPage(id, app) {
  const user = currentUser();
  if (!user) { location.hash = '#/login'; render(); return; }
  const p = DB.pages.find(x => x.id === id && x.owner === user.id);
  if (!p || p.mode !== 'external') { location.hash = '#/dashboard'; render(); return; }
  const s = pageStats(p.id);
  const snippet = embedSnippetFor(p);
  app.innerHTML = `
  <div class="wrap page-pad">
    <div class="dash-head">
      <div><h2 style="margin:0">External page</h2><p class="muted" style="margin:4px 0 0">Your own landing page, tracked by BanaoPage</p></div>
      <div class="inline-row"><a class="btn" href="#/dashboard">← Dashboard</a></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">1 · Tell us about your page</h3>
      <label class="small muted">Page name</label>
      <input class="input" id="ext-title" value="${esc(p.title)}" style="margin:4px 0 10px">
      <label class="small muted">Page address (this is the tracking ID)</label>
      <input class="input" id="ext-slug" value="${esc(p.slug)}" style="margin:4px 0 4px">
      <p class="small muted" style="margin:0 0 10px">Live at ${esc(location.origin)}/${esc(p.slug)} — that link redirects to your page below.</p>
      <label class="small muted">Your landing page URL</label>
      <input class="input" id="ext-url" placeholder="https://your-page.com" value="${esc(p.externalUrl || '')}" style="margin:4px 0 10px">
      <label class="small muted">Telegram channel (without @) — optional</label>
      <input class="input" id="ext-channel" placeholder="mychannel" value="${esc(p.tracking && p.tracking.channel ? p.tracking.channel : '')}" style="margin:4px 0 12px">
      <button class="btn btn-primary" onclick="saveExternalPage('${p.id}')">Save</button>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">2 · Paste this ONE line into your page</h3>
      <p class="muted small" style="margin-top:0">Put it anywhere in your page's HTML (near the end of the &lt;body&gt; is best). That is all — tracking starts on its own. Telegram join clicks are counted automatically; confirmed joins need your bot connected, same as Smart Tracking.</p>
      <textarea class="input" rows="3" readonly onclick="this.select()" style="font-family:monospace;font-size:13px">${esc(snippet)}</textarea>
      <div style="margin-top:10px"><button class="btn btn-primary" onclick="copyEmbedCode('${p.id}')">Copy embed code</button></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">3 · Stats so far</h3>
      <p style="margin:0">${s.views} views · ${s.clicks} clicks · ${s.joins} join requests (${s.confirmed} confirmed)</p>
      <p class="small muted" style="margin:8px 0 0">Numbers update when the dashboard pulls fresh data from the cloud.</p>
    </div>
  </div>`;
}
function saveExternalPage(id) {
  const user = currentUser(); const p = DB.pages.find(x => x.id === id && x.owner === user.id); if (!p) return;
  const title = ($('#ext-title').value || '').trim();
  const slugRaw = ($('#ext-slug').value || '').trim();
  const url = ($('#ext-url').value || '').trim();
  const channel = ($('#ext-channel').value || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?t\.me\//i, '').replace(/^t\.me\//i, '');
  if (!title) { toast('Give the page a name.'); return; }
  const st = slugStatus(slugRaw, p.id);
  if (!st.ok) { toast(st.msg); return; }
  p.title = title; p.slug = slugify(slugRaw); p.seoTitle = title + ' | BanaoPage'; p.externalUrl = url;
  p.tracking.channel = channel;
  saveDB(); toast('External page saved — tracking is live once the code is on your page'); render();
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
  const p = DB.pages.find(x => x.id === id);
  confirmModal('Delete this page?', '“' + (p ? p.title : 'This page') + '” and its analytics and leads will be permanently removed.', 'Delete page', () => {
    DB.pages = DB.pages.filter(x => x.id !== id);
    DB.events = DB.events.filter(e => e.pageId !== id);
    DB.leads = DB.leads.filter(l => l.pageId !== id);
    saveDB(); Cloud.deletePage(id); toast('Page deleted'); render();
  });
}

/* ---------- Templates ---------- */
function renderTemplates(app) {
  const user = currentUser();
  const plan = PLANS[planOf(user)];
  const freeLimit = plan.templates;
  app.innerHTML = `
  <div class="wrap page-pad">
    <h2>Choose a template</h2>
    <p class="muted">Click any template to create a page from it. You can change every block afterwards. Your ${esc(plan.name)} plan includes ${freeLimit} template(s) — 6 built-in templates are live now, more are being added (20 on Starter, 50 on Growth, 100 on Business Pro).</p>
    <div class="grid grid-3" style="margin-top:20px">
      <div class="card tpl-card" onclick="createHtmlPage()">
        <div class="tpl-thumb">&lt;/&gt;</div>
        <h3>Paste your own HTML</h3><p class="muted small">Paste a complete HTML page — it goes live exactly as written. No blocks, no limits.</p>
        <span class="small" style="color:var(--indigo);font-weight:700">Use HTML mode →</span>
      </div>
      ${TEMPLATES.map((t, i) => {
        const locked = i >= freeLimit;
        return `<div class="card tpl-card ${locked ? 'locked-card' : ''}" ${locked ? 'onclick="toast(\'This template needs a paid plan — upgrade in Settings.\');location.hash=\'#/settings\';render();"' : 'onclick="createFromTemplate(\'' + t.id + '\')"'}>
        ${locked ? '<span class="lock-badge">🔒 ' + esc(plan.name) + ' — upgrade</span>' : ''}
        <div class="tpl-thumb">${t.emoji}</div>
        <h3>${esc(t.name)}</h3><p class="muted small">${esc(t.desc)}</p>
        <span class="small" style="color:var(--indigo);font-weight:700">${locked ? 'Locked — upgrade to unlock →' : 'Use this template →'}</span>
      </div>`; }).join('')}
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
function setBilling(cycle) { billingCycle = cycle; renderHome($('#app'), 'pricing'); }
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
    case 'rawhtml': {
      const minH = parseInt(d.height, 10) || 200;
      const fid = 'raw-' + b.id;
      return `<section class="blk-raw"><iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-forms" data-frame-id="${fid}" data-min-height="${minH}" data-fallback-height="${minH}" srcdoc="${esc(injectResizeScript(d.html || '', fid))}" style="height:${minH}px" title="Custom HTML"></iframe></section>`;
    }
    case 'survey': return `<section class="blk-survey"><h2>${esc(d.question || 'What do you think?')}</h2><p class="muted">Tap an answer — it is saved to the page owner's Leads inbox.</p>
      <div class="survey-opts">${(d.options || []).map(o => `<button class="survey-opt" data-survey-opt data-page="${page ? page.id : ''}" data-question="${esc(d.question || '')}" data-answer="${esc(o)}">${esc(o)}</button>`).join('')}</div></section>`;
    case 'social': return `<section class="social-row">${(d.links || []).map(l => `<a class="social-btn" href="${esc(l.url || '#')}" target="_blank" rel="noopener" data-cta data-page="${page ? page.id : ''}" data-url="${esc(l.url || '#')}">${esc(l.label || 'Link')}</a>`).join('')}</section>`;
    case 'menu': return `<nav class="menu-row">${(d.links || []).map(l => `<a href="${esc(l.url || '#')}" data-cta data-page="${page ? page.id : ''}" data-url="${esc(l.url || '#')}">${esc(l.label || 'Link')}</a>`).join('')}</nav>`;
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
  const sv = e.target.closest('[data-survey-opt]');
  if (sv) {
    const pageId = sv.getAttribute('data-page');
    const ld = { id: uid(), pageId, kind: 'survey', name: '📊 Survey answer', contact: sv.getAttribute('data-answer') || '', question: sv.getAttribute('data-question') || '', ts: Date.now() };
    DB.leads.push(ld); Cloud.sendLead(ld);
    logEvent(pageId, 'click', { label: 'survey_answer', answer: sv.getAttribute('data-answer') || '' });
    saveDB();
    toast('Thanks! Your answer was recorded.');
    return;
  }
  const tg = e.target.closest('[data-tg-join]');
  if (tg) {
    const pageId = tg.getAttribute('data-page');
    const channel = (tg.getAttribute('data-channel') || '').replace(/^@/, '');
    logEvent(pageId, 'click', { label: 'telegram_join_button' });
    /* Redirect explicitly: relying on the anchor's default tab-open is fragile
       (popup blockers / modal re-renders can swallow it). One tab, opened now. */
    e.preventDefault();
    const opened = window.open('https://t.me/' + channel, '_blank', 'noopener');
    if (!opened) toast('Telegram khula nahi — popup allow karo ya khud kholo: t.me/' + channel);
    openJoinModal(pageId, channel);
    return;
  }
  const cta = e.target.closest('[data-cta]');
  if (cta) {
    const pageId = cta.getAttribute('data-page');
    if (pageId) logEvent(pageId, 'click', { label: 'cta', url: cta.getAttribute('data-url') || '' });
    const url = cta.getAttribute('data-url') || cta.getAttribute('href') || '#';
    if (url === '#' || url.startsWith('#')) { e.preventDefault(); toast('Is button ka link abhi khaali hai — builder me is block ko select karke Button link bharo, phir Publish karo.'); }
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
  const ld = { id: uid(), pageId, name, contact, ts: Date.now() };
  DB.leads.push(ld); Cloud.sendLead(ld);
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
/* In-app confirmation (native confirm() is suppressed in some browsers/webviews,
   which made Delete silently do nothing). */
let _confirmAction = null;
function confirmModal(title, message, confirmLabel, fn) {
  _confirmAction = fn;
  $('#modal-root').innerHTML = `
  <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
    <div class="modal">
      <h3 style="margin-top:0">${esc(title)}</h3>
      <p class="muted">${esc(message)}</p>
      <div class="inline-row" style="justify-content:flex-end;margin-top:18px">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger" onclick="runConfirmAction()">${esc(confirmLabel || 'Delete')}</button>
      </div>
    </div>
  </div>`;
}
function runConfirmAction() { const fn = _confirmAction; _confirmAction = null; closeModal(); if (fn) fn(); }
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
  p.updatedAt = Date.now();
  if (!silent) pushHistory(p);
  saveDB();
  const el = $('#autosave'); if (el) el.textContent = 'Saved ✓ ' + new Date().toLocaleTimeString('en-IN');
  if (!silent) toast('Page saved');
}
/* ---------- Page history (last 5 saved snapshots) ---------- */
function pushHistory(p) {
  if (!p) return;
  p.history = p.history || [];
  const snap = { ts: Date.now(), title: p.title, blocks: JSON.parse(JSON.stringify(p.blocks || [])), htmlCode: p.htmlCode || '' };
  const last = p.history[p.history.length - 1];
  if (last && JSON.stringify(last.blocks) === JSON.stringify(snap.blocks) && last.htmlCode === snap.htmlCode && last.title === snap.title) return;
  p.history.push(snap);
  if (p.history.length > 5) p.history = p.history.slice(-5);
}
function showHistory() {
  const p = builderPage(); if (!p) return;
  const items = (p.history || []).slice().reverse();
  $('#modal-root').innerHTML = `
  <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
    <div class="modal">
      <h3 style="margin-top:0">🕘 Page history</h3>
      <p class="muted small">Last ${p.history.length} saved version(s). Restoring replaces the current page content.</p>
      ${items.length ? items.map((s, ri) => {
        const i = p.history.length - 1 - ri;
        return `<div class="history-item"><div><b>${esc(s.title || 'Untitled')}</b><p class="small muted">${fmtDT(s.ts)} · ${(s.blocks || []).length} block(s)${p.mode === 'html' ? ' · HTML page' : ''}</p></div>
        <button class="btn btn-sm" onclick="restoreSnapshot(${i})">Restore</button></div>`;
      }).join('') : '<p class="muted">No saved versions yet — hit Save and a snapshot will appear here.</p>'}
      <button class="btn btn-block" style="margin-top:8px" onclick="closeModal()">Close</button>
    </div>
  </div>`;
}
function restoreSnapshot(i) {
  const p = builderPage(); if (!p) return;
  const s = (p.history || [])[i]; if (!s) return;
  pushHistory(p);
  p.title = s.title; p.blocks = JSON.parse(JSON.stringify(s.blocks || [])); p.htmlCode = s.htmlCode || '';
  saveDB(); closeModal(); toast('Restored version from ' + fmtDT(s.ts));
  render();
}
/* ---------- Raw-HTML page builder ---------- */
function renderHtmlBuilder(p, app) {
  B.pageId = p.id;
  const url = publicUrlFor(p);
  app.innerHTML = `
  <div class="builder">
    <aside class="palette">
      <h4>&lt;/&gt; HTML Page</h4>
      <p class="small muted">Paste a <b>complete HTML document</b> — it goes live exactly as written when you publish. Scripts run inside a sandboxed frame, so your code can never break the BanaoPage dashboard.</p>
      <button class="btn btn-sm btn-block" onclick="useSampleHtml()">Use sample page</button>
      <button class="btn btn-sm btn-block" style="margin-top:8px" onclick="toggleHtmlPreview()">👁 Preview HTML</button>
      <button class="btn btn-sm btn-block" style="margin-top:8px" onclick="exportPageHTML('${p.id}')">⬇ Export HTML</button>
      <hr style="margin:16px 0">
      <a class="btn btn-sm btn-block" href="#/dashboard">← Dashboard</a>
      <a class="btn btn-sm btn-block" href="${esc(url)}" target="_blank" style="margin-top:8px">View live page ↗</a>
    </aside>
    <div class="canvas-col">
      <div class="builder-bar">
        <b>${esc(p.title)}</b>
        <span class="tag ${p.status === 'live' ? 'tag-live' : 'tag-draft'}">${p.status === 'live' ? '● Live' : '○ Draft'}</span>
        ${/^untitled-/.test(p.slug || '') ? '<span class="untitled-hint">⚠ Address abhi ' + esc(p.slug) + ' hai — SEO &amp; Link tab me apna naam daal lo.</span>' : ''}
        <span class="autosave" id="autosave"></span>
        <span class="spacer"></span>
        <button class="btn btn-sm" onclick="showHistory()">🕘 History</button>
        <button class="btn btn-sm" onclick="saveBuilder()">💾 Save</button>
        <button class="btn btn-sm ${p.status === 'live' ? '' : 'btn-emerald'}" onclick="togglePublish()">${p.status === 'live' ? 'Unpublish' : 'Publish'}</button>
        <button class="btn btn-sm btn-primary" data-copy="${esc(url)}" data-copy-label="Live link">Copy link</button>
      </div>
      <label style="margin-top:0">Your HTML code</label>
      <textarea id="html-editor" class="code-editor" spellcheck="false" oninput="updateHtmlCode(this.value)"></textarea>
      <div id="html-preview-wrap" style="margin-top:16px">
        <h4 style="margin:0 0 8px">Preview</h4>
        <iframe id="html-preview-frame" class="html-preview-frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-forms" title="HTML preview"></iframe>
      </div>
      <p class="small muted center" style="margin-top:12px">Edits autosave · Preview updates as you type · Publish to make it live</p>
    </div>
    <aside class="inspector" id="inspector"></aside>
  </div>`;
  const ed = $('#html-editor'); if (ed) ed.value = p.htmlCode || '';
  const fr = $('#html-preview-frame'); if (fr) setFrameSrcdoc(fr, p.htmlCode || '', 'html-preview', 520, 900);
  renderInspector();
  saveBuilder(true);
}
function updateHtmlCode(v) {
  const p = builderPage(); if (!p) return;
  p.htmlCode = v; saveDB(); saveBuilder(true);
  const fr = $('#html-preview-frame'); if (fr) setFrameSrcdoc(fr, v, 'html-preview', 520, 900);
}
function useSampleHtml() {
  const p = builderPage(); if (!p) return;
  pushUndoLight();
  p.htmlCode = SAMPLE_HTML; saveDB(); saveBuilder(true);
  const ed = $('#html-editor'); if (ed) ed.value = SAMPLE_HTML;
  const fr = $('#html-preview-frame'); if (fr) setFrameSrcdoc(fr, SAMPLE_HTML, 'html-preview', 520, 900);
  toast('Sample HTML loaded — edit it and publish');
}
function toggleHtmlPreview() {
  const w = $('#html-preview-wrap'); if (!w) return;
  const hidden = w.style.display === 'none';
  w.style.display = hidden ? '' : 'none';
  if (hidden) { const p = builderPage(); const fr = $('#html-preview-frame'); if (fr && p) setFrameSrcdoc(fr, p.htmlCode || '', 'html-preview', 520, 900); }
}
function renderBuilder(pageId, app) {
  const user = currentUser();
  const p = DB.pages.find(x => x.id === pageId && x.owner === (user && user.id));
  if (!p) { app.innerHTML = '<div class="wrap page-pad"><div class="card">Page not found or not yours. <a href="#/dashboard">Back to dashboard</a></div></div>'; return; }
  if (p.mode === 'html') { renderHtmlBuilder(p, app); return; }
  B.pageId = pageId; if (!p.blocks.some(b => b.id === B.selected)) B.selected = null;
  const url = publicUrlFor(p);
  app.innerHTML = `
  <div class="builder">
    <aside class="palette">
      <h4>Blocks</h4>
      <p class="small muted">Click to add to the bottom of the page.</p>
      ${BLOCK_TYPES.map(t => `<button class="palette-btn" onclick="addBlock('${t.type}')">${t.icon} ${t.label}</button>`).join('')}
      <hr style="margin:16px 0">
      <a class="btn btn-sm btn-block" href="#/dashboard">← Dashboard</a>
      <a class="btn btn-sm btn-block" href="${esc(url)}" target="_blank" style="margin-top:8px">View live page ↗</a>
    </aside>
    <div class="canvas-col">
      <div class="builder-bar">
        <b>${esc(p.title)}</b>
        <span class="tag ${p.status === 'live' ? 'tag-live' : 'tag-draft'}">${p.status === 'live' ? '● Live' : '○ Draft'}</span>
        ${/^untitled-/.test(p.slug || '') ? '<span class="untitled-hint">⚠ Address abhi ' + esc(p.slug) + ' hai — SEO &amp; Link tab me apna naam daal lo.</span>' : ''}
        <span class="autosave" id="autosave"></span>
        <span class="spacer"></span>
        <div class="seg">
          <button class="${B.device === 'desktop' ? 'active' : ''}" onclick="setDevice('desktop')">🖥️ Desktop</button>
          <button class="${B.device === 'mobile' ? 'active' : ''}" onclick="setDevice('mobile')">📱 Mobile</button>
        </div>
        <button class="btn btn-sm" onclick="undoBuilder()" title="Undo last change">↩ Undo</button>
        <button class="btn btn-sm" onclick="showHistory()">🕘 History</button>
        <button class="btn btn-sm" onclick="exportPageHTML('${p.id}')">⬇ Export HTML</button>
        <button class="btn btn-sm" onclick="saveBuilder()">💾 Save</button>
        <button class="btn btn-sm ${p.status === 'live' ? '' : 'btn-emerald'}" onclick="togglePublish()">${p.status === 'live' ? 'Unpublish' : 'Publish'}</button>
        <button class="btn btn-sm btn-primary" data-copy="${esc(url)}" data-copy-label="Live link">Copy link</button>
      </div>
      <div class="canvas ${B.device === 'mobile' ? 'mobile' : ''}" id="builder-canvas"></div>
      <p class="small muted center" style="margin-top:12px">Click a block to edit it · Drag blocks to reorder · Changes autosave when you edit fields · <b>Preview me buttons/links click nahi hote — live page pe test karo.</b></p>
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
    el.addEventListener('click', e => { if (e.target.closest('.block-tools')) return; e.preventDefault(); B.selected = el.getAttribute('data-block-id'); B.tab = 'design'; renderBuilderCanvas(); renderInspector(); });    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.getAttribute('data-index')); el.classList.add('dragging'); });
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
  wireAutoFrames(c); /* arm resize fallbacks for any Raw HTML blocks on the canvas */
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
  pushHistory(p);
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
/* A Raw HTML block holding a whole page belongs in Paste-HTML mode: move its
   code onto the page itself and drop the block. */
function convertRawBlockToHtmlPage() {
  const p = builderPage(); const b = selectedBlock(); if (!p || !b) return;
  pushUndo();
  p.htmlCode = b.data.html || '';
  p.mode = 'html';
  p.blocks = p.blocks.filter(x => x.id !== b.id);
  B.selected = null; B.tab = 'design';
  saveDB(); toast('Converted to a Paste-HTML page — publish it to go live');
  render();
}
let _undoLight = 0;
function pushUndoLight() { const now = Date.now(); if (now - _undoLight > 800) { pushUndo(); _undoLight = now; } }
function updateBlockList(field, text) {
  const b = selectedBlock(); if (!b) return;
  pushUndoLight();
  b.data[field] = text.split('\n').map(s => s.trim()).filter(Boolean);
  saveDB(); renderBuilderCanvas(); saveBuilder(true);
}
function updateLinkList(field, text) {
  const b = selectedBlock(); if (!b) return;
  pushUndoLight();
  b.data[field] = text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const parts = line.split('|'); return { label: (parts[0] || '').trim(), url: (parts[1] || '#').trim() };
  });
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
  if (!b) {
    if (p.mode === 'html') { el.innerHTML = tabs + '<h4>HTML page</h4><p class="muted">Edit your code in the big editor on the left. It renders in the preview below it and goes live exactly as written when you publish.</p><h4>Page</h4><label>Page title</label><input value="' + esc(p.title) + '" oninput="renamePage(this.value)"><p class="small muted">Use the SEO &amp; Link tab to change the page address, and Tracking to connect Telegram / Meta.</p>'; return; }
    el.innerHTML = tabs + '<p class="muted">Click any block on the canvas to edit it here.</p><h4>Page</h4><label>Page title</label><input value="' + esc(p.title) + '" oninput="renamePage(this.value)"><p class="small muted">Title is shown in your dashboard and in the browser tab of the public page.</p>'; return; }
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
  else if (b.type === 'rawhtml') {
    const looksFullPage = /(<!doctype|<html)/i.test(d.html || '');
    fields += `<label>HTML / CSS / JS code</label><textarea class="code-editor" style="min-height:220px" rows="10" onchange="updateBlockField('html', this.value)">${esc(d.html || '')}</textarea>` +
      (looksFullPage ? `<div class="note-box" style="margin-top:10px;background:#FFFBEB;border-color:#FDE68A">⚠️ Ye poora page lag raha hai — poora page live karne ke liye <b>'Paste HTML' page mode</b> behtar hai, warna lamba content cut sakta hai.<br><button class="btn btn-sm" style="margin-top:8px" onclick="convertRawBlockToHtmlPage()">Convert to HTML page →</button></div>` : '') +
      `<p class="small muted">Renders in a sandboxed frame — your code can never break the dashboard. Applied when you leave this box. The frame grows to fit your content automatically.</p>` + fieldRow('Minimum height (px)', 'height', d.height, 'number');
  }
  else if (b.type === 'survey') fields += fieldRow('Question', 'question', d.question) + `<label>Answer options (one per line, 2–4)</label><textarea rows="4" oninput="updateBlockList('options', this.value)">${esc((d.options || []).join('\n'))}</textarea><p class="small muted">On the live page, each tap is saved to your Leads inbox as a survey answer.</p>`;
  else if (b.type === 'social') fields += `<label>Social links — one per line, as "Label | URL"</label><textarea rows="5" oninput="updateLinkList('links', this.value)">${esc((d.links || []).map(l => l.label + ' | ' + l.url).join('\n'))}</textarea><p class="small muted">Telegram, Instagram, YouTube, X, WhatsApp — whatever you list becomes a button.</p>`;
  else if (b.type === 'menu') fields += `<label>Menu links — one per line, as "Label | URL"</label><textarea rows="4" oninput="updateLinkList('links', this.value)">${esc((d.links || []).map(l => l.label + ' | ' + l.url).join('\n'))}</textarea>`;
  /* Warn loudly when a button has no destination — a '#' button looks dead on the live page. */
  const linkVal = b.type === 'hero' || b.type === 'pricing' ? d.btnUrl : (b.type === 'button' ? d.url : null);
  if (linkVal !== null && (!linkVal || linkVal.trim() === '#')) fields += '<div class="note-box" style="margin-top:10px;background:#FFFBEB;border-color:#FDE68A">⚠️ Is button ka link abhi khaali hai — live page pe click karne se kuch nahi hoga. Upar <b>Button link</b> me apna Telegram / offer link daalo.</div>';
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
  const url = publicUrlFor(p);
  const subUrl = subdomainUrlFor(p);
  const st = slugStatus(p.slug, p.id);
  return `<h4>SEO &amp; public link</h4>
  <label>Page address / Subdomain</label>
  <div class="copy-row"><span class="mono" style="align-self:center">${esc(location.origin.replace(/^https?:\/\//, ''))}/</span><input id="slug-input" value="${esc(p.slug)}" oninput="updateSlugLive(this.value)"></div>
  <p class="small" id="slug-status" class="${st.ok ? 'slug-ok' : 'slug-bad'}">${esc(st.msg)}</p>
  <p class="small muted">Lowercase letters, numbers and hyphens only. This name is your page's address — it must be unique across your pages.</p>
  <label>Live link (works right now)</label><div class="copy-row"><input readonly id="seo-live-link" value="${esc(url)}"><button class="btn btn-sm" data-copy="${esc(url)}" data-copy-label="Live link">Copy</button></div>
  <label>Subdomain address</label><div class="copy-row"><input readonly id="seo-sub-link" value="${esc(subUrl)}"><button class="btn btn-sm" data-copy="${esc(subUrl)}" data-copy-label="Subdomain address">Copy</button></div>
  <div class="note-box" style="margin-top:12px"><b>How the two links work:</b> the <b>/${esc(p.slug)}</b> link works right now on the free vercel.app domain. The <b>${esc(p.slug)}.banaopage.vercel.app</b> form works once a custom domain with wildcard DNS is connected — add your domain in the Vercel dashboard, then add a wildcard DNS record (<code>*.yourdomain.com</code> → Vercel), and the same page opens at <code>${esc(p.slug)}.yourdomain.com</code>.</div>
  <label>SEO title (browser tab + Google)</label><input value="${esc(p.seoTitle)}" oninput="updatePageMeta('seoTitle', this.value)">
  <label>SEO description</label><textarea rows="3" oninput="updatePageMeta('seoDesc', this.value)">${esc(p.seoDesc)}</textarea>
  <p class="small muted" style="margin-top:10px">Status: <b>${p.status === 'live' ? 'Live — anyone with the link can see it' : 'Draft — visitors see "not published"'}</b></p>`;
}
function updateSlugLive(v) {
  const p = builderPage(); if (!p) return;
  const st = slugStatus(v, p.id);
  const el = $('#slug-status');
  if (el) { el.textContent = st.msg; el.className = 'small ' + (st.ok ? 'slug-ok' : 'slug-bad'); }
  if (!st.ok) return;
  p.slug = slugify(v); saveDB(); saveBuilder(true);
  const live = $('#seo-live-link'); if (live) live.value = publicUrlFor(p);
  const sub = $('#seo-sub-link'); if (sub) sub.value = subdomainUrlFor(p);
}
function updateSlug(v) { updateSlugLive(v); }
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
  if (!p) { document.title = 'Page not found | BanaoPage'; app.innerHTML = '<div class="wrap page-pad"><div class="card center"><h2>Page not found</h2><p class="muted">This link may be wrong, or the page was deleted.</p><a class="btn btn-primary" href="/">Go to BanaoPage home</a></div></div>'; return; }
  /* External pages live on the owner's own site — /slug just redirects there. */
  if (p.mode === 'external') {
    if (p.externalUrl) { location.replace(p.externalUrl); return; }
    document.title = 'Page not set up yet | BanaoPage';
    app.innerHTML = '<div class="wrap page-pad"><div class="card center"><h2>This page is not set up yet</h2><p class="muted">The owner has not linked their own landing page here yet.</p><a class="btn" href="/">Go to BanaoPage home</a></div></div>';
    return;
  }
  document.title = (p.seoTitle || p.title) + '';
  document.body.classList.add('public-mode');
  if (p.status !== 'live') {
    app.innerHTML = '<div class="wrap page-pad"><div class="card center"><h2>This page is not published yet</h2><p class="muted">The owner has saved this page as a draft. Please check back later.</p><a class="btn" href="/">Go to BanaoPage home</a></div></div>';
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
  if (p.mode === 'html') {
    /* Full-page pasted HTML: a normal-flow iframe that grows to the content, so
       the whole pasted page renders as one scrolling page with the footer below.
       (Was position:fixed + height:100% — content was trapped in a viewport frame.) */
    app.innerHTML = '<iframe id="html-full-frame" class="html-full-frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-forms" title="' + esc(p.title) + '"></iframe>' +
      '<div class="wrap center small muted" style="padding:18px 0 30px">Made with <a href="/">BanaoPage</a> — landing pages + Telegram tracking</div>';
    const fr = document.getElementById('html-full-frame');
    if (fr) setFrameSrcdoc(fr, p.htmlCode || '', 'html-full', 200, 900);
    logEvent(p.id, 'view');
    if (p.tracking && p.tracking.capiToken) {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'view', slug: p.slug, ts: Date.now() }) }).catch(() => {});
    }
    return;
  }
  app.innerHTML = `<div class="public-page">${p.blocks.map(b => blockHTML(b, p, 'public')).join('')}</div>
  <div class="wrap center small muted" style="padding:18px 0 30px">Made with <a href="/">BanaoPage</a> — landing pages + Telegram tracking</div>`;
  logEvent(p.id, 'view');
  wireAutoFrames(app); /* arm resize fallbacks for any Raw HTML blocks */
  tickCountdowns();
  // Fire a CAPI-side ping for the view (best-effort, never blocks the page)
  if (p.tracking && p.tracking.capiToken) {
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'view', slug: p.slug, ts: Date.now() }) }).catch(() => {});
  }
}

/* ---------- Analytics ---------- */
function renderAnalytics(app) {
  const user = currentUser();
  const plan = PLANS[planOf(user)];
  const pages = myPages(user);
  const windowDays = plan.analyticsDays;
  const since = windowDays === Infinity ? 0 : Date.now() - windowDays * 864e5;
  const evs = DB.events.filter(e => pages.some(p => p.id === e.pageId) && e.ts >= since);
  const c = t => evs.filter(e => e.type === t).length;
  const uniq = t => new Set(evs.filter(e => e.type === t).map(e => e.visitor)).size;
  const windowLabel = windowDays === Infinity ? 'All time' : 'Last ' + windowDays + ' days';
  const utmRows = {};
  evs.filter(e => e.type === 'view' && e.utm_source).forEach(e => {
    const key = e.utm_source + ' / ' + (e.utm_campaign || '(no campaign)');
    utmRows[key] = (utmRows[key] || 0) + 1;
  });
  const utmList = Object.entries(utmRows).sort((a, b) => b[1] - a[1]);
  app.innerHTML = `
  <div class="wrap page-pad">
    <div class="dash-head"><div><h2 style="margin:0">Analytics</h2><p class="muted" style="margin:4px 0 0">${windowLabel} · all your pages · ${esc(plan.name)} plan keeps ${windowDays === Infinity ? 'full history' : windowDays + ' days'}</p></div>
    <div class="inline-row">
      <button class="btn" onclick="exportCSV()">⬇ Export CSV${plan.csv ? '' : ' 🔒'}</button>
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
    <div class="card" style="margin-bottom:20px"><h3 style="margin-top:0">UTM source &amp; campaign report</h3>
    ${plan.utm ? (utmList.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Source / Campaign</th><th>Views</th></tr></thead><tbody>${utmList.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</tbody></table></div><p class="small muted">From utm_source / utm_campaign on your page links — e.g. share as ${esc(location.origin)}/your-page?utm_source=telegram&amp;utm_campaign=launch</p>` : '<p class="muted">No UTM-tagged visits yet. Share links like <code>' + esc(location.origin) + '/your-page?utm_source=telegram&amp;utm_campaign=launch</code> and they will appear here.</p>') : '<p class="muted">🔒 UTM reports are on the <b>Growth</b> and <b>Business Pro</b> plans. <a href="#/settings">Upgrade →</a></p>'}
    </div>
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
  const plan = PLANS[planOf(user)];
  if (!plan.csv) { toast('CSV export is a paid-plan feature — upgrade to Starter (₹1,999/mo) in Settings.'); location.hash = '#/settings'; render(); return; }
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
  confirmModal('Clear analytics + leads?', 'All analytics events and leads will be removed. Your pages stay. This cannot be undone.', 'Clear data', () => {
    DB.events = []; DB.leads = []; saveDB(); toast('Analytics + leads cleared'); render();
  });
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
        return `<tr><td><b>${esc(l.name)}</b>${l.kind === 'survey' && l.question ? '<div class="small muted">Q: ' + esc(l.question) + '</div>' : ''}</td><td>${esc(l.contact)}</td><td>${p ? esc(p.title) : '—'}</td><td>${fmtDT(l.ts)}</td>
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
      <p class="muted">Free ₹0: 3 pages, 1 Smart Tracking (72h trial), analytics 7 days, 5 templates. Starter ₹1,999/mo (₹19,190/yr): 7 pages, 2 Smart, analytics 30 days + CSV, 20 templates. Growth ₹4,999/mo (₹47,990/yr): 20 pages, 8 Smart, analytics 90 days + CSV + UTM reports, 50 templates. Business Pro ₹14,999/mo (₹1,43,990/yr): unlimited pages, 50 Smart, full history + CSV + UTM, 100 templates.</p>
      <div class="inline-row">
        <button class="btn ${plan === 'free' ? 'btn-primary' : ''}" onclick="upgradePlan('free')">Free ₹0</button>
        <button class="btn ${plan === 'starter' ? 'btn-primary' : ''}" onclick="upgradePlan('starter')">Starter ₹1,999/mo</button>
        <button class="btn ${plan === 'growth' ? 'btn-primary' : ''}" onclick="upgradePlan('growth')">Growth ₹4,999/mo</button>
        <button class="btn ${plan === 'pro' ? 'btn-primary' : ''}" onclick="upgradePlan('pro')">Business Pro ₹14,999/mo</button>
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
  confirmModal('Reset everything?', 'This clears ALL BanaoPage data in this browser (accounts, pages, events, leads) and logs you out.', 'Reset all', () => {
    localStorage.removeItem(DB_KEY);
    DB = defaultDB(); seedDemo();
    location.hash = '#/'; render(); toast('All data reset — demo content re-seeded');
  });
}

/* ---------- Boot ---------- */
/* Read-only debug handle (handy for testing / support): window.BanaoPage.db() */
window.BanaoPage = { db: () => DB, PLANS, slugStatus, subdomainFromHostname, resolvePublicPageFromUrl, publicSlugFromUrl, Cloud, buildExportHTML, injectResizeScript, setFrameSrcdoc, wireAutoFrames };
if (currentUser()) Cloud.pull();
render();

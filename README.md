# BanaoPage

**Landing pages + Telegram join tracking, made simple for India.**

Build beautiful landing pages in minutes — no code — and track **real Telegram join requests**, not just button clicks. Pure static HTML/CSS/JS, no build step, no npm dependencies. Deploys cleanly on Vercel as a static site + two serverless functions.

> Original implementation. Similar functions to other landing-page builders, but all branding, copy and code here are our own.

## Run locally

```bash
cd pagebanao-clone
python3 -m http.server 8080
# open http://localhost:8080
```

Demo account (seeded on first run): **demo@banaopage.in / demo1234** — comes with 2 sample pages, sample analytics and leads.

## Deploy on Vercel

```bash
vercel deploy        # or: import this folder in the Vercel dashboard
```

`vercel.json` rewrites `/p/<slug>` and `/<slug>` to `index.html` so public pages work on refresh. The `api/` folder becomes two serverless functions automatically.

## How tracking works

1. **Views & clicks** — counted in the browser when someone opens a public page (`/<slug>` or the old `#/p/<slug>`) or taps a CTA. Stored in `localStorage` under key `banaopage_db_v1`.
2. **Telegram Join button** — opens `t.me/<channel>` in a new tab and logs a Click. The modal offers **"Simulate join request arriving"**, which logs a Join Request and, after 2 seconds, a Confirmed Join — so analytics visibly moves without a real bot.
3. **Real Telegram tracking (optional)** — in the builder's **Tracking** tab, paste a bot token (from @BotFather) and your channel, then set your bot webhook to `https://<your-domain>/api/telegram-webhook`. Telegram then POSTs `chat_join_request` updates to `api/telegram-webhook.js`. The **Test Telegram Bot** button really calls `https://api.telegram.org/bot<token>/getMe` and shows the bot username or the real error.
4. **Meta Conversions API (optional)** — if `META_CAPI_TOKEN` and `META_PIXEL_ID` env vars are set on Vercel, the webhook forwards join requests to Meta as a server event. Without them it just acknowledges the update and never crashes. The **Send Test CAPI Event** button POSTs to `/api/track` to prove the endpoint responds.

## Plans (simulated — real Pagebanao tiers)

| Plan | Price | Pages | Smart Tracking | Analytics | Templates |
|------|-------|-------|----------------|-----------|-----------|
| Free | ₹0 | 3 | 1 page, 72-hour trial | 7 days | 5 |
| Starter | ₹1,999/mo or ₹19,190/yr | 7 | 2 pages | 30 days + CSV | 20 |
| Growth | ₹4,999/mo or ₹47,990/yr | 20 | 8 pages | 90 days + CSV + UTM | 50 |
| Business Pro | ₹14,999/mo or ₹1,43,990/yr | Unlimited (fair use) | 50 pages | Full history + CSV + UTM | 100 |

Upgrades are simulated in Settings — they change limits in localStorage; no payment is taken. Launch offer: free Smart Tracking on 2 landing pages till 30 Nov, 11:59 pm.

## Page addresses (subdomain-style)

Every page's slug is its address. The **working link** is `https://banaopage.vercel.app/<slug>` (path-based, served by the `/:slug` rewrite). The same page also opens at `<slug>.banaopage.vercel.app` — and at `<slug>.<your-domain>` — **once a custom domain with wildcard DNS is connected** (add the domain in the Vercel dashboard, then a wildcard DNS record `*.yourdomain.com` → Vercel). On the free `vercel.app` domain, Vercel does not route arbitrary `<slug>.banaopage.vercel.app` subdomains to the project, so the UI always shows the working `/<slug>` link first and labels the subdomain form honestly. Old `#/p/<slug>` links keep working.

## Raw HTML

- **"Paste HTML" page** (Dashboard → Paste HTML, or Templates): paste a complete HTML document; it renders in a sandboxed iframe when published, exactly as written.
- **Raw HTML block**: drop into any block-built page; renders in a sandboxed iframe in the builder preview and on the live page.
- **Export HTML** (dashboard row / builder bar): downloads a standalone `.html` file — the pasted code verbatim for HTML pages, or a self-contained render for block pages.
- **Auto-resizing frames (bug fix, 15 Nov 2026):** every HTML iframe gets a tiny `/* BanaoPage auto-resize */` script injected that reports its content height to the parent, which grows the iframe to fit — no more 200px clipping of tall pasted pages. Paste-HTML pages render as a normal scrolling page (not a fixed viewport frame). If no resize message arrives within ~1.5s, the frame falls back to a generous height (900px for full pages). If a Raw HTML block holds a whole page (`<!doctype` / `<html` detected), the inspector warns and offers "Convert to HTML page".

## Embed tracking on your own page

Your own landing page, hosted anywhere, can use BanaoPage tracking with ONE line of code:

```html
<script src="https://banaopage.vercel.app/tracker.js" data-page="your-page-address" data-channel="your-telegram-channel"></script>
```

- Dashboard → **↗ External page**: register your page (name, address, your page URL, Telegram channel) and copy the ready-made snippet.
- Or any page row → **Embed code** copies the snippet for that page.
- The snippet reports views, button clicks and Telegram join clicks to your dashboard for that page. It never throws and never blocks your page.
- Optional: add your Meta Pixel ID (fires PageView + Lead on your page) and your Telegram Bot Token (for confirmed joins). For a private (invite-link) channel, also add its Channel ID — forward any channel message to @getmyid_bot to get it.
- When Telegram confirms a join request, the webhook records a Subscribe event (visible in Analytics + per-page stats) and sends Subscribe to Meta's Conversions API using that page's Pixel ID + CAPI token — server-side, so ad blockers can't stop it. Add the CAPI token in the same setup screen (Events Manager → Settings → Conversions API → Generate access token).
- Opening `banaopage.vercel.app/<address>` redirects to your real page.

## Features

- Landing homepage (hero, features, how-it-works, templates, pricing, FAQ, footer)
- Signup/login with local demo auth + session persistence
- Dashboard with stats, plan-usage bar, search, duplicate/delete, live link + subdomain address per page
- 6 templates: Telegram Channel, Trading Signals, Online Course, Ebook Sale, Product Launch, Webinar/Event (Free plan: first 5)
- Drag-and-drop builder: 17 block types (incl. Raw HTML, Survey/Question, Social Links, Menu), inline inspector, device preview, undo, autosave, publish, SEO fields, per-page history (last 5 snapshots, Restore)
- Public pages with view/click counting, lead forms, survey answers, Telegram join flow
- Analytics: totals, per-page table, 7-day canvas bar chart, CSV export (paid plans), UTM source/campaign report (Growth/Business Pro), plan-based history window (7/30/90 days / full)
- Leads inbox (incl. survey answers), per-page Smart Tracking settings, webhook URL display

## Honest limitation

**Cloud backend is live (15 Nov 2026):** published pages sync to Supabase, so a page opens the same in any browser. The browser still keeps a localStorage copy as an instant cache. Remaining honest limits: analytics history is capped per plan; confirmed joins need your Telegram bot connected; the free tier runs on a shared Supabase project (fair-use limits apply).

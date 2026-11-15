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

`vercel.json` rewrites `/p/<slug>` to `index.html` so public pages work on refresh. The `api/` folder becomes two serverless functions automatically.

## How tracking works

1. **Views & clicks** — counted in the browser when someone opens a public page (`#/p/<slug>`) or taps a CTA. Stored in `localStorage` under key `banaopage_db_v1`.
2. **Telegram Join button** — opens `t.me/<channel>` in a new tab and logs a Click. The modal offers **"Simulate join request arriving"**, which logs a Join Request and, after 2 seconds, a Confirmed Join — so analytics visibly moves without a real bot.
3. **Real Telegram tracking (optional)** — in the builder's **Tracking** tab, paste a bot token (from @BotFather) and your channel, then set your bot webhook to `https://<your-domain>/api/telegram-webhook`. Telegram then POSTs `chat_join_request` updates to `api/telegram-webhook.js`. The **Test Telegram Bot** button really calls `https://api.telegram.org/bot<token>/getMe` and shows the bot username or the real error.
4. **Meta Conversions API (optional)** — if `META_CAPI_TOKEN` and `META_PIXEL_ID` env vars are set on Vercel, the webhook forwards join requests to Meta as a server event. Without them it just acknowledges the update and never crashes. The **Send Test CAPI Event** button POSTs to `/api/track` to prove the endpoint responds.

## Plans (simulated)

| Plan | Price | Pages | Smart Tracking |
|------|-------|-------|----------------|
| Free | ₹0 | 3 | 1 page, 72-hour trial |
| Starter | ₹499/mo | 10 | 2 pages |
| Pro | ₹999/mo | Unlimited | 10 pages |

Upgrades are simulated in Settings — they change limits in localStorage; no payment is taken.

## Features

- Landing homepage (hero, features, how-it-works, templates, pricing, FAQ, footer)
- Signup/login with local demo auth + session persistence
- Dashboard with stats, plan-usage bar, search, duplicate/delete
- 6 templates: Telegram Channel, Trading Signals, Online Course, Ebook Sale, Product Launch, Webinar/Event
- Drag-and-drop builder: 13 block types, inline inspector, device preview, undo, autosave, publish, SEO fields
- Public pages with view/click counting, lead forms, Telegram join flow
- Analytics: totals, per-page table, 7-day canvas bar chart, CSV export
- Leads inbox, per-page Smart Tracking settings, webhook URL display

## Honest limitation

**All data lives in the visitor's browser (localStorage).** A page you publish works for anyone who opens its link *in this browser*, because the page data is read from that browser's storage. Real cross-device publishing — where a page you create on your laptop is visible to a stranger on their phone — needs a backend database (e.g. Sanity/Supabase/Firebase) and authenticated API routes. That is the one deliberate shortcut in this demo build; everything else is fully functional.

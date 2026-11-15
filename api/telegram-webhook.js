// POST /api/telegram-webhook — receives Telegram bot updates (chat_join_request).
// No dependencies. Never crashes when env vars are missing.
// Two jobs:
//  1. Record REAL confirmed joins: a join request whose chat.username matches
//     a page's Telegram channel (or whose chat.id matches the page's stored
//     Channel ID for private invite-link channels) inserts a 'join' event
//     for that page, so the dashboard's "confirmed joins" number is real.
//  2. Optional: if META_CAPI_TOKEN and META_PIXEL_ID are set, forward a
//     confirmed-join event to the Meta Conversions API.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* Headers are MERGED, never replaced (see api/cloud.js, 15 Nov 2026 bug). */
function sb(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign(
    { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    (opts && opts.headers) || {}
  );
  return fetch(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, o);
}
function rid() {
  return 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let update = {};
  try {
    update = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const joinReq = update.chat_join_request || null;
  if (joinReq) {
    console.log('[banaopage/webhook] join_request from user', joinReq.from && joinReq.from.id, 'chat', joinReq.chat && (joinReq.chat.username || joinReq.chat.id));

    const username = (joinReq.chat && joinReq.chat.username) || '';
    const chatId = joinReq.chat && joinReq.chat.id != null ? String(joinReq.chat.id) : '';
    /* 1. Record the confirmed join against the page(s) using this channel —
       matched by public username, or by numeric channel ID (private channels). */
    if ((username || chatId) && SUPABASE_URL && KEY && typeof fetch === 'function') {
      try {
        const lookups = [];
        if (username) lookups.push(sb('pages?' + encodeURIComponent('tracking->>channel') + '=eq.' + encodeURIComponent(username) + '&select=id'));
        if (chatId) lookups.push(sb('pages?' + encodeURIComponent('tracking->>channelId') + '=eq.' + encodeURIComponent(chatId) + '&select=id'));
        const pageIds = new Set();
        for (const r of await Promise.all(lookups)) {
          if (r.ok) {
            const pages = await r.json();
            (Array.isArray(pages) ? pages : []).forEach(pg => { if (pg && pg.id) pageIds.add(String(pg.id)); });
          }
        }
        for (const pid of pageIds) {
          await sb('events', {
            method: 'POST',
            body: JSON.stringify([{
              id: rid(), page_id: pid, type: 'join',
              label: '', url: 'https://t.me/' + (username || ''),
              visitor: 'tg_' + String((joinReq.from && joinReq.from.id) || ''),
              utm_source: '', utm_medium: '', utm_campaign: '', ts: Date.now()
            }])
          });
          console.log('[banaopage/webhook] recorded confirmed join for page', pid);
        }
      } catch (err) {
        console.error('[banaopage/webhook] join record failed (non-fatal):', err.message);
      }
    }

    /* 2. Optional CAPI forward (unchanged). */
    const token = process.env.META_CAPI_TOKEN;
    const pixelId = process.env.META_PIXEL_ID;
    const eventName = process.env.META_CAPI_EVENT || 'Lead';
    if (token && pixelId) {
      try {
        const payload = {
          data: [{
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            event_source_url: 'https://t.me/' + (joinReq.chat.username || ''),
            user_data: { external_id: String(joinReq.from.id) },
            custom_data: { chat_id: String(joinReq.chat.id), type: 'telegram_join_request' }
          }]
        };
        const r = await fetch('https://graph.facebook.com/v19.0/' + pixelId + '/events?access_token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const out = await r.json().catch(() => ({}));
        console.log('[banaopage/webhook] CAPI response', r.status, JSON.stringify(out).slice(0, 500));
      } catch (err) {
        console.error('[banaopage/webhook] CAPI send failed (non-fatal):', err.message);
      }
    } else {
      console.log('[banaopage/webhook] META_CAPI_TOKEN / META_PIXEL_ID not set — skipping CAPI forward.');
    }
  } else {
    console.log('[banaopage/webhook] update received (not a join request):', Object.keys(update).join(','));
  }

  // Always acknowledge quickly so Telegram does not retry forever.
  return res.status(200).json({ ok: true });
};

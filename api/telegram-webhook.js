// POST /api/telegram-webhook — receives Telegram bot updates (chat_join_request).
// No dependencies. Never crashes when env vars are missing.
// On a real join request this does three things for every page using that
// channel (matched by public username, or by numeric Channel ID for private
// invite-link channels):
//  1. Records a 'join' event (dashboard "Confirmed joins").
//  2. Records a 'subscribe' event (dashboard "Subscribe") — the same fact,
//     kept as its own event so Meta's Subscribe count is visible on its own.
//  3. Sends a Subscribe event to Meta's Conversions API, using that page's
//     own Pixel ID + CAPI token when set, else the global META_PIXEL_ID /
//     META_CAPI_TOKEN env vars (event name META_CAPI_EVENT, default
//     'Subscribe'). Without any pixel/token, 1 and 2 still happen — CAPI
//     is skipped, never fatal.
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
    const fromId = String((joinReq.from && joinReq.from.id) || '');
    const now = Date.now();
    /* 1 + 2. Record the confirmed join AND the Subscribe event against the
       page(s) using this channel — matched by public username, or by numeric
       channel ID (private channels). Pages are fetched and matched in JS: a
       PostgREST `tracking->>channelId` filter silently misses values that
       look numeric (e.g. -1001234567890), because the `->>` text result gets
       compared as a number. */
    let matched = [];
    if ((username || chatId) && SUPABASE_URL && KEY && typeof fetch === 'function') {
      try {
        const r = await sb('pages?select=id,tracking&limit=500');
        if (r.ok) {
          const pages = await r.json();
          matched = (Array.isArray(pages) ? pages : []).filter(pg => {
            const t = (pg && pg.tracking) || {};
            return (username && t.channel === username) || (chatId && String(t.channelId || '') === chatId);
          }).map(pg => ({ id: String(pg.id), tracking: (pg && pg.tracking) || {} }));
          for (const pg of matched) {
            const rows = ['join', 'subscribe'].map(type => ({
              id: rid(), page_id: pg.id, type,
              label: '', url: 'https://t.me/' + (username || ''),
              visitor: 'tg_' + fromId,
              utm_source: '', utm_medium: '', utm_campaign: '', ts: now
            }));
            await sb('events', { method: 'POST', body: JSON.stringify(rows) });
            console.log('[banaopage/webhook] recorded join + subscribe for page', pg.id);
          }
        }
      } catch (err) {
        console.error('[banaopage/webhook] join record failed (non-fatal):', err.message);
      }
    }

    /* 3. Conversions API: one Subscribe per matched page that has its own
       Pixel ID + CAPI token. If no page has its own credentials, fall back
       to the global env vars (one event, same shape). */
    const eventName = process.env.META_CAPI_EVENT || 'Subscribe';
    async function sendCapi(pixelId, token) {
      const payload = { data: [{
        event_name: eventName,
        event_time: Math.floor(now / 1000),
        event_source_url: 'https://t.me/' + (username || ''),
        action_source: 'website',
        user_data: { external_id: 'tg_' + fromId },
        custom_data: { chat_id: chatId, type: 'telegram_join_request' }
      }] };
      const r = await fetch('https://graph.facebook.com/v19.0/' + pixelId + '/events?access_token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const out = await r.json().catch(() => ({}));
      console.log('[banaopage/webhook] CAPI Subscribe → pixel', pixelId, 'status', r.status, JSON.stringify(out).slice(0, 300));
    }
    let capiSent = false;
    for (const pg of matched) {
      const t = pg.tracking || {};
      if (t.pixelId && t.capiToken) {
        try { await sendCapi(String(t.pixelId), String(t.capiToken)); capiSent = true; }
        catch (err) { console.error('[banaopage/webhook] CAPI send failed (non-fatal):', err.message); }
      }
    }
    if (!capiSent && matched.length > 0) {
      const token = process.env.META_CAPI_TOKEN;
      const pixelId = process.env.META_PIXEL_ID;
      if (token && pixelId) {
        try { await sendCapi(pixelId, token); }
        catch (err) { console.error('[banaopage/webhook] CAPI send failed (non-fatal):', err.message); }
      } else {
        console.log('[banaopage/webhook] no per-page or global CAPI credentials — skipping CAPI forward.');
      }
    }
  } else {
    console.log('[banaopage/webhook] update received (not a join request):', Object.keys(update).join(','));
  }

  // Always acknowledge quickly so Telegram does not retry forever.
  return res.status(200).json({ ok: true });
};

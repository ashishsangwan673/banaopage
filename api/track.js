// POST /api/track — accepts tracking events (view / click / join_request / join).
// No dependencies. CORS open (*) so the embed tracker (tracker.js) can post
// from ANY page on the internet.
// Persistence: when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, the
// event is stored in the `events` table (looked up by page slug), so it shows
// up in the owner's BanaoPage dashboard via the normal Cloud pull. Without
// the env vars, or for an unknown slug, the event is only logged and the
// call still returns {ok:true} — the host page must never break.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* Headers are MERGED, never replaced — an opts.headers used to wipe apikey
   (the 15 Nov 2026 sync bug: "No API key found in request"). */
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const event = {
    type: String(body.type || 'event'),
    slug: body.slug ? String(body.slug) : null,
    label: String(body.label || ''),
    url: String(body.url || ''),
    visitor: String(body.visitor || ''),
    utm_source: String(body.utm_source || ''),
    utm_medium: String(body.utm_medium || ''),
    utm_campaign: String(body.utm_campaign || ''),
    ts: Number(body.ts) || Date.now(),
    receivedAt: new Date().toISOString()
  };
  console.log('[banaopage/track]', JSON.stringify(event));

  /* Best-effort persistence — never fail the call over it. */
  if (SUPABASE_URL && KEY && event.slug && typeof fetch === 'function') {
    try {
      const lookup = await sb('pages?slug=eq.' + encodeURIComponent(event.slug) + '&select=id');
      if (lookup.ok) {
        const rows = await lookup.json();
        const page = Array.isArray(rows) ? rows[0] : null;
        if (page && page.id) {
          await sb('events', {
            method: 'POST',
            body: JSON.stringify([{
              id: rid(), page_id: String(page.id), type: event.type,
              label: event.label, url: event.url, visitor: event.visitor,
              utm_source: event.utm_source, utm_medium: event.utm_medium,
              utm_campaign: event.utm_campaign, ts: event.ts
            }])
          });
        }
      }
    } catch (e) { /* log-only; the host page already got its answer */ }
  }
  return res.status(200).json({ ok: true, received: event });
};

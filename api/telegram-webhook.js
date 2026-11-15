// POST /api/telegram-webhook — receives Telegram bot updates (chat_join_request).
// No dependencies. Never crashes when env vars are missing.
// Optional: if META_CAPI_TOKEN and META_PIXEL_ID are set, forwards a confirmed-join
// event to the Meta Conversions API. Without them it just acknowledges the update.
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

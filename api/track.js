// POST /api/track — accepts tracking events (view / click / join_request / join / test_capi).
// No dependencies. Stateless: logs the event and returns {ok:true}.
// The browser app keeps its own event store in localStorage; this endpoint exists so
// server-side consumers (Meta CAPI, webhooks) have a stable place to receive events.
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
    type: body.type || 'event',
    slug: body.slug || null,
    event: body.event || null,
    ts: body.ts || Date.now(),
    receivedAt: new Date().toISOString()
  };
  console.log('[banaopage/track]', JSON.stringify(event));
  return res.status(200).json({ ok: true, received: event });
};

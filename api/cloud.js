// GET/POST /api/cloud — BanaoPage cloud backend (Supabase via REST, no deps).
// Env vars (Vercel dashboard, never in code): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Without them every call answers
// {ok:false, cloud:false} and the browser app keeps working on localStorage
// alone — the cloud is an upgrade, never a hard dependency.
//
// Ops (all JSON):
//   GET  ?op=status            -> {ok:true, cloud:true|false}
//   GET  ?op=page&slug=NAME   -> {ok:true, page} (live pages only) | 404
//   GET  ?op=mine&owner=ID    -> {ok:true, pages, events, leads}
//   POST {op:'sync', owner, pages:[...]}  -> upsert owner's pages (409 on slug taken by someone else)
//   POST {op:'event', event:{...}}        -> insert one analytics event
//   POST {op:'lead', lead:{...}}          -> insert one lead
//   POST {op:'delete', owner, id}         -> delete a page + its events/leads
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const URL = process.env.SUPABASE_URL || '';
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const cloudOff = () => res.status(503).json({ ok: false, cloud: false, error: 'cloud_not_configured' });
  if (!URL || !KEY) return cloudOff();

  /* Merge headers — never replace them: an opts.headers (e.g. Prefer on
     upsert) used to wipe apikey/Authorization via Object.assign, so Supabase
     answered "No API key found" and no page ever synced. */
  const sb = (path, opts) => {
    const o = Object.assign({}, opts || {});
    o.headers = Object.assign(
      { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      (opts && opts.headers) || {}
    );
    return fetch(URL.replace(/\/$/, '') + '/rest/v1/' + path, o);
  };

  const readBody = () => {
    try { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch (e) { return null; }
  };
  const toRow = p => ({
    id: String(p.id || ''), slug: String(p.slug || ''), owner: String(p.owner || ''),
    title: String(p.title || ''), mode: p.mode === 'html' ? 'html' : 'blocks',
    status: p.status === 'live' ? 'live' : 'draft',
    blocks: Array.isArray(p.blocks) ? p.blocks : [],
    html_code: String(p.htmlCode || ''),
    seo_title: String(p.seoTitle || ''), seo_desc: String(p.seoDesc || ''),
    tracking: p.tracking && typeof p.tracking === 'object' ? p.tracking : {},
    history: Array.isArray(p.history) ? p.history.slice(0, 5) : [],
    created_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  const fromRow = r => ({
    id: r.id, slug: r.slug, owner: r.owner, title: r.title, mode: r.mode,
    status: r.status, blocks: r.blocks || [], htmlCode: r.html_code || '',
    seoTitle: r.seo_title || '', seoDesc: r.seo_desc || '',
    tracking: r.tracking || {}, history: r.history || [],
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now()
  });

  try {
    if (req.method === 'GET') {
      const op = (req.query && req.query.op) || '';
      if (op === 'status') return res.status(200).json({ ok: true, cloud: true });
      if (op === 'page') {
        const slug = String((req.query && req.query.slug) || '').toLowerCase().trim();
        if (!slug) return res.status(400).json({ ok: false, error: 'slug required' });
        const r = await sb('pages?slug=eq.' + encodeURIComponent(slug) + '&status=eq.live&select=*&limit=1');
        if (!r.ok) return res.status(502).json({ ok: false, error: 'db_error' });
        const rows = await r.json();
        if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
        return res.status(200).json({ ok: true, page: fromRow(rows[0]) });
      }
      if (op === 'mine') {
        const owner = String((req.query && req.query.owner) || '');
        if (!owner) return res.status(400).json({ ok: false, error: 'owner required' });
        const q = encodeURIComponent(owner);
        const [pr, er, lr] = await Promise.all([
          sb('pages?owner=eq.' + q + '&select=*&order=updated_at.desc&limit=200'),
          sb('events?select=*&order=ts.desc&limit=500'),
          sb('leads?select=*&order=ts.desc&limit=500')
        ]);
        if (!pr.ok) return res.status(502).json({ ok: false, error: 'db_error' });
        const pages = (await pr.json()).map(fromRow);
        const ids = new Set(pages.map(p => p.id));
        const evs = er.ok ? (await er.json()).filter(e => ids.has(e.page_id)) : [];
        const lds = lr.ok ? (await lr.json()).filter(l => ids.has(l.page_id)) : [];
        const normEv = evs.map(e => ({ id: e.id, pageId: e.page_id, type: e.type, label: e.label || '', url: e.url || '', visitor: e.visitor || '', ts: e.ts, utm_source: e.utm_source || '', utm_medium: e.utm_medium || '', utm_campaign: e.utm_campaign || '' }));
        const normLd = lds.map(l => ({ id: l.id, pageId: l.page_id, kind: l.kind || 'form', name: l.name || '', contact: l.contact || '', question: l.question || '', ts: l.ts }));
        return res.status(200).json({ ok: true, pages, events: normEv, leads: normLd });
      }
      return res.status(400).json({ ok: false, error: 'unknown op' });
    }

    if (req.method === 'POST') {
      const body = readBody();
      if (!body) return res.status(400).json({ ok: false, error: 'Invalid JSON' });
      if (body.op === 'sync') {
        const owner = String(body.owner || '');
        const pages = Array.isArray(body.pages) ? body.pages.slice(0, 200) : [];
        if (!owner || !pages.length) return res.status(400).json({ ok: false, error: 'owner + pages required' });
        const rows = pages.filter(p => p && p.id && p.slug).map(p => { const r = toRow(p); r.owner = owner; return r; });
        if (!rows.length) return res.status(400).json({ ok: false, error: 'no valid pages' });
        // Slug taken by someone else? (unique index would 409 anyway — check first for a clear error.)
        const slugs = [...new Set(rows.map(r => r.slug))];
        const chk = await sb('pages?slug=in.(' + slugs.map(encodeURIComponent).join(',') + ')&select=slug,owner');
        if (chk.ok) {
          const taken = (await chk.json()).filter(x => x.owner !== owner).map(x => x.slug);
          if (taken.length) return res.status(409).json({ ok: false, error: 'slug_taken', slug: taken[0] });
        }
        const up = await sb('pages?on_conflict=id', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows)
        });
        if (!up.ok) return res.status(502).json({ ok: false, error: 'db_error', detail: String(await up.text()).slice(0, 200) });
        return res.status(200).json({ ok: true, synced: rows.length });
      }
      if (body.op === 'event') {
        const e = body.event || {};
        if (!e.id || !e.pageId || !e.type) return res.status(400).json({ ok: false, error: 'event id/pageId/type required' });
        const r = await sb('events', { method: 'POST', body: JSON.stringify([{
          id: String(e.id), page_id: String(e.pageId), type: String(e.type),
          label: String(e.label || ''), url: String(e.url || ''), visitor: String(e.visitor || ''),
          utm_source: String(e.utm_source || ''), utm_medium: String(e.utm_medium || ''), utm_campaign: String(e.utm_campaign || ''),
          ts: Number(e.ts) || Date.now()
        }]) });
        if (!r.ok) return res.status(502).json({ ok: false, error: 'db_error' });
        return res.status(200).json({ ok: true });
      }
      if (body.op === 'lead') {
        const l = body.lead || {};
        if (!l.id || !l.pageId) return res.status(400).json({ ok: false, error: 'lead id/pageId required' });
        const r = await sb('leads', { method: 'POST', body: JSON.stringify([{
          id: String(l.id), page_id: String(l.pageId), kind: String(l.kind || 'form'),
          name: String(l.name || ''), contact: String(l.contact || ''), question: String(l.question || ''),
          data: (l.data && typeof l.data === 'object') ? l.data : {}, ts: Number(l.ts) || Date.now()
        }]) });
        if (!r.ok) return res.status(502).json({ ok: false, error: 'db_error' });
        return res.status(200).json({ ok: true });
      }
      if (body.op === 'delete') {
        const owner = String(body.owner || ''), id = String(body.id || '');
        if (!owner || !id) return res.status(400).json({ ok: false, error: 'owner + id required' });
        const chk = await sb('pages?id=eq.' + encodeURIComponent(id) + '&select=owner');
        if (chk.ok) {
          const rows = await chk.json();
          if (!rows.length || rows[0].owner !== owner) return res.status(404).json({ ok: false, error: 'not_found' });
        }
        await Promise.all([
          sb('events?page_id=eq.' + encodeURIComponent(id), { method: 'DELETE' }),
          sb('leads?page_id=eq.' + encodeURIComponent(id), { method: 'DELETE' }),
          sb('pages?id=eq.' + encodeURIComponent(id), { method: 'DELETE' })
        ]);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ ok: false, error: 'unknown op' });
    }
    return res.status(405).json({ ok: false, error: 'GET/POST only' });
  } catch (e) {
    console.error('[banaopage/cloud]', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

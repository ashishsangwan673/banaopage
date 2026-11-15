/* BanaoPage Embed Tracker — Smart Tracking for your OWN landing page.
   Paste ONE line into any HTML page you host anywhere:
     <script src="https://banaopage.vercel.app/tracker.js" data-page="your-page-address" data-channel="your-telegram-channel"></script>
   It then reports views, button clicks and Telegram join clicks back to your
   BanaoPage dashboard for that page — the same numbers Smart Tracking shows.
   data-page = the page address (slug) from your BanaoPage dashboard.
   data-channel = your Telegram channel (optional — taken from your t.me links
   on the page when missing). Never throws, never blocks your page. */
(function () {
  'use strict';
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    var script = document.currentScript;
    if (!script) {
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i] && scripts[i].src && scripts[i].src.indexOf('tracker.js') !== -1) { script = scripts[i]; break; }
      }
    }
    if (!script) return;
    var slug = (script.getAttribute('data-page') || '').trim();
    if (!slug) return; /* without a page address there is nothing to attach to */
    var channel = (script.getAttribute('data-channel') || '').trim();
    var base = 'https://banaopage.vercel.app';
    try {
      var src = script.src || '';
      if (src.indexOf('http') === 0) base = src.split('/').slice(0, 3).join('/');
    } catch (e) { /* keep default base */ }
    var endpoint = base + '/api/track';

    /* Visitor id — stable per browser, never personal. */
    var visitor = '';
    try {
      visitor = window.localStorage.getItem('bp_vid') || '';
      if (!visitor) { visitor = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); window.localStorage.setItem('bp_vid', visitor); }
    } catch (e) {
      try {
        visitor = window.sessionStorage.getItem('bp_vid') || '';
        if (!visitor) { visitor = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); window.sessionStorage.setItem('bp_vid', visitor); }
      } catch (e2) { visitor = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
    }

    /* Channel fallback: first t.me link found on the page. */
    function channelFromLinks() {
      if (channel) return channel;
      try {
        var links = document.getElementsByTagName('a');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          var m = href.match(/t\.me\/([A-Za-z0-9_+]+)/);
          if (m) { channel = m[1]; return channel; }
        }
      } catch (e) { /* ignore */ }
      return channel;
    }
    function tgChannelOf(href) {
      var m = String(href || '').match(/t\.me\/([A-Za-z0-9_+]+)/);
      return m ? m[1] : channelFromLinks();
    }

    var utm = { utm_source: '', utm_medium: '', utm_campaign: '' };
    try {
      var q = new URLSearchParams(window.location.search);
      utm.utm_source = q.get('utm_source') || '';
      utm.utm_medium = q.get('utm_medium') || '';
      utm.utm_campaign = q.get('utm_campaign') || '';
    } catch (e) { /* ignore */ }

    /* Meta Pixel (optional): data-pixel="123456789012345" fires PageView on
       load and Lead when a Telegram join link is clicked — the same two
       events BanaoPage fires for its own hosted pages. */
    var pixelId = (script.getAttribute('data-pixel') || '').replace(/\D/g, '');
    function firePixel(eventName) {
      try {
        if (!pixelId) return;
        var w = window;
        if (typeof w.fbq !== 'function') {
          var stub = function () { (stub.queue = stub.queue || []).push(arguments); };
          stub.queue = [];
          w.fbq = stub;
          var s = document.createElement('script');
          s.async = true;
          s.src = 'https://connect.facebook.net/en_US/fbevents.js';
          var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
          if (head && head.appendChild) head.appendChild(s);
        }
        w.fbq('init', pixelId);
        w.fbq('track', eventName);
      } catch (e) { /* pixel must never break the host page */ }
    }

    function send(type, extra) {
      try {
        var payload = {
          type: type, slug: slug, channel: channelFromLinks(),
          label: (extra && extra.label) || '', url: (extra && extra.url) || window.location.href,
          visitor: visitor, ts: Date.now(),
          utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign
        };
        var body = JSON.stringify(payload);
        if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
          try {
            var blob = new Blob([body], { type: 'application/json' });
            if (window.navigator.sendBeacon(endpoint, blob)) return;
          } catch (e) { /* fall through to fetch */ }
        }
        if (typeof fetch === 'function') {
          fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
        }
      } catch (e) { /* never break the host page */ }
    }

    /* One view per page load. */
    function sendView() { send('view', { label: 'embed-tracker' }); firePixel('PageView'); }
    if (document.readyState === 'complete' || document.readyState === 'interactive') sendView();
    else document.addEventListener('DOMContentLoaded', sendView);

    /* Clicks: Telegram links count as join requests, everything else as clicks. */
    var lastClick = { key: '', at: 0 };
    document.addEventListener('click', function (ev) {
      try {
        var t = ev.target && ev.target.closest ? ev.target.closest('a[href], button') : null;
        if (!t) return;
        var href = t.getAttribute('href') || '';
        var text = (t.textContent || '').trim().slice(0, 80);
        var key = (href || text) + '|' + (t.tagName || '');
        var now = Date.now();
        if (key === lastClick.key && now - lastClick.at < 800) return; /* double-fire guard */
        lastClick = { key: key, at: now };
        if (/t\.me\//i.test(href)) {
          send('join_request', { label: text || href, url: href });
          send('click', { label: text || href, url: href });
          firePixel('Lead');
        } else {
          send('click', { label: text || href, url: href || window.location.href });
        }
      } catch (e) { /* never break the host page */ }
    }, false);
  } catch (e) { /* tracker must never throw */ }
})();

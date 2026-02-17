export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LLM Gateway Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #1a1a2e;
    --card:      #16213e;
    --border:    #0f3460;
    --text:      #e4e4e4;
    --muted:     #666;
    --green:     #00d474;
    --red:       #ff4757;
    --yellow:    #ffa502;
    --blue:      #4fc3f7;
    --mono:      'Courier New', Courier, monospace;
    --sans:      -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --radius:    6px;
    --shadow:    0 2px 12px rgba(0,0,0,0.4);
  }

  html, body {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.5;
  }

  /* ── Layout ── */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }

  header h1 {
    font-family: var(--mono);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--green);
  }

  #refresh-indicator {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  #grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 16px;
    padding: 16px;
    min-height: calc(100vh - 49px);
  }

  @media (max-width: 900px) {
    #grid { grid-template-columns: 1fr; }
  }

  /* ── Cards ── */
  .panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }

  .panel-header .title { color: var(--blue); font-weight: 700; }

  .panel-body {
    padding: 14px;
    flex: 1;
    overflow-y: auto;
  }

  /* ── Status panel ── */
  .status-hero {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
  }

  .status-circle {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
    transition: background 0.3s;
  }
  .status-circle.ok  { background: var(--green); box-shadow: 0 0 14px var(--green); }
  .status-circle.err { background: var(--red);   box-shadow: 0 0 14px var(--red); }

  .uptime-label { font-family: var(--mono); font-size: 22px; font-weight: 700; }
  .uptime-sub   { font-size: 11px; color: var(--muted); margin-top: 2px; }

  .provider-cards { display: flex; flex-direction: column; gap: 8px; }

  .provider-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
  }

  .provider-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .provider-name { font-family: var(--mono); font-weight: 700; font-size: 13px; }

  .badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .badge-green  { background: rgba(0,212,116,0.15); color: var(--green); border: 1px solid rgba(0,212,116,0.3); }
  .badge-red    { background: rgba(255,71,87,0.15);  color: var(--red);   border: 1px solid rgba(255,71,87,0.3); }
  .badge-gray   { background: rgba(102,102,102,0.2); color: var(--muted); border: 1px solid rgba(102,102,102,0.3); }
  .badge-yellow { background: rgba(255,165,2,0.15);  color: var(--yellow);border: 1px solid rgba(255,165,2,0.3); }

  .provider-meta { font-size: 11px; color: var(--muted); font-family: var(--mono); }
  .provider-meta span { margin-right: 12px; }

  /* ── Token panel ── */
  .token-table-wrap { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-family: var(--mono);
  }

  th {
    text-align: left;
    padding: 6px 8px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  td {
    padding: 8px 8px;
    border-bottom: 1px solid rgba(15,52,96,0.5);
    vertical-align: middle;
  }

  tr:last-child td { border-bottom: none; }

  .token-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: flex-start;
    padding: 8px 8px 10px;
    border-bottom: 1px solid rgba(15,52,96,0.4);
  }

  .token-actions:last-child { border-bottom: none; }

  .provider-actions-label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    width: 100%;
    margin-bottom: 4px;
  }

  /* ── Buttons ── */
  .btn {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid;
    font-size: 11px;
    font-family: var(--mono);
    font-weight: 700;
    cursor: pointer;
    background: transparent;
    transition: opacity 0.15s, transform 0.1s;
    white-space: nowrap;
  }
  .btn:hover  { opacity: 0.8; transform: translateY(-1px); }
  .btn:active { transform: translateY(0); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  .btn-green  { color: var(--green);  border-color: var(--green); }
  .btn-blue   { color: var(--blue);   border-color: var(--blue); }
  .btn-yellow { color: var(--yellow); border-color: var(--yellow); }
  .btn-red    { color: var(--red);    border-color: var(--red); }

  /* ── Insert token form ── */
  .insert-form {
    display: none;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
    padding: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
  }
  .insert-form.open { display: flex; }

  .insert-form input {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 11px;
    padding: 5px 8px;
    outline: none;
    width: 100%;
  }
  .insert-form input:focus { border-color: var(--blue); }

  .insert-form-row {
    display: flex;
    gap: 6px;
  }

  .insert-form label {
    font-size: 10px;
    color: var(--muted);
    font-family: var(--mono);
    text-transform: uppercase;
    margin-bottom: 2px;
    display: block;
  }

  /* ── Device flow result ── */
  .device-result {
    display: none;
    margin-top: 8px;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--yellow);
    border-radius: var(--radius);
    font-family: var(--mono);
    font-size: 12px;
    width: 100%;
  }
  .device-result.open { display: block; }
  .device-code { font-size: 20px; font-weight: 700; color: var(--yellow); letter-spacing: 0.15em; }
  .device-url  { font-size: 11px; color: var(--blue); margin-top: 4px; }
  .device-url a { color: var(--blue); }

  /* ── Usage panel ── */
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  }

  .summary-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
  }

  .summary-card .val {
    font-family: var(--mono);
    font-size: 20px;
    font-weight: 700;
    color: var(--green);
  }

  .summary-card .lbl {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: 2px;
  }

  .section-label {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: var(--mono);
    margin: 12px 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  /* ── Models panel ── */
  .model-alias-block { margin-bottom: 16px; }

  .model-alias-block:last-child { margin-bottom: 0; }

  .alias-heading {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--blue);
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--border);
  }

  .provider-route {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(15,52,96,0.4);
  }
  .provider-route:last-child { border-bottom: none; }

  .priority-badge {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--blue);
    flex-shrink: 0;
    border: 1px solid var(--blue);
  }

  .priority-badge.p1 { border-color: var(--green); color: var(--green); }
  .priority-badge.p2 { border-color: var(--yellow); color: var(--yellow); }

  .route-provider { font-family: var(--mono); font-size: 12px; font-weight: 700; }
  .route-model    { font-family: var(--mono); font-size: 11px; color: var(--muted); }

  /* ── Feedback messages ── */
  .msg {
    font-family: var(--mono);
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 4px;
    margin-top: 6px;
    display: none;
  }
  .msg.show { display: block; }
  .msg-ok  { background: rgba(0,212,116,0.1);  color: var(--green); border: 1px solid rgba(0,212,116,0.3); }
  .msg-err { background: rgba(255,71,87,0.1);  color: var(--red);   border: 1px solid rgba(255,71,87,0.3); }

  /* ── Loading / empty states ── */
  .loading, .empty {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    padding: 20px;
    text-align: center;
  }

  /* ── Ticker ── */
  #ticker {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green);
    margin-right: 6px;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.2; }
  }
</style>
</head>
<body>

<header>
  <h1>LLM Gateway Dashboard</h1>
  <span id="refresh-indicator"><span id="ticker"></span>auto-refresh 5s</span>
</header>

<div id="grid">
  <!-- Panel 1: Gateway Status -->
  <div class="panel">
    <div class="panel-header"><span class="title">Gateway Status</span><span id="status-ts"></span></div>
    <div class="panel-body" id="status-body"><div class="loading">Loading...</div></div>
  </div>

  <!-- Panel 2: OAuth Tokens -->
  <div class="panel">
    <div class="panel-header"><span class="title">OAuth Tokens</span><span id="tokens-ts"></span></div>
    <div class="panel-body" id="tokens-body"><div class="loading">Loading...</div></div>
  </div>

  <!-- Panel 3: Token Usage -->
  <div class="panel">
    <div class="panel-header"><span class="title">Token Usage</span><span id="usage-ts"></span></div>
    <div class="panel-body" id="usage-body"><div class="loading">Loading...</div></div>
  </div>

  <!-- Panel 4: Model Routing -->
  <div class="panel">
    <div class="panel-header"><span class="title">Model Routing</span><span id="models-ts"></span></div>
    <div class="panel-body" id="models-body"><div class="loading">Loading...</div></div>
  </div>
</div>

<script>
(function () {
  'use strict';

  /* ── Helpers ── */

  function fmt(n) {
    return typeof n === 'number' ? n.toLocaleString() : '—';
  }

  function fmtUptime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return String(h).padStart(2, '0') + 'h '
      + String(m).padStart(2, '0') + 'm '
      + String(s).padStart(2, '0') + 's';
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = Date.now();
    const diff = ts - now;
    if (Math.abs(diff) < 60000) return 'just now';
    if (diff > 0) {
      const mins = Math.floor(diff / 60000);
      if (mins < 60) return 'in ' + mins + 'm';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return 'in ' + hrs + 'h ' + (mins % 60) + 'm';
      return 'in ' + Math.floor(hrs / 24) + 'd';
    } else {
      const mins = Math.floor(-diff / 60000);
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return d.toLocaleDateString();
    }
  }

  function nowStr() {
    return new Date().toLocaleTimeString();
  }

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(function(kv) { e[kv[0]] = kv[1]; });
    if (children) children.forEach(function(c) {
      if (typeof c === 'string') { const t = document.createTextNode(c); e.appendChild(t); }
      else if (c) e.appendChild(c);
    });
    return e;
  }

  function txt(tag, content, attrs) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(function(kv) { e[kv[0]] = kv[1]; });
    e.textContent = content;
    return e;
  }

  function badge(text, cls) {
    const b = document.createElement('span');
    b.className = 'badge ' + cls;
    b.textContent = text;
    return b;
  }

  /* ── Fetch wrapper ── */

  async function fetchData(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error('HTTP ' + resp.status + ': ' + body);
    }
    return resp.json();
  }

  async function postData(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const b = await resp.text();
      throw new Error('HTTP ' + resp.status + ': ' + b);
    }
    return resp.json();
  }

  /* ── Panel 1: Gateway Status ── */

  function updateStatus(data) {
    const body = document.getElementById('status-body');
    document.getElementById('status-ts').textContent = nowStr();
    body.innerHTML = '';

    // Hero row
    const hero = document.createElement('div');
    hero.className = 'status-hero';

    const circle = document.createElement('div');
    circle.className = 'status-circle ' + (data.status === 'ok' ? 'ok' : 'err');
    hero.appendChild(circle);

    const info = document.createElement('div');
    const uptimeEl = txt('div', fmtUptime(data.uptime), { className: 'uptime-label' });
    const uptimeSub = txt('div', 'uptime', { className: 'uptime-sub' });
    info.appendChild(uptimeEl);
    info.appendChild(uptimeSub);
    hero.appendChild(info);
    body.appendChild(hero);

    // Provider cards
    if (data.providers && Object.keys(data.providers).length > 0) {
      const cards = document.createElement('div');
      cards.className = 'provider-cards';

      Object.entries(data.providers).forEach(function(entry) {
        const name = entry[0];
        const info = entry[1];

        const card = document.createElement('div');
        card.className = 'provider-card';

        const hdr = document.createElement('div');
        hdr.className = 'provider-card-header';
        hdr.appendChild(txt('span', name, { className: 'provider-name' }));
        hdr.appendChild(badge(
          info.enabled ? 'enabled' : 'disabled',
          info.enabled ? 'badge-green' : 'badge-gray'
        ));
        card.appendChild(hdr);

        const rl = info.rateLimitStatus || {};
        const meta = document.createElement('div');
        meta.className = 'provider-meta';

        const reqSpan = document.createElement('span');
        reqSpan.textContent = 'req/window: ' + fmt(rl.requestsInWindow);
        meta.appendChild(reqSpan);

        const qSpan = document.createElement('span');
        qSpan.textContent = 'queue: ' + fmt(rl.queueLength);
        meta.appendChild(qSpan);

        card.appendChild(meta);
        cards.appendChild(card);
      });

      body.appendChild(cards);
    } else {
      body.appendChild(txt('div', 'No providers configured.', { className: 'empty' }));
    }
  }

  /* ── Panel 2: OAuth Tokens ── */

  function updateTokens(data) {
    const body = document.getElementById('tokens-body');
    document.getElementById('tokens-ts').textContent = nowStr();
    body.innerHTML = '';

    if (!Array.isArray(data) || data.length === 0) {
      body.appendChild(txt('div', 'No token data available.', { className: 'empty' }));
      return;
    }

    // Token status table
    const wrap = document.createElement('div');
    wrap.className = 'token-table-wrap';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    ['Provider', 'Status', 'Expires', 'Token', 'Refresh'].forEach(function(h) {
      hr.appendChild(txt('th', h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    data.forEach(function(row) {
      const tr = document.createElement('tr');

      // Provider
      tr.appendChild(txt('td', row.provider));

      // Status badge
      const statusTd = document.createElement('td');
      let statusBadge;
      if (!row.hasToken) {
        statusBadge = badge('None', 'badge-gray');
      } else if (row.isExpired) {
        statusBadge = badge('Expired', 'badge-red');
      } else {
        statusBadge = badge('Valid', 'badge-green');
      }
      statusTd.appendChild(statusBadge);
      tr.appendChild(statusTd);

      // Expiry
      tr.appendChild(txt('td', row.expiresAt ? fmtTime(row.expiresAt) : '—'));

      // Token preview
      tr.appendChild(txt('td', row.accessTokenPreview || '—'));

      // Has refresh
      const hasTd = document.createElement('td');
      hasTd.appendChild(badge(
        row.hasRefreshToken ? 'yes' : 'no',
        row.hasRefreshToken ? 'badge-green' : 'badge-gray'
      ));
      tr.appendChild(hasTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);

    // Action rows per provider
    const actionsSection = document.createElement('div');
    actionsSection.style.marginTop = '12px';

    data.forEach(function(row) {
      const provider = row.provider;

      const actionRow = document.createElement('div');
      actionRow.className = 'token-actions';

      const lbl = txt('div', provider + ' actions', { className: 'provider-actions-label' });
      actionRow.appendChild(lbl);

      // -- Device Flow button --
      const dfBtn = document.createElement('button');
      dfBtn.className = 'btn btn-yellow';
      dfBtn.textContent = 'Device Flow';

      const deviceResult = document.createElement('div');
      deviceResult.className = 'device-result';

      dfBtn.addEventListener('click', function() {
        dfBtn.disabled = true;
        dfBtn.textContent = '...';
        postData('/api/dashboard/tokens/' + encodeURIComponent(provider) + '/device-flow')
          .then(function(res) {
            deviceResult.className = 'device-result open';
            deviceResult.innerHTML = '';

            const codeDiv = document.createElement('div');
            codeDiv.className = 'device-code';
            codeDiv.textContent = res.userCode || res.user_code || '—';
            deviceResult.appendChild(codeDiv);

            const urlLabel = txt('div', 'Visit:', { className: 'device-url' });
            deviceResult.appendChild(urlLabel);

            const urlVal = res.verificationUri || res.verification_uri || res.verificationUrl || '';
            const urlLink = document.createElement('a');
            urlLink.href = urlVal;
            urlLink.textContent = urlVal;
            urlLink.target = '_blank';
            urlLink.rel = 'noopener noreferrer';
            const urlDiv = document.createElement('div');
            urlDiv.className = 'device-url';
            urlDiv.appendChild(urlLink);
            deviceResult.appendChild(urlDiv);
          })
          .catch(function(err) {
            deviceResult.className = 'device-result open';
            deviceResult.innerHTML = '';
            deviceResult.appendChild(txt('div', 'Error: ' + err.message, { className: 'msg msg-err show' }));
          })
          .finally(function() {
            dfBtn.disabled = false;
            dfBtn.textContent = 'Device Flow';
          });
      });

      // -- Refresh button --
      const rfBtn = document.createElement('button');
      rfBtn.className = 'btn btn-blue';
      rfBtn.textContent = 'Refresh';

      const rfMsg = document.createElement('div');
      rfMsg.className = 'msg';

      rfBtn.addEventListener('click', function() {
        rfBtn.disabled = true;
        rfBtn.textContent = '...';
        rfMsg.className = 'msg';
        postData('/api/dashboard/tokens/' + encodeURIComponent(provider) + '/refresh')
          .then(function() {
            rfMsg.className = 'msg msg-ok show';
            rfMsg.textContent = 'Token refreshed successfully.';
          })
          .catch(function(err) {
            rfMsg.className = 'msg msg-err show';
            rfMsg.textContent = 'Error: ' + err.message;
          })
          .finally(function() {
            rfBtn.disabled = false;
            rfBtn.textContent = 'Refresh';
          });
      });

      // -- Insert Token toggle button + form --
      const insBtn = document.createElement('button');
      insBtn.className = 'btn btn-green';
      insBtn.textContent = 'Insert Token';

      const insForm = document.createElement('div');
      insForm.className = 'insert-form';

      const atLabel = txt('label', 'Access Token');
      const atInput = document.createElement('input');
      atInput.type = 'text';
      atInput.placeholder = 'Paste access token here...';

      const row2 = document.createElement('div');
      row2.className = 'insert-form-row';

      const eiWrap = document.createElement('div');
      eiWrap.style.flex = '1';
      const eiLabel = txt('label', 'Expires In (seconds)');
      const eiInput = document.createElement('input');
      eiInput.type = 'number';
      eiInput.placeholder = '3600';
      eiWrap.appendChild(eiLabel);
      eiWrap.appendChild(eiInput);

      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn btn-green';
      submitBtn.textContent = 'Save';
      submitBtn.style.alignSelf = 'flex-end';

      row2.appendChild(eiWrap);
      row2.appendChild(submitBtn);

      const insMsg = document.createElement('div');
      insMsg.className = 'msg';

      insForm.appendChild(atLabel);
      insForm.appendChild(atInput);
      insForm.appendChild(row2);
      insForm.appendChild(insMsg);

      insBtn.addEventListener('click', function() {
        insForm.classList.toggle('open');
        insBtn.textContent = insForm.classList.contains('open') ? 'Cancel' : 'Insert Token';
      });

      submitBtn.addEventListener('click', function() {
        const accessToken = atInput.value.trim();
        if (!accessToken) {
          insMsg.className = 'msg msg-err show';
          insMsg.textContent = 'Access token is required.';
          return;
        }
        const expiresIn = eiInput.value ? parseInt(eiInput.value, 10) : 3600;
        submitBtn.disabled = true;
        submitBtn.textContent = '...';
        insMsg.className = 'msg';
        postData('/api/dashboard/tokens/' + encodeURIComponent(provider), { accessToken, expiresIn })
          .then(function() {
            insMsg.className = 'msg msg-ok show';
            insMsg.textContent = 'Token saved.';
            atInput.value = '';
            eiInput.value = '';
          })
          .catch(function(err) {
            insMsg.className = 'msg msg-err show';
            insMsg.textContent = 'Error: ' + err.message;
          })
          .finally(function() {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save';
          });
      });

      actionRow.appendChild(dfBtn);
      actionRow.appendChild(rfBtn);
      actionRow.appendChild(insBtn);
      actionRow.appendChild(deviceResult);
      actionRow.appendChild(rfMsg);
      actionRow.appendChild(insForm);

      actionsSection.appendChild(actionRow);
    });

    body.appendChild(actionsSection);
  }

  /* ── Panel 3: Token Usage ── */

  function updateUsage(data) {
    const body = document.getElementById('usage-body');
    document.getElementById('usage-ts').textContent = nowStr();
    body.innerHTML = '';

    // Summary cards
    const grid = document.createElement('div');
    grid.className = 'summary-grid';

    function summaryCard(label, value) {
      const card = document.createElement('div');
      card.className = 'summary-card';
      card.appendChild(txt('div', fmt(value), { className: 'val' }));
      card.appendChild(txt('div', label, { className: 'lbl' }));
      return card;
    }

    grid.appendChild(summaryCard('Total Requests',    data.totalRequests));
    grid.appendChild(summaryCard('Prompt Tokens',     data.totalPromptTokens));
    grid.appendChild(summaryCard('Completion Tokens', data.totalCompletionTokens));
    grid.appendChild(summaryCard('Total Tokens',      data.totalTokens));
    body.appendChild(grid);

    function usageTable(rows, colLabel) {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      [colLabel, 'Requests', 'Prompt', 'Completion', 'Total'].forEach(function(h) {
        hr.appendChild(txt('th', h));
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'No data';
        td.style.color = 'var(--muted)';
        td.style.textAlign = 'center';
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        rows.forEach(function(r) {
          const tr = document.createElement('tr');
          [r.name, fmt(r.requestCount), fmt(r.promptTokens), fmt(r.completionTokens), fmt(r.totalTokens)].forEach(function(v) {
            tr.appendChild(txt('td', v));
          });
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      return table;
    }

    // By Provider
    body.appendChild(txt('div', 'By Provider', { className: 'section-label' }));
    const providerRows = Object.entries(data.byProvider || {}).map(function(kv) {
      return Object.assign({ name: kv[0] }, kv[1]);
    });
    body.appendChild(usageTable(providerRows, 'Provider'));

    // By Model
    body.appendChild(txt('div', 'By Model', { className: 'section-label' }));
    const modelRows = Object.entries(data.byModel || {}).map(function(kv) {
      return Object.assign({ name: kv[0] }, kv[1]);
    });
    body.appendChild(usageTable(modelRows, 'Model'));
  }

  /* ── Panel 4: Model Routing ── */

  function updateModels(data) {
    const body = document.getElementById('models-body');
    document.getElementById('models-ts').textContent = nowStr();
    body.innerHTML = '';

    if (!Array.isArray(data) || data.length === 0) {
      body.appendChild(txt('div', 'No model aliases configured.', { className: 'empty' }));
      return;
    }

    data.forEach(function(alias) {
      const block = document.createElement('div');
      block.className = 'model-alias-block';

      block.appendChild(txt('div', alias.alias, { className: 'alias-heading' }));

      const providers = Array.isArray(alias.providers) ? alias.providers : [];
      if (providers.length === 0) {
        block.appendChild(txt('div', 'No providers.', { className: 'empty' }));
      } else {
        providers.forEach(function(p, idx) {
          const route = document.createElement('div');
          route.className = 'provider-route';

          const pBadge = document.createElement('div');
          const rank = idx + 1;
          pBadge.className = 'priority-badge' + (rank === 1 ? ' p1' : rank === 2 ? ' p2' : '');
          pBadge.textContent = String(p.priority !== undefined ? p.priority : rank);
          route.appendChild(pBadge);

          const info = document.createElement('div');
          info.appendChild(txt('div', p.provider || '—', { className: 'route-provider' }));
          info.appendChild(txt('div', p.model || '—',    { className: 'route-model' }));
          route.appendChild(info);

          block.appendChild(route);
        });
      }

      body.appendChild(block);
    });
  }

  /* ── Refresh orchestration ── */

  async function refreshAll() {
    const results = await Promise.allSettled([
      fetchData('/api/dashboard/status'),
      fetchData('/api/dashboard/tokens'),
      fetchData('/api/dashboard/usage'),
      fetchData('/api/dashboard/models'),
    ]);

    if (results[0].status === 'fulfilled') {
      try { updateStatus(results[0].value); } catch (e) { console.error('status render error', e); }
    } else {
      const b = document.getElementById('status-body');
      b.innerHTML = '';
      b.appendChild(txt('div', 'Error: ' + results[0].reason, { className: 'empty' }));
    }

    if (results[1].status === 'fulfilled') {
      try { updateTokens(results[1].value); } catch (e) { console.error('tokens render error', e); }
    } else {
      const b = document.getElementById('tokens-body');
      b.innerHTML = '';
      b.appendChild(txt('div', 'Error: ' + results[1].reason, { className: 'empty' }));
    }

    if (results[2].status === 'fulfilled') {
      try { updateUsage(results[2].value); } catch (e) { console.error('usage render error', e); }
    } else {
      const b = document.getElementById('usage-body');
      b.innerHTML = '';
      b.appendChild(txt('div', 'Error: ' + results[2].reason, { className: 'empty' }));
    }

    if (results[3].status === 'fulfilled') {
      try { updateModels(results[3].value); } catch (e) { console.error('models render error', e); }
    } else {
      const b = document.getElementById('models-body');
      b.innerHTML = '';
      b.appendChild(txt('div', 'Error: ' + results[3].reason, { className: 'empty' }));
    }
  }

  // Boot
  refreshAll();
  setInterval(refreshAll, 5000);
}());
</script>
</body>
</html>`;
}

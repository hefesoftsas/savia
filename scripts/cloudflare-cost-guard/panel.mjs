const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

const panelScript = String.raw`
(() => {
  const byId = (id) => document.getElementById(id);
  const login = byId('login-form');
  const keyInput = byId('admin-key');
  const loginError = byId('login-error');
  const loginButton = byId('login-button');
  const workspace = byId('workspace');
  const disconnect = byId('disconnect');
  const pauseButton = byId('pause-button');
  const dialog = byId('confirm-dialog');
  const cancelButton = byId('cancel-stop');
  const confirmButton = byId('confirm-stop');
  const message = byId('action-message');
  const key = { value: '' };
  let busy = false;
  let sessionGeneration = 0;

  const setText = (id, value) => { byId(id).textContent = value ?? '—'; };
  const dateText = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };
  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      credentials: 'omit',
      signal: AbortSignal.timeout(90000),
      headers: {
        Authorization: 'Bearer ' + key.value,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      const reason = body && typeof body.error === 'string' ? body.error : 'Request failed';
      throw new Error(response.status === 401 ? 'The administrator key was not accepted.' : reason);
    }
    return body;
  };
  const setBusy = (value) => {
    busy = value;
    pauseButton.disabled = value;
    confirmButton.disabled = value;
    loginButton.disabled = value;
    if (value) setText('action-message', 'Request in progress…');
  };
  const actionLabels = { 'worker-access': 'Public access', 'worker-settings': 'Application settings', queue: 'Queue', schedule: 'Scheduled task', workflow: 'Workflow', 'ai-binding': 'AI access', 'ai-search': 'AI Search', domain: 'Custom domain', route: 'Domain route' };
  const labelAction = (action) => actionLabels[action] || action;
  const renderResults = (status) => {
    const results = Array.isArray(status.targetResults) ? status.targetResults : [];
    const list = byId('target-results');
    list.replaceChildren();
    if (!results.length) {
      const item = document.createElement('li');
      item.className = 'empty-result';
      item.textContent = 'No per-target results are available yet.';
      list.append(item);
      return;
    }
    for (const result of results) {
      const item = document.createElement('li');
      item.className = 'result-row';
      const label = document.createElement('span');
      const outcome = document.createElement('span');
      const action = typeof result.action === 'string' ? result.action : 'Action';
      const target = typeof result.target === 'string' ? result.target : 'Unknown target';
      label.textContent = labelAction(action) + ' · ' + target;
      outcome.textContent = result.ok === true ? 'Applied' : 'Failed';
      outcome.className = result.ok === true ? 'result-ok' : 'result-failed';
      item.append(label, outcome);
      list.append(item);
    }
  };
  const renderStatus = (status) => {
    if (!status || typeof status.tripped !== 'boolean') {
      throw new Error('Guard returned an invalid status. Refresh status to check again.');
    }
    const errors = Array.isArray(status.actionErrors) ? status.actionErrors : [];
    const phase = typeof status.phase === 'string' ? status.phase : '';
    let stateLabel = 'ACTIVE';
    let stateClass = 'state-running';
    if (status.tripped) {
      if (phase === 'incomplete' || errors.length) {
        stateLabel = 'PAUSE INCOMPLETE';
        stateClass = 'state-incomplete';
      } else if (phase === 'stopping') {
        stateLabel = 'STOPPING';
        stateClass = 'state-stopping';
      } else if (phase === 'paused') {
        stateLabel = 'PAUSED';
        stateClass = 'state-paused';
      } else {
        stateLabel = 'STOP ACTIVE';
        stateClass = 'state-stopping';
      }
    }
    byId('status-indicator').className = 'state ' + stateClass;
    setText('status-indicator', stateLabel);
    const reason = status.reason === 'manual_stop' ? 'Manual pause' : status.reason === 'threshold' ? 'Spending limit reached' : status.reason?.replaceAll('_', ' ');
    setText('stop-reason', reason || (status.tripped ? 'Pause is active' : 'No stop condition recorded'));
    setText('manual-stop-at', dateText(status.manualStopAt));
    setText('checked-at', dateText(status.checkedAt));
    const errorSummary = byId('incomplete-summary');
    errorSummary.textContent = errors.length
      ? errors.length + ' incomplete action' + (errors.length === 1 ? '' : 's') + ' need attention.'
      : (status.tripped ? 'Pause is active. Review service outcomes below.' : 'No incomplete actions reported.');
    errorSummary.className = errors.length ? 'inline-alert alert-warning' : 'inline-alert';
    const errorList = byId('action-errors');
    errorList.replaceChildren();
    for (const error of errors) {
      const item = document.createElement('li');
      const action = typeof error.action === 'string' ? error.action : 'Action';
      const target = typeof error.target === 'string' ? error.target : '';
      const detail = typeof error.message === 'string' ? error.message : 'Action did not complete';
      item.textContent = [action, target, detail].filter(Boolean).join(' · ');
      errorList.append(item);
    }
    renderResults(status);
    byId('status-view').hidden = false;
  };
  const refresh = async (generation) => {
    const status = await request('/status');
    if (generation !== sessionGeneration) return false;
    renderStatus(status);
    return true;
  };

  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    key.value = keyInput.value;
    if (!key.value) {
      loginError.textContent = 'Enter the administrator key to continue.';
      return;
    }
    const generation = ++sessionGeneration;
    setBusy(true);
    loginError.textContent = '';
    try {
      if (!await refresh(generation)) return;
      workspace.hidden = false;
      login.hidden = true;
      keyInput.value = '';
      message.textContent = 'Status refreshed.';
    } catch (error) {
      if (generation !== sessionGeneration) return;
      key.value = '';
      loginError.textContent = error.message || 'Unable to load guard status.';
    } finally { if (generation === sessionGeneration) setBusy(false); }
  });
  byId('refresh-button').addEventListener('click', async () => {
    if (busy) return;
    const generation = sessionGeneration;
    setBusy(true);
    try { if (await refresh(generation)) message.textContent = 'Status refreshed.'; }
    catch (error) { if (generation === sessionGeneration) message.textContent = error.message || 'Unable to refresh status.'; }
    finally { if (generation === sessionGeneration) setBusy(false); }
  });
  pauseButton.addEventListener('click', () => { if (!busy) dialog.showModal(); });
  cancelButton.addEventListener('click', () => dialog.close());
  confirmButton.addEventListener('click', async () => {
    if (busy) return;
    const generation = sessionGeneration;
    setBusy(true);
    message.className = 'action-message';
    try {
      const result = await request('/stop', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'PAUSE_ALL_ENVIRONMENTS' }),
      });
      if (generation !== sessionGeneration) return;
      renderStatus(result);
      const errors = Array.isArray(result.actionErrors) ? result.actionErrors.length : 0;
      message.textContent = errors
        ? 'Pause saved. ' + errors + ' action' + (errors === 1 ? ' is' : 's are') + ' incomplete; review the details below.'
        : 'Pause saved. Pause actions were sent to all discovered targets.';
      message.className = errors ? 'action-message is-warning' : 'action-message is-success';
      dialog.close();
    } catch (error) {
      if (generation !== sessionGeneration) return;
      message.textContent = 'Unable to confirm pause completion. The pause may already be saved. Refresh status to check. ' + (error.message || 'Request unavailable');
      message.className = 'action-message is-error';
    } finally { if (generation === sessionGeneration) setBusy(false); }
  });
  disconnect.addEventListener('click', () => {
    sessionGeneration += 1;
    setBusy(false);
    dialog.close();
    key.value = '';
    keyInput.value = '';
    byId('status-view').hidden = true;
    setText('status-indicator', '—');
    setText('stop-reason', '—');
    setText('manual-stop-at', '—');
    setText('checked-at', '—');
    byId('incomplete-summary').textContent = '';
    byId('action-errors').replaceChildren();
    byId('target-results').replaceChildren();
    workspace.hidden = true;
    login.hidden = false;
    loginError.textContent = '';
    message.textContent = '';
    loginButton.focus();
  });
})();
`;

export function renderControlPanel({ nonce } = {}) {
  const safeNonce = escapeHtml(nonce);
  return `<!doctype html>
<!-- THESIS: An operator must be able to pause every environment from the guard itself, with partial completion visible. OWN-WORLD: Savia's cool white and gray operations surfaces, system sans, green for live state, red for the stop action. STORY: Authenticate with the existing key, inspect the server state, then explicitly confirm the account-wide pause. FIRST VIEWPORT: Status and the main stop action share the top operational region; target outcomes and failures follow immediately. FORM: A compact operations console built for quick scanning and safe execution. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Cloudflare account controls · Savia</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202925;background:#f3f6f4;font-synthesis:none;text-rendering:optimizeLegibility;line-height:1.45;font-weight:400;--ink:#202925;--muted:#59665f;--line:#dce4df;--surface:#fff;--soft:#f5f8f6;--green:#176647;--green-wash:#eaf4ee;--red:#a53839;--red-dark:#842d2e;--amber:#7a5312;--amber-wash:#fff6e2}
    *{box-sizing:border-box}[hidden]{display:none!important}html,body{min-width:320px;min-height:100%;margin:0}body{min-height:100vh;min-height:100dvh}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.6}button:focus-visible,input:focus-visible{outline:3px solid #4d9874;outline-offset:3px}.shell{max-width:1120px;margin:0 auto;padding:24px 28px 56px}.topbar{display:flex;align-items:center;justify-content:space-between;padding-bottom:22px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:11px;font-size:14px;font-weight:650;letter-spacing:-.01em}.mark{display:grid;width:34px;height:34px;place-items:center;border-radius:9px;background:var(--green);color:#fff;font-size:18px;font-weight:700}.environment{font-size:12px;color:var(--muted);padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:#fff}.intro{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:38px 0 26px}.intro h1{margin:0;font-size:30px;line-height:1.15;letter-spacing:-.025em}.intro p{max-width:62ch;margin:9px 0 0;color:var(--muted);font-size:14px}.intro-meta{color:var(--muted);font-size:12px;white-space:nowrap}.login{max-width:480px;padding:24px;background:var(--surface);border:1px solid var(--line);border-radius:12px}.login h2{margin:0 0 6px;font-size:17px}.login p{margin:0 0 18px;color:var(--muted);font-size:13px}.field-label{display:block;margin-bottom:6px;font-size:13px;font-weight:600}.field-row{display:flex;gap:9px}.key-input{min-width:0;flex:1;height:42px;padding:0 12px;border:1px solid #b9c6be;border-radius:7px;background:#fff;color:var(--ink)}.button{min-height:40px;padding:9px 15px;border:1px solid transparent;border-radius:7px;font-size:13px;font-weight:650;transition:background-color .16s ease,border-color .16s ease}.button-primary{background:var(--green);color:#fff}.button-primary:hover{background:#105438}.button-secondary{background:#fff;color:var(--ink);border-color:var(--line)}.button-secondary:hover{background:var(--soft)}.button-danger{background:var(--red);color:white}.button-danger:hover{background:var(--red-dark)}.text-button{border:0;background:transparent;color:var(--muted);font-size:12px;text-decoration:underline;text-underline-offset:3px}.text-button:hover{color:var(--ink)}.error-text{min-height:20px;margin-top:9px;color:#8a2829;font-size:13px}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:16px}.main-column,.side-column{min-width:0}.section{padding:20px 22px;margin-bottom:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.section-heading h2{margin:0;font-size:16px;letter-spacing:-.01em}.status-row{display:flex;align-items:center;gap:11px}.state{display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:750;letter-spacing:.04em}.state:before{width:7px;height:7px;border-radius:50%;background:currentColor;content:""}.state-running{background:var(--green-wash);color:#155b3d}.state-paused{background:#faeaea;color:#8d3031}.state-incomplete{background:var(--amber-wash);color:#654710}.state-stopping{background:#faeaea;color:#8d3031}.status-detail{margin-top:12px;color:var(--muted);font-size:13px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:16px;padding-top:14px;border-top:1px solid #e9eeeb}.detail-label{display:block;margin-bottom:3px;color:var(--muted);font-size:11px}.detail-value{font-size:13px;font-weight:600;overflow-wrap:anywhere}.stop-section{background:#fffafa;border-color:#ead3d3}.stop-section p{max-width:66ch;margin:0 0 17px;color:#5e4e4e;font-size:13px}.warning{padding:11px 13px;border:1px solid #edcfce;border-radius:8px;background:#fff3f2;color:#713536;font-size:12px;line-height:1.5}.warning strong{font-weight:700}.protected-list{margin:0;padding:0;list-style:none}.protected-list li{display:flex;align-items:center;gap:9px;padding:10px 0;border-bottom:1px solid #edf1ee;font-size:13px}.protected-list li:last-child{border:0;padding-bottom:0}.protected-list li:before{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#688175;content:""}.small-note{margin:14px 0 0;color:var(--muted);font-size:12px}.result-list,.error-list{margin:0;padding:0;list-style:none}.result-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid #edf1ee;font-size:12px}.result-row:last-child{border:0}.result-row>span:first-child{overflow-wrap:anywhere}.result-ok{flex:0 0 auto;color:var(--green);font-weight:650}.result-failed{flex:0 0 auto;color:#9a3132;font-weight:650}.empty-result{color:var(--muted);font-size:12px}.inline-alert{margin:0 0 13px;color:var(--muted);font-size:12px}.alert-warning{color:#7a5312}.error-list{margin-top:8px}.error-list li{padding:8px 10px;margin-top:6px;border-radius:6px;background:var(--amber-wash);color:#654710;font-size:12px;overflow-wrap:anywhere}.action-message{min-height:20px;margin-top:12px;font-size:13px}.is-success{color:var(--green)}.is-warning{color:var(--amber)}.is-error{color:#8a2829}.side-column .section{padding:18px}.side-column .section-heading{margin-bottom:12px}.dialog{width:min(480px,calc(100vw - 32px));padding:25px;border:1px solid #d8dfda;border-radius:12px;background:#fff;color:var(--ink);box-shadow:0 18px 56px rgb(22 39 29 / 22%)}.dialog::backdrop{background:rgb(20 31 25 / 52%)}.dialog h2{margin:0 0 8px;font-size:19px}.dialog p{margin:0 0 18px;color:var(--muted);font-size:13px}.dialog-actions{display:flex;justify-content:flex-end;gap:9px}.footer{margin-top:12px;color:var(--muted);font-size:12px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:760px){.shell{padding:16px 16px 38px}.intro{align-items:flex-start;flex-direction:column;gap:8px;margin:28px 0 20px}.intro h1{font-size:26px}.intro-meta{white-space:normal}.workspace{grid-template-columns:1fr}.side-column{display:grid;grid-template-columns:1fr 1fr;gap:12px}.side-column .section{margin:0}.field-row{align-items:stretch;flex-direction:column}.field-row .button{width:100%}}
    @media(max-width:480px){.topbar{padding-bottom:16px}.environment{font-size:11px}.section{padding:17px 16px}.side-column{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}.section-heading{align-items:flex-start}.dialog-actions{flex-direction:column-reverse}.dialog-actions .button{width:100%}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar"><div class="brand"><span class="mark" aria-hidden="true">S</span><span>Savia operations</span></div><span class="environment">CLOUDFLARE ACCOUNT · CONTROL</span></header>
    <section class="intro" aria-labelledby="page-title"><div><h1 id="page-title">Account controls</h1><p>Inspect the cost guard and pause every discovered environment from this independent control surface.</p></div><div class="intro-meta">Applications can stop; this guard remains reachable.</div></section>
    <form id="login-form" class="login" autocomplete="off">
      <h2>Administrator access</h2><p>Use the existing guard administrator key. It stays in this page's memory and is cleared when you disconnect or leave.</p>
      <label class="field-label" for="admin-key">Administrator key</label><div class="field-row"><input id="admin-key" class="key-input" type="password" autocomplete="off" spellcheck="false" required><button id="login-button" class="button button-primary" type="submit">Connect</button></div><div id="login-error" class="error-text" role="alert" aria-live="polite"></div>
    </form>
    <section id="workspace" class="workspace" hidden aria-label="Account guard controls">
      <div class="main-column">
        <section class="section" id="status-view" hidden aria-labelledby="status-heading">
          <div class="section-heading"><h2 id="status-heading">Guard status</h2><div class="status-row"><span id="status-indicator" class="state">—</span><button id="refresh-button" class="button button-secondary" type="button">Refresh status</button></div></div>
          <div class="status-detail">Reason: <strong id="stop-reason">—</strong></div>
          <div class="detail-grid"><div><span class="detail-label">Manual stop recorded</span><span class="detail-value" id="manual-stop-at">—</span></div><div><span class="detail-label">Last checked</span><span class="detail-value" id="checked-at">—</span></div></div>
          <div id="incomplete-summary" class="inline-alert" role="status" aria-live="polite"></div><ul id="action-errors" class="error-list" aria-label="Incomplete actions"></ul>
        </section>
        <section class="section stop-section" aria-labelledby="pause-heading"><div class="section-heading"><h2 id="pause-heading">Emergency stop</h2></div><p>Pause public access, queues and scheduled jobs across every environment. Repeat this action to reapply the pause.</p><div class="warning"><strong>Requests already in flight may finish.</strong> This action does not cap billing, delete resources, or restore applications.</div><p style="margin:16px 0 0"><button id="pause-button" class="button button-danger" type="button">Pause all environments</button></p><div id="action-message" class="action-message" role="status" aria-live="polite"></div></section>
        <section class="section" aria-labelledby="results-heading"><div class="section-heading"><h2 id="results-heading">Target action outcomes</h2></div><ul id="target-results" class="result-list"><li class="empty-result">Connect to load the latest status.</li></ul></section>
      </div>
      <aside class="side-column" aria-label="Protected services and session"><section class="section"><div class="section-heading"><h2>Protected services</h2></div><ul class="protected-list"><li>Cost guard enforcement</li><li>Backup coordinators</li><li>Daily cleanup</li></ul><p class="small-note">These maintenance services remain available to support recovery and cleanup.</p></section><section class="section"><div class="section-heading"><h2>Session</h2></div><p class="small-note" style="margin-top:0">Disconnect clears the administrator key and the displayed account status from this page.</p><button id="disconnect" class="button button-secondary" type="button">Disconnect</button><div class="footer">No resume control is available here.</div></section></aside>
    </section>
    <dialog id="confirm-dialog" class="dialog" aria-labelledby="confirm-title" aria-describedby="confirm-description"><h2 id="confirm-title">Pause all environments?</h2><p id="confirm-description">This saves the pause and applies it to every environment the controller discovers. Applications will remain paused until an operator recovers them. In-flight requests may still finish.</p><div class="dialog-actions"><button id="cancel-stop" class="button button-secondary" type="button">Cancel</button><button id="confirm-stop" class="button button-danger" type="button">Confirm pause</button></div></dialog>
  </main>
  <script nonce="${safeNonce}">${panelScript}</script>
</body>
</html>`;
}

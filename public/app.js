const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const paths = {
  moon:'M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z', sun:'M12 3V1 M12 23v-2 M3 12H1 M23 12h-2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0', lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
  mail:'M4 5h16v14H4z M4 6l8 7 8-7', dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  send:'m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13', users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  template:'M4 3h16v18H4z M4 9h16 M10 9v12', activity:'M3 12h4l3-8 4 16 3-8h4', settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3',
  plus:'M12 5v14 M5 12h14', arrow:'M5 12h14 M13 6l6 6-6 6', chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6', search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  upload:'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6', check:'m5 12 4 4L19 6', clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', close:'m6 6 12 12 M6 18 18 6',
  help:'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5', file:'M14 2H5v20h14V7l-5-5Z M14 2v6h5 M8 13h8 M8 17h6',
  spark:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z', trend:'m3 17 6-6 4 4 8-10 M15 5h6v6', menu:'M4 6h16 M4 12h16 M4 18h16', trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', stop:'M5 5h14v14H5z', logout:'M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.mail}"/></svg>`;
const fmt = n => new Intl.NumberFormat().format(n);
const date = value => new Date(value).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
const activeCampaign = c => ['queued','checking','sending'].includes(c.status);
const resumable = r => ['pending','retrying'].includes(r.status) || r.status === 'failed' && r.delivery?.safeToRetry;
const statuses = { queued:'Queued', checking:'Checking connection', paused:'Paused', retrying:'Retry scheduled', draft:'Draft', sending:'Sending', sent:'Sent', completed_with_errors:'Needs attention', cancelled:'Stopped', interrupted:'Interrupted', failed:'Failed', pending:'Pending', unknown:'Unconfirmed' };
const badge = status => `<span class="badge ${status}"><i></i>${statuses[status] || esc(status)}</span>`;
let data = { contacts:[], campaigns:[], templates:[], transport:{ ready:false, name:'None' } };
let view = 'dashboard', query = '', filter = 'all', period = 30, compose = null, selected = new Set(), busy = false, lastFocus;
let authenticated = false, authUser = '';
function themeButton() { const dark = document.documentElement.dataset.theme === 'dark'; return `<button class="icon-btn theme-toggle" data-action="theme" aria-label="Switch to ${dark ? 'light' : 'dark'} mode" title="Switch to ${dark ? 'light' : 'dark'} mode">${icon(dark ? 'sun' : 'moon')}</button>`; }
function toggleTheme() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme;
  try { localStorage.setItem('mailroom-theme', theme); } catch { /* Storage may be disabled. */ }
  document.querySelectorAll('[data-action="theme"]').forEach(button => { button.outerHTML = themeButton(); });
}
function showLogin() {
  authenticated = false; authUser = ''; busy = false; compose = null; selected.clear();
  data = { contacts:[], campaigns:[], templates:[], transport:{ ready:false, name:'None' } };
  $('#modal-root').innerHTML = ''; $('#toast').className = '';
  $('#app').innerHTML = `<div class="login-page"><header class="login-header"><a href="/" class="brand"><span class="brandmark">${icon('mail')}</span>mailroom<span class="brand-dot">.</span></a>${themeButton()}</header><div class="login-layout"><section class="login-story"><div class="eyebrow">A LITTLE LESS ADMIN. A LOT MORE CONNECTION.</div><h1>Good things start <br>with a <em>hello.</em></h1><p>Your people. Your ideas. Your next great campaign.<br>All together in one thoughtful workspace.</p><div class="login-art" aria-hidden="true"><div class="login-letter">${icon('mail')}<strong>A personal touch,<br>at scale.</strong><i></i><i></i><span>Made for meaningful connections.</span></div><span class="login-spark">✦</span><div class="login-art-badge">${icon('check')} A home for every great idea</div></div></section><section class="login-card"><span class="login-lock">${icon('lock')}</span><h2>Welcome back.</h2><p>Your mailroom is ready when you are.</p><form id="login-form"><label class="field">Username<input name="username" autocomplete="username" required maxlength="100" placeholder="Enter your username" autocapitalize="none" spellcheck="false"></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required maxlength="1024" placeholder="Enter your password"></label><p id="login-error" class="login-error" role="alert"></p><button type="submit" class="btn primary login-submit">Sign in ${icon('arrow')}</button></form><div class="login-private">${icon('lock')} A private space for your connections.</div></section></div><footer class="login-footer">Thoughtful messages. Meaningful connections.</footer></div>`;
}
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, headers:{ 'Content-Type':'application/json' }, ...(body ? { body:JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401 && path !== 'auth/login') showLogin(); const error = new Error(result.error || 'Something went wrong. Please try again.'); error.status = response.status; throw error; }
  return result;
}
async function refresh() { data = await api('workspace'); render(); }
let toastTimer;
function toast(message, error = false) { const el = $('#toast'); el.innerHTML = `${icon(error ? 'help' : 'check')}<span>${esc(message)}</span>`; el.className = `visible ${error ? 'error' : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 5500); if (error && $('dialog')) { let alert = $('.dialog-alert'); if (!alert) { alert = document.createElement('div'); alert.className = 'dialog-alert'; alert.setAttribute('role','alert'); $('.modal-heading').after(alert); } alert.textContent = message; alert.scrollIntoView({block:'nearest'}); } }
function nav(target) { view = target; query = ''; filter = 'all'; selected.clear(); render(); window.scrollTo(0,0); }
const navItems = [['dashboard','dashboard','Overview'],['campaigns','send','Campaigns'],['audience','users','Audience'],['templates','template','Templates'],['activity','activity','Activity']];
function render() {
  if (!authenticated) { showLogin(); return; }
  const title = navItems.find(n => n[0] === view)?.[2] || 'Settings';
  $('#app').innerHTML = `<aside class="sidebar"><a class="brand" href="#" data-action="nav" data-view="dashboard"><span class="brandmark">${icon('mail')}</span>mailroom<span class="brand-dot">.</span></a>
  <div class="workspace"><span class="workspace-avatar">M</span><div><strong>My workspace</strong><small>Personal workspace</small></div><span class="workspace-dot"></span></div>
  <div class="nav-label">WORKSPACE</div><nav aria-label="Main navigation">${navItems.map(([key, glyph, label]) => `<button data-action="nav" data-view="${key}" class="nav-item ${view === key ? 'active' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${key === 'campaigns' && data.campaigns.length ? `<span class="nav-count">${data.campaigns.length}</span>` : ''}</button>`).join('')}</nav>
  <div class="sidebar-bottom"><div class="little-note"><span class="note-icon">${icon('spark')}</span><strong>A little personal goes a long way.</strong><p>Add {{name}} to make every email feel like a conversation.</p><button data-action="new" class="text-btn">Let’s write one ${icon('arrow')}</button></div><button data-action="nav" data-view="settings" class="nav-item ${view === 'settings' ? 'active' : ''}">${icon('settings')}<span>Settings</span></button><button data-action="help" class="nav-item">${icon('help')}<span>Help & getting started</span></button><div class="sidebar-profile"><span class="avatar">AD</span><div><strong>${esc(authUser)}</strong><small><i class="online-dot"></i> Local workspace</small></div></div></div></aside>
  <div class="main-shell"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="menu" aria-label="Toggle navigation">${icon('menu')}</button><span>Workspace</span>${icon('chevron')}<strong>${title}</strong></div><div class="topbar-right">${themeButton()}<label class="global-search">${icon('search')}<input id="global-search" aria-label="Search campaigns" placeholder="Search campaigns…" value="${view === 'campaigns' ? esc(query) : ''}"><kbd>/</kbd></label><span class="topbar-divider"></span><button class="icon-btn" data-action="help" aria-label="Help">${icon('help')}</button><button class="icon-btn" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button><span class="avatar small" title="${esc(authUser)}">AD</span></div></header>
  <main>${({ dashboard:dashboard, campaigns:campaignsPage, audience:audiencePage, templates:templatesPage, activity:activityPage, settings:settingsPage })[view]()}</main><footer class="page-footer"><span>Made for meaningful connections.</span><span><i class="online-dot"></i> Your workspace, all in one place</span></footer></div>`;
}
function heading(title, subtitle, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">YOUR EMAIL WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }
function newButton(label = 'Create campaign') { return `<button class="btn primary" data-action="new">${icon('plus')}${label}</button>`; }
function summary() {
  const cutoff = Date.now() - period * 86400000;
  const results = data.campaigns.flatMap(c => c.results).filter(r => r.at && new Date(r.at).getTime() >= cutoff);
  const sent = results.filter(r => r.status === 'sent').length, failed = results.filter(r => r.status === 'failed').length;
  return { sent, failed, rate: sent + failed ? (sent / (sent + failed) * 100).toFixed(1) + '%' : '—', results };
}
function dashboard() {
  const stats = summary();
  const steps = [data.transport.ready, data.contacts.length > 0, data.campaigns.some(c => c.status !== 'draft')];
  return `${heading('Good things start with an email<span class="heading-dot">.</span>', 'A little less admin. A lot more connection.', `<button class="btn" data-action="import">${icon('upload')}Import contacts</button>${newButton()}`)}
  <section class="hero"><div class="hero-copy"><span class="hero-tag"><span></span> BIG IDEAS. PERSONAL EMAILS.</span><h2>One thoughtful message.<br>A hundred new possibilities.</h2><p>Reach your whole audience, without losing the personal touch.<br>Write it once. Make it matter to everyone.</p><button class="btn dark" data-action="new">Create your next campaign ${icon('arrow')}</button></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="art-spark spark-one">✦</span><span class="art-spark spark-two">✧</span><div class="floating-pill pill-top"><span class="mini-check">${icon('check')}</span>A personal touch, at scale</div><div class="letter"><span class="letter-logo">${icon('mail')}</span><span class="letter-title">Hello, {{name}} <span>♡</span></span><i></i><i></i><i></i></div><div class="envelope"><div class="envelope-flap"></div><span class="envelope-seal">${icon('spark')}</span></div><div class="floating-pill pill-bottom">${icon('send')}Ready for great conversations</div></div></section>
  <div class="section-title metrics-title"><h2>Your workspace at a glance</h2><label class="period-select">${icon('clock')}<select id="period" aria-label="Statistics period"><option value="30" ${period === 30 ? 'selected' : ''}>Last 30 days</option><option value="7" ${period === 7 ? 'selected' : ''}>Last 7 days</option><option value="90" ${period === 90 ? 'selected' : ''}>Last 90 days</option></select></label></div>
  <section class="stats-grid">${[['Emails sent',fmt(stats.sent),'send','purple','Accepted by your email provider'],['Total contacts',fmt(data.contacts.length),'users','peach','People in your audience'],['Send success',stats.rate,'check','green','Successful provider requests'],['Draft campaigns',fmt(data.campaigns.filter(c => c.status === 'draft').length),'file','blue','Good ideas, ready when you are']].map(([label,value,glyph,color,note]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon(glyph)}</span></div><strong class="stat-number">${value}</strong><small>${note}</small></article>`).join('')}</section>
  <div class="dashboard-middle"><section class="panel performance"><div class="panel-heading"><div><h2>Sending activity</h2><p>Every message is a new connection.</p></div><span class="chart-key"><i></i> Emails sent</span></div>${chart(stats.results)}</section>
  <section class="panel getting-started"><div class="panel-heading"><div><h2>Make yourself at home</h2><p>Three small steps. One big beginning.</p></div><span class="step-count">${steps.filter(Boolean).length}/3</span></div><div class="setup-progress"><span style="width:${steps.filter(Boolean).length / 3 * 100}%"></span></div>${[['Connect your email','Give your messages a home.','settings'],['Bring your people','Import or add your contacts.','audience'],['Send something great','Your first campaign starts here.','new']].map(([label,desc,action],i) => `<button class="setup-item" data-action="${action === 'new' ? 'new' : 'nav'}" data-view="${action}"><span class="step-circle ${steps[i] ? 'done' : ''}">${steps[i] ? icon('check') : i+1}</span><span><strong>${label}</strong><small>${desc}</small></span>${icon('chevron')}</button>`).join('')}</section></div>
  <section class="panel recent"><div class="panel-heading"><div><h2>Recent campaigns</h2><p>Your latest ideas, out in the world.</p></div><button class="text-btn" data-action="nav" data-view="campaigns">View all campaigns ${icon('arrow')}</button></div>${campaignTable(data.campaigns.slice(0,4), true)}</section>
  <div class="section-title template-heading"><div><h2>A head start for your next hello</h2><p>Start with a template. Make it your own.</p></div><button class="text-btn" data-action="nav" data-view="templates">Explore templates ${icon('arrow')}</button></div><section class="template-grid compact">${data.templates.map(templateCard).join('')}</section>`;
}
function chart(results) {
  const days = Array.from({ length:7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (period-1) + Math.floor(i*period/7)); d.setHours(0,0,0,0); return d; });
  const counts = days.map((d,i) => results.filter(r => r.status === 'sent' && new Date(r.at) >= d && (i === 6 || new Date(r.at) < days[i+1])).length);
  const max = Math.max(4,...counts), points = counts.map((n,i) => `${45+i*85},${150-n/max*118}`).join(' ');
  return `<div class="chart-wrap"><svg viewBox="0 0 590 190" role="img" aria-label="${results.length ? 'Emails sent over the selected period' : 'No emails sent in this period'}"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b59be8" stop-opacity=".25"/><stop offset="1" stop-color="#b59be8" stop-opacity="0"/></linearGradient></defs>${[0,1,2,3,4].map((n) => `<line x1="45" y1="${150-n*29.5}" x2="565" y2="${150-n*29.5}" stroke="#eeedf3" stroke-dasharray="4 5"/><text x="10" y="${154-n*29.5}" fill="#9a96a8" font-size="10">${Math.round(max*n/4)}</text>`).join('')}<polygon points="45,150 ${points} 555,150" fill="url(#chart-fill)"/><polyline points="${points}" fill="none" stroke="#9774da" stroke-width="2.5" stroke-linejoin="round"/>${days.map((d,i) => `<text x="${45+i*85}" y="179" fill="#9a96a8" font-size="10" text-anchor="middle">${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</text>`).join('')}</svg>${!results.length ? '<div class="chart-empty"><span>Room for your next big idea</span><small>Your sending activity will appear here.</small></div>' : ''}</div>`;
}
function campaignTable(list, compact = false) {
  return `<div class="table-scroll"><table><thead><tr><th>Campaign name</th><th>Status</th><th>Audience</th><th>Sent</th><th>Created</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.length ? list.map(c => `<tr><td><button class="campaign-link" data-action="open-campaign" data-id="${c.id}"><span class="table-mail ${c.status === 'draft' ? 'muted' : ''}">${icon(c.status === 'draft' ? 'file' : 'send')}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.subject)}</small></span></button></td><td>${badge(c.status)}</td><td>${fmt(c.contactIds.length)} contacts</td><td>${fmt(c.results.filter(r => r.status === 'sent').length)}</td><td class="date-cell">${date(c.createdAt)}</td><td><button class="icon-btn" data-action="open-campaign" data-id="${c.id}" aria-label="Open ${esc(c.name)}">${icon('chevron')}</button></td></tr>`).join('') : `<tr><td colspan="6"><div class="empty-state ${compact ? 'compact-empty' : ''}"><span class="empty-icon">${icon('send')}</span><div><h3>${query || filter !== 'all' ? 'No matching campaigns' : 'Your next great campaign starts here'}</h3><p>${query || filter !== 'all' ? 'Try another search or filter.' : 'Write a little something. Reach a lot of people.'}</p></div>${!query && filter === 'all' ? '<button class="btn small-btn" data-action="new">Create campaign '+icon('arrow')+'</button>' : ''}</div></td></tr>`}</tbody></table></div>`;
}
function campaignsPage() {
  const list = data.campaigns.filter(c => (filter === 'all' || (filter === 'sending' ? activeCampaign(c) : c.status === filter)) && `${c.name} ${c.subject}`.toLowerCase().includes(query.toLowerCase()));
  return `${heading('Your words, going places.', 'Create, manage, and keep an eye on every campaign.',newButton())}<section class="panel"><div class="list-toolbar"><div class="tabs" role="group" aria-label="Filter campaigns">${[['all','All campaigns'],['draft','Drafts'],['sending','Sending'],['paused','Paused'],['sent','Sent']].map(([id,label]) => `<button class="tab ${filter === id ? 'active' : ''}" data-action="filter" data-filter="${id}">${label}<span>${data.campaigns.filter(c => id === 'all' || (id === 'sending' ? activeCampaign(c) : c.status === id)).length}</span></button>`).join('')}</div><label class="search-field">${icon('search')}<input id="list-search" value="${esc(query)}" placeholder="Find a campaign…" aria-label="Find a campaign"></label></div>${campaignTable(list)}<div class="table-footer">${fmt(list.length)} campaign${list.length === 1 ? '' : 's'}<span>Thoughtful messages. Meaningful connections.</span></div></section>`;
}
function audiencePage() {
  const list = data.contacts.filter(c => `${c.name} ${c.email} ${c.domain}`.toLowerCase().includes(query.toLowerCase()));
  return `${heading('Good people. One place.', 'Build your audience and make every connection count.',`<button class="btn" data-action="add-contact">${icon('plus')}Add contact</button><button class="btn primary" data-action="import">${icon('upload')}Import contacts</button>`)}<div class="audience-banner"><span class="stat-icon purple">${icon('users')}</span><div><strong>${fmt(data.contacts.length)} people in your corner</strong><p>Import a spreadsheet or add a contact to get the conversation started.</p></div><button class="text-btn" data-action="sample">Download sample CSV ${icon('download')}</button></div><section class="panel"><div class="list-toolbar"><h2>All contacts <span class="count-label">${data.contacts.length}</span></h2><div class="toolbar-right">${selected.size ? `<button class="btn small-btn" data-action="suppress-contacts">Unsubscribe ${selected.size}</button><button class="btn danger small-btn" data-action="remove-contacts">${icon('trash')}Remove ${selected.size}</button>` : ''}<label class="search-field">${icon('search')}<input id="list-search" placeholder="Search your audience…" aria-label="Search contacts" value="${esc(query)}"></label></div></div><div class="table-scroll"><table><thead><tr><th class="checkbox-cell"><input type="checkbox" id="select-all-contacts" aria-label="Select all visible contacts" ${list.length && list.every(c => selected.has(c.id)) ? 'checked' : ''}></th><th>Name</th><th>Email address</th><th>Domain</th><th>Added</th></tr></thead><tbody>${list.length ? list.map(c => `<tr><td class="checkbox-cell"><input type="checkbox" data-contact="${c.id}" aria-label="Select ${esc(c.name)}" ${selected.has(c.id) ? 'checked' : ''}></td><td><div class="contact-name"><span class="contact-avatar">${esc(c.name.split(' ').map(x => x[0]).slice(0,2).join(''))}</span><strong>${esc(c.name)}</strong></div></td><td>${esc(c.email)}${isSuppressed(c)?'<small class="cell-subtitle">Unsubscribed · excluded from sends</small>':''}</td><td>${esc(c.domain || '—')}</td><td class="date-cell">${date(c.createdAt)}</td></tr>`).join('') : `<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">${icon('users')}</span><h3>${query ? 'No contacts found' : 'Every audience starts with a hello'}</h3><p>${query ? 'Try a different name or email address.' : 'Bring your contacts in with a CSV or Excel file. We’ll handle duplicates.'}</p><button class="btn primary" data-action="import">${icon('upload')}Import your contacts</button></div></td></tr>`}</tbody></table></div><div class="table-footer">${list.length} contact${list.length === 1 ? '' : 's'}<span>One email per person. Always personal.</span></div></section>`;
}
function templateCard(t) { return `<button class="template-card ${t.color}" data-action="use-template" data-id="${t.id}"><div class="template-visual"><div class="mini-email"><div class="mini-email-mark">${icon(t.id === 'shortlisted' ? 'spark' : t.id === 'welcome' ? 'mail' : 'send')}</div><strong>${t.id === 'welcome' ? 'Hello, you.' : t.id === 'shortlisted' ? 'You’re in!' : 'A little good news.'}</strong><i></i><i></i><span></span></div><span class="template-float">${t.id === 'welcome' ? '✦' : t.id === 'shortlisted' ? '✧' : '♡'}</span></div><div class="template-info"><div><small>${t.category}</small><h3>${t.name}</h3></div><span class="template-arrow">${icon('arrow')}</span></div></button>`; }
function templatesPage() { return `${heading('A beautiful place to start.', 'Pick a starting point. Add your voice. Make someone’s day.',`<button class="btn" data-action="new">${icon('plus')}Start from scratch</button>`)}<div class="template-intro">${icon('spark')} Ready-to-personalize messages for the moments that matter.</div><section class="template-grid large">${data.templates.map(templateCard).join('')}</section><div class="tip-panel">${icon('help')}<div><strong>Make every message feel one-to-one.</strong><p>Use <code>{{name}}</code>, <code>{{email}}</code>, <code>{{domain}}</code>, or <code>{{designation}}</code> in your subject and message. We’ll fill in the details for each recipient.</p></div></div>`; }
function activityPage() {
  const results = data.campaigns.flatMap(c => c.results.map(r => ({...r,campaign:c.name}))).sort((a,b) => (b.at || '').localeCompare(a.at || ''));
  return `${heading('Every send, a little clearer.', 'A transparent record of your campaign sending activity.',`<button class="btn" data-action="export" ${results.length ? '' : 'disabled'}>${icon('download')}Export activity</button>`)}<div class="info-note">${icon('help')} “Sent” means your email provider accepted the message. Inbox delivery and opens are not tracked.</div><section class="panel"><div class="panel-heading"><h2>Sending log</h2><span class="count-label">${results.length} messages</span></div><div class="table-scroll"><table><thead><tr><th>Recipient</th><th>Campaign</th><th>Status</th><th>Time</th></tr></thead><tbody>${results.length ? results.map(r => `<tr><td><strong>${esc(r.name)}</strong><small class="cell-subtitle">${esc(r.email)}</small></td><td>${esc(r.campaign)}</td><td>${badge(r.status)}${r.error ? `<small class="error-detail">${esc(r.error)}</small>` : ''}</td><td>${r.at ? new Date(r.at).toLocaleString() : '—'}</td></tr>`).join('') : '<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">'+icon('activity')+'</span><h3>A fresh page for your connections</h3><p>Send a campaign to see individual message results here.</p></div></td></tr>'}</tbody></table></div></section>`;
}
function settingsPage() { return `${heading('A space that works for you.', 'Connect your sender and get ready to make an impression.')}<section class="panel settings-panel"><div class="panel-heading"><div><h2>Email connection</h2><p>Your campaigns, sent from your own address.</p></div><span class="badge ${data.transport.ready ? 'sent' : 'draft'}"><i></i>${data.transport.health?.status === 'verified' ? 'Connection verified' : data.transport.ready ? 'Configured' : 'Not connected'}</span></div><div class="settings-content"><div class="provider-status"><span class="stat-icon purple">${icon('mail')}</span><div><strong>${data.transport.ready ? esc(data.transport.name) : 'Let’s connect your email'}</strong><p>${data.transport.ready ? esc(data.transport.from) : 'Choose Resend or SMTP to start sending campaigns.'}</p></div></div><p class="settings-instruction">Copy <code>.env.example</code> to <code>.env</code> in the project folder, enter your provider details, then restart the dashboard. Your credentials stay on the server.</p><div class="provider-grid"><article><span class="provider-label">OPTION 01</span><h3>Resend <span class="recommended">Recommended</span></h3><p>Use a verified sending domain and your API key.</p><pre>RESEND_API_KEY=your_api_key
RESEND_FROM_EMAIL=Team &lt;hello@yourdomain.com&gt;</pre><a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" class="text-btn">Open Resend ${icon('arrow')}</a></article><article><span class="provider-label">OPTION 02</span><h3>SMTP</h3><p>Connect Gmail or another SMTP email provider.</p><pre>SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password</pre><small>For Gmail, use an app password. Resend takes priority when both are configured.</small></article></div><button class="btn" data-action="verify-transport">${icon('activity')}Test connection</button><p class="muted-text">Checks DNS, encryption, and authentication from this server. No email is sent.</p>${data.transport.health?.checkedAt ? `<div class="${data.transport.health.status === 'failed' ? 'warning-note' : 'info-note'}">${esc(data.transport.health.message)}${data.transport.health.code ? ' · ' + esc(data.transport.health.code) : ''}</div>` : ''}${data.sending?.dailyLimit ? `<p class="muted-text">Mailroom daily cap: ${data.sending.used} / ${data.sending.dailyLimit} messages in the last 24 hours. Messages sent outside this app also count toward Gmail’s limit.</p>` : ''}</div></section><div class="tip-panel">${icon('clock')}<div><strong>Deliverability, without false promises.</strong><p>Gmail controls inbox placement. Only send expected messages to people who agreed to receive them. Avoid purchased lists, deceptive subjects, and image-only emails. Mailroom adds readable plain text, uses encrypted SMTP, and respects unsubscribe exclusions. Authentication and reputation must be checked in a received email’s “Show original” headers.</p><p>Marketing messages include an email-based opt-out. Check your Gmail inbox for unsubscribe requests and select those contacts in Audience → Unsubscribe before the next campaign. This is not automatic one-click unsubscribe. High-volume marketing needs an authenticated domain and a public unsubscribe service.</p><strong>Thoughtful sending, built in.</strong><p>Campaigns use two reusable connections with paced sending. Temporary rejections get delayed retries; network and quota problems pause the queue without discarding recipients. Keep this server running until your campaign finishes. Your contacts and campaign history are saved locally.</p></div></div>`; }

function modal(content, wide = false) {
  if (!$('#modal-root dialog')) lastFocus = document.activeElement;
  $('#modal-root').innerHTML = `<dialog class="modal ${wide ? 'wide' : ''}" aria-labelledby="dialog-title">${content}</dialog>`;
  const dialog = $('#modal-root dialog'); dialog.showModal();
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && !busy) closeModal(); });
}
function closeModal() { if (busy) return; $('#modal-root').innerHTML = ''; lastFocus?.focus(); }
function modalHead(title, sub = '') { return `<div class="modal-heading"><div><h2 id="dialog-title">${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>`; }
function newCampaign(template) {
  compose = { name:'', subject:template?.subject || '', body:template?.body || '', format:'text', kind:'service', contactIds:[], step:1 };
  composer();
}
function syncCompose() {
  if (!compose) return;
  for (const key of ['name','subject','body']) { const input = $(`#compose-${key}`); if (input) compose[key] = input.value; }
}
let previewTimer, previewSequence=0;
function isSuppressed(contact) { return data.suppressions?.some(s=>s.email===contact.email.toLowerCase()); }
function schedulePreview() {
  clearTimeout(previewTimer); const sequence=++previewSequence;
  const target=$('#html-preview-content'); if(!target)return;
  target.innerHTML='<p class="muted-text">Preparing your email…</p>';
  const draft={...compose,contactId:compose.contactIds.find(id=>data.contacts.some(c=>c.id===id&&!isSuppressed(c)))};
  previewTimer=setTimeout(async()=>{
    try {
      const result=await api('campaigns/preview','POST',draft);
      if(sequence!==previewSequence||!target.isConnected)return;
      target.innerHTML='<iframe class="html-email-frame" title="Email HTML preview" sandbox="" referrerpolicy="no-referrer"></iframe><details class="text-alternative"><summary>Plain-text alternative</summary><pre></pre></details><div class="content-checks" aria-live="polite"></div>';
      $('iframe',target).srcdoc=result.document;
      $('pre',target).textContent=result.text;
      $('.content-checks',target).innerHTML='<strong>Message checks</strong><p>'+Math.ceil(result.checks.htmlBytes/1024)+' KB · Plain-text alternative '+(result.checks.hasTextAlternative?'included':'empty')+'</p>'+result.checks.warnings.map(w=>'<p class="warning-note">'+esc(w)+'</p>').join('')+'<small>'+esc(result.checks.note)+'</small>';
    }catch(error){if(sequence===previewSequence&&target.isConnected)target.innerHTML='<p class="warning-note">'+esc(error.message)+'</p>';}
  },300);
}
async function importHtmlFile(file) {
  if(!file)return;
  if(!/\.html?$/i.test(file.name)||file.size>256*1024){toast('Choose an HTML file (.html or .htm), up to 256 KB.',true);return;}
  try {
    const source=await file.text();
    if(!source.trim())throw new Error('This HTML file is empty.');
    syncCompose();compose.buffers ||= {};compose.buffers[compose.format||'text']=compose.body;
    compose.format='html';compose.body=source;compose.buffers.html=source;
    composer();toast('HTML imported. Review the preview before sending.');
  }catch(error){toast(error.message,true);}
}
function preview() {
  if(compose.format==='html'||compose.kind==='marketing') return `<div class="preview-label">${icon('eye')} RECIPIENT PREVIEW</div><div id="html-preview-content"></div><p class="preview-note">Remote images are hidden in this safe preview. Email apps may render your design differently.</p>`;
  const contact = data.contacts.find(c => compose.contactIds.includes(c.id)) || { name:'Alex', email:'alex@example.com', domain:'Your domain', designation:'Team member' };
  const personal = text => esc(text).replace(/\{\{(name|email|domain|designation)\}\}/g, (_,key) => esc(contact[key] || ''));
  return `<div class="preview-label">${icon('eye')} RECIPIENT PREVIEW</div><div class="email-preview"><div class="email-preview-header"><span class="preview-avatar">M</span><div><strong>${esc(data.transport.from || 'Your team')}</strong><small>To: ${esc(contact.email)}</small></div></div><div class="email-preview-subject">${personal(compose.subject || 'Your subject goes here')}</div><div class="email-preview-body">${personal(compose.body || 'Your next great conversation starts with a few thoughtful words…')}</div></div><p class="preview-note">${compose.contactIds.length ? 'Personalized for the first selected recipient.' : 'Sample recipient · your contacts will see their own details.'}</p>`;
}
function composer() {
  const step = compose.step;
  const eligible=data.contacts.filter(c=>!isSuppressed(c));
  compose.contactIds=compose.contactIds.filter(id=>eligible.some(c=>c.id===id));
  modal(`${modalHead(compose.id ? 'Edit your campaign' : 'Make a little connection', 'One message. A personal touch for everyone.')}<div class="compose-steps">${['Write your message','Choose your audience','Review & send'].map((label,i) => `<button data-action="compose-step" data-step="${i+1}" class="${step === i+1 ? 'active' : ''}"><span>${i+1}</span>${label}</button>`).join('')}</div><div class="compose-layout"><div class="compose-form">${step === 1 ? `<label class="field">Campaign name <small>Only you will see this</small><input id="compose-name" maxlength="120" placeholder="e.g. A warm welcome to our new members" value="${esc(compose.name)}"></label><label class="field">Subject line<input id="compose-subject" maxlength="250" placeholder="Give them a reason to open" value="${esc(compose.subject)}"></label><div class="message-toolbar"><div class="format-switch" role="group" aria-label="Message format"><button class="btn small-btn ${compose.format!=='html'?'primary':''}" data-action="format-text" aria-pressed="${compose.format!=='html'}">Plain text</button><button class="btn small-btn ${compose.format==='html'?'primary':''}" data-action="format-html" aria-pressed="${compose.format==='html'}">HTML</button></div><label class="btn small-btn html-upload">${icon('upload')}Import HTML<input id="html-file" type="file" accept=".html,.htm,text/html" aria-label="Import HTML file"></label></div><label class="field">${compose.format==='html'?'HTML source':'Your message'}<textarea id="compose-body" class="${compose.format==='html'?'html-source':''}" rows="11" maxlength="262144" spellcheck="${compose.format!=='html'}" placeholder="${compose.format==='html'?'Paste your HTML here…':'Hi {{name}},&#10;&#10;Here’s something worth sharing…'}">${esc(compose.body)}</textarea></label><p class="editor-hint">${compose.format==='html'?'Paste HTML or import a file up to 256 KB. Styles are inlined and active content is removed. A plain-text version is included automatically.':'Write naturally, or switch to HTML for your own email design.'}</p><label class="field">Message purpose<select id="compose-kind"><option value="service" ${compose.kind!=='marketing'?'selected':''}>Service / recruitment notice</option><option value="marketing" ${compose.kind==='marketing'?'selected':''}>Marketing / newsletter</option></select></label>${compose.kind==='marketing'?'<p class="warning-note">Send only to subscribers who opted in. An email-based unsubscribe link is added. Process requests in Audience → Unsubscribe before sending again.</p>':''}<div class="personalize-tools"><span>Make it personal</span>${['name','domain','designation'].map(tag => `<button data-action="insert-tag" data-tag="${tag}">{{${tag}}}</button>`).join('')}</div>` : step === 2 ? `<h3>Who’s on your list?</h3><p class="muted-text">Each person receives their own personalized email.</p>${eligible.length ? `<label class="audience-select-all"><input type="checkbox" id="compose-all" ${compose.contactIds.length === eligible.length ? 'checked' : ''}>Select all ${eligible.length} contacts <strong>${compose.contactIds.length} selected</strong></label><div class="recipient-list">${eligible.map(c => `<label class="recipient"><input type="checkbox" data-recipient="${c.id}" ${compose.contactIds.includes(c.id) ? 'checked' : ''}><span><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></span></label>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${icon('users')}</span><h3>Bring your people first</h3><p>Add contacts from the Audience page, then reopen your saved draft.</p><button class="btn" data-action="save-go-audience">Save draft & add contacts</button></div>`}` : `<div class="review-icon">${icon('send')}</div><h3>Ready to make their day?</h3><p class="muted-text">Take one last look before your message heads out.</p><dl class="review-details"><dt>Campaign</dt><dd>${esc(compose.name || 'Untitled')}</dd><dt>Recipients</dt><dd>${compose.contactIds.length} people</dd><dt>Sender</dt><dd>${esc(data.transport.from || 'Not connected')}</dd><dt>Personalization</dt><dd>Individual emails for every contact</dd></dl>${!data.transport.ready ? '<div class="warning-note">Connect your email provider in Settings before sending. You can save this campaign as a draft.</div>' : '<div class="info-note">'+icon('clock')+'Keep the dashboard server running while your emails send.</div>'}`}</div><aside class="compose-preview">${preview()}</aside></div><div class="modal-footer"><button class="btn" data-action="save-draft">${icon('file')}Save draft</button><div>${step > 1 ? '<button class="btn borderless" data-action="compose-step" data-step="'+(step-1)+'">Back</button>' : ''}${step < 3 ? '<button class="btn primary" data-action="compose-next">'+(step === 1 ? 'Choose audience' : 'Review campaign')+icon('arrow')+'</button>' : `<button class="btn primary" data-action="send-campaign" ${!data.transport.ready || !compose.contactIds.length ? 'disabled' : ''}>${icon('send')}Send to ${compose.contactIds.length} ${compose.contactIds.length === 1 ? 'person' : 'people'}</button>`}</div></div>`, true);
  schedulePreview();
}
async function saveDraft() {
  syncCompose();
  const {buffers,step,...payload}=compose;
  const saved = await api(compose.id ? `campaigns/${compose.id}` : 'campaigns', compose.id ? 'PUT' : 'POST', payload);
  compose.id = saved.id;
  return saved;
}
function contactDialog() { modal(`${modalHead('A new connection', 'Add someone to your audience.')}<form id="contact-form"><div class="modal-body"><label class="field">Full name<input name="name" required minlength="2" maxlength="100" placeholder="Alex Morgan" autocomplete="name"></label><label class="field">Email address<input name="email" type="email" required placeholder="alex@example.com" autocomplete="email"></label><div class="field-row"><label class="field">Domain <small>Optional</small><input name="domain" maxlength="100" placeholder="Marketing"></label><label class="field">Designation <small>Optional</small><input name="designation" maxlength="100" placeholder="Member"></label></div></div><div class="modal-footer"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">${icon('plus')}Add contact</button></div></form>`); }
function importDialog() { modal(`${modalHead('Bring your people', 'A whole audience. One simple upload.')}<div class="modal-body"><label class="upload-zone" id="drop-zone"><span class="upload-icon">${icon('upload')}</span><strong>Drop your spreadsheet here</strong><span>or <b>browse files</b> to choose one</span><small>CSV or XLSX · up to 3 MB · 10,000 contacts</small><input id="import-file" type="file" accept=".csv,.xlsx" aria-label="Choose a contact spreadsheet"></label><div class="import-hint"><strong>A name, an email, and you’re ready.</strong><p>Use <code>Name</code> and <code>Email</code> columns. You can also include <code>Domain</code> and <code>Designation</code>. Duplicate and invalid emails are skipped automatically.</p><button class="text-btn" data-action="sample">${icon('download')}Download a sample CSV</button></div><div id="import-result" aria-live="polite"></div></div><div class="modal-footer"><span class="muted-text">Your contacts stay in this workspace.</span><button class="btn" data-action="close">Done</button></div>`); }
async function importFile(file) {
  if (!file || busy) return;
  if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 3*1024*1024) { toast('Choose a CSV or XLSX file smaller than 3 MB.',true); return; }
  busy = true; $('#import-result').innerHTML = '<p class="loading-text">Reading your contacts…</p>';
  try {
    const content = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await api('contacts/import','POST',{ filename:file.name,content });
    $('#import-result').innerHTML = `<div class="import-success">${icon('check')}<strong>${result.added} contacts added</strong><span>${result.skipped.length} rows skipped</span></div>${result.skipped.length ? `<details class="import-errors"><summary>Review skipped rows</summary>${result.skipped.slice(0,100).map(r => `<p>Row ${r.row}: ${esc(r.email)} — ${esc(r.reason)}</p>`).join('')}${result.skipped.length > 100 ? '<p>Showing the first 100 skipped rows.</p>' : ''}</details>` : ''}`;
    await refresh();
  } catch (error) { $('#import-result').innerHTML = `<div class="warning-note">${esc(error.message)}</div>`; }
  finally { busy = false; if ($('#import-file')) $('#import-file').value = ''; }
}
function campaignDetailContent(c) {
  const done = c.results.filter(r=>['sent','failed','unknown','skipped'].includes(r.status)).length;
  const unknown=c.results.filter(r=>r.status==='unknown').length;
  const remaining=c.results.filter(resumable).length;
  return `<div class="modal-body"><div class="detail-status">${badge(c.status)}<span>${done} of ${c.results.length} processed</span></div><progress max="${c.results.length||1}" value="${done}"></progress><div class="detail-stats"><div><strong>${c.results.filter(r=>r.status==='sent').length}</strong><span>Sent</span></div><div><strong>${c.results.filter(r=>r.status==='failed').length}</strong><span>Failed</span></div><div><strong>${c.results.filter(r=>['pending','sending','retrying'].includes(r.status)).length}</strong><span>Remaining / in flight</span></div></div>${c.lastError ? `<div class="warning-note">${esc(c.lastError.message)}${c.lastError.code ? ' · '+esc(c.lastError.code) : ''}</div>` : ''}${unknown ? `<div class="warning-note">${unknown} unconfirmed message${unknown===1?'':'s'}. Check Gmail Sent before retrying these; they are excluded from normal Resume.</div>` : ''}${c.status==='interrupted'?'<p class="muted-text">The server stopped. Resume sends only the messages with a safe retry status.</p>':''}<p class="muted-text">${activeCampaign(c)?'Progress updates automatically. Stopping allows in-flight messages to finish.':'Accepted messages are never included when you resume.'}</p></div><div class="modal-footer delivery-footer"><button class="btn" data-action="export-one" data-id="${c.id}">${icon('download')}Export</button><div>${activeCampaign(c)?`<button class="btn danger" data-action="stop" data-id="${c.id}">${icon('stop')}Stop</button>`:remaining?`<button class="btn primary" data-action="review-resume" data-id="${c.id}">Resume ${remaining} unsent</button>`:''}${!activeCampaign(c)&&unknown?`<button class="btn" data-action="review-unknown" data-id="${c.id}">Review unconfirmed</button>`:''}<button class="btn" data-action="show-activity">Activity ${icon('arrow')}</button></div></div>`;
}
function campaignDetail(id) {
  const c=data.campaigns.find(c=>c.id===id);
  if(c.status==='draft'){compose={...c,contactIds:[...c.contactIds],step:1};composer();return;}
  modal(`${modalHead(esc(c.name),esc(c.subject))}<div class="live-detail" data-campaign-id="${c.id}">${campaignDetailContent(c)}</div>`);
}
function reviewResume(id,unknown=false) {
  const c=data.campaigns.find(c=>c.id===id);
  const recipients=c.results.filter(r=>unknown?r.status==='unknown':resumable(r));
  modal(`${modalHead(unknown?'Review unconfirmed messages':'Resume your campaign',esc(c.name))}<div class="modal-body"><p>${unknown?'Check Gmail Sent for each address below. Retrying a message already accepted by Gmail could send a duplicate.':'Only the unsent or explicitly deferred messages below will be sent. Accepted messages are excluded.'}</p><div class="retry-recipients">${recipients.map(r=>`<p>${esc(r.name)} &lt;${esc(r.email)}&gt;</p>`).join('')}</div><p class="muted-text">Subject: ${esc(c.subject)}</p>${unknown?'<label class="audience-select-all"><input type="checkbox" id="confirm-not-sent">I checked Gmail Sent; these messages were not sent.</label>':''}</div><div class="modal-footer"><button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="confirm-resume" data-id="${c.id}" data-unknown="${unknown}">${icon('send')}Confirm ${unknown?'retry':'resume'}</button></div>`);
}
function download(filename, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:'text/csv;charset=utf-8;'})); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href),1000); }
function exportResults(id) {
  const cell = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
  const rows = data.campaigns.filter(c => !id || c.id === id).flatMap(c => c.results.map(r => [c.name,r.name,r.email,r.status,r.at || '',r.error || '',r.delivery?.code || '',r.delivery?.responseCode || '',r.attempts || 0,r.messageId || '']));
  download('mailroom-activity.csv',[['Campaign','Name','Email','Status','Time','Details','Error code','SMTP code','Attempts','Message ID'],...rows].map(r => r.map(cell).join(',')).join('\r\n'));
}
function switchFormat(format) {
  syncCompose();compose.buffers ||= {};compose.buffers[compose.format||'text']=compose.body;
  compose.format=format;compose.body=compose.buffers[format]||'';composer();
}
const actions = {
  'format-text':()=>switchFormat('text'),
  'format-html':()=>switchFormat('html'),
  'suppress-contacts':()=>modal(`${modalHead('Unsubscribe selected contacts?')}<div class="modal-body"><p>Exclude ${selected.size} contacts from future sends, including queued messages not yet attempted. Importing them again will not undo this choice.</p><p>Use this when someone requests to unsubscribe. A message already in flight may still finish.</p></div><div class="modal-footer"><button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="confirm-suppress">Confirm unsubscribe</button></div>`),
  'confirm-suppress':async()=>{await api('contacts/suppress','POST',{ids:[...selected]});selected.clear();closeModal();await refresh();toast('Contacts unsubscribed. Future sends will skip them.');},
  'verify-transport':async el => {el.textContent='Checking connection…';try {const result=await api('transport/verify','POST',{});await refresh();toast(result.message,result.status==='failed');}finally{if(el.isConnected)el.textContent='Test connection';}},
  'review-resume':el=>reviewResume(el.dataset.id),
  'review-unknown':el=>reviewResume(el.dataset.id,true),
  'confirm-resume':async el=>{const unknown=el.dataset.unknown==='true';if(unknown&&!$('#confirm-not-sent')?.checked)throw new Error('Check Gmail Sent and confirm the checkbox first.');await api(`campaigns/${el.dataset.id}/${unknown?'retry-unknown':'resume'}`,'POST',{confirm:true,checkedSent:unknown});closeModal();await refresh();toast('Campaign queued. Accepted messages will not be resent.');},
  theme:toggleTheme,
  logout:async () => { await api('auth/logout','POST',{}); showLogin(); },
  nav: el => nav(el.dataset.view), menu: () => $('.sidebar').classList.toggle('open'), new: () => newCampaign(), close: closeModal,
  import: importDialog, 'add-contact':contactDialog, 'use-template':el => newCampaign(data.templates.find(t => t.id === el.dataset.id)),
  filter:el => { filter = el.dataset.filter; render(); }, refresh:async () => { await refresh(); toast(data.transport.ready ? 'Provider settings are configured.' : 'No email provider configured yet.'); },
  sample:() => download('mailroom-contacts-sample.csv','Name,Email,Domain,Designation\r\nAlex Morgan,alex@example.com,Marketing,Member\r\nJamie Lee,jamie@example.com,Technical,Manager\r\n'),
  'compose-step':el => { syncCompose(); compose.step = Number(el.dataset.step); composer(); },
  'compose-next':() => { syncCompose(); if (!compose.name.trim() || !compose.subject.trim() || !compose.body.trim()) throw new Error('Add a campaign name, subject, and message first.'); compose.step++; composer(); },
  'insert-tag':el => { const input = $('#compose-body'); input.setRangeText(`{{${el.dataset.tag}}}`,input.selectionStart,input.selectionEnd,'end'); input.focus(); syncCompose(); $('.compose-preview').innerHTML = preview(); schedulePreview(); },
  'save-draft':async () => { await saveDraft(); closeModal(); await refresh(); toast('Your draft is saved. Good ideas can wait.'); },
  'save-go-audience':async () => { await saveDraft(); closeModal(); await refresh(); nav('audience'); },
  'send-campaign':async () => { if (busy) return; busy = true; try { const saved = await saveDraft(); await api(`campaigns/${saved.id}/send`,'POST',{confirm:true}); busy = false; closeModal(); await refresh(); nav('campaigns'); toast('Campaign queued. We’ll check the connection before sending.'); } finally { busy = false; } },
  'open-campaign':el => campaignDetail(el.dataset.id), 'show-activity':() => { closeModal(); nav('activity'); },
  stop:async el => { await api(`campaigns/${el.dataset.id}/cancel`,'POST',{}); closeModal(); await refresh(); toast('Sending stopped. The message in progress may still finish.'); },
  export:() => exportResults(), 'export-one':el => exportResults(el.dataset.id),
  'remove-contacts':() => modal(`${modalHead('Remove selected contacts?')}<div class="modal-body"><p>Remove ${selected.size} contacts from your audience and draft campaigns? Previous sending history will be kept.</p></div><div class="modal-footer"><button class="btn" data-action="close">Keep contacts</button><button class="btn danger" data-action="confirm-remove">Remove contacts</button></div>`),
  'confirm-remove':async () => { await api('contacts','DELETE',{ids:[...selected]}); selected.clear(); closeModal(); await refresh(); toast('Selected contacts removed.'); },
  help:() => modal(`${modalHead('Welcome to your mailroom.', 'A calmer way to stay connected.')}<div class="modal-body help-body">${[['01','Connect your email','Open Settings and configure Resend or SMTP in your local .env file.'],['02','Bring your audience','Upload a CSV or Excel file with Name and Email columns, or add contacts one at a time.'],['03','Make it personal','Create a campaign or choose a template. Use {{name}} to greet each person individually.'],['04','Review, then send','Choose your recipients and review the personalized preview. Follow progress in Campaigns and export results from Activity.']].map(([n,t,d]) => `<div><span>${n}</span><section><h3>${t}</h3><p>${d}</p></section></div>`).join('')}</div><div class="modal-footer"><span class="muted-text">A little less admin. A lot more connection.</span><button class="btn primary" data-action="close">Got it ${icon('check')}</button></div>`)
};
document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  event.preventDefault();
  if (busy && !['sample'].includes(el.dataset.action)) return;
  try { el.disabled = true; await actions[el.dataset.action]?.(el); } catch (error) { toast(error.message,true); } finally { el.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.id.startsWith('compose-') && ['compose-name','compose-subject','compose-body'].includes(event.target.id)) { syncCompose(); $('.compose-preview').innerHTML = preview(); schedulePreview(); }
  if (['global-search','list-search'].includes(event.target.id)) {
    const id = event.target.id, cursor = event.target.selectionStart;
    query = event.target.value; if (id === 'global-search') view = 'campaigns'; render(); const input = $('#'+id); input.focus(); input.setSelectionRange(cursor,cursor);
  }
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'period') { period = Number(input.value); render(); }
  if (input.id === 'html-file') void importHtmlFile(input.files[0]);
  if (input.id === 'compose-kind') {syncCompose();compose.kind=input.value;composer();}
  if (input.id === 'import-file') void importFile(input.files[0]);
  if (input.dataset.contact) { input.checked ? selected.add(input.dataset.contact) : selected.delete(input.dataset.contact); render(); }
  if (input.id === 'select-all-contacts') { data.contacts.filter(c => `${c.name} ${c.email} ${c.domain}`.toLowerCase().includes(query.toLowerCase())).forEach(c => input.checked ? selected.add(c.id) : selected.delete(c.id)); render(); }
  if (input.dataset.recipient) { compose.contactIds = input.checked ? [...compose.contactIds,input.dataset.recipient] : compose.contactIds.filter(id => id !== input.dataset.recipient); composer(); }
  if (input.id === 'compose-all') { compose.contactIds = input.checked ? data.contacts.filter(c=>!isSuppressed(c)).map(c => c.id) : []; composer(); }
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'login-form') {
    event.preventDefault(); if (busy) return; busy = true;
    const button = $('button[type="submit"]', event.target); button.disabled = true; $('#login-error').textContent = '';
    try { const result = await api('auth/login','POST',Object.fromEntries(new FormData(event.target))); authenticated = true; authUser = result.username; view = 'dashboard'; query = ''; filter = 'all'; await refresh(); }
    catch (error) { if ($('#login-error')) $('#login-error').textContent = error.message; else toast(error.message,true); }
    finally { busy = false; button.disabled = false; }
    return;
  }
  if (event.target.id !== 'contact-form') return;
  event.preventDefault(); if (busy) return;
  busy = true; const button = $('button[type="submit"]',event.target); button.disabled = true;
  try { await api('contacts','POST',Object.fromEntries(new FormData(event.target))); busy = false; closeModal(); await refresh(); toast('A new connection added to your audience.'); } catch (error) { toast(error.message,true); } finally { busy = false; button.disabled = false; }
});
document.addEventListener('dragover', event => { if (event.target.closest('#drop-zone')) { event.preventDefault(); $('#drop-zone').classList.add('dragging'); } });
document.addEventListener('dragleave', event => { if (event.target.closest('#drop-zone')) $('#drop-zone').classList.remove('dragging'); });
document.addEventListener('drop', event => { if (event.target.closest('#drop-zone')) { event.preventDefault(); $('#drop-zone').classList.remove('dragging'); void importFile(event.dataTransfer.files[0]); } });
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !$('#modal-root dialog')) { event.preventDefault(); $('#global-search')?.focus(); } });
let refreshing=false;
setInterval(async()=>{
  const detail=$('.live-detail');
  if(refreshing || busy || !authenticated || !data.campaigns.some(activeCampaign) || ($('#modal-root dialog')&&!detail))return;
  refreshing=true;
  try {
    const id=detail?.dataset.campaignId;
    await refresh();
    if(id&&$('.live-detail')){const c=data.campaigns.find(c=>c.id===id);$('.live-detail').innerHTML=campaignDetailContent(c);}
  } catch(error){if(error.status!==401)toast('Connection lost. Check that the dashboard server is running.',true);}
  finally{refreshing=false;}
},1500);
try { const session = await api('auth/session'); authenticated = session.authenticated; authUser = session.username || ''; if (authenticated) await refresh(); else showLogin(); } catch { showLogin(); $('#login-error').textContent = 'Couldn’t reach the dashboard server. Please try signing in again.'; }

import 'dotenv/config';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sendEmail, getTransportName, verifyMailTransport, closeMailTransport } from './lib/mail.js';
import { createStore, templates, fail, parseContacts, validateCampaign } from './lib/dashboard.js';
import { validateEmail, validateName } from './lib/validate.js';
import { createAuth } from './lib/auth.js';
import { createCampaignQueue, activeStatuses, canResume } from './lib/campaignQueue.js';
import { deliveryError } from './lib/delivery.js';
import { compileEmail, renderEmail, inspectEmail, previewDocument, unsubscribeMailto } from './lib/emailContent.js';

const root = dirname(fileURLToPath(import.meta.url));
export function createApp({ dataDir = join(root, 'data'), auth: authOptions, sender = sendEmail, transport = () => ({ name: getTransportName(), ready: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL || !process.env.RESEND_API_KEY && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS), from: process.env.RESEND_API_KEY ? process.env.RESEND_FROM_EMAIL || '' : process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '' }), delay = Math.max(250, Number(process.env.SEND_DELAY_MS) || 500), concurrency = 2, dailyLimit = Number(process.env.SMTP_DAILY_LIMIT) || (/gmail\.com$/i.test(process.env.SMTP_USER || '') ? 500 : 0), retryDelay = 3000, verify = sender === sendEmail ? verifyMailTransport : async () => ({verified:true}) } = {}) {
  const { state, save } = createStore(dataDir);
  const authReady = createAuth(dataDir, authOptions);
  // Attach a handler immediately so configuration errors don't become unhandled rejections.
  authReady.catch(error => console.error(error.message));
  let health = { status:'unchecked' }, verification;
  async function checkTransport() {
    if (verification) return verification;
    verification = (async () => {
      try {
        const result = await verify();
        health = {status:result?.verified === false ? 'configured' : 'verified',checkedAt:new Date().toISOString(),message:result?.message || 'Provider connection verified.'};
        return result;
      } catch(error) {
        health = {status:'failed',checkedAt:new Date().toISOString(),...deliveryError(error,{preflight:true})};
        throw error;
      } finally { verification = null; }
    })();
    return verification;
  }
  const queue = createCampaignQueue({state,save,sender,verify:checkTransport,dataDir,concurrency:Math.max(1,Math.min(2,concurrency)),delay,retryDelay,dailyLimit});
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) fail('This dashboard is available on localhost only.', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) fail('Cross-origin requests are not allowed.', 403);
      const url = new URL(req.url, `http://${host}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') fail('Method not allowed.', 405);
        const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/theme.js': ['theme.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
        const asset = assets[url.pathname];
        if (!asset) fail('Page not found.', 404);
        const content = await readFile(join(root, 'public', asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
        return res.end(content);
      }
      const auth = await authReady;
      const route = `${req.method} ${url.pathname}`;
      const publicAuthRoute = ['GET /api/auth/session', 'POST /api/auth/login', 'POST /api/auth/logout'].includes(route);
      if (!publicAuthRoute && !auth.session(req)) fail('Please sign in to continue.', 401);
      let body = {};
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) fail('Use application/json.', 415);
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > (publicAuthRoute ? 8192 : 5 * 1024 * 1024)) fail('The request is too large.', 413); chunks.push(chunk); }
        const raw = Buffer.concat(chunks).toString('utf8');
        try { body = JSON.parse(raw || '{}'); } catch { fail('Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object.');
      }
      if (route === 'GET /api/auth/session') {
        const session = auth.session(req);
        return json(200, { authenticated:Boolean(session), username:session?.username });
      }
      if (route === 'POST /api/auth/login') {
        const result = await auth.login(req, res, body);
        return json(result.status, result.error ? { error:result.error } : { username:result.username });
      }
      if (route === 'POST /api/auth/logout') { auth.logout(req, res); return json(200, { ok:true }); }
      if (route === 'GET /api/workspace') return json(200, { ...state, templates, transport: {...transport(),health}, sending:{concurrency,delayMs:delay,dailyLimit,used:queue.usage()} });
      if (route === 'POST /api/transport/verify') {
        if(!transport().ready) fail('Configure your email provider first.');
        try { await checkTransport(); } catch { return json(200,health); }
        return json(200,health);
      }
      if (route === 'POST /api/contacts/import') {
        if (typeof body.content !== 'string' || !/\.(csv|xlsx)$/i.test(body.filename || '')) fail('Choose a CSV or XLSX file.');
        const buffer = Buffer.from(body.content, 'base64');
        if (buffer.length > 3 * 1024 * 1024) fail('Maximum file size is 3 MB.');
        const parsed = parseContacts(buffer, state.contacts);
        state.contacts.push(...parsed.contacts); save();
        return json(200, { added: parsed.contacts.length, skipped: parsed.skipped, total: parsed.total });
      }
      if (route === 'POST /api/contacts') {
        if (!validateName(body.name).valid || !validateEmail(body.email).valid) fail('Enter a valid name and email address.');
        const email = body.email.trim().toLowerCase();
        if (state.contacts.some(c => c.email === email)) fail('This email is already in your audience.');
        const contact = { id: randomUUID(), name: body.name.trim(), email, domain: String(body.domain || '').slice(0,100), designation: String(body.designation || '').slice(0,100), createdAt: new Date().toISOString() };
        state.contacts.push(contact); save(); return json(201, contact);
      }
      if (route === 'POST /api/contacts/suppress') {
        if (!Array.isArray(body.ids) || !body.ids.length) fail('Select contacts to unsubscribe.');
        for (const contact of state.contacts.filter(c=>body.ids.includes(c.id))) {
          if (!state.suppressions.some(s=>s.email===contact.email.toLowerCase())) state.suppressions.push({email:contact.email.toLowerCase(),at:new Date().toISOString()});
        }
        save(); return json(200,{ok:true});
      }
      if (route === 'DELETE /api/contacts') {
        if (!Array.isArray(body.ids)) fail('Select contacts to remove.');
        state.contacts = state.contacts.filter(c => !body.ids.includes(c.id));
        state.campaigns.filter(c => c.status === 'draft').forEach(c => { c.contactIds = c.contactIds.filter(id => !body.ids.includes(id)); });
        save(); return json(200, { ok: true });
      }
      if (route === 'POST /api/campaigns/preview') {
        const campaign=validateCampaign({...body,name:body.name||'Preview',subject:body.subject||'Preview',contactIds:[]},state.contacts);
        const contact=state.contacts.find(c=>c.id===body.contactId)||{name:'Alex',email:'alex@example.com',domain:'Your domain',designation:'Team member'};
        const compiled=compileEmail(campaign);
        const content=renderEmail(campaign,contact,compiled,campaign.kind==='marketing'?unsubscribeMailto(contact):undefined);
        return json(200,{...content,document:previewDocument(content.html),checks:inspectEmail(campaign,compiled)});
      }
      if (route === 'POST /api/campaigns') {
        const data = validateCampaign(body, state.contacts);
        const campaign = { ...data, id: randomUUID(), status: 'draft', createdAt: new Date().toISOString(), results: [] };
        state.campaigns.unshift(campaign); save(); return json(201, campaign);
      }
      const match = url.pathname.match(/^\/api\/campaigns\/([^/]+)(?:\/(send|cancel|resume|retry-unknown))?$/);
      if (match) {
        const campaign = state.campaigns.find(c => c.id === match[1]);
        if (!campaign) fail('Campaign not found.', 404);
        if (req.method === 'PUT' && !match[2]) {
          if (campaign.status !== 'draft') fail('Only draft campaigns can be edited.', 409);
          Object.assign(campaign, validateCampaign(body, state.contacts)); save(); return json(200, campaign);
        }
        if (req.method === 'POST' && ['send','resume','retry-unknown'].includes(match[2])) {
          if (body.confirm !== true) fail('Review and confirm your campaign before sending.');
          if (!transport().ready) fail('Connect an email provider in Settings before sending.');
          if (activeStatuses.includes(campaign.status)) fail('This campaign is already queued or sending.',409);
          if (match[2] === 'send') {
            if (campaign.status !== 'draft') fail('This campaign has already been submitted. Use Resume for remaining messages.',409);
            const audience = state.contacts.filter(c => campaign.contactIds.includes(c.id));
            if (!audience.length) fail('Add at least one recipient before sending.');
            campaign.results = audience.map(c => ({...c,status:'pending',attempts:0}));
          } else if(match[2] === 'retry-unknown') {
            if(body.checkedSent !== true) fail('Check Gmail Sent and explicitly confirm these messages were not sent.');
            const uncertain=campaign.results.filter(r=>r.status==='unknown');
            if(!uncertain.length) fail('There are no unconfirmed messages to retry.');
            campaign.runRecipientIds=uncertain.map(r=>r.id);
            uncertain.forEach(r=>{r.previousDelivery=r.delivery;r.status='pending';r.unknownReviewedAt=new Date().toISOString();delete r.error;delete r.delivery;});
          } else {
            if(!campaign.results.some(canResume)) fail('No safely retryable messages remain. Check unconfirmed messages in Gmail Sent.',409);
          }
          if(match[2]!=='retry-unknown')campaign.runRecipientIds=campaign.results.filter(canResume).map(r=>r.id);
          campaign.status='queued';campaign.queuedAt=new Date().toISOString();delete campaign.finishedAt;delete campaign.lastError;
          save();queue.start();return json(202,campaign);
        }
        if (req.method === 'POST' && match[2] === 'cancel') {
          if (!activeStatuses.includes(campaign.status)) fail('This campaign is not currently queued or sending.',409);
          campaign.status='cancelled';save();return json(200,campaign);
        }
        if (req.method === 'DELETE' && !match[2]) {
          if (campaign.status !== 'draft') fail('Only drafts can be deleted.', 409);
          state.campaigns = state.campaigns.filter(c => c.id !== campaign.id); save(); return json(200, { ok: true });
        }
      }
      fail('Not found.', 404);
    } catch (error) { json(error.status || 500, { error: error.status ? error.message : 'Something went wrong. Check the server and try again.' }); }
  });
  server.on('close',()=>{ void queue.close().then(()=>{if(sender===sendEmail)closeMailTransport();}); });
  server.shutdown = async () => { await queue.close(); if(sender===sendEmail)closeMailTransport(); await new Promise(resolve=>server.close(resolve)); };
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const app=createApp();
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{void app.shutdown().then(()=>process.exit(0));});
  app.listen(port, '127.0.0.1', () => console.log(`\n  Mailroom is ready → http://localhost:${port}\n  Email provider: ${getTransportName()}\n`));
}

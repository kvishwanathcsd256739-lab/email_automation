import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { parseContacts, emailHtml, createStore } from '../lib/dashboard.js';
import XLSX from 'xlsx';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'mailroom-test-'));
  const server = createApp({ dataDir, delay:5, concurrency:1, dailyLimit:0, retryDelay:5, auth:{ username:'admin', password:'test-password' }, ...options });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(origin + '/api/' + path, { method, headers:{ 'Content-Type':'application/json', Cookie:cookie, ...headers }, ...(body ? {body:JSON.stringify(body)} : {}) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return {status:response.status, body:await response.json(), setCookie};
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir,{recursive:true,force:true}); });
  if (!options.skipLogin) assert.equal((await request('auth/login','POST',{username:'admin',password:'test-password'})).status,200);
  return {request, dataDir, origin};
}
async function waitUntil(request, predicate) {
  for (let i=0;i<100;i++) { const {body} = await request('workspace'); if (predicate(body)) return body; await new Promise(resolve => setTimeout(resolve,10)); }
  assert.fail('Campaign did not reach the expected state');
}
async function makeCampaign(request, count=3) {
  const ids=[];
  for(let i=0;i<count;i++) {
    const contact=await request('contacts','POST',{name:`Person ${i}`,email:`person${i}-${Math.random().toString(16).slice(2)}@example.com`});
    ids.push(contact.body.id);
  }
  return (await request('campaigns','POST',{name:'Queue test',subject:'Hello {{name}}',body:'Welcome {{name}}',contactIds:ids})).body;
}

test('HTML preview and delivery share sanitization and generate personalized multipart content',async t=>{
  const messages=[];
  const {request}=await fixture(t,{transport:()=>({ready:true}),sender:async m=>messages.push(m)});
  const contact=(await request('contacts','POST',{name:'Alex Example',email:'alex-html@example.com'})).body;
  const draft={name:'HTML campaign',subject:'Hello {{name}}',format:'html',kind:'marketing',body:'<style>p{color:#123456}</style><p>Hello {{name}}, welcome to the team.</p><a href="https://example.com">Details</a><script>alert(1)</script>',contactIds:[contact.id]};
  const preview=await request('campaigns/preview','POST',{...draft,contactId:contact.id});
  assert.equal(preview.status,200);assert.match(preview.body.html,/Hello Alex Example/);assert.doesNotMatch(preview.body.html,/<script/);
  const c=(await request('campaigns','POST',draft)).body;
  assert.equal(c.format,'html');assert.equal(c.kind,'marketing');
  assert.equal((await request(`campaigns/${c.id}/send`,'POST',{confirm:true})).status,202);
  await waitUntil(request,s=>s.campaigns[0].status==='sent');
  assert.equal(messages.length,1);assert.equal(messages[0].html,preview.body.html);assert.equal(messages[0].text,preview.body.text);
  assert.match(messages[0].text,/Alex Example/);assert.doesNotMatch(messages[0].text,/<p>/);
  assert.equal((await request('campaigns','POST',{...draft,format:'unknown'})).status,400);
  assert.equal((await request('campaigns/preview','POST',{...draft,body:'<script>x()</script>'})).status,400);
});

test('unsubscribe exclusion survives deleting and reimporting a contact and skips queued sends',async t=>{
  const messages=[];
  const {request,dataDir}=await fixture(t,{transport:()=>({ready:true}),sender:async m=>messages.push(m)});
  const campaign=await makeCampaign(request,2);
  let state=(await request('workspace')).body;
  const blocked=state.contacts[0];
  await request('contacts/suppress','POST',{ids:[blocked.id]});
  await request(`campaigns/${campaign.id}/send`,'POST',{confirm:true});
  state=await waitUntil(request,s=>s.campaigns[0].status==='sent');
  assert.equal(messages.length,1);assert.equal(state.campaigns[0].results[0].status,'skipped');
  assert.equal(state.campaigns[0].results[0].attempts,0);
  await request('contacts','DELETE',{ids:[blocked.id]});
  const imported=(await request('contacts','POST',{name:blocked.name,email:blocked.email})).body;
  const c=(await request('campaigns','POST',{name:'Reimport',subject:'Hello',body:'Test',contactIds:[imported.id]})).body;
  await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  await waitUntil(request,s=>s.campaigns[0].status==='sent');
  assert.equal(messages.length,1);
  assert.equal(createStore(dataDir).state.suppressions[0].email,blocked.email);
});
test('a failed preflight pauses without attempting a recipient; resume succeeds',async t=>{
  let online=false,calls=0;
  const {request}=await fixture(t,{transport:()=>({ready:true}),verify:async()=>{if(!online)throw Object.assign(new Error('blocked'),{code:'ETIMEDOUT'});},sender:async()=>{calls++;}});
  const c=await makeCampaign(request);
  await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  let state=await waitUntil(request,s=>s.campaigns[0].status==='paused');
  assert.equal(calls,0);assert.equal(state.campaigns[0].results.filter(r=>r.status==='pending').length,3);
  assert.equal(state.campaigns[0].lastError.code,'ETIMEDOUT');
  online=true;assert.equal((await request(`campaigns/${c.id}/resume`,'POST',{confirm:true})).status,202);
  await waitUntil(request,s=>s.campaigns[0].status==='sent');assert.equal(calls,3);
});
test('temporary negative replies retry with a stable message ID and record attempts',async t=>{
  const attempts=[];
  const {request}=await fixture(t,{transport:()=>({ready:true}),sender:async email=>{attempts.push(email);if(attempts.length<3)throw Object.assign(new Error('deferred'),{responseCode:451,response:'451 4.7.1 Try later'});return {messageId:'confirmed-id'};}});
  const c=await makeCampaign(request,1);await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  const state=await waitUntil(request,s=>s.campaigns[0].status==='sent');
  assert.equal(attempts.length,3);assert.equal(new Set(attempts.map(a=>a.messageId)).size,1);
  assert.equal(state.campaigns[0].results[0].attempts,3);assert.equal(state.campaigns[0].results[0].messageId,'confirmed-id');
});
test('persistent deferrals stop after bounded retries instead of exhausting the audience',async t=>{
  let calls=0;
  const {request}=await fixture(t,{transport:()=>({ready:true}),sender:async()=>{calls++;throw Object.assign(new Error('deferred'),{responseCode:421,response:'421 4.7.0 Slow down'});}});
  const c=await makeCampaign(request,3);await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  const state=await waitUntil(request,s=>s.campaigns[0].status==='paused');
  assert.equal(calls,3);assert.equal(state.campaigns[0].results.filter(r=>r.status==='pending').length,2);
});
test('unconfirmed sends require explicit review and are excluded from normal resume',async t=>{
  const calls=[];let uncertain=true;
  const {request}=await fixture(t,{transport:()=>({ready:true}),sender:async email=>{calls.push(email.to);if(uncertain){uncertain=false;throw Object.assign(new Error('dropped after DATA'),{code:'ESOCKET',command:'DATA'});}}});
  const c=await makeCampaign(request,2);await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  const paused=await waitUntil(request,s=>s.campaigns[0].status==='paused');
  assert.equal(paused.campaigns[0].results[0].status,'unknown');
  await request(`campaigns/${c.id}/resume`,'POST',{confirm:true});
  await waitUntil(request,s=>s.campaigns[0].status==='completed_with_errors');
  assert.equal(calls.length,2);assert.notEqual(calls[0],calls[1]);
  assert.equal((await request(`campaigns/${c.id}/retry-unknown`,'POST',{confirm:true})).status,400);
  await request(`campaigns/${c.id}/retry-unknown`,'POST',{confirm:true,checkedSent:true});
  await waitUntil(request,s=>s.campaigns[0].status==='sent');
  assert.equal(calls.length,3);assert.equal(calls[0],calls[2]);
});
test('reviewing an unconfirmed recipient does not send unrelated pending recipients',async t=>{
  const calls=[];let uncertain=true;
  const {request}=await fixture(t,{transport:()=>({ready:true}),sender:async email=>{calls.push(email.to);if(uncertain){uncertain=false;throw Object.assign(new Error('confirmation lost'),{code:'ETIMEDOUT'});}}});
  const c=await makeCampaign(request,2);await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  await waitUntil(request,s=>s.campaigns[0].status==='paused');
  await request(`campaigns/${c.id}/retry-unknown`,'POST',{confirm:true,checkedSent:true});
  const state=await waitUntil(request,s=>s.campaigns[0].status==='completed_with_errors');
  assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);
  assert.deepEqual(state.campaigns[0].results.map(r=>r.status),['sent','pending']);
});
test('quota protection reserves in-flight slots and resumes only remaining recipients',async t=>{
  let calls=0;
  const {request}=await fixture(t,{concurrency:2,dailyLimit:2,transport:()=>({ready:true}),sender:async()=>{calls++;await new Promise(r=>setTimeout(r,15));}});
  const c=await makeCampaign(request,4);await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  const state=await waitUntil(request,s=>s.campaigns[0].status==='paused'&&s.campaigns[0].finishedAt);
  assert.equal(calls,2);assert.equal(state.campaigns[0].results.filter(r=>r.status==='sent').length,2);
  assert.equal(state.campaigns[0].results.filter(r=>r.status==='pending').length,2);
  await request(`campaigns/${c.id}/resume`,'POST',{confirm:true});
  await waitUntil(request,s=>s.campaigns[0].status==='paused'&&s.campaigns[0].finishedAt);
  assert.equal(calls,2);
});
test('multiple campaigns queue once and two workers send without exceeding concurrency',async t=>{
  let inFlight=0,maxInFlight=0;const calls=[];
  const {request}=await fixture(t,{concurrency:2,transport:()=>({ready:true}),sender:async email=>{calls.push(email.to);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(r=>setTimeout(r,20));inFlight--;}});
  const a=await makeCampaign(request,8),b=await makeCampaign(request,3);
  await request(`campaigns/${a.id}/send`,'POST',{confirm:true});
  await request(`campaigns/${b.id}/send`,'POST',{confirm:true});
  assert.equal((await request(`campaigns/${a.id}/send`,'POST',{confirm:true})).status,409);
  await waitUntil(request,s=>s.campaigns.every(c=>c.status==='sent'));
  assert.equal(calls.length,11);assert.equal(new Set(calls).size,11);assert.equal(maxInFlight,2);
});
test('connection check is authenticated, returns actionable errors, and never calls sender',async t=>{
  let calls=0;
  const {request}=await fixture(t,{transport:()=>({ready:true}),verify:async()=>{throw Object.assign(new Error('bad login'),{code:'EAUTH',responseCode:535});},sender:async()=>{calls++;}});
  const check=await request('transport/verify','POST',{});
  assert.equal(check.body.status,'failed');assert.equal(check.body.category,'authentication');assert.equal(calls,0);
  await request('auth/logout','POST',{});
  assert.equal((await request('transport/verify','POST',{})).status,401);
});
test('authentication protects reads and writes, rotates sessions, and invalidates logout', async t => {
  const {request,dataDir} = await fixture(t,{skipLogin:true});
  assert.equal((await request('auth/session')).body.authenticated,false);
  assert.equal((await request('workspace')).status,401);
  assert.equal((await request('contacts','POST',{name:'Alex Morgan',email:'alex@example.com'})).status,401);
  assert.equal((await request('campaigns/no-such-campaign/send','POST',{confirm:true})).status,401);
  assert.equal((await request('auth/login','POST',{username:'admin',password:'wrong'})).status,401);
  const first = await request('auth/login','POST',{username:'admin',password:'test-password'});
  assert.equal(first.status,200); assert.match(first.setCookie,/HttpOnly/); assert.match(first.setCookie,/SameSite=Strict/);
  const oldCookie = first.setCookie.split(';')[0];
  assert.equal((await request('workspace')).status,200);
  const second = await request('auth/login','POST',{username:'admin',password:'test-password'});
  assert.notEqual(first.setCookie,second.setCookie);
  assert.equal((await request('workspace','GET',undefined,{Cookie:oldCookie})).status,401);
  const account = await readFile(join(dataDir,'auth.json'),'utf8');
  assert.ok(!account.includes('test-password')); assert.equal(JSON.parse(account).hash.length,128);
  assert.equal((await request('auth/logout','POST',{})).status,200);
  assert.equal((await request('workspace')).status,401);
  assert.equal((await request('auth/session')).body.authenticated,false);
});
test('login attempts are limited and cross-origin login is rejected', async t => {
  const {request} = await fixture(t,{skipLogin:true});
  assert.equal((await request('auth/login','POST',{username:'admin',password:'test-password'},{Origin:'https://other.example'})).status,403);
  for (let i=0;i<5;i++) assert.equal((await request('auth/login','POST',{username:'admin',password:'wrong'})).status,401);
  assert.equal((await request('auth/login','POST',{username:'admin',password:'test-password'})).status,429);
});
test('expired sessions cannot read workspace data', async t => {
  const {request} = await fixture(t,{auth:{username:'admin',password:'test-password',sessionTtl:100}});
  assert.equal((await request('workspace')).status,200);
  await new Promise(resolve => setTimeout(resolve,140));
  assert.equal((await request('workspace')).status,401);
  assert.equal((await request('auth/session')).body.authenticated,false);
});
test('CSV and XLSX imports validate and deduplicate recipients', () => {
  const parsed = parseContacts(Buffer.from('Name,Email,Domain\nAlex Morgan,alex@example.com,Tech\nAlex Again,ALEX@example.com,Tech\nInvalid,not-an-email,Tech\nJamie Lee,jamie@example.com,Marketing'));
  assert.equal(parsed.contacts.length,2); assert.equal(parsed.skipped.length,2); assert.equal(parsed.contacts[0].domain,'Tech');
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{Name:'Taylor Smith','College Email':'taylor@example.com',Designation:'Member'}]),'People');
  const excel = parseContacts(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
  assert.equal(excel.contacts[0].email,'taylor@example.com');
  assert.equal(excel.contacts[0].designation,'Member');
  assert.equal(parseContacts(Buffer.from('Name,Email\nAlex Morgan,alex@example.com'),parsed.contacts).contacts.length,0);
});
test('personalized message content cannot introduce HTML', () => {
  const html = emailHtml('Hi {{name}},\n<script>bad()</script>',{name:'<img src=x onerror=bad()>'});
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img'));
});
test('drafts persist, sender configuration is required, and cross-origin writes are rejected', async t => {
  const {request,dataDir} = await fixture(t,{transport:() => ({name:'None',ready:false,from:''})});
  assert.equal((await request('contacts','POST',{name:'Bad',email:'wrong'})).status,400);
  const contact = (await request('contacts','POST',{name:'Alex Morgan',email:'Alex@example.com'})).body;
  assert.equal((await request('contacts','POST',{name:'Alex Again',email:'alex@example.com'})).status,400);
  const campaign = (await request('campaigns','POST',{name:'Welcome',subject:'Hi {{name}}',body:'A personal hello.',contactIds:[contact.id]})).body;
  assert.equal(createStore(dataDir).state.campaigns[0].name,'Welcome');
  assert.equal((await request(`campaigns/${campaign.id}/send`,'POST',{confirm:true})).status,400);
  assert.equal((await request('contacts','POST',{name:'Malicious',email:'bad@example.com'},{Origin:'https://other.example'})).status,403);
  assert.equal((await request('contacts','DELETE',{ids:[contact.id]})).status,200);
  assert.deepEqual((await request('workspace')).body.campaigns[0].contactIds,[]);
});
test('bulk sending personalizes, persists outcomes, and rejects duplicate sends', async t => {
  const sent = [];
  const {request} = await fixture(t,{transport:() => ({name:'Mock',ready:true,from:'test@example.com'}),sender:async email => { sent.push(email); if (email.to === 'jamie@example.com') throw Object.assign(new Error('mock rejection'),{responseCode:550,response:'550 5.1.1 Recipient not found'}); }});
  const a = (await request('contacts','POST',{name:'Alex Morgan',email:'alex@example.com'})).body;
  const b = (await request('contacts','POST',{name:'Jamie Lee',email:'jamie@example.com'})).body;
  const c = (await request('campaigns','POST',{name:'Launch',subject:'Hi {{name}}',body:'Welcome {{name}}!',contactIds:[a.id,b.id,a.id]})).body;
  assert.equal(c.contactIds.length,2);
  assert.equal((await request(`campaigns/${c.id}/send`,'POST',{})).status,400);
  assert.equal((await request(`campaigns/${c.id}/send`,'POST',{confirm:true})).status,202);
  assert.equal((await request(`campaigns/${c.id}/send`,'POST',{confirm:true})).status,409);
  const state = await waitUntil(request,s => s.campaigns[0].status === 'completed_with_errors');
  assert.equal(sent.length,2); assert.equal(sent[0].subject,'Hi Alex Morgan'); assert.ok(sent[0].html.includes('Welcome Alex Morgan!'));
  assert.deepEqual(state.campaigns[0].results.map(r => r.status),['sent','failed']);
  assert.equal((await request(`campaigns/${c.id}`,'PUT',c)).status,409);
});
test('stopping a campaign leaves unsent recipients pending', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  const {request} = await fixture(t,{transport:() => ({ready:true}),sender:async email => { sent.push(email); await gate; }});
  const ids=[];
  for (const [name,email] of [['Alex Morgan','alex@example.com'],['Jamie Lee','jamie@example.com']]) ids.push((await request('contacts','POST',{name,email})).body.id);
  const c = (await request('campaigns','POST',{name:'Stop me',subject:'Hello',body:'Welcome',contactIds:ids})).body;
  await request(`campaigns/${c.id}/send`,'POST',{confirm:true});
  await request(`campaigns/${c.id}/cancel`,'POST',{}); release();
  const state = await waitUntil(request,s => s.campaigns[0].finishedAt);
  assert.equal(sent.length,1); assert.equal(state.campaigns[0].status,'cancelled');
  assert.deepEqual(state.campaigns[0].results.map(r => r.status),['sent','pending']);
});
test('a server restart marks in-flight messages unconfirmed without resending', async t => {
  const directory = await mkdtemp(join(tmpdir(),'mailroom-restart-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const store = createStore(directory);
  store.state.campaigns.push({status:'sending',results:[{status:'sent'},{status:'sending'},{status:'pending'}]}); store.save();
  const recovered = createStore(directory).state.campaigns[0];
  assert.equal(recovered.status,'interrupted'); assert.deepEqual(recovered.results.map(r => r.status),['sent','unknown','pending']);
});

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import XLSX from 'xlsx';
import { validateEmail, validateName } from './validate.js';
import { inspectEmail, MAX_EMAIL_BYTES } from './emailContent.js';

export const templates = [
  { id: 'welcome', name: 'A warm welcome', category: 'Onboarding', color: 'purple', subject: 'Welcome aboard, {{name}}!', body: 'Hi {{name}},\n\nGreat things start with great people. We’re so glad you’re here!\n\nWelcome to our community. We’ll keep you in the loop with the latest updates, upcoming events, and opportunities to get involved.\n\nHere’s to what we’ll build together.\n\nWarmly,\nThe team' },
  { id: 'shortlisted', name: 'You’re on the list', category: 'Recruitment', color: 'peach', subject: 'Congratulations, {{name}} — you’re selected!', body: 'Hi {{name}},\n\nCongratulations! We’re delighted to welcome you to the National Entrepreneurship Challenge (NEC) 2026 team.\n\nYour domain: {{domain}}\nYour role: {{designation}}\n\nWe look forward to your ideas, energy, and contributions. We’ll share the next steps with you soon.\n\nBest wishes,\nIdea Incubator MGIT' },
  { id: 'announcement', name: 'Something worth sharing', category: 'Announcement', color: 'green', subject: 'A little update from our team', body: 'Hi {{name}},\n\nWe have something exciting to share with you.\n\n[Add your announcement here — what’s happening, why it matters, and how to get involved.]\n\nHave a question? Just reply to this email. We’d love to hear from you.\n\nUntil next time,\nThe team' },
];

export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
export function personalize(text, contact) { return text.replace(/\{\{(name|email|domain|designation)\}\}/g, (_, key) => contact[key] || (key === 'name' ? 'there' : '')); }
export function emailHtml(body, contact) {
  const content = escapeHtml(personalize(body, contact)).replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;padding:40px 20px;background:#f6f5fa;font-family:Arial,sans-serif;color:#292638"><div style="max-width:580px;margin:auto;background:white;padding:40px;border-radius:16px;font-size:15px;line-height:1.85">${content}</div></body></html>`;
}
export function parseContacts(buffer, existing = []) {
  let book;
  try { book = XLSX.read(buffer, { type: 'buffer', sheetRows: 10002 }); } catch { fail('We couldn’t read that file. Upload a CSV or XLSX spreadsheet.'); }
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) fail('The spreadsheet has no sheets.');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) fail('Your file is empty. Add a Name and Email column, then try again.');
  if (rows.length > 10000) fail('Please import at most 10,000 contacts at a time.');
  const seen = new Set(existing.map(c => c.email.toLowerCase()));
  const contacts = [], skipped = [];
  rows.forEach((row, index) => {
    const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/[_-]/g, ' '), String(v).trim()]));
    const name = normalized.name || normalized['full name'] || '';
    const email = (normalized['college email'] || normalized.email || normalized['email address'] || normalized['personal email'] || '').toLowerCase();
    const problem = !validateName(name).valid ? 'A name of 2–100 characters is required.' : !validateEmail(email).valid ? 'Invalid or missing email address.' : seen.has(email) ? 'Duplicate email address.' : null;
    if (problem) { skipped.push({ row: index + 2, email, reason: problem }); return; }
    seen.add(email);
    contacts.push({ id: randomUUID(), name, email, domain: (normalized.domain || normalized.department || '').slice(0,100), designation: (normalized.designation || normalized.role || '').slice(0,100), createdAt: new Date().toISOString() });
  });
  return { contacts, skipped, total: rows.length };
}

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'workspace.json');
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { contacts: [], campaigns: [] };
  state.suppressions ||= [];
  const save = () => { writeFileSync(file + '.tmp', JSON.stringify(state, null, 2)); renameSync(file + '.tmp', file); };
  for (const campaign of state.campaigns) {
    if (['sending','checking','queued'].includes(campaign.status)) {
      campaign.status = 'interrupted';
    }
    campaign.results.filter(r => r.status === 'sending').forEach(r => { r.status = 'unknown'; r.error = 'The app stopped during this send. Check Gmail Sent before sending it again.'; });
    campaign.results.filter(r => r.status === 'retrying').forEach(r => { r.status = 'pending'; });
    campaign.results.filter(r => r.status === 'failed' && !r.delivery && r.error?.startsWith('Provider rejected or could not confirm')).forEach(r => {r.status='unknown';r.error='The older sender did not record the provider response. Check Gmail Sent before deciding whether to retry this message.';});
  }
  save();
  return { state, save };
}

export function validateCampaign(input, contacts) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) fail('Enter a campaign name (up to 120 characters).');
  if (typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 250 || /[\r\n]/.test(input.subject)) fail('Enter a subject on one line (up to 250 characters).');
  if (typeof input.body !== 'string' || !input.body.trim() || Buffer.byteLength(input.body) > MAX_EMAIL_BYTES) fail('Add your email message (up to 256 KB).');
  const format = input.format ?? 'text', kind = input.kind ?? 'service';
  if (!['text','html'].includes(format) || !['service','marketing'].includes(kind)) fail('Choose a supported message format and purpose.');
  inspectEmail({...input,format});
  if (!Array.isArray(input.contactIds)) fail('Choose your recipients.');
  const ids = [...new Set(input.contactIds)];
  if (ids.some(id => !contacts.some(c => c.id === id))) fail('Some contacts no longer exist. Please select your audience again.');
  return { name: input.name.trim(), subject: input.subject.trim(), body: input.body.trim(), format, kind, contactIds: ids };
}

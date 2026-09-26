import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEmail, renderEmail, inspectEmail, previewDocument, MAX_EMAIL_BYTES, createMessageId, senderMailbox } from '../lib/emailContent.js';

test('HTML styles are inlined, active content stripped, and links retained in plain text',()=>{
  const campaign={format:'html',body:'<html><head><style>p { color: #663399; padding: 12px; }</style></head><body><p>Hello {{name}}</p><a href="https://example.com/details">Read details</a><script>danger()</script><iframe src="https://example.com"></iframe><img src="https://example.com/a.png" onerror="danger()" alt="Logo"></body></html>'};
  const compiled=compileEmail(campaign);
  const message=renderEmail(campaign,{name:'<img src=x onerror=alert(1)>',email:'alex@example.com'},compiled);
  assert.match(message.html,/color: *#663399/);
  assert.match(message.html,/&lt;img/);
  assert.doesNotMatch(message.html,/<script|<iframe|<[^>]* onerror=|<style|danger\(\)/);
  assert.match(message.text,/https:\/\/example.com\/details/);
  assert.ok(inspectEmail(campaign).warnings.some(w=>w.includes('Active content was removed')));
  assert.match(previewDocument(message.html),/img-src 'none'/);
});

test('personalization cannot inject dangerous links or break out of attributes',()=>{
  const message=renderEmail({format:'html',body:'<p>Hi {{name}}</p><a href="{{designation}}">Open</a><img src="{{domain}}" alt="{{name}}">'},{name:'" onerror="alert(1)',designation:'javascript:alert(1)',domain:'https://example.com/x.png" onload="alert(2)'});
  assert.doesNotMatch(message.html,/href="javascript:/);
  assert.doesNotMatch(message.html,/<[^>]*" on(?:load|error)="/);
});

test('empty active-only HTML and oversized multibyte HTML are rejected',()=>{
  assert.throws(()=>inspectEmail({format:'html',body:'<script>alert(1)</script>'}),/visible content/);
  assert.throws(()=>compileEmail({format:'html',body:'é'.repeat(MAX_EMAIL_BYTES/2+1)}),/256 KB/);
});

test('HTML warnings identify missing alt text, external styles and large image-only designs',()=>{
  const checks=inspectEmail({format:'html',body:'<link rel="stylesheet" href="https://example.com/a.css"><img src="https://example.com/a.png"><p style="display:none">hidden</p>'});
  assert.ok(checks.warnings.some(w=>w.includes('External stylesheets')));
  assert.ok(checks.warnings.some(w=>w.includes('alternative text')));
  assert.ok(checks.warnings.some(w=>w.includes('Hidden content')));
  assert.ok(checks.warnings.some(w=>w.includes('little readable text')));
});

test('message IDs use the configured sender domain and are unique',()=>{
  const first=createMessageId(),second=createMessageId();
  assert.notEqual(first,second);
  assert.ok(first.endsWith('@'+(senderMailbox().split('@')[1]||'localhost')+'>'));
  assert.doesNotMatch(first,/@mailroom\.local/);
});

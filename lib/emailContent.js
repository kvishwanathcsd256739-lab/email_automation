import sanitize from 'sanitize-html';
import juice from 'juice';
import { convert } from 'html-to-text';
import { randomUUID } from 'node:crypto';

export const MAX_EMAIL_BYTES = 256 * 1024;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeStyle = /^(?!.*(?:url|expression|javascript|import|behavior))[-\w\s#.,%()+/'"]+$/i;
const styles = Object.fromEntries(['color','background','background-color','font-family','font-size','font-weight','font-style','text-align','text-decoration','text-transform','line-height','letter-spacing','word-break','overflow-wrap','white-space','vertical-align','display','visibility','opacity','width','min-width','max-width','height','min-height','max-height','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left','border','border-top','border-right','border-bottom','border-left','border-color','border-width','border-style','border-radius','border-collapse','border-spacing','table-layout','list-style-type'].map(key=>[key,[safeStyle]]));
const options = {
  allowedTags:['html','head','title','body','main','section','article','header','footer','div','span','p','br','hr','h1','h2','h3','h4','h5','h6','a','img','table','thead','tbody','tfoot','tr','td','th','caption','colgroup','col','ul','ol','li','b','strong','i','em','u','s','del','small','sup','sub','blockquote','pre','code','center'],
  allowedAttributes:{'*':['style','align','valign','width','height','role','aria-label','lang','dir'],a:['href','title','target','rel'],img:['src','alt','title','width','height'],table:['cellpadding','cellspacing','border','bgcolor','width','role'],td:['colspan','rowspan','bgcolor'],th:['colspan','rowspan','scope','bgcolor'],col:['span'],body:['bgcolor']},
  allowedStyles:{'*':styles},
  allowedSchemes:['https','http','mailto','tel'],allowedSchemesByTag:{img:['https']},allowProtocolRelative:false,
  nonTextTags:['script','style','textarea','option','iframe','object','embed','svg','math','noscript'],
  transformTags:{a:(tag,attrs)=>({tagName:tag,attribs:{...attrs,target:'_blank',rel:'noopener noreferrer'}})},
};
export function personalizeContent(value,contact,html=false) {
  return String(value).replace(/\{\{(name|email|domain|designation)\}\}/g,(_,key)=>{
    const data=contact[key] || (key==='name'?'there':'');return html?escapeHtml(data):String(data);
  });
}
export function sanitizeEmailHtml(raw,{inline=true}={}) {
  let source=String(raw);
  if(Buffer.byteLength(source)>MAX_EMAIL_BYTES)throw Object.assign(new Error('HTML must be 256 KB or smaller.'),{status:400});
  if(inline) {
    try {source=juice(source,{removeStyleTags:true,preserveMediaQueries:false,preserveFontFaces:false,preserveKeyFrames:false,applyAttributesTableElements:true});}
    catch {throw Object.assign(new Error('The HTML or stylesheet could not be read. Check its syntax.'),{status:400});}
  }
  const clean=sanitize(source,options);
  if(Buffer.byteLength(clean)>MAX_EMAIL_BYTES)throw Object.assign(new Error('The email exceeds 256 KB after CSS is inlined. Simplify the stylesheet.'),{status:400});
  return clean;
}
export function textFromHtml(html) {
  return convert(html,{wordwrap:80,selectors:[{selector:'img',format:'skip'},{selector:'a',options:{hideLinkHrefIfSameAsText:true}},{selector:'title',format:'skip'}],limits:{maxInputLength:MAX_EMAIL_BYTES,maxDepth:80}}).trim();
}
export function compileEmail(campaign) {
  if(campaign.format==='html')return sanitizeEmailHtml(campaign.body);
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,sans-serif;color:#292638"><div style="max-width:600px;margin:auto;font-size:15px;line-height:1.7">${escapeHtml(campaign.body).replace(/\n/g,'<br>')}</div></body></html>`;
}
export function renderEmail(campaign,contact,compiled=compileEmail(campaign),unsubscribeUrl) {
  let html=sanitizeEmailHtml(personalizeContent(compiled,contact,true),{inline:false});
  if(unsubscribeUrl) {
    const footer=`<p style="font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#666666;margin-top:28px">You’re receiving this subscription message from ${escapeHtml(senderMailbox())}. <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from marketing emails</a>.</p>`;
    html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,footer+'</body>'):html+footer;
  }
  return {html,text:campaign.format==='html'?textFromHtml(html):personalizeContent(campaign.body,contact)+(unsubscribeUrl?`\n\nUnsubscribe from marketing emails: ${unsubscribeUrl}`:'')};
}
export function senderMailbox() {
  const from=process.env.RESEND_API_KEY?process.env.RESEND_FROM_EMAIL:process.env.SMTP_FROM_EMAIL||process.env.SMTP_USER;
  return String(from||'').match(/<([^<>]+)>/)?.[1]?.trim()||String(from||'').trim();
}
export function createMessageId() {
  const domain=senderMailbox().split('@')[1];
  // Fallback is only used by isolated mock transports without a sender configured.
  return `<${randomUUID()}@${/^[a-z\d.-]+$/i.test(domain||'')?domain:'localhost'}>`;
}
export function unsubscribeMailto(contact) {
  const mailbox=senderMailbox();
  if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(mailbox))return undefined;
  return `mailto:${mailbox}?subject=Unsubscribe&body=${encodeURIComponent('Please unsubscribe '+contact.email+' from future emails.')}`;
}
export function inspectEmail(campaign,compiled=compileEmail(campaign)) {
  const warnings=[];
  const text=textFromHtml(compiled);
  if(!text && !/<img\b/i.test(compiled))throw Object.assign(new Error('Add visible content to your email. Active scripts, embedded pages, and forms cannot be sent.'),{status:400});
  if(campaign.format==='html') {
    if(/<script\b|<iframe\b|<form\b|\son\w+\s*=|javascript:/i.test(campaign.body))warnings.push('Active content was removed. Emails cannot run scripts, forms, or embedded pages.');
    if(/<link\b|@import/i.test(campaign.body))warnings.push('External stylesheets are not loaded. Include styles in the HTML or use inline CSS.');
    if(/(?:src|href)\s*=\s*["'](?:\/(?!\/)|\.\.?\/|cid:|data:)/i.test(campaign.body))warnings.push('Relative and embedded image paths will not work here. Host images at public HTTPS URLs.');
    if(/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\b)/i.test(campaign.body))warnings.push('Hidden content was found. Remove misleading hidden text; it can hurt deliverability.');
    if(/<img\b/i.test(compiled)&&text.length<80)warnings.push('This email has little readable text. Include meaningful text alongside images.');
    if(/<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(compiled))warnings.push('Some images lack alternative text. Add alt text for readability when images are blocked.');
  }
  if(Buffer.byteLength(compiled)>100*1024)warnings.push('This is a large email. Reducing HTML and image weight improves readability across clients.');
  if(/\{\{(?!name\}\}|email\}\}|domain\}\}|designation\}\})[^}]+\}\}/.test(campaign.body))warnings.push('Unknown personalization tags were found. Supported tags are name, email, domain, and designation.');
  return {warnings,htmlBytes:Buffer.byteLength(compiled),textCharacters:text.length,hasTextAlternative:Boolean(text),note:'These checks find formatting issues; they do not predict or guarantee inbox placement.'};
}
export function previewDocument(html) {
  // The dashboard preview never loads remote content or grants script/origin access.
  const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'">';
  return `<!doctype html>${csp}${html}`;
}

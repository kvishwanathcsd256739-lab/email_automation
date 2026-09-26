// Only explicit negative SMTP replies are automatically retryable. A dropped
// connection after message submission is ambiguous and must not be resent blindly.
export function deliveryError(error, { preflight = false } = {}) {
  const code = String(error.code || 'SEND_ERROR').slice(0,40);
  const responseCode = Number(error.responseCode) || undefined;
  let detail = String(error.response || '').replace(/[\r\n]+/g,' ').slice(0,1000);
  for (const secret of [process.env.SMTP_PASS, process.env.RESEND_API_KEY]) if (secret) detail = detail.split(secret).join('[redacted]');
  const base = { code, responseCode, detail, at:new Date().toISOString(), retryable:false, safeToRetry:false, pause:false, uncertain:false };
  if (code === 'EAUTH' || responseCode === 535) return {...base,category:'authentication',pause:true,safeToRetry:true,message:'Gmail could not authenticate. Check the App Password in .env and restart the server, then resume this campaign.'};
  if (/daily|quota|sending limit|5\.4\.5/i.test(detail) || code === 'DAILY_LIMIT') return {...base,category:'quota',pause:true,safeToRetry:true,message:'The sending limit has been reached. Remaining messages are saved. Wait for the limit to reset, then resume.'};
  if (preflight) return {...base,category:'connection',pause:true,safeToRetry:true,message:'Cannot connect to the email provider. Check internet access and allow the Node server through the firewall. No messages were attempted. Use Test connection, then resume.'};
  if (responseCode >= 400 && responseCode < 500) return {...base,category:'temporary',retryable:true,safeToRetry:true,message:`The provider temporarily deferred this message (${responseCode}). It will be retried with a delay.`};
  if (responseCode >= 500 && responseCode < 600 || code === 'EENVELOPE') return {...base,category:'rejected',pause:/5\.7\.|MAIL FROM/i.test(detail + ' ' + (error.command || '')),message:`The provider rejected this message${responseCode ? ` (${responseCode})` : ''}. ${detail || 'Check the recipient address and sender permissions.'}`};
  if (code === 'EDNS' || code === 'ECONNREFUSED' || code === 'ECONNECTION') return {...base,category:'connection',pause:true,safeToRetry:true,message:'The server could not open an SMTP connection. Check network access, then resume the remaining messages.'};
  return {...base,category:'unconfirmed',uncertain:true,pause:true,message:'The provider did not confirm acceptance. This message will not be retried automatically, to avoid duplicates. Check Gmail Sent before deciding whether to send it again.'};
}

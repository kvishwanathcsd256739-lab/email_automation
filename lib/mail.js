/**
 * mail.js — Email transport layer
 *
 * Strategy:
 *   1. If RESEND_API_KEY is set → use the Resend SDK (preferred).
 *   2. Otherwise, fall back to SMTP via Nodemailer using SMTP_* env vars.
 *   3. If neither is configured, throw a clear configuration error.
 *
 * The caller never needs to know which transport is active — both
 * paths expose the same `sendEmail()` signature.
 */

import { Resend } from "resend";
import nodemailer from "nodemailer";
import { senderMailbox } from './emailContent.js';

// ── Transport detection ──────────────────────────────────────────

/**
 * Returns "resend" | "smtp" | null depending on which env vars are set.
 */
function detectTransport() {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  return null;
}

/**
 * Returns a human-readable label for the active transport.
 *
 * @returns {string}
 */
export function getTransportName() {
  const transport = detectTransport();
  if (transport === "resend") return "Resend API";
  if (transport === "smtp") return `SMTP (${process.env.SMTP_HOST})`;
  return "None";
}

// ── Resend sender ────────────────────────────────────────────────

async function sendViaResend({ to, cc, subject, html, text, messageId, headers }) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const payload = {
    from: process.env.RESEND_FROM_EMAIL || "NEC 2026 <nec@yourdomain.com>",
    to: [to],
    subject,
    html,
    text,
    replyTo: process.env.REPLY_TO_EMAIL || senderMailbox(),
    headers: {...headers,...(messageId?{'Message-ID':messageId}:{})},
  };
  
  if (cc) payload.cc = [cc];

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    throw new Error(error.message || "Resend API returned an error.");
  }

  return data;
}

// ── SMTP sender ──────────────────────────────────────────────────

let smtpPool;
export function smtpOptions() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: process.env.SMTP_SECURE !== "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool: true, maxConnections: 2, maxMessages: 100, maxRequeues: 0,
    connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000,
    dnsTimeout: 10000, disableFileAccess: true, disableUrlAccess: true,
    tls: { minVersion: 'TLSv1.2' },
  };
}
function getPool() { return smtpPool ||= nodemailer.createTransport(smtpOptions()); }
export function closeMailTransport() { smtpPool?.close(); smtpPool = undefined; }
export async function verifyMailTransport() {
  if (detectTransport() === 'smtp') {
    // Separate verification connection: checking settings never closes in-flight sends.
    const checker = nodemailer.createTransport({ ...smtpOptions(), pool:false });
    let timer;
    try {
      await Promise.race([checker.verify(), new Promise((_,reject) => {
        timer = setTimeout(() => { checker.close(); reject(Object.assign(new Error('SMTP verification timed out'), {code:'ETIMEDOUT'})); }, 20000);
      })]);
      return { verified:true, message:'SMTP connection and authentication verified. No email was sent.' };
    } finally { clearTimeout(timer); checker.close(); }
  }
  if (detectTransport() === 'resend') {
    return { verified:false, message:'Resend is configured. API credentials are verified on the first send.' };
  }
  throw Object.assign(new Error('No email provider configured'),{code:'ENOCONFIG'});
}
async function sendViaSMTP({ to, cc, subject, html, text, messageId, headers }) {
  const operation = getPool().sendMail({
    from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
    to, ...(cc ? {cc} : {}), subject, html, text, ...(messageId ? {messageId} : {}),
    replyTo: process.env.REPLY_TO_EMAIL || senderMailbox(), headers,
  });
  let timer,info;
  try {
    info=await Promise.race([operation,new Promise((_,reject)=>{
      timer=setTimeout(()=>{closeMailTransport();reject(Object.assign(new Error('Send confirmation timeout'),{code:'ETIMEDOUT'}));},45000);
    })]);
  } finally {clearTimeout(timer);}
  if (!info.accepted?.length) throw Object.assign(new Error('No recipients accepted'),{code:'EENVELOPE',response:info.response});
  return info;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Sends an email using the best available transport.
 *
 * @param {{ to: string, cc?: string, subject: string, html: string }} options
 * @returns {Promise<object>} transport-specific response data
 * @throws {Error} on missing config or delivery failure
 */
export async function sendEmail({ to, cc, subject, html, text, messageId, headers }) {
  const transport = detectTransport();

  if (!transport) {
    throw new Error(
      "No email transport configured.\n" +
      "Set RESEND_API_KEY for the Resend API, or provide SMTP_HOST / SMTP_USER / SMTP_PASS for SMTP."
    );
  }

  if (transport === "resend") {
    return sendViaResend({ to, cc, subject, html, text, messageId, headers });
  }

  return sendViaSMTP({ to, cc, subject, html, text, messageId, headers });
}

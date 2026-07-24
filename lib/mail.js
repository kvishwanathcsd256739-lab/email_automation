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

async function sendViaResend({ to, cc, subject, html }) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const payload = {
    from: process.env.RESEND_FROM_EMAIL || "NEC 2026 <nec@yourdomain.com>",
    to: [to],
    subject,
    html,
  };
  
  if (cc) payload.cc = [cc];

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    throw new Error(error.message || "Resend API returned an error.");
  }

  return data;
}

// ── SMTP sender ──────────────────────────────────────────────────

async function sendViaSMTP({ to, cc, subject, html }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const payload = {
    from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
    to,
    subject,
    html,
  };
  
  if (cc) payload.cc = cc;

  const info = await transporter.sendMail(payload);

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
export async function sendEmail({ to, cc, subject, html }) {
  const transport = detectTransport();

  if (!transport) {
    throw new Error(
      "No email transport configured.\n" +
      "Set RESEND_API_KEY for the Resend API, or provide SMTP_HOST / SMTP_USER / SMTP_PASS for SMTP."
    );
  }

  if (transport === "resend") {
    return sendViaResend({ to, cc, subject, html });
  }

  return sendViaSMTP({ to, cc, subject, html });
}

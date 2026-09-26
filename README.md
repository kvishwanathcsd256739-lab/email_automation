# Mailroom — Email Automation Dashboard

A clean, responsive workspace for composing personalized bulk emails, managing contacts, and following sending progress. Built on the repository’s existing Resend / SMTP mail transport. The original NEC recruitment CLI is still available.

## Run locally

Requires Node.js 22.16+ (tested with Node.js 24) and npm.

```bash
npm ci
npm start
```

Open **http://localhost:3000** and sign in. No build step is needed. You can import contacts, create drafts, and preview messages before connecting a sender.

On a fresh installation, copy `.env.example` to `.env` and set `ADMIN_PASSWORD` before starting. `ADMIN_USERNAME` defaults to `admin`. The account is initialized once and stored as a salted scrypt hash in the git-ignored `data/auth.json`; you can remove `ADMIN_PASSWORD` from `.env` after initialization. The existing local workspace already has its requested admin account configured.

Use the sun/moon button at the top right to switch light and dark modes, including on the login screen. The preference is remembered in this browser, and the initial theme follows the system preference. Use the sign-out button in the dashboard header to end your session.

Sessions use HttpOnly, SameSite cookies and expire after eight hours or a server restart. Five failed logins trigger a 15-minute cooldown. Every workspace API requires authentication. Signing out does not cancel an already-running email campaign.

Other commands:

```bash
npm run dev     # Restart the server when backend files change
npm run cli     # Original terminal-based sender, including PDF imports
npm test        # Backend tests with a mock email sender
npm run test:ui # Chrome checks for desktop/mobile and the core user flows
```

The UI check uses locally installed Chrome on Windows. Set `CHROME_PATH` to your Chrome/Chromium executable on another system. It uses a temporary, isolated workspace and never sends real emails. Screenshots are saved to the git-ignored `artifacts/` directory.

## Connect your sender

Copy `.env.example` to `.env` in the project folder. Use one provider, then restart the server.

**Resend:**

```dotenv
RESEND_API_KEY=your_api_key
RESEND_FROM_EMAIL=Your Team <hello@your-verified-domain.com>
```

**SMTP (for example, Gmail with an app password):**

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM_EMAIL=Your Team <you@gmail.com>
```

For an implicit TLS connection on port 465, set `SMTP_SECURE=true`. Resend takes priority when `RESEND_API_KEY` is set. The Settings screen shows whether the required configuration exists; provider credentials are validated when an email is actually sent. Secrets are never returned to the browser.

## Use the dashboard

1. **Audience:** upload CSV/XLSX or add contacts individually. Imports accept up to 3 MB and 10,000 rows. Invalid addresses and duplicates are skipped with a row-by-row report. Headers are case insensitive.
2. **Templates:** start with a welcome, NEC recruitment, or announcement message, or compose from scratch.
3. **Campaigns:** write your subject and message, choose recipients, and review the personalized preview. Save a draft or explicitly send the campaign.
4. **Activity:** inspect individual provider results and export them as CSV. Stop an active campaign from its detail dialog.

### Contact spreadsheet format

```csv
Name,Email,Domain,Designation
Alex Morgan,alex@example.com,Marketing,Member
Jamie Lee,jamie@example.com,Technical,Manager
```

`Name` and `Email` are required; `College Email` and `Email Address` are also accepted. `Domain`/`Department` and `Designation`/`Role` are optional. The dashboard does not automatically CC personal addresses. A sample CSV is available from the import dialog.

Use `{{name}}`, `{{email}}`, `{{domain}}`, and `{{designation}}` in the subject or message. Each contact receives an individual email. Choose **Plain text** or **HTML** in the composer. Paste HTML source or use **Import HTML** for a UTF-8 `.html`/`.htm` file up to 256 KB. The server inlines embedded styles, strips active content, escapes personalization, and builds a matching plain-text alternative. The sandboxed preview blocks remote images and scripts. Use public HTTPS image URLs in the actual message; external stylesheets and local image files are unsupported. Email clients may render designs differently.

## Sending and storage

- Campaigns are queued in submission order, with one campaign active at a time. Each uses two persistent SMTP connections, up to 100 messages per connection, and 500 ms between message starts by default (`SEND_DELAY_MS`, minimum 250 ms). This avoids repeated TLS/authentication overhead without flooding Gmail.
- Every campaign checks SMTP connectivity and authentication before attempting any recipient. Settings → **Test connection** performs the same check without sending an email. Configuration presence is labeled separately from verified connectivity.
- Explicit temporary SMTP rejections receive at most three attempts, with 3- and 6-second backoffs. Authentication, connection, and quota errors pause the campaign with an actionable reason. Resume requires confirmation and excludes accepted or unconfirmed messages.
- If a connection drops without a clear acceptance/rejection, the result is **Unconfirmed** and is not automatically retried. **Review unconfirmed** requires you to check Gmail Sent and explicitly confirm the messages were not sent. SMTP cannot guarantee exactly-once delivery after an ambiguous connection failure.
- Personal Gmail accounts have provider-imposed daily limits. Mailroom also enforces `SMTP_DAILY_LIMIT=500` across its own accepted, unconfirmed, and in-flight messages over the preceding 24 hours. External Gmail usage is not visible to the app, so Google can enforce an earlier limit. See [Gmail sending limits](https://support.google.com/mail/answer/22839).
- Keep the Node server running while sending. Closing the browser does not stop an active campaign.
- Duplicate starts are rejected. Stopping a campaign prevents further recipients from being processed; an in-flight message can still finish.
- Contacts, drafts, and per-recipient results persist in `data/workspace.json`. This directory is git-ignored; back it up if you need to retain your workspace.
- On restart, queued/checking/sending campaigns are marked interrupted. Resume lets you continue their remaining recipients; no mail is automatically sent at startup. Old failures that lacked provider diagnostics are marked unconfirmed rather than presumed safe to retry.
- Result exports include attempt counts, SMTP/error codes, and message IDs. Structured audit events are stored in `data/delivery-events.ndjson`. Passwords and message bodies are not written to those events.
- **Sent** means accepted by the email provider, not confirmed inbox delivery. Opens, clicks, and bounces are not tracked. Unsubscribe requests are processed manually as described below.
- Statistics reflect real workspace data; there are no fabricated campaign results.

This is a local, single-user dashboard bound to `127.0.0.1`. It requires admin login and rejects foreign hosts and cross-origin requests. Public deployment would also require HTTPS with Secure cookies, deployment-specific access control, and an appropriate shared persistence/session/queue layer.

### Run with working network access on Windows

Launch from a normal PowerShell terminal, not an execution environment that blocks outgoing connections:

```powershell
cd D:\email_automation
npm start
# Or keep it running in a hidden background window:
powershell -NoProfile -File .\scripts\start-dashboard.ps1
```

The background launcher checks for an existing dashboard before starting another, writes its PID to `logs/dashboard.pid`, and saves process output under `logs/`. It survives closing the terminal but is not a Windows service and does not restart automatically after reboot. Use Settings → Test connection after launch. Keep the computer awake while campaigns send.

The original failure discarded provider diagnostics; connection tests reproduced a timeout in the restricted agent runtime and successful SMTP authentication in the normal network-enabled runtime. SMTP verification confirms connection and authentication, not recipient delivery. A real delivery check still requires explicitly sending a test message.

## Inbox placement and unsubscribe handling

No sender or application can guarantee that every recipient sees an email in their inbox. Gmail evaluates authentication, reputation, content, complaints, and recipient preferences. Use expected, relevant messages and opt-in audiences. Do not repeatedly resend to people who reject or report your messages. See [Google sender guidelines](https://support.google.com/mail/answer/81126).

The app sends multipart HTML/text through TLS, generates Message-IDs using the configured sender domain, and sets a reply address (override with optional `REPLY_TO_EMAIL`). Gmail authenticates mail sent through its service; verify actual SPF/DKIM/DMARC results using **Show original** on a received message. The dashboard connection check does not check recipient authentication headers or inbox placement.

Choose **Marketing / newsletter** to add a visible email-based unsubscribe link and a `List-Unsubscribe` mailto header. Monitor the sender's Gmail inbox for requests. In **Audience**, select those contacts and click **Unsubscribe**, then confirm. The durable suppression list excludes those addresses from all future dashboard sends, including queued recipients not yet attempted; deleting and reimporting a contact does not clear the exclusion. Already in-flight messages may finish. This is manual email-based opt-out, not RFC 8058 one-click unsubscribe; high-volume marketing requires a public unsubscribe endpoint and an appropriate authenticated sending domain/provider. The original CLI does not share the dashboard suppression list and should not be used for subscription campaigns.

A personal Gmail account remains subject to Google's limits and is not an unlimited bulk-marketing service. This app remains a local single-user dashboard, not a publicly hosted campaign platform.

## Project layout

```text
public/              Responsive dashboard, styles, and browser interactions
server.js            Local HTTP server, campaign API, and background sending
lib/dashboard.js     Contact validation, templates, safe rendering, persistence
lib/mail.js          Existing Resend / SMTP transport
index.js             Original interactive CLI
templates/           Original CLI HTML email templates
tests/               Backend and browser checks (no real emails)
.env.example         Sender configuration reference
```

CLI HTML templates in `templates/` remain available to `npm run cli`. Dashboard templates are editable plain-text starters defined in `lib/dashboard.js`.

ISC — Idea Incubator MGIT

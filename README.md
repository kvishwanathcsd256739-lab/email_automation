# NEC 2026 — Email Automation CLI

> Terminal-based email sender for official NEC 2026 recruitment communications.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure your transport (edit .env)
#    Option A — Resend API (preferred):
#      RESEND_API_KEY=re_xxxxx
#      RESEND_FROM_EMAIL=NEC 2026 <nec@yourdomain.com>
#
#    Option B — SMTP fallback:
#      SMTP_HOST=smtp.gmail.com
#      SMTP_PORT=587
#      SMTP_USER=your-email@gmail.com
#      SMTP_PASS=your-app-password

# 3. Run
npm start
```

## Features

| Feature | Details |
|---------|---------|
| **Dual transport** | Resend API (primary) or SMTP via Nodemailer (fallback) |
| **Interactive CLI** | Guided prompts with validation via Inquirer |
| **Email validation** | Strict checks using the `validator` library |
| **HTML templates** | External templates with `{{placeholder}}` replacement |
| **Preview** | Plain-text terminal preview before sending |
| **Audit log** | Every attempt logged to `logs/sent.log` |
| **Colored output** | Chalk-powered, spinner via Ora |
| **Future-ready** | Drop new `.html` files into `templates/` — auto-discovered |

## Project Structure

```
email-automation/
├── templates/
│   └── shortlisted.html       # HTML email template
├── lib/
│   ├── mail.js                 # Resend / SMTP transport layer
│   ├── validate.js             # Email & name validators
│   ├── logger.js               # File-based send logger
│   └── template.js             # Template engine (load & render)
├── logs/
│   └── sent.log                # Append-only audit log (auto-created)
├── .env                        # Secrets (never committed)
├── .gitignore
├── package.json
├── index.js                    # CLI entry point
└── README.md
```

## Adding New Templates

1. Create a new `.html` file inside `templates/` (e.g. `templates/rejected.html`).
2. Use `{{name}}`, `{{date}}`, `{{club}}` placeholders wherever needed.
3. Run `npm start` — the CLI will automatically show a template picker if more than one template exists.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | ✦ | Resend API key (preferred transport) |
| `RESEND_FROM_EMAIL` | ✦ | Verified sender on Resend |
| `SMTP_HOST` | ✧ | SMTP server hostname |
| `SMTP_PORT` | ✧ | SMTP port (default `587`) |
| `SMTP_SECURE` | ✧ | `true` for port 465, `false` otherwise |
| `SMTP_USER` | ✧ | SMTP username |
| `SMTP_PASS` | ✧ | SMTP password / app password |
| `SMTP_FROM_EMAIL` | ✧ | Sender address for SMTP |
| `DEFAULT_CLUB` | — | Club name in templates (default: `Idea Incubator MGIT`) |

✦ Required for Resend · ✧ Required for SMTP fallback

## Security

- API keys are read exclusively from `.env` (never hardcoded).
- `.env` is git-ignored.
- Secrets are **never** written to `logs/sent.log`.

## License

ISC — Idea Incubator MGIT
# email_automation

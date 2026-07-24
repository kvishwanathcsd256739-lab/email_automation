#!/usr/bin/env node

/**
 * index.js — NEC 2026 Recruitment Mail Sender
 *
 * Interactive CLI supporting both single emails and bulk
 * sends via Excel spreadsheet.
 */

import "dotenv/config";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import readline from "node:readline";
import { loadTemplate, listTemplates } from "./lib/template.js";
import { validateEmail, validateName } from "./lib/validate.js";
import { sendEmail, getTransportName } from "./lib/mail.js";
import { logSend } from "./lib/logger.js";
import { readSpreadsheet } from "./lib/excel.js";
import { readPdf } from "./lib/pdf.js";
import { sendBulkEmails } from "./lib/bulkSender.js";

// ── Constants ────────────────────────────────────────────────────

const SUBJECT =
  "Congratulations! 🎉 Selection to the National Entrepreneurship Challenge (NEC) 2026 Team";

const CLUB = process.env.DEFAULT_CLUB || "Idea Incubator MGIT";

// ── UI helpers ───────────────────────────────────────────────────

function banner() {
  console.log();
  console.log(chalk.cyan("════════════════════════════════════════════"));
  console.log(chalk.cyan.bold("   NEC 2026 Recruitment Mail Sender"));
  console.log(chalk.cyan("════════════════════════════════════════════"));
  console.log();
  console.log(
    chalk.dim(`  Transport : ${getTransportName()}`)
  );
  console.log(
    chalk.dim(`  Club      : ${CLUB}`)
  );
  console.log();
}

function divider() {
  console.log(chalk.dim("────────────────────────────────────────────"));
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Shared flows ─────────────────────────────────────────────────

async function selectTemplate() {
  const templates = await listTemplates();
  if (templates.length > 1) {
    const { chosenTemplate } = await inquirer.prompt([
      {
        type: "list",
        name: "chosenTemplate",
        message: chalk.white.bold("Select email template:"),
        choices: templates,
        default: "shortlisted",
      },
    ]);
    return chosenTemplate;
  }
  console.log(chalk.dim(`  Template  : ${templates[0]}.html\n`));
  return templates[0];
}

// ── Single email flow ────────────────────────────────────────────

async function handleSingleEmail(templateName) {
  const { recipientName } = await inquirer.prompt([
    {
      type: "input",
      name: "recipientName",
      message: chalk.white.bold("Recipient Name:"),
      validate: (input) => {
        const result = validateName(input);
        return result.valid || chalk.red(result.reason);
      },
    },
  ]);

  const { recipientEmail } = await inquirer.prompt([
    {
      type: "input",
      name: "recipientEmail",
      message: chalk.white.bold("Recipient Email:"),
      validate: (input) => {
        const result = validateEmail(input);
        return result.valid || chalk.red(result.reason);
      },
    },
  ]);

  const { domain } = await inquirer.prompt([
    {
      type: "input",
      name: "domain",
      message: chalk.white.bold("Domain (e.g. Marketing, Technical):"),
      default: "Technical",
    },
  ]);

  const { designation } = await inquirer.prompt([
    {
      type: "input",
      name: "designation",
      message: chalk.white.bold("Designation (e.g. Manager, Member):"),
      default: "Member",
    },
  ]);

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const html = await loadTemplate(templateName, {
    name: recipientName.trim(),
    date: today,
    club: CLUB,
    domain: domain.trim(),
    designation: designation.trim(),
  });

  const { wantPreview } = await inquirer.prompt([
    {
      type: "confirm",
      name: "wantPreview",
      message: chalk.white.bold("Preview email in terminal?"),
      default: true,
    },
  ]);

  if (wantPreview) {
    console.log();
    divider();
    console.log(chalk.yellow.bold(`  Subject: ${SUBJECT}`));
    console.log(chalk.yellow.bold(`  To:      ${recipientName.trim()} <${recipientEmail.trim()}>`));
    divider();
    console.log(chalk.white(stripHtml(html)));
    divider();
    console.log();
  }

  const { confirmSend } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmSend",
      message: chalk.white.bold("Send this email?"),
      default: false,
    },
  ]);

  if (!confirmSend) {
    console.log(chalk.yellow("\n⚠  Send cancelled by user.\n"));
    return;
  }

  const spinner = ora({
    text: chalk.dim("Sending email…"),
    spinner: "dots",
  }).start();

  try {
    await sendEmail({
      to: recipientEmail.trim(),
      subject: SUBJECT,
      html,
    });

    spinner.succeed(chalk.green.bold("Email sent successfully!"));
    await logSend({
      name: recipientName.trim(),
      email: recipientEmail.trim(),
      status: "SUCCESS",
    });
  } catch (err) {
    spinner.fail(chalk.red.bold("Failed to send email."));
    console.log(chalk.red(`\n  Error: ${err.message}\n`));
    await logSend({
      name: recipientName.trim(),
      email: recipientEmail.trim(),
      status: "FAILED",
      error: err.message,
    });
  }

  console.log();
  divider();
  console.log(chalk.dim(`  Logged to logs/sent.log`));
  divider();
  console.log();
}

// ── Bulk email flow ──────────────────────────────────────────────

async function handleBulkEmail(templateName) {
  const { excelPath } = await inquirer.prompt([
    {
      type: "input",
      name: "excelPath",
      message: chalk.white.bold("File path (e.g. ./candidates.xlsx or .pdf):"),
      validate: (input) => input.trim().length > 0 || "Please enter a valid path.",
    },
  ]);

  let parsedData;
  try {
    if (excelPath.trim().toLowerCase().endsWith('.pdf')) {
      parsedData = await readPdf(excelPath);
    } else {
      parsedData = readSpreadsheet(excelPath);
    }
  } catch (err) {
    console.log(chalk.red(`\n✖  ${err.message}\n`));
    return;
  }

  console.log();
  divider();
  console.log(chalk.cyan.bold("  File Parsed"));
  console.log(`  Total Rows   : ${parsedData.totalRows}`);
  console.log(`  Valid Rows   : ${chalk.green(parsedData.candidates.length)}`);
  console.log(`  Skipped Rows : ${chalk.yellow(parsedData.skipped.length)}`);
  console.log(`  Duplicates   : ${chalk.yellow(parsedData.duplicates.length)}`);
  divider();

  if (parsedData.skipped.length > 0) {
    console.log(chalk.yellow.bold("\n  Skipped Rows:"));
    for (const skip of parsedData.skipped) {
      console.log(
        chalk.dim(`  Row ${skip.row}: `) +
        chalk.yellow(skip.reason)
      );
    }
  }

  if (parsedData.duplicates.length > 0) {
    console.log(chalk.yellow.bold("\n  Duplicate Emails Ignored:"));
    for (const dup of parsedData.duplicates) {
      console.log(
        chalk.dim(`  Row ${dup.row}: `) +
        chalk.yellow(`${dup.collegeEmail} (${dup.name})`)
      );
    }
  }

  if (parsedData.candidates.length === 0) {
    console.log(chalk.red("\n✖  No valid candidates found to email.\n"));
    return;
  }

  const { runMode } = await inquirer.prompt([
    {
      type: "list",
      name: "runMode",
      message: chalk.white.bold("How would you like to proceed?"),
      choices: [
        { name: "Preview Only (No Emails Sent)", value: "dry" },
        { name: "Send Emails (Live)", value: "live" },
        { name: "Cancel", value: "cancel" },
      ],
    },
  ]);

  if (runMode === "cancel") {
    console.log(chalk.yellow("\n⚠  Bulk send cancelled.\n"));
    return;
  }

  const isDryRun = runMode === "dry";

  const results = await sendBulkEmails({
    candidates: parsedData.candidates,
    templateName,
    subject: SUBJECT,
    club: CLUB,
    dryRun: isDryRun,
    delayMs: 1500, // wait 1.5s between sends
  });

  console.log();
  divider();
  if (isDryRun) {
    console.log(chalk.cyan.bold("  Dry Run Completed"));
    console.log(`  Would send: ${chalk.green(results.sent)}`);
  } else {
    console.log(chalk.cyan.bold("  Bulk Email Completed"));
    console.log(`  Total Evaluated : ${parsedData.totalRows}`);
    console.log(`  Successfully Sent : ${chalk.green(results.sent)}`);
    if (results.failed.length > 0) {
      console.log(`  Failed            : ${chalk.red(results.failed.length)}`);
    }
    const totalSkipped = parsedData.skipped.length + parsedData.duplicates.length;
    if (totalSkipped > 0) {
      console.log(`  Skipped           : ${chalk.yellow(totalSkipped)}`);
    }
  }
  divider();
  console.log();
}

function promptMultiLine(message) {
  console.log(message);
  console.log(chalk.dim("  (Paste candidate details. Type 'SEND' on a new line and press Enter to finish)\n"));
  
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    let lines = [];
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.toUpperCase() === "SEND") {
        rl.close();
      } else {
        lines.push(line);
      }
    });
    
    rl.on("close", () => {
      resolve(lines.join("\n"));
    });
  });
}

function parsePastedCandidates(text, domain, designation) {
  const lines = text.split(/\r?\n/);
  const candidates = [];
  const skipped = [];
  const seenEmails = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Matches: Name - email, college_email, ...
    const match = line.match(/^([^-]+)\s+-\s+(.+)$/);
    if (!match) {
      skipped.push({
        row: i + 1,
        content: line,
        reason: "Format mismatch (missing ' - ' separator)",
      });
      continue;
    }

    const rawName = match[1].trim();
    const rest = match[2].split(",").map((s) => s.trim());

    if (rest.length < 2) {
      skipped.push({
        row: i + 1,
        content: line,
        reason: "Missing personal or college email (need at least 2 comma-separated fields)",
      });
      continue;
    }

    const personalEmail = rest[0];
    const collegeEmail = rest[1];

    // Validate name
    const nameCheck = validateName(rawName);
    if (!nameCheck.valid) {
      skipped.push({
        row: i + 1,
        content: line,
        reason: nameCheck.reason,
      });
      continue;
    }

    // Validate emails
    const personalCheck = validateEmail(personalEmail);
    if (!personalCheck.valid) {
      skipped.push({
        row: i + 1,
        content: line,
        reason: `Personal email: ${personalCheck.reason}`,
      });
      continue;
    }

    const collegeCheck = validateEmail(collegeEmail);
    if (!collegeCheck.valid) {
      skipped.push({
        row: i + 1,
        content: line,
        reason: `College email: ${collegeCheck.reason}`,
      });
      continue;
    }

    const emailLower = collegeEmail.toLowerCase();
    if (seenEmails.has(emailLower)) {
      skipped.push({
        row: i + 1,
        content: line,
        reason: `Duplicate college email: ${collegeEmail}`,
      });
      continue;
    }

    seenEmails.add(emailLower);
    candidates.push({
      row: i + 1,
      name: rawName,
      personalEmail,
      collegeEmail,
      domain,
      designation,
    });
  }

  return { candidates, skipped };
}

async function handlePasteEmail(templateName) {
  const { domain } = await inquirer.prompt([
    {
      type: "input",
      name: "domain",
      message: chalk.white.bold("Domain (e.g. Marketing, Technical):"),
      default: "Marketing & Community",
    },
  ]);

  const { designation } = await inquirer.prompt([
    {
      type: "input",
      name: "designation",
      message: chalk.white.bold("Designation (e.g. Manager, Member):"),
      default: "Member",
    },
  ]);

  const rawText = await promptMultiLine(chalk.white.bold("Paste candidate details:"));
  const parsedData = parsePastedCandidates(rawText, domain.trim(), designation.trim());

  console.log();
  divider();
  console.log(chalk.cyan.bold("  Pasted Input Parsed"));
  console.log(`  Valid Candidates : ${chalk.green(parsedData.candidates.length)}`);
  console.log(`  Skipped/Invalid  : ${chalk.yellow(parsedData.skipped.length)}`);
  divider();

  if (parsedData.skipped.length > 0) {
    console.log(chalk.yellow.bold("\n  Skipped Rows:"));
    for (const skip of parsedData.skipped) {
      console.log(
        chalk.dim(`  Line ${skip.row}: `) +
        chalk.yellow(`${skip.reason} (Content: "${skip.content}")`)
      );
    }
  }

  if (parsedData.candidates.length === 0) {
    console.log(chalk.red("\n✖  No valid candidates found in pasted input.\n"));
    return;
  }

  const { runMode } = await inquirer.prompt([
    {
      type: "list",
      name: "runMode",
      message: chalk.white.bold("How would you like to proceed?"),
      choices: [
        { name: "Preview Only (No Emails Sent)", value: "dry" },
        { name: "Send Emails (Live)", value: "live" },
        { name: "Cancel", value: "cancel" },
      ],
    },
  ]);

  if (runMode === "cancel") {
    console.log(chalk.yellow("\n⚠  Send cancelled.\n"));
    return;
  }

  const isDryRun = runMode === "dry";

  const results = await sendBulkEmails({
    candidates: parsedData.candidates,
    templateName,
    subject: SUBJECT,
    club: CLUB,
    dryRun: isDryRun,
    delayMs: 1500, // wait 1.5s between sends
  });

  console.log();
  divider();
  if (isDryRun) {
    console.log(chalk.cyan.bold("  Dry Run Completed"));
    console.log(`  Would send: ${chalk.green(results.sent)}`);
  } else {
    console.log(chalk.cyan.bold("  Sending Completed"));
    console.log(`  Successfully Sent : ${chalk.green(results.sent)}`);
    if (results.failed.length > 0) {
      console.log(`  Failed            : ${chalk.red(results.failed.length)}`);
    }
  }
  divider();
  console.log();
}

// ── Main menu ────────────────────────────────────────────────────

async function main() {
  banner();

  if (getTransportName() === "None") {
    console.log(chalk.red.bold("✖ No email transport configured.\n"));
    console.log(
      chalk.yellow(
        "  Set RESEND_API_KEY in your .env for the Resend API,\n" +
        "  or provide SMTP_HOST / SMTP_USER / SMTP_PASS for SMTP.\n"
      )
    );
    process.exit(1);
  }

  const { flow } = await inquirer.prompt([
    {
      type: "list",
      name: "flow",
      message: chalk.white.bold("Select mode:"),
      choices: [
        { name: "1. Send Single Email", value: "single" },
        { name: "2. Send Bulk Emails from Excel/PDF", value: "bulk" },
        { name: "3. Paste Raw Candidate Details", value: "paste" },
      ],
    },
  ]);

  const templateName = await selectTemplate();

  if (flow === "single") {
    await handleSingleEmail(templateName);
  } else if (flow === "bulk") {
    await handleBulkEmail(templateName);
  } else if (flow === "paste") {
    await handlePasteEmail(templateName);
  }

  const { sendAnother } = await inquirer.prompt([
    {
      type: "confirm",
      name: "sendAnother",
      message: chalk.white.bold("Return to main menu?"),
      default: false,
    },
  ]);

  if (sendAnother) {
    console.log();
    await main();
  } else {
    console.log(chalk.cyan("\n👋  Goodbye!\n"));
  }
}

// ── Entry ────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(chalk.red(`\nFatal error: ${err.message}\n`));
  process.exit(1);
});

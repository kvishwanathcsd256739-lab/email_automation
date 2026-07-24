/**
 * bulkSender.js — Sequential bulk email sender
 *
 * Reads parsed candidate data and sends emails one-by-one with
 * configurable throttle delay, progress reporting, and logging.
 *
 * Supports dry-run mode (validate without sending).
 */

import chalk from "chalk";
import ora from "ora";
import { loadTemplate } from "./template.js";
import { sendEmail } from "./mail.js";
import { logBulkSend } from "./logger.js";
import { writeFailedSpreadsheet } from "./excel.js";

/**
 * Pauses execution for the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends personalized emails to a list of candidates sequentially.
 *
 * @param {object} options
 * @param {Array<{ row: number, name: string, collegeEmail: string }>} options.candidates
 * @param {string} options.templateName — template file name (without .html)
 * @param {string} options.subject — email subject line
 * @param {string} options.club — club name for template placeholder
 * @param {boolean} [options.dryRun=false] — if true, skip actual sending
 * @param {number} [options.delayMs=1500] — ms to wait between sends
 * @returns {Promise<{ sent: number, failed: Array, total: number }>}
 */
export async function sendBulkEmails({
  candidates,
  templateName,
  subject,
  club,
  dryRun = false,
  delayMs = 1500,
}) {
  const total = candidates.length;
  const failed = [];
  let sent = 0;

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Generate the log file name for this bulk run
  const dateStamp = new Date().toISOString().split("T")[0];
  const logFile = `bulk-send-${dateStamp}.log`;

  console.log();

  for (let i = 0; i < total; i++) {
    const candidate = candidates[i];
    const progress = `[${i + 1}/${total}]`;

    // ── Render template for this candidate ─────────────────────
    const html = await loadTemplate(templateName, {
      name: candidate.name,
      date: today,
      club,
      domain: candidate.domain || "",
      designation: candidate.designation || "",
    });

    if (dryRun) {
      // Dry run — just show what would happen
      console.log(
        chalk.dim(`${progress}`) +
        chalk.white(` ${candidate.name}`) +
        chalk.dim(` → ${candidate.collegeEmail}`) +
        chalk.yellow("  [DRY RUN]")
      );
      sent++;
      continue;
    }

    // ── Send ───────────────────────────────────────────────────
    if (!candidate.personalEmail) {
      console.log(
        chalk.yellow(`  ⚠  Skipping ${candidate.name} (Row ${candidate.row}) — No valid personal email found.`)
      );
      continue; // Skip because they already got it on their college email
    }

    const spinner = ora({
      text:
        chalk.dim(`${progress} `) +
        chalk.white(`Sending to ${candidate.name}`) +
        chalk.dim(` <${candidate.personalEmail}>…`),
      spinner: "dots",
    }).start();

    try {
      await sendEmail({
        to: candidate.personalEmail,
        subject,
        html,
      });

      spinner.succeed(
        chalk.dim(`${progress} `) +
        chalk.green(`Sent to ${candidate.name}`) +
        chalk.dim(` <${candidate.personalEmail}>`)
      );

      sent++;

      // Log success
      await logBulkSend(logFile, {
        name: candidate.name,
        email: candidate.collegeEmail,
        status: "SUCCESS",
      });
    } catch (err) {
      spinner.fail(
        chalk.dim(`${progress} `) +
        chalk.red(`Failed: ${candidate.name}`) +
        chalk.dim(` <${candidate.collegeEmail}>`) +
        chalk.red(` — ${err.message}`)
      );

      failed.push({
        name: candidate.name,
        collegeEmail: candidate.collegeEmail,
        reason: err.message,
      });

      // Log failure
      await logBulkSend(logFile, {
        name: candidate.name,
        email: candidate.collegeEmail,
        status: "FAILED",
        error: err.message,
      });
    }

    // ── Throttle between sends ─────────────────────────────────
    if (i < total - 1) {
      await sleep(delayMs);
    }
  }

  // ── Write failed.xlsx if there were failures ─────────────────
  if (failed.length > 0 && !dryRun) {
    try {
      writeFailedSpreadsheet("./failed.xlsx", failed);
      console.log(
        chalk.yellow(`\n  ⚠  ${failed.length} failed email(s) saved to failed.xlsx`)
      );
    } catch (err) {
      console.log(
        chalk.red(`\n  ✖  Could not write failed.xlsx: ${err.message}`)
      );
    }
  }

  return { sent, failed, total };
}

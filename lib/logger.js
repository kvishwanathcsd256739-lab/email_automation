/**
 * logger.js — File-based send log
 *
 * Appends a structured line to logs/sent.log after every send
 * attempt so there's a persistent audit trail.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "..", "logs");
const LOG_FILE = join(LOGS_DIR, "sent.log");

/**
 * Ensures the logs/ directory exists.
 */
async function ensureLogsDir() {
  await mkdir(LOGS_DIR, { recursive: true });
}

/**
 * Appends a send-attempt entry to the log file.
 *
 * Format:  [ISO-TIMESTAMP] | STATUS | name <email>
 *
 * @param {{ name: string, email: string, status: "SUCCESS" | "FAILED", error?: string }} entry
 */
export async function logSend(entry) {
  await ensureLogsDir();

  const timestamp = new Date().toISOString();
  const statusTag = entry.status === "SUCCESS" ? "SUCCESS" : "FAILED";
  const errorPart = entry.error ? ` | Error: ${entry.error}` : "";

  const line = `[${timestamp}] | ${statusTag} | ${entry.name} <${entry.email}>${errorPart}\n`;

  await appendFile(LOG_FILE, line, "utf-8");
}

/**
 * Appends a send-attempt entry to a specific bulk log file.
 *
 * @param {string} filename — e.g. "bulk-send-2026-07-18.log"
 * @param {{ name: string, email: string, status: "SUCCESS" | "FAILED", error?: string }} entry
 */
export async function logBulkSend(filename, entry) {
  await ensureLogsDir();

  const timestamp = new Date().toISOString();
  const statusTag = entry.status === "SUCCESS" ? "SUCCESS" : "FAILED";
  const errorPart = entry.error ? ` | Error: ${entry.error}` : "";

  const line = `[${timestamp}] | ${statusTag} | ${entry.name} <${entry.email}>${errorPart}\n`;

  await appendFile(join(LOGS_DIR, filename), line, "utf-8");
}

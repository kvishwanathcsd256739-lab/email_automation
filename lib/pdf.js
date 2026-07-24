/**
 * pdf.js — PDF data extractor
 *
 * Reads .pdf files and attempts to extract candidate rows.
 * Designed to parse tabular PDF exports where each row contains
 * a Name and one or more Emails.
 */

import fs from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import { validateEmail, validateName } from "./validate.js";

/**
 * Reads a PDF file and extracts candidates using heuristic text parsing.
 *
 * @param {string} filePath — path to the .pdf file
 * @returns {Promise<{ candidates: Array, skipped: Array, duplicates: Array, totalRows: number }>}
 */
export async function readPdf(filePath) {
  const absPath = resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`PDF not found: ${absPath}`);
  }

  const dataBuffer = fs.readFileSync(absPath);
  
  let data;
  try {
    const parser = new PDFParse({ data: dataBuffer });
    data = await parser.getText();
    await parser.destroy();
  } catch (err) {
    throw new Error(`Failed to read PDF: ${err.message}`);
  }

  const text = data.text;
  const lines = text.split(/\r?\n/);

  const candidates = [];
  const skipped = [];
  const duplicates = [];
  const seenEmails = new Set();
  
  // Basic email regex
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  
  let rowIndex = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Find all emails in the line
    const emails = [];
    let match;
    // Reset regex state just in case
    emailRegex.lastIndex = 0;
    while ((match = emailRegex.exec(trimmedLine)) !== null) {
      emails.push(match[1]);
    }

    if (emails.length === 0) {
      // Not a candidate row if no email exists
      continue;
    }

    rowIndex++;

    // Assume the string before the first email is the Name
    const firstEmailIndex = trimmedLine.indexOf(emails[0]);
    const rawName = trimmedLine.substring(0, firstEmailIndex).trim();

    // If multiple emails, assume the last one is the college email (based on table column order)
    // Alternatively, if one has an institutional domain it's the college one, but this is a safe heuristic.
    const rawEmail = emails[emails.length - 1];

    // Validate name
    const nameCheck = validateName(rawName);
    if (!nameCheck.valid) {
      skipped.push({
        row: rowIndex,
        name: rawName || undefined,
        email: rawEmail || undefined,
        reason: `(PDF) ${nameCheck.reason}`,
      });
      continue;
    }

    // Validate email
    const emailCheck = validateEmail(rawEmail);
    if (!emailCheck.valid) {
      skipped.push({
        row: rowIndex,
        name: rawName,
        email: rawEmail || undefined,
        reason: `Invalid college email${rawEmail ? `: ${rawEmail}` : ""}`,
      });
      continue;
    }

    // Duplicate check
    const emailLower = rawEmail.toLowerCase();
    if (seenEmails.has(emailLower)) {
      duplicates.push({ row: rowIndex, name: rawName, collegeEmail: rawEmail });
      continue;
    }

    seenEmails.add(emailLower);
    candidates.push({ row: rowIndex, name: rawName, collegeEmail: rawEmail, domain: "", designation: "" });
  }

  if (rowIndex === 0) {
    throw new Error("PDF does not contain any recognizable candidate rows with emails.");
  }

  return {
    candidates,
    skipped,
    duplicates,
    totalRows: rowIndex,
  };
}

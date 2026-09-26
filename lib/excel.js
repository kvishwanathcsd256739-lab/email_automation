/**
 * excel.js — Excel spreadsheet reader
 *
 * Reads .xlsx files and extracts candidate rows with Name and College Email.
 * Handles:
 *   - Column name normalization (case-insensitive, trimmed)
 *   - Row validation (name + college email)
 *   - Duplicate email detection
 *   - Detailed skip/error reporting
 */

import { createRequire } from "node:module";
const XLSX = createRequire(import.meta.url)("xlsx");
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateEmail, validateName } from "./validate.js";

/**
 * Normalizes a column header to a lowercase, trimmed key.
 * Maps common variations to canonical keys.
 *
 * @param {string} header — raw column header from the spreadsheet
 * @returns {string} canonical key
 */
function normalizeHeader(header) {
  if (!header || typeof header !== "string") return "";

  const h = header.trim().toLowerCase();

  // Smart matching for verbose headers (like Google Forms)
  if (h.includes("college email") || h.includes("institutional email")) {
    return "collegeEmail";
  }
  if (h.includes("personal email")) {
    return "personalEmail";
  }
  // Match "name" but ensure it's not picking up something weird
  if (h.includes("name") && !h.includes("college") && !h.includes("club")) {
    return "name";
  }

  // Domain / Designation mapping
  if (h === "domain" || h === "dept" || h === "department") {
    return "domain";
  }
  if (h === "designation" || h === "role" || h === "position" || h === "post") {
    return "designation";
  }

  // Fallback to strict mappings
  const mappings = {
    name: "name",
    email: "personalEmail",
    "email id": "personalEmail",
    domain: "domain",
    designation: "designation",
  };

  return mappings[h] || h;
}

/**
 * Reads an Excel file and returns parsed, validated candidate data.
 *
 * @param {string} filePath — path to the .xlsx file
 * @param {object} [options]
 * @param {string} [options.sheetName] — specific sheet name (defaults to first sheet)
 * @returns {{ candidates: Array, skipped: Array, duplicates: Array, totalRows: number }}
 *
 * Each candidate:  { row: number, name: string, collegeEmail: string }
 * Each skipped:    { row: number, name?: string, email?: string, reason: string }
 * Each duplicate:  { row: number, name: string, collegeEmail: string }
 */
export function readSpreadsheet(filePath, options = {}) {
  const absPath = resolve(filePath);

  // ── File existence ─────────────────────────────────────────────
  if (!existsSync(absPath)) {
    throw new Error(`Spreadsheet not found: ${absPath}`);
  }

  // ── Read workbook ──────────────────────────────────────────────
  let workbook;
  try {
    workbook = XLSX.readFile(absPath);
  } catch (err) {
    throw new Error(`Failed to read spreadsheet: ${err.message}`);
  }

  // ── Select sheet ───────────────────────────────────────────────
  const sheetName = options.sheetName || workbook.SheetNames[0];

  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(
      `Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(", ")}`
    );
  }

  const sheet = workbook.Sheets[sheetName];

  // ── Parse to JSON ──────────────────────────────────────────────
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (rawRows.length === 0) {
    throw new Error("Spreadsheet is empty — no data rows found.");
  }

  // ── Detect columns ────────────────────────────────────────────
  const rawHeaders = Object.keys(rawRows[0]);
  const headerMap = {};

  for (const rawHeader of rawHeaders) {
    const normalized = normalizeHeader(rawHeader);
    headerMap[normalized] = rawHeader;
  }

  if (!headerMap.name) {
    throw new Error(
      `Missing "Name" column. Found columns: ${rawHeaders.join(", ")}`
    );
  }

  if (!headerMap.collegeEmail) {
    throw new Error(
      `Missing "College Email" column. Found columns: ${rawHeaders.join(", ")}`
    );
  }

  // ── Process rows ───────────────────────────────────────────────
  const candidates = [];
  const skipped = [];
  const duplicates = [];
  const seenEmails = new Set();

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rowNum = i + 2; // +2 because row 1 is the header in Excel

    const rawName = String(row[headerMap.name] || "").trim();
    const rawCollegeEmail = String(row[headerMap.collegeEmail] || "").trim();
    const rawPersonalEmail = headerMap.personalEmail ? String(row[headerMap.personalEmail] || "").trim() : undefined;
    const rawDomain = headerMap.domain ? String(row[headerMap.domain] || "").trim() : "";
    const rawDesignation = headerMap.designation ? String(row[headerMap.designation] || "").trim() : "";

    // Validate name
    const nameCheck = validateName(rawName);
    if (!nameCheck.valid) {
      skipped.push({
        row: rowNum,
        name: rawName || undefined,
        email: rawCollegeEmail || undefined,
        reason: nameCheck.reason,
      });
      continue;
    }

    // Validate email
    const emailCheck = validateEmail(rawCollegeEmail);
    if (!emailCheck.valid) {
      skipped.push({
        row: rowNum,
        name: rawName,
        email: rawCollegeEmail || undefined,
        reason: `Invalid college email${rawCollegeEmail ? `: ${rawCollegeEmail}` : ""}`,
      });
      continue;
    }

    // Validate personal email optionally
    let finalPersonalEmail = undefined;
    if (rawPersonalEmail) {
      const personalCheck = validateEmail(rawPersonalEmail);
      if (personalCheck.valid) finalPersonalEmail = rawPersonalEmail;
    }

    // Duplicate check (case-insensitive)
    const emailLower = rawCollegeEmail.toLowerCase();
    if (seenEmails.has(emailLower)) {
      duplicates.push({ row: rowNum, name: rawName, collegeEmail: rawCollegeEmail });
      continue;
    }

    seenEmails.add(emailLower);
    candidates.push({ 
      row: rowNum, 
      name: rawName, 
      collegeEmail: rawCollegeEmail,
      personalEmail: finalPersonalEmail,
      domain: rawDomain,
      designation: rawDesignation
    });
  }

  return {
    candidates,
    skipped,
    duplicates,
    totalRows: rawRows.length,
  };
}

/**
 * Writes a list of failed entries to a .xlsx file for retry.
 *
 * @param {string} filePath — output path (e.g. "./failed.xlsx")
 * @param {Array<{ name: string, collegeEmail: string, reason: string }>} entries
 */
export function writeFailedSpreadsheet(filePath, entries) {
  const data = entries.map((e) => ({
    Name: e.name,
    "College Email": e.collegeEmail,
    Reason: e.reason,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Failed");
  XLSX.writeFile(wb, resolve(filePath));
}

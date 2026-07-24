/**
 * template.js — Template engine
 *
 * Loads HTML files from the templates/ directory and replaces
 * {{placeholder}} tokens with the supplied data object.
 *
 * Adding a new template is as simple as dropping an HTML file
 * into templates/ and calling loadTemplate('filename').
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates");

/**
 * Loads and renders an HTML template.
 *
 * @param {string} templateName  — filename without extension (e.g. "shortlisted")
 * @param {Record<string, string>} data — key-value map of placeholders
 * @returns {Promise<string>} rendered HTML string
 */
export async function loadTemplate(templateName, data = {}) {
  const filePath = join(TEMPLATES_DIR, `${templateName}.html`);

  let html;
  try {
    html = await readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Template "${templateName}" not found at ${filePath}`);
    }
    throw err;
  }

  // Replace every {{key}} with the corresponding value from `data`
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    html = html.replace(regex, value);
  }

  return html;
}

/**
 * Lists all available template names (filenames without .html extension).
 *
 * @returns {Promise<string[]>}
 */
export async function listTemplates() {
  const files = await readdir(TEMPLATES_DIR);
  return files
    .filter((f) => f.endsWith(".html"))
    .map((f) => basename(f, ".html"));
}

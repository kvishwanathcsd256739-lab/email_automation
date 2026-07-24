/**
 * validate.js — Input validation utilities
 *
 * Centralizes all input validation so the rest of the app can
 * stay focused on business logic rather than guard clauses.
 */

import validator from "validator";

/**
 * Validates an email address.
 *
 * @param {string} email
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateEmail(email) {
  if (!email || typeof email !== "string") {
    return { valid: false, reason: "Email address is required." };
  }

  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: "Email address cannot be empty." };
  }

  if (!validator.isEmail(trimmed)) {
    return { valid: false, reason: `"${trimmed}" is not a valid email address.` };
  }

  return { valid: true };
}

/**
 * Validates a recipient name.
 *
 * @param {string} name
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateName(name) {
  if (!name || typeof name !== "string") {
    return { valid: false, reason: "Recipient name is required." };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: "Recipient name cannot be empty." };
  }

  if (trimmed.length < 2) {
    return { valid: false, reason: "Name must be at least 2 characters." };
  }

  if (trimmed.length > 100) {
    return { valid: false, reason: "Name must be 100 characters or fewer." };
  }

  return { valid: true };
}

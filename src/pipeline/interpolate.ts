/**
 * @module src/pipeline/interpolate — Template variable construction and string interpolation for hook commands.
 */
import type { Ticket } from "../providers/types.ts";

export type TaskVars = {
  /** Ticket identifier, e.g. "ENG-123". Token: `{id}`. */
  id: string;
  /** Slugified ticket title. Token: `{title}`. */
  title: string;
  /** Sanitized ticket title with shell-unsafe chars removed. Token: `{raw_title}`. */
  raw_title: string;
  /** Git branch name, e.g. "agent/task-ENG-123". Token: `{branch}`. */
  branch: string;
  /** Absolute path to the worktree directory. Token: `{worktree}`. */
  worktree: string;
};

/** Additional runtime-only token: `{date}` (current ISO 8601 timestamp). See {@link interpolate}. */

/**
 * Converts text to a URL-safe slug: lowercase, replaces non-alphanumeric chars with hyphens,
 * trims leading/trailing hyphens.
 * @param text - The text to slugify.
 * @returns The slugified string.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Removes shell-unsafe characters (single quotes, backticks, dollar signs, backslashes) from text.
 * @param text - The text to sanitize.
 * @returns The sanitized string.
 */
export function sanitizeTitle(text: string): string {
  return text.replace(/['`$\\]/g, "");
}

/**
 * Constructs TaskVars from a Ticket.
 * @param ticket - The ticket to derive variables from.
 * @param worktree - Absolute path to the worktree directory (defaults to empty string).
 * @param branchTemplate - Branch name template with `{id}` token (defaults to `"agent/task-{id}"`).
 * @returns The populated TaskVars.
 */
export function buildTaskVars(ticket: Ticket, worktree = "", branchTemplate = "agent/task-{id}"): TaskVars {
  return {
    id: ticket.identifier,
    title: slugify(ticket.title),
    raw_title: sanitizeTitle(ticket.title),
    branch: branchTemplate.replace("{id}", ticket.identifier),
    worktree,
  };
}

/**
 * Replaces template tokens in a string with their corresponding values.
 * Supported tokens: `{id}`, `{title}`, `{raw_title}`, `{branch}`, `{worktree}`, `{date}` (current ISO timestamp).
 * @param template - The string containing template tokens.
 * @param vars - The template variable values.
 * @returns The interpolated string.
 */
export function interpolate(template: string, vars: TaskVars): string {
  return template
    .replaceAll("{id}", vars.id)
    .replaceAll("{title}", vars.title)
    .replaceAll("{raw_title}", vars.raw_title)
    .replaceAll("{branch}", vars.branch)
    .replaceAll("{worktree}", vars.worktree)
    .replaceAll("{date}", new Date().toISOString());
}

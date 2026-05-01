/** @module src/format — Terminal formatting utilities (colors, splash banner, log line formatting) */
const esc = (code: string) => `\x1b[${code}m`;
const reset = esc("0");

/**
 * ANSI color escape functions. Each wraps text in the appropriate escape
 * code and resets. Functions: bold, dim, red, green, yellow, blue, cyan, gray.
 */
export const colors = {
  bold: (s: string) => `${esc("1")}${s}${reset}`,
  dim: (s: string) => `${esc("2")}${s}${reset}`,
  red: (s: string) => `${esc("31")}${s}${reset}`,
  green: (s: string) => `${esc("32")}${s}${reset}`,
  yellow: (s: string) => `${esc("33")}${s}${reset}`,
  blue: (s: string) => `${esc("34")}${s}${reset}`,
  cyan: (s: string) => `${esc("36")}${s}${reset}`,
  gray: (s: string) => `${esc("90")}${s}${reset}`,
};

/** Whether stdout is a TTY. Used to switch between human-readable and JSON log output. */
export const isTTY = process.stdout.isTTY === true;

/**
 * Prints a boxed banner to the terminal. No-op if not a TTY.
 * @param subtitle - text to display below the title
 */
export function printSplash(subtitle: string): void {
  if (!isTTY) return;

  const title = `Agent Worker`;
  const width = Math.max(title.length, subtitle.length) + 4;

  const top = `  ╔${"═".repeat(width)}╗`;
  const bot = `  ╚${"═".repeat(width)}╝`;
  const pad = (text: string, visibleLen: number) =>
    `  ║  ${text}${" ".repeat(width - visibleLen - 2)}║`;

  console.log("");
  console.log(colors.cyan(top));
  console.log(colors.cyan(pad(`${esc("1")}${title}${esc("22")}`, title.length)));
  console.log(colors.cyan(pad(subtitle, subtitle.length)));
  console.log(colors.cyan(bot));
  console.log("");
}

const levelColors: Record<string, (s: string) => string> = {
  debug: colors.gray,
  info: colors.blue,
  warn: colors.yellow,
  error: colors.red,
};

/**
 * Formats a log line for terminal output. Includes timestamp, colored level
 * badge, optional component tag, and key=value context.
 * @param level - log level string (debug, info, warn, error)
 * @param msg - log message
 * @param ctx - optional key-value context
 * @returns formatted string
 */
export function formatConsoleLine(
  level: string,
  msg: string,
  ctx?: Record<string, unknown>
): string {
  const time = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Component tag (e.g. [provider:linear])
  const component = ctx?.component as string | undefined;

  // Special case: bare executor stream output lines (component tag identifies the executor; message is always "stream")
  const executorComponents = ["claude", "codex", "docker", "opencode", "pi"];
  if (component && executorComponents.includes(component) && ctx?.line !== undefined) {
    return `  ${colors.dim("│")} ${ctx.line}`;
  }

  const colorFn = levelColors[level] ?? colors.gray;
  const badge = colorFn(level.toUpperCase().padEnd(5));

  const componentTag = component ? `${colors.cyan(`[${component}]`)} ` : "";

  // Exclude component from the context key=value pairs
  const ctxWithoutComponent = ctx ? Object.fromEntries(
    Object.entries(ctx).filter(([k]) => k !== "component")
  ) : undefined;

  let ctxStr = "";
  if (ctxWithoutComponent && Object.keys(ctxWithoutComponent).length > 0) {
    ctxStr =
      " " +
      colors.dim(
        Object.entries(ctxWithoutComponent)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")
      );
  }

  return `${colors.dim(time)}  ${badge}  ${componentTag}${msg}${ctxStr}`;
}

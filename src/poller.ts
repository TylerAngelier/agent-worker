/** @module src/poller — Long-running polling loop that periodically fetches ready tickets and dispatches them to a handler. */

import type { Ticket, TicketProvider } from "./providers/types.ts";
import { log as logOuter, time } from "./logger.ts";

/**
 * Creates an interruptible polling loop that periodically fetches ready tickets
 * and dispatches them to a handler.
 *
 * The loop runs until `stop()` is called. Each cycle fetches ready tickets
 * and, if any are found, invokes `onTicket` for the first one. Errors from
 * provider calls and the handler are caught and logged per-cycle; they do
 * not terminate the loop.
 *
 * @param options.provider - The ticket provider to poll for ready tickets.
 * @param options.intervalMs - Polling interval in milliseconds.
 * @param options.onTicket - Async callback invoked for each ready ticket.
 * @returns Object with `start()` (begins the poll loop) and `stop()` (sets a flag
 *   and wakes the sleep to break the loop).
 */
export function createPoller(options: {
  provider: TicketProvider;
  intervalMs: number;
  onTicket: (ticket: Ticket) => Promise<void>;
}): { start: () => Promise<void>; stop: () => void } {
  const log = logOuter.child("poller");
  let isRunning = false;
  let wakeSleep: (() => void) | null = null;
  let pollCount = 0;
  const startTime = Date.now();

  /**
   * Promise-based sleep that can be interrupted early by calling the returned
   * wake function. Used to make the poll loop responsive to `stop()` signals
   * without waiting for the full interval to elapse.
   *
   * @param ms - Duration to sleep in milliseconds.
   * @returns A promise that resolves when the timer expires or is woken early.
   */
  function interruptibleSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeSleep = null;
        resolve();
      }, ms);
      wakeSleep = () => {
        clearTimeout(timer);
        wakeSleep = null;
        resolve();
      };
    });
  }

  return {
    async start() {
      isRunning = true;
      while (isRunning) {
        pollCount++;
        const uptimeMs = Date.now() - startTime;
        const totalSeconds = Math.floor(uptimeMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const uptime = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        log.info(`Poll #${pollCount} (uptime: ${uptime}) — checking for tickets...`);
        try {
          const tickets = await time("poller.fetchReadyTickets", () =>
            options.provider.fetchReadyTickets(),
          );
          if (tickets.length > 0) {
            const ticket = tickets[0]!;
            log.info("Ticket found", {
              ticketId: ticket.identifier,
              title: ticket.title,
            });
            try {
              await time("poller.onTicket", () => options.onTicket(ticket));
            } catch (err) {
              log.error("onTicket handler failed", {
                ticketId: ticket.identifier,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } else {
            log.debug("No tickets found");
          }
        } catch (err) {
          log.error("Poll cycle failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        if (!isRunning) break;
        await interruptibleSleep(options.intervalMs);
      }
    },

    stop() {
      isRunning = false;
      wakeSleep?.();
    },
  };
}

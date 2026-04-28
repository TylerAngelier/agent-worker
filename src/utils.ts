/** @module src/utils — Shared utility functions */

/**
 * Creates an interruptible sleep that resolves after the specified duration,
 * but can be woken early by calling the returned `wake` function.
 *
 * Used by poll loops to remain responsive to `stop()` signals without waiting
 * for the full interval to elapse.
 *
 * @param ms - Duration to sleep in milliseconds.
 * @returns An object with a `promise` that resolves on timeout or wake, and a
 *   `wake` function to interrupt the sleep early.
 */
export function interruptibleSleep(ms: number): { promise: Promise<void>; wake: () => void } {
  let wake: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
  return { promise, wake: () => wake?.() };
}

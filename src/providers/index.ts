import type { TicketProvider } from "./types.ts";
import type { ProviderConfig } from "../config.ts";
import { createLinearProvider } from "./linear.ts";
import { createJiraProvider } from "./jira.ts";
import { createPlaneProvider } from "./plane.ts";

export function createProvider(config: ProviderConfig): TicketProvider {
  switch (config.type) {
    case "linear":
      return createLinearProvider(config);
    case "jira":
      return createJiraProvider(config);
    case "plane":
      return createPlaneProvider(config);
  }
}

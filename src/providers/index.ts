import type { TicketProvider } from "./types.ts";
import type { ProviderConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { createLinearProvider } from "./linear.ts";
import { createJiraProvider } from "./jira.ts";
import { createPlaneProvider } from "./plane.ts";

export function createProvider(config: ProviderConfig, logger?: Logger): TicketProvider {
  switch (config.type) {
    case "linear":
      return createLinearProvider(config, logger);
    case "jira":
      return createJiraProvider(config, logger);
    case "plane":
      return createPlaneProvider(config, logger);
  }
}

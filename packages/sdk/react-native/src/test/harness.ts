import { init as coreInit, type BugwatchClient, type BugwatchOptions, type ErrorEvent } from "@bugwatch/core";

/** Initialize the core client with events captured in memory instead of sent. */
export function startCapturingClient(options: Partial<BugwatchOptions> = {}): {
  client: BugwatchClient;
  events: ErrorEvent[];
} {
  const events: ErrorEvent[] = [];
  const client = coreInit({
    apiKey: "bw_test_key",
    offline: { enabled: false },
    ...options,
    beforeSend: (event) => {
      events.push(event);
      return null;
    },
  });
  return { client, events };
}

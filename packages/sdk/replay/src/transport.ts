import type { ReplaySegment } from "./types";

export class ReplayTransport {
  private endpoint: string;
  private apiKey: string;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  async sendSegment(segment: ReplaySegment): Promise<void> {
    const body = JSON.stringify({
      session_id: segment.sessionId,
      segment_index: segment.segmentIndex,
      data: segment.data,
      started_at: segment.startedAt,
      user_agent: segment.userAgent,
      screen_width: segment.screenWidth,
      screen_height: segment.screenHeight,
    });

    for (let attempt = 0; attempt <= 1; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      try {
        const response = await fetch(`${this.endpoint}/api/v1/replay/segments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
        });

        if (response.ok) return;
        if (response.status === 429 || response.status >= 500) continue;
        console.warn("[Bugwatch Replay] Failed to send segment:", response.status);
        return;
      } catch {
        if (attempt < 1) continue;
        // Network error after retry — silent drop
      }
    }
  }

  async finish(sessionId: string): Promise<void> {
    try {
      await fetch(`${this.endpoint}/api/v1/replay/finish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch {
      // Best-effort
    }
  }
}

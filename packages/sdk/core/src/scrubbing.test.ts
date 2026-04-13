import { describe, it, expect } from "vitest";
import { scrubEvent } from "./scrubbing";
import type { ErrorEvent } from "./types";

function makeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    event_id: "test-id",
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    message: "test",
    ...overrides,
  };
}

describe("scrubEvent", () => {
  it("masks sensitive keys in extra", () => {
    const event = makeEvent({ extra: { password: "hunter2", username: "alice" } });
    const result = scrubEvent(event, undefined);
    expect(result.extra?.password).toBe("[Filtered]");
    expect(result.extra?.username).toBe("alice");
  });

  it("masks token, api_key, authorization in headers", () => {
    const event = makeEvent({
      request: {
        url: "/api",
        headers: { authorization: "Bearer sk_live_abc", "content-type": "application/json" },
      },
    });
    const result = scrubEvent(event, undefined);
    expect(result.request?.headers?.authorization).toBe("[Filtered]");
    expect(result.request?.headers?.["content-type"]).toBe("application/json");
  });

  it("masks JWT in string values", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const event = makeEvent({ extra: { data: jwt } });
    const result = scrubEvent(event, undefined);
    expect(result.extra?.data).toBe("[Filtered]");
  });

  it("masks Luhn-valid credit cards but not random numbers", () => {
    const validCC = "4111 1111 1111 1111"; // Luhn-valid Visa
    const randomNum = "1234 5678 9012 3456"; // Luhn-invalid
    const event = makeEvent({ extra: { cc: validCC, ref: randomNum } });
    const result = scrubEvent(event, undefined);
    expect(result.extra?.cc).toBe("[Filtered]");
    expect(result.extra?.ref).toBe("1234 5678 9012 3456");
  });

  it("respects scrubEmails flag", () => {
    const event = makeEvent({ extra: { contact: "alice@example.com" } });
    const noScrub = scrubEvent(event, { scrubEmails: false });
    expect(noScrub.extra?.contact).toBe("alice@example.com");
    const withScrub = scrubEvent(event, { scrubEmails: true });
    expect(withScrub.extra?.contact).toBe("[Filtered]");
  });

  it("respects enabled: false", () => {
    const event = makeEvent({ extra: { password: "secret" } });
    const result = scrubEvent(event, { enabled: false });
    expect(result.extra?.password).toBe("secret");
  });

  it("handles circular references without crashing", () => {
    const obj: Record<string, unknown> = { name: "test" };
    obj.self = obj;
    const event = makeEvent({ extra: obj });
    expect(() => scrubEvent(event, undefined)).not.toThrow();
  });

  it("handles deeply nested objects gracefully", () => {
    let nested: Record<string, unknown> = { password: "deep" };
    for (let i = 0; i < 12; i++) {
      nested = { child: nested };
    }
    const event = makeEvent({ extra: nested });
    const result = scrubEvent(event, undefined);
    // Beyond depth 8, values are returned as-is (not scrubbed)
    expect(result).toBeDefined();
  });

  it("scrubs breadcrumb data", () => {
    const event = makeEvent({
      breadcrumbs: [
        { timestamp: "now", category: "http", message: "POST /login", data: { token: "abc123" } },
      ],
    });
    const result = scrubEvent(event, undefined);
    expect(result.breadcrumbs?.[0]?.data?.token).toBe("[Filtered]");
  });

  it("masks AWS access keys", () => {
    const event = makeEvent({ extra: { key: "AKIAIOSFODNN7EXAMPLE" } });
    const result = scrubEvent(event, undefined);
    expect(result.extra?.key).toBe("[Filtered]");
  });
});

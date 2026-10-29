import { describe, it, expect } from "vitest";
import {
  createScopedContext,
  runWithContext,
  runWithContextAsync,
  getRequestContext,
  hasRequestContext,
  setRequestUser,
  setRequestTag,
  setRequestExtra,
  addRequestBreadcrumb,
  getMergedContext,
} from "./context";
import type { Breadcrumb, UserContext } from "./types";

function makeBreadcrumb(message: string): Breadcrumb {
  return {
    timestamp: new Date().toISOString(),
    category: "test",
    message,
    level: "info",
  };
}

describe("createScopedContext", () => {
  it("returns an empty context shape", () => {
    const ctx = createScopedContext();
    expect(ctx).toEqual({
      user: null,
      tags: {},
      extra: {},
      breadcrumbs: [],
    });
  });

  it("returns a fresh object each call (no shared references)", () => {
    const a = createScopedContext();
    const b = createScopedContext();
    expect(a).not.toBe(b);
    expect(a.tags).not.toBe(b.tags);
    expect(a.extra).not.toBe(b.extra);
    expect(a.breadcrumbs).not.toBe(b.breadcrumbs);

    // Mutating one must not affect the other.
    a.tags.foo = "bar";
    a.breadcrumbs.push(makeBreadcrumb("from-a"));
    expect(b.tags).toEqual({});
    expect(b.breadcrumbs).toEqual([]);
  });
});

describe("without an active request scope", () => {
  it("getRequestContext returns undefined", () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it("hasRequestContext returns false", () => {
    expect(hasRequestContext()).toBe(false);
  });

  it("setRequestUser returns false", () => {
    expect(setRequestUser({ id: "u1" })).toBe(false);
  });

  it("setRequestTag returns false", () => {
    expect(setRequestTag("k", "v")).toBe(false);
  });

  it("setRequestExtra returns false", () => {
    expect(setRequestExtra("k", "v")).toBe(false);
  });

  it("addRequestBreadcrumb returns false", () => {
    expect(addRequestBreadcrumb(makeBreadcrumb("nope"))).toBe(false);
  });
});

describe("runWithContext (sync)", () => {
  it("exposes the passed context to getRequestContext within the scope", () => {
    const ctx = createScopedContext();
    ctx.tags.scope = "inner";

    runWithContext(ctx, () => {
      const seen = getRequestContext();
      expect(seen).toBe(ctx);
      expect(hasRequestContext()).toBe(true);
      expect(seen?.tags.scope).toBe("inner");
    });
  });

  it("removes the context after the function returns", () => {
    runWithContext(createScopedContext(), () => {
      expect(getRequestContext()).toBeDefined();
    });
    expect(getRequestContext()).toBeUndefined();
    expect(hasRequestContext()).toBe(false);
  });

  it("propagates the function return value", () => {
    const result = runWithContext(createScopedContext(), () => 42);
    expect(result).toBe(42);
  });

  it("propagates synchronously thrown errors", () => {
    expect(() =>
      runWithContext(createScopedContext(), () => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    // Scope is also cleaned up after a throw.
    expect(getRequestContext()).toBeUndefined();
  });
});

describe("runWithContextAsync", () => {
  it("exposes the passed context within the async scope", async () => {
    const ctx = createScopedContext();
    ctx.tags.scope = "async";

    await runWithContextAsync(ctx, async () => {
      expect(getRequestContext()).toBe(ctx);
      expect(hasRequestContext()).toBe(true);
    });

    expect(getRequestContext()).toBeUndefined();
  });

  it("propagates the resolved value", async () => {
    const result = await runWithContextAsync(createScopedContext(), async () => "hello");
    expect(result).toBe("hello");
  });

  it("propagates async errors", async () => {
    await expect(
      runWithContextAsync(createScopedContext(), async () => {
        throw new Error("async-boom");
      })
    ).rejects.toThrow("async-boom");
  });

  it("preserves context across await boundaries within the scope", async () => {
    const ctx = createScopedContext();
    ctx.tags.persisted = "yes";

    await runWithContextAsync(ctx, async () => {
      expect(getRequestContext()).toBe(ctx);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(getRequestContext()).toBe(ctx);
      expect(getRequestContext()?.tags.persisted).toBe("yes");
    });
  });
});

describe("request scope mutators", () => {
  it("setRequestUser sets and clears the user inside a scope", () => {
    runWithContext(createScopedContext(), () => {
      const user: UserContext = { id: "u1", email: "a@b.com" };
      expect(setRequestUser(user)).toBe(true);
      expect(getRequestContext()?.user).toEqual(user);

      expect(setRequestUser(null)).toBe(true);
      expect(getRequestContext()?.user).toBeNull();
    });
  });

  it("setRequestTag sets a tag", () => {
    runWithContext(createScopedContext(), () => {
      expect(setRequestTag("env", "prod")).toBe(true);
      expect(getRequestContext()?.tags).toEqual({ env: "prod" });
    });
  });

  it("setRequestExtra sets an extra", () => {
    runWithContext(createScopedContext(), () => {
      expect(setRequestExtra("k", { nested: 1 })).toBe(true);
      expect(getRequestContext()?.extra).toEqual({ k: { nested: 1 } });
    });
  });

  it("addRequestBreadcrumb appends a breadcrumb", () => {
    runWithContext(createScopedContext(), () => {
      const crumb = makeBreadcrumb("first");
      expect(addRequestBreadcrumb(crumb)).toBe(true);
      expect(getRequestContext()?.breadcrumbs).toEqual([crumb]);
    });
  });
});

describe("addRequestBreadcrumb truncation", () => {
  it("truncates to the last `maxBreadcrumbs` when exceeded", () => {
    runWithContext(createScopedContext(), () => {
      for (let i = 0; i < 5; i++) {
        addRequestBreadcrumb(makeBreadcrumb(`crumb-${i}`), 3);
      }
      const breadcrumbs = getRequestContext()?.breadcrumbs ?? [];
      expect(breadcrumbs).toHaveLength(3);
      expect(breadcrumbs.map((b) => b.message)).toEqual(["crumb-2", "crumb-3", "crumb-4"]);
    });
  });

  it("respects the default max of 100", () => {
    runWithContext(createScopedContext(), () => {
      for (let i = 0; i < 100; i++) {
        addRequestBreadcrumb(makeBreadcrumb(`c-${i}`));
      }
      expect(getRequestContext()?.breadcrumbs).toHaveLength(100);

      addRequestBreadcrumb(makeBreadcrumb("c-100"));
      const breadcrumbs = getRequestContext()?.breadcrumbs ?? [];
      expect(breadcrumbs).toHaveLength(100);
      // Oldest evicted, newest preserved.
      expect(breadcrumbs[0]!.message).toBe("c-1");
      expect(breadcrumbs[breadcrumbs.length - 1]!.message).toBe("c-100");
    });
  });
});

describe("request scope isolation", () => {
  it("two parallel async scopes do not see each other's state", async () => {
    const ctx1 = createScopedContext();
    const ctx2 = createScopedContext();

    const task1 = runWithContextAsync(ctx1, async () => {
      setRequestTag("scope", "one");
      addRequestBreadcrumb(makeBreadcrumb("from-1"));
      // Yield to let task 2 run.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const seen = getRequestContext();
      expect(seen).toBe(ctx1);
      expect(seen?.tags).toEqual({ scope: "one" });
      expect(seen?.breadcrumbs.map((b) => b.message)).toEqual(["from-1"]);
      return seen;
    });

    const task2 = runWithContextAsync(ctx2, async () => {
      setRequestTag("scope", "two");
      addRequestBreadcrumb(makeBreadcrumb("from-2"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      const seen = getRequestContext();
      expect(seen).toBe(ctx2);
      expect(seen?.tags).toEqual({ scope: "two" });
      expect(seen?.breadcrumbs.map((b) => b.message)).toEqual(["from-2"]);
      return seen;
    });

    const [r1, r2] = await Promise.all([task1, task2]);
    expect(r1).toBe(ctx1);
    expect(r2).toBe(ctx2);
    expect(ctx1.breadcrumbs.map((b) => b.message)).toEqual(["from-1"]);
    expect(ctx2.breadcrumbs.map((b) => b.message)).toEqual(["from-2"]);
  });
});

describe("getMergedContext", () => {
  it("returns the global values verbatim when there is no request scope", () => {
    const globalUser: UserContext = { id: "global" };
    const globalTags = { region: "eu" };
    const globalExtra = { build: 1 };
    const globalBreadcrumbs = [makeBreadcrumb("global-crumb")];

    const merged = getMergedContext(globalUser, globalTags, globalExtra, globalBreadcrumbs);
    expect(merged.user).toBe(globalUser);
    expect(merged.tags).toBe(globalTags);
    expect(merged.extra).toBe(globalExtra);
    expect(merged.breadcrumbs).toBe(globalBreadcrumbs);
  });

  it("prefers request user when set", () => {
    const globalUser: UserContext = { id: "global" };
    const reqUser: UserContext = { id: "req" };

    runWithContext(createScopedContext(), () => {
      setRequestUser(reqUser);
      const merged = getMergedContext(globalUser, {}, {}, []);
      expect(merged.user).toEqual(reqUser);
    });
  });

  it("falls back to global user when request user is null", () => {
    const globalUser: UserContext = { id: "global" };

    runWithContext(createScopedContext(), () => {
      // Leave request user as null (the default).
      const merged = getMergedContext(globalUser, {}, {}, []);
      expect(merged.user).toEqual(globalUser);
    });
  });

  it("merges tags with request keys overriding global", () => {
    runWithContext(createScopedContext(), () => {
      setRequestTag("env", "request-prod");
      setRequestTag("only-in-req", "yes");
      const merged = getMergedContext(null, { env: "global-prod", "only-in-global": "yes" }, {}, []);
      expect(merged.tags).toEqual({
        env: "request-prod",
        "only-in-req": "yes",
        "only-in-global": "yes",
      });
    });
  });

  it("merges extra with request keys overriding global", () => {
    runWithContext(createScopedContext(), () => {
      setRequestExtra("shared", "request-value");
      setRequestExtra("req-only", 1);
      const merged = getMergedContext(null, {}, { shared: "global-value", "global-only": 2 }, []);
      expect(merged.extra).toEqual({
        shared: "request-value",
        "req-only": 1,
        "global-only": 2,
      });
    });
  });

  it("concatenates global breadcrumbs with request breadcrumbs", () => {
    const globalCrumb = makeBreadcrumb("global");
    const reqCrumb = makeBreadcrumb("req");

    runWithContext(createScopedContext(), () => {
      addRequestBreadcrumb(reqCrumb);
      const merged = getMergedContext(null, {}, {}, [globalCrumb]);
      expect(merged.breadcrumbs).toEqual([globalCrumb, reqCrumb]);
    });
  });
});

import { addBreadcrumb, getClient } from "@bugwatch/core";
import { useEffect } from "react";

/** A route as reported by React Navigation's `getCurrentRoute()`. */
export interface NavigationRouteLike {
  name: string;
  params?: object;
}

/**
 * The slice of a React Navigation container ref that the integration uses.
 * Satisfied by `createNavigationContainerRef()` and by `useRef` attached to
 * `<NavigationContainer ref={...}>`, without importing @react-navigation.
 */
export interface NavigationContainerLike {
  addListener(type: "state", listener: () => void): () => void;
  getCurrentRoute(): NavigationRouteLike | undefined;
}

export type NavigationContainerRefInput = NavigationContainerLike | { current: NavigationContainerLike | null };

export interface NavigationIntegrationOptions {
  /**
   * Attach route params to breadcrumbs. Off by default: params commonly hold
   * ids, tokens and other PII.
   */
  includeParams?: boolean;
}

export interface NavigationIntegration {
  /**
   * Start recording navigation breadcrumbs for a container. Returns a
   * function that stops recording. Does nothing (and returns a no-op) when the
   * container is not mounted yet.
   */
  registerNavigationContainer(ref: NavigationContainerRefInput): () => void;
}

function resolveContainer(ref: NavigationContainerRefInput): NavigationContainerLike | null {
  if ("addListener" in ref) return ref;
  return ref.current;
}

/**
 * React Navigation integration: adds a `navigation` breadcrumb for every
 * route change and keeps the `route` tag on events current.
 *
 * @example
 * ```tsx
 * const navigation = createNavigationIntegration();
 * const ref = useNavigationContainerRef();
 * <NavigationContainer ref={ref} onReady={() => navigation.registerNavigationContainer(ref)} />
 * ```
 */
export function createNavigationIntegration(options: NavigationIntegrationOptions = {}): NavigationIntegration {
  return {
    registerNavigationContainer(ref) {
      const container = resolveContainer(ref);
      if (!container) return () => {};

      let current = container.getCurrentRoute();
      if (current) getClient()?.setTag("route", current.name);

      return container.addListener("state", () => {
        const next = container.getCurrentRoute();
        if (!next || next.name === current?.name) return;

        const from = current?.name;
        current = next;
        getClient()?.setTag("route", next.name);
        addBreadcrumb({
          category: "navigation",
          message: from ? `${from} -> ${next.name}` : `Navigated to ${next.name}`,
          level: "info",
          data: {
            ...(from && { from }),
            to: next.name,
            ...(options.includeParams && next.params && { params: next.params }),
          },
        });
      });
    },
  };
}

/**
 * Hook form of {@link createNavigationIntegration}. Call it in the component
 * that owns the container ref.
 */
export function useNavigationBreadcrumbs(
  ref: NavigationContainerRefInput,
  options?: NavigationIntegrationOptions
): void {
  const includeParams = options?.includeParams;
  useEffect(
    () => createNavigationIntegration({ includeParams }).registerNavigationContainer(ref),
    [ref, includeParams]
  );
}

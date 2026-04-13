"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface UseListKeyboardNavigationOptions {
  itemCount: number;
  onOpen: (index: number) => void;
  onToggleSelect?: (index: number) => void;
  onFocusSearch?: () => void;
  onResolve?: (index: number) => void;
  onIgnore?: (index: number) => void;
  onShowHelp?: () => void;
  isEnabled?: boolean;
}

/**
 * Vim-style keyboard navigation for issue lists.
 * j/k: move focus, Enter: open, x: toggle select, /: focus search,
 * r: resolve, m/e: mute/archive, ?: help
 */
export function useListKeyboardNavigation({
  itemCount,
  onOpen,
  onToggleSelect,
  onFocusSearch,
  onResolve,
  onIgnore,
  onShowHelp,
  isEnabled = true,
}: UseListKeyboardNavigationOptions) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollIntoView = useCallback((index: number) => {
    if (!containerRef.current) return;
    const items = containerRef.current.querySelectorAll("[data-issue-row]");
    const item = items[index];
    if (item) {
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    if (!isEnabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Only handle Escape in inputs
        if (e.key === "Escape") {
          (target as HTMLInputElement).blur();
          e.preventDefault();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, itemCount - 1);
          setFocusedIndex(next);
          scrollIntoView(next);
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          setFocusedIndex(prev);
          scrollIntoView(prev);
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < itemCount) {
            onOpen(focusedIndex);
          }
          break;
        }
        case "x": {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < itemCount && onToggleSelect) {
            onToggleSelect(focusedIndex);
          }
          break;
        }
        case "/": {
          e.preventDefault();
          onFocusSearch?.();
          break;
        }
        case "r": {
          if (focusedIndex >= 0 && focusedIndex < itemCount && onResolve) {
            e.preventDefault();
            onResolve(focusedIndex);
          }
          break;
        }
        case "m":
        case "e": {
          if (focusedIndex >= 0 && focusedIndex < itemCount && onIgnore) {
            e.preventDefault();
            onIgnore(focusedIndex);
          }
          break;
        }
        case "?": {
          if (onShowHelp) {
            e.preventDefault();
            onShowHelp();
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, focusedIndex, itemCount, onOpen, onToggleSelect, onFocusSearch, onResolve, onIgnore, onShowHelp, scrollIntoView]);

  // Reset focus when item count changes
  useEffect(() => {
    if (focusedIndex >= itemCount) {
      setFocusedIndex(Math.max(0, itemCount - 1));
    }
  }, [itemCount, focusedIndex]);

  return { focusedIndex, setFocusedIndex, containerRef };
}

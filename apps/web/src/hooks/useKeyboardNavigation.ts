"use client";

import { useEffect, useCallback } from "react";

interface UseKeyboardNavigationOptions {
  itemCount: number;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  onSelect: () => void;
  onEscape?: () => void;
  isEnabled: boolean;
  loop?: boolean;
}

/**
 * Hook for keyboard navigation in lists (autocomplete, menus, etc.)
 */
export function useKeyboardNavigation({
  itemCount,
  selectedIndex,
  setSelectedIndex,
  onSelect,
  onEscape,
  isEnabled,
  loop = true,
}: UseKeyboardNavigationOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isEnabled) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex(
            selectedIndex + 1 >= itemCount
              ? loop
                ? 0
                : selectedIndex
              : selectedIndex + 1
          );
          break;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(
            selectedIndex - 1 < 0
              ? loop
                ? itemCount - 1
                : 0
              : selectedIndex - 1
          );
          break;

        case "Enter":
          e.preventDefault();
          if (itemCount > 0) {
            onSelect();
          }
          break;

        case "Tab":
          if (itemCount > 0) {
            e.preventDefault();
            onSelect();
          }
          break;

        case "Escape":
          e.preventDefault();
          onEscape?.();
          break;
      }
    },
    [isEnabled, itemCount, selectedIndex, setSelectedIndex, onSelect, onEscape, loop]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { selectedIndex };
}

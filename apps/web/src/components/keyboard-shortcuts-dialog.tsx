"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string; sequential?: boolean }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Open command palette" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
    ],
  },
  {
    title: "Issues List",
    shortcuts: [
      { keys: ["J"], description: "Move to next issue" },
      { keys: ["K"], description: "Move to previous issue" },
      { keys: ["Enter"], description: "Open selected issue" },
      { keys: ["X"], description: "Toggle selection" },
      { keys: ["/"], description: "Focus search" },
    ],
  },
  {
    title: "Issue Detail",
    shortcuts: [
      { keys: ["["], description: "Previous issue" },
      { keys: ["]"], description: "Next issue" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["G", "D"], description: "Go to dashboard", sequential: true },
      { keys: ["G", "P"], description: "Go to projects", sequential: true },
      { keys: ["G", "U"], description: "Go to uptime", sequential: true },
      { keys: ["G", "S"], description: "Go to settings", sequential: true },
    ],
  },
];

export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "?") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <>
      {/* Floating hint button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-lg border bg-background/80 backdrop-blur-sm px-3 py-1.5 text-xs text-muted-foreground shadow-sm hover:bg-accent transition-colors"
      >
        <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">?</kbd>
        <span>Shortcuts</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
            {shortcutGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                  {group.title}
                </h3>
                <div className="space-y-1.5">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <span key={i}>
                            {i > 0 && (
                              <span className="text-xs text-muted-foreground mx-0.5">
                                {shortcut.sequential ? "then" : "+"}
                              </span>
                            )}
                            <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 rounded border bg-muted px-1.5 text-xs font-mono">
                              {key}
                            </kbd>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useState } from "react";
import { ChevronRight, Copy, Check, ExternalLink, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StackFrameDetail } from "@/lib/api";
import { toast } from "sonner";

interface StackFrameProps {
  frame: StackFrameDetail;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export function StackFrame({ frame, index: _index, isExpanded, onToggle }: StackFrameProps) {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  const handleCopyRef = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${frame.filename}:${frame.lineno}`);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 1500);
    toast.success("Frame reference copied");
  };

  const handleCopyLine = (line: string, lineNo: number) => {
    navigator.clipboard.writeText(line.trim());
    toast.success(`Line ${lineNo} copied`);
  };

  return (
    <div
      className={`rounded-md border overflow-hidden transition-all ${
        frame.in_app
          ? "border-primary/30 bg-primary/5"
          : "bg-muted/30 border-border"
      }`}
    >
      {/* Frame Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left group/frame hover:bg-muted/20 transition-colors"
      >
        <div className={`shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>
          <ChevronRight className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium truncate">
              {frame.function || "(anonymous)"}
            </span>
            {frame.in_app && (
              <span className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                APP
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {frame.filename}:{frame.lineno}
            {frame.colno ? `:${frame.colno}` : ""}
          </p>
        </div>

        {/* Copy frame ref on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover/frame:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleCopyRef}
          >
            {copiedRef ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
          {frame.in_app && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>
      </button>

      {/* Code Context */}
      {isExpanded && frame.context_line && (
        <>
          {/* File path bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-b bg-zinc-900 text-zinc-400 text-xs font-mono">
            <Code className="h-3 w-3" />
            <span className="truncate">{frame.filename}</span>
            <span className="text-zinc-600">line {frame.lineno}</span>
          </div>

          <div className="bg-zinc-950 font-mono text-sm select-text">
            {/* Pre-context lines */}
            {frame.pre_context?.map((line, i) => {
              const lineNo = frame.lineno - (frame.pre_context?.length || 0) + i;
              return (
                <div
                  key={`pre-${i}`}
                  className={`flex items-start transition-colors cursor-pointer ${
                    hoveredLine === lineNo ? "bg-zinc-800/50" : ""
                  }`}
                  onMouseEnter={() => setHoveredLine(lineNo)}
                  onMouseLeave={() => setHoveredLine(null)}
                  onClick={() => handleCopyLine(line, lineNo)}
                >
                  <span className="w-12 shrink-0 text-right pr-3 text-zinc-600 select-none py-0.5">
                    {lineNo}
                  </span>
                  <span className="text-zinc-500 py-0.5 pr-4">{line || " "}</span>
                </div>
              );
            })}

            {/* Error line */}
            <div className="flex items-start bg-red-500/15 border-l-2 border-red-500">
              <span className="w-12 shrink-0 text-right pr-3 text-red-400 font-bold select-none py-0.5">
                {frame.lineno}
              </span>
              <span className="text-red-300 py-0.5 pr-4">{frame.context_line}</span>
            </div>
            {/* Column pointer */}
            {frame.colno && frame.colno > 0 && (
              <div className="flex items-start bg-red-500/5">
                <span className="w-12 shrink-0" />
                <span className="text-red-400 py-0 pr-4 text-xs">
                  {" ".repeat(Math.max(0, frame.colno - 1))}^
                </span>
              </div>
            )}

            {/* Post-context lines */}
            {frame.post_context?.map((line, i) => {
              const lineNo = frame.lineno + i + 1;
              return (
                <div
                  key={`post-${i}`}
                  className={`flex items-start transition-colors cursor-pointer ${
                    hoveredLine === lineNo ? "bg-zinc-800/50" : ""
                  }`}
                  onMouseEnter={() => setHoveredLine(lineNo)}
                  onMouseLeave={() => setHoveredLine(null)}
                  onClick={() => handleCopyLine(line, lineNo)}
                >
                  <span className="w-12 shrink-0 text-right pr-3 text-zinc-600 select-none py-0.5">
                    {lineNo}
                  </span>
                  <span className="text-zinc-500 py-0.5 pr-4">{line || " "}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Variables - progressive disclosure */}
      {isExpanded && frame.vars && Object.keys(frame.vars).length > 0 && (
        <details className="border-t">
          <summary className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/20 transition-colors">
            <Code className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium text-xs">Local Variables ({Object.keys(frame.vars).length})</span>
          </summary>
          <div className="px-3 pb-3 grid gap-1">
            {Object.entries(frame.vars).map(([name, val]) => {
              const displayValue = typeof val === "object" && val !== null
                ? JSON.stringify(val, null, 2)
                : String(val ?? "null");
              return (
                <div key={name} className="flex items-start gap-2 font-mono text-xs">
                  <span className="text-blue-500 font-medium shrink-0">{name}</span>
                  <span className="text-muted-foreground">=</span>
                  <span className="text-green-500 break-all">{displayValue}</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

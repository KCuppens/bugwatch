"use client";

import { cn } from "@/lib/utils";
import type { FrameworkConfig } from "@/lib/sdk-config";
import { Hexagon, Server, Globe, Layers, Zap, Clock, Box, Cpu } from "lucide-react";

// Map framework IDs to icons
const FrameworkIcons: Record<string, React.ReactNode> = {
  // JavaScript
  nextjs: <Hexagon className="h-8 w-8" />,
  react: <Globe className="h-8 w-8" />,
  node: <Server className="h-8 w-8" />,
  core: <Layers className="h-8 w-8" />,
  // Python
  django: <Box className="h-8 w-8" />,
  flask: <Zap className="h-8 w-8" />,
  fastapi: <Cpu className="h-8 w-8" />,
  celery: <Clock className="h-8 w-8" />,
  // Rust
  async: <Zap className="h-8 w-8" />,
  blocking: <Clock className="h-8 w-8" />,
};

interface FrameworkCardProps {
  framework: FrameworkConfig;
  selected: boolean;
  onClick: () => void;
}

export function FrameworkCard({ framework, selected, onClick }: FrameworkCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-start rounded-xl border-2 p-5 text-left transition-all duration-200 hover:scale-[1.02]",
        selected
          ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5 ring-2 ring-[hsl(var(--accent))]/30 ring-offset-2"
          : "border-[hsl(var(--border))] hover:border-[hsl(var(--accent))]/40 bg-[hsl(var(--surface-2))]"
      )}
    >
      <div
        className={cn(
          "mb-3 transition-colors",
          selected
            ? "text-[hsl(var(--accent))]"
            : "text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))]"
        )}
      >
        {FrameworkIcons[framework.id] || <Layers className="h-8 w-8" />}
      </div>
      <h3 className="font-semibold">{framework.name}</h3>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{framework.description}</p>
      <code className="mt-3 rounded bg-[hsl(var(--surface-2))] px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]">
        {framework.package}
      </code>
    </button>
  );
}

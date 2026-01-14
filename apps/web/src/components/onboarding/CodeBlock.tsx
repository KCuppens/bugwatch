"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showCopy?: boolean;
  className?: string;
}

export function CodeBlock({
  code,
  language = "text",
  filename,
  showCopy = true,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("relative rounded-lg border bg-muted/50", className)}>
      {filename && (
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {filename}
          </span>
          {showCopy && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      )}
      <div className="relative">
        <pre className="overflow-x-auto p-4 text-sm">
          <code className={`language-${language}`}>{code}</code>
        </pre>
        {showCopy && !filename && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// Specialized component for install commands with package manager tabs
interface InstallCommandProps {
  commands: {
    npm?: string;
    yarn?: string;
    pnpm?: string;
    pip?: string;
    poetry?: string;
    cargo?: string;
  };
}

export function InstallCommand({ commands }: InstallCommandProps) {
  const availableManagers = Object.entries(commands).filter(
    ([, cmd]) => cmd !== undefined
  );
  const [activeManager, setActiveManager] = useState(availableManagers[0]?.[0] || "npm");
  const [copied, setCopied] = useState(false);

  const currentCommand = commands[activeManager as keyof typeof commands] || "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(currentCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b px-1 py-1">
        <div className="flex gap-1">
          {availableManagers.map(([manager]) => (
            <button
              key={manager}
              type="button"
              onClick={() => setActiveManager(manager)}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-medium transition-colors",
                activeManager === manager
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {manager}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="mr-1 h-7 w-7"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm">
        <code>{currentCommand}</code>
      </pre>
    </div>
  );
}

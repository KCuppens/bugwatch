import {
  Code2,
  Boxes,
  Server,
  Cpu,
  Globe,
  Package,
  type LucideIcon,
} from "lucide-react";

const PLATFORM_ICON: Record<string, LucideIcon> = {
  javascript: Code2,
  typescript: Code2,
  node: Server,
  nodejs: Server,
  react: Boxes,
  nextjs: Boxes,
  next: Boxes,
  vue: Boxes,
  nuxt: Boxes,
  python: Code2,
  django: Boxes,
  flask: Boxes,
  fastapi: Boxes,
  go: Cpu,
  golang: Cpu,
  rust: Cpu,
  java: Code2,
  ruby: Code2,
  rails: Boxes,
  php: Code2,
  laravel: Boxes,
  dotnet: Code2,
  csharp: Code2,
  browser: Globe,
};

interface PlatformIconProps {
  platform: string | null | undefined;
  className?: string;
}

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const Icon = platform ? PLATFORM_ICON[platform.toLowerCase()] || Package : Package;
  return <Icon className={className} aria-hidden="true" />;
}

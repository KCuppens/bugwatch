import Link from "next/link";

function LogoContent() {
  return (
    <>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-lg shadow-[hsl(var(--accent))]/25">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[18px] w-[18px]"
          aria-hidden="true"
        >
          <path d="M8 2v3" />
          <path d="M16 2v3" />
          <rect x="4" y="6" width="16" height="14" rx="5" />
          <path d="M4 13h16" />
          <path d="M2 15h2" />
          <path d="M20 15h2" />
          <path d="M2 10h2" />
          <path d="M20 10h2" />
        </svg>
      </span>
      <span className="font-sans font-bold text-xl tracking-tight">BugWatch</span>
    </>
  );
}

export function Logo({ href = "/", noLink = false }: { href?: string; noLink?: boolean }) {
  if (noLink) {
    return <span className="flex items-center gap-2.5"><LogoContent /></span>;
  }
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <LogoContent />
    </Link>
  );
}

import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div data-docs="true">
      <RootProvider>
        <DocsLayout
          tree={source.pageTree}
          nav={{
            title: <span className="font-bold">BugWatch Docs</span>,
            url: "/docs",
          }}
          links={[
            { text: "Home", url: "/" },
            { text: "Dashboard", url: "/dashboard" },
            { text: "GitHub", url: "https://github.com/KCuppens/bugwatch", external: true },
          ]}
        >
          {children}
        </DocsLayout>
      </RootProvider>
    </div>
  );
}

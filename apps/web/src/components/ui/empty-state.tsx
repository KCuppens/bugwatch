import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center text-center py-16 px-6",
          className
        )}
        {...props}
      >
        {icon && (
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-3 border border-border-subtle text-muted-foreground [&_svg]:size-6">
            {icon}
          </div>
        )}
        <h3 className="text-heading-sm text-foreground">{title}</h3>
        {description && (
          <p className="mt-2 max-w-sm text-body-sm text-muted-foreground">
            {description}
          </p>
        )}
        {action && <div className="mt-6">{action}</div>}
      </div>
    );
  }
);
EmptyState.displayName = "EmptyState";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-foreground shadow-lg shadow-accent/20 hover:bg-accent/90 btn-inset",
        destructive:
          "bg-red-500/90 text-white shadow-lg shadow-red-500/20 hover:bg-red-500",
        success:
          "bg-accent text-accent-foreground shadow-lg shadow-accent/20 hover:bg-accent/90",
        outline:
          "border border-border-subtle bg-surface-2 hover:bg-surface-3 hover:border-border-strong",
        secondary:
          "bg-surface-3 text-foreground hover:bg-surface-3/80",
        accent2:
          "bg-accent-2 text-accent-2-foreground shadow-lg shadow-accent-2/20 hover:bg-accent-2/90 btn-inset",
        ghost: "hover:bg-surface-3",
        link: "text-accent-2 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-8",
        xl: "h-12 rounded-xl px-7 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

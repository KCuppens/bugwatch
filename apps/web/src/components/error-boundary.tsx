"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "@bugwatch/nextjs";

interface Props {
  children: ReactNode;
  fallback: ReactNode | ((reset: () => void) => ReactNode);
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught render error:", error, info.componentStack);
    captureException(error, { extra: { componentStack: info.componentStack } });
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  override render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      return typeof fallback === "function" ? fallback(this.reset) : fallback;
    }
    return this.props.children;
  }
}

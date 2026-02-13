import { useEffect } from 'react';
import { captureException } from '@bugwatch/core';
export { captureException } from '@bugwatch/core';
import { jsxs, jsx } from 'react/jsx-runtime';

var styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "50vh",
    padding: "2rem",
    textAlign: "center",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  },
  heading: {
    marginBottom: "1rem",
    fontSize: "1.5rem",
    fontWeight: 600,
    color: "#1a1a1a"
  },
  message: {
    marginBottom: "1.5rem",
    color: "#666",
    fontSize: "1rem",
    maxWidth: "400px"
  },
  button: {
    padding: "0.75rem 1.5rem",
    fontSize: "1rem",
    fontWeight: 500,
    cursor: "pointer",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "0.5rem",
    transition: "background-color 0.2s ease"
  },
  buttonHover: {
    backgroundColor: "#0051a8"
  }
};
function BugwatchError({ error, reset }) {
  useEffect(() => {
    captureException(error, {
      tags: { mechanism: "app-router-error-boundary" },
      extra: { digest: error.digest }
    });
  }, [error]);
  return /* @__PURE__ */ jsxs("div", { style: styles.container, children: [
    /* @__PURE__ */ jsx("h2", { style: styles.heading, children: "Something went wrong" }),
    /* @__PURE__ */ jsx("p", { style: styles.message, children: "We've been notified and are looking into it. Please try again." }),
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: reset,
        style: styles.button,
        onMouseEnter: (e) => {
          e.currentTarget.style.backgroundColor = styles.buttonHover.backgroundColor;
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.backgroundColor = styles.button.backgroundColor;
        },
        children: "Try again"
      }
    )
  ] });
}
function BugwatchGlobalError({ error, reset }) {
  useEffect(() => {
    captureException(error, {
      tags: { mechanism: "global-error-boundary" },
      extra: { digest: error.digest }
    });
  }, [error]);
  return /* @__PURE__ */ jsx("html", { lang: "en", children: /* @__PURE__ */ jsx("body", { children: /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        ...styles.container,
        minHeight: "100vh"
      },
      children: [
        /* @__PURE__ */ jsx("h1", { style: styles.heading, children: "Application Error" }),
        /* @__PURE__ */ jsx("p", { style: styles.message, children: "Something went wrong. We've been notified and are working on it." }),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: reset,
            style: styles.button,
            onMouseEnter: (e) => {
              e.currentTarget.style.backgroundColor = styles.buttonHover.backgroundColor;
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.backgroundColor = styles.button.backgroundColor;
            },
            children: "Try again"
          }
        )
      ]
    }
  ) }) });
}
function CustomBugwatchError({
  error,
  reset,
  title = "Something went wrong",
  message = "We've been notified and are looking into it.",
  retryText = "Try again",
  containerStyle,
  buttonStyle,
  tags,
  hideRetryButton = false,
  children
}) {
  useEffect(() => {
    captureException(error, {
      tags: { mechanism: "custom-error-boundary", ...tags },
      extra: { digest: error.digest }
    });
  }, [error, tags]);
  return /* @__PURE__ */ jsxs("div", { style: { ...styles.container, ...containerStyle }, children: [
    /* @__PURE__ */ jsx("h2", { style: styles.heading, children: title }),
    /* @__PURE__ */ jsx("p", { style: styles.message, children: message }),
    children,
    !hideRetryButton && /* @__PURE__ */ jsx(
      "button",
      {
        onClick: reset,
        style: { ...styles.button, ...buttonStyle },
        onMouseEnter: (e) => {
          e.currentTarget.style.backgroundColor = styles.buttonHover.backgroundColor;
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.backgroundColor = buttonStyle?.backgroundColor || styles.button.backgroundColor;
        },
        children: retryText
      }
    )
  ] });
}

export { BugwatchError, BugwatchGlobalError, CustomBugwatchError };
//# sourceMappingURL=error-components.mjs.map
//# sourceMappingURL=error-components.mjs.map
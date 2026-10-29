import { ReactNode } from 'react';
export { captureException } from '@bugwatch/core';

/**
 * Pre-built error boundary components for Next.js App Router
 *
 * Usage:
 *
 * // app/error.tsx
 * export { BugwatchError as default } from '@bugwatch/nextjs/error-components';
 *
 * // app/global-error.tsx
 * export { BugwatchGlobalError as default } from '@bugwatch/nextjs/error-components';
 */

interface ErrorPageProps {
    error: Error & {
        digest?: string;
    };
    reset: () => void;
}
/**
 * Pre-built App Router error.tsx component
 *
 * Automatically captures errors to Bugwatch and displays
 * a user-friendly error message with retry option.
 *
 * @example
 * // app/error.tsx
 * export { BugwatchError as default } from '@bugwatch/nextjs/error-components';
 */
declare function BugwatchError({ error, reset }: ErrorPageProps): ReactNode;
/**
 * Pre-built App Router global-error.tsx component
 *
 * Handles root layout errors. Must include html and body tags.
 *
 * @example
 * // app/global-error.tsx
 * export { BugwatchGlobalError as default } from '@bugwatch/nextjs/error-components';
 */
declare function BugwatchGlobalError({ error, reset }: ErrorPageProps): ReactNode;
interface CustomErrorPageProps extends ErrorPageProps {
    /** Custom title */
    title?: string;
    /** Custom message */
    message?: string;
    /** Custom retry button text */
    retryText?: string;
    /** Custom styles for the container */
    containerStyle?: React.CSSProperties;
    /** Custom styles for the button */
    buttonStyle?: React.CSSProperties;
    /** Additional tags for error tracking */
    tags?: Record<string, string>;
    /** Hide the retry button */
    hideRetryButton?: boolean;
    /** Custom content to render */
    children?: ReactNode;
}
/**
 * Customizable error component for more control
 *
 * @example
 * // app/error.tsx
 * import { CustomBugwatchError } from '@bugwatch/nextjs/error-components';
 *
 * export default function Error({ error, reset }) {
 *   return (
 *     <CustomBugwatchError
 *       error={error}
 *       reset={reset}
 *       title="Oops!"
 *       message="Something unexpected happened."
 *     />
 *   );
 * }
 */
declare function CustomBugwatchError({ error, reset, title, message, retryText, containerStyle, buttonStyle, tags, hideRetryButton, children, }: CustomErrorPageProps): ReactNode;

export { BugwatchError, BugwatchGlobalError, CustomBugwatchError };

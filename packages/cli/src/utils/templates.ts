import type { ProjectInfo } from "./detect";

/**
 * Get the instrumentation.ts template
 */
export function getInstrumentationTemplate(project: ProjectInfo): string {
  const ext = project.hasTypescript ? "ts" : "js";

  return `// Bugwatch server-side error tracking
// Learn more: https://docs.bugwatch.dev/nextjs/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerBugwatch } = await import('@bugwatch/nextjs/instrumentation');
    registerBugwatch();
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const { registerBugwatch } = await import('@bugwatch/nextjs/instrumentation');
    registerBugwatch({ runtime: 'edge' });
  }
}
`;
}

/**
 * Get the app/error.tsx template (App Router)
 */
export function getAppErrorTemplate(project: ProjectInfo): string {
  if (project.hasTypescript) {
    return `'use client';

export { BugwatchError as default } from '@bugwatch/nextjs/error-components';
`;
  }

  return `'use client';

export { BugwatchError as default } from '@bugwatch/nextjs/error-components';
`;
}

/**
 * Get the app/global-error.tsx template (App Router)
 */
export function getGlobalErrorTemplate(project: ProjectInfo): string {
  if (project.hasTypescript) {
    return `'use client';

export { BugwatchGlobalError as default } from '@bugwatch/nextjs/error-components';
`;
  }

  return `'use client';

export { BugwatchGlobalError as default } from '@bugwatch/nextjs/error-components';
`;
}

/**
 * Get the pages/_error.tsx template (Pages Router)
 */
export function getPagesErrorTemplate(project: ProjectInfo): string {
  if (project.hasTypescript) {
    return `import { captureException } from '@bugwatch/nextjs/client';
import type { NextPageContext } from 'next';

interface ErrorProps {
  statusCode?: number;
}

function Error({ statusCode }: ErrorProps) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{statusCode || 'Error'}</h1>
      <p>
        {statusCode === 404
          ? 'Page not found'
          : 'An error occurred'}
      </p>
    </div>
  );
}

Error.getInitialProps = async ({ res, err }: NextPageContext): Promise<ErrorProps> => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;

  if (err) {
    captureException(err, {
      tags: { mechanism: 'pages-router-error' },
    });
  }

  return { statusCode };
};

export default Error;
`;
  }

  return `import { captureException } from '@bugwatch/nextjs/client';

function Error({ statusCode }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{statusCode || 'Error'}</h1>
      <p>
        {statusCode === 404
          ? 'Page not found'
          : 'An error occurred'}
      </p>
    </div>
  );
}

Error.getInitialProps = async ({ res, err }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;

  if (err) {
    captureException(err, {
      tags: { mechanism: 'pages-router-error' },
    });
  }

  return { statusCode };
};

export default Error;
`;
}

/**
 * Get the file extension for the project
 */
export function getFileExtension(
  project: ProjectInfo,
  isReact: boolean = false
): string {
  if (project.hasTypescript) {
    return isReact ? "tsx" : "ts";
  }
  return isReact ? "jsx" : "js";
}

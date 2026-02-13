import * as next from 'next';
import { NextConfig } from 'next';
import { NodeOptions } from '@bugwatch/node';
export { BugwatchOptions, ErrorEvent, UserContext, addBreadcrumb, captureException, captureMessage, getClient, setExtra, setTag, setUser } from '@bugwatch/core';

/**
 * Next.js specific SDK options
 */
interface NextjsOptions extends NodeOptions {
    /** Capture errors from getServerSideProps */
    captureServerSideErrors?: boolean;
    /** Capture errors from API routes */
    captureApiErrors?: boolean;
    /** Capture build-time errors */
    captureBuildErrors?: boolean;
}
/**
 * Initialize the Bugwatch SDK for Next.js server-side
 */
declare function init(options: NextjsOptions): void;
/**
 * Higher-order function to wrap Next.js config with Bugwatch
 */
declare function withBugwatch(bugwatchOptions: NextjsOptions): (nextConfig?: NextConfig) => NextConfig;
/**
 * Wrapper for getServerSideProps that captures errors
 */
declare function withBugwatchServerSideProps<P extends Record<string, unknown> = Record<string, unknown>, Q extends Record<string, string> = Record<string, string>>(getServerSideProps: (context: next.GetServerSidePropsContext<Q>) => Promise<next.GetServerSidePropsResult<P>>): (context: next.GetServerSidePropsContext<Q>) => Promise<next.GetServerSidePropsResult<P>>;
/**
 * Wrapper for getStaticProps that captures errors
 */
declare function withBugwatchStaticProps<P extends Record<string, unknown> = Record<string, unknown>>(getStaticProps: (context: next.GetStaticPropsContext) => Promise<next.GetStaticPropsResult<P>>): (context: next.GetStaticPropsContext) => Promise<next.GetStaticPropsResult<P>>;
/**
 * Wrapper for API route handlers
 */
declare function withBugwatchApi<Req, Res>(handler: (req: Req, res: Res) => Promise<void> | void): (req: Req, res: Res) => Promise<void>;

export { type NextjsOptions, init, withBugwatch, withBugwatchApi, withBugwatchServerSideProps, withBugwatchStaticProps };

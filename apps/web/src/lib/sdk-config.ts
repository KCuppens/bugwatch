import type { Platform, Framework } from "./api";

export interface PlatformConfig {
  id: Platform;
  name: string;
  description: string;
  icon: "javascript" | "python" | "rust";
  frameworks: FrameworkConfig[];
}

export interface FrameworkConfig {
  id: Framework;
  name: string;
  description: string;
  package: string;
  docsUrl: string;
}

export interface InstallCommand {
  npm?: string;
  yarn?: string;
  pnpm?: string;
  pip?: string;
  poetry?: string;
  cargo?: string;
}

export interface ConfigStep {
  title: string;
  description?: string;
  filename?: string;
  code: string;
  language: string;
}

export interface SDKContent {
  platform: Platform;
  framework: Framework;
  packageName: string;
  installCommands: InstallCommand;
  configSteps: ConfigStep[];
  verificationCode: string;
  docsUrl: string;
}

export const PLATFORMS: PlatformConfig[] = [
  {
    id: "javascript",
    name: "JavaScript",
    description: "Browser, Node.js, Next.js, React",
    icon: "javascript",
    frameworks: [
      {
        id: "nextjs",
        name: "Next.js",
        description: "Full-stack React framework with SSR",
        package: "@bugwatch/nextjs",
        docsUrl: "https://docs.bugwatch.dev/sdks/nextjs",
      },
      {
        id: "react",
        name: "React",
        description: "Client-side React applications",
        package: "@bugwatch/react",
        docsUrl: "https://docs.bugwatch.dev/sdks/react",
      },
      {
        id: "node",
        name: "Node.js",
        description: "Server-side Node.js applications",
        package: "@bugwatch/node",
        docsUrl: "https://docs.bugwatch.dev/sdks/node",
      },
      {
        id: "core",
        name: "Browser / Vanilla JS",
        description: "Plain JavaScript in the browser",
        package: "@bugwatch/core",
        docsUrl: "https://docs.bugwatch.dev/sdks/core",
      },
    ],
  },
  {
    id: "python",
    name: "Python",
    description: "Django, Flask, FastAPI, Celery",
    icon: "python",
    frameworks: [
      {
        id: "django",
        name: "Django",
        description: "Python web framework for perfectionists",
        package: "bugwatch[django]",
        docsUrl: "https://docs.bugwatch.dev/sdks/python/django",
      },
      {
        id: "flask",
        name: "Flask",
        description: "Lightweight Python web framework",
        package: "bugwatch[flask]",
        docsUrl: "https://docs.bugwatch.dev/sdks/python/flask",
      },
      {
        id: "fastapi",
        name: "FastAPI",
        description: "Modern async Python API framework",
        package: "bugwatch[fastapi]",
        docsUrl: "https://docs.bugwatch.dev/sdks/python/fastapi",
      },
      {
        id: "celery",
        name: "Celery",
        description: "Distributed task queue",
        package: "bugwatch[celery]",
        docsUrl: "https://docs.bugwatch.dev/sdks/python/celery",
      },
    ],
  },
  {
    id: "rust",
    name: "Rust",
    description: "Blocking and async Rust applications",
    icon: "rust",
    frameworks: [
      {
        id: "async",
        name: "Async Rust",
        description: "Tokio/async-std based applications",
        package: "bugwatch",
        docsUrl: "https://docs.bugwatch.dev/sdks/rust",
      },
      {
        id: "blocking",
        name: "Blocking Rust",
        description: "Synchronous Rust applications",
        package: "bugwatch",
        docsUrl: "https://docs.bugwatch.dev/sdks/rust",
      },
    ],
  },
];

export function getPlatformConfig(platformId: Platform): PlatformConfig | undefined {
  return PLATFORMS.find((p) => p.id === platformId);
}

export function getFrameworkConfig(
  platformId: Platform,
  frameworkId: Framework
): FrameworkConfig | undefined {
  const platform = getPlatformConfig(platformId);
  return platform?.frameworks.find((f) => f.id === frameworkId);
}

// SDK Content for each framework
export const SDK_CONTENT: Record<string, SDKContent> = {
  // JavaScript - Next.js
  "javascript:nextjs": {
    platform: "javascript",
    framework: "nextjs",
    packageName: "@bugwatch/nextjs",
    installCommands: {
      npm: "npm install @bugwatch/nextjs",
      yarn: "yarn add @bugwatch/nextjs",
      pnpm: "pnpm add @bugwatch/nextjs",
    },
    configSteps: [
      {
        title: "Configure Next.js",
        description: "Wrap your Next.js config with the Bugwatch plugin",
        filename: "next.config.js",
        code: `const { withBugwatch } = require('@bugwatch/nextjs');

module.exports = withBugwatch({
  apiKey: '{{API_KEY}}',
})({
  // your existing next config
});`,
        language: "javascript",
      },
      {
        title: "Add Error Boundary (Optional)",
        description: "Wrap your app with BugwatchProvider for enhanced error tracking",
        filename: "app/layout.tsx",
        code: `import { BugwatchProvider } from '@bugwatch/nextjs/client';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <BugwatchProvider>
          {children}
        </BugwatchProvider>
      </body>
    </html>
  );
}`,
        language: "typescript",
      },
    ],
    verificationCode: `import { captureException } from '@bugwatch/nextjs';

// Test your integration
captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "https://docs.bugwatch.dev/sdks/nextjs",
  },

  // JavaScript - React
  "javascript:react": {
    platform: "javascript",
    framework: "react",
    packageName: "@bugwatch/react",
    installCommands: {
      npm: "npm install @bugwatch/react",
      yarn: "yarn add @bugwatch/react",
      pnpm: "pnpm add @bugwatch/react",
    },
    configSteps: [
      {
        title: "Wrap Your App",
        description: "Add BugwatchProvider at the root of your application",
        filename: "src/main.tsx",
        code: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BugwatchProvider } from '@bugwatch/react';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BugwatchProvider apiKey="{{API_KEY}}">
      <App />
    </BugwatchProvider>
  </React.StrictMode>
);`,
        language: "typescript",
      },
      {
        title: "Add Error Boundary (Optional)",
        description: "Catch errors in your component tree",
        filename: "src/App.tsx",
        code: `import { BugwatchErrorBoundary } from '@bugwatch/react';

function App() {
  return (
    <BugwatchErrorBoundary fallback={<ErrorFallback />}>
      <YourApp />
    </BugwatchErrorBoundary>
  );
}`,
        language: "typescript",
      },
    ],
    verificationCode: `import { captureException } from '@bugwatch/react';

// Test your integration
captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "https://docs.bugwatch.dev/sdks/react",
  },

  // JavaScript - Node.js
  "javascript:node": {
    platform: "javascript",
    framework: "node",
    packageName: "@bugwatch/node",
    installCommands: {
      npm: "npm install @bugwatch/node",
      yarn: "yarn add @bugwatch/node",
      pnpm: "pnpm add @bugwatch/node",
    },
    configSteps: [
      {
        title: "Initialize at Startup",
        description: "Initialize Bugwatch at the entry point of your application",
        filename: "index.js",
        code: `const Bugwatch = require('@bugwatch/node');

Bugwatch.init({
  apiKey: '{{API_KEY}}',
  environment: process.env.NODE_ENV,
});

// Your application code...`,
        language: "javascript",
      },
      {
        title: "Express Middleware (Optional)",
        description: "Add error handling middleware for Express apps",
        filename: "app.js",
        code: `const express = require('express');
const { expressErrorHandler } = require('@bugwatch/node');

const app = express();

// Your routes...

// Add Bugwatch error handler last
app.use(expressErrorHandler());`,
        language: "javascript",
      },
    ],
    verificationCode: `const Bugwatch = require('@bugwatch/node');

// Test your integration
Bugwatch.captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "https://docs.bugwatch.dev/sdks/node",
  },

  // JavaScript - Core/Browser
  "javascript:core": {
    platform: "javascript",
    framework: "core",
    packageName: "@bugwatch/core",
    installCommands: {
      npm: "npm install @bugwatch/core",
      yarn: "yarn add @bugwatch/core",
      pnpm: "pnpm add @bugwatch/core",
    },
    configSteps: [
      {
        title: "Initialize Bugwatch",
        description: "Add this script to your HTML or JavaScript entry point",
        filename: "index.js",
        code: `import { BugwatchClient } from '@bugwatch/core';

const bugwatch = new BugwatchClient({
  apiKey: '{{API_KEY}}',
  environment: 'production',
});

// Global error handling is automatically set up
bugwatch.init();`,
        language: "javascript",
      },
    ],
    verificationCode: `import { captureException } from '@bugwatch/core';

// Test your integration
captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "https://docs.bugwatch.dev/sdks/core",
  },

  // Python - Django
  "python:django": {
    platform: "python",
    framework: "django",
    packageName: "bugwatch[django]",
    installCommands: {
      pip: "pip install bugwatch[django]",
      poetry: "poetry add bugwatch[django]",
    },
    configSteps: [
      {
        title: "Configure Django Settings",
        description: "Add Bugwatch to your Django settings",
        filename: "settings.py",
        code: `import bugwatch

bugwatch.init(
    api_key="{{API_KEY}}",
    environment="production",
)

MIDDLEWARE = [
    'bugwatch.django.BugwatchMiddleware',
    # ... other middleware
]`,
        language: "python",
      },
    ],
    verificationCode: `import bugwatch

# Test your integration
bugwatch.capture_exception(Exception('Test error from Bugwatch'))`,
    docsUrl: "https://docs.bugwatch.dev/sdks/python/django",
  },

  // Python - Flask
  "python:flask": {
    platform: "python",
    framework: "flask",
    packageName: "bugwatch[flask]",
    installCommands: {
      pip: "pip install bugwatch[flask]",
      poetry: "poetry add bugwatch[flask]",
    },
    configSteps: [
      {
        title: "Initialize Flask Integration",
        description: "Add Bugwatch to your Flask app",
        filename: "app.py",
        code: `from flask import Flask
from bugwatch.flask import BugwatchFlask

app = Flask(__name__)
BugwatchFlask(app, api_key="{{API_KEY}}")

@app.route('/')
def hello():
    return 'Hello, World!'`,
        language: "python",
      },
    ],
    verificationCode: `import bugwatch

# Test your integration
bugwatch.capture_exception(Exception('Test error from Bugwatch'))`,
    docsUrl: "https://docs.bugwatch.dev/sdks/python/flask",
  },

  // Python - FastAPI
  "python:fastapi": {
    platform: "python",
    framework: "fastapi",
    packageName: "bugwatch[fastapi]",
    installCommands: {
      pip: "pip install bugwatch[fastapi]",
      poetry: "poetry add bugwatch[fastapi]",
    },
    configSteps: [
      {
        title: "Initialize FastAPI Integration",
        description: "Add Bugwatch to your FastAPI app",
        filename: "main.py",
        code: `from fastapi import FastAPI
from bugwatch.fastapi import BugwatchFastAPI

app = FastAPI()
BugwatchFastAPI(app, api_key="{{API_KEY}}")

@app.get("/")
async def root():
    return {"message": "Hello World"}`,
        language: "python",
      },
    ],
    verificationCode: `import bugwatch

# Test your integration
bugwatch.capture_exception(Exception('Test error from Bugwatch'))`,
    docsUrl: "https://docs.bugwatch.dev/sdks/python/fastapi",
  },

  // Python - Celery
  "python:celery": {
    platform: "python",
    framework: "celery",
    packageName: "bugwatch[celery]",
    installCommands: {
      pip: "pip install bugwatch[celery]",
      poetry: "poetry add bugwatch[celery]",
    },
    configSteps: [
      {
        title: "Configure Celery",
        description: "Add Bugwatch to your Celery configuration",
        filename: "celery.py",
        code: `from celery import Celery
import bugwatch
from bugwatch.celery import BugwatchCelery

bugwatch.init(api_key="{{API_KEY}}")

app = Celery('tasks')
BugwatchCelery(app)

@app.task
def add(x, y):
    return x + y`,
        language: "python",
      },
    ],
    verificationCode: `import bugwatch

# Test your integration
bugwatch.capture_exception(Exception('Test error from Bugwatch'))`,
    docsUrl: "https://docs.bugwatch.dev/sdks/python/celery",
  },

  // Rust - Async
  "rust:async": {
    platform: "rust",
    framework: "async",
    packageName: "bugwatch",
    installCommands: {
      cargo: 'cargo add bugwatch --features "async"',
    },
    configSteps: [
      {
        title: "Add to Cargo.toml",
        description: "Add Bugwatch with async feature",
        filename: "Cargo.toml",
        code: `[dependencies]
bugwatch = { version = "0.1", features = ["async"] }`,
        language: "toml",
      },
      {
        title: "Initialize in main.rs",
        description: "Set up Bugwatch at application startup",
        filename: "src/main.rs",
        code: `use bugwatch::{BugwatchClient, BugwatchOptions};

#[tokio::main]
async fn main() {
    let client = BugwatchClient::new(BugwatchOptions {
        api_key: "{{API_KEY}}".to_string(),
        environment: Some("production".to_string()),
        ..Default::default()
    });

    // Install panic hook for automatic error capture
    bugwatch::install_panic_hook(client.clone());

    // Your application code...
}`,
        language: "rust",
      },
    ],
    verificationCode: `use bugwatch::BugwatchClient;

// Test your integration
client.capture_error("Test error from Bugwatch").await;`,
    docsUrl: "https://docs.bugwatch.dev/sdks/rust",
  },

  // Rust - Blocking
  "rust:blocking": {
    platform: "rust",
    framework: "blocking",
    packageName: "bugwatch",
    installCommands: {
      cargo: 'cargo add bugwatch --features "blocking"',
    },
    configSteps: [
      {
        title: "Add to Cargo.toml",
        description: "Add Bugwatch with blocking feature",
        filename: "Cargo.toml",
        code: `[dependencies]
bugwatch = { version = "0.1", features = ["blocking"] }`,
        language: "toml",
      },
      {
        title: "Initialize in main.rs",
        description: "Set up Bugwatch at application startup",
        filename: "src/main.rs",
        code: `use bugwatch::{BugwatchClient, BugwatchOptions};

fn main() {
    let client = BugwatchClient::new_blocking(BugwatchOptions {
        api_key: "{{API_KEY}}".to_string(),
        environment: Some("production".to_string()),
        ..Default::default()
    });

    // Install panic hook for automatic error capture
    bugwatch::install_panic_hook(client.clone());

    // Your application code...
}`,
        language: "rust",
      },
    ],
    verificationCode: `use bugwatch::BugwatchClient;

// Test your integration
client.capture_error_blocking("Test error from Bugwatch");`,
    docsUrl: "https://docs.bugwatch.dev/sdks/rust",
  },
};

export function getSDKContent(
  platform: Platform,
  framework: Framework
): SDKContent | undefined {
  return SDK_CONTENT[`${platform}:${framework}`];
}

export function interpolateApiKey(code: string, apiKey: string): string {
  return code.replace(/\{\{API_KEY\}\}/g, apiKey);
}

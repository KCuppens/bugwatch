import type { Platform, Framework } from "./api";

export interface PlatformConfig {
  id: Platform;
  name: string;
  description: string;
  icon: "javascript" | "python" | "rust" | "go" | "java" | "ruby" | "php";
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
  go?: string;
  maven?: string;
  gradle?: string;
  gem?: string;
  bundler?: string;
  composer?: string;
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
    description: "Browser, Node.js, Next.js, React, Express, Fastify",
    icon: "javascript",
    frameworks: [
      {
        id: "nextjs",
        name: "Next.js",
        description: "Full-stack React framework with SSR",
        package: "@bugwatch/nextjs",
        docsUrl: "/docs/sdks/javascript/nextjs",
      },
      {
        id: "react",
        name: "React",
        description: "Client-side React applications",
        package: "@bugwatch/react",
        docsUrl: "/docs/sdks/javascript/react",
      },
      {
        id: "node",
        name: "Node.js",
        description: "Server-side Node.js applications",
        package: "@bugwatch/node",
        docsUrl: "/docs/sdks/javascript/node",
      },
      {
        id: "express",
        name: "Express",
        description: "Minimal Node.js web framework",
        package: "@bugwatch/express",
        docsUrl: "/docs/sdks/javascript/express",
      },
      {
        id: "fastify",
        name: "Fastify",
        description: "Fast, low-overhead Node.js framework",
        package: "@bugwatch/fastify",
        docsUrl: "/docs/sdks/javascript/fastify",
      },
      {
        id: "core",
        name: "Browser / Vanilla JS",
        description: "Plain JavaScript in the browser",
        package: "@bugwatch/core",
        docsUrl: "/docs/sdks/javascript/core",
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
        docsUrl: "/docs/sdks/python/django",
      },
      {
        id: "flask",
        name: "Flask",
        description: "Lightweight Python web framework",
        package: "bugwatch[flask]",
        docsUrl: "/docs/sdks/python/flask",
      },
      {
        id: "fastapi",
        name: "FastAPI",
        description: "Modern async Python API framework",
        package: "bugwatch[fastapi]",
        docsUrl: "/docs/sdks/python/fastapi",
      },
      {
        id: "celery",
        name: "Celery",
        description: "Distributed task queue",
        package: "bugwatch[celery]",
        docsUrl: "/docs/sdks/python/celery",
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
        docsUrl: "/docs/sdks/rust",
      },
      {
        id: "blocking",
        name: "Blocking Rust",
        description: "Synchronous Rust applications",
        package: "bugwatch",
        docsUrl: "/docs/sdks/rust",
      },
    ],
  },
  {
    id: "go",
    name: "Go",
    description: "net/http, Gin, Echo",
    icon: "go",
    frameworks: [
      {
        id: "net_http",
        name: "net/http",
        description: "Go standard library HTTP server",
        package: "github.com/KCuppens/bugwatch-go",
        docsUrl: "/docs/sdks/go",
      },
      {
        id: "gin",
        name: "Gin",
        description: "High-performance HTTP web framework",
        package: "github.com/KCuppens/bugwatch-go",
        docsUrl: "/docs/sdks/go/gin",
      },
      {
        id: "echo",
        name: "Echo",
        description: "Minimalist Go web framework",
        package: "github.com/KCuppens/bugwatch-go",
        docsUrl: "/docs/sdks/go/echo",
      },
    ],
  },
  {
    id: "java",
    name: "Java",
    description: "Spring Boot",
    icon: "java",
    frameworks: [
      {
        id: "spring",
        name: "Spring Boot",
        description: "Java application framework",
        package: "dev.bugwatch:bugwatch-spring",
        docsUrl: "/docs/sdks/java/spring",
      },
    ],
  },
  {
    id: "ruby",
    name: "Ruby",
    description: "Rack, Rails, Sidekiq",
    icon: "ruby",
    frameworks: [
      {
        id: "rack",
        name: "Rack",
        description: "Ruby web server interface",
        package: "bugwatch",
        docsUrl: "/docs/sdks/ruby",
      },
      {
        id: "rails",
        name: "Rails",
        description: "Full-stack Ruby web framework",
        package: "bugwatch",
        docsUrl: "/docs/sdks/ruby/rails",
      },
      {
        id: "sidekiq",
        name: "Sidekiq",
        description: "Background job processing",
        package: "bugwatch",
        docsUrl: "/docs/sdks/ruby/sidekiq",
      },
    ],
  },
  {
    id: "php",
    name: "PHP",
    description: "Laravel, Symfony",
    icon: "php",
    frameworks: [
      {
        id: "laravel",
        name: "Laravel",
        description: "PHP web application framework",
        package: "bugwatch/sdk",
        docsUrl: "/docs/sdks/php/laravel",
      },
      {
        id: "symfony",
        name: "Symfony",
        description: "PHP framework for web applications",
        package: "bugwatch/sdk",
        docsUrl: "/docs/sdks/php/symfony",
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
        filename: "next.config.ts",
        code: `import { withBugwatch } from '@bugwatch/nextjs';

export default withBugwatch({
  apiKey: '{{API_KEY}}',
})({
  // your existing next config
});`,
        language: "typescript",
      },
      {
        title: "Set Up Instrumentation",
        description: "Register Bugwatch for server-side error capture",
        filename: "instrumentation.ts",
        code: `import { registerBugwatch } from '@bugwatch/nextjs';

export function register() {
  registerBugwatch();
}`,
        language: "typescript",
      },
      {
        title: "Add Error Boundary (Optional)",
        description: "Wrap your app with BugwatchProvider for enhanced client-side error tracking",
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
    docsUrl: "/docs/sdks/javascript/nextjs",
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
        code: `import { BugwatchErrorBoundary, useBugwatch } from '@bugwatch/react';

function App() {
  // Access Bugwatch client anywhere via hook
  const { captureException } = useBugwatch();

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
    docsUrl: "/docs/sdks/javascript/react",
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
        code: `import { setup } from '@bugwatch/node';

setup({
  apiKey: '{{API_KEY}}',
  environment: process.env.NODE_ENV,
});

// Your application code...`,
        language: "javascript",
      },
    ],
    verificationCode: `import { captureException } from '@bugwatch/node';

// Test your integration
captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "/docs/sdks/javascript/node",
  },

  // JavaScript - Express
  "javascript:express": {
    platform: "javascript",
    framework: "express",
    packageName: "@bugwatch/express",
    installCommands: {
      npm: "npm install @bugwatch/express",
      yarn: "yarn add @bugwatch/express",
      pnpm: "pnpm add @bugwatch/express",
    },
    configSteps: [
      {
        title: "Set Up Express Integration",
        description: "Add Bugwatch error tracking to your Express app",
        filename: "app.js",
        code: `import { setup } from '@bugwatch/express';
import express from 'express';

const app = express();

setup(app, {
  apiKey: '{{API_KEY}}',
});

// Your routes...

app.listen(3000);`,
        language: "javascript",
      },
    ],
    verificationCode: `import { captureException } from '@bugwatch/express';

// Test your integration
captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "/docs/sdks/javascript/express",
  },

  // JavaScript - Fastify
  "javascript:fastify": {
    platform: "javascript",
    framework: "fastify",
    packageName: "@bugwatch/fastify",
    installCommands: {
      npm: "npm install @bugwatch/fastify",
      yarn: "yarn add @bugwatch/fastify",
      pnpm: "pnpm add @bugwatch/fastify",
    },
    configSteps: [
      {
        title: "Set Up Fastify Integration",
        description: "Add Bugwatch error tracking to your Fastify app",
        filename: "app.js",
        code: `import { setup } from '@bugwatch/fastify';
import Fastify from 'fastify';

const fastify = Fastify();

await setup(fastify, {
  apiKey: '{{API_KEY}}',
});

// Your routes...

await fastify.listen({ port: 3000 });`,
        language: "javascript",
      },
    ],
    verificationCode: `import { captureException } from '@bugwatch/fastify';

// Test your integration
captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "/docs/sdks/javascript/fastify",
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
        code: `import { init, captureException } from '@bugwatch/core';

init({
  apiKey: '{{API_KEY}}',
  environment: 'production',
});

// Global error handling is automatically set up`,
        language: "javascript",
      },
    ],
    verificationCode: `import { captureException } from '@bugwatch/core';

// Test your integration
captureException(new Error('Test error from Bugwatch'));`,
    docsUrl: "/docs/sdks/javascript/core",
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
    docsUrl: "/docs/sdks/python/django",
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
    docsUrl: "/docs/sdks/python/flask",
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
    docsUrl: "/docs/sdks/python/fastapi",
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
    docsUrl: "/docs/sdks/python/celery",
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
bugwatch = { version = "0.2", features = ["async"] }`,
        language: "toml",
      },
      {
        title: "Initialize in main.rs",
        description: "Set up Bugwatch at application startup",
        filename: "src/main.rs",
        code: `use bugwatch::{init, BugwatchOptions};

#[tokio::main]
async fn main() {
    init(
        BugwatchOptions::new("{{API_KEY}}")
            .with_environment("production")
    );

    // Install panic hook for automatic error capture
    bugwatch::install_panic_hook();

    // Your application code...
}`,
        language: "rust",
      },
    ],
    verificationCode: `use bugwatch::capture_error;

// Test your integration
capture_error("Test error from Bugwatch").await;`,
    docsUrl: "/docs/sdks/rust",
  },

  // Go - net/http
  "go:net_http": {
    platform: "go",
    framework: "net_http",
    packageName: "github.com/KCuppens/bugwatch-go",
    installCommands: {
      go: "go get github.com/KCuppens/bugwatch-go",
    },
    configSteps: [
      {
        title: "Initialize Bugwatch",
        description: "Set up Bugwatch at application startup",
        filename: "main.go",
        code: `package main

import (
    "net/http"
    bugwatch "github.com/KCuppens/bugwatch-go"
    bwhttp "github.com/KCuppens/bugwatch-go/integrations/nethttp"
)

func main() {
    bugwatch.Init(&bugwatch.BugwatchOptions{
        ApiKey:      "{{API_KEY}}",
        Environment: "production",
    })
    defer bugwatch.Close()

    mux := http.NewServeMux()
    mux.HandleFunc("/", handler)

    http.ListenAndServe(":8080", bwhttp.Middleware(mux))
}`,
        language: "go",
      },
    ],
    verificationCode: `bugwatch.CaptureException(errors.New("Test error from Bugwatch"))`,
    docsUrl: "/docs/sdks/go",
  },

  // Go - Gin
  "go:gin": {
    platform: "go",
    framework: "gin",
    packageName: "github.com/KCuppens/bugwatch-go",
    installCommands: {
      go: "go get github.com/KCuppens/bugwatch-go",
    },
    configSteps: [
      {
        title: "Initialize with Gin",
        description: "Add Bugwatch middleware to your Gin router",
        filename: "main.go",
        code: `package main

import (
    bugwatch "github.com/KCuppens/bugwatch-go"
    bwgin "github.com/KCuppens/bugwatch-go/integrations/gin"
    "github.com/gin-gonic/gin"
)

func main() {
    bugwatch.Init(&bugwatch.BugwatchOptions{
        ApiKey:      "{{API_KEY}}",
        Environment: "production",
    })
    defer bugwatch.Close()

    r := gin.Default()
    r.Use(bwgin.Middleware())

    r.GET("/", func(c *gin.Context) {
        c.JSON(200, gin.H{"message": "hello"})
    })

    r.Run(":8080")
}`,
        language: "go",
      },
    ],
    verificationCode: `bugwatch.CaptureException(errors.New("Test error from Bugwatch"))`,
    docsUrl: "/docs/sdks/go/gin",
  },

  // Go - Echo
  "go:echo": {
    platform: "go",
    framework: "echo",
    packageName: "github.com/KCuppens/bugwatch-go",
    installCommands: {
      go: "go get github.com/KCuppens/bugwatch-go",
    },
    configSteps: [
      {
        title: "Initialize with Echo",
        description: "Add Bugwatch middleware to your Echo instance",
        filename: "main.go",
        code: `package main

import (
    bugwatch "github.com/KCuppens/bugwatch-go"
    bwecho "github.com/KCuppens/bugwatch-go/integrations/echo"
    "github.com/labstack/echo/v4"
)

func main() {
    bugwatch.Init(&bugwatch.BugwatchOptions{
        ApiKey:      "{{API_KEY}}",
        Environment: "production",
    })
    defer bugwatch.Close()

    e := echo.New()
    e.Use(bwecho.Middleware())

    e.GET("/", func(c echo.Context) error {
        return c.String(200, "Hello, World!")
    })

    e.Logger.Fatal(e.Start(":8080"))
}`,
        language: "go",
      },
    ],
    verificationCode: `bugwatch.CaptureException(errors.New("Test error from Bugwatch"))`,
    docsUrl: "/docs/sdks/go/echo",
  },

  // Java - Spring
  "java:spring": {
    platform: "java",
    framework: "spring",
    packageName: "dev.bugwatch:bugwatch-spring",
    installCommands: {
      maven: `<dependency>
  <groupId>dev.bugwatch</groupId>
  <artifactId>bugwatch-spring</artifactId>
  <version>0.1.0</version>
</dependency>`,
      gradle: `implementation 'dev.bugwatch:bugwatch-spring:0.1.0'`,
    },
    configSteps: [
      {
        title: "Configure application.yml",
        description: "Add Bugwatch configuration to your Spring Boot application",
        filename: "src/main/resources/application.yml",
        code: `bugwatch:
  api-key: "{{API_KEY}}"
  environment: "production"`,
        language: "yaml",
      },
      {
        title: "Auto-Configuration",
        description: "Spring Boot auto-configuration handles the rest. The Bugwatch filter and exception resolver are registered automatically.",
        code: `// No additional code needed!
// Bugwatch auto-configures via Spring Boot's auto-configuration.
// Exceptions in controllers are captured automatically.

// To capture exceptions manually:
import dev.bugwatch.Bugwatch;

Bugwatch.captureException(new RuntimeException("Test error"));`,
        language: "java",
      },
    ],
    verificationCode: `import dev.bugwatch.Bugwatch;

// Test your integration
Bugwatch.captureException(new RuntimeException("Test error from Bugwatch"));`,
    docsUrl: "/docs/sdks/java/spring",
  },

  // Ruby - Rack
  "ruby:rack": {
    platform: "ruby",
    framework: "rack",
    packageName: "bugwatch",
    installCommands: {
      gem: "gem install bugwatch",
      bundler: `gem "bugwatch"`,
    },
    configSteps: [
      {
        title: "Initialize and Add Middleware",
        description: "Add Bugwatch Rack middleware to your application",
        filename: "config.ru",
        code: `require "bugwatch"

Bugwatch.init(
  api_key: "{{API_KEY}}",
  environment: "production"
)

use Bugwatch::Rack::Middleware
run MyApp`,
        language: "ruby",
      },
    ],
    verificationCode: `require "bugwatch"

# Test your integration
Bugwatch.capture_exception(RuntimeError.new("Test error from Bugwatch"))`,
    docsUrl: "/docs/sdks/ruby",
  },

  // Ruby - Rails
  "ruby:rails": {
    platform: "ruby",
    framework: "rails",
    packageName: "bugwatch",
    installCommands: {
      gem: "gem install bugwatch",
      bundler: `gem "bugwatch"`,
    },
    configSteps: [
      {
        title: "Configure Rails Initializer",
        description: "Add Bugwatch configuration to a Rails initializer",
        filename: "config/initializers/bugwatch.rb",
        code: `Bugwatch.init(
  api_key: "{{API_KEY}}",
  environment: Rails.env
)`,
        language: "ruby",
      },
      {
        title: "Auto-Configuration",
        description: "The Bugwatch Railtie automatically inserts Rack middleware and detects your Rails environment. No additional setup needed.",
        code: `# Bugwatch automatically:
# - Inserts Rack middleware for request context
# - Captures unhandled exceptions
# - Detects Rails.env as the environment
# - Flushes events at shutdown`,
        language: "ruby",
      },
    ],
    verificationCode: `# Test your integration
Bugwatch.capture_exception(RuntimeError.new("Test error from Bugwatch"))`,
    docsUrl: "/docs/sdks/ruby/rails",
  },

  // Ruby - Sidekiq
  "ruby:sidekiq": {
    platform: "ruby",
    framework: "sidekiq",
    packageName: "bugwatch",
    installCommands: {
      gem: "gem install bugwatch",
      bundler: `gem "bugwatch"`,
    },
    configSteps: [
      {
        title: "Configure Sidekiq Error Handler",
        description: "Add Bugwatch error handler to Sidekiq",
        filename: "config/initializers/sidekiq.rb",
        code: `require "bugwatch"
require "bugwatch/integrations/sidekiq"

Bugwatch.init(
  api_key: "{{API_KEY}}",
  environment: "production"
)

Sidekiq.configure_server do |config|
  config.error_handlers << Bugwatch::Sidekiq::ErrorHandler.new
end`,
        language: "ruby",
      },
    ],
    verificationCode: `# Test your integration
Bugwatch.capture_exception(RuntimeError.new("Test error from Bugwatch"))`,
    docsUrl: "/docs/sdks/ruby/sidekiq",
  },

  // PHP - Laravel
  "php:laravel": {
    platform: "php",
    framework: "laravel",
    packageName: "bugwatch/sdk",
    installCommands: {
      composer: "composer require bugwatch/sdk",
    },
    configSteps: [
      {
        title: "Publish Configuration",
        description: "Publish the Bugwatch configuration file",
        code: `php artisan vendor:publish --provider="Bugwatch\\Integrations\\Laravel\\BugwatchServiceProvider"`,
        language: "bash",
      },
      {
        title: "Configure Environment",
        description: "Add your API key to .env",
        filename: ".env",
        code: `BUGWATCH_API_KEY={{API_KEY}}
BUGWATCH_ENVIRONMENT=production`,
        language: "bash",
      },
      {
        title: "Auto-Configuration",
        description: "Laravel auto-discovers the service provider. Exceptions are captured automatically.",
        code: `<?php
// No additional code needed!
// The service provider is auto-discovered via composer.json.
// To capture exceptions manually:

use Bugwatch\\Bugwatch;

Bugwatch::captureException(new \\RuntimeException("Test error"));`,
        language: "php",
      },
    ],
    verificationCode: `<?php
use Bugwatch\\Bugwatch;

// Test your integration
Bugwatch::captureException(new \\RuntimeException("Test error from Bugwatch"));`,
    docsUrl: "/docs/sdks/php/laravel",
  },

  // PHP - Symfony
  "php:symfony": {
    platform: "php",
    framework: "symfony",
    packageName: "bugwatch/sdk",
    installCommands: {
      composer: "composer require bugwatch/sdk",
    },
    configSteps: [
      {
        title: "Register Bundle",
        description: "Add the Bugwatch bundle to your Symfony application",
        filename: "config/bundles.php",
        code: `<?php

return [
    // ...
    Bugwatch\\Integrations\\Symfony\\BugwatchBundle::class => ['all' => true],
];`,
        language: "php",
      },
      {
        title: "Configure",
        description: "Add Bugwatch configuration",
        filename: "config/packages/bugwatch.yaml",
        code: `bugwatch:
  api_key: "%env(BUGWATCH_API_KEY)%"
  environment: "%kernel.environment%"`,
        language: "yaml",
      },
    ],
    verificationCode: `<?php
use Bugwatch\\Bugwatch;

// Test your integration
Bugwatch::captureException(new \\RuntimeException("Test error from Bugwatch"));`,
    docsUrl: "/docs/sdks/php/symfony",
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
bugwatch = { version = "0.2", features = ["blocking"] }`,
        language: "toml",
      },
      {
        title: "Initialize in main.rs",
        description: "Set up Bugwatch at application startup",
        filename: "src/main.rs",
        code: `use bugwatch::{init, BugwatchOptions};

fn main() {
    init(
        BugwatchOptions::new("{{API_KEY}}")
            .with_environment("production")
    );

    // Install panic hook for automatic error capture
    bugwatch::install_panic_hook();

    // Your application code...
}`,
        language: "rust",
      },
    ],
    verificationCode: `use bugwatch::capture_error;

// Test your integration
capture_error("Test error from Bugwatch");`,
    docsUrl: "/docs/sdks/rust",
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

export const SERVER_MONITORING_CONTENT = {
  installCommand: `curl -sSL https://install.bugwatch.dev | bash -s -- --api-key {{API_KEY}}`,
  description:
    "Monitor your server's CPU, memory, disk, and network metrics with the Bugwatch agent.",
  requirements: "Requires Linux with systemd or cron.",
  managementCommands: [
    { label: "Check status", command: "systemctl status bugwatch-agent" },
    { label: "Restart agent", command: "systemctl restart bugwatch-agent" },
    { label: "Stop agent", command: "systemctl stop bugwatch-agent" },
  ],
};

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2025-05-15

### Added

- `onRequestError` hook in `@bugwatch/nextjs` for automatic server-side error capture
- Agent-first integration: API keys, MCP server, CLI, OpenAPI spec, webhooks, and documentation

### Changed

- Upgraded `@bugwatch/nextjs` to 0.4.1
- Pinned `@bugwatch/core` peer dependency to `^0.4.1` across all JS SDKs

### Fixed

- Unminified React production error codes in captured events for better readability

## [0.4.0] - 2025-05-10

### Added

- Rust SDK (`bugwatch` crate) with async and blocking clients
- Python SDK (`bugwatch-python`) with Django, Flask, FastAPI, and Celery integrations
- Server monitoring agent for CPU, memory, disk, and network metrics
- Uptime monitoring with configurable intervals and incident tracking

### Changed

- Bumped all JavaScript SDK packages to 0.4.0
- Bumped Rust SDK to 0.4.0
- Bumped Python SDK to 0.4.0

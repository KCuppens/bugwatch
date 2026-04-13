# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Bugwatch, please report it responsibly.

**Email:** security@bugwatch.dev

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **48 hours**: We will acknowledge your report
- **7 days**: We will provide an initial assessment
- **30 days**: We aim to release a fix for confirmed vulnerabilities

## Scope

The following are in scope:
- Bugwatch API server (`apps/server`)
- Bugwatch web dashboard (`apps/web`)
- Official SDKs (`packages/sdk`)
- Official Docker images
- Authentication and authorization flows
- Data handling and storage

## Out of Scope

- Social engineering attacks
- Denial-of-service attacks
- Vulnerabilities in third-party dependencies (report these upstream)
- Issues in environments running unsupported or heavily modified versions

## Recognition

We credit security researchers who follow responsible disclosure in our release notes and changelog (unless you prefer to remain anonymous).

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | Best effort |

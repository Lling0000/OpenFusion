# Security Policy

OpenFusion is a local orchestration gateway. It may receive prompts, code snippets, tool results, and API relay credentials from your development environment.

## Supported Versions

OpenFusion is currently pre-1.0. Security fixes will target the `main` branch.

## Reporting A Vulnerability

Please open a GitHub security advisory or contact the repository owner through GitHub if you find a vulnerability.

Do not post real API keys, private relay URLs with embedded credentials, private prompts, or sensitive logs in public issues.

## Handling Secrets

- Use environment variables for upstream API keys.
- Keep `openfusion.config.json` local; it is ignored by `.gitignore`.
- Run `npm run check` before publishing changes.
- Dry-run mode sends no prompt data upstream.

## Scope

Relevant issues include:

- Secret leakage through logs, traces, or docs.
- Incorrect forwarding of authorization headers.
- Unsafe handling of tool-call payloads.
- Unexpected prompt fanout to more upstream models than documented.
- CORS or local server behavior that exposes private data unexpectedly.

OpenFusion does not execute tools by itself today. Tool execution remains the responsibility of the calling agent/client.

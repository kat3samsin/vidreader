# Security

VidReader is intended for one person on localhost. The public source runs without an app login and does not provide multi-user hosting.

## Access and data

- The server binds to `127.0.0.1` and rejects clients outside loopback.
- Optional AI sessions use the local server owner's credentials. Keep this personal instance on your own machine.
- Host validation and same-origin request checks protect against DNS rebinding and browser cross-origin requests. AI endpoints accept same-origin JSON POST requests only.
- Channel resolution accepts fixed HTTPS YouTube hosts and supported channel paths. Redirects are refused. Subprocesses receive argument arrays and validated video/channel IDs.
- The static-file allowlist excludes source, caches, configuration and credentials. API responses are not cached. Provider errors omit raw response bodies and subprocess diagnostics.
- Captions and reading preferences remain local. An explicit AI action sends the selected transcript to the chosen provider. API keys use separate browser session-storage entries for each provider. Remote playback and fonts contact their respective providers.
- Disconnecting an AI request cancels its outgoing request and stops later cleanup chunks or retries. A provider may still charge for work it received before cancellation.
- Response policy blocks inline scripts, framing, object embeds and unrestricted script/network origins. AI-generated text is escaped before rendering.

Public hosting would require a separate design for HTTPS, individual authentication, authorization, secrets, quotas and data isolation. These are not implemented here.

## Dependencies

Use the current Node.js 24 LTS patch release. The server requires Node.js 24.21.0 or newer within the 24 release line. Node releases and security fixes are listed on the [official security release page](https://nodejs.org/en/blog/vulnerability). Keep the installed Python runtime on a supported patch release too.

Python runtime dependencies are pinned with package hashes in `requirements.txt`. To update the lockfile after changing `requirements.in`:

```sh
uv pip compile --index-url https://pypi.org/simple --no-header --no-emit-index-url --generate-hashes requirements.in -o requirements.txt
```

Audit the lockfile with `pip-audit -r requirements.txt` and check [yt-dlp advisories](https://github.com/yt-dlp/yt-dlp/security/advisories). Run `npm test` after updating. A clean dependency audit covers known advisories, not every possible defect.

## Source distribution

Use `npm run export:public` to create the source distribution. The allowlist deliberately excludes local data, credentials, browser logs, screenshots, archives and development-only tooling. Check the generated folder with a secret scanner before uploading it. Do not publish the whole working directory or an installed virtual environment.

Review staged files and scan Git history before making a remote public. Never place real tokens or private content in issues or test fixtures.

For repositories hosted on GitHub with private vulnerability reporting enabled, use **Security → Report a vulnerability**. Maintainers should [enable this when publishing the repository](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository). Share a minimal reproduction using synthetic credentials and data. Do not put credentials or an unpatched exploit in a public issue.

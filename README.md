# VidReader

A personal, caption-first video reader. Paste a public YouTube link to read its English captions, follow channels, or choose an AI provider for a distillation. Captions are cached locally. Focus mode keeps the full transcript and can validate an optional AI punctuation pass against the original words.

## Run locally

Install Node.js 24.21.0 or a newer Node.js 24 release, a current Python 3.11 or newer patch release, and a Python virtual environment. The server refuses unsupported Node versions:

```sh
nvm install
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip setuptools
.venv/bin/python -m pip install --require-hashes -r requirements.txt
npm start
```

Open http://127.0.0.1:4173. The app has no npm dependencies. `yt-dlp` and its Python dependencies are pinned with hashes in `requirements.txt`. Node supplies its JavaScript runtime.

## Local access

VidReader runs on `127.0.0.1:4173` without a login. It accepts connections from the local machine and rejects network clients. Keep it local because its optional integrations use the server owner's credentials. Host and origin checks remain enabled.

## Optional AI

AI actions run only when you choose one. API keys entered in settings stay in the browser's session storage, stored separately for each provider, and are sent to the local server for that provider's request. Session providers use the server owner's existing local credentials. Closing or reloading the tab cancels pending AI requests and stops subsequent cleanup chunks.

## Check and share the source

```sh
npm test
npm run export:public
```

The export command creates a source folder and `.tar.gz` archive under `dist/` using an explicit file list. Share that archive. It excludes `.env.local`, caption caches, virtual environments, browser captures, local agent tooling, design archives, and private planning files.

Run a secret scan on each generated source folder before publishing, for example with Gitleaks. Rebuild the export after changing the source. See [SECURITY.md](SECURITY.md) for security boundaries and dependency checks.

Before publishing, choose a project license. For a GitHub release, enable private vulnerability reporting in the repository's security settings once it is public. No project license has been selected.

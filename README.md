# Project Brain

Project Brain is a memory-first project manager for teams using AI to build software. It keeps a "spiderweb" of intent and decisions (memories), streams host files to collaborators, and gives everyone a large AI + file Workbench to make changes with context.

## What's Here
- Projects with a selectable local folder "project root" (host is source-of-truth)
- Memory graph ("spiderweb") with auto-memories created from file edits
- Bottom Workbench (always big): `Files` editor + `AI` console with structured edits
- Collaboration roles: viewer, suggester, editor, admin (host approves join requests)
- Conflict handling: detect merge failures and generate a median (best-effort) for host/admin/editor
- Local LLM options:
  - Local (Ollama) if installed
  - Built-in local server for downloadable `.gguf` models (download is manual; nothing auto-downloads)
- OpenAI Codex option (bring your own API key)

## Prereqs
- Windows 10/11
- Node.js 18+ recommended

## Run (Dev)

```bash
npm install
npm run dev
```

## Build (Windows)

Build an installer (when supported on your machine):

```bash
npm run dist
```

If the installer build fails, you can still generate a portable build directory:

```bash
npm run pack
```

Portable output is typically in `release2/win-unpacked/Project Brain.exe`.

## Collaboration Signaling (Optional, Internet-Wide)

Deploy the Cloudflare Worker in `signaling/worker.js` and paste the resulting `wss://` URL into the app's Collaboration settings.

# Project Brain Signaling (Cloudflare Workers)

This is the lightweight signaling server for Project Brain. It only handles WebRTC connection metadata. Project data stays peer-to-peer and encrypted.

## Deploy (free)

1. Install Wrangler

```bash
npm install -g wrangler
```

2. Login

```bash
wrangler login
```

3. Create a new Worker

```bash
wrangler init project-brain-signal
```

4. Replace the generated `src/index.js` with `signaling/worker.js`.

5. Publish

```bash
wrangler deploy
```

6. Copy the `wss://` URL from Wrangler output and paste it into the app's Collaboration settings.

## Notes
- This worker stores connection state in memory for active sessions only.
- For long-running production usage, upgrade to a Durable Object for persistence.

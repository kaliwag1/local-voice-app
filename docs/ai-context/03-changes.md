# 03 — Changes from upstream (newest first)

Each entry: what, why, where. Keep this in sync with commits on `jake/local-voice-app`.

## 2026-09-17 — local Health page
- Added **Settings → Health** with manual refresh and a 10-second refresh while visible.
  Shows LM Studio's loaded models and actual loaded context (separate from model maximum),
  NVIDIA device-wide VRAM used/free/total, Gateway and voice connection status, OpenCode API
  health and agent connection, and local listening ports. Missing readings are explicitly unavailable.
- Diagnostics only contact loopback services; subprocesses use `windowsHide` and timeouts.
  Uses the configured speech/Gateway URLs and `OPENCODE_PORT`, and LM Studio's v1 API with
  v0 fallback. Source: `health-diagnostics.mjs`, `health-panel.js`, Settings HTML/CSS/JS and IPC.
- Unit tests and renderer dependency checks pass. Live collector read Gemma with 32768 context,
  NVIDIA memory, and speech listening successfully. Packaged Settings still needs a Windows rebuild
  and visual check. No services were started or restarted for diagnosis.

## 2026-09-17 — chat titles (Claude draft finished with Codex)
- **Local chat titles** — the Gateway asks the selected LM Studio model for a short title after the
  first user/assistant exchange, stores it in each session's `meta.json`, and retries briefly if
  LM Studio is still starting. It never uses the optional cloud text model. `conversation-titler.mjs`,
  `gateway-application.mjs`, `session-summaries.mjs`.
- **Rename and pin in the chat sidebar** — double-click a title or use the rename action, then Enter
  or click away to save; Escape cancels. Pin/unpin keeps important chats at the top. `web/src/App.jsx`,
  `styles.css`. Server-side tests and web build pass; desktop rebuild and live check remain.

## 2026-09-17 — session with Claude (Cowork)
- **Task cards show the files they touched** with an "Open folder" button (reveals in Explorer via
  `qwen-audio-agent:reveal-path` IPC; absolute + existing paths only). Paths come from ACP tool-call
  `locations`/`rawInput` and from paths parsed out of shell commands; written paths are preferred over
  read-only ones. `backend-session-utils.mjs` (`pathsFromToolCall`), `web/src/task-view.js` (`taskFiles`),
  `App.jsx`, `preload.cjs`, `main.mjs`.
- **Search results in English** — Bing provider had `mkt=zh-CN` hard-coded. Now `QWEN_AUDIO_WEB_SEARCH_MARKET`
  (set to `en-GB` in `config.env`) + `setlang`. `server/src/frontend/retrieval/providers/bing.mjs`.
- **Stop button** in the composer — interrupts the spoken/streamed reply and cancels running tasks via
  `DELETE /api/tasks/:id`. `web/src/App.jsx`, `web/src/composer/MultimodalComposer.jsx`.
- **Settings: no false "Setup required"** — OpenCode with a local provider in `opencode.json` counts as set up
  (`shared/backend/auth-status.mjs`). **Updater** disabled for unpacked custom builds instead of raw ENOENT
  (`desktop/src/main.mjs`, `updater.mjs`, `settings.js`).
- **No stray terminal window** — three causes fixed: gateway children spawned with `windowsHide`
  (`process-client.mjs`), managed OpenCode server output piped to `gateway.log` instead of inheriting a
  non-existent console (`managed-backend.mjs`), and the computer-use MCP server launched with real
  `node.exe` instead of Electron-as-Node (`builtin-mcp.mjs`).
- **Agent instructions for OpenCode** — `~/.config/opencode/AGENTS.md` (also referenced from `opencode.json`
  `instructions`, copy in the qwaudio workspace): Desktop = OneDrive Desktop, etc.
- **Model switch fixes** (`desktop/src/local-model-switch.mjs`): BOM-tolerant config parsing; speech-service
  ownership matched by the stub's path on the command line; `--context-length` on load; OpenCode
  coordinator session reset on switch (`main.mjs` `resetBackendSessions`).
- **Chat archive/delete** — sidebar hover actions + "Archived (n)" section; `PATCH/DELETE /api/conversations/:id`;
  archive flag in `meta.json` beside each `session.jsonl`; delete refused while a task runs.
  `server/src/session/session-journal-registry.mjs`, `session-summaries.mjs`, `gateway-application.mjs`.
- **Launcher loads model with 32k context** (`Start My Voice App.ps1`) — OpenCode's prompt is ~9k tokens;
  LM Studio's default 8192 made every agent task fail with `exceed_context_size_error`.
- **Root cause of the original "Gateway exited unexpectedly"** — `OPENCODE_BIN` pointed to a path that only
  existed inside the OpenAI Codex sandbox; `scripts/runtime/opencode.mjs` masked the spawn failure with
  `process.exit(0)`. Fixed by installing OpenCode in the real session and making `opencode.mjs` fail loudly
  and propagate exit codes.

## Before 2026-09-17 (baseline customisations, by Jake with Codex)
- Saved-chat sidebar with session list, in-app LM Studio model picker, audio-file transcription with word
  timestamps (`web/src/AudioTranscriber.jsx`, `desktop/src/local-audio-transcription.mjs`,
  `transcribe-audio-file.py`), Windows electron-builder config, launcher scripts.

# 03 — Changes from upstream (newest first)

Each entry: what, why, where. Keep this in sync with commits on `jake/local-voice-app`.

## 2026-09-17 — resizable chat panel, take 2 (Claude)
- Take 1 (`49c161c`, reverted in `597da75`): a single lower-left grip that "wouldn't drag", bundled
  with a chat-list CSS change that broke spacing. This take touches **no chat-list CSS**.
- Two mechanisms, belt and braces: (1) on entering panel mode `main.mjs` calls `setMinimumSize`
  (460×420) / `setMaximumSize(workArea)` / `setResizable(true)` so the OS offers native edge
  resizing on the frameless window; back to `setResizable(false)` + orb minimum before collapsing
  to the orb, so the orb stays fixed-size. (2) Eight invisible 6 px grips (`.panel-grip-*`) around
  the panel in `App.jsx`, `-webkit-app-region: no-drag`, using the same screenX/screenY pointer
  IPC pattern as the orb move (`panel-resize-start` invoke → `-move` send → `-end`), applied
  with `desktopResizedPanelBounds()` (grabbed sides move, opposite sides fixed, clamped to the
  work area). Native wins where it works; grips cover the rest.
- Size is remembered in `ui-state.json` (`conversationPanelSize`, debounced 400 ms, from the
  window's `resized` event or the grip's end) and restored via `desktopPanelSizePreference()`.
  Tests in `desktop-surface-layout.test.mjs`. **Needs Windows rebuild**; if native edge resize
  misbehaves on the transparent window (Electron warns it can on some platforms), remove the
  `setResizable(true)` line and keep the grips.

## 2026-09-17 — voice picker (Claude)
- **Voice** picker in the sidebar under the context picker. Pocket TTS presets (jean default, alba,
  marius, javert, fantine, cosette, eponine, azelma) plus any WAV/MP3/FLAC/OGG clip in
  `realtime-voice-chat\voices\` (voice cloning, local; README.txt there explains). Choosing one
  restarts **only** the speech service with `--pocket_tts_voice <preset | full clip path>` (~15 s);
  model and Gateway untouched. Stored as `realtime-voice-chat\.selected-voice` (preset name or bare
  file name — never a path; the renderer cannot point TTS at arbitrary files). Launcher reads it too.
- `setVoice()` in `local-model-switch.mjs`, IPC `qwen-audio-agent:local-voice-set`, `speechArguments()`
  is now the single source of the speech command line (mirror in `Start My Voice App.ps1`). Model
  switches pass the chosen voice when they restart speech. Rollback to the old voice if the new one
  fails to start. 21 switcher tests pass. **Needs Windows rebuild** + a listen test; the pocket voice
  flag name (`--pocket_tts_voice`) was read from the installed `speech_to_speech` package, not run live.
- No "Preview" button yet: the speech service has no standalone synth endpoint, so previewing would
  mean a restart anyway. Possible later via a small direct `pocket_tts` call.

## 2026-09-17 — background model switching + context-size picker (Claude)
- **Switching no longer takes the app down for the whole load.** `desktop/src/local-model-switch.mjs`
  now loads the new model *first* while the Gateway and speech service keep running on the old one,
  and only then stops/starts services (a few seconds). Two modes, chosen automatically:
  `background` — new model fits in free VRAM beside the old one (`nvidia-smi` free memory ≥ weights
  + 1.5 GB + 32 KB/token of context), old model keeps answering during the load and is unloaded
  after the swap; `sequential` — not enough VRAM, so old is unloaded then new loaded (replies pause)
  but services still stay up until the swap. Unknown model size or unreadable GPU memory ⇒ sequential.
  On Jake's 16 GB card a ~14 GB Gemma will always be sequential; small models get background.
- Progress events (`loading` / `swapping` / `unloading` / `reloading` / `done` / `failed`) go to the
  renderer via `qwen-audio-agent:local-model-progress`; the sidebar shows them under the picker
  and voice is only disabled when the `swapping` phase starts. A failed background load leaves the
  old model untouched; a failed old-model unload after a successful swap is a warning, not a rollback.
- **Context window picker** (sidebar, under the model): 16k / 32k (default) / 64k / 128k. Writes
  `realtime-voice-chat\.selected-voice-context`, reloads the current model with the new size without
  restarting anything (speech and OpenCode don't care about context). The launcher
  (`Start My Voice App.ps1`) reads the same file, so the choice survives restarts.
  IPC `qwen-audio-agent:local-model-context`; `list()` returns `contextLength` + options.
- Tests: `desktop/test/local-model-switch.test.mjs` (18 pass); full desktop suite = only the 4 known
  settings-config failures; server dependency-boundary and web tests as before. **Needs a Windows
  rebuild** and a live check of both modes and the context picker.

## 2026-09-17 — layering fix (Claude)
- The computer-use MCP descriptor moved to `shared/backend/computer-use.mjs` so the desktop's
  screen capture no longer imports Gateway internals (`server/test/dependency-boundaries.test.mjs`
  enforces this; run it after touching imports across `desktop/`, `server/`, `web/`).

## 2026-09-17 — screen-aware questions
- Added the **Look at my screen** monitor button beside the attachment button. It lists running
  Windows apps through the bundled computer-use MCP, captures the chosen app's key window with
  `get_app_state`, then adds a screenshot preview to the composer. Type a question or choose an
  error/page-summary prompt, then Send. Pending captures are not automatically shared with voice.
- The desktop hides during capture and returns even on failure. Images are bounded to 2400 pixels
  and the existing 8 MB attachment limit. Tiny minimized-window placeholders are rejected. Changing
  chats resets the composer so screenshots cannot carry into another chat.
- The capture bridge only permits app listing and read-only app-state capture. The actual bundled
  Windows MCP app-list format was checked in the real session; a minimized Settings window returned
  a placeholder (now rejected). Unit tests, web tests and Vite build pass. Packaged UI and a full
  screenshot-to-model answer still need checking after Jake rebuilds.

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

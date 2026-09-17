# 03 — Changes from upstream (newest first)

Each entry: what, why, where. Keep this in sync with commits on `jake/local-voice-app`.

## 2026-09-17 — Settings sheet, Claude-style chat, push-to-talk (Claude)
- **Settings floats over the panel.** `createSettingsOverlayWindow` in `main.mjs`: frameless
  transparent child window tracking the panel's bounds, `settings.html?overlay=1`. No acrylic
  (it pops in at full strength); instead the panel blurs/dims itself via IPC
  `qwen-audio-agent:settings-overlay` (`preload.onSettingsOverlay` → `html[data-settings-open]`)
  and the sheet fades/rises in via `data-shown`, fades out via `data-closing` before
  `window.close()`. ✕ / Esc / click on scrim close it; collapsing to the orb closes it.
  Standalone window fallback when the panel isn't showing.
- **Chat layout like Claude:** centred column (`.messages` ≤760px, composer ≤720px);
  assistant text has no bubble, user messages sit in a neutral `--surface-3` bubble ≤78%.
- **Push to talk.** Setting `pushToTalkKey` (`QWEN_AUDIO_PUSH_TO_TALK_KEY`, default `F9`,
  `''` = off; `cleanPushToTalkKey` in `settings-config.mjs`). Settings → Application → "Push
  to talk" recorder (same grammar as the wake shortcut: F-keys alone or Ctrl/Alt combos).
  Reaches the renderer via the orb URL (`pushToTalkKey=`) and `client-settings` IPC;
  `web/src/desktop/push-to-talk.js` matches keydown (exact modifiers) / keyup (main key only).
  In `App.jsx`: hold → `enableVoice()`, release or window blur → `disableVoice()`; if the mic
  was already on the key does nothing. **Renderer-side, so only while the panel is focused**
  (Electron's globalShortcut has no key-up event; a global *toggle* would be the follow-up).
  Status pill tooltip shows "Hold F9 to talk". Tests: `web/test/push-to-talk.test.mjs`.
- Settings tab row is 5 columns; skin names English ("Fluid orb", "Liquid gradient orb");
  "Show in Explorer"; wake-word hint gives the pinyin and says the KWS model is Chinese-only.

## 2026-09-17 — UI design pass: tokens, dark Settings, "ZD Voice" branding (Claude)
- **Design tokens.** `web/src/styles.css` `:root` now defines the palette (`--bg/--surface-*`,
  `--text/--text-2/3/4`, `--accent*`, `--success/--warning/--danger*`, `--border/--fill`),
  radii (`--radius-sm/md/lg/xl`) and `--focus-ring`; ~300 lines of hard-coded hex/radii were
  rewritten to them. The orb art (`.stage`, `.fluid`, `.goo`, sprite) keeps its own colours on
  purpose. `desktop/src/settings.css` defines the **same token names/values** (its old
  `--page/--panel/--divider/--theme/--text-*` names are aliases) — change both files together.
- **Settings is dark** and matches the panel (same accent, font, radii). Bundled icons are
  near-black SVGs, inverted with `filter: invert(.86)`. Primary buttons/tabs use `--on-theme`.
- **Branding:** header mark "ZD" + "ZD Voice" (eyebrow removed), `<title>`/window title
  "ZD Voice", tray quit "Quit ZD Voice", `lang="en-GB"` on all three HTML pages.
  `productName`/exe name deliberately unchanged (launcher path depends on it).
- **Type:** base 14px, Windows-first stack (`Segoe UI Variable`, `Segoe UI`, Inter, system-ui);
  no UI text below 11px (8/9/10px → 11px, 11px → 12px).
- **Panel header:** status pill now shows the state label ("Listening", "Working"…) next to
  the dot in panel mode; the duplicate header "＋" is gone (sidebar owns New chat; web mode
  keeps the header button). Window controls 34×30, chat-row actions 26px, task cancel 24px.
- **Sidebar:** 200px; below 640px panel width it overlays the chat instead of squeezing it.
  Row actions overlay with a fade (no text reflow on hover); pinned = glyph, not "● ";
  **F2** renames the focused row (double-click still works).
- **Transcriber:** dark-styled controls/textarea/drop zone (`audio-transcriber.css`) and a
  **← Back to chat** button (`AudioTranscriber` takes `onBack`).
- **Focus:** one global `:focus-visible` ring in both stylesheets; the `outline: none` on the
  orb stage/controls was removed. Composer textarea intentionally keeps no ring.
- **i18n:** added `移动端`→Mobile, `关闭`→Close; sprite-skin loader errors are English
  (`sprite-orb.test.mjs` regexes updated); empty-state example is now a local-PC task.
- Tests: web 140/142 (the 2 known Linux-VM render failures), desktop settings/i18n/layout/
  renderer suites green. **Needs Windows rebuild** + a look at panel, Settings, transcriber.

## 2026-09-17 — Settings page regression fix, header Settings button, orb spawns bottom-right (Claude)
- **Settings page went all-Chinese with statuses stuck on "checking".** Cause: the new Permissions
  section used a `<form>` inside the page's main `<form>`; browsers drop nested forms, so
  `permissions-panel.js` hit a null element, threw, and `settings.js` died before translating the
  page. Fix: plain `<div>` + `type="button"`; `settings.js` now installs optional panels in
  try/catch; `settings-renderer-boundary.test.mjs` asserts a single `<form>` and every panel id.
- **Settings gear** in the panel header (left of minimise), same `open-settings` IPC as the orb.
- **Orb spawn position**: `orb-placement.defaultPosition` is now bottom-right of the work area
  (margin), and collapsing the panel always puts the orb there on the panel's display instead of at
  the panel's top-right corner. Only a drag records a saved position now.

## 2026-09-17 — orb semantics (Claude, after Jake's live check)
- Root cause of "orb doesn't show": not a window-state bug. `config.env` has
  `QWEN_AUDIO_OPEN_CONVERSATION_ON_START=1` so the app opens in **panel** mode, and the tray item only
  woke the window in its current shape. Now: tray **Show floating orb** → `collapseToOrb()` (forces orb
  mode + `surface-reset` IPC to the renderer); panel **minimise** button → collapse to orb (not the
  taskbar); panel **✕** → collapse to orb then `desktopPresence.hide()` (back via tray/shortcut).
  `panel-window-control` actions: `minimize`, `maximize`, `close`.

## 2026-09-17 — lost orb fix + "Reset floating orb" (Claude)
- Jake: orb no longer appeared, even from the tray. Log showed no errors. Likely chain: panel
  **minimise** button → window minimised → inactivity collapse/hide to orb (skipTaskbar) →
  `restore()` on a hidden window is a no-op on Windows and `show()` keeps it minimised → invisible
  with no taskbar button. Fix: `DesktopPresence.wake()` now `show()`s before `restore()`; the orb
  branch of `setDesktopSurfaceMode` does the same. `desktop.wake` / `desktop.surface` /
  `desktop.panel_minimized` log events added so the next one is diagnosable.
- Tray menu → **Reset floating orb** (`resetDesktopOrb()` in `main.mjs`): unminimise, force orb
  mode, default position on the primary display, tell the renderer (`surface-reset` IPC).

## 2026-09-17 — permission memory (Claude)
- **Persistent "always allow" rules** so agent tasks stop asking for routine things. Two kinds:
  `command` (glob over the whole command line, e.g. `ffprobe *`, `git status *`; the command name
  must be spelled out, no leading wildcard) and `path` (folder prefix, `read` or `write` access,
  e.g. `D:\Footage`). Stored in `state\desktop\permission-rules.json` with use counts.
- **Always gated, whatever the rules say:** every `delete` tool call, and commands on the always-ask
  list (`rm/del/rmdir/format/diskpart/Remove-Item/shutdown/sudo/reg delete/git reset --hard/
  git push --force/git clean/...`). Whole drives, `Windows`, `Program Files`, `Users` and profile
  roots cannot be made into folder rules. Path rules never cover commands (commands need a
  command rule); every path in an operation must be inside the rule's folder.
- Where: `shared/permission-rule-patterns.mjs` (danger list, read/write kinds, `suggestRule`),
  `server/src/core/permission-rule-patterns.mjs` (re-export for the task layer — the boundary test
  forbids task→shared), `server/src/task/permission-rules.mjs` (store + matching, atomic writes),
  `PermissionPolicy` (`rules` option; checked after session/task grants; `flushRuleMatches()` after
  a rule is added drains waiting requests). Routes: `GET/POST /api/permission-rules`,
  `DELETE /api/permission-rules/:id`, `POST /api/permission-rules/suggest`.
- UI: permission cards get a fourth button **Remember…** (only when a safe rule can be derived)
  that opens an inline editor prefilled with a suggestion (`ffprobe *`, or the file's parent folder
  read-only/read-write), saves the rule and then answers "Allow task". **Settings → Permissions**
  lists rules with use counts, removes them, and adds new ones by hand (Electron main proxies to
  the Gateway with the access token: IPC `qwen-audio-agent:permission-rules`).
- Auto-allowed requests are approved silently (`published:false`, as session auto-allow already did);
  `gateway.log` records `permission_rules.added/removed`. Tests: `server/test/permission-rules.test.mjs`
  (6), policy test extended, web `permission-actions-render` extended (runs on Windows only).
  **Needs rebuild** + live check: trigger a `ffprobe` task, click Remember…, run another.

## 2026-09-17 — window controls; native resize dropped (Claude)
- Jake's live check of take 2: edge dragging worked, but hovering the edge showed Windows'
  "not allowed" cursor — that is the OS resize border on the transparent frameless window.
  Removed `setResizable(true)`; the eight page grips (now 8 px edges / 16 px corners) do all
  resizing with proper resize cursors. Lesson added to `05-lessons.md`.
- **Minimise / maximise / close** buttons at the right end of the panel header (`.window-controls`,
  `OrbControlIcon` collapse button replaced). IPC `qwen-audio-agent:panel-window-control`:
  `minimize` → `BrowserWindow.minimize()`; `maximize` → toggles between the work area and the
  previous bounds (tracked in `desktopPanelMaximized`, cleared by any grip drag or collapse);
  the ✕ collapses to the orb (quitting stays on the tray menu). Un-minimise happens via the
  taskbar (panel mode has `skipTaskbar: false`). Needs rebuild + check.

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

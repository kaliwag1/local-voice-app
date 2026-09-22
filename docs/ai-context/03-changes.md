# 03 — Changes from upstream (newest first)

Each entry: what, why, where. Keep this in sync with commits on `jake/local-voice-app`.

## 2026-09-23 — the speech service's diagnostics are kept (Claude)
- The speech service ran with its output discarded (`stdio: 'ignore'` in the app, a hidden
  console from the launcher), so the adapters' "unavailable" diagnostic - the only sign a fix had
  switched itself off - was never seen, and whether the fixes were live could only be checked by
  reproducing the startup path by hand.
- Both start paths now write the service's **stderr** to `realtime-voice-chat\Last Speech
  Service.log`, overwritten on each start. Stdout stays discarded on purpose: the speech package
  prints `USER: <transcribed speech>`, `ASSISTANT: <reply>` and live partial transcripts there,
  and `docs/reference/memory.md` states that transcription and reply text are not logged by
  default. Upstream's Python logging on stderr already redacts transcripts to lengths
  (`transcript_for_log`). An earlier draft of this change also captured stdout; it was caught
  before commit.
- A log that cannot be opened falls back to none rather than stopping speech from starting.
- The Bonsai startup log was appended forever (llama-server writes timing lines through every
  reply). It still appends across starts, but starts afresh once it passes 2 MB.
- Verified live through the launcher: the log captured the service's startup, carried no
  `unavailable` line - the first confirmation that the reasoning, formatting and seamless-audio
  fixes are installed in the running service - and no conversation text. Desktop suite 302/302.

## 2026-09-23 — no more grit riding on the voice (Claude)
- The static Jake heard during speech (silent in the gaps) was two resampling stages, each
  converting every 32 ms block on its own. Pocket TTS generates at 24 kHz; the handler resampled
  each block to the 16 kHz pipeline, then `AudioHandler.encode_audio_chunk` resampled each block
  again up to the client's 24 kHz. A polyphase filter restarted per block leaves a discontinuity
  at every seam - 31 a second, only while audio flows.
- Measured which stage mattered before changing anything: both chunked -38.0 dB relative to
  speech; fix only the TTS stage -38.2; fix only the output stage -42.6; fix both -78.6. Each
  stage leaves its own seams, so both had to change.
- New `scripts/runtime/speech-adapter/seamless_audio.py`, installed separately from the
  reasoning adapter so an upstream change disables only this fix. Both stages use upstream's own
  `_StreamingFIRResampler`, already used for its OpenAI-compatible TTS. Rates and block sizes
  are unchanged.
  - TTS stage: `process()` is not overridden. It skips resampling when the model's rate equals
    the pipeline's, so `setup` wraps the model to report 16 kHz and yield audio converted as one
    stream, fresh per utterance. Cancellation and speculative-turn logic run as shipped.
  - Output stage: a hash-checked copy of `encode_audio_chunk` differing only in the resample
    line - one resampler per response per connection.
  - The streaming resampler clips, so upstream's unclipped int16 cast can no longer wrap a peak.
- Verification: through the real `PocketTTSHandler` with the real wrapped `setup` and a real
  sentence, 185 blocks all exactly 512 int16 samples; artifact -36.8 dB before, -78.4 dB after,
  against a continuous reference built from the model's raw audio captured in the same run.
  14 new tests (chunk boundaries do not change the output; one clean filter per utterance, also
  after an interrupted one; no wrap at full scale; one converter per response, per connection,
  per rate; blocks joined equal one pass), the existing 9 still pass, and all three adapter
  pieces load through the launcher's own `ZD_VOICE_REASONING_ADAPTER=1` + `PYTHONPATH` path.
- Not yet verified by ear. Python changes need only a speech restart, no rebuild.

## 2026-09-23 — every test suite passes (Claude)
- Eleven failures carried as "pre-existing" for several sessions; none was a product bug. Most
  came from tests reading this PC's own configuration (see lesson 24):
  - two server tests asserted 千问Audio in the user's `~/.config/qwaudio/ASSISTANT.md`, which the
    2026-09-19 translation changed; one now checks the shipped default, one that the identity
    section reaches the prompt in any language;
  - the gateway handshake harness took `config.audioProvider` from this machine's `config.env`
    (Speech-to-Speech refuses mid-session voice changes); it now pins `DEFAULT_REALTIME_PROVIDER`;
  - an OpenCode auth test read the real `opencode.json`, whose local LM Studio provider correctly
    counts as set up; it now passes an empty env.
- The rest were tests left behind by code: upstream `c7509cb` added eight GPT-Live/Google Live
  settings (the same failures exist on upstream `main`); `ef6f06a` added `paths`/`writes` to tool
  updates; `8db685e` gave `PermissionActions` state, so the three decision buttons became a
  stateless `PermissionDecisions` component with identical markup. A Tailscale Serve test slept a
  fixed 40 ms before checking for SIGKILL; it now waits for the signal itself.
- Result: root 192/193 (one skipped), desktop 298/298, web 191/191, server 1315/1315. The server
  suite then passed 8 full runs in a row; one earlier run had a single failure that never
  reproduced, so an occasional timing flake elsewhere cannot be ruled out.

## 2026-09-19 — Settings can read and set the local voice (Claude)
- The voice row never appeared: `qwen-audio-agent:local-models-list` and `local-voice-set` throw
  unless the sender is the conversation window, so the Settings panel's first call failed and it
  hid itself - the same thing it does when a runtime reports no voices. `isAppWindow()` now also
  accepts the Settings window, for those two handlers only. Switching a model or a context window
  is still conversation-window-only, since that is where both are driven from.
- Verified the data behind the row is live: 8 presets, current `cosette`, so it renders.

## 2026-09-19 — the chat panel keeps the model's line breaks (Claude)
- Replies with numbered steps arrived as a single paragraph. Not the model, the prompt or the
  renderer: with the voice prompt in play the model still emits proper Markdown lists (checked
  directly, 24 lines and 16 list items). Upstream `speech-to-speech` builds the audio-mode
  transcript with `" ".join(part.strip() ...)`, discarding every newline. Bold survived because
  `**` are inline characters; line breaks only existed as whitespace between parts.
- The app-owned speech adapter now overrides `ResponseHandler._assistant_text` as a fourth
  hash-checked function, concatenating parts verbatim - exactly what upstream already does in
  text-only mode. Only the transcript item is affected: audio is synthesised from the parts, so
  nothing about speech changes, and a verbatim join cannot drop or reorder words.
- Validation: 9 adapter tests (4 new: line breaks survive a spoken answer, audio and text modes
  now agree, nothing dropped or reordered, empty parts). Confirmed the guard still refuses a
  changed upstream with a clear error and leaves upstream behaviour intact, and that
  `sitecustomize` catches any failure so speech keeps working. Then ran the app's own startup
  path - `ZD_VOICE_REASONING_ADAPTER=1` with the adapter on `PYTHONPATH` - and confirmed the
  hook installs and a three-part answer comes back with its list intact. Rebuilt and relaunched.
- The speech service is spawned with `stdio: 'ignore'`, so its unavailable diagnostic is not
  visible from the app. If formatting ever regresses, run that startup path by hand to see it.

## 2026-09-19 — context meter, live turn readout and a reworked composer (Claude)
- **Context meter.** A ring in the composer's controls row, filling as the window fills, with
  the numbers and the window-size picker behind a click. It reads the newest response's own
  usage, not the turn totals already in the activity panel: each response's prompt contains the
  history sent with it, so summing prompts across a turn counts the same context several times.
  `TurnActivity` publishes `usage.latest` for that. Unmeasured runtimes say so rather than
  drawing an empty ring, and a conversation past the window clamps the ring but keeps the real
  figures. The Settings context-size select moved in here; changing it still reloads the model.
- **Live turn readout.** Under each turn: an elapsed clock and streamed characters while the
  model works, settling to tokens, duration and tok/s when the runtime reports usage. It fills
  the silence that made a running turn look stuck. Two clocks on purpose - elapsed covers the
  whole turn, the rate is measured from the first streamed delta so prompt processing does not
  drag it down. Characters and chunk counts are exact; token figures are only ever the
  runtime's own. A finished turn measures to its recorded end, falling back to its last update
  for turns recorded before these counters, which otherwise counted up against the wall clock.
- **Composer.** The box now wraps the text field alone, with the tools and status on a row
  beneath it. Send is the return glyph, and becomes a stop control while a reply is running -
  the separate red Stop button is gone. The local model picker lives in that row, showing the
  current model and switching on click, and carries the errors, warnings and refresh the
  sidebar block used to hold. The sidebar's model and context selects are gone; the voice
  select moved to Settings → Application, which is a setting rather than a per-chat choice.
- **Chat list.** A status dot and the title, no date. The dot is hollow, accent when pinned,
  and pulses while the model is working in the open chat - only that one, because activity
  snapshots and tasks are both per-session, so the client cannot honestly know about the rest.
  The four row icons became one ⋮ menu (Pin/Rename/Archive/Delete with shortcut letters),
  appearing on hover and on keyboard focus.
- Popovers share one dismissal helper: click outside or Escape closes them, and opening one
  closes the others. The chat menu measures its own placement, because a fixed element resolves
  against the nearest transformed ancestor, not the viewport, and this UI has several.
- Validation: 188 of 189 web tests (the `permission-actions-render` failure is pre-existing and
  identical at HEAD), 3 new desktop tests for the voice grouping, and the full desktop and root
  suites unchanged. Rebuilt and checked in the running app through the Gateway UI: the meter and
  picker render in the controls row, the field is boxed alone, the textarea no longer has a
  resize grip, chat rows are single-line with dots and no dates, and each row menu opens
  on-screen, right-aligned under its button.
- Not done here: the chat text itself arrives flattened. In voice mode the installed
  speech-to-speech package joins transcript parts with spaces and strips each one
  (`handlers/response.py`, `_assistant_text`), so the model's line breaks never reach the
  panel and lists render as a paragraph. The model does emit them; fixing it belongs in the
  app-owned speech adapter.

## 2026-09-19 — Gateway failures read in English (Claude)
- The Settings banner already ran `localizeDesktopError`, but no Gateway lifecycle message was
  in it, so a failed start reported itself as `内嵌 Gateway 启动超时` to an English UI. Added
  patterns for the startup timeout, early exit (keeping the exit code), cancelled start,
  unexpected exit, "already running" (keeping the URL) and the lease failure. Chinese UIs are
  unchanged: the localizer still returns the raw text when the translator is Chinese.
- Source strings are untouched; this is dictionary-only, matching how the rest of the desktop UI
  is translated. Other Chinese runtime errors remain untranslated until they actually surface.
- Validation: 4 i18n tests including the new lifecycle cases and the Chinese passthrough.

## 2026-09-19 — the Gateway lease no longer trusts a recycled PID (Claude)
- A force-killed app left `gateway.lock` behind naming pid 16268. Windows then gave that id to
  `speech-to-speech.exe`, so `acquireGatewayLease` saw a live PID, threw
  `QWAUDIO_GATEWAY_ALREADY_RUNNING`, and every launch afterwards fell back to the Settings
  window with "内嵌 Gateway 启动超时". Clearing the lock unblocked it; this is the real fix.
- Liveness now needs corroboration, not just `process.kill(pid, 0)`: when the lease records an
  origin, probe it and yield only to a Gateway answering with that lease's own instance id — the
  same proof `findRunningGateway` already requires. A lease with no origin yet (still starting,
  so it cannot answer) is trusted for a 45s grace window measured from its heartbeat, then taken
  over. A dead PID is still taken over immediately, with no probe.
- `acquireGatewayLease` is therefore async; `server/src/index.mjs` awaits it. The probe is
  injectable, defaulting to `readGatewayHealth`. Only three files reference the function.
- Second defect, which is why the symptom pointed at the wrong thing: a failed start set
  `process.exitCode = 1` but never exited, and the utility-process channel kept the child alive
  until the host's 15s timeout. It now flushes and exits, so the host reports the real reason.
- Validation: 8 lease tests (4 updated for async, 4 new: recycled id, genuine incumbent, foreign
  service on the port, starting-grace window both sides), 192 root tests, 1312 server tests. The
  3 server failures in `acp-backend-adapter` / `gateway-client-handshake` are pre-existing and
  identical at HEAD with these changes stashed. End-to-end against the real entry with a planted
  lease naming a genuinely live Windows PID: dead origin → starts and takes the lease; a fake
  Gateway answering with the lease identity → refused, exit 1 in 0.3s (was a 15s timeout), and
  the incumbent's lease left untouched. Rebuilt into `dist/desktop-panel`. No remote push.

## 2026-09-18 — quitting releases the Bonsai server (Claude)
- Quitting the app left `llama-server.exe` running: the Prism server is spawned detached
  (so it can outlive the launcher that starts it) and no shutdown path ever closed it.
  Observed live — app closed, PID 30436 still listening on 8080 holding ~9 GB of VRAM.
- `before-quit` cleanup now calls `localModelSwitcher.stopLocalRuntime()` after the
  renderer server and gateway are down, so nothing is mid-request when the weights go.
  It reuses the existing `runtime.stop()`, which is a no-op unless the listener on 8080
  is still the PID/exe/model recorded in `.voice-bonsai-runtime.json` — an LM Studio
  server, or a standalone Bonsai someone else started, is never killed.
- `createLocalModelSwitcher` takes the runtime as an injectable `bonsai` option instead
  of building it inline, so the stop path is testable without a real server.
- Bounded by `withDeadline` (new, in `graceful-shutdown.mjs`, 8 s): `stop()` polls for
  10 s before throwing, and a server that will not release the port must not trap the
  user in a half-closed app. A failure or timeout is logged as
  `desktop.local_runtime_stop_failed` and the quit continues.
- Only covers a clean quit. Closing to tray deliberately keeps the model warm, and a
  crash or force-kill still orphans the server — the launcher's `stop unused` covers the
  next start when a non-Bonsai model is selected, and `start()` reuses a healthy matching
  server otherwise.
- Validation: 289 focused desktop tests pass, including 3 new switcher tests (owned stop,
  not-owned left alive, no runtime configured) and 2 new `withDeadline` tests. The 5
  failures in `settings-config` / `backend-auth-status` are pre-existing — identical at
  HEAD with these changes stashed. Not yet rebuilt into `dist/desktop-panel`, so the
  installed app still has the old quit path. No remote push.

## 2026-09-18 — per-turn activity, tokens and real local reasoning (Codex)
- Compact expandable status below each new turn: live frontend tool names/counts,
  repeated calls, running/completed/failed status, actual reported prompt/completion/
  total tokens, and explicit no-answer/interrupted/failed or stalled states. Raw
  tool arguments/results are not shown. Existing permission checks are unchanged.
- `TurnActivity` observes realtime events and tool debug notifications; saves bounded
  activity snapshots separately from model conversation messages. History returns the
  latest snapshot per turn (last 100); changing chats/restarting restores them.
  Tool continuations have `origin: agent`, and must be counted alongside `model`:
  a real search exposed that distinction; regression test now covers it. System
  permission/announcement speech is excluded. Counts are frontend model usage only,
  not a context-window meter or OpenCode backend token totals. Missing/placeholder
  usage remains unavailable. A 60-second stall is reported honestly, not as success.
- `scripts/runtime/speech-adapter` is an app-owned, version/source-hash checked
  extension for the installed Hugging Face speech-to-speech 1.0.0. No site-packages
  edits. Explicit Chat Completions reasoning fields use separate response-keyed
  realtime events through existing cancellation/stale-output gates. Thinking is
  never sent to TTS or inserted into model history; UI stores at most 24,000 characters
  and defaults to collapsed. Unclaimed speculative reasoning is dropped. Unsupported
  runtimes continue normal speech with an unavailable diagnostic. See adapter README.
- Both the in-app speech spawn and parent launcher opt into the adapter and stop
  explicitly disabling native model thinking. This can increase latency/token use.
  Providers that emit no separate reasoning still show unavailable; nothing is inferred
  from answer text. Same adapter path supports both Bonsai variants and LM Studio.
- Validation: 67 focused JS tests, 21 gateway application tests, 5 Python adapter tests;
  supported Windows rebuild succeeded. Real CRACK desktop arithmetic returned 513,
  displayed actual thinking separately, and showed prompt 4285 / completion 130 /
  total 4415. Token/thinking history survived restart. Final deployed CRACK web-search
  test showed `web_search x1 completed`, final answer, and total 9373 tokens across
  both responses (prompt 9208 / completion 165), with real model thinking retained.
  Ten-search terminal loop,
  no-answer, interruption, deduplication and unavailable usage tested synthetically;
  no harmful prompt was rerun. No remote push. Pre-existing package-lock.json and
  saved model choice preserved.

## 2026-09-18 — Bonsai Official / CRACK via local Prism runtime (Codex)
- Follow-up deployment: rebuilt the installed `dist/desktop-panel` through the supported script.
  Live picker showed both variants and switched Qwen → Official. The first desktop reply exposed
  an existing NLTK PermissionError: cached tokenizer data resolved into Codex's redirected
  AppData instead of NLTK's allowed roots. Copied cached English `punkt_tab` data into parent
  `nltk_data/` (ignored), set `NLTK_DATA` in both speech spawn and launcher, preserving other
  configured paths. No NLTK security checks were disabled. A real desktop retry returned
  `Bonsai desktop test passed.` with completed response and accepted audio playback in gateway logs.
  Regression test added; 36 focused tests pass. Actual microphone input has not been tested.
  Final installed build was cold-started from the real desktop shortcut with saved Official;
  full panel and Standby returned. Live Official → CRACK switch passed, and CRACK replied
  `CRACK desktop test passed.` with completed response and accepted audio playback. Returned
  the model picker to the original Qwen3.5 9B after testing. OpenCode initialization was verified,
  but an end-to-end OpenCode task was not part of this check (direct model function calls passed).
- Both downloaded PQ2 variants appear in the existing model picker as `bonsai/official`
  and `bonsai/crack`. Incompatible LM Studio entries for these quantizations are filtered.
- `desktop/src/bonsai-runtime.mjs` manages the existing `Documents/Codex/BonsaiRunner/llama-server.exe`
  on localhost:8080, alias `bonsai`, Jinja tool templates, one slot, hidden process and startup log.
  PID, executable and model must match its state record before shutdown. Foreign listeners are
  left alone and produce a clear startup error. Repeat starts reuse a healthy matching server.
- Switching uses the existing rollback transaction and is always sequential when Bonsai is
  involved. Other loaded LM Studio models cause an explicit error rather than overloading VRAM.
  The existing context picker reloads Prism; 32k was verified on Jake's RTX 5070 Ti.
- Speech, OpenCode, automatic titles and Health use the active provider. LM Studio configuration
  is preserved; OpenCode gets a separate `bonsai` provider. Saved Bonsai choices are understood
  by the parent launcher (separate repository). Runtime state/logs live alongside that launcher.
- Validation: 35 focused tests pass (switch/rollback, runtime ownership/port conflicts, health,
  titles). Web production build and separate Windows packaging (`dist/bonsai-validation`) pass.
  The validation package was not launched or installed. Live Windows API tests passed for BOTH variants at 32768:
  chat completion, structured function call, repeated start reuse, sequential unload/start/stop.
- Desktop deployment/cold start and text-to-speech flow were verified in the follow-up above.
  No remote push was performed. Physical microphone input and a full OpenCode task remain untested.
- Pre-existing `package-lock.json` and parent `.selected-voice-model` edits were preserved.

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
- **System-wide hold-to-talk** (later the same day): `desktop/src/push-to-talk-hook.mjs` wraps
  the optional native module **uiohook-napi** (N-API keyboard hook with key-up events; Electron's
  `globalShortcut` has none). Main process → IPC `qwen-audio-agent:push-to-talk` `{held}` →
  `preload.onPushToTalk` → `App.jsx` opens/closes the mic; hidden orb is woken first. Whether
  the hook is active travels as `pushToTalkGlobal` (orb URL, `client-settings`, runtime status);
  when it is false the renderer's focused-window fallback is used and Settings says so in the
  hint. Dependency added to `desktop/package.json` + `asarUnpack` in `electron-builder.yml`.
  **Install on Windows** with `realtime-voice-chat\Install Push To Talk Hook.cmd` (npm install
  can't be done from the Linux VM — it would fetch linux prebuilds), then rebuild. Tests:
  `desktop/test/push-to-talk-hook.test.mjs`.
- **Microphone mode** (`micMode`: `always` | `push-to-talk`, env `QWEN_AUDIO_MIC_MODE`, Settings →
  Application → Microphone; the key row only shows in push-to-talk mode). In push-to-talk mode
  the renderer starts with the mic off and an effect in `App.jsx` forces `voiceEnabled=false`
  whenever the key isn't down — orb click, header button, ownership hand-back and wake word all
  get undone — so the mic is live only while the key is held. The header mic button becomes a
  reminder of the key (`aria-disabled`). The global hook only runs in push-to-talk mode.
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

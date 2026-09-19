# 02 — How to

## Rebuild the app after code changes
Close the app, then double-click `realtime-voice-chat\Rebuild My Voice App.cmd`.
It runs `npm run build` (Vite) and `electron-builder --win --dir` into `dist\desktop-panel`.
Log: `realtime-voice-chat\Last Rebuild.log`. Must run **on Windows** (native deps).
Only `resources\runtime\scripts\runtime\*.mjs` can be patched without a rebuild.

## Run
Desktop shortcut **My Local Voice App** (or `Start My Voice App.ps1`). The script starts LM Studio's
server, loads the selected model with `--context-length 32768` (variable `$modelContextLength`),
starts the speech service on 8765, frees port 3101, sets `OPENCODE_RUNTIME/OPENCODE_BIN`, launches the app.

## Permission rules
Settings → Permissions, or **Remember…** on a permission card. File: `state\desktop\permission-rules.json`
(edit by hand only with the Gateway stopped). Never auto-allowed: deletes and the always-ask command
list in `shared/permission-rule-patterns.mjs`. To make everything ask again, remove all rules.

## Tests (Node, no build needed)
- `cd server && node --test` · `cd desktop && node --test` · `cd web && node --test`
- Known pre-existing failures: 4 in `desktop/test/settings-config.test.mjs`; 1 in
  `server/test/acp-backend-adapter.test.mjs` ("recent project Session updates"); in a Linux VM 2 web
  tests fail only because the Windows-installed rollup binary is missing. The full server suite takes
  >12 min in the Cowork VM — run the relevant files instead.

## Commit & back up
`git commit` on branch `jake/local-voice-app` (app) / `main` (launcher folder), then double-click
`realtime-voice-chat\Push To GitHub.cmd`. Refresh the config copies with `Update Config Snapshot.cmd`.

## Diagnose

**Chat activity:** expand the compact status below a new turn for frontend tool
names/counts, completion/failure/no-answer status, reported tokens and any emitted
model thinking. Thinking is nested/collapsed, never spoken. Tokens are cumulative
provider-reported usage for the voice model's responses in that turn, not current
context occupancy, a live estimate, or OpenCode backend usage. Old turns cannot be
backfilled. The local reasoning adapter lives in `scripts/runtime/speech-adapter`;
read its README before upgrading the speech dependency. Native thinking is enabled
by the launcher and may make replies slower. Unsupported/missing reasoning is
explicitly unavailable. Activity survives chat switching and restarts.

0. **No speech audio but transcription works** (`realtime.response.done` with `hasAudio:false`, often after
   `session_limit_reached` in `gateway.log`): the speech service on 8765 outlived a killed app and is holding
   a dead session. Run `realtime-voice-chat\Restart Speech Service.cmd` (the Rebuild script now also kills it).
1. `desktop.log` — `gateway.exited` with `planned:false` = crash.
2. `gateway.log` — look for `backend.exited`, `acp.initialization_failed`, `backend.output` (OpenCode's own stdout/stderr), `task.failed`.
3. Task error text is in `state\desktop\tasks.json` (`error` field).
4. OpenCode's reasons (model not found, context size) are in `opencode.log`.
5. `Get-NetTCPConnection -LocalPort 3101,4096,8765,1234 -State Listen` to see what is up.

## Model switching

**Bonsai:** choose **Bonsai 2 Official PQ2 (Prism)** or **Bonsai 2 CRACK PQ2 (Prism)** in the same
picker after rebuilding. Keep the existing runtime at `Documents\Codex\BonsaiRunner\llama-server.exe`
and the GGUFs under `.lmstudio\models`; these files cannot be loaded by LM Studio itself.
Start at 32k context (verified); larger contexts have not been tested. Close standalone Bonsai
shortcuts first if they own port 8080. The app releases its previous selected model before loading
Bonsai; unload any additional LM Studio models yourself when prompted. The app-owned server can
remain warm after closing the app, is reused on restart, and is stopped when switching back.
Startup log: parent `.voice-bonsai-runtime.json.log`. Do not delete the state file while running:
it records ownership so another process on port 8080 is never killed by mistake.
Speech uses `NLTK_DATA=<launcher folder>\nltk_data` first. This PC has its cached English
`tokenizers/punkt_tab/english` files copied there, avoiding Codex/AppData path redirection.
On another PC, install/copy the English NLTK data into that folder before testing speech.

In-app picker → `desktop/src/local-model-switch.mjs`. Order: `lms load` the new model **while the
old one keeps serving** (beside it if free VRAM allows — "background"; otherwise unload old first —
"sequential"), then a short swap: stop gateway + speech, rewrite `opencode.json`, restart speech,
reset the OpenCode coordinator session in `acp-sessions.json`, restart gateway, unload the old model.
Where the controls live now (all three left the sidebar on 2026-09-19):
- **Model** — the picker in the composer's controls row, showing the current model's name. It
  reports switch progress in place of the name, and holds the errors, warnings and "Refresh
  downloaded models" that the old sidebar block carried.
- **Context window** — inside the context ring's panel, same row. Writes
  `realtime-voice-chat\.selected-voice-context` (read by the launcher too) and reloads the
  current model in place; env `QWEN_AUDIO_LOCAL_MODEL_CONTEXT` is the fallback default (32768).
- **Voice** — Settings → Application → 朗读音色 ("Voice"), via `desktop/src/local-voice-panel.js`
  and the existing `listLocalModels` / `setLocalVoice` IPC. Writes
  `realtime-voice-chat\.selected-voice`; clips for cloning go in `realtime-voice-chat\voices\`
  (10–20 s, one clear speaker). Only the speech service restarts. The row hides itself when the
  runtime reports no voices.

Switch progress appears in the composer picker; a red indicator during the swap is normal.

## Running things on the PC from an AI session
Assistants in a sandbox (Codex, Cowork's Linux VM) **cannot run Windows executables** and may see a
different user/profile. Write a `.cmd`/`.ps1` and have Jake double-click it, then read its output file.
`_diag\repro.ps1` + Desktop `RUN GATEWAY DIAGNOSTIC.cmd` is the established pattern.

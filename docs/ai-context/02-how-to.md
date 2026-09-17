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

## Tests (Node, no build needed)
- `cd server && node --test` · `cd desktop && node --test` · `cd web && node --test`
- Known pre-existing failures: 4 in `desktop/test/settings-config.test.mjs`; in a Linux VM 2 web tests
  fail only because the Windows-installed rollup binary is missing.

## Commit & back up
`git commit` on branch `jake/local-voice-app` (app) / `main` (launcher folder), then double-click
`realtime-voice-chat\Push To GitHub.cmd`. Refresh the config copies with `Update Config Snapshot.cmd`.

## Diagnose
1. `desktop.log` — `gateway.exited` with `planned:false` = crash.
2. `gateway.log` — look for `backend.exited`, `acp.initialization_failed`, `backend.output` (OpenCode's own stdout/stderr), `task.failed`.
3. Task error text is in `state\desktop\tasks.json` (`error` field).
4. OpenCode's reasons (model not found, context size) are in `opencode.log`.
5. `Get-NetTCPConnection -LocalPort 3101,4096,8765,1234 -State Listen` to see what is up.

## Model switching
In-app picker → `desktop/src/local-model-switch.mjs`. Order: `lms load` the new model **while the
old one keeps serving** (beside it if free VRAM allows — "background"; otherwise unload old first —
"sequential"), then a short swap: stop gateway + speech, rewrite `opencode.json`, restart speech,
reset the OpenCode coordinator session in `acp-sessions.json`, restart gateway, unload the old model.
The sidebar text under the picker says which mode is running. Red indicator during the swap is normal.
Context window: sidebar picker writes `realtime-voice-chat\.selected-voice-context` (read by the
launcher too) and reloads the current model in place; env `QWEN_AUDIO_LOCAL_MODEL_CONTEXT` is the
fallback default (32768).
Voice: sidebar picker writes `realtime-voice-chat\.selected-voice`; clips for cloning go in
`realtime-voice-chat\voices\` (10–20 s, one clear speaker). Only the speech service restarts.

## Running things on the PC from an AI session
Assistants in a sandbox (Codex, Cowork's Linux VM) **cannot run Windows executables** and may see a
different user/profile. Write a `.cmd`/`.ps1` and have Jake double-click it, then read its output file.
`_diag\repro.ps1` + Desktop `RUN GATEWAY DIAGNOSTIC.cmd` is the established pattern.

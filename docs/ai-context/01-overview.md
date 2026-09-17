# 01 — Overview

## What this is
A fully local Windows voice assistant built from an editable copy of
[Qwen Audio Agent](https://github.com/QwenAudio/qwen-audio-agent) (upstream, MIT).
It listens, talks back, and can carry out agent tasks on the PC (files, shell,
screen). **Hard requirement: no paid API, nothing leaves the machine.**

## Moving parts
| Part | Runs as | Port | Notes |
|---|---|---|---|
| Desktop app (Electron) | `dist\desktop-panel\win-unpacked\Qwen Audio Agent.exe` | — | Chat window with sidebar, model picker, transcription |
| Gateway | Electron utility process inside the app | 3101 | Orchestrates voice + backend; logs to `gateway.log` |
| Chat model | LM Studio (`lms` CLI) | 1234 | Model chosen in-app; must load with ≥32k context |
| Speech (STT/TTS) | `speech-to-speech.exe` from `.voice-env` (parakeet-tdt + pocket TTS) | 8765 | Started by the launcher script |
| Agent backend | OpenCode (`opencode.exe serve` + `opencode acp`) | 4096 | Spawned by the gateway via `scripts/runtime/opencode*.mjs` |
| Computer-use tools | `open-computer-use` MCP server | stdio | Spawned by OpenCode with real `node.exe` on Windows |

## Where things live
- App source + build: `C:\Users\JakeW\Documents\Codex\2026-09-16\realtime-voice-chat\qwen-audio-agent-editable`
  (this repo; branch `jake/local-voice-app`; `main` = untouched upstream)
- Launcher scripts, config snapshot, rebuild/push scripts: parent folder `realtime-voice-chat`
  (separate repo → `kaliwag1/local-voice-app-launcher`)
- User config: `C:\Users\JakeW\.config\qwaudio\config.env` (+ `USER.md`, `ASSISTANT.md`, `MEMORY.md` for the voice persona)
- Gateway state/logs: `C:\Users\JakeW\.config\qwaudio\state\desktop\` (`logs\gateway.log`, `sessions\`, `tasks.json`, `acp-sessions.json`)
- Desktop app log: `C:\Users\JakeW\AppData\Roaming\Qwen Audio Agent\logs\desktop.log`
- OpenCode config + agent instructions: `C:\Users\JakeW\.config\opencode\opencode.json`, `AGENTS.md`; log `C:\Users\JakeW\.local\share\opencode\log\opencode.log`
- OpenCode binary: `C:\Users\JakeW\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe` (global npm install in the **real** user session)
- Desktop shortcut: `C:\Users\JakeW\OneDrive\Desktop\My Local Voice App.lnk` → `My Local Voice App Launcher.exe` → `Start My Voice App.ps1` → app

## Key facts
- The user's visible Desktop is **`C:\Users\JakeW\OneDrive\Desktop`**; `C:\Users\JakeW\Desktop` is a hidden leftover.
- Runtime scripts in `resources\runtime\scripts\runtime\` are unpacked (editable in place); everything else in the app is inside `app.asar` and needs a rebuild.
- Two repos on GitHub (private): `kaliwag1/local-voice-app`, `kaliwag1/local-voice-app-launcher`.

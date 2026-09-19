# 05 — Lessons / traps (read before debugging)

1. **Sandbox ≠ real session.** Codex/Cowork shells run as another user or in a VM. A path that exists
   there (e.g. `...\Packages\OpenAI.Codex_*\LocalCache\Roaming\npm\...`) does not exist for `jakew`.
   Verify with `whoami` from a script Jake double-clicks. Never trust a sandbox `Test-Path`.
2. **A "healthy" launcher status proves nothing.** `App launch requested` only means the exe was started.
   Confirm with `gateway.ready` and no `backend.exited` in the logs, then a real agent task.
3. **Silent `process.exit(0)` hides everything.** Runtime wrappers must propagate child exit codes.
4. **Two Desktops.** Visible one is OneDrive's. Agents default to `%USERPROFILE%\Desktop` unless told.
5. **PowerShell writes UTF-8 with a BOM.** Strip `﻿` before `JSON.parse` on any file it may have touched.
6. **LM Studio context.** Load models with ≥32k context for OpenCode; the default 8192 fails instantly.
7. **OpenCode sessions pin their model.** After changing the model in `opencode.json`, drop the coordinator
   entry in `acp-sessions.json` or prompts fail with `ProviderModelNotFoundError`.
8. **Instruction files are read at session start** — `AGENTS.md` changes need a fresh OpenCode session.
9. **Console windows on Windows** come from Electron-in-Node-mode children or from inheriting a parent that has
   no console. Use `windowsHide`, pipe stdio, or run scripts with real `node.exe`.
10. **The venv's `speech-to-speech.exe` is a stub** that launches a Python which may live elsewhere
    (Codex runtime cache). Identify it by the stub path on its command line, not by exe path.
11. **Shallow clone can't be pushed** — `git fetch --unshallow origin` first.
12. **Desktop-icon clicks via computer-use are unreliable** when a browser is maximised; ask Jake to click.
13. **Don't make the transparent panel window natively resizable.** `setResizable(true)` on the
    frameless transparent window gives Windows' resize border, which shows the "not allowed"
    cursor on hover. Resize from page grips via IPC (`panel-resize-*`) instead — same pattern as
    the orb drag, which is known to work.
14. **Never minimise a window that may later go `skipTaskbar`/hidden without un-minimising it
    first.** On Windows `restore()` is a no-op while hidden and `show()` keeps the minimised state:
    the orb becomes invisible with nothing to click. `show()` then `restore()`; tray has a reset.
16. **A live PID is not proof a process is still the one you recorded.** Windows recycles process
    ids quickly: a force-killed Gateway's id came back as `speech-to-speech.exe` within two
    minutes, so the PID-only lease check reported "a Gateway is already running" and every later
    start failed. Corroborate identity — probe the recorded origin and match the instance id —
    before trusting a saved PID. Same applies to the Bonsai runtime record.
17. **A gateway child that fails to start must exit, not idle.** Setting `process.exitCode` is not
    enough: Electron's utility-process channel keeps the child alive, so the host waits out its
    15s readiness timeout and reports "Gateway startup timed out" while the real reason sits in
    `state/desktop/logs/gateway.log`. When a start fails, flush and `process.exit(1)`.
18. **`settings.html` is one big `<form>`.** Any panel added inside it must not use a nested `<form>`
    or `type="submit"` buttons — the parser drops the inner form, the script crashes on a null
    element, and the whole page appears untranslated with statuses stuck on "checking".

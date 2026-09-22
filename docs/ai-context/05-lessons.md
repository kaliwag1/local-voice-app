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
19. **`position: fixed` is not the viewport if any ancestor has a `transform`.** A menu placed
    with viewport coordinates landed 874px off-screen because the button itself had
    `translateY(-50%)`. This UI has transforms all over (orb, panel, animations). Either drop
    the transform, or pin the element at 0,0, measure where that landed, and shift by the
    difference. Also: clearing an inline `right` to `''` does not beat a stylesheet `right: 0` —
    an inline `left` plus that rule stretches the element edge to edge. Use `'auto'`.
20. **`desktopOrbMode` means "this is the desktop client", not "the orb is showing".**
    `desktopOrbUrl` sets `desktop=orb` unconditionally and `surface=panel` picks the panel. The
    compact orb already returns early in `App.jsx`, so anything rendered after that point is
    panel-only and needs no guard. Gating on it hides things in the panel.
21. **Voice mode flattens the assistant transcript.** Upstream `speech-to-speech` assembles it
    with `" ".join(part.strip() ...)`, so the model's line breaks never reach the panel and
    lists render as one paragraph; text-only mode concatenates verbatim. The app-owned adapter
    overrides `_assistant_text` to do the same for both. Before blaming the model or the prompt
    for formatting, check what the transcript assembly did to it.
22. **A restored snapshot has no "now".** Anything derived from the wall clock — an elapsed
    time, a rate — must measure to a recorded end, falling back to the last update for records
    written before that field existed. A finished turn measured against `Date.now()` reported
    "56m 22s" for a reply that took seconds.
23. **The local-model IPCs are locked to the conversation window.** `main.mjs` throws unless
    `event.sender === mainWindow.webContents`. A Settings panel calling `listLocalModels()`
    therefore fails, and a panel that hides itself when no data comes back looks like a missing
    feature rather than a rejected call. `isAppWindow()` now also allows the Settings window,
    for listing models and setting the voice only — switching models and context windows stay
    with the conversation window.
24. **Tests here can read your real config.** The runtime environment defaults to
    `~/.config/qwaudio`, `config.env` and `~/.config/opencode/opencode.json`, and several tests
    imported modules that load them. They passed only on a machine configured like upstream's,
    and editing personal config (translating ASSISTANT.md) broke them. When a test fails right
    after a config change, suspect the test; pin what it depends on - a provider, an `env: {}`,
    the shipped file - rather than reverting the config.
25. **Never resample a stream one block at a time.** A polyphase filter restarted per block
    leaves a seam at every block edge, heard as grit that exists only while audio flows.
    Upstream has a stateful `_StreamingFIRResampler`; use it, one instance per stream. And check
    every stage: this pipeline had two chunked conversions, and fixing either alone changed
    almost nothing.

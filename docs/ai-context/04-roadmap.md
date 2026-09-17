# 04 — Roadmap

Status: ✅ done · 🔧 in progress · ⏳ agreed, not started · 💡 idea

## Current status (2026-09-17, end of Claude session)
- Working tree clean on `jake/local-voice-app`; **9 commits not yet pushed** — Jake runs `Push To GitHub.cmd`.
- Items 2–4 below are built and tested but **not yet rebuilt/verified on Windows**: Jake runs
  `Rebuild My Voice App.cmd`, then checks auto-titles / rename (double-click) / pin, the Settings
  health page, and the "Look at my screen" button. Report any breakage in `03-changes.md`.
- Only remaining agreed item: 5 (background model switching).

## Agreed next (in this order)
1. ✅ **Task results with clickable paths** — verified live by Jake (cards keep the file list after the reply).
2. 🔧 **Chat titles** — coded and tested; awaiting Jake's Windows rebuild and live check.
3. 🔧 **Health panel** — built; collector tested against local services. Awaiting Windows rebuild and Settings UI check.
4. 🔧 **Screen-aware questions** — app picker, MCP capture and composer preview built; awaiting Windows rebuild and screenshot-to-answer check.
5. ⏳ **Background model switching** — preload the new model while the old one serves; context-size setting in UI.

## Done
- ✅ Git + GitHub backup (two private repos), config snapshot.
- ✅ Stop button; chat archive/delete; English search; settings fixes; no stray console.
- ✅ Stable gateway/OpenCode/model switching; agent tasks land on the visible Desktop.

## Ideas (not committed to)
- 💡 Meeting/call recorder with diarisation → action items (all local).
- 💡 Wake word → quick answers without opening the window.
- 💡 Reminders / scheduled tasks exposed in the UI.
- 💡 Footage helpers: list clips with durations, batch rename, ffmpeg proxies.
- 💡 Client admin: quotes/invoices from templates; outstanding-invoice check.
- 💡 Shoot prep: call sheet from calendar event + gear list.
- 💡 Permission memory ("always allow" per command pattern) with a review page.
- 💡 Search across chats.

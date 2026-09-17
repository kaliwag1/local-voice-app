# 04 — Roadmap

Status: ✅ done · 🔧 in progress · ⏳ agreed, not started · 💡 idea

## Current status (2026-09-17, after 2nd Claude session)
- All agreed roadmap items are now built. Jake rebuilt at 03:16 (items 2–4 in the packaged app) but
  has not yet reported on them; item 5 was added after that rebuild, so **another
  `Rebuild My Voice App.cmd` is needed**, then `Push To GitHub.cmd` (app + launcher repos).
- Live checks outstanding: auto-titles / rename (double-click) / pin; Settings → Health;
  "Look at my screen"; model switch in both `background` and `sequential` mode (sidebar text says
  which); context-window picker (check `lms ps` shows the new context, and that the launcher keeps it).
  Voice picker: pick Alba, listen; drop a WAV in `voices\`, refresh (↻), pick it, listen.
- Report any breakage in `03-changes.md`. Next work comes from the Ideas list — ask Jake which.

## Agreed next (in this order)
1. ✅ **Task results with clickable paths** — verified live by Jake (cards keep the file list after the reply).
2. 🔧 **Chat titles** — coded and tested; in the 03:16 build, awaiting Jake's live check.
3. 🔧 **Health panel** — built; collector tested against local services. In the 03:16 build, awaiting Settings UI check.
4. 🔧 **Screen-aware questions** — built; in the 03:16 build, awaiting screenshot-to-answer check.
6. 🔧 **Voice picker** — Pocket TTS presets + cloned voices from `voices\`; speech-only restart.
   Awaiting rebuild + listen test.
5. 🔧 **Background model switching** — built and unit-tested (preload when VRAM allows, services stay up
   during the load, context-size picker). Awaiting rebuild + live check.

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

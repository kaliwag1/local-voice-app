# 04 — Roadmap

Status: ✅ done · 🔧 in progress · ⏳ agreed, not started · 💡 idea

## Current status (2026-09-17 evening, end of Claude session 2)
- Working tree clean on `jake/local-voice-app`; check `git log origin/jake/local-voice-app..HEAD` —
  Jake pushes with `Push To GitHub.cmd` (app + launcher repos).
- Verified live by Jake today: background/sequential model switch (log shows both), context picker,
  voice picker (Cosette), panel resize by edge grips, tray "Reset floating orb".
- Built today, awaiting Jake's rebuild + check: orb semantics (tray/minimise → orb, ✕ → hidden),
  Settings page fix (was all-Chinese: nested `<form>`), header Settings gear, orb spawns bottom-right,
  permission memory (Remember… on cards, Settings → Permissions).
- Still never checked live: auto-titles/rename/pin, Settings → Health, "Look at my screen".
- Nothing agreed as next. Candidates from Ideas (Jake's earlier interest): footage helpers, search
  across chats, wake word / hotkey quick-ask, meeting recorder.

## Agreed next (in this order)
0. ✅ **Chat text formatting** — the adapter now keeps the model's line breaks, so lists render
   as lists. Awaiting Jake's live check. See 03-changes.
0. ✅ **Context meter, live turn readout, composer and chat list rework** — in the installed
   build; see 03-changes for what each one measures and what it deliberately does not claim.
0. ✅ **Gateway lease survives a force-kill** — stale lock naming a recycled PID no longer blocks
   every launch; a failed Gateway start now reports its real reason. See 03-changes.
0. 🔧 **Bonsai VRAM released on quit** — coded and unit-tested; needs a rebuild and one
   live check (quit the app, confirm `llama-server.exe` is gone and VRAM drops).
   See 03-changes. Crash/force-kill still orphans the server by design.
0. ✅ **Turn activity / tokens / model thinking** — compact per-turn panel, persisted
   history and explicit no-answer status. Real CRACK reasoning/tokens verified through
   the maintained local speech adapter. See 03-changes for scope and validation.
0. ✅ **Bonsai Official / CRACK PQ2** — installed via supported rebuild; live picker switches,
   saved Official cold start, and desktop replies/TTS playback on both variants verified.
   36 focused tests and live chat/tool API tests pass. Physical microphone input and full
   OpenCode task delegation remain untested. App-local NLTK data fixes the redirected-path failure.
1. ✅ **Task results with clickable paths** — verified live by Jake (cards keep the file list after the reply).
2. 🔧 **Chat titles** — coded and tested; in the 03:16 build, awaiting Jake's live check.
3. 🔧 **Health panel** — built; collector tested against local services. In the 03:16 build, awaiting Settings UI check.
4. 🔧 **Screen-aware questions** — built; in the 03:16 build, awaiting screenshot-to-answer check.
8. 🔧 **Permission memory** — persistent command/folder rules, Remember… on cards, Settings → Permissions.
   Awaiting rebuild + live check.
7. 🔧 **Resizable chat panel** — edge grips (drag verified live), size remembered; native resize removed
   after the cursor glitch. Minimise/maximise/close buttons added. Awaiting rebuild + check.
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
- 💡 Search across chats.

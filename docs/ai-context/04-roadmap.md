# 04 — Roadmap

Status: ✅ done · 🔧 in progress · ⏳ agreed, not started · 💡 idea

## Current status (2026-09-19, ~03:00, end of Claude session 3)
- Both repos pushed and clean: app `jake/local-voice-app` at `dc237e0`, launcher `main` at
  `0bdb735`. Jake pushes with `Push To GitHub.cmd`.
- The installed build in `dist\desktop-panel` matches those commits (rebuilt and relaunched
  after the last change).
- **Verified live this session:** quitting the app releases the Bonsai server (VRAM 11,992 →
  2,628 MiB); the rebuild script releases it too (11,703 → 2,262 MiB); the app starts against a
  stale Gateway lease naming a recycled PID; the composer layout, context ring, chat rows and
  row menus render and position correctly (measured in the live DOM through the Gateway UI);
  the model picker switches models; English replies after the ASSISTANT.md translation.
- **Awaiting Jake's live check:** the context ring filling on a real turn and its window-size
  buttons; the live token/rate/elapsed line; Settings → Application → Voice; the chat-row ⋮
  menu and its P/R/A/D shortcuts; the dot pulsing while the model works; the send↔stop swap;
  and lists rendering as lists after the speech-adapter fix.
- **Known gaps, deliberate:** only the open chat's dot can pulse (activity and tasks are both
  per-session, so the client cannot know about other chats); the live line shows characters,
  not tokens, until streamed chunks are shown to track reported completion tokens; a crash or
  force-kill still orphans the Bonsai server.
- Still never checked live from earlier sessions: auto-titles/rename/pin, Settings → Health,
  "Look at my screen", physical microphone input, a full end-to-end OpenCode task.

## Next up (nothing agreed yet — Jake's call)
- ⏳ **Compare streamed chunks against reported tokens.** The turn snapshot records both. If
  chunks track completion tokens on this runtime, the live line can show real token counts
  instead of characters, with evidence rather than an assumption.
- ⏳ **Per-session busy flag** on `api/conversations`, so background chats can pulse too.
- ⏳ **Graceful quit for the rebuild script.** It force-kills, which skips the app's shutdown.
  The script now releases the model server itself, but a real quit would also spare the lease.
- 💡 The older idea list below is untouched.

## Recently done (newest first)
- ✅ **Chat text keeps the model's line breaks** — speech adapter overrides `_assistant_text`.
- ✅ **Context meter, live turn readout, composer and chat list rework** — see 03-changes.
- ✅ **Gateway failures read in English** — dictionary entries for the lifecycle messages.
- ✅ **Gateway lease survives a force-kill** — PID reuse no longer blocks every launch.
- ✅ **Bonsai VRAM released on quit** — verified live by a tray quit; the rebuild script too.
- ✅ **Live model pick out of Git** — `.selected-voice-model.default` seeds a fresh clone.

## Older items, still awaiting a live check
These were built in earlier sessions and are in the installed build; nobody has confirmed them
by using them.

- 🔧 **Chat titles** — auto-titling, rename, pin.
- 🔧 **Health panel** — Settings → Health; collector tested against local services only.
- 🔧 **Screen-aware questions** — "Look at my screen", screenshot to answer.
- 🔧 **Permission memory** — persistent command/folder rules, Remember… on cards,
  Settings → Permissions.
- 🔧 **Resizable chat panel** — edge grips (drag verified live), size remembered; native resize
  was removed after the cursor glitch. See lesson 13.
- 🔧 **Voice picker** — Pocket TTS presets plus clones from `voices\`; speech-only restart.
  Moved to Settings → Application on 2026-09-19 and still needs a listen test.
- 🔧 **Background model switching** — preload when VRAM allows, services stay up during the
  load. Verified live in an earlier session; re-check after the picker moved to the composer.

## Done
- ✅ Bonsai Official / CRACK PQ2 through the local Prism runtime; both variants replied live.
- ✅ Turn activity, real usage and model thinking through the maintained speech adapter.
- ✅ Task results with clickable paths.
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

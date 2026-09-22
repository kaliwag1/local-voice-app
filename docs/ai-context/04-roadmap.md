# 04 — Roadmap

Status: ✅ done · 🔧 in progress · ⏳ agreed, not started · 💡 idea

## Current status (2026-09-23, Claude session 4)
- Branch `jake/local-voice-app`; see `git log` for the exact head. Jake pushes with
  `Push To GitHub.cmd`.
- **Every test suite passes**: root 192/193 (one skipped), desktop 298/298, web 191/191,
  server 1315/1315, speech adapter 9 + 14. Treat any new failure as real, not "pre-existing".
  One unreproduced server flake was seen once in 11 full runs.
- **Speech static fixed in code, awaiting Jake's ear.** Both resampling stages now stream
  (`seamless_audio.py`); measured -36.8 dB → -78.4 dB through the real generator. Needs a
  speech restart only, no rebuild. If it still sounds gritty, the measurement approach and the
  ruled-out causes are in 03-changes (2026-09-23) and the 2026-09-19 entries.
- **Awaiting Jake's live check, from session 3:** context ring filling and its window sizes;
  the live token/rate/elapsed line; Settings → Application → Voice (the IPC fix landed
  2026-09-19); chat-row ⋮ menu and P/R/A/D; the pulsing dot; send↔stop; lists rendering as lists.
- **Known gaps, deliberate:** only the open chat's dot can pulse; the live line shows
  characters until chunks are shown to track reported tokens; a crash or force-kill still
  orphans the Bonsai server.
- Still never checked live from earlier sessions: auto-titles/rename/pin, Settings → Health,
  "Look at my screen", physical microphone input, a full end-to-end OpenCode task.

## Recently done: the static around spoken words (2026-09-23)
🔧 Coded, tested and measured; awaiting a listen. Two per-block resampling stages, both now
streaming through upstream's own `_StreamingFIRResampler`. Full account in 03-changes.
If it regresses after a package update, `seamless_audio` disables itself on a hash mismatch and
speech falls back to upstream's behaviour - check by running the adapter's startup path by hand
(look for `unavailable` in `Last Speech Service.log`).

## Agreed features, not started (2026-09-19)

### Deafen key — silence the speaker without stopping the conversation
A key that stops you hearing the assistant, so it can keep working while you are on a call, in
a room with other people, or just tired of it talking. Text keeps arriving either way.

Two behaviours worth deciding between before building, because they are not the same thing:
- **Local mute** — the reply is still synthesised and the transcript still streams; the audio is
  simply not played. Instant, reversible mid-sentence, wastes TTS compute.
- **Output disabled** — tell the Gateway not to produce audio at all. Saves the work, but it is a
  session-level change and a mid-reply toggle is messier.

Local mute is probably what "deafen" should mean, with the Gateway flag reserved for the mode
switch below. Ask Jake which he pictured.

Existing machinery to build on:
- `web/src/realtime/useRealtimeVoice.js` already tracks `mutedPlaybackResponses` and has a
  playback queue with sources it can stop, so a global mute is close to what is there.
- Global hotkeys are a solved problem in this app: the wake shortcut and the push-to-talk key
  register through the desktop layer (`push-to-talk-hook.mjs`, uiohook-napi), and Settings →
  Application already has the shortcut-recorder control pattern to reuse.
- Deafening while audio is mid-flight must flush the queue and release playback cleanly, or the
  Gateway will keep waiting on playback events. See `playback-lifecycle.js`.

### Two modes — voice, and plain chat with no audio agent
A mode where the app is an ordinary text chat: no microphone, no speech service, no TTS. Useful
when the speech stack is not wanted or not running, and it should not require the local speech
service to be up at all.

The protocol already models this, which is the good news:
- `server/src/voice/active-voice-clients.mjs` understands `textOnly`, `inputEnabled` and
  `outputEnabled`; a `textOnly` client is deliberately excluded from voice arbitration.
- `web/src/realtime/useRealtimeVoice.js` derives all three from `enabled` / `inputOnlyMute` /
  `wakeWordOnly`, so a text-only client is already a supported shape rather than a new concept.

So the work is mostly product, not protocol: a visible mode switch that persists, a UI that hides
voice affordances in text mode, and — the part needing care — making sure a text-mode start does
not wait on, or launch, the speech service. The launcher currently starts speech before the app
(`Start My Voice App.ps1`), so a text mode that genuinely skips it needs the launcher to know the
mode too, or the app to tolerate speech being absent.

## Next up (nothing agreed yet — Jake's call)
- ✅ **Compare streamed chunks against reported tokens** — answered 2026-09-23: they do not.
  On the voice path the answer text arrives per spoken sentence, not per token; the one stored
  turn since the counters went in delivered a 58-character reply as a single chunk. The live line
  keeps showing characters. Same turn had no usage recorded, so worth watching whether the
  context ring stays "unmeasured" on Gemma 4 26B specifically (it measured fine on Bonsai and
  Qwen3.5 9B).
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

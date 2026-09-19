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
- **Agreed next, with Jake:** the static around spoken words (see the section below).
  Also agreed, not started: a deafen key and separate voice / text-only modes.
  He finds it noticeable and annoying, and wants it done in a fresh session.
- Still never checked live from earlier sessions: auto-titles/rename/pin, Settings → Health,
  "Look at my screen", physical microphone input, a full end-to-end OpenCode task.

## Next task: the static around spoken words (agreed with Jake, 2026-09-19)

**Symptom.** A broadband grit rides on the voice while it speaks. Silent in the gaps, so it is
modulated with the audio, not a noise floor.

**Cause, measured.** `speech_to_speech/TTS/pocket_tts_handler.py` streams 512-sample blocks at
the pipeline's 16 kHz. Pocket TTS generates at 24 kHz, so each block is resampled 24k → 16k
**independently** with `resample_poly`, then padded or trimmed to exactly `blocksize`. Polyphase
filters carry state across a stream; restarting per block leaves a discontinuity at every seam,
31.2 per second, only while audio flows.

Measured on a real utterance (cosette, one sentence): artifact **−41 dB relative to speech**,
and the error is *entirely* at the block seams — the middle of each block matches a continuous
resample exactly. Reproduce by resampling the same audio per-block versus in one pass and
subtracting.

**Ruled out, with evidence, so do not re-investigate:**
- Client decode (`web/src/realtime/audio.js`) is correct: little-endian int16, `/0x8000`.
- Sample rates match end to end: the service upsamples 16k → 24k for the client
  (`api/openai_realtime/handlers/audio.py`), and the browser resamples to the device rate.
- Not the voice preset. Presets differ in level and in floor between words (cosette is the
  quietest and hissiest there, azelma and jean the cleanest) but the seam artifact is a fixed
  ratio to the signal, so it is identical for all of them.
- A latent bug that does not fire: the handler casts with `(x * 32768).astype(np.int16)` and no
  clipping, so a sample at or above full scale wraps to a full-scale spike. The package's own
  `utils.resample()` clips properly. Real output peaks at 0.164, so it never triggers today —
  worth fixing alongside, and it would bite a loud cloned voice.

**Options, hardest part first.** The resampling is inline inside the handler's streaming
generator, so there is no natural seam to hook.
1. Override `process()` through the app-owned adapter, resampling continuously (carry a filter
   tail across blocks, reset per utterance). Correct, but duplicates upstream cancellation and
   speculative-turn logic, which is the real risk: that logic is what keeps interruptions and
   stale turns working.
2. Give the module a stateful resampler and reset it when an utterance starts. Smaller diff,
   but needs a reliable per-utterance reset signal.
3. Emit 24 kHz from the TTS and skip the resample entirely. Cleanest audio, but the pipeline is
   16 kHz throughout (`PIPELINE_SAMPLE_RATE`) and the output stage would then resample wrongly,
   so it is a pipeline-wide change touching the microphone and VAD paths too.

Whatever the route: it is `speech-adapter` work with version and source-hash checks, tests in
`test_reasoning_adapter.py`, then a rebuild and a listen. Verify by measuring the seam error
again and by hearing it, and re-check that interruption still cuts speech off cleanly.

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

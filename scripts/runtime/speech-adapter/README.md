# Local reasoning adapter

This app-owned startup extension targets the installed Hugging Face
`speech-to-speech==1.0.0` (Apache-2.0). It never modifies installed package files.
The parser in `reasoning_adapter.py` adapts that project's
`LLM/chat_completions_language_model.py`; the rest is local integration code.

`speechEnvironment()` and the parent launcher opt in with
`ZD_VOICE_REASONING_ADAPTER=1` and this folder in `PYTHONPATH`. The speech
executable and process ownership checks remain unchanged. The launcher also
passes `--responses_api_disable_thinking false` so supported models may use their
native reasoning mode. That can increase response latency and token counts.

Explicit SSE `reasoning_content` / `reasoning` string fields become distinct
Realtime `response.reasoning_text.delta` events. Answer text, tool calls and
usage retain upstream behavior. Thinking is never TTS input or model history.
It travels through the existing keyed/cancellable pipeline and is dropped for
unclaimed speculative work, stale turns, failed or closed responses. The app
stores at most 24,000 characters per turn, collapsed by default. Not all models
emit reasoning; absence is displayed as unavailable, never reconstructed.

It also restores the model's own line breaks in the chat panel. Upstream builds
the audio-mode transcript by stripping each part and joining with a space
(`api/openai_realtime/handlers/response.py`, `_assistant_text`), so numbered
steps and bullets arrive as one paragraph; text mode already concatenates
verbatim. The override uses that same assembly for both. Only the transcript item
changes: audio is synthesised from the parts themselves, so speech is unaffected,
and joining verbatim cannot drop or reorder words.

The extension checks the installed version and source hashes of all four
overridden functions before installing any hooks. If upstream changes, it
prints an unavailable diagnostic and leaves ordinary speech working. To upgrade,
review upstream cancellation/output contracts, adapt this file, run the tests,
then update the hashes and verify in the desktop app. Do not just change hashes.

## Seamless audio (`seamless_audio.py`)

A separate module, installed by the same opt-in but on its own, so an upstream
change to the audio path turns off only this fix.

Pocket TTS generates at 24 kHz. Upstream resampled each 32 ms block down to the
16 kHz pipeline on its own, then the realtime output resampled each block again,
up to the client's 24 kHz. A polyphase filter restarted at every block leaves a
discontinuity at each seam: 31 a second, only while speaking, heard as grit riding
on the voice. Fixing either stage alone barely helps, because each leaves its own
seams. Measured through the real upstream generator on a real utterance:
-36.8 dB relative to speech before, -78.4 dB after.

Both stages now use `_StreamingFIRResampler`, the stateful resampler upstream
already uses for its OpenAI-compatible TTS. Every sample rate and block size is
unchanged; only how the conversion is carried out differs.

- **TTS stage.** `PocketTTSHandler.process` is not overridden. It only resamples
  when the model's rate differs from the pipeline's, so `setup` wraps the model to
  report the pipeline rate and yield audio already converted as one stream, with a
  fresh resampler per utterance. The generator's cancellation and speculative-turn
  logic runs as shipped. The streaming resampler also clips, so upstream's
  unclipped int16 cast can no longer wrap a loud peak.
- **Output stage.** `AudioHandler.encode_audio_chunk` is a hash-checked copy whose
  only change is the resampling line: one resampler per response per connection.

It checks the source hashes of `PocketTTSHandler.setup`, `PocketTTSHandler.process`
and `AudioHandler.encode_audio_chunk` before installing.

From the app repository on Windows:

```
../.voice-env/Scripts/python.exe scripts/runtime/speech-adapter/test_reasoning_adapter.py
../.voice-env/Scripts/python.exe scripts/runtime/speech-adapter/test_seamless_audio.py
```

The adapter covers streamed Chat Completions, shared by both Bonsai variants and
LM Studio models. It does not invent reasoning for non-streaming providers or
expose separate OpenCode internal reasoning. Restart speech after changing the
adapter; the supported parent rebuild script does this.

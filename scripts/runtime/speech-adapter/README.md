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

The extension checks the installed version and source hashes of all three
overridden functions before installing any hooks. If upstream changes, it
prints an unavailable diagnostic and leaves ordinary speech working. To upgrade,
review upstream cancellation/output contracts, adapt this file, run the tests,
then update the hashes and verify in the desktop app. Do not just change hashes.

From the app repository on Windows:

```
../.voice-env/Scripts/python.exe scripts/runtime/speech-adapter/test_reasoning_adapter.py
```

The adapter covers streamed Chat Completions, shared by both Bonsai variants and
LM Studio models. It does not invent reasoning for non-streaming providers or
expose separate OpenCode internal reasoning. Restart speech after changing the
adapter; the supported parent rebuild script does this.

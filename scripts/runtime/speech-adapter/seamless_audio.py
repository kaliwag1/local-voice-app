"""Seamless TTS audio for speech-to-speech 1.0.0: resample as a stream, not per block.

Pocket TTS generates at 24 kHz. Upstream resamples each 32 ms block down to the
16 kHz pipeline on its own, and the realtime output then resamples each block
again, up to the client's 24 kHz. A polyphase filter restarted at every block
leaves a discontinuity at each seam - 31 a second, and only while speaking - which
is heard as grit riding on the voice. Measured on a real utterance at -38 dB
relative to speech. Fixing either stage alone barely moves it (-38.2 / -42.6 dB);
fixing both brings it to -78.6 dB, where what remains is two anti-aliasing
filters disagreeing slightly rather than seams.

Both stages now use _StreamingFIRResampler, the stateful resampler upstream
already uses for its own OpenAI-compatible TTS. Every sample rate and block size
is unchanged; only how the conversion is carried out differs.

Stage one does not touch the TTS handler's generator. That generator only
resamples when the model's rate differs from the pipeline's, so the model is
wrapped to report the pipeline rate and to yield audio already converted as one
continuous stream. The generator's own cancellation and speculative-turn logic
runs exactly as shipped.

Stage two replaces AudioHandler.encode_audio_chunk with a copy whose only change
is the resampling line: one resampler per response per connection, so a new
reply never inherits filter state from the last.

No files, sockets or permissions are touched. Source hashes of every function
this depends on are checked before anything is installed.
"""
from importlib.metadata import version
import base64
import hashlib
import inspect

import numpy as np
import torch
from openai.types.realtime import ResponseAudioDeltaEvent

from speech_to_speech.TTS.openai_compatible_handler import _StreamingFIRResampler
from speech_to_speech.TTS.pocket_tts_handler import PocketTTSHandler
from speech_to_speech.api.openai_realtime.handlers.audio import AudioHandler, PIPELINE_SAMPLE_RATE

EXPECTED_SOURCES = {
    "setup": "95eb32393f6edcb316083a96a58c0b52944ea5e1067aaf166ae19c21df4f6ee0",
    "process": "95b9a434ee5b82cee7c926d84428e69d310feebdb0a6d6470d96b2e9fdaccb84",
    "encode_audio_chunk": "63e5acf0032d9b8027ec62437e55da65f17ebbe2d5257f3af1e002b6689ba3eb",
}


class StreamingModel:
    """The Pocket TTS model, presenting pipeline-rate audio as one continuous stream."""

    def __init__(self, model, target_rate):
        self._model = model
        self._target_rate = target_rate

    @property
    def sample_rate(self):
        # Reporting the pipeline rate is what steers the handler onto its
        # no-resample path, where it only cuts the stream into blocks.
        return self._target_rate

    def generate_audio_stream(self, *args, **kwargs):
        # A fresh resampler per call, so each utterance starts from a clean
        # filter and an interrupted one leaves nothing behind.
        resampler = _StreamingFIRResampler(self._model.sample_rate, self._target_rate)
        for chunk in self._model.generate_audio_stream(*args, **kwargs):
            converted = resampler.push(chunk.cpu().numpy().astype(np.float64) * 32768)
            if converted.size:
                yield torch.from_numpy(converted.astype(np.float32) / 32768)
        tail = resampler.push(np.empty(0, dtype=np.float64), final=True)
        if tail.size:
            yield torch.from_numpy(tail.astype(np.float32) / 32768)

    def __getattr__(self, name):
        return getattr(self._model, name)


def output_resampler(handler, conn_id, response_id, rate):
    """The stateful converter for this response, replaced when a new one starts."""
    if rate == PIPELINE_SAMPLE_RATE:
        return None
    table = handler.__dict__.setdefault("_zd_output_resamplers", {})
    current = table.get(conn_id)
    if current is None or current[0] != response_id or current[1] != rate:
        current = (response_id, rate, _StreamingFIRResampler(PIPELINE_SAMPLE_RATE, rate))
        table[conn_id] = current
    return current[2]


# Adapted from Hugging Face speech-to-speech 1.0.0 (Apache-2.0),
# api/openai_realtime/handlers/audio.py, AudioHandler.encode_audio_chunk.
# Change: the per-chunk resample(audio, PIPELINE_SAMPLE_RATE, client_out_rate)
# is replaced by a per-response streaming resampler. Everything else is as shipped.
def encode_audio_chunk(self, conn_id, audio, response_key=None):
    """Encode a raw PCM audio chunk as a base64 delta event for the WebSocket transport."""
    response = self._service.response
    st = self._state(conn_id)

    resp_id, assistant_item_id, assistant_output_index, events = self.begin_audio_output(
        conn_id,
        response_key,
    )
    rp = st.current_response_params
    client_out_rate = None
    if rp and rp.audio and rp.audio.output and rp.audio.output.format:
        client_out_rate = getattr(rp.audio.output.format, "rate", None)
    if client_out_rate is None:
        audio_cfg = st.runtime_config.session.audio
        if audio_cfg is not None and audio_cfg.output is not None:
            client_out_rate = getattr(audio_cfg.output.format, "rate", None) or PIPELINE_SAMPLE_RATE
        else:
            client_out_rate = PIPELINE_SAMPLE_RATE
    resampler = output_resampler(self, conn_id, resp_id, client_out_rate)
    if resampler is not None:
        audio = resampler.push(np.frombuffer(audio, dtype=np.int16)).tobytes()
    b64 = base64.b64encode(audio).decode("ascii")
    events.append(
        ResponseAudioDeltaEvent(
            type="response.output_audio.delta",
            event_id=self._next_event_id(),
            content_index=response._next_content_index(conn_id),
            delta=b64,
            item_id=assistant_item_id,
            output_index=assistant_output_index,
            response_id=resp_id,
        )
    )
    return events


def install():
    if getattr(PocketTTSHandler, "_zd_seamless_audio", False):
        return
    if version("speech-to-speech") != "1.0.0":
        raise RuntimeError("unsupported speech-to-speech version; revalidate seamless audio first")
    for name, method in [
        ("setup", PocketTTSHandler.setup),
        ("process", PocketTTSHandler.process),
        ("encode_audio_chunk", AudioHandler.encode_audio_chunk),
    ]:
        if hashlib.sha256(inspect.getsource(method).encode()).hexdigest() != EXPECTED_SOURCES[name]:
            raise RuntimeError(f"upstream {name} changed; revalidate seamless audio first")
    if list(inspect.signature(AudioHandler.encode_audio_chunk).parameters) != ["self", "conn_id", "audio", "response_key"]:
        raise RuntimeError("audio-output contract changed")

    shipped_setup = PocketTTSHandler.setup

    def setup(self, *args, **kwargs):
        shipped_setup(self, *args, **kwargs)
        if self.model.sample_rate != self.sample_rate:
            self.model = StreamingModel(self.model, self.sample_rate)

    PocketTTSHandler.setup = setup
    AudioHandler.encode_audio_chunk = encode_audio_chunk
    PocketTTSHandler._zd_seamless_audio = True

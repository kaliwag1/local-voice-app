import unittest

import numpy as np
import torch
from scipy.signal import resample_poly

from speech_to_speech.TTS.openai_compatible_handler import _StreamingFIRResampler
from speech_to_speech.TTS.pocket_tts_handler import PocketTTSHandler
from speech_to_speech.api.openai_realtime.handlers.audio import AudioHandler
import seamless_audio


def tone(seconds=0.5, rate=24000):
    t = np.arange(int(seconds * rate)) / rate
    return (0.4 * np.sin(2 * np.pi * 220 * t) + 0.1 * np.sin(2 * np.pi * 3100 * t)).astype(np.float32)


class FakeModel:
    """Stands in for Pocket TTS: 24 kHz audio in uneven torch chunks."""

    sample_rate = 24000

    def __init__(self, audio, sizes=(1800, 700, 2400, 960)):
        self.audio = audio
        self.sizes = sizes
        self.voice_state = "kept"

    def generate_audio_stream(self, *args, **kwargs):
        position, index = 0, 0
        while position < len(self.audio):
            size = self.sizes[index % len(self.sizes)]
            yield torch.from_numpy(self.audio[position:position + size].copy())
            position += size
            index += 1


class Holder:
    pass


def seam_error(audio, block):
    """How far block-wise processing strays from converting the whole signal at once."""
    whole = resample_poly(audio, 2, 3)
    pieces = np.concatenate([resample_poly(audio[i:i + block], 2, 3) for i in range(0, len(audio) - block + 1, block)])
    n = min(len(whole), len(pieces))
    return float(np.sqrt(np.mean((whole[:n] - pieces[:n]) ** 2)))


class StreamingModelTests(unittest.TestCase):
    def test_reports_the_pipeline_rate_so_the_handler_skips_its_own_resampling(self):
        wrapped = seamless_audio.StreamingModel(FakeModel(tone()), 16000)
        self.assertEqual(wrapped.sample_rate, 16000)

    def test_chunk_boundaries_do_not_change_the_output(self):
        # The fix in one line: the same audio, cut differently, comes out identical.
        audio = tone()
        uneven = torch.cat(list(seamless_audio.StreamingModel(FakeModel(audio), 16000).generate_audio_stream())).numpy()
        even = torch.cat(list(seamless_audio.StreamingModel(FakeModel(audio, sizes=(768,)), 16000).generate_audio_stream())).numpy()
        self.assertEqual(len(uneven), len(even))
        np.testing.assert_allclose(uneven, even, atol=1 / 32768)

    def test_produces_the_whole_utterance_at_the_pipeline_rate(self):
        audio = tone(seconds=1.0)
        out = torch.cat(list(seamless_audio.StreamingModel(FakeModel(audio), 16000).generate_audio_stream())).numpy()
        self.assertEqual(len(out), 16000)

    def test_each_utterance_starts_from_a_clean_filter(self):
        wrapped = seamless_audio.StreamingModel(FakeModel(tone()), 16000)
        first = torch.cat(list(wrapped.generate_audio_stream())).numpy()
        # An interrupted generation: stop after one chunk.
        interrupted = wrapped.generate_audio_stream()
        next(interrupted)
        interrupted.close()
        again = torch.cat(list(wrapped.generate_audio_stream())).numpy()
        np.testing.assert_array_equal(first, again)

    def test_never_exceeds_full_scale(self):
        loud = np.clip(tone() * 3, -1.2, 1.2).astype(np.float32)
        out = torch.cat(list(seamless_audio.StreamingModel(FakeModel(loud), 16000).generate_audio_stream())).numpy()
        # The guarantee that matters: upstream's own cast, (x * 32768).astype(int16),
        # never wraps a loud peak round to the opposite full scale.
        scaled = out.astype(np.float64) * 32768
        np.testing.assert_array_equal((out * 32768).astype(np.int16).astype(np.float64), np.round(scaled))

    def test_everything_else_reaches_the_real_model(self):
        wrapped = seamless_audio.StreamingModel(FakeModel(tone()), 16000)
        self.assertEqual(wrapped.voice_state, "kept")

    def test_the_problem_it_solves_is_real(self):
        # Guards the premise: per-block resampling really does leave seams.
        self.assertGreater(seam_error(tone(seconds=1.0).astype(np.float64), 768), 1e-3)


class OutputResamplerTests(unittest.TestCase):
    def test_one_converter_per_response(self):
        holder = Holder()
        first = seamless_audio.output_resampler(holder, "conn", "resp-1", 24000)
        self.assertIs(seamless_audio.output_resampler(holder, "conn", "resp-1", 24000), first)
        self.assertIsNot(seamless_audio.output_resampler(holder, "conn", "resp-2", 24000), first)

    def test_a_rate_change_gets_a_fresh_converter(self):
        holder = Holder()
        first = seamless_audio.output_resampler(holder, "conn", "resp-1", 24000)
        self.assertIsNot(seamless_audio.output_resampler(holder, "conn", "resp-1", 48000), first)

    def test_connections_are_independent(self):
        holder = Holder()
        a = seamless_audio.output_resampler(holder, "a", "resp", 24000)
        b = seamless_audio.output_resampler(holder, "b", "resp", 24000)
        self.assertIsNot(a, b)

    def test_nothing_to_do_when_the_client_takes_the_pipeline_rate(self):
        self.assertIsNone(seamless_audio.output_resampler(Holder(), "conn", "resp", 16000))

    def test_blocks_joined_by_the_converter_match_one_continuous_pass(self):
        pcm = (tone(seconds=0.5, rate=16000) * 32767).astype(np.int16)
        holder = Holder()
        joined = np.concatenate([
            seamless_audio.output_resampler(holder, "conn", "resp", 24000).push(pcm[i:i + 512])
            for i in range(0, len(pcm), 512)
        ])
        single = _StreamingFIRResampler(16000, 24000).push(pcm)
        np.testing.assert_array_equal(joined[:len(single)], single[:len(joined)])


class InstallTests(unittest.TestCase):
    def test_installs_both_stages(self):
        seamless_audio.install()
        self.assertTrue(PocketTTSHandler._zd_seamless_audio)
        self.assertIs(AudioHandler.encode_audio_chunk, seamless_audio.encode_audio_chunk)

    def test_install_is_idempotent(self):
        seamless_audio.install()
        seamless_audio.install()
        self.assertIs(AudioHandler.encode_audio_chunk, seamless_audio.encode_audio_chunk)


if __name__ == "__main__":
    unittest.main()

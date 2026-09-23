import unittest
from dataclasses import fields
from queue import Queue
from threading import Event

from speech_to_speech.arguments_classes.module_arguments import ModuleArguments
from speech_to_speech.backend_registry import STT_BACKENDS, TTS_BACKENDS
from speech_to_speech.pipeline.messages import AUDIO_RESPONSE_DONE, EndOfResponse, TTSInput
from speech_to_speech.s2s_pipeline import parse_arguments
import text_only


class FakeTurns:
    """Stands in for upstream's speculative-turn tracker."""

    def __init__(self, latest=True):
        self.latest = latest

    def is_latest_after_reopen_grace(self, turn_id, turn_revision):
        return self.latest


def tts(speculative_turns=None):
    return text_only.TextOnlyTTSHandler(
        Event(),
        queue_in=Queue(),
        queue_out=Queue(),
        setup_args=(Event(),),
        # Upstream hands every TTS backend these; the stand-in must accept them.
        setup_kwargs={"gen_kwargs": {}, "cancel_scope": None, "speculative_turns": speculative_turns},
    )


class InstallTests(unittest.TestCase):
    def setUp(self):
        text_only.install()

    def test_registers_both_stand_ins_and_their_command_line_choices(self):
        self.assertIn("text-only", STT_BACKENDS)
        self.assertIn("text-only", TTS_BACKENDS)
        choices = {field.name: field.metadata["choices"] for field in fields(ModuleArguments) if field.name in ("stt", "tts")}
        self.assertIn("text-only", choices["stt"])
        self.assertIn("text-only", choices["tts"])
        # The real backends stay selectable.
        self.assertIn("parakeet-tdt", choices["stt"])
        self.assertIn("pocket", choices["tts"])

    def test_install_is_idempotent(self):
        spec = STT_BACKENDS["text-only"]
        text_only.install()
        self.assertIs(STT_BACKENDS["text-only"], spec)

    def test_the_launcher_arguments_parse(self):
        args = parse_arguments([
            "--stt", "text-only", "--tts", "text-only",
            "--llm_backend", "chat-completions", "--model_name", "m",
            "--responses_api_base_url", "http://127.0.0.1:1/v1", "--responses_api_api_key", "x",
            "--responses_api_disable_thinking", "false", "--no_smart_turn", "--device", "cpu",
        ])
        self.assertEqual(args.stt_backend.name, "text-only")
        self.assertEqual(args.tts_backend.name, "text-only")


class HandlerTests(unittest.TestCase):
    def test_end_of_response_closes_the_response_like_pocket_tts(self):
        self.assertEqual(list(tts().process(EndOfResponse())), [AUDIO_RESPONSE_DONE])

    def test_a_stale_turn_is_closed_only_when_a_response_waits_on_it(self):
        stale = FakeTurns(latest=False)
        self.assertEqual(list(tts(stale).process(EndOfResponse())), [])
        keyed = EndOfResponse(response_key="r1")
        self.assertEqual(list(tts(stale).process(keyed)), [AUDIO_RESPONSE_DONE])
        self.assertTrue(keyed.cleanup_only)

    def test_speech_requests_are_dropped(self):
        self.assertEqual(list(tts().process(TTSInput(text="hello"))), [])

    def test_the_stt_stand_in_ignores_audio(self):
        stt = text_only.TextOnlySTTHandler(Event(), queue_in=Queue(), queue_out=Queue())
        self.assertEqual(list(stt.process(b"\x00\x00")), [])


if __name__ == "__main__":
    unittest.main()

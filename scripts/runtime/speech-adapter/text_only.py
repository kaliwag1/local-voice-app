"""Text-only relay backends for the installed speech-to-speech service.

The app's typed chat reaches the model through this service, so text mode cannot simply
not start it. Started with ``--stt text-only --tts text-only`` it instead loads no speech
models: the pipeline, the Realtime protocol, tool calls and the reasoning adapter all run
as usual, and only the two speech stages are replaced by these stand-ins.

Upstream already skips TTS for a response whose ``output_modalities`` lack "audio"
(``lm_output_processor``), and the Gateway asks for text in text mode, so the TTS
stand-in only ever sees the end-of-response marker. It answers that exactly as
``PocketTTSHandler`` does, which is what closes the response. A spoken request that still
arrives is dropped: its text has already gone to the client. No audio reaches the STT
stand-in in text mode; anything that does is ignored.
"""
from dataclasses import fields

from speech_to_speech.baseHandler import BaseHandler
from speech_to_speech.pipeline.messages import AUDIO_RESPONSE_DONE, EndOfResponse

NAME = "text-only"


class TextOnlySTTHandler(BaseHandler):
    def process(self, _audio):
        return iter(())


class TextOnlyTTSHandler(BaseHandler):
    # Upstream passes every TTS backend its generation options too; none apply here.
    def setup(self, should_listen, cancel_scope=None, speculative_turns=None, **_options):
        self.should_listen = should_listen
        self.cancel_scope = cancel_scope
        self.speculative_turns = speculative_turns

    def process(self, tts_input):
        if not isinstance(tts_input, EndOfResponse):
            return
        speculative_turns = self.speculative_turns
        if speculative_turns and not speculative_turns.is_latest_after_reopen_grace(
            tts_input.turn_id,
            tts_input.turn_revision,
        ):
            if tts_input.response_key is None:
                return
            tts_input.cleanup_only = True
        yield AUDIO_RESPONSE_DONE


def install():
    from speech_to_speech import backend_registry as registry

    specs = {
        "stt": (registry.STT_BACKENDS, registry.BackendSpec(
            NAME,
            "stt",
            registry.EmptyBackendArguments,
            registry._simple_handler_factory(__name__, "TextOnlySTTHandler"),
        )),
        "tts": (registry.TTS_BACKENDS, registry.BackendSpec(
            NAME,
            "tts",
            registry.EmptyBackendArguments,
            registry._simple_handler_factory(
                __name__,
                "TextOnlyTTSHandler",
                setup_should_listen=True,
                context_kwargs=True,
            ),
        )),
    }
    for backends, spec in specs.values():
        backends.setdefault(NAME, spec)

    # The command-line choices were copied from the registries when the argument class
    # was defined, so they are extended here too.
    from speech_to_speech.arguments_classes.module_arguments import ModuleArguments

    for field in fields(ModuleArguments):
        if field.name in specs:
            choices = tuple(specs[field.name][0])
            field.metadata = {**field.metadata, "choices": choices}

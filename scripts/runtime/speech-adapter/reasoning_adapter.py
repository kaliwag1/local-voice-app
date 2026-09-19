"""Version-checked, observational extension for speech-to-speech 1.0.0.

Reasoning is separate from answer text, TTS, tools, and model history. Reuses
upstream response-key, cancellation, and speculative-turn routing. No sockets,
files, cloud requests, or permission changes are introduced by this module.
"""
from dataclasses import dataclass
from importlib.metadata import version
import inspect
import hashlib

from pydantic import BaseModel
from speech_to_speech.LLM import chat_completions_language_model as chat
from speech_to_speech.LLM.base_openai_compatible_language_model import BaseOpenAICompatibleHandler
from speech_to_speech.pipeline.events import AssistantOutputEvent
from speech_to_speech.api.openai_realtime.handlers.response import ResponseHandler


@dataclass
class ReasoningDelta:
    text: str


class ReasoningOutput(AssistantOutputEvent):
    reasoning_delta: str


class ReasoningServerEvent(BaseModel):
    type: str = "response.reasoning_text.delta"
    event_id: str
    response_id: str
    delta: str


def install():
    if getattr(chat, "_zd_reasoning_adapter", False):
        return
    if version("speech-to-speech") != "1.0.0":
        raise RuntimeError("unsupported speech-to-speech version; revalidate adapter first")
    consume = BaseOpenAICompatibleHandler._consume_streaming
    output = ResponseHandler.on_assistant_output
    transcript = ResponseHandler._assistant_text
    # This package is sometimes shipped from git without a version bump.
    for method, expected in [
        (chat._iter_chat_stream_events, 'e5816a1e0d40e184ad9b7d4b424445408c380babffc82e6a1767ec1fac31b0b4'),
        (consume, '9ffc616fc5eb6dd45d4840803def5759bc7911831cfe2672f19e4654dfe6820a'),
        (output, '19b073bac83bf04812c29c795b3064ecf1986a3b8d67a68be6e8ae7d51078779'),
        (transcript, '233804b1a6bcc2a7e24a895303140b973fc30c0378502a2cd05f3756e66cbb61'),
    ]:
        if hashlib.sha256(inspect.getsource(method).encode()).hexdigest() != expected:
            raise RuntimeError(f'upstream {method.__name__} changed; revalidate adapter first')
    if list(inspect.signature(consume).parameters) != ["self", "events", "state", "turn"]:
        raise RuntimeError("stream-consumer contract changed")
    if list(inspect.signature(output).parameters) != ["self", "conn_id", "event", "wait_for_pending_reopen", "_early_tool_call"]:
        raise RuntimeError("response-handler contract changed")
    if list(inspect.signature(transcript).parameters) != ["pending", "wants_audio"]:
        raise RuntimeError("transcript-assembly contract changed")

    def consume_with_reasoning(self, events, state, turn):
        def filtered():
            remaining = 24001  # one extra character lets the UI mark truncation
            for event in events:
                if not isinstance(event, ReasoningDelta):
                    yield event
                    continue
                # Never reveal speculative output before its response is claimed.
                prefetch = turn.prefetch_transaction
                if prefetch is not None and not prefetch.claimed:
                    continue
                if (self._turn_is_cancelled(turn)
                        or not self._turn_is_latest(turn.turn_id, turn.turn_revision)
                        or not self._turn_output_allowed(turn.turn_id, turn.turn_revision)):
                    continue
                delta = event.text[:remaining]
                remaining -= len(delta)
                if delta:
                    self.queue_out.put(ReasoningOutput(
                        reasoning_delta=delta, response_key=turn.response_key,
                        turn_id=turn.turn_id, turn_revision=turn.turn_revision,
                        cancel_generation=turn.gen,
                    ))
        return (yield from consume(self, filtered(), state, turn))

    def output_with_reasoning(self, conn_id, event, *, wait_for_pending_reopen=True, _early_tool_call=False):
        if not isinstance(event, ReasoningOutput):
            return output(self, conn_id, event, wait_for_pending_reopen=wait_for_pending_reopen, _early_tool_call=_early_tool_call)
        # Service dispatch already applies its stale-turn gate. The router also
        # holds keyed output until response.created has actually been sent.
        st = self._state(conn_id)
        if (not st.in_response or st.response_failed or not st.current_response_id
                or st.current_response_key != event.response_key
                or event.response_key in st.closed_response_keys):
            return []
        return [ReasoningServerEvent(event_id=self._next_event_id(),
                                     response_id=st.current_response_id, delta=event.reasoning_delta)]

    ResponseHandler._assistant_text = staticmethod(assistant_text_keeping_line_breaks)
    chat._iter_chat_stream_events = iter_chat_stream_events
    BaseOpenAICompatibleHandler._consume_streaming = consume_with_reasoning
    ResponseHandler.on_assistant_output = output_with_reasoning
    chat._zd_reasoning_adapter = True


# Adapted from Hugging Face speech-to-speech 1.0.0 (Apache-2.0),
# api/openai_realtime/handlers/response.py. Upstream assembles the audio-mode
# transcript by stripping each part and joining with a space, which discards
# every line break the model wrote: numbered steps and bullets arrive in the
# chat panel as one paragraph. Text mode already concatenates verbatim, so this
# uses that same assembly for both, keeping the whitespace the model produced.
#
# Only the transcript item is affected. Audio is synthesised from the parts
# themselves, so what is spoken does not change, and joining verbatim cannot
# drop or reorder words.
def assistant_text_keeping_line_breaks(pending, wants_audio):
    """Assemble transcript parts without discarding the model's formatting."""
    parts = pending["parts"]
    assert isinstance(parts, list)
    return "".join(str(part) for part in parts)


# Adapted from Hugging Face speech-to-speech 1.0.0 (Apache-2.0),
# LLM/chat_completions_language_model.py. Changes: emit explicit reasoning
# fields as separate events. All answer/tool/usage normalization is preserved.
def iter_chat_stream_events(api_response):
    tool_accum = {}
    usage = None
    text_segment = ""

    def flush_tools():
        nonlocal text_segment
        if text_segment:
            yield chat.AssistantMessage(content=[chat.AssistantContent(type="output_text", text=text_segment)])
            text_segment = ""
        yield from chat._tool_calls_from_accum(tool_accum)
        tool_accum.clear()

    def accumulate_tools(tool_calls):
        for tool_call in tool_calls or []:
            entry = tool_accum.setdefault(tool_call.index, {"name": "", "args": "", "id": ""})
            if tool_call.id:
                entry["id"] = tool_call.id
            if tool_call.function is not None:
                if tool_call.function.name:
                    entry["name"] = tool_call.function.name
                if tool_call.function.arguments:
                    entry["args"] += tool_call.function.arguments

    for chunk in api_response:
        if chunk.usage is not None:
            usage = chat.Usage(input_tokens=chunk.usage.prompt_tokens or 0, output_tokens=chunk.usage.completion_tokens or 0)
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
        if isinstance(reasoning, str) and reasoning:
            yield ReasoningDelta(reasoning)
        text_piece = delta.content or getattr(delta, "refusal", None)
        continuing_tool = bool(tool_accum)
        if continuing_tool:
            accumulate_tools(delta.tool_calls)
        if text_piece:
            if continuing_tool:
                yield from flush_tools()
            text_segment += text_piece
            yield chat.TextDelta(text=text_piece)
        if not continuing_tool:
            accumulate_tools(delta.tool_calls)
    if tool_accum:
        yield from flush_tools()
    if text_segment:
        yield chat.AssistantMessage(content=[chat.AssistantContent(type="output_text", text=text_segment)])
    if usage is not None:
        yield usage

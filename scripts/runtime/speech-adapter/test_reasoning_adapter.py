import unittest
from queue import Queue
from types import SimpleNamespace as NS
from openai.types.chat import ChatCompletionChunk
from speech_to_speech.LLM.base_openai_compatible_language_model import _GenState
from speech_to_speech.api.openai_realtime.handlers.response import ResponseHandler
import reasoning_adapter as adapter

adapter.install()


def chunk(delta=None, usage=None):
    return ChatCompletionChunk(id="provider-response", object="chat.completion.chunk", created=0,
        model="test", choices=[] if delta is None else [{"index": 0, "delta": delta}], usage=usage)


class AdapterTests(unittest.TestCase):
    def test_separate_reasoning_answer_and_usage(self):
        events = list(adapter.iter_chat_stream_events([
            chunk({"reasoning_content": "Check arithmetic."}),
            chunk({"content": "Four."}),
            chunk(usage={"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16}),
        ]))
        self.assertEqual(events[0].text, "Check arithmetic.")
        self.assertIsInstance(events[0], adapter.ReasoningDelta)
        self.assertEqual(events[1].text, "Four.")
        self.assertEqual(events[-1].output_tokens, 4)
        self.assertEqual(events[2].content[0].text, "Four.")

    def test_reasoning_never_guessed_from_answer_or_tool_arguments(self):
        events = list(adapter.iter_chat_stream_events([
            chunk({"content": "I think it is four."}),
            chunk({"tool_calls": [{"index": 0, "id": "c1", "type": "function",
                "function": {"name": "web_search", "arguments": '{"query":"test"}'}}]}),
        ]))
        self.assertFalse(any(isinstance(e, adapter.ReasoningDelta) for e in events))
        tool = next(e for e in events if isinstance(e, adapter.chat.ToolCall))
        self.assertEqual(tool.item.name, "web_search")

    def consume(self, *, cancelled=False, prefetch=None):
        fake = NS(queue_out=Queue(), _turn_is_cancelled=lambda t: cancelled,
            _turn_is_latest=lambda *a: True, _turn_output_allowed=lambda *a: True,
            _chunk=lambda turn, **kw: kw)
        turn = NS(turn_id="t1", turn_revision=2, gen=3, response_key="key1",
            wants_audio=False, prefetch_transaction=prefetch)
        state = _GenState()
        output = list(adapter.BaseOpenAICompatibleHandler._consume_streaming(fake,
            iter([adapter.ReasoningDelta("private thought"), adapter.chat.TextDelta(text="Answer.")]), state, turn))
        return fake.queue_out, output, state

    def test_pipeline_keeps_reasoning_out_of_tts_and_history(self):
        queue, output, state = self.consume()
        event = queue.get_nowait()
        self.assertIsInstance(event, adapter.ReasoningOutput)
        self.assertEqual(event.response_key, "key1")
        self.assertEqual(event.cancel_generation, 3)
        self.assertFalse(event.text)
        self.assertFalse(event.parts)
        self.assertEqual(output, [{"text": "Answer."}])
        self.assertEqual(state.clean_text, "Answer.")

    def test_cancelled_and_unclaimed_speculative_reasoning_is_dropped(self):
        for args in ({"cancelled": True}, {"prefetch": NS(claimed=False)}):
            queue, _, _ = self.consume(**args)
            self.assertTrue(queue.empty())

    def test_realtime_maps_only_matching_active_response(self):
        st = NS(in_response=True, response_failed=False, current_response_id="r1",
                current_response_key="key1", closed_response_keys=set())
        handler = NS(_state=lambda conn: st, _next_event_id=lambda: "event1")
        event = adapter.ReasoningOutput(reasoning_delta="Thinking", response_key="key1")
        output = adapter.ResponseHandler.on_assistant_output(handler, "c1", event)
        self.assertEqual(output[0].model_dump(), {"type": "response.reasoning_text.delta",
            "response_id": "r1", "event_id": "event1", "delta": "Thinking"})
        st.current_response_key = "another"
        self.assertEqual(adapter.ResponseHandler.on_assistant_output(handler, "c1", event), [])
        st.current_response_key = "key1"
        st.response_failed = True
        self.assertEqual(adapter.ResponseHandler.on_assistant_output(handler, "c1", event), [])


class TranscriptTests(unittest.TestCase):
    """The chat panel shows this text, so it must keep the model's formatting.

    Upstream stripped each part and joined them with a space in audio mode,
    which turned a numbered list into a single paragraph.
    """

    def assemble(self, parts, wants_audio):
        return ResponseHandler._assistant_text({"parts": parts}, wants_audio)

    def test_line_breaks_survive_a_spoken_answer(self):
        parts = ["Here is how:\n\n", "1. Find a gym\n", "2. Book a session\n"]
        spoken = self.assemble(parts, True)
        self.assertEqual(spoken, "Here is how:\n\n1. Find a gym\n2. Book a session\n")
        # Markdown only makes a list when each item starts its own line.
        self.assertEqual(spoken.count("\n1. "), 1)
        self.assertEqual(spoken.count("\n2. "), 1)

    def test_audio_and_text_modes_now_agree(self):
        parts = ["One.\n", "Two.\n"]
        self.assertEqual(self.assemble(parts, True), self.assemble(parts, False))

    def test_nothing_is_dropped_or_reordered(self):
        parts = ["alpha ", "beta ", "gamma"]
        self.assertEqual(self.assemble(parts, True), "alpha beta gamma")

    def test_empty_parts_are_harmless(self):
        self.assertEqual(self.assemble([], True), "")
        self.assertEqual(self.assemble(["", "text"], True), "text")


if __name__ == "__main__":
    unittest.main()

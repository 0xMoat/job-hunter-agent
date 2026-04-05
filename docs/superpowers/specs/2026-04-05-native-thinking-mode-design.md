# DeepSeek Native Thinking Mode

Replace the `_analyze` node's extra LLM call with DeepSeek's native thinking mode. One API call instead of two, with real chain-of-thought reasoning instead of a shallow 1-2 sentence plan.

## Context

Current flow: `analyze → chat ↔ tool_call`. The analyze node calls a tool-free LLM to produce a brief plan, then routes to chat. This costs an extra API call per message and yields only superficial reasoning.

DeepSeek's `deepseek-chat` model supports a native thinking mode (`thinking: {"type": "enabled"}`) that produces deep chain-of-thought reasoning as part of the normal response, exposed via `reasoning_content` in the API response.

**Constraint**: `ChatOpenAI` from langchain-openai does not preserve non-standard fields like `reasoning_content`. The `langchain-deepseek` package's `ChatDeepSeek` class handles this natively.

**Fallback policy (option 1)**: Only `deepseek-chat` gets thinking mode. When the LLMService falls back to Groq/Gemini models (which use `ChatOpenAI`), reasoning is simply absent — acceptable for a degraded path.

## Changes

### 1. New dependency

Add `langchain-deepseek` to `pyproject.toml`.

### 2. LLMRegistry — `app/services/llm.py`

Replace the deepseek-chat entry:

```python
# Before
from langchain_openai import ChatOpenAI
ChatOpenAI(model="deepseek-chat", base_url="https://api.deepseek.com", ...)

# After
from langchain_deepseek import ChatDeepSeek
ChatDeepSeek(
    model="deepseek-chat",
    api_key=settings.DEEPSEEK_API_KEY,
    temperature=settings.DEFAULT_LLM_TEMPERATURE,
    max_tokens=settings.MAX_TOKENS,
    thinking={"type": "enabled"},
)
```

All other models (Groq, Gemini) stay as `ChatOpenAI`. Both extend `BaseChatModel`; the fallback/retry loop requires no changes.

When `LLMRegistry.get()` receives custom kwargs for deepseek-chat, it should instantiate `ChatDeepSeek` (not `ChatOpenAI`). Add a provider-awareness check in the `get()` classmethod.

### 3. Graph simplification — `app/core/langgraph/graph.py`

Remove:
- `_analyze` method
- `_plain_llm` instance (no longer needed)
- `analyze` node from `StateGraph`
- Synthetic reasoning events in the `updates` handler of `get_stream_response`

Change:
- Entry point: `analyze` → `chat`
- `GraphState.reasoning` field: delete (in `app/schemas/graph.py`)

### 4. Streaming reasoning extraction — `app/core/langgraph/graph.py`

In `get_stream_response`, within the `messages` event handler for `AIMessageChunk`:

```python
if isinstance(token, AIMessageChunk):
    # Check for reasoning content blocks (ChatDeepSeek produces these)
    if hasattr(token, "content_blocks") and token.content_blocks:
        for block in token.content_blocks:
            if block["type"] == "reasoning":
                yield json.dumps({
                    "type": "reasoning_chunk",
                    "content": block["reasoning"],
                    "done": False,
                })
            elif block["type"] == "text":
                yield json.dumps({
                    "type": "text",
                    "content": block["text"],
                    "done": False,
                })
    elif token.content:
        # Plain string content (fallback models, or text-only chunks)
        yield json.dumps({
            "type": "text",
            "content": token.content,
            "done": False,
        })
```

The `content_blocks` API is LangChain's standard way to surface provider-specific structured content (reasoning, citations, etc.). When a fallback model is active, chunks have plain `content` strings with no `content_blocks`, so reasoning events are naturally absent.

Tool call chunk handling remains unchanged.

### 5. Frontend — `frontend/components/chat/ThinkingCard.tsx`

- Remove `"analyze"` from `NODE_LABELS`
- Add `max-h-64 overflow-y-auto` to the reasoning text container (native reasoning can be hundreds of tokens, unlike the old 1-2 sentence plan)

### 6. No changes needed

- `frontend/hooks/useChat.ts` — already handles `reasoning_chunk` events
- `frontend/lib/types.ts` — `StreamChunk` and `ThinkingEntry` types are compatible
- `LLMService` retry/fallback — `ChatDeepSeek` extends `BaseChatModel`
- Langfuse tracing — config passthrough unchanged
- `get_response` (non-streaming) — benefits from better reasoning quality automatically; reasoning not surfaced to user in this path
- `get_chat_history` / `_process_messages_for_history` — no reasoning stored in checkpoint messages

## Implementation risk

The exact shape of `content_blocks` from `ChatDeepSeek` during streaming needs verification after installing the package. If the API differs from the documented pattern, the streaming extraction logic will need adjustment. This is the single highest-risk item and should be validated first during implementation.

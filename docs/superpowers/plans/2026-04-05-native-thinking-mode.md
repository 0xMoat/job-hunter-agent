# Native Thinking Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `_analyze` node's extra LLM call with DeepSeek's native thinking mode, delete the unused non-streaming path, and display real chain-of-thought reasoning in the frontend.

**Architecture:** Remove the `analyze` graph node entirely. Switch the deepseek-chat registry entry from `ChatOpenAI` to `ChatDeepSeek` with `thinking` enabled. Extract `reasoning_content` from streaming `AIMessageChunk` content blocks and emit existing `reasoning_chunk` SSE events. Frontend already handles these events — only needs minor ThinkingCard adjustments.

**Tech Stack:** langchain-deepseek, LangGraph, FastAPI SSE streaming, React/Next.js

---

### Task 1: Add `langchain-deepseek` dependency

**Files:**
- Modify: `pyproject.toml:7-41`

- [ ] **Step 1: Add the dependency**

In `pyproject.toml`, add `langchain-deepseek` to the `dependencies` list:

```toml
    "mem0ai>=1.0.0",
    "uvloop>=0.22.1",
    "apscheduler>=3.11.2",
    "langchain-deepseek>=0.1.0",
```

- [ ] **Step 2: Install and verify**

Run:
```bash
uv sync
uv run python -c "from langchain_deepseek import ChatDeepSeek; print('OK')"
```
Expected: prints `OK` with no errors.

- [ ] **Step 3: Verify ChatDeepSeek streaming content_blocks shape**

This is the highest-risk item. Run a quick test to see what `ChatDeepSeek` actually produces during streaming, so we know the exact field names to use later:

```bash
uv run python -c "
import asyncio
from langchain_deepseek import ChatDeepSeek

async def main():
    llm = ChatDeepSeek(
        model='deepseek-chat',
        api_key='__DEEPSEEK_API_KEY__',
        max_tokens=200,
        thinking={'type': 'enabled'},
    )
    async for chunk in llm.astream('What is 15 * 37?'):
        # Print the raw chunk to see its structure
        print(type(chunk).__name__, '|',
              'content:', repr(chunk.content)[:120],
              '| additional_kwargs:', {k: repr(v)[:80] for k, v in chunk.additional_kwargs.items()} if chunk.additional_kwargs else '{}')

asyncio.run(main())
"
```

Replace `__DEEPSEEK_API_KEY__` with the actual key from `.env.development`. Observe the output:
- If reasoning appears in `chunk.additional_kwargs["reasoning_content"]` — we extract from there.
- If reasoning appears as list items in `chunk.content` with `type: "reasoning"` — we iterate content blocks.
- If reasoning appears in `chunk.content` as a plain string during the reasoning phase — we need a different detection method.

**Record the exact field path for reasoning content. Tasks 4-5 depend on this.**

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: add langchain-deepseek dependency"
```

---

### Task 2: Switch deepseek-chat to `ChatDeepSeek` in LLMRegistry

**Files:**
- Modify: `app/services/llm.py:1-165`

- [ ] **Step 1: Update imports**

At the top of `app/services/llm.py`, add the `ChatDeepSeek` import:

```python
from langchain_deepseek import ChatDeepSeek
```

- [ ] **Step 2: Replace the deepseek-chat registry entry**

Replace lines 43-54 (the first entry in `LLMS`):

```python
# Before
{
    "name": "deepseek-chat",
    "llm": ChatOpenAI(
        model="deepseek-chat",
        tiktoken_model_name="gpt-4o",
        api_key=settings.DEEPSEEK_API_KEY,
        temperature=settings.DEFAULT_LLM_TEMPERATURE,
        max_tokens=settings.MAX_TOKENS,
        base_url="https://api.deepseek.com",
    ),
},

# After
{
    "name": "deepseek-chat",
    "llm": ChatDeepSeek(
        model="deepseek-chat",
        api_key=settings.DEEPSEEK_API_KEY,
        temperature=settings.DEFAULT_LLM_TEMPERATURE,
        max_tokens=settings.MAX_TOKENS,
        thinking={"type": "enabled"},
    ),
},
```

Note: `ChatDeepSeek` sets the DeepSeek base URL automatically — no `base_url` needed. `tiktoken_model_name` is a `ChatOpenAI`-specific param — omit it.

- [ ] **Step 3: Update `LLMRegistry.get()` for provider-awareness**

When custom kwargs are passed for a deepseek model, `get()` currently creates a `ChatOpenAI`. It must create `ChatDeepSeek` instead. Replace the kwargs branch (lines 129-137):

```python
# Before
if kwargs:
    logger.debug("creating_llm_with_custom_args", model_name=model_name, custom_args=list(kwargs.keys()))
    return ChatOpenAI(
        model=model_name,
        tiktoken_model_name="gpt-4o",
        api_key=settings.OPENAI_API_KEY,
        **({"base_url": settings.LLM_BASE_URL} if settings.LLM_BASE_URL else {}),
        **kwargs,
    )

# After
if kwargs:
    logger.debug("creating_llm_with_custom_args", model_name=model_name, custom_args=list(kwargs.keys()))
    if model_name.startswith("deepseek"):
        return ChatDeepSeek(
            model=model_name,
            api_key=settings.DEEPSEEK_API_KEY,
            **kwargs,
        )
    return ChatOpenAI(
        model=model_name,
        tiktoken_model_name="gpt-4o",
        api_key=settings.OPENAI_API_KEY,
        **({"base_url": settings.LLM_BASE_URL} if settings.LLM_BASE_URL else {}),
        **kwargs,
    )
```

- [ ] **Step 4: Verify the module loads**

Run:
```bash
uv run python -c "from app.services.llm import LLMRegistry; print(type(LLMRegistry.LLMS[0]['llm']).__name__)"
```
Expected: `ChatDeepSeek`

- [ ] **Step 5: Commit**

```bash
git add app/services/llm.py
git commit -m "feat: switch deepseek-chat to ChatDeepSeek with thinking mode"
```

---

### Task 3: Remove non-streaming dead code

**Files:**
- Modify: `app/api/v1/chatbot.py:38-82` (delete `POST /chat` endpoint)
- Modify: `app/core/langgraph/graph.py:439-494,761-768` (delete `get_response`, `__process_messages`)
- Modify: `app/schemas/chat.py:70-77` (delete `ChatResponse`)
- Modify: `app/schemas/__init__.py:6` (remove `ChatResponse` from imports/exports)

- [ ] **Step 1: Delete `ChatResponse` from schemas**

In `app/schemas/chat.py`, delete the entire `ChatResponse` class (lines 70-77):

```python
# DELETE this entire class:
class ChatResponse(BaseModel):
    """Response model for chat endpoint.

    Attributes:
        messages: List of messages in the conversation.
    """

    messages: List[Message] = Field(..., description="List of messages in the conversation")
```

- [ ] **Step 2: Remove `ChatResponse` from `__init__.py` exports**

In `app/schemas/__init__.py`, remove `ChatResponse` from the import and `__all__`:

```python
# Before
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    HistoryMessage,
    HistoryResponse,
    Message,
    StreamResponse,
    ToolCallRecord,
)

__all__ = [
    "Token",
    "ChatRequest",
    "ChatResponse",
    ...
]

# After
from app.schemas.chat import (
    ChatRequest,
    HistoryMessage,
    HistoryResponse,
    Message,
    StreamResponse,
    ToolCallRecord,
)

__all__ = [
    "Token",
    "ChatRequest",
    ...  # (remove "ChatResponse" line)
]
```

- [ ] **Step 3: Delete `POST /chat` endpoint from chatbot.py**

In `app/api/v1/chatbot.py`, delete the entire `chat` function (lines 38-82) and the `ChatResponse` import. The imports block becomes:

```python
from app.schemas.chat import (
    ChatRequest,
    HistoryResponse,
    Message,
)
```

Remove `ChatResponse` from the import list. The `Message` import may also become unused after this — check if anything else in the file uses it. If not, remove it too.

- [ ] **Step 4: Delete `get_response` and `__process_messages` from graph.py**

In `app/core/langgraph/graph.py`:

Delete the `get_response` method (lines 439-494) and the `__process_messages` method (lines 761-768).

Also remove the `convert_to_openai_messages` usage from the `get_response` method. Check if `convert_to_openai_messages` is still used elsewhere in the file (it is — in `get_stream_response` line 669). Keep the import.

- [ ] **Step 5: Verify the app still loads**

Run:
```bash
uv run python -c "from app.api.v1.chatbot import router; print('routes:', [r.path for r in router.routes])"
```
Expected: routes list contains `/chat/stream`, `/messages` but NOT `/chat`.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/chatbot.py app/core/langgraph/graph.py app/schemas/chat.py app/schemas/__init__.py
git commit -m "refactor: remove unused non-streaming chat endpoint and ChatResponse"
```

---

### Task 4: Remove `_analyze` node and simplify graph

**Files:**
- Modify: `app/core/langgraph/graph.py:79-98,243-283,393-437` (remove `_plain_llm`, `_analyze`, update `create_graph`)
- Modify: `app/schemas/graph.py:19` (remove `reasoning` field)

- [ ] **Step 1: Remove `reasoning` from GraphState**

In `app/schemas/graph.py`, delete line 19:

```python
# Before
class GraphState(BaseModel):
    """State definition for the LangGraph Agent/Workflow."""

    messages: Annotated[list, add_messages] = Field(
        default_factory=list, description="The messages in the conversation"
    )
    long_term_memory: str = Field(default="", description="The long term memory of the conversation")
    reasoning: str = Field(default="", description="Reasoning plan from analyze node. Empty string means direct response.")

# After
class GraphState(BaseModel):
    """State definition for the LangGraph Agent/Workflow."""

    messages: Annotated[list, add_messages] = Field(
        default_factory=list, description="The messages in the conversation"
    )
    long_term_memory: str = Field(default="", description="The long term memory of the conversation")
```

- [ ] **Step 2: Remove `_plain_llm` from `__init__`**

In `app/core/langgraph/graph.py`, in the `__init__` method, delete lines 88-93:

```python
# DELETE these lines:
        # Tool-free LLM for the analyze node.
        # Must NOT use self.llm_service which has bind_tools() applied —
        # a tool-bound model would emit tool calls instead of plain text, breaking "direct" detection.
        # Use LLMRegistry to get the default model instance so credentials (api_key, base_url)
        # are always correct regardless of which provider is currently primary.
        self._plain_llm = LLMRegistry.get(settings.DEFAULT_LLM_MODEL)
```

Also remove the `LLMRegistry` import from the `from app.services.llm import LLMRegistry, llm_service` line if `LLMRegistry` is no longer used anywhere in the file. Check first — if the cover_letter tool or something else imports it via this file, keep it. (It's imported directly in tools, so safe to remove from graph.py if unused.)

- [ ] **Step 3: Delete the `_analyze` method**

Delete the entire `_analyze` method (lines 243-283).

- [ ] **Step 4: Update `create_graph` — remove analyze node, set chat as entry**

In `create_graph`, replace the graph construction (lines 401-406):

```python
# Before
graph_builder = StateGraph(GraphState)
graph_builder.add_node("analyze", self._analyze, ends=["chat"])
graph_builder.add_node("chat", self._chat, ends=["tool_call", END])
graph_builder.add_node("tool_call", self._tool_call, ends=["chat"])
graph_builder.set_entry_point("analyze")   # was: "chat"
graph_builder.set_finish_point("chat")     # unchanged

# After
graph_builder = StateGraph(GraphState)
graph_builder.add_node("chat", self._chat, ends=["tool_call", END])
graph_builder.add_node("tool_call", self._tool_call, ends=["chat"])
graph_builder.set_entry_point("chat")
graph_builder.set_finish_point("chat")
```

- [ ] **Step 5: Clean up unused imports in graph.py**

After removing `_analyze`, check which imports are now unused:
- `SystemMessage` — was used in `_analyze` prompt. Check if used elsewhere in file. If not, remove from the `langchain_core.messages` import.
- `LLMRegistry` — was used for `self._plain_llm`. Remove from imports if unused.

- [ ] **Step 6: Verify**

Run:
```bash
uv run python -c "
from app.core.langgraph.graph import LangGraphAgent
a = LangGraphAgent()
print('has _analyze:', hasattr(a, '_analyze'))
print('has _plain_llm:', hasattr(a, '_plain_llm'))
"
```
Expected:
```
has _analyze: False
has _plain_llm: False
```

- [ ] **Step 7: Commit**

```bash
git add app/core/langgraph/graph.py app/schemas/graph.py
git commit -m "refactor: remove _analyze node, simplify graph to chat → tool_call"
```

---

### Task 5: Extract reasoning from streaming content blocks

**Files:**
- Modify: `app/core/langgraph/graph.py` — the `get_stream_response` method

This task depends on the findings from Task 1 Step 3 (the content_blocks shape verification). The code below assumes reasoning arrives in `chunk.additional_kwargs["reasoning_content"]` OR as content block items in `chunk.content` — adapt based on actual findings.

- [ ] **Step 1: Remove the analyze-specific streaming logic**

In `get_stream_response`, delete the entire `updates` handler for the analyze node (lines 552-580):

```python
# DELETE this entire block:
                # Handle "updates" events: analyze node reasoning arrives here (ainvoke, not streaming)
                if event_mode == "updates":
                    for node_name, state_update in event_data.items():
                        if node_name == "analyze":
                            # Emit synthetic node_enter + optional reasoning_chunk + node_exit for the analyze node.
                            # _analyze uses ainvoke so no "messages" events are emitted for it;
                            # we synthesize the node lifecycle events here instead.
                            _analyze_start = time.time()
                            yield _json.dumps({
                                "type": "node_enter",
                                "content": "",
                                "node_name": "analyze",
                                "done": False,
                            })
                            if state_update.get("reasoning"):
                                yield _json.dumps({
                                    "type": "reasoning_chunk",
                                    "content": state_update["reasoning"],
                                    "done": False,
                                })
                            _analyze_elapsed = int((time.time() - _analyze_start) * 1000)
                            yield _json.dumps({
                                "type": "node_exit",
                                "content": "",
                                "node_name": "analyze",
                                "duration_ms": _analyze_elapsed,
                                "done": False,
                            })
                    continue
```

Replace with a simple skip:

```python
                if event_mode == "updates":
                    continue
```

- [ ] **Step 2: Remove the analyze node skip in messages handler**

Delete the `if _node == "analyze": pass` block and the `_node != "analyze"` guard (lines 591-616 area). Simplify to just the node transition logic:

```python
                token, _metadata = event_data

                try:
                    _node = _metadata.get("langgraph_node") if _metadata else None

                    # Emit node_enter / node_exit on node transitions
                    if _node != _current_node:
                        if _current_node and _current_node in _node_start_time:
                            _elapsed = int((time.time() - _node_start_time[_current_node]) * 1000)
                            yield _json.dumps({
                                "type": "node_exit",
                                "content": "",
                                "node_name": _current_node,
                                "duration_ms": _elapsed,
                                "done": False,
                            })
                        if _node:
                            yield _json.dumps({
                                "type": "node_enter",
                                "content": "",
                                "node_name": _node,
                                "done": False,
                            })
                            _node_start_time[_node] = time.time()
                        _current_node = _node
```

- [ ] **Step 3: Add reasoning extraction to the AIMessageChunk handler**

Replace the current `AIMessageChunk` content handler. The old code (line 633-638):

```python
                        elif token.content:
                            yield _json.dumps({
                                "type": "text",
                                "content": token.content,
                                "done": False,
                            })
```

Replace with reasoning-aware logic. **Adapt this based on Task 1 Step 3 findings:**

**Option A — if reasoning is in `additional_kwargs["reasoning_content"]`:**

```python
                    if isinstance(token, AIMessageChunk):
                        if token.tool_call_chunks:
                            for tc in token.tool_call_chunks:
                                tool_call_id = tc.get("id", "")
                                if tc.get("name"):
                                    tool_call_args[tool_call_id] = tc.get("args", "")
                                    yield _json.dumps({
                                        "type": "tool_call",
                                        "content": "",
                                        "tool_name": tc["name"],
                                        "tool_call_id": tool_call_id,
                                        "done": False,
                                    })
                                elif tool_call_id in tool_call_args:
                                    tool_call_args[tool_call_id] += tc.get("args", "")
                        else:
                            # Emit reasoning_chunk if present (DeepSeek thinking mode)
                            reasoning = token.additional_kwargs.get("reasoning_content")
                            if reasoning:
                                yield _json.dumps({
                                    "type": "reasoning_chunk",
                                    "content": reasoning,
                                    "done": False,
                                })
                            # Emit text content
                            if token.content:
                                yield _json.dumps({
                                    "type": "text",
                                    "content": token.content,
                                    "done": False,
                                })
```

**Option B — if reasoning arrives as content blocks in `chunk.content` (list type):**

```python
                    if isinstance(token, AIMessageChunk):
                        if token.tool_call_chunks:
                            # ... (tool call handling unchanged)
                        else:
                            # Handle structured content blocks (DeepSeek thinking mode)
                            if isinstance(token.content, list):
                                for block in token.content:
                                    if isinstance(block, dict):
                                        if block.get("type") == "reasoning":
                                            yield _json.dumps({
                                                "type": "reasoning_chunk",
                                                "content": block.get("reasoning", ""),
                                                "done": False,
                                            })
                                        elif block.get("type") == "text":
                                            yield _json.dumps({
                                                "type": "text",
                                                "content": block.get("text", ""),
                                                "done": False,
                                            })
                            elif token.content:
                                yield _json.dumps({
                                    "type": "text",
                                    "content": token.content,
                                    "done": False,
                                })
```

Choose the option that matches Task 1 Step 3 findings. Both options are complete — use one, not both.

- [ ] **Step 4: Remove `time` import if unused**

Check if `time` is still used after removing analyze synthetic events. It IS still used for `_node_start_time` tracking, so keep it.

- [ ] **Step 5: Commit**

```bash
git add app/core/langgraph/graph.py
git commit -m "feat: extract native reasoning_content from DeepSeek thinking mode stream"
```

---

### Task 6: Update `process_llm_response` for thinking mode

**Files:**
- Modify: `app/utils/graph.py:24-67`

The `_chat` node calls `process_llm_response(response_message)` which currently strips reasoning blocks and keeps only text. With thinking mode, reasoning blocks from DeepSeek now arrive in the non-streaming `_chat` path (used by LangGraph's internal `ainvoke`). We should still extract text-only content for the checkpoint (reasoning is streamed separately), but no longer log reasoning as a curiosity — it's expected.

- [ ] **Step 1: Update process_llm_response**

```python
def process_llm_response(response: BaseMessage) -> BaseMessage:
    """Process LLM response to extract text from structured content blocks.

    Models with thinking mode (e.g., DeepSeek) return content as a list of blocks:
    [
        {'type': 'reasoning', ...},
        {'type': 'text', 'text': 'actual response'}
    ]

    This function extracts the text content for checkpoint storage.
    Reasoning content is delivered to the frontend via streaming events, not stored.

    Args:
        response: The raw response from the LLM

    Returns:
        BaseMessage with plain text content
    """
    if isinstance(response.content, list):
        text_parts = []
        for block in response.content:
            if isinstance(block, dict):
                if block.get("type") == "text" and "text" in block:
                    text_parts.append(block["text"])
            elif isinstance(block, str):
                text_parts.append(block)

        response.content = "".join(text_parts)

    return response
```

- [ ] **Step 2: Remove the `prepare_messages` reasoning error handling if no longer needed**

In `prepare_messages`, there's a `try/except` for `"Unrecognized content block type"` (lines 91-102). This was added for reasoning blocks. With `ChatDeepSeek`, check if this error still occurs. If `process_llm_response` runs before `prepare_messages` processes the messages (it does — in `_chat`, response is processed before being added to state), then messages in state should already be plain text. Keep the handler as a safety net anyway — it's harmless.

- [ ] **Step 3: Commit**

```bash
git add app/utils/graph.py
git commit -m "refactor: simplify process_llm_response for thinking mode"
```

---

### Task 7: Frontend — update ThinkingCard for native reasoning

**Files:**
- Modify: `frontend/components/chat/ThinkingCard.tsx`

- [ ] **Step 1: Remove "analyze" from NODE_LABELS**

```typescript
// Before
const NODE_LABELS: Record<string, string> = {
  analyze: "Analyze",
  chat: "Chat",
  tool_call: "Tool",
}

// After
const NODE_LABELS: Record<string, string> = {
  chat: "Chat",
  tool_call: "Tool",
}
```

- [ ] **Step 2: Make reasoning text container scrollable**

Native DeepSeek reasoning can be hundreds of tokens — add scroll. Replace line 101-108:

```tsx
{/* Before */}
<div className="px-3 py-2.5">
  {/* Reasoning text */}
  <p className="font-body text-xs text-[var(--text-3)] italic leading-relaxed mb-2">
    {entry.reasoningText}
    {isActive && (
      <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
    )}
  </p>

{/* After */}
<div className="px-3 py-2.5">
  {/* Reasoning text */}
  <div className="max-h-64 overflow-y-auto mb-2">
    <p className="font-body text-xs text-[var(--text-3)] italic leading-relaxed">
      {entry.reasoningText}
      {isActive && (
        <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
      )}
    </p>
  </div>
```

- [ ] **Step 3: Remove "direct" check from render guard**

The `_analyze` node returned "direct" for simple conversations. With native thinking mode, DeepSeek doesn't produce that string. The guard on line 32 checks for "direct" — remove that condition:

```tsx
// Before
if (!entry.reasoningText || entry.reasoningText.toLowerCase().startsWith("direct")) {
  return null
}

// After
if (!entry.reasoningText) {
  return null
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/chat/ThinkingCard.tsx
git commit -m "feat: update ThinkingCard for native DeepSeek reasoning"
```

---

### Task 8: Verify end-to-end

**Files:** None (manual testing)

- [ ] **Step 1: Run linting**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent
make lint
make format
```

Fix any lint errors.

- [ ] **Step 2: Start the backend**

```bash
make dev
```

Verify no startup errors. Check logs for `graph_created` showing the simplified graph.

- [ ] **Step 3: Start the frontend**

```bash
cd frontend && pnpm dev
```

- [ ] **Step 4: Send a test message that triggers reasoning**

Send a message like "帮我搜索北京的 Python 后端岗位" — this should trigger tool use, and DeepSeek's thinking mode should produce reasoning content visible in the ThinkingCard.

Verify:
- ThinkingCard appears with real chain-of-thought reasoning (not 1-2 sentence plan)
- Reasoning text is scrollable if long
- Node badges show "Chat" and "Tool" (no "Analyze")
- Tool call cards still work
- Final text response renders correctly

- [ ] **Step 5: Send a simple message**

Send "你好" — this should NOT produce a ThinkingCard (DeepSeek may or may not produce reasoning for simple messages — if it does, the card appears, which is fine).

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```

Only if fixes were needed.

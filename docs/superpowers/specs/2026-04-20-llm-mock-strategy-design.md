# LLM Mock Strategy — Design Spec

**Status:** Agreed, pending implementation plan
**Date:** 2026-04-20
**Scope:** Unblock the deferred items from `2026-04-19-test-infrastructure.md` Phase 4 (LangGraph nodes, SSE streaming, LLMService resilience) by establishing a shared mock strategy and a prioritized test backlog.

---

## Goals

Establish a single, reusable LLM mock layer that lets us write regression tests for the five behaviors that currently have **zero safety net**, ordered by return-on-investment:

| # | Target behavior | Why it matters |
|---|---|---|
| C | SSE streaming contract at `/chat/stream` | Any change here breaks the frontend chat panel silently — highest blast radius |
| A | `LLMService` retry + circular model fallback | Dead-code risk: only runs when prod LLMs fail, so untested today |
| E | `plan-execute` state machine (planner / approval-gate HITL / executor / replanner) | Most-churned backend area, has real interrupt-resume semantics |
| B | Main LangGraph agent ReAct loop (`chat ⇄ tool_call`) | Foundation of all chat features; wires C’s underlying behavior |
| D | Individual tool parsers (structured-output validation) | Catches schema drift when LLMs return malformed JSON |

## Non-Goals

- Replacing `evals/` — Langfuse-based LLM-as-judge scoring stays as the mechanism for *prompt quality*. This spec covers *code correctness*.
- Record/replay fixtures (`vcrpy`) — rejected, see Alternatives.
- Testing prompt content itself (`"does the planner produce sensible steps"`) — belongs in `evals/`, not pytest.
- End-to-end tests that hit real LLM providers in CI.

---

## Architecture

### Mock injection boundary

**Primary injection point: replace `BaseChatModel` instances.**

Rationale: `BaseChatModel` is LangChain’s stable public interface. Every LLM call in this codebase — `LLMService._llm.ainvoke`, `_structured_llm(Model).ainvoke`, `create_react_agent(llm, tools)` — ultimately bottoms out at a `BaseChatModel`. Mocking at this layer:

- Is provider-neutral (works for DeepSeek, OpenAI, Groq, Gemini via `ChatOpenAI`)
- Exercises the real orchestration code (`LLMService.call` retry loop, graph node transitions, SSE adapter)
- Doesn’t break when LLM SDKs bump versions

**Two flavors of fake, one helper module** `tests/support/fake_llm.py`:

```python
# For tests that need scripted message outputs (C, B, most of E)
def make_fake_chat_model(messages: list[AIMessage | list[AIMessageChunk]]) -> FakeMessagesListChatModel

# For tests that need to trigger exceptions (A, some E)
def make_flaky_chat_model(side_effects: list[Exception | AIMessage]) -> AsyncMock  # spec=BaseChatModel

# For structured output (planner / replanner / tool parsers)
def make_structured_fake(schema: type[BaseModel], return_value: BaseModel) -> AsyncMock
```

Plus two injection helpers:

```python
# Swap llm_service._llm AND any cached _llm on the LangGraphAgent / PlanExecuteAgent.
def inject_main_llm(monkeypatch, fake) -> None

# Replace the whole registry (needed for fallback tests — _switch_to_next_model reads
# LLMRegistry.LLMS directly).
def patch_registry(monkeypatch, fakes: list[tuple[str, Any]]) -> None
```

### Tenacity fast-path

`wait_exponential(min=2, max=10)` will sleep real seconds in tests. All resilience tests must apply:

```python
monkeypatch.setattr("app.services.llm.wait_exponential", lambda **_: wait_none())
```

This patches the import site; the live `@retry` decorator re-reads it at call time.

### Checkpointer: `MemorySaver`, not Postgres

For graph-level integration tests (C / E / B integration), use `langgraph.checkpoint.memory.MemorySaver` instead of `AsyncPostgresSaver`. Faster, isolated, no fixture setup. Postgres-persistence behavior is already exercised by the existing `test_migrate_idempotency` + router tests.

---

## Test Plan

24 tests total, grouped by priority. Each priority can ship as its own commit.

### C — SSE streaming contract (3 tests)

File: `tests/integration/test_chat_stream.py`. Uses `session_client` + `inject_main_llm` + real compiled graph via `MemorySaver`.

| Test | Fake LLM script | Assertion |
|---|---|---|
| `test_chat_stream_plain_text` | `[AIMessage(content="hi")]` | SSE contains at least one `data: {...content...}` event and a terminal `done` event |
| `test_chat_stream_with_tool_call` | `[AIMessage(tool_calls=[{name:"duckduckgo", args:{q:"x"}}]), AIMessage(content="final")]` + fake duckduckgo tool returns `"canned"` | Event order: tool_call_start → tool_call_end → content → done |
| `test_chat_stream_done_event_always_fires` | `[AIMessage(content="")]` | `done` event present even on empty reply |

### A — LLMService resilience (4 tests)

File: `tests/unit/test_llm_service.py`. Fresh `LLMService()` per test, uses `patch_registry`, no FastAPI involved.

| Test | Registry | Assertion |
|---|---|---|
| `test_retry_succeeds_after_transient_rate_limit` | `[("A", flaky([RateLimitError, RateLimitError, AIMessage("ok")]))]` | Returns `"ok"`, no model switch |
| `test_fallback_to_second_model_after_first_exhausts_retries` | `[("A", flaky([APIError]*3)), ("B", flaky([AIMessage("ok")]))]` | Returns `"ok"`, `_current_model_index == 1` |
| `test_fallback_through_all_models` | `A/B/C` where only C succeeds | Returns C’s output, `models_tried == 3` |
| `test_all_models_fail_raises_runtime_error` | All three flaky | Raises `RuntimeError`, message matches `"after trying 3 models"` |

### E — plan-execute state machine (8 tests)

**E-1: route + node units (6 tests)** `tests/unit/test_plan_execute_nodes.py`

| Test | Approach |
|---|---|
| `test_route_after_approval_approve_goes_to_executor` | Pure function, synthetic state |
| `test_route_after_approval_reject_goes_to_replanner` | Pure function |
| `test_route_after_approval_cancel_ends` | Pure function |
| `test_should_end_empty_plan_ends` | Pure function |
| `test_planner_generates_plan_from_goal` | `make_structured_fake(Plan, Plan(steps=["a","b"]))`; call `agent._planner(state, config)`; assert `{"plan": ["a","b"]}` |
| `test_replan_returns_final_response_ends_run` | `make_structured_fake(PlanDecision, PlanDecision(action="respond", response="done"))`; assert state gets `response` field |

**E-2: compiled graph + HITL (2 tests)** `tests/integration/test_plan_execute_graph.py`. `MemorySaver`, `inject_main_llm` for the executor ReAct sub-agent.

| Test | Script |
|---|---|
| `test_happy_path_plan_approve_execute_end` | planner→`Plan(["step1"])`, executor-LLM→`AIMessage("done")`, replanner→`respond`. Resume with `Command(resume={"action":"approve"})`. Assert: `response` field set, LLM called 3 times |
| `test_reject_loops_back_to_replanner` | planner→`Plan(["step1"])` → interrupt → `Command(resume={"action":"reject","feedback":"no"})` → replanner→`Plan(["step2"])` → interrupt again. Assert: `approval_round == 2` |

### B — main ReAct graph (4 tests)

**B-1: nodes (3 tests)** `tests/unit/test_graph_nodes.py`

| Test | Approach |
|---|---|
| `test_chat_node_with_no_tool_calls_commands_to_end` | Fake LLM returns `AIMessage(content="hi")`; assert `Command(goto=END)` |
| `test_chat_node_with_tool_calls_commands_to_tool_call` | Fake LLM returns `AIMessage(tool_calls=[...])`; assert `Command(goto="tool_call")` |
| `test_tool_call_node_appends_tool_result_and_returns_to_chat` | Inject fake tool via `monkeypatch.setattr(agent, "_tools", [fake_tool])`; run node; assert `ToolMessage` appended |

**B-2: ReAct loop integration (1 test)** `tests/integration/test_graph_react_loop.py`

| Test | Script |
|---|---|
| `test_react_loop_tool_call_then_final_response` | Fake LLM: `[AIMessage(tool_calls=[search(q="python")]), AIMessage(content="python is a language, that's all.")]`; fake tool returns `"python is a language"`; run compiled graph with `MemorySaver`; assert final `AIMessage` + intermediate `ToolMessage` |

### D — tool parsers (5 tests)

File: `tests/unit/test_tool_parsers.py`

| Test | Purpose |
|---|---|
| `test_score_jd_match_valid_schema` | Happy path: structured LLM returns valid Pydantic → tool yields structured result |
| `test_score_jd_match_missing_required_field_raises` | Malformed LLM output → tool raises `ValidationError` (guard against silent corruption) |
| `test_company_research_markdown_extraction` | LLM returns markdown headers → extraction logic correct |
| `test_cover_letter_handles_empty_resume` | `resume_text=""` → no crash, produces canned output |
| `test_duckduckgo_search_transforms_ddg_output` | Mock `DDGS().text()` → tool output format matches schema |

**Explicitly not tested in D:** `application_tracker` / `job_preferences` / `save_*` (covered by router integration tests), `resume_pdf` (visual QA only), `start_plan_execute` (covered by E), `job_search` (covered by B-2), prompt-content tools (`resume_studio`, `analyze_jd_gap`, `generate_interview_questions` — `evals/` territory).

---

## Execution Order

Incremental mock-fixture build, each commit adds a thin slice on top of the last:

1. **Shared `tests/support/fake_llm.py`** — zero tests, helpers only
2. **C-1** `test_chat_stream_plain_text` — validates `inject_main_llm` + SSE adapter
3. **B-1** 3 node units — exercises the fake_llm helper without graph complexity
4. **B-2** ReAct loop — validates tool injection pattern
5. **C-2 / C-3** tool_call + done stream tests — reuses B-2’s tool mock
6. **A** 4 resilience tests — adds `patch_registry` helper
7. **E-1** 6 node units — adds `make_structured_fake`
8. **E-2** 2 HITL integration — exercises `Command(resume=...)` via `MemorySaver`
9. **D** 5 parser tests — smallest surface, mostly reuses E-1’s structured fake

Per-step commits keep review costs low; CI stays green throughout.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `respx` HTTP-level mocking | Chunk-by-chunk SSE stream mocking is painful; breaks on SDK version bumps; over-tests LangChain internals |
| `vcrpy` record/replay | Cassettes go stale every prompt tweak; CI gets flaky; trust boundary with real LLM output is unclear |
| Monkeypatch `LLMService.call()` directly | Tests wouldn’t exercise the retry/fallback logic at all (that’s priority A’s whole point) |
| Fake at `LangGraphAgent.astream()` level | C would be a formatter-test only; loses all agent-correctness coverage |
| Skip mocking, run against real LLM in CI | Non-determinism + cost + rate limits + network flakiness |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Fake `AIMessageChunk` stream format drifts from real providers | Seed initial chunks from a one-shot real-LLM run (recorded by hand, dumped into fixture constants). Only done for C-1. |
| `_structured_llm` uses `.with_structured_output(...)` which returns a *different* Runnable — mock must preserve this | `make_structured_fake` returns an `AsyncMock` whose `.with_structured_output.return_value` is itself, so the chain works |
| `agent._tools` list is built at agent init — monkeypatch after init must also invalidate compiled graph cache | `inject_main_llm` clears `agent._graph = None` before re-compile |
| Graph-level integration tests share `MemorySaver` → state bleeds | Each test builds a fresh agent + fresh saver; no session scope |
| Tenacity `before_sleep_log` still logs warnings during fast-path tests | Accept; warnings are informational |

---

## Open Questions

None — proceed to implementation plan.

## Success Criteria

- `make test` passes with all 24 new tests green
- CI `Tests` workflow stays ≤ 60s wall time
- Fake LLM fixtures are reusable enough that the **next** router/tool/feature PR can add a test by writing just the test body (not new mocks)
- Zero real LLM calls in CI

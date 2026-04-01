# mem0 长期记忆集成文档

## 架构概览

```
用户消息 → _get_relevant_memory (mem0 search) → 注入 system prompt → LangGraph 执行 → _update_long_term_memory (mem0 add)
```

## 模型配置

| 用途 | 模型 | Provider | Base URL | API Key 来源 | 免费配额 |
|------|------|----------|----------|-------------|---------|
| 主聊天 LLM | `llama-3.3-70b-versatile` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | 30 RPM, 14,400 RPD |
| mem0 事实提取 LLM | `llama-3.3-70b-versatile` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | 与主 LLM 共享配额 |
| mem0 Embedding | `gemini-embedding-001` | Google | `https://generativelanguage.googleapis.com/v1beta/openai/` | `OPENAI_API_KEY` | 5-15 RPM（以 AI Studio 控制台为准）|
| Analyze 节点 LLM | `llama-3.3-70b-versatile` | Groq（经 LLMRegistry） | 同上 | `GROQ_API_KEY` | 与主 LLM 共享配额 |

### 配额隔离设计

mem0 LLM（Groq）和 mem0 Embedding（Google）分走不同 provider，避免共享配额互相打满。

## mem0 检索（Search）

### 触发时机

**每次用户发送消息时，在 LangGraph graph 执行之前，同步等待（blocking）。**

### 代码位置

- `app/core/langgraph/graph.py` → `_get_relevant_memory()` 方法
- 调用点：`get_response()` 和 `get_stream_response()` 内部

```python
# get_response() / get_stream_response() 中：
relevant_memory = (
    await self._get_relevant_memory(user_id, messages[-1].content)
) or "No relevant memory found."
```

### 使用的 Context

| 参数 | 来源 | 说明 |
|------|------|------|
| `user_id` | `session.user_id`（JWT 解析） | 跨 session 一致，同一用户共享记忆 |
| `query` | `messages[-1].content` | **仅最后一条用户消息**，非整个 session |

### 检索结果注入

检索到的记忆以字符串形式注入到 `GraphState.long_term_memory` 字段，最终格式化进 system prompt 的 `{long_term_memory}` 占位符：

```markdown
# What you know about the user
* 用户名是小明
* 用户是 Python 程序员
* 用户喜欢使用 Claude Code
```

### 内部调用链

```
_get_relevant_memory(user_id, query)
  → AsyncMemory.search(user_id=user_id, query=query)
    → Embedding 模型将 query 向量化 (gemini-embedding-001)
    → pgvector 做向量相似度搜索
    → 返回匹配的 memory 条目
```

## mem0 存储（Add）

### 触发时机

**每次 graph 执行完成后，以 `asyncio.create_task()` 后台异步执行（non-blocking, fire-and-forget）。**

### 代码位置

- `app/core/langgraph/graph.py` → `_update_long_term_memory()` 方法
- 调用点：`get_response()` 和 `get_stream_response()` 末尾

```python
# get_response() 中：
recent_messages = self._get_recent_rounds(response["messages"])
asyncio.create_task(
    self._update_long_term_memory(
        user_id, convert_to_openai_messages(recent_messages), config["metadata"]
    )
)

# get_stream_response() 中：
state: StateSnapshot = await self._graph.aget_state(config=config)
if state.values and "messages" in state.values:
    recent_messages = self._get_recent_rounds(state.values["messages"])
    asyncio.create_task(
        self._update_long_term_memory(
            user_id, convert_to_openai_messages(recent_messages), config["metadata"]
        )
    )
```

### 使用的 Context

| 参数 | 来源 | 说明 |
|------|------|------|
| `user_id` | `session.user_id` | 同检索 |
| `messages` | 最近 3 轮对话（`_get_recent_rounds`） | 非完整 session，滑动窗口 |
| `metadata` | `config["metadata"]` | 包含 user_id, session_id, environment 等 |

### 3 轮滑动窗口

`_get_recent_rounds()` 找到所有 `HumanMessage` 的位置索引，只保留最后 3 轮（每轮 = HumanMessage + 后续所有 AI/Tool 消息），避免重复提取和 token 浪费。

### 内部调用链

```
_update_long_term_memory(user_id, messages, metadata)
  → AsyncMemory.add(messages, user_id=user_id, metadata=metadata)
    → LLM 从对话中提取事实 (llama-3.3-70b-versatile via Groq)
    → Embedding 模型将事实向量化 (gemini-embedding-001)
    → pgvector 存储向量 + 元数据
```

## mem0 初始化

```python
# app/core/langgraph/graph.py → _long_term_memory()
AsyncMemory.from_config(config_dict={
    "vector_store": {"provider": "pgvector", ...},
    "llm":          {"provider": "openai", model="llama-3.3-70b-versatile", base_url="groq"},
    "embedder":     {"provider": "openai", model="gemini-embedding-001", base_url="google"},
})
```

实例缓存在 `self.memory`，首次调用时初始化，后续复用。

## OTel Tracing

mem0 操作通过 OpenTelemetry span 暴露给 Langfuse（v3.9.1 OTel 版本）：

- `mem0_search` span — 记录 `user_id`, `query`, `result_count`
- `mem0_add` span — 记录 `user_id`, `message_count`, `result`

```python
from opentelemetry import trace
tracer = trace.get_tracer("langgraph-agent")
with tracer.start_as_current_span("mem0_search", attributes={...}) as span:
    ...
```

## .env 配置项

```bash
# .env.development
LONG_TERM_MEMORY_MODEL=llama-3.3-70b-versatile       # mem0 事实提取 LLM
LONG_TERM_MEMORY_EMBEDDER_MODEL=gemini-embedding-001  # mem0 Embedding 模型
LONG_TERM_MEMORY_COLLECTION_NAME=longterm_memory      # pgvector collection 名
```

---

## Debug 踩坑记录

### 1. Google Embedding 模型名带 `models/` 前缀导致 404

**现象：** `models/text-embedding-004 is not found for API version v1main`

**根因：** Google OpenAI 兼容端点 (`/v1beta/openai/`) 不接受 `models/` 前缀。`.env` 中配置为 `models/text-embedding-004`，但正确写法应不带前缀。

**修复：** `LONG_TERM_MEMORY_EMBEDDER_MODEL=gemini-embedding-001`（同时该模型已下线，换为最新稳定版）

### 2. `text-embedding-004` 已下线

**现象：** 即使去掉 `models/` 前缀，`text-embedding-004` 仍然 404。

**根因：** Google 已不在官方模型列表中提供 `text-embedding-004`，替代方案为 `gemini-embedding-001`。

### 3. Google API 429 配额耗尽

**现象：** `Error code: 429 - You exceeded your current quota`

**根因：** mem0 的 LLM（`gemini-2.5-flash`）和主 agent 的 analyze 节点都走 Google API，共享同一个 API key 的配额，并发请求打满免费额度。

**修复：** 将 mem0 LLM 改为 Groq（`llama-3.3-70b-versatile`），与 Google Embedding 分离 provider，不再共享配额。

### 4. `.env` 修改后 hot reload 不生效

**现象：** 修改 `.env.development` 后，uvicorn `--reload` 重启子进程仍使用旧值。

**根因：** `make dev` 通过 `source scripts/set_env.sh` 将 `.env` 值 export 到 shell 环境变量。uvicorn 重启子进程继承父 shell 环境，而 `load_dotenv()` 默认 `override=False` 不覆盖已存在的环境变量。

**修复：** `config.py` 中 `load_dotenv(dotenv_path=env_file, override=True)`，让文件值始终优先。改完后仍需**首次手动重启 `make dev`**。

### 5. `sync_to_async(self._graph.get_state)` 与 `AsyncPostgresSaver` 不兼容

**现象：** streaming 结束后获取 state 可能静默失败，导致 memory update 从未触发。

**根因：** `get_state` 是同步方法，在 `sync_to_async` 的线程池中无法正确调用异步的 PostgreSQL checkpointer。LangGraph 提供了原生的 `aget_state` 异步方法。

**修复：** 所有 `await sync_to_async(self._graph.get_state)(config)` 替换为 `await self._graph.aget_state(config)`。

### 6. Llama 3.3 tool calling 过于激进

**现象：** 无论用户说什么（包括"你好"、"我是谁？"），模型都会调用 `job_search_tool`。

**根因：** `llama-3.3-70b-versatile` 在 Groq 上的 tool calling 行为激进。系统提示词中 "Job Hunting Specialist" + 7 个工具绑定，模型倾向于总是调用工具。工具描述只有正面触发条件（"Use this when..."），没有负面约束（"Do NOT use when..."）。

**修复：**
- system prompt 新增 `# Tool Usage Rules` 区块，明确"闲聊/问答 → 不调工具"
- 高风险工具（`job_search_tool`, `company_research_tool`, `application_tracker_tool`）描述加入 `ONLY call this tool when...` / `Do NOT call this for...` 约束

### 7. `Message.content` 的 `max_length=3000` 限制了 system prompt

**现象：** system prompt 扩展后超过 3000 字符，Pydantic 校验报错。

**根因：** `Message` schema 的 `content` 字段 `max_length=3000` 同时约束了 `role="system"` 的消息。

**修复：** `max_length` 从 3000 放宽到 50000。

### 8. Langfuse v3.9.1 没有 `decorators` 模块

**现象：** `from langfuse.decorators import langfuse_context, observe` 导入失败。

**根因：** Langfuse 3.x 是 OpenTelemetry 架构，`@observe` 和 `langfuse_context` 是 v2.x 的 API，3.x 中已移除。

**修复：** 改用 OpenTelemetry 原生 `trace.get_tracer()` + `start_as_current_span()` 创建 span，Langfuse 3.x 自动采集 OTel span。

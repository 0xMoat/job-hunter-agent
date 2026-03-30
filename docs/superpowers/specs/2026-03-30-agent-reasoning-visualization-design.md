# Agent 推理可视化设计文档

**日期：** 2026-03-30
**状态：** 已批准
**背景：** 为面试 Agentic Engineer 准备的 demo 原型，补齐 agent 思考过程和节点转换进度的可视化

---

## 问题陈述

现有聊天界面已完整实现工具调用可视化（ToolCallCard），但 agent 的内部推理过程完全不可见：

- `app/utils/graph.py` 中的 reasoning block 处理逻辑仅写 debug log，前端不接收任何推理信息
- 用户只看到工具被调用和结果返回，不知道 agent 为什么这么决策
- 面试演示时，"agent 在想什么"是最核心的展示点，目前是黑盒

---

## 技术约束

- 模型栈：Gemini 2.5/2.0/1.5 Flash，经 OpenAI 兼容 API 接入，无原生 extended thinking 支持
- `app/utils/graph.py` 中处理 reasoning block 的代码（Claude Anthropic API 格式）对当前模型无效，为死代码
- 需复用现有 ToolCallCard 组件风格，保持 UI 一致性

---

## 设计决策

### UI 风格：可折叠思考块（Option C）

默认折叠，头部显示节点 badge 序列，点击展开完整推理文字。流式接收时自动展开，完成后自动折叠。

- 演示时手动展开，形成"reveal moment"
- 不新增永久性 UI 区域，不占额外空间
- 和 ToolCallCard 行为模式统一

### 推理来源：新增 `analyze` LangGraph 节点

不依赖模型 thinking token，在 LangGraph 图中插入显式的规划节点。LLM 自己决定是否需要推理（简单对话时输出 `"direct"`，不显示思考卡片）。

---

## 图结构变更

**现有：**
```
START → chat → END
         ↕
      tool_call
```

**新增后：**
```
START → analyze → chat → END
                   ↕
               tool_call
```

`analyze` 节点始终执行，但输出为空时前端不渲染任何内容，用户无感知。

---

## 新 SSE 事件类型

在现有 `text | tool_call | tool_result | done` 基础上新增：

| 事件 | 触发时机 | 携带字段 |
|------|---------|---------|
| `node_enter` | `metadata["langgraph_node"]` 发生变化（进入新节点） | `node_name: str` |
| `reasoning_chunk` | `analyze` 节点流式输出（始终发出，前端过滤 "direct"） | `content: str` |
| `node_exit` | 节点切换（离开旧节点） | `node_name: str`, `duration_ms: int` |

**典型事件流（有推理）：**
```
node_enter  { node_name: "analyze" }
reasoning_chunk { content: "用户想搜索 Python 后端职位，" }
reasoning_chunk { content: "需要调用 job_search_tool 获取实时数据，" }
reasoning_chunk { content: "再按 match_score 排序返回 Top 5。" }
node_exit   { node_name: "analyze", duration_ms: 820 }
node_enter  { node_name: "chat" }
tool_call   { tool_name: "job_search_tool", ... }
tool_result { ... }
text        { content: "找到 8 个匹配职位..." }
node_exit   { node_name: "chat", duration_ms: 1240 }
done
```

**典型事件流（简单对话，无推理）：**
```
node_enter  { node_name: "analyze" }
node_exit   { node_name: "analyze", duration_ms: 180 }
node_enter  { node_name: "chat" }
text        { content: "你好！" }
node_exit   { node_name: "chat", duration_ms: 340 }
done
```

---

## 后端改动

### `app/schemas/graph.py`（状态类实际名称为 `GraphState`）

`GraphState` 新增字段：
```python
reasoning: str = ""  # analyze 节点写入，空字符串表示直接回答
```

> 已知限制：`reasoning` 字段会随 LangGraph PostgreSQL checkpoint 跨轮次持久化。由于 `_analyze` 每轮都会覆盖该字段，不影响正确性，但检查 checkpoint 快照时会看到上一轮的值。

### `app/schemas/chat.py`

`StreamChunk` 扩展：
```python
type: Literal["text", "tool_call", "tool_result", "reasoning_chunk", "node_enter", "node_exit", "done"]
node_name: Optional[str] = None
duration_ms: Optional[int] = None
```

### `app/core/langgraph/graph.py`

**`LangGraphAgent.__init__` 新增无工具绑定的 plain LLM：**
```python
# 在 __init__ 里，和 self.llm_service 并列初始化
self._plain_llm = ChatOpenAI(
    model=settings.DEFAULT_LLM_MODEL,
    tiktoken_model_name="gpt-4o",
    api_key=settings.OPENAI_API_KEY,
    temperature=0.0,
    max_tokens=256,
    **({"base_url": settings.LLM_BASE_URL} if settings.LLM_BASE_URL else {}),
)
```

> 必须使用独立的无工具实例。`self.llm_service` 已通过 `bind_tools()` 绑定了工具，如果 analyze 节点使用它，模型会生成工具调用而非纯文本，破坏 "direct" 检测逻辑。

**新增 `self._analyze` 实例方法（与 `self._chat` 并列）：**
```python
async def _analyze(self, state: GraphState, config: RunnableConfig) -> Command:
    last_user_msg = next(
        (m for m in reversed(state.messages) if isinstance(m, HumanMessage)), None
    )
    if not last_user_msg:
        return Command(update={"reasoning": ""}, goto="chat")

    prompt = SystemMessage(content=(
        "In 1-2 sentences, describe what you need to do to answer the user. "
        "If it is simple conversation with no tool use needed, output exactly: direct"
    ))
    # 传入 config 以确保 Langfuse CallbackHandler 追踪此次 LLM 调用
    response = await self._plain_llm.ainvoke([prompt, last_user_msg], config=config)
    text = response.content.strip()
    # 模型被指示输出小写 "direct"，前端过滤同样检查小写前缀，保持一致
    reasoning = "" if text.lower().startswith("direct") else text
    return Command(update={"reasoning": reasoning}, goto="chat")
```

> "direct" 的大小写合约：系统提示要求模型输出小写 `"direct"`，后端和前端均以 `startsWith("direct")` 检测，区分大小写。如模型输出 `"Direct"` 等变体将不被过滤——这是已知的轻微风险，可通过在 prompt 末尾重申 "lowercase only" 缓解。

**图连线更新（遵循现有 `set_entry_point` 约定，不引入 `START`）：**
```python
graph_builder.add_node("analyze", self._analyze, ends=["chat"])
graph_builder.add_node("chat", self._chat, ends=["tool_call", END])
graph_builder.add_node("tool_call", self._tool_call, ends=["chat"])
graph_builder.set_entry_point("analyze")   # 原来是 set_entry_point("chat")
graph_builder.set_finish_point("chat")     # 保留不变，chat 节点仍是终止点
```

**`get_stream_response()` 节点追踪逻辑：**

`analyze` 节点的 `AIMessageChunk` 总是流出，但前端根据累积文本是否以 `"direct"` 开头决定是否渲染 ThinkingCard。后端统一发出所有 `reasoning_chunk`，判断逻辑在前端。

```python
import time

current_node: str | None = None
node_start_ms: dict[str, float] = {}

async for token, metadata in self.graph.astream(..., stream_mode="messages"):
    node = metadata.get("langgraph_node")

    # 节点切换时发出 node_exit（旧） + node_enter（新）
    if node != current_node:
        if current_node and current_node in node_start_ms:
            elapsed = int((time.time() - node_start_ms[current_node]) * 1000)
            yield json.dumps({"type": "node_exit", "content": "", "node_name": current_node, "duration_ms": elapsed, "done": False})
        if node:
            yield json.dumps({"type": "node_enter", "content": "", "node_name": node, "done": False})
            node_start_ms[node] = time.time()
        current_node = node

    # analyze 节点的文字输出 → reasoning_chunk（前端过滤 "direct"）
    if node == "analyze" and isinstance(token, AIMessageChunk) and token.content:
        yield json.dumps({"type": "reasoning_chunk", "content": token.content, "done": False})

    # 其余 tool_call / tool_result / text 逻辑不变

# 循环结束后，补发最后一个节点的 node_exit（否则最终节点永远收不到退出事件）
if current_node and current_node in node_start_ms:
    elapsed = int((time.time() - node_start_ms[current_node]) * 1000)
    yield json.dumps({"type": "node_exit", "content": "", "node_name": current_node, "duration_ms": elapsed, "done": False})
```

---

## 前端改动

### `frontend/lib/types.ts`

```typescript
export interface ThinkingEntry {
  nodeSequence: string[]                // 已出现的节点顺序
  reasoningText: string                 // 累积推理文字
  currentNode: string | null            // 当前活跃节点
  doneNodes: Record<string, number>     // node_name → duration_ms
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  textContent: string
  toolCalls: ToolCallEntry[]
  thinking?: ThinkingEntry              // 新增，仅 assistant 消息
  timestamp?: Date
}

// StreamChunk 新增字段
export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "reasoning_chunk" | "node_enter" | "node_exit" | "done"
  content: string
  tool_name?: string
  tool_call_id?: string
  calling_args?: string
  node_name?: string      // 新增
  duration_ms?: number    // 新增
  done: boolean
}
```

### `frontend/hooks/useChat.ts`

在现有事件处理分支中新增：

```typescript
case "node_enter":
  setMessages(prev => prev.map(m => {
    if (m.id !== assistantId) return m
    const thinking = m.thinking ?? { nodeSequence: [], reasoningText: "", currentNode: null, doneNodes: {} }
    return {
      ...m,
      thinking: {
        ...thinking,
        currentNode: chunk.node_name ?? null,
        nodeSequence: thinking.nodeSequence.includes(chunk.node_name!)
          ? thinking.nodeSequence
          : [...thinking.nodeSequence, chunk.node_name!],
      }
    }
  }))
  break

case "reasoning_chunk":
  // 追加到 reasoningText；ThinkingCard 渲染时检查 reasoningText 是否以 "direct" 开头，是则返回 null
  setMessages(prev => prev.map(m => {
    if (m.id !== assistantId) return m
    const thinking = m.thinking ?? { nodeSequence: [], reasoningText: "", currentNode: null, doneNodes: {} }
    return { ...m, thinking: { ...thinking, reasoningText: thinking.reasoningText + chunk.content } }
  }))
  break

case "node_exit":
  setMessages(prev => prev.map(m => {
    if (m.id !== assistantId) return m
    const thinking = m.thinking ?? { nodeSequence: [], reasoningText: "", currentNode: null, doneNodes: {} }
    return {
      ...m,
      thinking: {
        ...thinking,
        currentNode: null,
        doneNodes: { ...thinking.doneNodes, [chunk.node_name!]: chunk.duration_ms ?? 0 }
      }
    }
  }))
  break
```

### `frontend/components/chat/ThinkingCard.tsx`（新文件）

结构与 `ToolCallCard.tsx` 一致：

```
┌──────────────────────────────────────────────────────────┐
│ 🧠 思考过程   [analyze ✓]→[chat ⟳]   2 节点 · 展开 ∨   │
├──────────────────────────────────────────────────────────┤
│ 用户想搜索 Python 后端职位，需要调用 job_search_tool，   │
│ 再按 match_score 排序返回 Top 5 结果。                   │
│                                                          │
│ ✓ analyze   820ms                                        │
│ ⟳ chat      进行中                                       │
└──────────────────────────────────────────────────────────┘
```

- `reasoningText` 为空时整个组件返回 `null`（简单对话不显示）
- 流式时自动展开，完成后自动折叠，逻辑复用 `ToolCallCard` 的 `useEffect`

### `frontend/components/chat/MessageBubble.tsx`

在 `ToolCallCard` 列表上方插入：

```tsx
{message.thinking?.reasoningText && (
  <ThinkingCard entry={message.thinking} isStreaming={isStreaming} />
)}
```

---

## 文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `app/schemas/graph.py` | 修改 | AgentState 新增 `reasoning` 字段 |
| `app/schemas/chat.py` | 修改 | StreamChunk 扩展新事件类型和字段 |
| `app/core/langgraph/graph.py` | 修改 | 新增 `_plain_llm`、`_analyze` 方法，更新图结构和 `get_stream_response()` |
| `frontend/lib/types.ts` | 修改 | ThinkingEntry、ChatMessage、StreamChunk 类型扩展 |
| `frontend/hooks/useChat.ts` | 修改 | 处理 node_enter / reasoning_chunk / node_exit 事件 |
| `frontend/components/chat/ThinkingCard.tsx` | 新建 | 可折叠思考卡片组件 |
| `frontend/components/chat/MessageBubble.tsx` | 修改 | 渲染 ThinkingCard |

---

## 不在本次范围内

- 节点数量扩展（如 `reflect` 节点）——当前两节点已足够演示
- Langfuse trace 与 ThinkingCard 的联动
- 历史消息中 ThinkingCard 的持久化（刷新后消失，属于已知限制）

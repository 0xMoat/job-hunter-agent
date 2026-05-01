# Langfuse Evaluator 分数全为 0 的根因与修复（2026-04-23）

## 你记住这一句就够了

Langfuse 的 LLM-as-a-judge evaluator 是一个"给它 `query` 和 `generation` 两段文本、让它打分"的黑盒。
我们之前的配置里，把**同一段文本同时喂给了 `query` 和 `generation`**，结果 judge LLM 发现"答案"和"问题"一模一样，每次都判成"generation 只是在复述 prompt"→ **Relevance 0 分**。

> 你说的"检测 trace 的 schema property 选的不对"**方向对**，
> 但严格来说是两层错：
> 1. 字段选得不对（`generation` 应该是 output，不能也设成 input）
> 2. evaluator 挂错了层级（挂在 observation 级，看到的是 LLM 的"输入 prompt"而不是"最终回复"）

---

## 1. 背景：Langfuse evaluator 是怎么工作的

LLM-as-a-judge 的"评估器"有三个配置维度，理解这三个就能理解问题：

```
┌──────────────────────────────────────────────────────────────┐
│ ① 模板 (template)                                            │
│    里面有两个占位符：{{query}} 和 {{generation}}              │
│    judge LLM 看着这俩占位符填进去的文本来打分                 │
├──────────────────────────────────────────────────────────────┤
│ ② variableMapping                                            │
│    告诉 Langfuse："{{query}} 从 trace 的哪里取、             │
│    {{generation}} 从 trace 的哪里取"                         │
├──────────────────────────────────────────────────────────────┤
│ ③ targetObject                                               │
│    在哪一层触发评估：                                         │
│    - trace (整条对话) — 推荐                                 │
│    - event/observation (中间每个 LLM 子调用)                 │
└──────────────────────────────────────────────────────────────┘
```

## 2. 根因：两处错误叠加

### 错误 A — `query` 和 `generation` 都映射到了同一个字段

老配置（Relevance / Helpfulness 都是这样）：

```json
"variableMapping": [
  { "selectedColumnId": "input", "templateVariable": "query" },
  { "selectedColumnId": "input", "templateVariable": "generation" }
]
```

**两条都从 `input` 取**。正确的应该是 `query` 取 input、`generation` 取 output。

Gemma 看到的是：
```
Query:      [用户的问题 + 系统指令]
Generation: [一模一样的内容]
```
它的 comment 诚实地写道：
> "The generation is a verbatim repetition of the prompt's system instructions and context, providing no actual plan or answer to the user's query."

→ Relevance **全部打 0**；Helpfulness 偶尔看"系统指令本身挺有用"给 1 分，所以 87% 是 0、13% 非 0。

### 错误 B — `targetObject` 是 `event`（observation 级），不是 `trace`

Event 级评估的触发点是"某次 LLM 调用（GENERATION observation）完成时"，它拿到的 `input` 是**那次 LLM 调用的完整 prompt**（system + 历史 messages），`output` 是那次调用的 raw LLM response。这跟"给用户看的最终回答"差着好几层：

```
┌─ Trace (整条对话) ─────────────────────────────┐
│  input:  {messages: [{role:user, content:"..."}], ...}      │
│  output: {messages: [...一堆 human/tool/ai...], ...}        │
│                                                              │
│  ├─ Observation "chat" (LLM call 1)                          │
│  │    input:  [system msg + history + user msg]  ← 这是"input"│
│  │    output: [ai msg or tool_call]              ← 这是"output"│
│  ├─ Observation "tool_call"                                  │
│  └─ Observation "chat" (LLM call 2)                          │
└──────────────────────────────────────────────────────────────┘
```

即便把 `generation` 改到 `output`，observation 级拿到的也只是**某一轮** LLM 的原始回复，不是"agent 给用户的最终回答"。正确的做法是让 evaluator 挂在 **trace** 级，拿 trace 的整体 input/output。

## 3. 修复方案：迁到 trace 级 + 用 JSONPath 精确取值

### 3.1 新配置长这样

```jsonc
{
  "targetObject": "trace",
  "filter": [
    // 把各种内部环境排除掉
    { "column": "environment", "type": "stringOptions", "operator": "none of",
      "value": ["sdk-experiment", "langfuse-llm-as-a-judge",
                "langfuse-prompt-experiment", "langfuse-evaluation"] },
    // 只评估外层对话 trace（两套历史命名都覆盖）
    { "column": "name", "type": "stringOptions", "operator": "any of",
      "value": [
        "Web Assistant Agent (development)",
        "Web Assistant Agent (staging)",
        "Web Assistant Agent (production)",
        "Job Hunter Agent Agent (development)",
        "Job Hunter Agent Agent (staging)",
        "Job Hunter Agent Agent (production)"
      ] }
  ],
  "variableMapping": [
    { "langfuseObject": "trace", "selectedColumnId": "input",
      "jsonSelector": "$.messages[-1:].content", "templateVariable": "query" },
    { "langfuseObject": "trace", "selectedColumnId": "output",
      "jsonSelector": "$.messages[-1:].content", "templateVariable": "generation" }
  ]
}
```

### 3.2 为什么 jsonSelector 用 `$.messages[-1:].content`

Trace 的 input/output 形如：
```json
{
  "messages": [ {role:"user",content:"..."}, {role:"ai",content:"..."} ],
  "long_term_memory": "...",
  "pending_applications": "..."
}
```

我们想要的是：
- `query` = input 里**最后一条 user 消息**
- `generation` = output 里**最后一条 ai 消息**

Langfuse 用的是 `jsonpath-plus` 且 `eval: false`，所以：
- `[-1]` 单索引 **不支持**
- `[-1:]` 切片 **支持**（单元素数组会被 unwrap 成字符串）
- `?(@.type=='ai')` 这种 filter 表达式 **不支持**（`eval:false` 禁用了）

所以 `$.messages[-1:].content` 是当前版本 Langfuse 下能取"最后一条消息内容"的最干净写法。
唯一的边界：个别 trace 最后一条可能是 `tool_call` 而非 `ai`，这类样本会拿到工具调用 JSON 而非自然语言回答——在正常结束的对话里很少见，先接受这个噪声。

### 3.3 为什么不能直接 `updateEvalJob` 改 `targetObject`

Langfuse 的 `UpdateEvalJobSchema` 只允许改这些字段：
`scoreName, filter, variableMapping, sampling, delay, status, timeScope`

**`targetObject` 不在列表里**，意味着要从 event 级改到 trace 级必须：
1. `evals.createJob` 新建一个 target=trace 的 config
2. `evals.updateEvalJob` 把老 config 设成 INACTIVE（不要删，保留历史打分）

## 4. 当前 Langfuse 项目的 config 状态

| scoreName | id | status | targetObject | 作用 |
|---|---|---|---|---|
| Relevance | `6358153e…8908` | **ACTIVE** | **trace** | 新配置（修复后） |
| Helpfulness | `753df09c…2e1` | **ACTIVE** | **trace** | 新配置（修复后） |
| Relevance | `76a5ed68…8195` | INACTIVE | event | 老配置（保留查历史） |
| Helpfulness | `b071ed36…07cf` | INACTIVE | event | 老配置（保留查历史） |

Evaluator LLM 仍是 `gemma-4-31b-it`（Google AI Studio 免费额度），模板沿用 4/21 迁移时 clone 的 `Relevance (Gemma 4 31B)` / `Helpfulness (Gemma 4 31B)`。

## 5. 实测验证

修复后通过 [https://jobhunter.mintmind.io/chat](https://jobhunter.mintmind.io/chat) 发了两条消息：

| 测试消息 | Relevance | Helpfulness |
|---|---|---|
| "我最看重远程办公和 AI Agent 项目，你怎么看？" | **1** | — |
| "帮我列 3 个常见的 AI Agent 岗位面试考点" | **1** | **1** |

Evaluator comment 都准确识别了 generation 针对 query 的回应。

对比修复前的老数据：
- 老 Relevance：241/241 = 0 分（100% 错）
- 老 Helpfulness：212/244 = 0 分（87% 错）

## 6. 未来维护指南

遇到 eval 全是 0 分 / 全失败时，按下面顺序排查：

1. **先区分"失败"还是"被打了低分"**
   `evals.getLogs` 看 `status` 分布：`COMPLETED` 居多但 score=0 → 是判分低（配置问题）；`ERROR` 居多 → 是执行挂（模型或 API key 问题）。
   路径：Langfuse UI → Evaluators → 某 config → Logs tab，或直接看 trace 上的 score。

2. **点开一条 score 看 evaluator 的 comment**
   gemma 会说为什么给这个分。"generation is a repetition of the prompt" / "query 和 generation 相同" 这类话 = variable mapping 有问题。

3. **检查 variableMapping**
   - 两个变量不能同源
   - `generation` 必须指向 output（不是 input）
   - trace 级用 `langfuseObject: "trace"` 且写 `jsonSelector` 取到最终消息
   - event 级很少是你真正想要的（见 §2 错误 B）

4. **改 targetObject 要新建 config**
   永远不能用 `updateEvalJob` 把 event 改成 trace——照 §3.3 走 create + deactivate 两步。

5. **trace 命名变了？别忘更新 name filter**
   我们历史上出现过 `Web Assistant Agent (...)` → `Job Hunter Agent Agent (...)` 的命名变更。改了 agent 名字的同时要把新名字加进 `filter.name.value`。目前 6 个变体都在列表里，新增环境/命名时记得同步。

## 7. 一句话回到你的原始问题

> **Q: 我理解的是不是检测 trace 的 schema property 选的不对？**
>
> **A:** 方向对，但具体是两个错：(a) 两个变量共用了同一个 property，(b) evaluator 挂在 observation 级、不是 trace 级。前者让"答案=问题"，后者让"答案=LLM 原始 prompt"——两层叠加，分数必然 0。

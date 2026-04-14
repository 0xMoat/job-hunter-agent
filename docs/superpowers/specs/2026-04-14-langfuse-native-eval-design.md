# Langfuse 原生评估体系设计 — Phase 1

## 概述

用 Langfuse 原生能力（Datasets、Experiments、LLM-as-a-Judge）替换自研评估系统，建立可重复的离线回归测试 + 自动化在线评估。

## 背景与动机

### 现有评估体系的不足

- 5 个评估维度全部是通用 chatbot 级别，缺少 Agent 特有维度（工具调用准确率、任务完成率）
- 只能评估已发生的生产对话（在线），没有 Golden Dataset 做回归测试（离线）
- 手动触发 `make eval-quick`，无法自动评估
- 自研 `evaluator.py` 用 OpenAI structured output，不兼容 DeepSeek 等其他模型
- 全部依赖 LLM 打分，没有确定性指标

### 为什么选择 Langfuse 原生方案

| 方案 | 评估 |
|------|------|
| DeepEval | 开源、CI 友好，但与 Langfuse 是两套系统，需要额外维护 |
| Langfuse 原生 | 追踪 + 评估统一平台，Dashboard 可视化，代码量少，demo 友好 |
| RAGAS | 不适用，项目非 RAG 架构 |

选择 Langfuse 原生方案。理由：已深度绑定 Langfuse 做追踪，评估也统一在此维护成本最低；Dashboard 可视化对面试 demo 展示更有价值。

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Langfuse Platform                 │
│                                                     │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   Datasets   │  │ Experiments │  │  LLM-as-a  │ │
│  │              │  │             │  │   -Judge    │ │
│  │ Golden测试集  │  │ 离线回归结果 │  │ 在线自动评分│ │
│  └──────┬───────┘  └──────▲──────┘  └─────▲──────┘ │
│         │                 │               │         │
│         │    SDK 脚本调用  │    自动触发    │         │
└─────────┼─────────────────┼───────────────┼─────────┘
          │                 │               │
  ┌───────▼─────────────────┴───┐   ┌───────┴───────┐
  │  evals/experiment.py (新)    │   │  生产 traces  │
  │  • 上传 Dataset             │   │  (用户对话)   │
  │  • 定义 task (LLM 调用)     │   └───────────────┘
  │  • 定义 evaluators (4维度)  │
  │  • run_experiment()         │
  │  • make eval-golden         │
  └─────────────────────────────┘
```

### 双轨评估体系

| 维度 | 离线（Experiments） | 在线（LLM-as-a-Judge） |
|------|--------------------|-----------------------|
| relevancy | LLM judge | LLM judge (UI 托管) |
| helpfulness | LLM judge | LLM judge (UI 托管) |
| task_completion | LLM judge (需 expected_output) | 不适用 |
| tool_appropriateness | 确定性指标（程序化比较） | 不适用 |

## Golden Dataset

### 结构

```python
{
    "input": "用户消息",
    "expected_output": "理想回答的描述",
    "metadata": {
        "category": "场景类别",
        "expected_tools": ["应该调用的工具名"],
    }
}
```

### 场景覆盖（~30 用例）

| 类别 | 数量 | 示例 | expected_tools |
|------|------|------|----------------|
| A. 纯对话 | 4 | "你好，你能帮我什么？" | `[]` |
| B. 工作搜索 | 4 | "帮我搜索深圳的Python后端岗位" | `["job_search_tool"]` |
| C. 公司调研 | 4 | "帮我调研字节跳动的工作环境" | `["company_research_tool"]` |
| D. 求职信 | 4 | "帮我写一封投递Google SWE的求职信" | `["cover_letter_tool"]` |
| E. 申请跟踪 | 4 | "帮我记录我投了美团后端岗" | `["application_tracker_tool"]` |
| F. 简历优化 | 3 | "帮我针对这个JD优化简历" | `["trigger_resume_studio_skill"]` |
| G. 求职策略 | 4 | "应届生想进大厂该怎么准备？" | `[]` |
| H. 搜索偏好 | 3 | "设置每天自动搜索上海Agent工程师岗位" | `["job_preferences_tool"]` |

## Task 函数

轻量 LLM 调用，不执行工具：

```python
async def agent_task(*, item, **kwargs):
    # 1. 加载 system.md 模板（空 long_term_memory / pending_applications）
    # 2. ChatDeepSeek + bind_tools（绑定工具 schema，不执行）
    # 3. llm.ainvoke([system_msg, human_msg])
    # 4. 返回文本 + tool_calls 列表
    return {
        "text": response.content,
        "tool_calls": [tc["name"] for tc in response.tool_calls]
    }
```

关键点：
- 使用项目已有的 ChatDeepSeek + 工具定义，与生产行为一致
- `bind_tools` 让 LLM 知道可用工具但不真正执行
- 返回结构化结果，方便 evaluator 分别处理文本和工具调用

## Evaluators

### 1. relevancy_evaluator (LLM judge)

评估回复是否切题。只需 input + output.text。

### 2. helpfulness_evaluator (LLM judge)

评估回复是否有效帮助用户。参考 expected_output 做对比。

### 3. task_completion_evaluator (LLM judge)

评估 Agent 是否完成了用户的具体求职任务。参考 expected_output 做对比。

### 4. tool_appropriateness_evaluator (确定性)

程序化比较 output.tool_calls 与 metadata.expected_tools：

```python
def tool_appropriateness_evaluator(*, output, expected_output, metadata, **kwargs):
    expected = set(metadata.get("expected_tools", []))
    actual = set(output.get("tool_calls", []))
    if expected == actual:
        score = 1.0
    elif not expected and not actual:
        score = 1.0
    elif not expected and actual:
        score = 0.0  # 不该调但调了
    elif expected and not actual:
        score = 0.0  # 该调但没调
    else:
        intersection = expected & actual
        union = expected | actual
        score = len(intersection) / len(union)  # Jaccard similarity
    return Evaluation(name="tool_appropriateness", value=score, comment=...)
```

这是唯一的确定性指标，解决了旧系统"全部依赖 LLM 打分"的问题。

## 在线 LLM-as-a-Judge 配置

在 Langfuse Dashboard UI 中配置 2 个托管 evaluator：

### relevancy evaluator
- Model: deepseek-chat (OpenAI-compatible endpoint)
- Template: 基于 `evals/metrics/prompts/relevancy.md`
- Score range: 0-1
- 触发: 所有 trace，自动

### helpfulness evaluator
- Model: deepseek-chat
- Template: 基于 `evals/metrics/prompts/helpfulness.md`
- Score range: 0-1
- 触发: 所有 trace，自动

配好后，每条生产对话自动评分，无需手动触发。

## 文件变更

### 新增

| 文件 | 用途 |
|------|------|
| `evals/experiment.py` | 主入口：上传 Dataset + 跑 Experiment |
| `evals/golden_dataset.py` | 30 个测试用例定义 |
| `evals/evaluators.py` | 4 个 evaluator 函数 |
| `evals/agent_runner.py` | 轻量 task 函数 |

### 更新

| 文件 | 改动 |
|------|------|
| `Makefile` | 替换 eval targets 为 `eval-golden` / `eval-upload` |
| `evals/EVALUATION_GUIDE.md` | 补充 Langfuse 原生方案决策记录 |

### 废弃（不立即删除）

| 文件 | 原因 |
|------|------|
| `evals/evaluator.py` | 在线 Judge 接管 |
| `evals/helpers.py` | 不再需要 |
| `evals/schemas.py` | 不再需要 |
| `evals/main.py` | 被 experiment.py 替代 |

文件顶部加 `# DEPRECATED` 注释，说明迁移目标。

### 保留不变

| 文件 | 原因 |
|------|------|
| `evals/metrics/__init__.py` | 不影响新系统 |
| `evals/metrics/prompts/*.md` | 作为在线 Judge 模板参考 |
| `pyproject.toml` | langfuse 3.9.1 已有所需 API，无需新依赖 |

## Makefile targets

```makefile
# 新增
eval-golden:    # 完整回归测试（上传 Dataset + 跑 Experiment + 评估）
eval-upload:    # 仅上传/更新 Dataset 到 Langfuse

# 移除
eval:           # 旧交互模式
eval-quick:     # 旧快速模式
eval-no-report: # 旧静默模式
```

## 成功标准

1. `make eval-golden` 能一键完成：上传 Dataset → 跑 Experiment → 4 个维度评分 → 结果在 Langfuse Dashboard 可见
2. Langfuse Dashboard 中每条生产 trace 自动带有 relevancy + helpfulness 分数
3. 旧 `evaluator.py` 不再被任何流程调用

# Langfuse Native Eval System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom eval system with Langfuse-native Datasets + Experiments (offline) and LLM-as-a-Judge (online), covering 30 golden test cases across 8 job-hunting scenarios.

**Architecture:** SDK script (`evals/experiment.py`) uploads a golden dataset to Langfuse, runs experiments via `langfuse.run_experiment()`, and evaluates with 4 dimensions (3 LLM judge + 1 deterministic). Online evaluation uses Langfuse UI-configured LLM-as-a-Judge for automatic trace scoring.

**Tech Stack:** Langfuse 3.9.1 SDK (Datasets, Experiments, Evaluation), LangChain ChatDeepSeek, existing tool definitions

---

## File Structure

| File | Responsibility |
|------|----------------|
| `evals/golden_dataset.py` (create) | 30 test cases across 8 categories, each with input/expected_output/metadata |
| `evals/agent_runner.py` (create) | Lightweight task function: load system prompt + ChatDeepSeek + bind_tools → return text + tool_calls |
| `evals/evaluators.py` (create) | 4 evaluator functions: relevancy, helpfulness, task_completion (LLM judge), tool_appropriateness (deterministic) |
| `evals/experiment.py` (create) | CLI entry point: upload dataset + run experiment, `--upload-only` flag |
| `Makefile` (modify lines 31-42) | Replace old eval targets with `eval-golden` and `eval-upload` |
| `evals/evaluator.py` (modify line 1) | Add DEPRECATED header comment |
| `evals/helpers.py` (modify line 1) | Add DEPRECATED header comment |
| `evals/schemas.py` (modify line 1) | Add DEPRECATED header comment |
| `evals/main.py` (modify line 1) | Add DEPRECATED header comment |
| `evals/EVALUATION_GUIDE.md` (modify) | Append Langfuse native decision record |

---

### Task 1: Golden Dataset

**Files:**
- Create: `evals/golden_dataset.py`

- [ ] **Step 1: Create golden_dataset.py with all 30 test cases**

```python
"""Golden dataset for offline evaluation of the Job Hunter Agent.

Each test case defines an input message, expected output description,
and metadata including the category and expected tool calls.
"""

GOLDEN_DATASET = [
    # ── A. 纯对话（4 cases）──────────────────────────────────────
    {
        "input": "你好，你能帮我什么？",
        "expected_output": "介绍自己是求职助理，列出核心能力（职位搜索、公司调研、求职信、申请跟踪、简历优化），并主动询问用户背景信息",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    {
        "input": "今天天气怎么样？",
        "expected_output": "礼貌说明自己是求职助理，无法查询天气，引导用户回到求职话题",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    {
        "input": "谢谢你的帮助！",
        "expected_output": "友好回应感谢，询问是否还有其他求职需求",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    {
        "input": "你是谁？你是什么模型？",
        "expected_output": "介绍自己是求职助理，说明能提供的服务，不需要调用任何工具",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    # ── B. 工作搜索（4 cases）────────────────────────────────────
    {
        "input": "帮我搜索深圳的Python后端开发岗位",
        "expected_output": "调用job_search_tool搜索深圳Python后端岗位，返回结构化的职位列表",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    {
        "input": "我想找上海的AI工程师工作，最好是远程的",
        "expected_output": "调用job_search_tool搜索上海AI工程师远程岗位",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    {
        "input": "有没有北京的Go语言开发岗位？",
        "expected_output": "调用job_search_tool搜索北京Go语言开发岗位",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    {
        "input": "帮我找一些杭州大数据相关的职位",
        "expected_output": "调用job_search_tool搜索杭州大数据相关岗位",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    # ── C. 公司调研（4 cases）────────────────────────────────────
    {
        "input": "帮我调研一下字节跳动的工作环境和技术栈",
        "expected_output": "调用company_research_tool调研字节跳动，返回公司概况、文化、技术栈、近期动态",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    {
        "input": "我想了解一下蚂蚁集团这家公司怎么样",
        "expected_output": "调用company_research_tool调研蚂蚁集团",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    {
        "input": "Google的面试流程是怎样的？帮我调研下",
        "expected_output": "调用company_research_tool调研Google，包含面试流程相关信息",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    {
        "input": "帮我看看腾讯云部门的情况",
        "expected_output": "调用company_research_tool调研腾讯云部门",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    # ── D. 求职信撰写（4 cases）──────────────────────────────────
    {
        "input": "帮我写一封投递Google SWE岗位的求职信",
        "expected_output": "调用cover_letter_tool生成针对Google SWE的个性化求职信",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    {
        "input": "我要投递字节跳动的后端开发岗，帮我写封求职信",
        "expected_output": "调用cover_letter_tool生成针对字节跳动后端的求职信",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    {
        "input": "帮我写一封英文的cold email给Stripe的招聘经理",
        "expected_output": "调用cover_letter_tool生成英文冷邮件",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    {
        "input": "写一封投递美团算法工程师的求职信，突出我的机器学习经验",
        "expected_output": "调用cover_letter_tool生成突出ML经验的求职信",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    # ── E. 申请跟踪（4 cases）────────────────────────────────────
    {
        "input": "帮我记录一下，我已经投了美团的后端开发岗位",
        "expected_output": "调用application_tracker_tool(action=add)记录美团后端申请",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    {
        "input": "我现在有哪些在投的岗位？",
        "expected_output": "调用application_tracker_tool(action=list)列出所有申请记录",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    {
        "input": "把我投字节跳动的那个申请状态更新为面试中",
        "expected_output": "调用application_tracker_tool(action=update)更新字节跳动申请状态",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    {
        "input": "删除我之前投的那个不合适的岗位",
        "expected_output": "调用application_tracker_tool(action=delete)删除指定申请记录",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    # ── F. 简历优化（3 cases）────────────────────────────────────
    {
        "input": "帮我针对这个Python后端岗位的JD优化我的简历",
        "expected_output": "调用trigger_resume_studio_skill启动简历优化流程",
        "metadata": {"category": "resume", "expected_tools": ["trigger_resume_studio_skill"]},
    },
    {
        "input": "我想让简历更匹配AI工程师的要求",
        "expected_output": "调用trigger_resume_studio_skill针对AI工程师优化简历",
        "metadata": {"category": "resume", "expected_tools": ["trigger_resume_studio_skill"]},
    },
    {
        "input": "帮我重新调整简历来匹配这个全栈开发的职位描述",
        "expected_output": "调用trigger_resume_studio_skill针对全栈开发岗位调整简历",
        "metadata": {"category": "resume", "expected_tools": ["trigger_resume_studio_skill"]},
    },
    # ── G. 求职策略（4 cases）────────────────────────────────────
    {
        "input": "我是应届毕业生，想进大厂，该怎么准备？",
        "expected_output": "提供系统性的大厂求职准备建议，包括技能提升、简历准备、面试策略等，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    {
        "input": "跳槽面试一般要准备多久？有什么建议吗？",
        "expected_output": "提供跳槽准备的时间规划和具体建议，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    {
        "input": "如何在面试中谈薪资？有什么技巧？",
        "expected_output": "提供薪资谈判的策略和技巧，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    {
        "input": "远程工作和驻场工作怎么选？各有什么优缺点？",
        "expected_output": "对比远程与驻场工作的优缺点，结合求职角度给出建议，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    # ── H. 每日搜索偏好（3 cases）───────────────────────────────
    {
        "input": "帮我设置每天自动搜索上海的Agent工程师岗位",
        "expected_output": "调用job_preferences_tool保存偏好：keywords=Agent工程师, location=上海",
        "metadata": {"category": "preferences", "expected_tools": ["job_preferences_tool"]},
    },
    {
        "input": "我想每天收到深圳Python开发的职位推荐",
        "expected_output": "调用job_preferences_tool保存偏好：keywords=Python开发, location=深圳",
        "metadata": {"category": "preferences", "expected_tools": ["job_preferences_tool"]},
    },
    {
        "input": "把我的每日搜索改成远程的全栈工程师",
        "expected_output": "调用job_preferences_tool更新偏好：keywords=全栈工程师, job_type=remote",
        "metadata": {"category": "preferences", "expected_tools": ["job_preferences_tool"]},
    },
]
```

- [ ] **Step 2: Verify the dataset is importable**

Run: `source scripts/set_env.sh development && .venv/bin/python -c "from evals.golden_dataset import GOLDEN_DATASET; print(f'{len(GOLDEN_DATASET)} test cases loaded')"`

Expected: `30 test cases loaded`

- [ ] **Step 3: Commit**

```bash
git add evals/golden_dataset.py
git commit -m "feat(evals): add golden dataset with 30 test cases across 8 categories"
```

---

### Task 2: Agent Runner (Task Function)

**Files:**
- Create: `evals/agent_runner.py`

- [ ] **Step 1: Create the lightweight agent task function**

```python
"""Lightweight agent runner for offline evaluation.

Calls the LLM with the production system prompt and tool schemas
(without executing tools) to generate responses for golden dataset items.
"""

import asyncio
import os
import sys
from datetime import datetime

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_deepseek import ChatDeepSeek

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings
from app.core.langgraph.tools import tools


def _load_system_prompt() -> str:
    """Load the system prompt template with empty dynamic fields."""
    prompts_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "app", "core", "prompts",
    )
    with open(os.path.join(prompts_dir, "system.md"), "r") as f:
        return f.read().format(
            agent_name=settings.PROJECT_NAME + " Agent",
            long_term_memory="No prior information about this user.",
            pending_applications="No pending applications.",
            current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )


def _create_llm():
    """Create a ChatDeepSeek instance with tool schemas bound."""
    llm = ChatDeepSeek(
        model=settings.DEFAULT_LLM_MODEL,
        api_key=settings.DEEPSEEK_API_KEY,
        temperature=settings.DEFAULT_LLM_TEMPERATURE,
    )
    return llm.bind_tools(tools)


_system_prompt = None
_llm = None


def _get_system_prompt():
    global _system_prompt
    if _system_prompt is None:
        _system_prompt = _load_system_prompt()
    return _system_prompt


def _get_llm():
    global _llm
    if _llm is None:
        _llm = _create_llm()
    return _llm


async def agent_task(*, item, **kwargs):
    """Task function for Langfuse run_experiment.

    Takes a dataset item, calls the LLM with system prompt + tools,
    returns structured output with text and tool_calls.

    Args:
        item: Dict with "input" (user message string).

    Returns:
        Dict with "text" (response content) and "tool_calls" (list of tool names).
    """
    user_input = item["input"]
    messages = [
        SystemMessage(content=_get_system_prompt()),
        HumanMessage(content=user_input),
    ]
    response = await _get_llm().ainvoke(messages)
    tool_calls = [tc["name"] for tc in response.tool_calls] if response.tool_calls else []
    text = response.content or ""
    return {"text": text, "tool_calls": tool_calls}
```

- [ ] **Step 2: Verify agent_runner is importable and callable**

Run: `source scripts/set_env.sh development && .venv/bin/python -c "from evals.agent_runner import agent_task; print('agent_task loaded:', agent_task.__name__)"`

Expected: `agent_task loaded: agent_task`

- [ ] **Step 3: Smoke test with one input**

Run: `source scripts/set_env.sh development && .venv/bin/python -c "
import asyncio
from evals.agent_runner import agent_task
result = asyncio.run(agent_task(item={'input': '你好'}))
print('text length:', len(result['text']))
print('tool_calls:', result['tool_calls'])
"`

Expected: `text length: <some positive number>` and `tool_calls: []` (greeting should not trigger tools)

- [ ] **Step 4: Commit**

```bash
git add evals/agent_runner.py
git commit -m "feat(evals): add lightweight agent runner for offline evaluation"
```

---

### Task 3: Evaluators

**Files:**
- Create: `evals/evaluators.py`

- [ ] **Step 1: Create evaluators.py with all 4 evaluator functions**

```python
"""Evaluator functions for Langfuse Experiments.

Three LLM-based judges (relevancy, helpfulness, task_completion) and
one deterministic evaluator (tool_appropriateness).
"""

import json
import os
import sys

import openai
from langfuse import Evaluation

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings
from app.core.logging import logger

_eval_client = None


def _get_eval_client():
    """Lazy-init the evaluation LLM client."""
    global _eval_client
    if _eval_client is None:
        _eval_client = openai.AsyncOpenAI(
            api_key=settings.EVALUATION_API_KEY,
            base_url=settings.EVALUATION_BASE_URL,
        )
    return _eval_client


async def _llm_judge(metric_name: str, prompt: str, input_text: str, output_text: str) -> Evaluation:
    """Shared LLM judge logic for all LLM-based evaluators.

    Calls the evaluation LLM with a metric prompt and returns an Evaluation.
    """
    json_instruction = (
        '\n\nRespond with a JSON object containing exactly two fields:\n'
        '{"score": <float between 0 and 1>, "reasoning": "<one sentence>"}'
    )
    try:
        response = await _get_eval_client().chat.completions.create(
            model=settings.EVALUATION_LLM,
            messages=[
                {"role": "system", "content": prompt + json_instruction},
                {"role": "user", "content": f"Input: {input_text}\nGeneration: {output_text}"},
            ],
            response_format={"type": "json_object"},
        )
        parsed = json.loads(response.choices[0].message.content)
        score = float(parsed["score"])
        reasoning = str(parsed["reasoning"])
        return Evaluation(name=metric_name, value=score, comment=reasoning)
    except Exception as e:
        logger.error("llm_judge_failed", metric=metric_name, error=str(e))
        return Evaluation(name=metric_name, value=0.0, comment=f"Evaluation failed: {e}")


def _load_metric_prompt(filename: str) -> str:
    """Load a metric prompt from evals/metrics/prompts/."""
    prompts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metrics", "prompts")
    with open(os.path.join(prompts_dir, filename), "r") as f:
        return f.read()


_RELEVANCY_PROMPT = None
_HELPFULNESS_PROMPT = None
_TASK_COMPLETION_PROMPT = """Evaluate whether the AI assistant successfully completed the user's job-hunting task on a continuous scale from 0 to 1.

## Scoring Criteria

Score 1.0 if the assistant:
- Correctly identified what the user wanted (job search, cover letter, company research, etc.)
- Took the appropriate action (called the right tool or provided relevant advice)
- Delivered a complete response that fulfills the user's request

Score 0.5 if the assistant:
- Identified the task correctly but only partially addressed it
- Called the right tool but the response was incomplete

Score 0.0 if the assistant:
- Misunderstood the user's request
- Failed to take any relevant action
- Provided generic or irrelevant information

## Context
The expected outcome for this task is: {expected_output}

## Instructions
Compare the actual generation against the expected outcome. Think step by step."""


async def relevancy_evaluator(*, input, output, **kwargs) -> Evaluation:
    """Evaluate whether the response is on-topic and addresses the query."""
    global _RELEVANCY_PROMPT
    if _RELEVANCY_PROMPT is None:
        _RELEVANCY_PROMPT = _load_metric_prompt("relevancy.md")
    output_text = output["text"] if isinstance(output, dict) else str(output)
    input_text = input["input"] if isinstance(input, dict) else str(input)
    return await _llm_judge("relevancy", _RELEVANCY_PROMPT, input_text, output_text)


async def helpfulness_evaluator(*, input, output, expected_output, **kwargs) -> Evaluation:
    """Evaluate whether the response effectively helps the user."""
    global _HELPFULNESS_PROMPT
    if _HELPFULNESS_PROMPT is None:
        _HELPFULNESS_PROMPT = _load_metric_prompt("helpfulness.md")
    output_text = output["text"] if isinstance(output, dict) else str(output)
    input_text = input["input"] if isinstance(input, dict) else str(input)
    expected = expected_output if isinstance(expected_output, str) else str(expected_output)
    prompt = _HELPFULNESS_PROMPT + f"\n\nExpected outcome: {expected}"
    return await _llm_judge("helpfulness", prompt, input_text, output_text)


async def task_completion_evaluator(*, input, output, expected_output, **kwargs) -> Evaluation:
    """Evaluate whether the agent completed the user's specific job-hunting task."""
    output_text = output["text"] if isinstance(output, dict) else str(output)
    input_text = input["input"] if isinstance(input, dict) else str(input)
    expected = expected_output if isinstance(expected_output, str) else str(expected_output)
    prompt = _TASK_COMPLETION_PROMPT.format(expected_output=expected)
    return await _llm_judge("task_completion", prompt, input_text, output_text)


def tool_appropriateness_evaluator(*, output, metadata, **kwargs) -> Evaluation:
    """Deterministic evaluator: compare actual tool calls against expected.

    Uses Jaccard similarity for partial matches.
    """
    expected = set(metadata.get("expected_tools", []))
    actual_calls = output.get("tool_calls", []) if isinstance(output, dict) else []
    actual = set(actual_calls)

    if expected == actual:
        score = 1.0
        comment = f"Perfect match: {sorted(expected) if expected else 'no tools (correct)'}"
    elif not expected and actual:
        score = 0.0
        comment = f"Should not call tools but called: {sorted(actual)}"
    elif expected and not actual:
        score = 0.0
        comment = f"Should call {sorted(expected)} but called nothing"
    else:
        intersection = expected & actual
        union = expected | actual
        score = round(len(intersection) / len(union), 2)
        comment = f"Expected: {sorted(expected)}, Actual: {sorted(actual)}, Jaccard: {score}"

    return Evaluation(name="tool_appropriateness", value=score, comment=comment)
```

- [ ] **Step 2: Verify evaluators are importable**

Run: `source scripts/set_env.sh development && .venv/bin/python -c "
from evals.evaluators import relevancy_evaluator, helpfulness_evaluator, task_completion_evaluator, tool_appropriateness_evaluator
print('All 4 evaluators loaded')
"`

Expected: `All 4 evaluators loaded`

- [ ] **Step 3: Test the deterministic evaluator**

Run: `source scripts/set_env.sh development && .venv/bin/python -c "
from evals.evaluators import tool_appropriateness_evaluator
# Test: expected no tools, called no tools
r1 = tool_appropriateness_evaluator(output={'text': 'hi', 'tool_calls': []}, metadata={'expected_tools': []})
print(f'no tools: score={r1.value}')
# Test: expected job_search_tool, called job_search_tool
r2 = tool_appropriateness_evaluator(output={'text': '', 'tool_calls': ['job_search_tool']}, metadata={'expected_tools': ['job_search_tool']})
print(f'match: score={r2.value}')
# Test: expected job_search_tool, called nothing
r3 = tool_appropriateness_evaluator(output={'text': '', 'tool_calls': []}, metadata={'expected_tools': ['job_search_tool']})
print(f'miss: score={r3.value}')
"`

Expected:
```
no tools: score=1.0
match: score=1.0
miss: score=0.0
```

- [ ] **Step 4: Commit**

```bash
git add evals/evaluators.py
git commit -m "feat(evals): add 4 evaluators (3 LLM judge + 1 deterministic)"
```

---

### Task 4: Experiment Runner

**Files:**
- Create: `evals/experiment.py`

- [ ] **Step 1: Create experiment.py CLI entry point**

```python
"""Langfuse experiment runner for offline evaluation.

Usage:
    python -m evals.experiment              # Upload dataset + run experiment
    python -m evals.experiment --upload-only # Only upload/update dataset
"""

import argparse
import asyncio
import os
import sys
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings
from app.core.logging import logger

DATASET_NAME = "job-hunter-golden"
DATASET_DESCRIPTION = "Golden dataset for Job Hunter Agent regression testing. 30 test cases across 8 categories: chitchat, job_search, company_research, cover_letter, application_tracking, resume, strategy, preferences."


def get_langfuse_client():
    """Create a Langfuse client with project credentials."""
    from langfuse import Langfuse

    return Langfuse(
        public_key=settings.LANGFUSE_PUBLIC_KEY,
        secret_key=settings.LANGFUSE_SECRET_KEY,
        host=settings.LANGFUSE_HOST,
    )


def upload_dataset(langfuse):
    """Upload or update the golden dataset in Langfuse.

    Creates the dataset if it doesn't exist, then upserts all items.
    Uses the input text as a stable identifier so re-runs update rather than duplicate.
    """
    from evals.golden_dataset import GOLDEN_DATASET

    langfuse.create_dataset(
        name=DATASET_NAME,
        description=DATASET_DESCRIPTION,
    )
    logger.info("dataset_created_or_exists", name=DATASET_NAME)

    for i, item in enumerate(GOLDEN_DATASET):
        langfuse.create_dataset_item(
            dataset_name=DATASET_NAME,
            input={"input": item["input"]},
            expected_output=item["expected_output"],
            metadata=item["metadata"],
            id=f"golden-{i:03d}",
        )
    logger.info("dataset_items_uploaded", count=len(GOLDEN_DATASET))
    langfuse.flush()
    print(f"Uploaded {len(GOLDEN_DATASET)} items to dataset '{DATASET_NAME}'")


def run_experiment_sync(langfuse):
    """Run the experiment: agent_task on each dataset item, scored by 4 evaluators."""
    from evals.agent_runner import agent_task
    from evals.evaluators import (
        helpfulness_evaluator,
        relevancy_evaluator,
        task_completion_evaluator,
        tool_appropriateness_evaluator,
    )

    dataset = langfuse.get_dataset(DATASET_NAME)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    experiment_name = f"golden-{settings.DEFAULT_LLM_MODEL}-{timestamp}"

    print(f"Running experiment '{experiment_name}' on {len(dataset.items)} items...")
    print(f"Model: {settings.DEFAULT_LLM_MODEL}")
    print(f"Evaluators: relevancy, helpfulness, task_completion, tool_appropriateness")

    result = langfuse.run_experiment(
        name=experiment_name,
        data=dataset.items,
        task=agent_task,
        evaluators=[
            relevancy_evaluator,
            helpfulness_evaluator,
            task_completion_evaluator,
            tool_appropriateness_evaluator,
        ],
        max_concurrency=3,
        metadata={
            "model": settings.DEFAULT_LLM_MODEL,
            "eval_model": settings.EVALUATION_LLM,
        },
    )

    print("\n" + result.format())

    logger.info(
        "experiment_completed",
        name=experiment_name,
        model=settings.DEFAULT_LLM_MODEL,
    )


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Run Langfuse evaluation experiments")
    parser.add_argument("--upload-only", action="store_true", help="Only upload dataset, don't run experiment")
    args = parser.parse_args()

    langfuse = get_langfuse_client()

    upload_dataset(langfuse)

    if not args.upload_only:
        run_experiment_sync(langfuse)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test upload-only mode**

Run: `source scripts/set_env.sh development && .venv/bin/python -m evals.experiment --upload-only`

Expected: `Uploaded 30 items to dataset 'job-hunter-golden'` (and dataset visible in Langfuse Dashboard)

- [ ] **Step 3: Test full experiment run**

Run: `source scripts/set_env.sh development && .venv/bin/python -m evals.experiment`

Expected: Experiment runs (~30 LLM calls + evaluations), prints formatted results table, visible in Langfuse Experiments tab.

- [ ] **Step 4: Commit**

```bash
git add evals/experiment.py
git commit -m "feat(evals): add Langfuse experiment runner with CLI"
```

---

### Task 5: Makefile and Deprecation

**Files:**
- Modify: `Makefile` (lines 31-42)
- Modify: `evals/evaluator.py` (line 1)
- Modify: `evals/helpers.py` (line 1)
- Modify: `evals/schemas.py` (line 1)
- Modify: `evals/main.py` (line 1)

- [ ] **Step 1: Replace eval targets in Makefile**

Replace lines 31-42 in `Makefile` (the three old eval targets) with:

```makefile
# Evaluation commands (Langfuse Experiments)
eval-golden:
	@echo "Running golden dataset experiment"
	@bash -c "source scripts/set_env.sh $${ENV:-development} && .venv/bin/python -m evals.experiment"

eval-upload:
	@echo "Uploading golden dataset to Langfuse"
	@bash -c "source scripts/set_env.sh $${ENV:-development} && .venv/bin/python -m evals.experiment --upload-only"
```

- [ ] **Step 2: Add deprecation headers to old files**

Add this line at the top of `evals/evaluator.py` (before the existing docstring):

```python
# DEPRECATED: This module is replaced by Langfuse LLM-as-a-Judge (online) and evals/experiment.py (offline).
# Kept for reference. Will be removed in a future cleanup.
```

Add this line at the top of `evals/helpers.py`:

```python
# DEPRECATED: Replaced by Langfuse Experiments. See evals/experiment.py.
```

Add this line at the top of `evals/schemas.py`:

```python
# DEPRECATED: Replaced by langfuse.Evaluation. See evals/evaluators.py.
```

Add this line at the top of `evals/main.py`:

```python
# DEPRECATED: Replaced by evals/experiment.py. Use `make eval-golden` instead.
```

- [ ] **Step 3: Update Makefile help text**

In the `help` target at the bottom of the Makefile, replace the eval help lines with:

```makefile
	@echo "  eval-golden: Run golden dataset experiment (offline regression test)"
	@echo "  eval-upload: Upload golden dataset to Langfuse (no experiment)"
```

- [ ] **Step 4: Verify make targets work**

Run: `make eval-upload`

Expected: Uploads dataset successfully

- [ ] **Step 5: Commit**

```bash
git add Makefile evals/evaluator.py evals/helpers.py evals/schemas.py evals/main.py
git commit -m "chore(evals): replace eval targets, deprecate old eval system"
```

---

### Task 6: Configure Online LLM-as-a-Judge in Langfuse UI

**Files:**
- No code files. This is a UI configuration task.

- [ ] **Step 1: Configure relevancy evaluator in Langfuse Dashboard**

Navigate to Langfuse Dashboard → Evaluation → LLM-as-a-Judge → Create new evaluator:

- Name: `relevancy`
- Model: Configure DeepSeek via OpenAI-compatible endpoint (`https://api.deepseek.com/v1`, model `deepseek-chat`)
- Template: Copy content from `evals/metrics/prompts/relevancy.md`, append JSON instruction:
  ```
  Respond with a JSON object: {"score": <0-1>, "reasoning": "<one sentence>"}
  ```
- Score range: 0 to 1
- Variable mapping: `{{input}}` → trace input, `{{output}}` → trace output
- Trigger: All traces, automatic

- [ ] **Step 2: Configure helpfulness evaluator in Langfuse Dashboard**

Same process as step 1 but:
- Name: `helpfulness`
- Template: Copy from `evals/metrics/prompts/helpfulness.md` + JSON instruction

- [ ] **Step 3: Verify by creating a test trace**

Go to the app frontend (http://localhost:3000), send a message like "你好". Wait 1-2 minutes, then check the trace in Langfuse Dashboard — it should have auto-generated `relevancy` and `helpfulness` scores.

- [ ] **Step 4: Document the UI configuration in EVALUATION_GUIDE.md**

Append a section to `evals/EVALUATION_GUIDE.md` documenting what was configured and how to reconfigure if needed.

---

### Task 7: Update EVALUATION_GUIDE.md

**Files:**
- Modify: `evals/EVALUATION_GUIDE.md`

- [ ] **Step 1: Append Langfuse native decision record and online Judge documentation**

Append the following to the end of `evals/EVALUATION_GUIDE.md`:

```markdown
---

## Phase 1 实施记录（2026-04-14）

### 决策：采用 Langfuse 原生方案

经调研 Langfuse Dashboard 内置的 Datasets、Experiments、LLM-as-a-Judge 功能后，
决定不引入 DeepEval，改用 Langfuse 原生方案。理由：

1. 已深度绑定 Langfuse 做追踪，评估统一在此维护成本最低
2. Dashboard 可视化对面试 demo 展示更有价值
3. 代码量显著减少（4 个新文件 vs DeepEval 方案的 6+ 个文件）
4. Langfuse Experiments 支持 SDK 调用，可集成 CI

### 新架构

**离线评估（回归测试）：**
- Golden Dataset: 30 个测试用例，8 个场景类别
- 运行方式: `make eval-golden`
- 评估维度: relevancy, helpfulness, task_completion, tool_appropriateness
- 结果: Langfuse Dashboard → Experiments 页面

**在线评估（生产监控）：**
- Langfuse LLM-as-a-Judge 托管 evaluator
- 评估维度: relevancy, helpfulness
- 触发: 每条新 trace 自动评分
- 结果: Langfuse Dashboard → Scores / 每条 trace 详情

### 在线 LLM-as-a-Judge 配置说明

如需重新配置（如更换 judge 模型），在 Langfuse Dashboard → Evaluation → LLM-as-a-Judge 中：

1. **relevancy evaluator**
   - Model: DeepSeek (OpenAI-compatible, base URL: `https://api.deepseek.com/v1`)
   - Template: `evals/metrics/prompts/relevancy.md` + JSON output instruction
   - Score: 0-1 NUMERIC

2. **helpfulness evaluator**
   - Model: DeepSeek (同上)
   - Template: `evals/metrics/prompts/helpfulness.md` + JSON output instruction
   - Score: 0-1 NUMERIC

### 废弃文件

以下文件已标记 DEPRECATED，功能由新系统接管：
- `evals/evaluator.py` → Langfuse LLM-as-a-Judge (在线) + `evals/evaluators.py` (离线)
- `evals/helpers.py` → 不再需要（Langfuse Dashboard 替代本地 JSON 报告）
- `evals/schemas.py` → `langfuse.Evaluation` 替代
- `evals/main.py` → `evals/experiment.py` 替代
```

- [ ] **Step 2: Commit**

```bash
git add evals/EVALUATION_GUIDE.md
git commit -m "docs(evals): add Phase 1 Langfuse-native decision record"
```

---

### Task 8: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full golden experiment**

Run: `make eval-golden`

Expected: All 30 test cases processed, 4 evaluators run on each, results printed and visible in Langfuse Dashboard → Experiments.

- [ ] **Step 2: Verify in Langfuse Dashboard**

Open Langfuse Dashboard:
1. **Datasets** tab → `job-hunter-golden` dataset visible with 30 items
2. **Experiments** tab → experiment run visible with scores per item
3. **Scores** tab → relevancy, helpfulness, task_completion, tool_appropriateness scores visible

- [ ] **Step 3: Verify online LLM-as-a-Judge**

Send a message in the app frontend. Wait 1-2 minutes. Check the new trace in Langfuse — should have auto-scored `relevancy` and `helpfulness`.

- [ ] **Step 4: Verify old eval targets are replaced**

Run: `make eval` — should print an error (target no longer exists)
Run: `make eval-golden` — should work
Run: `make eval-upload` — should work

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(evals): address issues found during e2e verification"
```

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
    """Shared LLM judge logic for all LLM-based evaluators."""
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


_PLAN_QUALITY_PROMPT: str | None = None
_REPLAN_DECISION_PROMPT: str | None = None


async def plan_quality_evaluator(*, input, output, metadata, **kwargs) -> Evaluation | None:
    """Score the Planner's initial plan. Returns None for non-P&E items."""
    if metadata.get("category") != "plan_execute":
        return None
    global _PLAN_QUALITY_PROMPT
    if _PLAN_QUALITY_PROMPT is None:
        _PLAN_QUALITY_PROMPT = _load_metric_prompt("plan_quality.md")
    plan = output.get("plan", []) if isinstance(output, dict) else []
    plan_text = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(plan)) or "（空 plan）"
    goal = input["input"] if isinstance(input, dict) else str(input)
    return await _llm_judge("plan_quality", _PLAN_QUALITY_PROMPT, f"Goal: {goal}", plan_text)


async def replan_decision_evaluator(*, input, output, metadata, **kwargs) -> Evaluation | None:
    """Score Replanner decision quality based on past_steps + final_response."""
    if metadata.get("category") != "plan_execute":
        return None
    global _REPLAN_DECISION_PROMPT
    if _REPLAN_DECISION_PROMPT is None:
        _REPLAN_DECISION_PROMPT = _load_metric_prompt("replan_decision.md")
    past = output.get("past_steps", []) if isinstance(output, dict) else []
    past_text = "\n".join(
        f"{i + 1}. {step}\n   → {(result or '')[:200]}" for i, (step, result) in enumerate(past)
    ) or "（尚无已执行步骤）"
    replan_count = output.get("replan_count", 0) if isinstance(output, dict) else 0
    final = output.get("final_response", "") if isinstance(output, dict) else ""
    goal = input["input"] if isinstance(input, dict) else str(input)
    summary = (
        f"Goal: {goal}\n"
        f"Replanner-rewrite count: {replan_count}\n"
        f"Final response length: {len(final)} chars\n"
        f"Final response (truncated 400): {final[:400]}"
    )
    return await _llm_judge("replan_decision", _REPLAN_DECISION_PROMPT, summary, past_text)


def tool_appropriateness_evaluator(*, output, metadata, **kwargs) -> Evaluation | None:
    """Deterministic evaluator: compare actual tool calls against expected.

    Returns None for P&E items where tool calls happen inside the sub-graph
    and aren't surfaced at the runner output level.
    """
    if metadata.get("category") == "plan_execute":
        return None
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

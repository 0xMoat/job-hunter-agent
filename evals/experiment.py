"""Langfuse experiment runner for offline evaluation.

Usage:
    python -m evals.experiment              # Upload dataset + run experiment
    python -m evals.experiment --upload-only # Only upload/update dataset
"""

import argparse
import os
import sys
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings
from app.core.logging import logger

DATASET_NAME = "job-hunter-golden"
DATASET_DESCRIPTION = (
    "Golden dataset for Job Hunter Agent regression testing. "
    "50 test cases across 14 categories: chitchat, job_search, company_research, "
    "resume_tailor, application_tracking, resume, strategy, preferences, "
    "plan_execute, jd_analysis, interview_prep, resume_pdf, general_search, pe_routing."
)


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
    Uses a stable id per item so re-runs update rather than duplicate.
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
    """Run the experiment: agent_task on each dataset item, scored by all evaluators."""
    from evals.agent_runner import agent_task
    from evals.evaluators import (
        hallucination_evaluator,
        helpfulness_evaluator,
        plan_quality_evaluator,
        relevancy_evaluator,
        replan_decision_evaluator,
        task_completion_evaluator,
        tool_appropriateness_evaluator,
    )

    dataset = langfuse.get_dataset(DATASET_NAME)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    experiment_name = f"golden-{settings.DEFAULT_LLM_MODEL}-{timestamp}"

    print(f"Running experiment '{experiment_name}' on {len(dataset.items)} items...")
    print(f"Model: {settings.DEFAULT_LLM_MODEL}")
    print(
        "Evaluators: relevancy, helpfulness, task_completion, hallucination, "
        "tool_appropriateness, plan_quality, replan_decision"
    )

    result = langfuse.run_experiment(
        name=experiment_name,
        data=dataset.items,
        task=agent_task,
        evaluators=[
            relevancy_evaluator,
            helpfulness_evaluator,
            task_completion_evaluator,
            hallucination_evaluator,
            tool_appropriateness_evaluator,
            plan_quality_evaluator,
            replan_decision_evaluator,
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

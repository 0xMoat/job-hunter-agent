"""End-to-end verification for the Plan-and-Execute subgraph.

Usage:
    uv run python scripts/verify_plan_execute.py <user_id>

Runs the agent against a real user's pending applications, prints every SSE
chunk, and exits non-zero on any error event.
"""

import asyncio
import json
import sys
import uuid

from app.core.langgraph.plan_execute import PlanExecuteAgent


async def main(user_id: str) -> int:
    """Run plan-and-execute agent for the given user and report results."""
    agent = PlanExecuteAgent()
    session_id = str(uuid.uuid4())
    goal = (
        "处理用户的今日推荐职位：按匹配度筛选 Top 3，逐个做公司简短调研、"
        "为 Top 1 撰写求职信，并把处理结果存入看板。最后给出汇总报告。"
    )
    error_seen = False
    step_count = 0
    final = None

    print(f"[verify] session_id={session_id} user_id={user_id}")
    async for raw in agent.astream(goal=goal, session_id=session_id, user_id=user_id):
        event = json.loads(raw)
        etype = event.get("type")
        if etype == "plan_created":
            print(f"\n[plan_created] {len(event['steps'])} 步:")
            for i, s in enumerate(event["steps"], 1):
                print(f"  {i}. {s}")
        elif etype == "step_started":
            step_count += 1
            print(f"\n[step_started #{event['index']}] {event['text']}")
        elif etype == "step_completed":
            result = (event.get("result") or "")[:200]
            failed = result.startswith("FAILED")
            marker = "❌" if failed else "✅"
            print(f"[step_completed #{event['index']}] {marker} {result}")
            if failed:
                error_seen = True
        elif etype == "plan_updated":
            print(f"\n[plan_updated] remaining={len(event['remaining'])} 步")
            for i, s in enumerate(event["remaining"], 1):
                print(f"  {i}. {s}")
        elif etype == "final_response":
            final = event["content"]
        elif etype == "error":
            print(f"\n[error] {event.get('message')}")
            error_seen = True
        else:
            print(f"[unknown] {event}")

    print("\n" + "=" * 60)
    print(f"steps executed: {step_count}")
    print(f"final_response:\n{final}")
    return 1 if error_seen else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: uv run python scripts/verify_plan_execute.py <user_id>")
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))

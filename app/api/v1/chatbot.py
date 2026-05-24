"""Chatbot API endpoints for handling chat interactions.

This module provides endpoints for chat interactions, including regular chat,
streaming chat, message history management, and chat history clearing.
"""

import json as _json
import time
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.v1.auth import get_current_session
from app.core.config import settings
from app.core.langgraph.graph import LangGraphAgent
from app.core.langgraph.plan_execute import ACTIVE_PE_THREADS, PlanExecuteAgent
from app.core.limiter import limiter
from app.core.logging import logger
from app.core.metrics import (
    active_streams,
    llm_e2e_latency_seconds,
    llm_stream_duration_seconds,
    llm_tpot_seconds,
    llm_ttft_seconds,
)
from app.models.session import Session
from app.schemas.chat import (
    ChatRequest,
    HistoryResponse,
)
from app.services.database import DatabaseService

router = APIRouter()
agent = LangGraphAgent()
plan_execute_agent = PlanExecuteAgent()
db_service = DatabaseService()


class PlanExecuteRequest(BaseModel):
    """Request body for the plan-execute endpoint.

    Two modes:
    - start: thread_id/resume_action are None — runs from the top.
    - resume: provide thread_id + resume_action (optionally feedback) to
      continue an interrupted HITL run.
    """

    goal: str = (
        "处理看板上所有状态为 pending 的职位：逐一研究公司、撰写求职信，"
        "并将处理结果更新回看板。"
    )
    thread_id: str | None = None
    resume_action: Literal["approve", "revise", "cancel"] | None = None
    feedback: str | None = None


@router.post("/chat/stream")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["chat_stream"][0])
async def chat_stream(
    request: Request,
    chat_request: ChatRequest,
    session: Session = Depends(get_current_session),
):
    """Process a chat request using LangGraph with streaming response.

    Args:
        request: The FastAPI request object for rate limiting.
        chat_request: The chat request containing messages.
        session: The current session from the auth token.

    Returns:
        StreamingResponse: A streaming response of the chat completion.

    Raises:
        HTTPException: If there's an error processing the request.
    """
    try:
        logger.info(
            "stream_chat_request_received",
            session_id=session.id,
            message_count=len(chat_request.messages),
        )

        async def event_generator():
            """Generate streaming events.

            Yields:
                str: Server-sent events in JSON format.

            Raises:
                Exception: If there's an error during streaming.
            """
            active_streams.labels(agent="web_assistant").inc()
            start = time.monotonic()
            first_token_time: float | None = None
            output_chars: int = 0
            try:
                user = await db_service.get_user(session.user_id)
                custom_prompt = user.system_prompt if user else None
                with llm_stream_duration_seconds.labels(model=agent.llm_service.get_llm().get_name()).time():
                    async for chunk in agent.get_stream_response(
                        chat_request.messages,
                        session.id,
                        user_id=session.user_id,
                        custom_system_prompt=custom_prompt,
                    ):
                        try:
                            parsed = _json.loads(chunk)
                            if parsed.get("type") == "text" and parsed.get("content"):
                                if first_token_time is None:
                                    first_token_time = time.monotonic()
                                    llm_ttft_seconds.labels(agent="web_assistant").observe(first_token_time - start)
                                output_chars += len(parsed["content"])
                        except Exception:
                            pass
                        yield f"data: {chunk}\n\n"

                yield f"data: {_json.dumps({'type': 'done', 'content': '', 'done': True})}\n\n"

            except Exception as e:
                logger.exception(
                    "stream_chat_request_failed",
                    session_id=session.id,
                )
                yield f"data: {_json.dumps({'type': 'done', 'content': str(e), 'done': True})}\n\n"
            finally:
                e2e = time.monotonic() - start
                llm_e2e_latency_seconds.labels(agent="web_assistant").observe(e2e)
                if first_token_time is not None and output_chars > 0:
                    decode_time = time.monotonic() - first_token_time
                    est_tokens = max(output_chars / 4.0, 1.0)
                    llm_tpot_seconds.labels(agent="web_assistant").observe(decode_time / est_tokens)
                active_streams.labels(agent="web_assistant").dec()

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except Exception as e:
        logger.exception(
            "stream_chat_request_failed",
            session_id=session.id,
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/messages", response_model=HistoryResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["messages"][0])
async def get_session_messages(
    request: Request,
    session: Session = Depends(get_current_session),
):
    """Get all messages for a session.

    Args:
        request: The FastAPI request object for rate limiting.
        session: The current session from the auth token.

    Returns:
        HistoryResponse: All messages in the session with tool call data.

    Raises:
        HTTPException: If there's an error retrieving the messages.
    """
    try:
        messages = await agent.get_chat_history(session.id)
        return HistoryResponse(messages=messages)
    except Exception as e:
        logger.error("get_messages_failed", session_id=session.id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/messages")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["messages"][0])
async def clear_chat_history(
    request: Request,
    session: Session = Depends(get_current_session),
):
    """Clear all messages for a session.

    Args:
        request: The FastAPI request object for rate limiting.
        session: The current session from the auth token.

    Returns:
        dict: A message indicating the chat history was cleared.
    """
    try:
        await agent.clear_chat_history(session.id)
        return {"message": "Chat history cleared successfully"}
    except Exception as e:
        logger.error("clear_chat_history_failed", session_id=session.id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/plan-execute")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS.get("chat_stream", ["20/minute"])[0])
async def plan_execute(
    request: Request,
    body: PlanExecuteRequest,
    session: Session = Depends(get_current_session),
):
    """Run Plan-and-Execute or resume an interrupted HITL run via SSE."""
    is_resume = body.thread_id is not None
    if is_resume and body.resume_action == "revise" and not body.feedback:
        raise HTTPException(status_code=400, detail="feedback required for revise action")

    logger.info(
        "plan_execute_request_received",
        session_id=session.id,
        user_id=session.user_id,
        mode="resume" if is_resume else "start",
        thread_id=body.thread_id,
        resume_action=body.resume_action,
    )

    async def event_generator():
        active_streams.labels(agent="plan_execute").inc()
        start = time.monotonic()
        first_token_time: float | None = None
        output_chars: int = 0
        # Track terminal outcome so the chat agent's handoff tool-result
        # message can be annotated afterward. Without this, when the user
        # repeats the same multi-step request, the chat LLM sees the prior
        # handoff and infers PE succeeded — then handles inline instead of
        # re-triggering PE.
        pe_outcome: str | None = "cancelled_by_user" if body.resume_action == "cancel" else None
        try:
            resume_payload = None
            if is_resume:
                resume_payload = {"action": body.resume_action}
                if body.resume_action == "revise":
                    resume_payload["feedback"] = body.feedback
            async for chunk in plan_execute_agent.astream(
                goal=body.goal,
                session_id=session.id,
                user_id=str(session.user_id),
                resume_thread_id=body.thread_id,
                resume_payload=resume_payload,
            ):
                try:
                    parsed = _json.loads(chunk)
                    chunk_type = parsed.get("type")
                    if chunk_type in ("plan_created", "step_text_delta") and first_token_time is None:
                        first_token_time = time.monotonic()
                        llm_ttft_seconds.labels(agent="plan_execute").observe(first_token_time - start)
                    if chunk_type == "step_text_delta" and parsed.get("content"):
                        output_chars += len(parsed["content"])
                    if chunk_type == "final_response":
                        pe_outcome = "completed"
                    elif chunk_type == "error":
                        pe_outcome = "failed"
                except Exception:
                    pass
                yield f"data: {chunk}\n\n"
        except Exception as e:
            pe_outcome = "failed"
            logger.exception("plan_execute_stream_failed", session_id=session.id)
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e), 'done': True})}\n\n"
        finally:
            e2e = time.monotonic() - start
            llm_e2e_latency_seconds.labels(agent="plan_execute").observe(e2e)
            if first_token_time is not None and output_chars > 0:
                decode_time = time.monotonic() - first_token_time
                est_tokens = max(output_chars / 4.0, 1.0)
                llm_tpot_seconds.labels(agent="plan_execute").observe(decode_time / est_tokens)
            active_streams.labels(agent="plan_execute").dec()
            # Best-effort: stamp the chat agent's prior handoff message with
            # this run's outcome. Failure here is non-fatal (the SSE has
            # already been delivered to the client).
            if pe_outcome:
                try:
                    await agent.annotate_pe_outcome(
                        session.id,
                        pe_outcome,
                        user_feedback=body.feedback if body.resume_action == "revise" else None,
                    )
                except Exception:
                    logger.exception(
                        "annotate_pe_outcome_failed",
                        session_id=session.id,
                        outcome=pe_outcome,
                    )

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/plan-execute/inflight")
@limiter.limit("60/minute")
async def plan_execute_inflight(request: Request):
    """Return the count of in-flight Plan-Execute streams.

    Used by the deploy pipeline as a drain gate — restart waits until
    this hits zero (or a timeout) to avoid killing SSE streams mid-run.
    No auth: the numeric count is not sensitive and the endpoint is
    only reachable from the Oracle host loopback in production.
    """
    return {"count": len(ACTIVE_PE_THREADS), "thread_ids": sorted(ACTIVE_PE_THREADS)}

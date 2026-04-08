"""This file contains the graph utilities for the application."""

import tiktoken
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.messages import trim_messages as _trim_messages

from app.core.config import settings
from app.core.logging import logger
from app.schemas import Message

# Shared tiktoken encoder for token counting (works for all models via gpt-4o approximation)
_encoder = tiktoken.encoding_for_model("gpt-4o")


def _count_tokens(messages: list) -> int:
    """Count tokens in a list of messages using tiktoken."""
    total = 0
    for msg in messages:
        if isinstance(msg, dict):
            total += len(_encoder.encode(msg.get("content", "") or ""))
        elif isinstance(msg, BaseMessage):
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            total += len(_encoder.encode(content))
    return total


def dump_messages(messages: list[Message]) -> list[dict]:
    """Dump the messages to a list of dictionaries.

    Args:
        messages (list[Message]): The messages to dump.

    Returns:
        list[dict]: The dumped messages.
    """
    return [message.model_dump() for message in messages]


def process_llm_response(response: BaseMessage) -> BaseMessage:
    """Extract text from structured content blocks.

    Models with thinking mode (e.g., DeepSeek) return content as a list of blocks.
    This extracts text content for checkpoint storage; reasoning is delivered
    to the frontend via streaming events.

    Args:
        response: The raw response from the LLM

    Returns:
        BaseMessage with plain text content
    """
    if isinstance(response.content, list):
        text_parts = []
        for block in response.content:
            if isinstance(block, dict):
                if block.get("type") == "text" and "text" in block:
                    text_parts.append(block["text"])
            elif isinstance(block, str):
                text_parts.append(block)

        response.content = "".join(text_parts)

    return response


def prepare_messages(messages: list[Message], llm: BaseChatModel, system_prompt: str) -> list[Message]:
    """Prepare the messages for the LLM.

    Splits messages into older history and the current turn (from the last
    HumanMessage onward).  Only the history is subject to token-budget
    trimming — the current turn (human → AI tool_call → tool result) is
    always preserved so that tool results are never silently dropped.

    Args:
        messages (list[Message]): The messages to prepare.
        llm (BaseChatModel): The LLM instance (unused, kept for call-site compatibility).
        system_prompt (str): The system prompt to use.

    Returns:
        list[Message]: The prepared messages.
    """
    # Find the start of the current turn (last HumanMessage).
    # Messages may be BaseMessage objects (from LangGraph state) or dicts.
    current_turn_start = 0
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "type", None)
        if role == "human":
            current_turn_start = i
            break

    history = messages[:current_turn_start]
    current_turn = list(messages[current_turn_start:])

    # Trim only the older history to stay within token budget.
    trimmed_history: list = []
    if history:
        try:
            trimmed_history = _trim_messages(
                dump_messages(history),
                strategy="last",
                token_counter=_count_tokens,
                max_tokens=settings.MAX_TOKENS,
                start_on="human",
                include_system=False,
                allow_partial=False,
            )
        except ValueError as e:
            if "Unrecognized content block type" in str(e):
                logger.warning(
                    "token_counting_failed_skipping_trim",
                    error=str(e),
                    message_count=len(history),
                )
                trimmed_history = history
            else:
                raise

    return [Message(role="system", content=system_prompt)] + trimmed_history + current_turn

"""This file contains the chat schema for the application."""

import re
from typing import (
    List,
    Literal,
    Optional,
)


from pydantic import (
    BaseModel,
    Field,
    field_validator,
)


class Message(BaseModel):
    """Message model for chat endpoint.

    Attributes:
        role: The role of the message sender (user or assistant).
        content: The content of the message.
    """

    model_config = {"extra": "ignore"}

    role: Literal["user", "assistant", "system"] = Field(..., description="The role of the message sender")
    content: str = Field(..., description="The content of the message", min_length=1, max_length=50000)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        """Validate the message content.

        Args:
            v: The content to validate

        Returns:
            str: The validated content

        Raises:
            ValueError: If the content contains disallowed patterns
        """
        # Check for potentially harmful content
        if re.search(r"<script.*?>.*?</script>", v, re.IGNORECASE | re.DOTALL):
            raise ValueError("Content contains potentially harmful script tags")

        # Check for null bytes
        if "\0" in v:
            raise ValueError("Content contains null bytes")

        return v


class ChatRequest(BaseModel):
    """Request model for chat endpoint.

    Attributes:
        messages: List of messages in the conversation.
    """

    messages: List[Message] = Field(
        ...,
        description="List of messages in the conversation",
        min_length=1,
    )


class ChatResponse(BaseModel):
    """Response model for chat endpoint.

    Attributes:
        messages: List of messages in the conversation.
    """

    messages: List[Message] = Field(..., description="List of messages in the conversation")


class StreamResponse(BaseModel):
    """Response model for streaming chat endpoint.

    Attributes:
        content: The content of the current chunk.
        done: Whether the stream is complete.
    """

    content: str = Field(default="", description="The content of the current chunk")
    done: bool = Field(default=False, description="Whether the stream is complete")


class StreamChunk(BaseModel):
    """A typed chunk in the SSE stream.

    Extends StreamResponse with a type field to distinguish text tokens from
    tool calls, tool results, reasoning chunks, and node transition events.

    Attributes:
        type: Chunk type.
        content: Text content or empty string.
        tool_name: Tool name (for tool_call and tool_result chunks).
        tool_call_id: Tool call correlation ID.
        node_name: Node name (for node_enter and node_exit chunks).
        duration_ms: Node execution duration in ms (for node_exit chunks).
        done: Whether this is the final chunk.
    """

    type: Literal[
        "text", "tool_call", "tool_result",
        "reasoning_chunk", "node_enter", "node_exit",
        "done"
    ] = Field(default="text", description="Chunk type")
    content: str = Field(default="", description="Chunk content")
    tool_name: Optional[str] = Field(default=None, description="Tool name")
    tool_call_id: Optional[str] = Field(default=None, description="Tool call ID")
    node_name: Optional[str] = Field(default=None, description="LangGraph node name")
    duration_ms: Optional[int] = Field(default=None, description="Node execution duration in ms")
    done: bool = Field(default=False, description="Whether the stream is complete")


class ToolCallRecord(BaseModel):
    """A tool call with its result, for chat history responses."""

    tool_call_id: str
    tool_name: str
    calling_args: str = ""
    result: Optional[str] = None


class HistoryMessage(BaseModel):
    """Richer message model for history responses — includes tool call data."""

    model_config = {"extra": "ignore"}

    role: Literal["user", "assistant"]
    content: str = ""
    tool_calls: List[ToolCallRecord] = Field(default_factory=list)


class HistoryResponse(BaseModel):
    """Response model for the chat history endpoint."""

    messages: List[HistoryMessage]

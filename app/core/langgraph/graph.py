"""This file contains the LangGraph Agent/workflow and interactions with the LLM."""

import asyncio
import json as _json
import time
from datetime import datetime
from typing import (
    AsyncGenerator,
    Optional,
)
from urllib.parse import quote_plus

from langchain_core.messages import (
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    convert_to_openai_messages,
)
from langfuse.langchain import CallbackHandler
from opentelemetry import trace
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import (
    END,
    StateGraph,
)
from langgraph.graph.state import (
    Command,
    CompiledStateGraph,
)
from langgraph.types import (
    RunnableConfig,
    StateSnapshot,
)
from mem0 import AsyncMemory
from psycopg_pool import AsyncConnectionPool

from app.core.config import (
    Environment,
    settings,
)
from app.core.langgraph.tools import tools
from app.core.logging import logger
from app.core.metrics import llm_inference_duration_seconds
from app.core.prompts import load_system_prompt
from app.schemas import (
    GraphState,
    HistoryMessage,
    HistoryResponse,
    Message,
    ToolCallRecord,
)
from app.services.llm import LLMRegistry, llm_service
from app.utils import (
    dump_messages,
    prepare_messages,
    process_llm_response,
)
import mem0.llms.openai

_original_generate_response = mem0.llms.openai.OpenAILLM.generate_response

def _patched_generate_response(self, messages, *args, **kwargs):
    if hasattr(self.config, "store"):
        delattr(self.config, "store")
    return _original_generate_response(self, messages, *args, **kwargs)

mem0.llms.openai.OpenAILLM.generate_response = _patched_generate_response


class LangGraphAgent:
    """Manages the LangGraph Agent/workflow and interactions with the LLM.

    This class handles the creation and management of the LangGraph workflow,
    including LLM interactions, database connections, and response processing.
    """

    def __init__(self):
        """Initialize the LangGraph Agent with necessary components."""
        # Use the LLM service with tools bound
        self.llm_service = llm_service
        self.llm_service.bind_tools(tools)
        self.tools_by_name = {tool.name: tool for tool in tools}
        self._connection_pool: Optional[AsyncConnectionPool] = None
        self._graph: Optional[CompiledStateGraph] = None
        self.memory: Optional[AsyncMemory] = None
        # Tool-free LLM for the analyze node.
        # Must NOT use self.llm_service which has bind_tools() applied —
        # a tool-bound model would emit tool calls instead of plain text, breaking "direct" detection.
        # Use LLMRegistry to get the default model instance so credentials (api_key, base_url)
        # are always correct regardless of which provider is currently primary.
        self._plain_llm = LLMRegistry.get(settings.DEFAULT_LLM_MODEL)
        logger.info(
            "langgraph_agent_initialized",
            model=settings.DEFAULT_LLM_MODEL,
            environment=settings.ENVIRONMENT.value,
        )

    async def _long_term_memory(self) -> AsyncMemory:
        """Initialize the long term memory."""
        if self.memory is None:
            self.memory = await AsyncMemory.from_config(
                config_dict={
                    "vector_store": {
                        "provider": "pgvector",
                        "config": {
                            "collection_name": settings.LONG_TERM_MEMORY_COLLECTION_NAME,
                            "embedding_model_dims": 3072,
                            "hnsw": False,
                            "dbname": settings.POSTGRES_DB,
                            "user": settings.POSTGRES_USER,
                            "password": settings.POSTGRES_PASSWORD,
                            "host": settings.POSTGRES_HOST,
                            "port": settings.POSTGRES_PORT,
                        },
                    },
                    "llm": {
                        "provider": "openai",
                        "config": {
                            "model": settings.LONG_TERM_MEMORY_MODEL,
                            "api_key": settings.DEEPSEEK_API_KEY,
                            "openai_base_url": "https://api.deepseek.com",
                        },
                    },
                    "embedder": {
                        "provider": "openai",
                        "config": {
                            "model": settings.LONG_TERM_MEMORY_EMBEDDER_MODEL,
                            "api_key": settings.OPENAI_API_KEY,
                            "openai_base_url": settings.LLM_BASE_URL,
                        },
                    },
                    # "custom_fact_extraction_prompt": load_custom_fact_extraction_prompt(),
                }
            )
        return self.memory

    async def _get_connection_pool(self) -> AsyncConnectionPool:
        """Get a PostgreSQL connection pool using environment-specific settings.

        Returns:
            AsyncConnectionPool: A connection pool for PostgreSQL database.
        """
        if self._connection_pool is None:
            try:
                # Configure pool size based on environment
                max_size = settings.POSTGRES_POOL_SIZE

                connection_url = (
                    "postgresql://"
                    f"{quote_plus(settings.POSTGRES_USER)}:{quote_plus(settings.POSTGRES_PASSWORD)}"
                    f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
                )

                self._connection_pool = AsyncConnectionPool(
                    connection_url,
                    open=False,
                    max_size=max_size,
                    kwargs={
                        "autocommit": True,
                        "connect_timeout": 5,
                        "prepare_threshold": None,
                    },
                )
                await self._connection_pool.open()
                logger.info("connection_pool_created", max_size=max_size, environment=settings.ENVIRONMENT.value)
            except Exception as e:
                logger.error("connection_pool_creation_failed", error=str(e), environment=settings.ENVIRONMENT.value)
                # In production, we might want to degrade gracefully
                if settings.ENVIRONMENT == Environment.PRODUCTION:
                    logger.warning("continuing_without_connection_pool", environment=settings.ENVIRONMENT.value)
                    return None
                raise e
        return self._connection_pool

    async def _get_relevant_memory(self, user_id: str, query: str) -> str:
        """Get the relevant memory for the user and query.

        Args:
            user_id (str): The user ID.
            query (str): The query to search for.

        Returns:
            str: The relevant memory.
        """
        tracer = trace.get_tracer("langgraph-agent")
        with tracer.start_as_current_span(
            "mem0_search",
            attributes={"mem0.user_id": str(user_id), "mem0.query": query},
        ) as span:
            try:
                memory = await self._long_term_memory()
                results = await memory.search(user_id=str(user_id), query=query)
                result_text = "\n".join([f"* {result['memory']}" for result in results["results"]])
                span.set_attribute("mem0.result_count", len(results["results"]))
                return result_text
            except Exception as e:
                span.set_status(trace.StatusCode.ERROR, str(e))
                span.record_exception(e)
                logger.error("failed_to_get_relevant_memory", error=str(e), user_id=user_id, query=query)
                return ""

    @staticmethod
    def _get_recent_rounds(messages: list[BaseMessage], num_rounds: int = 3) -> list[BaseMessage]:
        """Extract the last N rounds of conversation.

        A round starts with a HumanMessage and includes all subsequent
        messages (AI, Tool, etc.) until the next HumanMessage.
        """
        round_starts = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage)]
        if len(round_starts) <= num_rounds:
            return messages
        return messages[round_starts[-num_rounds]:]

    async def _update_long_term_memory(self, user_id: str, messages: list[dict], metadata: dict = None) -> None:
        """Update the long term memory.

        Args:
            user_id (str): The user ID.
            messages (list[dict]): The messages to update the long term memory with.
            metadata (dict): Optional metadata to include.
        """
        tracer = trace.get_tracer("langgraph-agent")
        with tracer.start_as_current_span(
            "mem0_add",
            attributes={"mem0.user_id": str(user_id), "mem0.message_count": len(messages)},
        ) as span:
            try:
                memory = await self._long_term_memory()
                result = await memory.add(messages, user_id=str(user_id), metadata=metadata)
                span.set_attribute("mem0.result", str(result))
                logger.info("long_term_memory_updated_successfully", user_id=user_id)
            except Exception as e:
                span.set_status(trace.StatusCode.ERROR, str(e))
                span.record_exception(e)
                logger.exception(
                    "failed_to_update_long_term_memory",
                    user_id=user_id,
                    error=str(e),
                )

    async def _analyze(self, state: GraphState, config: RunnableConfig) -> Command:
        """Analyze node: produces a brief reasoning plan before the chat node.

        Calls the plain (tool-free) LLM to decide whether planning is needed.
        Outputs "direct" for simple conversation (no reasoning displayed),
        or a 1-2 sentence plan that gets streamed to the frontend as reasoning_chunk events.

        Args:
            state: Current graph state.
            config: LangGraph runnable config (passed through to ainvoke for Langfuse tracing).

        Returns:
            Command updating reasoning field and routing to "chat".
        """
        last_user_msg = next(
            (m for m in reversed(state.messages) if isinstance(m, HumanMessage)), None
        )
        if not last_user_msg:
            return Command(update={"reasoning": ""}, goto="chat")

        prompt = SystemMessage(content=(
            "In 1-2 sentences, describe what you need to do to answer the user. "
            "If it is simple conversation with no tool use needed, output exactly the word: direct (lowercase only)"
        ))
        try:
            response = await self._plain_llm.ainvoke([prompt, last_user_msg], config=config)
            text = response.content.strip()
            # Case-sensitive check: prompt instructs lowercase "direct"; same check on frontend
            reasoning = "" if text.lower().startswith("direct") else text
        except Exception:
            logger.exception(
                "analyze_llm_failed_using_empty_reasoning",
                session_id=config.get("configurable", {}).get("thread_id"),
            )
            reasoning = ""
        logger.debug(
            "analyze_node_completed",
            has_reasoning=bool(reasoning),
            session_id=config.get("configurable", {}).get("thread_id"),
        )
        return Command(update={"reasoning": reasoning}, goto="chat")

    async def _chat(self, state: GraphState, config: RunnableConfig) -> Command:
        """Process the chat state and generate a response.

        Args:
            state (GraphState): The current state of the conversation.

        Returns:
            Command: Command object with updated state and next node to execute.
        """
        # Get the current LLM instance for metrics
        current_llm = self.llm_service.get_llm()
        model_name = (
            current_llm.model_name
            if current_llm and hasattr(current_llm, "model_name")
            else settings.DEFAULT_LLM_MODEL
        )

        custom = config["configurable"].get("custom_system_prompt")
        if custom:
            try:
                SYSTEM_PROMPT = custom.format(
                    agent_name=settings.PROJECT_NAME + " Agent",
                    long_term_memory=state.long_term_memory,
                    current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                )
            except KeyError:
                logger.warning(
                    "custom_prompt_format_error_falling_back",
                    session_id=config["configurable"]["thread_id"],
                )
                SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory)
        else:
            SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory)

        # Prepare messages with system prompt
        messages = prepare_messages(state.messages, current_llm, SYSTEM_PROMPT)

        try:
            # Use LLM service with automatic retries and circular fallback
            with llm_inference_duration_seconds.labels(model=model_name).time():
                response_message = await self.llm_service.call(dump_messages(messages), config=config)

            # Process response to handle structured content blocks
            response_message = process_llm_response(response_message)

            logger.info(
                "llm_response_generated",
                session_id=config["configurable"]["thread_id"],
                model=model_name,
                environment=settings.ENVIRONMENT.value,
            )

            # Determine next node based on whether there are tool calls
            if response_message.tool_calls:
                goto = "tool_call"
            else:
                goto = END

            return Command(update={"messages": [response_message]}, goto=goto)
        except Exception as e:
            logger.error(
                "llm_call_failed_all_models",
                session_id=config["configurable"]["thread_id"],
                error=str(e),
                environment=settings.ENVIRONMENT.value,
            )
            raise Exception(f"failed to get llm response after trying all models: {str(e)}")

    # Define our tool node
    async def _tool_call(self, state: GraphState, config: RunnableConfig) -> Command:
        """Process tool calls from the last message.

        Args:
            state: The current agent state containing messages and tool calls.
            config: The LangGraph runnable config, forwarded to each tool.

        Returns:
            Command: Command object with updated messages and routing back to chat.
        """
        outputs = []
        for tool_call in state.messages[-1].tool_calls:
            tool_name = tool_call["name"]
            if tool_name not in self.tools_by_name:
                logger.warning("unknown_tool_called", tool_name=tool_name)
                outputs.append(
                    ToolMessage(
                        content=f"Tool '{tool_name}' not found.",
                        name=tool_name,
                        tool_call_id=tool_call["id"],
                    )
                )
                continue
            logger.info("tool_dispatch", tool_name=tool_name, session_id=config.get("configurable", {}).get("thread_id"))
            try:
                tool_result = await self.tools_by_name[tool_name].ainvoke(tool_call["args"], config=config)
            except Exception:
                logger.exception("tool_invocation_failed", tool_name=tool_name)
                raise
            logger.info("tool_completed", tool_name=tool_name, session_id=config.get("configurable", {}).get("thread_id"))
            outputs.append(
                ToolMessage(
                    content=tool_result,
                    name=tool_name,
                    tool_call_id=tool_call["id"],
                )
            )
        return Command(update={"messages": outputs}, goto="chat")

    async def create_graph(self) -> Optional[CompiledStateGraph]:
        """Create and configure the LangGraph workflow.

        Returns:
            Optional[CompiledStateGraph]: The configured LangGraph instance or None if init fails
        """
        if self._graph is None:
            try:
                graph_builder = StateGraph(GraphState)
                graph_builder.add_node("analyze", self._analyze, ends=["chat"])
                graph_builder.add_node("chat", self._chat, ends=["tool_call", END])
                graph_builder.add_node("tool_call", self._tool_call, ends=["chat"])
                graph_builder.set_entry_point("analyze")   # was: "chat"
                graph_builder.set_finish_point("chat")     # unchanged

                # Get connection pool (may be None in production if DB unavailable)
                connection_pool = await self._get_connection_pool()
                if connection_pool:
                    checkpointer = AsyncPostgresSaver(connection_pool)
                    await checkpointer.setup()
                else:
                    # In production, proceed without checkpointer if needed
                    checkpointer = None
                    if settings.ENVIRONMENT != Environment.PRODUCTION:
                        raise Exception("Connection pool initialization failed")

                self._graph = graph_builder.compile(
                    checkpointer=checkpointer, name=f"{settings.PROJECT_NAME} Agent ({settings.ENVIRONMENT.value})"
                )

                logger.info(
                    "graph_created",
                    graph_name=f"{settings.PROJECT_NAME} Agent",
                    environment=settings.ENVIRONMENT.value,
                    has_checkpointer=checkpointer is not None,
                )
            except Exception as e:
                logger.error("graph_creation_failed", error=str(e), environment=settings.ENVIRONMENT.value)
                # In production, we don't want to crash the app
                if settings.ENVIRONMENT == Environment.PRODUCTION:
                    logger.warning("continuing_without_graph")
                    return None
                raise e

        return self._graph

    async def get_response(
        self,
        messages: list[Message],
        session_id: str,
        user_id: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> list[dict]:
        """Get a response from the LLM.

        Args:
            messages (list[Message]): The messages to send to the LLM.
            session_id (str): The session ID for Langfuse tracking.
            user_id (Optional[str]): The user ID for Langfuse tracking.

        Returns:
            list[dict]: The response from the LLM.
        """
        if self._graph is None:
            self._graph = await self.create_graph()
        langfuse_handler = CallbackHandler()
        config = {
            "configurable": {
                "thread_id": session_id,
                "user_id": user_id,
                "custom_system_prompt": custom_system_prompt,
            },
            "callbacks": [langfuse_handler],
            "metadata": {
                "user_id": user_id,
                "session_id": session_id,
                "langfuse_session_id": session_id,
                "langfuse_user_id": str(user_id),
                "environment": settings.ENVIRONMENT.value,
                "debug": settings.DEBUG,
            },
        }
        relevant_memory = (
            await self._get_relevant_memory(user_id, messages[-1].content)
        ) or "No relevant memory found."
        try:
            response = await self._graph.ainvoke(
                input={"messages": dump_messages(messages), "long_term_memory": relevant_memory},
                config=config,
            )
            # Run memory update in background without blocking the response
            recent_messages = self._get_recent_rounds(response["messages"])
            asyncio.create_task(
                self._update_long_term_memory(
                    user_id, convert_to_openai_messages(recent_messages), config["metadata"]
                )
            )
            return self.__process_messages(response["messages"])
        except Exception as e:
            logger.error(f"Error getting response: {str(e)}")
        finally:
            langfuse_handler.client.flush()

    async def get_stream_response(
        self,
        messages: list[Message],
        session_id: str,
        user_id: Optional[str] = None,
        custom_system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Get a stream response from the LLM.

        Args:
            messages (list[Message]): The messages to send to the LLM.
            session_id (str): The session ID for the conversation.
            user_id (Optional[str]): The user ID for the conversation.

        Yields:
            str: Tokens of the LLM response.
        """
        if self._graph is None:
            self._graph = await self.create_graph()
        langfuse_handler = CallbackHandler()
        config = {
            "configurable": {
                "thread_id": session_id,
                "user_id": user_id,
                "custom_system_prompt": custom_system_prompt,
            },
            "callbacks": [
                langfuse_handler
            ],
            "metadata": {
                "user_id": user_id,
                "session_id": session_id,
                "langfuse_session_id": session_id,
                "langfuse_user_id": str(user_id),
                "environment": settings.ENVIRONMENT.value,
                "debug": settings.DEBUG,
            },
        }

        relevant_memory = (
            await self._get_relevant_memory(user_id, messages[-1].content)
        ) or "No relevant memory found."

        # Accumulate tool call args per tool_call_id across streaming chunks
        tool_call_args: dict[str, str] = {}

        # Track current LangGraph node for node_enter / node_exit events
        _current_node: str | None = None
        _node_start_time: dict[str, float] = {}

        try:
            async for event_mode, event_data in self._graph.astream(
                {"messages": dump_messages(messages), "long_term_memory": relevant_memory},
                config,
                stream_mode=["messages", "updates"],
            ):
                # Handle "updates" events: analyze node reasoning arrives here (ainvoke, not streaming)
                if event_mode == "updates":
                    for node_name, state_update in event_data.items():
                        if node_name == "analyze":
                            # Emit synthetic node_enter + optional reasoning_chunk + node_exit for the analyze node.
                            # _analyze uses ainvoke so no "messages" events are emitted for it;
                            # we synthesize the node lifecycle events here instead.
                            _analyze_start = time.time()
                            yield _json.dumps({
                                "type": "node_enter",
                                "content": "",
                                "node_name": "analyze",
                                "done": False,
                            })
                            if state_update.get("reasoning"):
                                yield _json.dumps({
                                    "type": "reasoning_chunk",
                                    "content": state_update["reasoning"],
                                    "done": False,
                                })
                            _analyze_elapsed = int((time.time() - _analyze_start) * 1000)
                            yield _json.dumps({
                                "type": "node_exit",
                                "content": "",
                                "node_name": "analyze",
                                "duration_ms": _analyze_elapsed,
                                "done": False,
                            })
                    continue

                # event_mode == "messages": unpack (token, metadata) tuple
                token, _metadata = event_data

                try:
                    _node = _metadata.get("langgraph_node") if _metadata else None

                    # The "analyze" node uses ainvoke; its AIMessageChunk output still
                    # appears here in "messages" mode. Skip it entirely — node lifecycle
                    # events and reasoning_chunk are emitted by the "updates" handler above.
                    if _node == "analyze":
                        pass

                    else:
                    # Emit node_enter / node_exit on node transitions
                        if _node != _current_node:
                            if _current_node and _current_node in _node_start_time:
                                _elapsed = int((time.time() - _node_start_time[_current_node]) * 1000)
                                yield _json.dumps({
                                    "type": "node_exit",
                                    "content": "",
                                    "node_name": _current_node,
                                    "duration_ms": _elapsed,
                                    "done": False,
                                })
                            if _node:
                                yield _json.dumps({
                                    "type": "node_enter",
                                    "content": "",
                                    "node_name": _node,
                                    "done": False,
                                })
                                _node_start_time[_node] = time.time()
                            _current_node = _node

                    if _node != "analyze" and isinstance(token, AIMessageChunk):
                        if token.tool_call_chunks:
                            for tc in token.tool_call_chunks:
                                tool_call_id = tc.get("id", "")
                                if tc.get("name"):
                                    # First chunk for this tool call — emit the card, start accumulating args
                                    tool_call_args[tool_call_id] = tc.get("args", "")
                                    yield _json.dumps({
                                        "type": "tool_call",
                                        "content": "",
                                        "tool_name": tc["name"],
                                        "tool_call_id": tool_call_id,
                                        "done": False,
                                    })
                                elif tool_call_id in tool_call_args:
                                    # Subsequent arg chunks — accumulate, don't emit
                                    tool_call_args[tool_call_id] += tc.get("args", "")
                        elif token.content:
                            yield _json.dumps({
                                "type": "text",
                                "content": token.content,
                                "done": False,
                            })
                    elif isinstance(token, ToolMessage):
                        yield _json.dumps({
                            "type": "tool_result",
                            "content": str(token.content),
                            "calling_args": tool_call_args.get(token.tool_call_id, ""),
                            "tool_name": token.name,
                            "tool_call_id": token.tool_call_id,
                            "done": False,
                        })
                except Exception:
                    logger.exception("error_processing_token", session_id=session_id)
                    continue

            # Emit node_exit for the last node (loop ends without a final node transition)
            if _current_node and _current_node in _node_start_time:
                _elapsed = int((time.time() - _node_start_time[_current_node]) * 1000)
                yield _json.dumps({
                    "type": "node_exit",
                    "content": "",
                    "node_name": _current_node,
                    "duration_ms": _elapsed,
                    "done": False,
                })

            # After streaming completes, get final state and update memory in background
            state: StateSnapshot = await self._graph.aget_state(config=config)
            if state.values and "messages" in state.values:
                recent_messages = self._get_recent_rounds(state.values["messages"])
                asyncio.create_task(
                    self._update_long_term_memory(
                        user_id, convert_to_openai_messages(recent_messages), config["metadata"]
                    )
                )
        except Exception as stream_error:
            logger.error("Error in stream processing", error=str(stream_error), session_id=session_id)
            raise stream_error
        finally:
            langfuse_handler.client.flush()

    async def get_chat_history(self, session_id: str) -> list[HistoryMessage]:
        """Get the chat history for a given thread ID.

        Args:
            session_id (str): The session ID for the conversation.

        Returns:
            list[HistoryMessage]: The chat history with tool call data.
        """
        if self._graph is None:
            self._graph = await self.create_graph()

        state: StateSnapshot = await self._graph.aget_state(
            config={"configurable": {"thread_id": session_id}}
        )
        return self._process_messages_for_history(state.values["messages"]) if state.values else []

    def _process_messages_for_history(self, messages: list[BaseMessage]) -> list[HistoryMessage]:
        """Convert LangGraph messages into rich history format preserving tool call data.

        Groups consecutive AIMessage/ToolMessage sequences into a single assistant
        HistoryMessage so the frontend can render tool call cards.

        Args:
            messages: Raw LangGraph BaseMessage list from checkpoint state.

        Returns:
            list[HistoryMessage]: History entries with tool_calls populated.
        """
        from langchain_core.messages import AIMessage as LC_AIMessage
        from langchain_core.messages import HumanMessage as LC_HumanMessage
        from langchain_core.messages import ToolMessage as LC_ToolMessage

        result: list[HistoryMessage] = []
        i = 0

        while i < len(messages):
            msg = messages[i]

            if isinstance(msg, LC_HumanMessage):
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                if content:
                    result.append(HistoryMessage(role="user", content=content))
                i += 1

            elif isinstance(msg, LC_AIMessage):
                # Collect all consecutive AI + Tool messages as one assistant turn
                tool_calls_by_id: dict[str, ToolCallRecord] = {}
                tool_calls_order: list[str] = []
                text_parts: list[str] = []

                while i < len(messages) and isinstance(messages[i], (LC_AIMessage, LC_ToolMessage)):
                    current = messages[i]

                    if isinstance(current, LC_AIMessage):
                        if isinstance(current.content, str) and current.content:
                            text_parts.append(current.content)
                        for tc in current.tool_calls or []:
                            record = ToolCallRecord(
                                tool_call_id=tc["id"],
                                tool_name=tc["name"],
                                calling_args=_json.dumps(tc.get("args", {})),
                            )
                            tool_calls_by_id[tc["id"]] = record
                            tool_calls_order.append(tc["id"])

                    elif isinstance(current, LC_ToolMessage):
                        if current.tool_call_id in tool_calls_by_id:
                            tool_calls_by_id[current.tool_call_id].result = str(current.content)

                    i += 1

                text = "".join(text_parts)
                tool_calls = [tool_calls_by_id[tid] for tid in tool_calls_order]

                if text or tool_calls:
                    result.append(HistoryMessage(role="assistant", content=text, tool_calls=tool_calls))

            else:
                i += 1

        return result

    def __process_messages(self, messages: list[BaseMessage]) -> list[Message]:
        openai_style_messages = convert_to_openai_messages(messages)
        # keep just assistant and user messages
        return [
            Message(role=message["role"], content=str(message["content"]))
            for message in openai_style_messages
            if message["role"] in ["assistant", "user"] and message["content"]
        ]

    async def clear_chat_history(self, session_id: str) -> None:
        """Clear all chat history for a given thread ID.

        Args:
            session_id: The ID of the session to clear history for.

        Raises:
            Exception: If there's an error clearing the chat history.
        """
        try:
            # Make sure the pool is initialized in the current event loop
            conn_pool = await self._get_connection_pool()

            # Use a new connection for this specific operation
            async with conn_pool.connection() as conn:
                for table in settings.CHECKPOINT_TABLES:
                    try:
                        await conn.execute(f"DELETE FROM {table} WHERE thread_id = %s", (session_id,))
                        logger.info(f"Cleared {table} for session {session_id}")
                    except Exception as e:
                        logger.error(f"Error clearing {table}", error=str(e))
                        raise

        except Exception as e:
            logger.error("Failed to clear chat history", error=str(e))
            raise

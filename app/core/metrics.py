"""Prometheus metrics configuration for the application.

This module sets up and configures Prometheus metrics for monitoring the application.
"""

from prometheus_client import Counter, Histogram, Gauge
from starlette_prometheus import metrics, PrometheusMiddleware

# Request metrics
http_requests_total = Counter("http_requests_total", "Total number of HTTP requests", ["method", "endpoint", "status"])

http_request_duration_seconds = Histogram(
    "http_request_duration_seconds", "HTTP request duration in seconds", ["method", "endpoint"]
)

# Database metrics
db_connections = Gauge("db_connections", "Number of active database connections")

# Custom business metrics
orders_processed = Counter("orders_processed_total", "Total number of orders processed")

llm_inference_duration_seconds = Histogram(
    "llm_inference_duration_seconds",
    "Time spent processing LLM inference",
    ["model"],
    buckets=[0.1, 0.3, 0.5, 1.0, 2.0, 5.0]
)



llm_stream_duration_seconds = Histogram(
    "llm_stream_duration_seconds",
    "Time spent processing LLM stream inference",
    ["model"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0]
)

# --- LLM latency (per-agent) ---
llm_ttft_seconds = Histogram(
    "llm_ttft_seconds",
    "Time to first token of the LLM stream response",
    ["agent"],
    buckets=[0.1, 0.3, 0.5, 1.0, 2.0, 5.0, 10.0],
)

llm_tpot_seconds = Histogram(
    "llm_tpot_seconds",
    "Estimated time per output token during decode phase",
    ["agent"],
    buckets=[0.01, 0.05, 0.1, 0.2, 0.5, 1.0],
)

llm_e2e_latency_seconds = Histogram(
    "llm_e2e_latency_seconds",
    "End-to-end LLM stream latency from request start to stream completion",
    ["agent"],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0],
)

# --- LLM fallback ---
llm_fallback_total = Counter(
    "llm_fallback_total",
    "LLM model fallback events in circular fallback chain",
    ["from_model", "to_model"],
)

llm_all_models_failed_total = Counter(
    "llm_all_models_failed_total",
    "Count of requests where every LLM model in the registry failed",
)

# --- mem0 (long-term memory) ---
mem0_operation_duration_seconds = Histogram(
    "mem0_operation_duration_seconds",
    "Duration of mem0 memory operations (search / add)",
    ["operation"],
    buckets=[0.05, 0.1, 0.3, 0.5, 1.0, 2.0, 5.0],
)

mem0_operation_errors_total = Counter(
    "mem0_operation_errors_total",
    "Count of failed mem0 memory operations",
    ["operation"],
)

# --- Tool calls ---
tool_call_duration_seconds = Histogram(
    "tool_call_duration_seconds",
    "Duration of LangGraph tool invocations",
    ["tool_name", "status"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
)

tool_call_total = Counter(
    "tool_call_total",
    "Count of LangGraph tool invocations",
    ["tool_name", "status"],
)

# --- Concurrency ---
active_streams = Gauge(
    "active_streams",
    "Number of in-flight SSE stream responses",
    ["agent"],
)


def setup_metrics(app):
    """Set up Prometheus metrics middleware and endpoints.

    Args:
        app: FastAPI application instance
    """
    # Add Prometheus middleware
    app.add_middleware(PrometheusMiddleware)

    # Add metrics endpoint
    app.add_route("/metrics", metrics)

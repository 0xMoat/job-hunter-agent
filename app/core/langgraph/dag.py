"""DAG validation, auto-fix, topological sort, and serial degradation.

Used by the Plan-Execute subgraph to validate planner output before execution.
"""

from collections import defaultdict, deque
from copy import deepcopy
from dataclasses import dataclass

from app.schemas.plan_execute import PlanStep


@dataclass
class DAGError:
    error_type: str  # "duplicate_id" | "invalid_ref" | "self_ref" | "cycle" | "empty"
    step_id: str | None
    detail: str


def validate_dag(steps: list[PlanStep]) -> list[DAGError]:
    """Validate a list of PlanStep for DAG correctness."""
    errors: list[DAGError] = []

    if not steps:
        errors.append(DAGError(error_type="empty", step_id=None, detail="DAG has no steps"))
        return errors

    all_ids = [s.id for s in steps]
    id_set: set[str] = set()

    for step_id in all_ids:
        if step_id in id_set:
            errors.append(DAGError(
                error_type="duplicate_id", step_id=step_id,
                detail=f"Duplicate step id: {step_id}",
            ))
        id_set.add(step_id)

    for step in steps:
        for dep in step.depends_on:
            if dep == step.id:
                errors.append(DAGError(
                    error_type="self_ref", step_id=step.id,
                    detail=f"Step {step.id} depends on itself",
                ))
            elif dep not in id_set:
                errors.append(DAGError(
                    error_type="invalid_ref", step_id=step.id,
                    detail=f"Step {step.id} depends on non-existent {dep}",
                ))

    if not any(e.error_type == "duplicate_id" for e in errors):
        in_degree: dict[str, int] = {s.id: 0 for s in steps}
        adj: dict[str, list[str]] = {s.id: [] for s in steps}
        for step in steps:
            for dep in step.depends_on:
                if dep in adj:
                    adj[dep].append(step.id)
                    in_degree[step.id] += 1

        queue = deque(sid for sid, deg in in_degree.items() if deg == 0)
        visited = 0
        while queue:
            node = queue.popleft()
            visited += 1
            for neighbor in adj[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if visited < len(steps):
            cycle_members = [sid for sid, deg in in_degree.items() if deg > 0]
            errors.append(DAGError(
                error_type="cycle", step_id=cycle_members[0] if cycle_members else None,
                detail=f"Cycle detected involving: {', '.join(cycle_members)}",
            ))

    return errors


def auto_fix_dag(steps: list[PlanStep], errors: list[DAGError]) -> list[PlanStep]:
    """Attempt to fix DAG errors automatically."""
    fixed = deepcopy(steps)

    # Fix duplicate IDs by renaming later occurrences
    seen: set[str] = set()
    for step in fixed:
        original = step.id
        suffix = 2
        while step.id in seen:
            step.id = f"{original}_{suffix}"
            suffix += 1
        seen.add(step.id)
    all_ids = {s.id for s in fixed}

    # Fix invalid refs and self-refs
    for step in fixed:
        step.depends_on = [
            dep for dep in step.depends_on
            if dep != step.id and dep in all_ids
        ]

    # Fix cycles by iteratively removing back edges
    for _ in range(len(fixed)):
        in_degree: dict[str, int] = {s.id: 0 for s in fixed}
        adj: dict[str, list[str]] = {s.id: [] for s in fixed}
        for step in fixed:
            for dep in step.depends_on:
                if dep in adj:
                    adj[dep].append(step.id)
                    in_degree[step.id] += 1

        queue = deque(sid for sid, deg in in_degree.items() if deg == 0)
        visited: set[str] = set()
        while queue:
            node = queue.popleft()
            visited.add(node)
            for neighbor in adj[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(visited) == len(fixed):
            break

        cycle_nodes = [s for s in fixed if s.id not in visited]
        if cycle_nodes:
            cycle_nodes[0].depends_on = cycle_nodes[0].depends_on[:-1]

    return fixed


def topological_sort(steps: list[PlanStep]) -> list[list[str]]:
    """Sort steps into parallel execution waves (layers)."""
    if not steps:
        return []

    step_map = {s.id: s for s in steps}
    in_degree: dict[str, int] = {s.id: 0 for s in steps}
    adj: dict[str, list[str]] = defaultdict(list)

    for step in steps:
        for dep in step.depends_on:
            if dep in step_map:
                adj[dep].append(step.id)
                in_degree[step.id] += 1

    waves: list[list[str]] = []
    current_wave = [sid for sid, deg in in_degree.items() if deg == 0]

    while current_wave:
        current_wave.sort()
        waves.append(current_wave)
        next_wave = []
        for node in current_wave:
            for neighbor in adj[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    next_wave.append(neighbor)
        current_wave = next_wave

    return waves


def degrade_to_serial(steps: list[PlanStep]) -> list[PlanStep]:
    """Convert any DAG into a strict serial chain."""
    result = deepcopy(steps)
    for i, step in enumerate(result):
        step.depends_on = [result[i - 1].id] if i > 0 else []
    return result

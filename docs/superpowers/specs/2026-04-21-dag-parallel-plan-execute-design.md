# DAG Parallel Plan-Execute Design

> Plan-Execute 子图从 flat-list 串行执行改为 DAG 并行执行。

## 动机

当前 Plan-Execute 以 `list[str]` 存储步骤，执行器每次取 `plan[0]` 逐步串行执行。3 张卡片 × 5 步 = 15 步串行，但实际上大量步骤之间无依赖关系，可以并行。

改为 DAG 后，planner LLM 输出带依赖关系的步骤图，执行引擎按拓扑波次并行派发，理论加速 ~5x（3 波次替代 15 步串行）。

## 设计决策汇总

| 决策点 | 选择 |
|--------|------|
| DAG 规划粒度 | LLM 直接输出完整 DAG（含 step id + depends_on），包括卡片内部的并行关系 |
| 步骤失败处理 | 级联跳过 + 最终 Replanner 汇总 |
| DAG 校验失败 | 代码自动修复 → 错误信息发给 LLM 重试 → 降级串行 |
| Approval Gate | 审批一次，整个 DAG 执行 |
| Replanner 介入时机 | 整个 DAG 执行完后介入一次 |

## 1. Schema 变更

### PlanStep（新增）

```python
class PlanStep(BaseModel):
    id: str                          # 如 "A1", "A2", "B1"
    text: str                        # 自然语言指令
    depends_on: list[str] = []       # 前置步骤 id 列表
```

### Plan（修改）

```python
class Plan(BaseModel):
    steps: list[PlanStep]            # 原 list[str] → list[PlanStep]
```

### StepStatus（新增）

```python
class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
```

### PlanExecuteState（修改）

```python
class PlanExecuteState(BaseModel):
    input: str
    plan: list[PlanStep] = []                    # 完整 DAG 定义（不可变，执行期间不弹出）
    step_results: Annotated[dict[str, str], merge_dicts] = {}    # step_id → result text
    step_status: Annotated[dict[str, StepStatus], merge_dicts] = {}  # step_id → 状态
    response: str | None = None
    long_term_memory: str = ""
    pending_applications: str = ""
    target_application_ids: list[int] = []
    iterations: int = 0
    # HITL
    user_feedback: str | None = None
    approval_round: int = 0
    pending_revise: bool = False
```

关键变化：
- `plan` 不再是"剩余步骤"队列，而是完整 DAG 定义，执行期间不弹出
- `past_steps: list[tuple]` 被 `step_results: dict` + `step_status: dict` 替代，支持随机访问
- `Act.action` 中的 `Plan` 也用新的 `PlanStep` schema

### 删除字段

- `past_steps: list[tuple[str, str]]` — 被 `step_results` + `step_status` 替代

## 2. DAG 校验与修复

Planner LLM 输出 `Plan(steps=[PlanStep(...), ...])` 后，执行前过一层校验/修复管线。

### 校验项

| 检查 | 检测方法 | 修复策略 |
|------|---------|---------|
| id 重复 | `len(ids) != len(set(ids))` | 自动重命名（追加 `_2`） |
| depends_on 引用不存在的 id | `dep not in all_ids` | 删除无效引用 |
| 自引用 | `id in depends_on` | 删除自引用 |
| 环 | 拓扑排序失败（Kahn's algorithm） | 移除回边打破环 |
| 空 DAG | `len(steps) == 0` | 无法修复，直接报错 |

### 三层防线流程

```
Planner LLM 输出 Plan
        ↓
  ① validate_dag(plan) — 检测问题
        ↓ 有问题？
  ② auto_fix_dag(plan, errors) — 代码自动修复 → 再 validate
        ↓ 仍有问题？
  ③ 把错误信息发给 Planner LLM 重新规划（最多 2 次）
        ↓ 仍失败？
  ④ degrade_to_serial(plan) — 按原始顺序串成链（每步依赖上一步）
```

### 核心函数签名

```python
@dataclass
class DAGError:
    error_type: str          # "duplicate_id" | "invalid_ref" | "self_ref" | "cycle" | "empty"
    step_id: str | None
    detail: str

def validate_dag(steps: list[PlanStep]) -> list[DAGError]
def auto_fix_dag(steps: list[PlanStep], errors: list[DAGError]) -> list[PlanStep]
def topological_sort(steps: list[PlanStep]) -> list[list[str]]   # 返回波次分组 [[wave1_ids], [wave2_ids], ...]
def degrade_to_serial(steps: list[PlanStep]) -> list[PlanStep]   # 串成链
```

## 3. 执行引擎

### 图拓扑变更

当前：
```
planner → approval_gate → executor → replanner → executor → ...
```

改为：
```
planner → dag_validator → approval_gate → scheduler → executor(s) → collector → replanner → END
                                              ↑                          |
                                              └──── 还有 ready 步骤 ─────┘
```

### 新增节点

| 节点 | 职责 |
|------|------|
| `dag_validator` | 运行第 2 节的三层防线；输出校验通过的 `plan` + 初始化所有 `step_status` 为 `PENDING` |
| `scheduler` | 从 DAG 中找出所有依赖已满足且状态为 PENDING 的步骤，用 `Send()` 并行派发到 executor |
| `collector` | 汇合并行 executor 的结果，更新 `step_results` 和 `step_status`，执行级联跳过逻辑 |

### Scheduler 逻辑

```python
def scheduler(state: PlanExecuteState) -> list[Send]:
    ready = []
    for step in state.plan:
        if state.step_status.get(step.id) != StepStatus.PENDING:
            continue
        deps_failed = any(
            state.step_status.get(d) == StepStatus.FAILED
            for d in step.depends_on
        )
        if deps_failed:
            continue   # collector 处理级联标记
        deps_met = all(
            state.step_status.get(d) in (StepStatus.DONE, StepStatus.SKIPPED)
            for d in step.depends_on
        )
        if deps_met:
            ready.append(Send("executor", {"step": step, ...}))
    return ready
```

### Collector 逻辑

Collector 是 `Send()` 扇出后的汇合节点。LangGraph 的 `Send()` 并行派发多个 executor 后，需要一个节点收集结果。Collector 负责：

1. 收集本轮所有 executor 的返回值，更新 `step_results` 和 `step_status`
2. 级联跳过：遍历 DAG，所有直接或间接依赖 FAILED 步骤的后代标记为 SKIPPED
3. 路由判断（通过 conditional edge）：
   - 还有 PENDING 步骤且依赖可满足 → 回 scheduler
   - 全部 DONE/FAILED/SKIPPED → 去 replanner

**Executor → Collector 数据传递方式**：每个 executor 实例返回 `{"step_id": str, "result": str, "success": bool}`。LangGraph 的 `Send()` 扇出后，多个 executor 的返回值通过 state reducer 合并。`step_results` 和 `step_status` 使用自定义 reducer（dict merge），使并行写入不会互相覆盖。

```python
# State 字段需要自定义 reducer 支持并行写入
step_results: Annotated[dict[str, str], merge_dicts]
step_status: Annotated[dict[str, StepStatus], merge_dicts]
```

### Executor 不变

每个 executor 仍然是独立 ReAct 子 agent（`create_react_agent`），只处理一个 step。输入从 `plan[0]` 变成 `Send` 传入的 `step`。保留现有的超时（180s）、循环检测（MAX_REPEATED_TOOL_CALLS）、递归限制（25）。

### 路由总结

```
scheduler → Send() → executor(s) → collector
                                       ↓
                              还有 ready？ → scheduler
                              全部完成？   → replanner
                              replanner    → 补救 DAG？ → dag_validator → approval_gate → ...
                                           → final response → END
```

## 4. SSE 事件流

### 新增事件类型

```typescript
// 波次开始
{ type: "wave_started", wave: number, step_ids: string[], done: false }

// 步骤被级联跳过
{ type: "step_skipped", id: string, reason: string, done: false }
```

### 修改事件

```typescript
// plan_created 的 steps 增加 depends_on 字段
{ type: "plan_created", steps: [{id: string, text: string, depends_on: string[]}], done: false }

// awaiting_approval 同样增加 depends_on
{ type: "awaiting_approval", plan: [{id: string, text: string, depends_on: string[]}], ... }
```

### 保留事件（无变更）

`step_started`, `step_completed`, `step_tool_call`, `step_tool_result`, `step_text_delta`, `plan_revised`, `final_response`, `error`, `interrupted`

注意：并行执行时多个 `step_started` 可能近乎同时发出，多个步骤的 `step_tool_call` / `step_text_delta` 事件会交错到达。前端需按 `step_id` 分流。

## 5. 前端变更

### 类型定义（frontend/lib/types.ts）

```typescript
// PlanStep 增加 depends_on
interface PlanStep {
    id: string
    text: string
    status: PlanStepStatus           // 不变
    result?: string
    liveText?: string
    toolCalls?: PlanLiveToolCall[]
    startedAt?: number
    dependsOn?: string[]             // 新增
}

// PlanStepDescriptor 增加 depends_on
interface PlanStepDescriptor {
    id: string
    text: string
    depends_on?: string[]            // 新增
}

// PlanStepStatus 增加 skipped
type PlanStepStatus = "pending" | "running" | "done" | "failed" | "skipped"
```

### Timeline 组件（PlanTimeline.tsx）

从串行列表改为波次分组布局：
- 按拓扑波次分组步骤（前端从 `depends_on` 计算波次，或从 `wave_started` 事件获取）
- 同一波次内步骤横向排列
- 不同波次纵向排列
- 步骤之间绘制依赖连线（SVG 或 CSS）

### 连线规则

| 依赖状态 | 线条样式 |
|----------|---------|
| source step = done | 实线绿色箭头 |
| source step = running / pending | 虚线灰色箭头 |
| source step = failed | 虚线红色箭头（目标步骤显示 skipped） |

连线数据来源于 `plan_created` 事件中每个 step 的 `depends_on` 字段，随 step_status 变化动态更新样式。

### Approval Card（PlanApprovalCard.tsx）

审批界面展示 DAG 连线图（复用 Timeline 的连线渲染逻辑），让用户批准前看到并行结构和依赖关系。操作不变：批准 / 修改 / 取消。

## 6. Planner Prompt 变更

### 输出格式指导（替换原有 "Step format" 部分）

```markdown
# Step format

1. 每步必须有唯一 id（格式：卡片标识 + 序号，如 "A1", "A2", "B1"）
2. 每步必须声明 depends_on（无前置依赖则为空列表）
3. 同一卡片内的依赖关系：
   - company_research 无前置依赖
   - score_jd_match / analyze_jd_gap / generate_interview_questions 仅依赖该卡片的 company_research
   - 定制简历+PDF 依赖该卡片的 score + gap + interview
4. 跨卡片的步骤之间不应有依赖（除非用户目标明确要求先后顺序）
5. 最终汇总步骤依赖所有卡片的最后一步
```

### 输出示例（嵌入 prompt 引导 LLM）

```json
{
  "steps": [
    {"id": "A1", "text": "company_research(card=10) 并 save", "depends_on": []},
    {"id": "B1", "text": "company_research(card=11) 并 save", "depends_on": []},
    {"id": "A2", "text": "score_jd_match(application_id=10)", "depends_on": ["A1"]},
    {"id": "A3", "text": "analyze_jd_gap(application_id=10)", "depends_on": ["A1"]},
    {"id": "A4", "text": "generate_interview_questions(application_id=10)", "depends_on": ["A1"]},
    {"id": "A5", "text": "定制简历+PDF(application_id=10)", "depends_on": ["A2","A3","A4"]},
    {"id": "B2", "text": "score_jd_match(application_id=11)", "depends_on": ["B1"]},
    {"id": "B3", "text": "analyze_jd_gap(application_id=11)", "depends_on": ["B1"]},
    {"id": "B4", "text": "generate_interview_questions(application_id=11)", "depends_on": ["B1"]},
    {"id": "B5", "text": "定制简历+PDF(application_id=11)", "depends_on": ["B2","B3","B4"]},
    {"id": "Z", "text": "汇总本次处理结果", "depends_on": ["A5","B5"]}
  ]
}
```

### Replanner Prompt 对应调整

- `remaining_plan` 改为展示剩余步骤的 id + depends_on 结构
- replanner 输出补救 DAG 时也用 `PlanStep` 格式
- 新增规则：补救 DAG 的 depends_on 只能引用已完成步骤的 id 或新步骤之间互相引用

## 7. 测试策略

### 单元测试

- `validate_dag` — 各种错误场景（重复 id、无效引用、自引用、环、空 DAG）
- `auto_fix_dag` — 修复后 DAG 合法
- `topological_sort` — 正确的波次分组
- `degrade_to_serial` — 串成链后每步依赖上一步
- `scheduler` — 正确识别 ready 步骤、级联跳过
- `collector` — 正确更新状态、级联传播

### 集成测试

- Happy path：planner → validate → approve → 多波次并行执行 → replanner → final response
- 步骤失败 + 级联跳过：某步失败，依赖链被 skip，其他卡片正常完成
- DAG 校验失败 → 自动修复 → 执行
- DAG 校验失败 → LLM 重试 → 执行
- DAG 校验失败 → 降级串行
- HITL revise：用户修改后 replanner 输出新 DAG

## 8. 不变的部分

- Tool 层：13 个业务 tool 的签名和实现不变
- `start_plan_execute` 握手 tool 不变
- ReAct executor 子 agent 的内部逻辑不变（仍然是独立的 `create_react_agent`）
- API 端点路径和请求格式不变（`POST /plan-execute`），只是 SSE 事件流多了新类型
- Long-term memory 和 pending applications 的预取逻辑不变
- Checkpointer（AsyncPostgresSaver）不变
- `ACTIVE_PE_THREADS` 追踪和 `reap_stale_pe_threads` 清理逻辑不变

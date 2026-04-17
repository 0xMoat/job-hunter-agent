# Kanban Card Artifacts: PE 自动回写 6 维度数据

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Kanban 上的 JD 卡片扩展 6 个新维度数据，并让 Plan-Execute（PE）流程在执行过程中**自动回写**这些数据到对应卡片：
1. 公司背景调研结果
2. 针对性润色简历结果文本
3. 简历 PDF 下载（服务器保留 30 天后自动清理）
4. JD 匹配度（总分 0-100 + 4 维度分项 breakdown）
5. 差距分析（需补充的知识点）
6. 面试可能问到的经典问题

PE 完成后，agent 发一条消息通知用户"已更新 N 张卡片"。

**Architecture:**

- **PE 和卡片绑定**：采用方案 (c)——`PlanExecuteState` 新增 `target_application_ids: list[int]`，PE 启动时从 goal 推导（例如"研究这 5 家"→取当前 pending/saved 5 张卡），tool 层仍以单张 `application_id` 为粒度。
- **Tool 结构（方案 A：独立 save tool）**：
  - **纯写卡 tool（2）**：`save_company_research(app_id, content)`、`save_tailored_resume(app_id, content)` —— 产出是 tool JSON 或 LLM message，需独立回写。
  - **改造 tool（1）**：`generate_resume_pdf` 加 `application_id` 参数，内部写回 `pdf_token` + `pdf_created_at`。
  - **分析+写卡 tool（3）**：`score_jd_match`、`analyze_jd_gap`、`generate_interview_questions` —— 这 3 个内部调 LLM 产出结构化数据后直接写卡，不需要独立 save tool（分析结果必然绑定 app_id）。
- **匹配度公式**：固定 4 维度 LLM 打分 → 加权求总分（0-100 存 `match_score`），分项细节存 `match_breakdown` JSON：
  - 技能硬性匹配 (weight 0.4)
  - 经验年限匹配 (weight 0.25)
  - 领域契合 (weight 0.2)
  - 软性要求（语言/地点/学历等）(weight 0.15)
- **PDF 保留**：APScheduler cron 每日扫 `/tmp/resume_*.pdf` 删除 mtime > 30 天的文件；同时扫 Application 表清空过期 `pdf_token`。卡片 UI 访问时后端按需重签 24h 下载 JWT，避免卡片存过期 URL。
- **通知机制**：PE replanner 最终 summary message 里列出"已更新 N 张卡片：A / B / C"；不做额外推送 UI。

**Tech Stack:** Python（SQLModel、Alembic、LangGraph、LangChain tools、APScheduler）、FastAPI、Next.js 16 + React 19、既有 `useChat` / `KanbanBoard`。

**仓库约定：** 无 pytest。验证：`pnpm exec tsc --noEmit`（前端）+ `make lint`（后端）+ 手动 E2E checklist。

---

## 文件结构

```
app/
├── models/application.py                          # [改] 新增 6 字段
├── schemas/
│   ├── application.py                             # [改] ApplicationUpdate / ApplicationRead 扩展
│   └── plan_execute.py                            # [改] State 加 target_application_ids
├── api/v1/
│   ├── applications.py                            # [改] PATCH 允许更新新字段；GET 重签 PDF URL
│   └── resume.py                                  # [改] 下载端点按需重签 token（若需要）
├── core/
│   ├── langgraph/tools/
│   │   ├── save_company_research.py               # [新] 纯写卡
│   │   ├── save_tailored_resume.py                # [新] 纯写卡
│   │   ├── score_jd_match.py                      # [新] 分析+写卡
│   │   ├── analyze_jd_gap.py                      # [新] 分析+写卡
│   │   ├── generate_interview_questions.py        # [新] 分析+写卡
│   │   ├── resume_pdf.py                          # [改] 加 application_id 参数 + 写卡
│   │   └── __init__.py                            # [改] 注册 6 个新 tool
│   ├── langgraph/plan_execute.py                  # [改] 从 goal 解析 target ids；summary message
│   ├── scheduler/pdf_cleanup.py                   # [新] APScheduler 清理 cron
│   └── prompts/
│       ├── system.md                              # [改] 指导 agent 何时用新 tool
│       ├── plan_execute_planner.md                # [改] 列出新 tool 及用法
│       └── plan_execute_replanner.md              # [改] 总结 message 格式

frontend/
├── lib/
│   ├── types.ts                                   # [改] Application 加 6 新字段
│   └── i18n.ts                                    # [改] 新字段 label 文本 zh/en
├── components/kanban/
│   ├── ApplicationCard.tsx                        # [改] 展开区展示 6 字段
│   └── ApplicationDetailDrawer.tsx                # [新?] 详情抽屉（若现有无）
└── hooks/useApplications.ts                       # [改] fetch 含新字段；按需换 PDF URL
```

---

## Task 1 · 数据库 schema 扩展

**Files:**
- Modify: `app/models/application.py`
- Modify: `app/schemas/application.py`
- Create: `alembic/versions/XXXX_kanban_artifacts.py` （若项目用 Alembic；否则直接改 model，测试时 drop+recreate）

- [ ] **Step 1: `Application` 模型新增字段**

在 `app/models/application.py` 的 `Application` 类里追加：

```python
# 1. 公司背景调研（JSON 结构，复用 company_research_tool 输出）
company_research_json: Optional[str] = Field(default=None, sa_column=Column(Text))
# 2. 针对性润色后的简历全文（Markdown）
tailored_resume_text: Optional[str] = Field(default=None, sa_column=Column(Text))
# 3. PDF 追踪
pdf_token: Optional[str] = Field(default=None, max_length=64)
pdf_created_at: Optional[datetime] = Field(default=None)
# 4. match_score 已存在（保留 0-100），新增分项
match_breakdown: Optional[str] = Field(default=None, sa_column=Column(Text))  # JSON
# 5. 差距分析
gap_analysis_text: Optional[str] = Field(default=None, sa_column=Column(Text))
# 6. 面试问题
interview_questions_json: Optional[str] = Field(default=None, sa_column=Column(Text))
# 通用：记录最后一次 PE 回写时间，供前端排序/高亮
artifacts_updated_at: Optional[datetime] = Field(default=None)
```

- [ ] **Step 2: Pydantic schemas 扩展**

修改 `app/schemas/application.py`：
- `ApplicationRead` 暴露所有新字段（`pdf_token` 不直接暴露，替换为 API 动态签发的 `pdf_download_url`）。
- `ApplicationUpdate` 允许可选更新：`company_research_json`, `tailored_resume_text`, `match_breakdown`, `gap_analysis_text`, `interview_questions_json`, `match_score`, `pdf_token`, `pdf_created_at`, `artifacts_updated_at`。

- [ ] **Step 3: Alembic migration（若仓库已有）**

用 `alembic revision --autogenerate -m "kanban_artifacts"` 生成脚本后人工检查。若仓库无 alembic 基础设施，在 Task 1 Step 1 的 commit message 中注明"dev 环境需 drop 表重建"。

- [ ] **Step 4: Lint + 启动验证**

```bash
make lint
make dev      # 本地启动无报错
```

**Success Criteria:**

**Automated verification:**
- [ ] `make lint` 通过
- [ ] `make dev` 启动无 schema 错误

**Manual verification:**
- [ ] 对 DB 执行 `\d applications` 能看到所有新列

---

## Task 2 · PATCH endpoint 支持新字段 + PDF URL 动态签发

**Files:**
- Modify: `app/api/v1/applications.py`

- [ ] **Step 1: PATCH 允许更新新字段**

`PATCH /applications/{id}` 的 `ApplicationUpdate` 扩展后自动支持；确认 endpoint 里 `for k, v in payload.model_dump(exclude_unset=True).items(): setattr(app_obj, k, v)` 的 setattr pattern 能命中新字段。如 endpoint 是白名单模式，需显式加字段。

- [ ] **Step 2: GET / LIST 时动态签发 PDF URL**

在序列化返回前，若 `pdf_token` 非空 && `pdf_created_at` 距今 < 30 天：
- 读 `/tmp/resume_{pdf_token}.pdf` 是否存在
- 若存在 → 签一个新 24h JWT，返回字段 `pdf_download_url`
- 若不存在 → 清空该卡 `pdf_token`（lazy cleanup）、不返回 URL

抽成 helper `_resolve_pdf_url(application: Application) -> Optional[str]` 供 list/get/patch 响应复用。

- [ ] **Step 3: 验证**

```bash
make lint
curl -X PATCH http://localhost:8000/api/v1/applications/1 \
  -H "Content-Type: application/json" \
  -d '{"gap_analysis_text": "test"}'
# 应返回 200 + 新字段
```

**Success Criteria:**

**Automated verification:**
- [ ] `make lint` 通过

**Manual verification:**
- [ ] PATCH 写入新字段成功
- [ ] 返回卡片对象含 `pdf_download_url`（若 pdf_token 存在）

---

## Task 3 · 纯写卡 tool（2 个）

**Files:**
- Create: `app/core/langgraph/tools/save_company_research.py`
- Create: `app/core/langgraph/tools/save_tailored_resume.py`
- Modify: `app/core/langgraph/tools/__init__.py`（暂时先注册这 2 个）

- [ ] **Step 1: `save_company_research`**

```python
@tool
async def save_company_research(application_id: int, content: str, config: RunnableConfig) -> str:
    """Persist the company background research result to a kanban card.

    Call this AFTER company_research_tool returns, to write the research
    JSON/text onto the JD card's `company_research_json` field so the user
    sees it in the kanban.

    Args:
        application_id: Target card id (must belong to the current user).
        content: The research content (JSON string or free text) to save.
    """
    user_id = config.get("configurable", {}).get("user_id")
    db = DatabaseService()
    ok = await db.update_application_artifacts(
        user_id=user_id,
        application_id=application_id,
        updates={"company_research_json": content, "artifacts_updated_at": datetime.utcnow()},
    )
    if not ok:
        return f"Error: application {application_id} not found or not owned by user."
    return f"Saved company research to application {application_id}."
```

- [ ] **Step 2: `save_tailored_resume`**

结构同上，写字段 `tailored_resume_text`。docstring 说明"call this when the user has agreed with / finalized the tailored resume output from resume_studio skill"。

- [ ] **Step 3: `DatabaseService.update_application_artifacts` helper**

在 `app/services/database.py` 新增：

```python
async def update_application_artifacts(
    self, *, user_id: int, application_id: int, updates: dict[str, Any]
) -> bool:
    """Partial update of application artifact fields. Returns True if found & updated."""
    async with self._session() as session:
        stmt = select(Application).where(
            Application.id == application_id, Application.user_id == user_id
        )
        app = (await session.execute(stmt)).scalar_one_or_none()
        if not app:
            return False
        for k, v in updates.items():
            setattr(app, k, v)
        session.add(app)
        await session.commit()
        return True
```

- [ ] **Step 4: 注册 & 验证**

在 `tools/__init__.py` 的 `tools` 列表加入 2 个新 tool。`make lint`、`make dev` 正常启动。

**Success Criteria:**

**Automated verification:**
- [ ] `make lint` 通过
- [ ] `make dev` 启动
- [ ] Tools list 包含两个新 tool（可加 debug log 打印）

**Manual verification:**
- [ ] 在 chat 中让 agent 调用 `save_company_research` 成功写回

---

## Task 4 · 改造 `generate_resume_pdf` 加 application_id + 写卡

**Files:**
- Modify: `app/core/langgraph/tools/resume_pdf.py`

- [ ] **Step 1: 增加必填参数 `application_id: int`**

修改 tool signature：

```python
@tool
async def generate_resume_pdf(
    application_id: int,
    resume_markdown: str,
    config: RunnableConfig,
) -> str:
    """Render the tailored resume to PDF, persist its token on the kanban card,
    and return a signed 24h download URL.
    ...
    """
```

- [ ] **Step 2: 生成 PDF 后写卡**

现有逻辑生成 `/tmp/resume_{token}.pdf` 后，调用 `db.update_application_artifacts(user_id, application_id, {"pdf_token": token, "pdf_created_at": datetime.utcnow(), "artifacts_updated_at": ...})`。若写卡失败，删掉 tmp 文件 + 返回错误。

- [ ] **Step 3: System prompt / planner prompt 同步**

`system.md` 和 `plan_execute_planner.md` 里凡提到 `generate_resume_pdf` 的地方补充"必须传 `application_id`（目标 JD 卡的 id）"。

- [ ] **Step 4: 验证**

```bash
make lint
# 手动 chat： "帮我为卡片 1 生成简历 PDF" → 卡片 pdf_token 应被写入
```

**Success Criteria:**

**Automated verification:**
- [ ] `make lint` 通过

**Manual verification:**
- [ ] PDF 生成后，对应卡片 `pdf_token` / `pdf_created_at` 被写入
- [ ] GET 卡片响应含 `pdf_download_url`

---

## Task 5 · 分析 tool（3 个）

**Files:**
- Create: `app/core/langgraph/tools/score_jd_match.py`
- Create: `app/core/langgraph/tools/analyze_jd_gap.py`
- Create: `app/core/langgraph/tools/generate_interview_questions.py`
- Create: `app/core/prompts/match_scoring.md`
- Create: `app/core/prompts/gap_analysis.md`
- Create: `app/core/prompts/interview_questions.md`
- Modify: `app/core/langgraph/tools/__init__.py`

- [ ] **Step 1: 共享 helper — 读取 JD + 用户简历**

在 `app/services/database.py` 新增 `get_application_for_user(user_id, application_id) -> Optional[Application]`。在 `app/core/langgraph/tools/_analysis_common.py` 写一个 helper `load_jd_and_resume(user_id, application_id)` 返回 `(jd_text, resume_text, application)` 或抛 `ValueError`。

- [ ] **Step 2: `score_jd_match` — 4 维度打分**

写 `app/core/prompts/match_scoring.md`：指示 LLM 按 4 维度（技能硬性匹配 / 经验年限 / 领域契合 / 软性要求）各打 0-10 分 + 一句理由，用结构化输出（Pydantic schema）。

```python
class MatchDimension(BaseModel):
    score: int = Field(ge=0, le=10)
    reason: str

class MatchBreakdown(BaseModel):
    skills: MatchDimension
    experience: MatchDimension
    domain: MatchDimension
    soft: MatchDimension
```

Tool 实现：
1. `load_jd_and_resume`
2. LLM structured output → `MatchBreakdown`
3. 计算总分 `total = skills.score*10*0.4 + experience.score*10*0.25 + domain.score*10*0.2 + soft.score*10*0.15` → 取整得 0-100
4. 写卡 `match_score` + `match_breakdown` (JSON dump)
5. 返回 "Match score for app {id}: {total}/100. Breakdown: ..."

- [ ] **Step 3: `analyze_jd_gap`**

prompt：给 LLM JD + 用户简历，要求输出"3-5 条最关键的需补充的知识点 / 技能缺口"Markdown 列表。写卡 `gap_analysis_text`。

- [ ] **Step 4: `generate_interview_questions`**

prompt：给 LLM JD + 用户简历，要求输出 8-12 条可能面试问题 + 每条一句考察点，JSON 数组 `[{question, focus}]`。写卡 `interview_questions_json`。

- [ ] **Step 5: 注册 & 验证**

3 个 tool 加入 `tools/__init__.py`。`make lint`、启动、单 tool 手动调用验证。

**Success Criteria:**

**Automated verification:**
- [ ] `make lint` 通过
- [ ] 3 个 tool 注册成功

**Manual verification:**
- [ ] 每个 tool 单独 chat 触发可写回对应字段
- [ ] match_breakdown 4 维度齐全、总分合理

---

## Task 6 · PDF 清理 cron（APScheduler）

**Files:**
- Create: `app/core/scheduler/pdf_cleanup.py`
- Modify: `app/main.py`（启动时挂载 scheduler）
- Check: 若项目已有 APScheduler 实例，复用

- [ ] **Step 1: 清理 job**

```python
# app/core/scheduler/pdf_cleanup.py
from pathlib import Path
from datetime import datetime, timedelta, timezone

TMP_DIR = Path("/tmp")
RETENTION_DAYS = 30

async def cleanup_expired_pdfs() -> dict[str, int]:
    """Delete resume_*.pdf older than 30 days; clear matching DB pdf_token."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    cutoff_ts = cutoff.timestamp()

    # 1. 物理文件
    deleted_files = 0
    for p in TMP_DIR.glob("resume_*.pdf"):
        if p.stat().st_mtime < cutoff_ts:
            p.unlink(missing_ok=True)
            deleted_files += 1

    # 2. DB 清理：pdf_created_at < cutoff 的卡片清空 pdf_token
    db = DatabaseService()
    cleared_rows = await db.clear_expired_pdf_tokens(cutoff)

    logger.info("pdf_cleanup_done", deleted_files=deleted_files, cleared_rows=cleared_rows)
    return {"deleted_files": deleted_files, "cleared_rows": cleared_rows}
```

- [ ] **Step 2: 挂 APScheduler**

在 `app/main.py` 的 lifespan / startup 添加：

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.core.scheduler.pdf_cleanup import cleanup_expired_pdfs

scheduler = AsyncIOScheduler()
scheduler.add_job(cleanup_expired_pdfs, "cron", hour=3, minute=0, id="pdf_cleanup")
scheduler.start()
```

若项目已有 scheduler（检查现有代码），复用并 `add_job`。

- [ ] **Step 3: 手动触发 smoke 验证**

写一个一次性 script `scripts/run_pdf_cleanup.py` 调用 `cleanup_expired_pdfs()` 打印结果。

**Success Criteria:**

**Automated verification:**
- [ ] `make lint` 通过
- [ ] `make dev` 启动、日志无 APScheduler 错误

**Manual verification:**
- [ ] 手动把一个 PDF 的 mtime 改成 31 天前，跑 cleanup 脚本能删除、能清空 DB token

---

## Task 7 · PE state 扩展：`target_application_ids` + 总结 message

**Files:**
- Modify: `app/schemas/plan_execute.py`
- Modify: `app/core/langgraph/plan_execute.py`
- Modify: `app/core/prompts/plan_execute_planner.md`
- Modify: `app/core/prompts/plan_execute_replanner.md`

- [ ] **Step 1: State 新增字段**

```python
class PlanExecuteState(BaseModel):
    input: str
    plan: List[str] = []
    past_steps: List[Tuple[str, str]] = []
    pending_applications: List[ApplicationSnapshot] = []
    target_application_ids: List[int] = []  # NEW
    response: Optional[str] = None
```

- [ ] **Step 2: PE 启动时推导 target ids**

在 `plan_execute.py` 的起点（planner 前）加一个 node `derive_targets`：
- 从 `state.pending_applications` 取 ids（用户说"这些"/"这 N 家"时的默认行为）
- planner prompt 里让 LLM 若 user goal 包含具体公司名，把匹配到的 application id 反写到 `target_application_ids`（通过一个小 structured output 字段）

简化策略：先只做默认"全部 pending"推导；后续再让 planner 自由指定。

- [ ] **Step 3: 把 target ids 注入 tool 调用上下文**

Planner prompt 里明确：每个 action step 的 tool 调用必须传 `application_id`（从 `target_application_ids` 里选一个），不允许空。

- [ ] **Step 4: Replanner 总结 message**

`plan_execute_replanner.md` 里规定：当 `past_steps` 表明所有 target ids 都被处理过后，replanner 用 `response` 字段输出一条中文总结：

> ✅ 已更新 {N} 张卡片：
> - {公司 A}（研究/匹配/差距/问题/简历 PDF）
> - {公司 B} ...
> 
> 前往看板查看详情。

- [ ] **Step 5: 验证**

`make lint` + 手动 E2E（PE 多卡循环跑一轮）。

**Success Criteria:**

**Automated verification:**
- [ ] `make lint` 通过
- [ ] PE 单轮测试无 pydantic 校验错误

**Manual verification:**
- [ ] chat 发"研究这 3 家并润色简历"→ PE 跑完后 3 张卡都有新字段
- [ ] replanner 最终 message 列出 3 张卡名称

---

## Task 8 · System / Planner prompt 更新：指导 agent 用新 tool

**Files:**
- Modify: `app/core/prompts/system.md`
- Modify: `app/core/prompts/plan_execute_planner.md`
- Modify: `app/core/prompts/plan_execute_replanner.md`

- [ ] **Step 1: system.md**

在 "Tool usage" 段落新增 6 个 tool 的触发条件：
- 用户想看公司情况 → `company_research_tool` + 紧接 `save_company_research`
- 用户同意生成简历文本 → `trigger_resume_studio_skill`，LLM 产出后紧接 `save_tailored_resume`
- 用户要 PDF → `generate_resume_pdf`（带 `application_id`）
- 用户问匹配度 / 差距 / 面试问题 → 三个分析 tool（都带 `application_id`）

- [ ] **Step 2: plan_execute_planner.md**

把默认 3 步闭环（研究 + 简历润色 + 看板）升级为**按卡片循环的 6 步模板**：

对每张 target card：
1. `company_research_tool(company)` → `save_company_research(app_id)`
2. `score_jd_match(app_id)` → `analyze_jd_gap(app_id)` → `generate_interview_questions(app_id)`
3. `trigger_resume_studio_skill` → `save_tailored_resume(app_id)` → `generate_resume_pdf(app_id)`

- [ ] **Step 3: 验证**

`make lint`；用一个较大的 goal 手动 E2E，看 plan 是否按模板展开。

**Success Criteria:**

**Manual verification:**
- [ ] Planner 产出的 plan 包含"每张卡片 x 6 步"结构
- [ ] Agent 正确给每个 tool 传 `application_id`

---

## Task 9 · 前端：Application type + 卡片 UI 展示新字段

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/i18n.ts`
- Modify: `frontend/components/kanban/ApplicationCard.tsx`
- Create (if absent): `frontend/components/kanban/ApplicationDetailDrawer.tsx`
- Modify: `frontend/hooks/useApplications.ts`

- [ ] **Step 1: TS type 同步**

```typescript
export interface Application {
  // ...existing fields
  company_research_json?: string | null
  tailored_resume_text?: string | null
  pdf_download_url?: string | null
  pdf_created_at?: string | null
  match_breakdown?: string | null  // JSON 字符串，前端 JSON.parse
  gap_analysis_text?: string | null
  interview_questions_json?: string | null
  artifacts_updated_at?: string | null
}
```

- [ ] **Step 2: i18n keys 新增**

```ts
artifact_research: "公司调研" / "Company research"
artifact_match: "匹配度" / "JD match"
artifact_gap: "知识缺口" / "Skill gap"
artifact_interview: "面试问题" / "Interview questions"
artifact_tailored: "润色简历" / "Tailored resume"
artifact_pdf: "简历 PDF" / "Resume PDF"
artifact_empty_hint: "尚未生成" / "Not generated yet"
artifact_breakdown_skills: "技能匹配" / "Skills"
artifact_breakdown_experience: "经验匹配" / "Experience"
artifact_breakdown_domain: "领域契合" / "Domain fit"
artifact_breakdown_soft: "软性要求" / "Soft requirements"
```

- [ ] **Step 3: 卡片 UI**

调研现有 `ApplicationCard`：
- 若卡片本身尺寸有限，新增 "详情" 按钮 → 打开 `ApplicationDetailDrawer`（右侧抽屉），内部分 6 段展示。
- 抽屉布局：
  - 匹配度：大号总分 + 4 条 progress bar 显示分项
  - 其它 5 段：Markdown 渲染（`react-markdown` 或等价工具；若无，纯文本 + 换行）
  - PDF：若有 `pdf_download_url` → 下载按钮；否则 disabled 显示"尚未生成"
- 有 `artifacts_updated_at` 且 < 5 分钟 → 卡片右上角小 badge "新"

- [ ] **Step 4: 验证**

```bash
cd frontend && pnpm exec tsc --noEmit
pnpm dev     # 手动 E2E
```

**Success Criteria:**

**Automated verification:**
- [ ] `pnpm exec tsc --noEmit` 无错误

**Manual verification:**
- [ ] 抽屉可打开
- [ ] 6 个字段有值时正常展示，无值时 empty hint
- [ ] 匹配度 breakdown 4 条 progress bar 渲染
- [ ] PDF 按钮能下载

---

## Task 10 · 整体 E2E 冒烟

**Files:** none

- [ ] **Step 1: 清理环境**

```bash
# 后端：删除所有旧 Application（或用测试账号）
# 确保 pending 状态有 2-3 张卡
```

- [ ] **Step 2: 跑端到端**

1. chat 输入："请帮我研究这 3 家公司，并为每家针对性润色简历"
2. agent 升级到 PE，plan 产出按 "每张卡 x 6 步" 结构
3. PE 执行完 → chat 收到总结 message "已更新 3 张卡片：..."
4. 打开 kanban，每张 target 卡点击详情 → 抽屉显示 6 字段齐全
5. 点 PDF → 成功下载

- [ ] **Step 3: PDF 清理 smoke**

手动修改 `/tmp/resume_*.pdf` 中某个文件 mtime 到 31 天前，运行清理脚本，确认文件 + DB token 都清空。

**Success Criteria:**

**Manual verification:**
- [ ] E2E 全流程一次跑通
- [ ] PDF 清理在 DB 和文件系统两侧都生效

---

## Implementation Order Summary

```
T1 Schema → T2 PATCH endpoint → T3 纯写卡 tool →
T4 改造 resume_pdf → T5 分析 tool →
T6 PDF 清理 cron → T7 PE state + summary →
T8 Prompt 更新 → T9 前端 UI → T10 E2E
```

**依赖图：** T2 依赖 T1；T3 依赖 T1；T4 依赖 T1；T5 依赖 T1+T3 的 DB helper；T6 可并行；T7 依赖 T3/T4/T5（planner 要引用这些 tool）；T8 依赖 T7；T9 依赖 T1；T10 全部完成后。

**可并行组合：** T3/T4/T5 可分派到不同 subagent 并行（都依赖 T1，但相互独立）；T6、T9 可独立并行。

**Risks:**
- LLM 结构化输出不稳定 → 3 个分析 tool 需加 retry + JSON schema 校验
- PE state `target_application_ids` 推导策略过于简单（只取 pending）→ 后续可能需要 LLM 显式 parse；先做简化版
- PDF 清理若 cron 失败可能堆积 `/tmp` → 加启动时一次性 lazy cleanup 兜底
- `tailored_resume_text` 来源是 LLM message 而非 tool output，提取时机需明确：让 agent **显式**调 `save_tailored_resume(app_id, content=...)` 把内容抄进去，不要隐式解析上一条 message

# 追踪看板 — 设计文档

**日期：** 2026-03-28
**状态：** 已确认，待实现

---

## 背景与问题

目前应用存在两个割裂的模块：

- **今日推荐**（ListingsPanel）：展示调度任务发现的岗位，是一个只读的网格列表，没有后续动作路径。
- **ApplicationTracker**（Chat 侧边栏）：追踪用户手动录入的投递记录，与推荐列表无连接。

用户从"发现岗位"到"追踪投递"需要手动在两个模块之间搬运信息，摩擦明显。

---

## 目标

将岗位发现与投递追踪合并为一个统一的**追踪看板**，覆盖求职全流程：发现 → 评估 → 投递 → 结果。

---

## 范围

### 包含

- 将"今日推荐"Tab 重命名并重构为横向看板
- 移除 Chat 界面的 ApplicationTracker 侧边栏
- 调度任务自动在"待处理"列创建卡片
- 7 天未处理卡片自动归档
- 拖拽移动卡片跨列
- 用户可在任意列手动添加卡片

### 不包含

- 卡片详情页 / 展开查看
- 卡片评论或附件
- 看板筛选 / 搜索
- 多用户协作

---

## 看板列设计

| 列 | 状态值（DB） | 含义 |
|---|---|---|
| 待处理 | `pending` | 调度发现或手动添加，尚未决策 |
| 投递待面试 | `applied` / `interviewing` | 已投递，等待回音或面试中（前端合并显示） |
| 已完成 | `completed` | 流程结束（含 offer、入职等） |
| 不匹配 | `not_a_match` | 主动放弃，不适合当前求职目标 |

> `applied` 和 `interviewing` 在 UI 层合并为同一列，数据库保留区分，便于将来拆列扩展。

---

## 数据模型

### Application 模型变更

新增字段：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `snippet` | `str \| None` | `None` | JD 摘要片段，来自调度搜索结果 |
| `found_date` | `date \| None` | `None` | 调度发现日期，用于归档计算 |
| `source` | `str` | `"manual"` | `"scheduler"` 或 `"manual"` |
| `archived_at` | `datetime \| None` | `None` | 归档时间，非 null 表示已归档 |

状态枚举扩展：

| 新状态值 | 对应原状态 |
|---|---|
| `pending` | *(新增)* |
| `applied` | `applied`（保留） |
| `interviewing` | `interviewing`（保留） |
| `completed` | `offer`（重命名） |
| `not_a_match` | `rejected`（重命名） |

需要 DB migration 将旧状态值重命名。

### JobListing 模型处置

- 停止写入新数据
- 保留表结构（不 drop），等看板稳定后清理
- 对应 API routes 标记 deprecated

---

## 后端 API

### 新增端点

**`POST /api/v1/applications/batch`**
供调度任务批量写入 pending 卡片。按 `user_id + url` 去重，跳过已存在记录。

```json
// 请求体
{
  "listings": [
    {
      "title": "后端工程师",
      "company": "字节跳动",
      "location": "北京",
      "url": "https://...",
      "snippet": "负责核心业务后端...",
      "found_date": "2026-03-28"
    }
  ]
}
```

**`POST /api/v1/applications/archive-stale`**
将所有 `status = "pending"` 且 `found_date` 早于 7 天的记录设置 `archived_at`。由调度任务在每次写入后调用。

### 现有端点变更

- `PATCH /api/v1/applications/{id}`：接受新状态值集合（`pending` / `applied` / `interviewing` / `completed` / `not_a_match`）
- `GET /api/v1/applications`：默认过滤 `archived_at IS NULL`，支持 `?include_archived=true` 参数

### 废弃端点

- `GET /api/v1/listings`
- `POST /api/v1/listings`（内部调度调用）

---

## 调度任务变更

调度流程从写入 `JobListing` 改为写入 `Application`：

```
搜索匹配岗位
    ↓
POST /applications/batch  （去重后写入 pending 卡片）
    ↓
POST /applications/archive-stale  （归档超期 pending 卡片）
```

触发频率和入口不变。

---

## 前端变更

### 页面结构

- `app/chat/page.tsx`
  - 移除 `<ApplicationTracker />` 侧边栏
  - Chat tab 改为全宽：Session sidebar + Chat panel
  - Tab `"picks"` → `"tracker"`，label → `"追踪看板"`
  - `<ListingsPanel />` → `<KanbanBoard />`

### 新组件

| 组件 | 路径 | 职责 |
|---|---|---|
| `KanbanBoard` | `components/tracker/KanbanBoard.tsx` | 整体容器，横向四列，管理拖拽状态 |
| `KanbanColumn` | `components/tracker/KanbanColumn.tsx` | 单列：列头（名称 + 计数）、卡片列表、添加按钮 |
| `KanbanCard` | `components/tracker/KanbanCard.tsx` | 单张卡片：公司、职位、地点、snippet、来源标签、链接 |

### 拖拽

使用 `@dnd-kit/core`（新增依赖）。卡片放下时：
1. 乐观更新本地状态
2. 调用 `PATCH /applications/{id}` 更新 status
3. 失败时回滚

### 数据 Hook

`hooks/useApplications.ts` 更新：
- 新增 `moveCard(id, newStatus)` 方法
- 过滤归档卡片（`archived_at IS NULL`）

### 废弃删除

- `components/listings/ListingsPanel.tsx`
- `components/listings/ListingCard.tsx`
- `components/tracker/ApplicationTracker.tsx`
- `components/tracker/ApplicationCard.tsx`
- `hooks/useListings.ts`

---

## 卡片信息结构

```
┌─────────────────────────────┐
│ 字节跳动              [调度发现] │
│ 后端工程师                     │
│ 📍 北京 · 3月28日              │
│ ┌─────────────────────────┐ │
│ │ 负责核心业务后端服务开发，  │ │
│ │ 要求 3 年以上 Go 经验...  │ │
│ └─────────────────────────┘ │
│                    查看职位 → │
└─────────────────────────────┘
```

字段来源：`company`、`title`、`location`、`found_date`、`snippet`、`url`、`source`

---

## 归档策略

- 触发条件：`status = "pending"` 且 `found_date < today - 7 days`
- 执行方式：设置 `archived_at = now()`（软删除）
- 触发时机：每次调度任务运行后自动执行
- 前端展示：归档卡片默认不显示，列底部展示"已归档 N 张"提示文案

---

## 技术依赖

| 依赖 | 用途 | 现状 |
|---|---|---|
| `@dnd-kit/core` | 拖拽实现 | 新增 |
| SQLModel migration | 字段/状态值变更 | 需编写 |

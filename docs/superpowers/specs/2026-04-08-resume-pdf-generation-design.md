# Resume PDF Generation — Design Spec

## Overview

Resume Studio 的 PDF 生成功能：Agent 分析 JD + 用户简历，输出结构化 JSON，后端用 Jinja2 模板 + weasyprint 渲染为 A4 PDF，返回带签名的临时下载链接。

## Flow

```
用户同意定制简历
  → Agent 调用 trigger_resume_studio_skill → 获取 SKILL.md + 用户简历
  → Agent 分析 JD + 简历 → 输出结构化 JSON
  → Agent 调用 generate_resume_pdf(json_data)
  → 后端 resume_pdf_service:
      1. JSON → Jinja2 填充 HTML 模板
      2. weasyprint 渲染 HTML → PDF
      3. 存入 /tmp，生成带签名 token 的下载链接（10 分钟有效）
  → 工具返回下载链接 → Agent 呈现给用户
  → 前端检测到链接 → 渲染下载按钮
```

## Components

### 1. SKILL.md Rewrite

**File:** `.agents/skills/resume-studio/SKILL.md`

重写 SKILL.md，指导 Agent：
- 分析 JD 需求（P1/P2/P3 优先级分类）
- 将用户简历内容映射到 JD 需求
- 输出符合固定 schema 的 JSON
- 调用 `generate_resume_pdf` 工具生成 PDF

不再包含 HTML/CSS 设计指南（设计由后端模板控制）。

### 2. New Tool: generate_resume_pdf

**File:** `app/core/langgraph/tools/resume_pdf.py`

```python
@tool
async def generate_resume_pdf(resume_json: str, config: RunnableConfig) -> str:
    """Generate a tailored resume PDF from structured JSON data.
    
    Call this tool ONLY after you have produced the complete structured JSON resume.
    Pass the JSON string as resume_json.
    """
```

- 解析 JSON string → 校验 schema
- 调用 `ResumePDFService.generate(data, user_id)` 
- 返回下载 URL string

### 3. PDF Service

**File:** `app/services/resume_pdf_service.py`

职责：
- 加载 Jinja2 模板 (`app/templates/resume.html.j2`)
- JSON data → 填充模板 → HTML string
- weasyprint 渲染 HTML → PDF bytes
- 写入 `/tmp/resume_{uuid}.pdf`
- 用 JWT 签发下载 token（payload: `{"file": path, "exp": now+10min}`）
- 返回 `/api/v1/resume/download/{token}`

### 4. HTML Template

**File:** `app/templates/resume.html.j2`

基于用户提供的 `resume.html` 改造为 Jinja2 模板：
- 保留完整的 CSS 样式（双栏编辑式布局、EB Garamond + Noto Serif/Sans SC 字体）
- 数据位置替换为 `{{ }}` 变量
- 用 `{% for %}` 循环渲染 skills、education、projects、experience
- skills 中 `accent: true` 的 item 使用 `.tag.accent` class
- experience 统一使用 `sub_projects` 结构
- 移除动画（`@keyframes fadeUp`），PDF 不需要
- 保留 `@media print` 和 `@page` 样式

### 5. Download Endpoint

**File:** `app/api/v1/resume.py`

```
GET /api/v1/resume/download/{token}
```

- 无需用户认证（token 本身是凭证）
- 校验 JWT token，检查过期时间
- 读取 `/tmp` 文件，返回 `FileResponse`（`application/pdf`）
- 下载完成后异步删除文件（或由定时清理任务处理）

Rate limit: `5/minute`

### 6. Frontend Component

**File:** `frontend/components/chat/ResumeDownloadCard.tsx`

- 在 `MessageBubble` 中检测 agent 消息是否包含 PDF 下载链接（匹配 `/api/v1/resume/download/` pattern）
- 渲染为卡片样式的下载按钮，而非普通超链接
- 显示文件名、过期提示

### 7. Infrastructure Changes

**Dockerfile:**
```dockerfile
RUN apt-get install -y \
    build-essential \
    libpq-dev \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info
```

**pyproject.toml:**
```
weasyprint >= 63.0
Jinja2 >= 3.1
```

**Google Fonts:** weasyprint 需要系统安装字体或在 CSS 中使用 `@font-face` with URL。模板中的 Google Fonts link (`fonts.googleapis.com`) 在 weasyprint 中通过网络加载，需确保服务器能访问 Google Fonts（或将字体文件打包到 Docker 镜像）。

## JSON Schema

```json
{
  "name_zh": "string",
  "name_en": "string",
  "current_focus": "string",
  "contact": {
    "location": "string",
    "phone": "string",
    "email": "string",
    "github": "string (optional)",
    "twitter": "string (optional)",
    "youtube": "string (optional)",
    "telegram": "string (optional)",
    "wechat": "string (optional)",
    "linkedin": "string (optional)"
  },
  "skills": [
    {
      "domain": "string",
      "items": [
        { "name": "string", "accent": true }
      ]
    }
  ],
  "education": [
    {
      "school": "string",
      "degree": "string",
      "dates": "string"
    }
  ],
  "summary": "string",
  "projects": [
    {
      "name": "string",
      "status": "string",
      "url": "string (optional)",
      "description": "string",
      "points": ["string (supports **bold** and `code`)"]
    }
  ],
  "experience": [
    {
      "company": "string",
      "dates": "string",
      "role": "string",
      "sub_projects": [
        {
          "name": "string",
          "points": ["string"]
        }
      ]
    }
  ]
}
```

## Security

- 下载 token 使用 JWT 签名，复用 `settings.JWT_SECRET`
- Token payload: `{"file": "/tmp/resume_xxx.pdf", "exp": <timestamp>}`
- 10 分钟过期
- 文件路径校验：只允许 `/tmp/resume_` 前缀，防止路径遍历

## Not In Scope

- 多模板风格选择（只用一套模板）
- PDF 持久化存储（临时文件，过期删除）
- 前端 PDF 预览（只提供下载）
- 简历版本历史

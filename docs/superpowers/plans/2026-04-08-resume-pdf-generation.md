# Resume PDF Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent outputs structured JSON resume data, backend renders it to a styled A4 PDF via Jinja2 + weasyprint, returns a signed temporary download link.

**Architecture:** New LangGraph tool `generate_resume_pdf` accepts JSON string → `ResumePDFService` fills a Jinja2 template (based on user's resume.html) → weasyprint renders PDF → JWT-signed download URL returned to agent → frontend renders download card.

**Tech Stack:** weasyprint, Jinja2, python-jose (existing), FastAPI FileResponse

**Spec:** `docs/superpowers/specs/2026-04-08-resume-pdf-generation-design.md`

**Reference template:** `/Users/young/Downloads/repos/cv/resume.html`

---

### Task 1: Add Dependencies

**Files:**
- Modify: `pyproject.toml:7-42`
- Modify: `Dockerfile:17-23`

- [ ] **Step 1: Add Python dependencies to pyproject.toml**

Add `weasyprint` and `Jinja2` to the dependencies list in `pyproject.toml`:

```toml
    "apscheduler>=3.11.2",
    "weasyprint>=63.0",
    "Jinja2>=3.1",
```

- [ ] **Step 2: Add weasyprint system dependencies to Dockerfile**

Replace the `apt-get install` block in `Dockerfile` (lines 18-23):

```dockerfile
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    && pip install --upgrade pip \
    && pip install uv \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Install locally**

Run: `uv sync`

Expected: weasyprint and Jinja2 install successfully.

- [ ] **Step 4: Verify weasyprint works**

Run: `uv run python -c "import weasyprint; print(weasyprint.__version__)"`

Expected: Version number printed (e.g. `63.1`).

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock Dockerfile
git commit -m "build: add weasyprint and Jinja2 dependencies for resume PDF generation"
```

---

### Task 2: Create Resume Pydantic Schema

**Files:**
- Create: `app/schemas/resume.py`
- Modify: `app/schemas/__init__.py`

- [ ] **Step 1: Create app/schemas/resume.py**

```python
"""Pydantic models for structured resume data."""

from typing import Optional

from pydantic import BaseModel


class ContactInfo(BaseModel):
    """Contact information for the resume sidebar."""

    location: str
    phone: str
    email: str
    github: Optional[str] = None
    twitter: Optional[str] = None
    youtube: Optional[str] = None
    telegram: Optional[str] = None
    wechat: Optional[str] = None
    linkedin: Optional[str] = None


class SkillItem(BaseModel):
    """A single skill tag."""

    name: str
    accent: bool = False


class SkillGroup(BaseModel):
    """A group of skills under a domain label."""

    domain: str
    items: list[SkillItem]


class Education(BaseModel):
    """Education entry."""

    school: str
    degree: str
    dates: str


class Project(BaseModel):
    """Personal project entry."""

    name: str
    status: str
    url: Optional[str] = None
    description: str
    points: list[str]


class SubProject(BaseModel):
    """Sub-project within a work experience entry."""

    name: str
    points: list[str]


class Experience(BaseModel):
    """Work experience entry with sub-projects."""

    company: str
    dates: str
    role: str
    sub_projects: list[SubProject]


class ResumeData(BaseModel):
    """Complete structured resume data for PDF generation."""

    name_zh: str
    name_en: str
    current_focus: str
    contact: ContactInfo
    skills: list[SkillGroup]
    education: list[Education]
    summary: str
    projects: list[Project]
    experience: list[Experience]
```

- [ ] **Step 2: Export from app/schemas/__init__.py**

Add to the imports and `__all__` in `app/schemas/__init__.py`:

```python
from app.schemas.resume import ResumeData
```

Add `"ResumeData"` to the `__all__` list.

- [ ] **Step 3: Verify**

Run: `uv run python -c "from app.schemas.resume import ResumeData; print(ResumeData.model_json_schema().keys())"`

Expected: Schema keys printed.

- [ ] **Step 4: Commit**

```bash
git add app/schemas/resume.py app/schemas/__init__.py
git commit -m "feat: add ResumeData Pydantic schema for structured resume JSON"
```

---

### Task 3: Create Jinja2 HTML Template

**Files:**
- Create: `app/templates/resume.html.j2`

This template is derived from the reference `/Users/young/Downloads/repos/cv/resume.html`. It keeps all CSS styles but replaces hardcoded data with Jinja2 variables. Animations are removed (not needed for PDF).

- [ ] **Step 1: Create the directory**

Run: `mkdir -p app/templates`

- [ ] **Step 2: Create app/templates/resume.html.j2**

```html
<!DOCTYPE html>
<html lang="zh-CN">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ resume.name_zh }} — 简历</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;600;700&family=Noto+Sans+SC:wght@300;400;500&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap"
    rel="stylesheet" />
  <style>
    :root {
      --paper: #FAFAF7;
      --ink: #1C1C1A;
      --ink-light: #5A5A55;
      --ink-muted: #8C8C87;
      --accent: #B85C3A;
      --accent-light: #E8C4B5;
      --rule: #D8D8D0;
      --sidebar-bg: #F2F1EC;
      --tag-bg: #EAE9E3;
      --serif: 'EB Garamond', 'Noto Serif SC', serif;
      --sans: 'Noto Sans SC', sans-serif;
      --page-w: 210mm;
      --page-h: 297mm;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html { background: #E8E7E2; min-height: 100%; display: flex; justify-content: center; align-items: flex-start; padding: 32px 16px; }

    body {
      width: var(--page-w); min-height: var(--page-h);
      background: var(--paper); color: var(--ink);
      font-family: var(--sans); font-size: 8.2pt; line-height: 1.65;
      position: relative; overflow: hidden;
    }

    .page { display: grid; grid-template-columns: 62mm 1fr; grid-template-rows: auto 1fr; min-height: var(--page-h); }

    /* ─── HEADER ─── */
    .header {
      grid-column: 1 / -1; display: grid; grid-template-columns: 62mm 1fr;
      border-bottom: 1.5px solid var(--ink); position: relative;
    }
    .header::after { content: ''; position: absolute; bottom: -4px; left: 0; width: 100%; height: 1px; background: var(--rule); }
    .header-identity { padding: 9mm 6mm 7mm 8mm; background: var(--sidebar-bg); border-right: 1.5px solid var(--ink); }
    .name-en { font-family: var(--serif); font-size: 9pt; font-weight: 400; font-style: italic; color: var(--ink-light); letter-spacing: 0.04em; margin-bottom: 2px; }
    .name-zh { font-family: 'Noto Serif SC', serif; font-size: 22pt; font-weight: 700; color: var(--ink); letter-spacing: 0.06em; line-height: 1; }
    .name-accent { display: inline-block; width: 5px; height: 5px; background: var(--accent); border-radius: 50%; margin-left: 3px; vertical-align: middle; margin-bottom: 4px; }
    .header-tagline { padding: 9mm 8mm 7mm 7mm; display: flex; flex-direction: column; justify-content: flex-end; }
    .role-label { font-family: var(--serif); font-size: 7pt; font-style: italic; color: var(--ink-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
    .role-title { font-family: 'Noto Serif SC', serif; font-size: 13pt; font-weight: 600; color: var(--ink); letter-spacing: 0.02em; line-height: 1.2; }

    /* ─── SIDEBAR ─── */
    .sidebar { grid-column: 1; background: var(--sidebar-bg); border-right: 1.5px solid var(--ink); padding: 5mm 5mm 6mm 7mm; }

    /* ─── MAIN ─── */
    .main { grid-column: 2; padding: 5mm 8mm 6mm 7mm; }

    /* ─── SECTION ─── */
    .section { margin-bottom: 3.5mm; }
    .section-title { font-family: var(--serif); font-size: 7pt; font-weight: 600; font-style: italic; color: var(--accent); text-transform: uppercase; letter-spacing: 0.14em; border-bottom: 1px solid var(--accent-light); padding-bottom: 2px; margin-bottom: 2.5mm; }

    /* ─── CONTACT ─── */
    .contact-list { list-style: none; }
    .contact-list li { display: flex; align-items: flex-start; gap: 5px; margin-bottom: 2.5px; font-size: 7.4pt; color: var(--ink-light); line-height: 1.5; }
    .contact-list .label { font-family: var(--serif); font-style: italic; color: var(--ink-muted); min-width: 13mm; font-size: 7pt; flex-shrink: 0; }
    .contact-list a { color: var(--ink-light); text-decoration: none; word-break: break-all; }

    /* ─── SKILLS ─── */
    .skill-row { margin-bottom: 3mm; }
    .skill-domain { font-family: 'Noto Serif SC', serif; font-size: 7.4pt; font-weight: 600; color: var(--ink); margin-bottom: 1.5mm; }
    .skill-tags { display: flex; flex-wrap: wrap; gap: 2px; }
    .tag { background: var(--tag-bg); color: var(--ink-light); font-size: 6.4pt; padding: 1.5px 5px; border-radius: 2px; letter-spacing: 0.02em; border: 0.5px solid var(--rule); font-family: var(--sans); font-weight: 400; }
    .tag.accent { background: var(--accent-light); color: #7A3A22; border-color: #D4967E; }

    /* ─── EDUCATION ─── */
    .edu-item { margin-bottom: 3mm; }
    .edu-school { font-family: 'Noto Serif SC', serif; font-size: 7.6pt; font-weight: 600; color: var(--ink); margin-bottom: 1px; }
    .edu-meta { font-size: 7pt; color: var(--ink-muted); line-height: 1.4; }
    .edu-degree { color: var(--ink-light); font-style: normal; }

    /* ─── SUMMARY ─── */
    .summary-text { font-family: var(--serif); font-size: 8.6pt; line-height: 1.65; color: var(--ink); font-weight: 400; text-align: justify; hyphens: auto; }

    /* ─── PROJECTS ─── */
    .project-item { margin-bottom: 3mm; padding-left: 3mm; border-left: 1.5px solid var(--accent-light); position: relative; }
    .project-item::before { content: ''; position: absolute; left: -3px; top: 4px; width: 5px; height: 5px; background: var(--accent); border-radius: 50%; }
    .project-header { display: flex; align-items: baseline; gap: 5px; margin-bottom: 1.5mm; flex-wrap: wrap; }
    .project-name { font-family: 'Noto Serif SC', serif; font-size: 8.4pt; font-weight: 700; color: var(--ink); }
    .project-name a { color: inherit; text-decoration: none; }
    .project-status { font-family: var(--serif); font-style: italic; font-size: 7pt; color: var(--ink-muted); }
    .project-url { font-size: 7pt; margin-bottom: 1.5mm; }
    .project-url a { color: var(--accent); text-decoration: none; font-family: var(--sans); letter-spacing: 0.01em; }
    .project-desc { font-size: 7.8pt; color: var(--ink-light); line-height: 1.6; margin-bottom: 1.5mm; }
    .project-points { list-style: none; }
    .project-points li { font-size: 7.6pt; color: var(--ink-light); line-height: 1.6; padding-left: 8px; position: relative; margin-bottom: 1px; }
    .project-points li::before { content: '—'; position: absolute; left: 0; color: var(--accent-light); font-size: 7pt; }
    .project-points strong { color: var(--ink); font-weight: 500; }
    .project-points code { font-family: 'Courier New', Courier, monospace; font-size: 6.6pt; background: var(--tag-bg); color: var(--ink-light); padding: 0 3px; border-radius: 2px; border: 0.5px solid var(--rule); }

    /* ─── WORK EXPERIENCE ─── */
    .job-item { margin-bottom: 3mm; }
    .job-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1mm; }
    .company-name { font-family: 'Noto Serif SC', serif; font-size: 9pt; font-weight: 700; color: var(--ink); }
    .job-period { font-family: var(--serif); font-style: italic; font-size: 7pt; color: var(--ink-muted); white-space: nowrap; }
    .job-role { font-size: 7.4pt; color: var(--accent); font-weight: 500; margin-bottom: 1.5mm; letter-spacing: 0.02em; }
    .sub-project { margin-bottom: 2mm; }
    .sub-project-name { font-family: 'Noto Serif SC', serif; font-size: 7.8pt; font-weight: 600; color: var(--ink); margin-bottom: 1mm; display: flex; align-items: center; gap: 5px; }
    .sub-project-name::before { content: ''; display: inline-block; width: 10px; height: 1px; background: var(--accent); flex-shrink: 0; }
    .sub-points { list-style: none; padding-left: 15px; }
    .sub-points li { font-size: 7.6pt; color: var(--ink-light); line-height: 1.5; padding-left: 8px; position: relative; margin-bottom: 0; }
    .sub-points li::before { content: '·'; position: absolute; left: 0; color: var(--accent); font-size: 9pt; line-height: 1.4; }

    /* ─── FOOTER ─── */
    .page-footer { grid-column: 1 / -1; border-top: 1px solid var(--rule); display: flex; justify-content: space-between; align-items: center; padding: 2mm 8mm; }
    .footer-note { font-family: var(--serif); font-style: italic; font-size: 6.5pt; color: var(--ink-muted); }
    .footer-date { font-size: 6.5pt; color: var(--ink-muted); }

    @media print {
      html { background: none; padding: 0; }
      body { box-shadow: none; width: 210mm; }
      @page { size: A4 portrait; margin: 0; }
    }
  </style>
</head>

<body>
  <div class="page">

    <!-- HEADER -->
    <header class="header">
      <div class="header-identity">
        <div class="name-en">{{ resume.name_en }}</div>
        <div class="name-zh">{{ resume.name_zh }}<span class="name-accent"></span></div>
      </div>
      <div class="header-tagline">
        <div class="role-label">Current Focus</div>
        <div class="role-title">{{ resume.current_focus }}</div>
      </div>
    </header>

    <!-- SIDEBAR -->
    <aside class="sidebar">

      <!-- Contact -->
      <section class="section">
        <div class="section-title">联系方式</div>
        <ul class="contact-list">
          <li><span class="label">所在地</span><span>{{ resume.contact.location }}</span></li>
          <li><span class="label">电话</span><span>{{ resume.contact.phone }}</span></li>
          <li><span class="label">邮箱</span><a href="mailto:{{ resume.contact.email }}">{{ resume.contact.email }}</a></li>
          {% if resume.contact.github %}
          <li><span class="label">GitHub</span><a href="https://github.com/{{ resume.contact.github }}">{{ resume.contact.github }}</a></li>
          {% endif %}
          {% if resume.contact.twitter %}
          <li><span class="label">Twitter/X</span><a href="https://x.com/{{ resume.contact.twitter }}">{{ resume.contact.twitter }}</a></li>
          {% endif %}
          {% if resume.contact.youtube %}
          <li><span class="label">Youtube</span><a href="https://www.youtube.com/@{{ resume.contact.youtube }}">{{ resume.contact.youtube }}</a></li>
          {% endif %}
          {% if resume.contact.telegram %}
          <li><span class="label">Telegram</span><span>{{ resume.contact.telegram }}</span></li>
          {% endif %}
          {% if resume.contact.wechat %}
          <li><span class="label">Wechat</span><span>{{ resume.contact.wechat }}</span></li>
          {% endif %}
          {% if resume.contact.linkedin %}
          <li><span class="label">LinkedIn</span><a href="https://linkedin.com/in/{{ resume.contact.linkedin }}">{{ resume.contact.linkedin }}</a></li>
          {% endif %}
        </ul>
      </section>

      <!-- Skills -->
      <section class="section">
        <div class="section-title">核心技能</div>
        {% for group in resume.skills %}
        <div class="skill-row">
          <div class="skill-domain">{{ group.domain }}</div>
          <div class="skill-tags">
            {% for item in group.items %}
            <span class="tag{% if item.accent %} accent{% endif %}">{{ item.name }}</span>
            {% endfor %}
          </div>
        </div>
        {% endfor %}
      </section>

      <!-- Education -->
      <section class="section">
        <div class="section-title">教育背景</div>
        {% for edu in resume.education %}
        <div class="edu-item">
          <div class="edu-school">{{ edu.school }}</div>
          <div class="edu-meta">
            <span class="edu-degree">{{ edu.degree }}</span><br />
            {{ edu.dates }}
          </div>
        </div>
        {% endfor %}
      </section>

    </aside>

    <!-- MAIN CONTENT -->
    <main class="main">

      <!-- Summary -->
      <section class="section">
        <div class="section-title">个人总结</div>
        <p class="summary-text">{{ resume.summary }}</p>
      </section>

      <!-- Projects -->
      {% if resume.projects %}
      <section class="section">
        <div class="section-title">个人项目</div>
        {% for proj in resume.projects %}
        <div class="project-item">
          <div class="project-header">
            <div class="project-name">{% if proj.url %}<a href="{{ proj.url }}">{{ proj.name }}</a>{% else %}{{ proj.name }}{% endif %}</div>
            <div class="project-status">{{ proj.status }}</div>
          </div>
          {% if proj.url %}
          <div class="project-url"><a href="{{ proj.url }}">{{ proj.url }}</a></div>
          {% endif %}
          <p class="project-desc">{{ proj.description }}</p>
          <ul class="project-points">
            {% for point in proj.points %}
            <li>{{ point | bold_code }}</li>
            {% endfor %}
          </ul>
        </div>
        {% endfor %}
      </section>
      {% endif %}

      <!-- Work Experience -->
      <section class="section">
        <div class="section-title">工作经历</div>
        {% for job in resume.experience %}
        <div class="job-item">
          <div class="job-header">
            <div class="company-name">{{ job.company }}</div>
            <div class="job-period">{{ job.dates }}</div>
          </div>
          <div class="job-role">{{ job.role }}</div>
          {% for sp in job.sub_projects %}
          <div class="sub-project">
            <div class="sub-project-name">{{ sp.name }}</div>
            <ul class="sub-points">
              {% for point in sp.points %}
              <li>{{ point | bold_code }}</li>
              {% endfor %}
            </ul>
          </div>
          {% endfor %}
        </div>
        {% endfor %}
      </section>

    </main>

    <!-- FOOTER -->
    <div class="page-footer">
      <div class="footer-note">Generated by Resume Studio</div>
      <div class="footer-date">{{ generated_date }}</div>
    </div>

  </div>
</body>

</html>
```

- [ ] **Step 3: Commit**

```bash
git add app/templates/resume.html.j2
git commit -m "feat: add Jinja2 resume template based on reference design"
```

---

### Task 4: Create PDF Service

**Files:**
- Create: `app/services/resume_pdf_service.py`

- [ ] **Step 1: Create app/services/resume_pdf_service.py**

```python
"""Service for generating resume PDFs from structured data."""

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import weasyprint
from jinja2 import Environment, FileSystemLoader
from jose import jwt
from markupsafe import Markup

from app.core.config import settings
from app.core.logging import logger
from app.schemas.resume import ResumeData


def _bold_code_filter(text: str) -> Markup:
    """Convert **bold** and `code` markdown to HTML tags.

    Used as a Jinja2 filter for resume bullet points.
    """
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
    return Markup(text)


class ResumePDFService:
    """Renders structured resume data into a PDF via Jinja2 + weasyprint."""

    def __init__(self):
        """Initialize the Jinja2 environment with the templates directory."""
        template_dir = Path(__file__).parent.parent / "templates"
        self._env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=True,
        )
        self._env.filters["bold_code"] = _bold_code_filter

    def generate(self, data: ResumeData) -> str:
        """Generate a PDF and return a signed download URL.

        Args:
            data: Validated resume data.

        Returns:
            Download URL path (e.g. /api/v1/resume/download/{token}).
        """
        template = self._env.get_template("resume.html.j2")
        html = template.render(
            resume=data,
            generated_date=datetime.now().strftime("%Y.%m"),
        )

        pdf_bytes = weasyprint.HTML(string=html).write_pdf()

        filename = f"resume_{uuid.uuid4().hex[:12]}.pdf"
        filepath = Path("/tmp") / filename
        filepath.write_bytes(pdf_bytes)

        token_payload = {
            "file": str(filepath),
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        }
        token = jwt.encode(token_payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

        logger.info(
            "resume_pdf_generated",
            filepath=str(filepath),
            size_bytes=len(pdf_bytes),
        )

        return f"/api/v1/resume/download/{token}"
```

- [ ] **Step 2: Verify the service can render a PDF**

Run:

```bash
uv run python -c "
from app.schemas.resume import ResumeData
from app.services.resume_pdf_service import ResumePDFService

data = ResumeData(
    name_zh='测试', name_en='Test', current_focus='Engineer',
    contact={'location': 'Beijing', 'phone': '123', 'email': 'a@b.com'},
    skills=[{'domain': 'AI', 'items': [{'name': 'Python', 'accent': True}]}],
    education=[{'school': 'MIT', 'degree': 'CS', 'dates': '2020'}],
    summary='Test summary.',
    projects=[{'name': 'P1', 'status': 'done', 'description': 'desc', 'points': ['**bold** and \`code\`']}],
    experience=[{'company': 'Co', 'dates': '2020-2024', 'role': 'Eng', 'sub_projects': [{'name': 'SP1', 'points': ['did stuff']}]}],
)
svc = ResumePDFService()
url = svc.generate(data)
print(f'Download URL: {url}')
"
```

Expected: A download URL printed. A PDF file created in `/tmp/resume_*.pdf`.

- [ ] **Step 3: Commit**

```bash
git add app/services/resume_pdf_service.py
git commit -m "feat: add ResumePDFService for HTML-to-PDF rendering"
```

---

### Task 5: Create Download API Endpoint

**Files:**
- Create: `app/api/v1/resume.py`
- Modify: `app/api/v1/api.py`

- [ ] **Step 1: Create app/api/v1/resume.py**

```python
"""Resume PDF download endpoint."""

import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from jose import JWTError, jwt

from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger

router = APIRouter()


@router.get("/download/{token}")
@limiter.limit("5/minute")
async def download_resume_pdf(request: Request, token: str):
    """Download a generated resume PDF using a signed token.

    The token is self-contained (JWT) and expires after 10 minutes.
    No user authentication required — the token itself is the credential.
    """
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        logger.warning("resume_pdf_download_invalid_token")
        raise HTTPException(status_code=401, detail="Invalid or expired download link")

    filepath = payload.get("file", "")
    if not filepath.startswith("/tmp/resume_") or ".." in filepath:
        logger.warning("resume_pdf_download_path_traversal", filepath=filepath)
        raise HTTPException(status_code=403, detail="Invalid file path")

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found or expired")

    return FileResponse(
        filepath,
        media_type="application/pdf",
        filename="resume.pdf",
    )
```

- [ ] **Step 2: Wire the router into app/api/v1/api.py**

Add the import and `include_router` call:

```python
from app.api.v1.resume import router as resume_router
```

Add after the search router line:

```python
api_router.include_router(resume_router, prefix="/resume", tags=["resume"])
```

- [ ] **Step 3: Commit**

```bash
git add app/api/v1/resume.py app/api/v1/api.py
git commit -m "feat: add resume PDF download endpoint with JWT token verification"
```

---

### Task 6: Create LangGraph Tool + Register

**Files:**
- Create: `app/core/langgraph/tools/resume_pdf.py`
- Modify: `app/core/langgraph/tools/__init__.py`

- [ ] **Step 1: Create app/core/langgraph/tools/resume_pdf.py**

```python
"""LangGraph tool for generating tailored resume PDFs."""

import json

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool

from app.core.logging import logger
from app.schemas.resume import ResumeData
from app.services.resume_pdf_service import ResumePDFService

_pdf_service = ResumePDFService()


@tool
async def generate_resume_pdf(resume_json: str, config: RunnableConfig) -> str:
    """Generate a tailored resume PDF from structured JSON data.

    Call this tool ONLY after you have produced the complete structured JSON resume
    following the schema specified in the Resume Studio skill instructions.
    Pass the full JSON string as resume_json.

    Args:
        resume_json: A JSON string conforming to the resume data schema.

    Returns:
        A message containing the download URL for the generated PDF.
    """
    try:
        data = ResumeData.model_validate_json(resume_json)
    except Exception as e:
        logger.warning("resume_pdf_invalid_json", error=str(e))
        return f"Error: Invalid resume JSON. Please check the schema and try again. Details: {e}"

    try:
        download_url = _pdf_service.generate(data)
    except Exception as e:
        logger.exception("resume_pdf_generation_failed")
        return f"Error: Failed to generate PDF. Details: {e}"

    user_id = config.get("configurable", {}).get("user_id")
    logger.info("resume_pdf_tool_success", user_id=user_id)

    return (
        f"Resume PDF generated successfully!\n"
        f"Download link: {download_url}\n"
        f"This link expires in 10 minutes."
    )
```

- [ ] **Step 2: Register the tool in app/core/langgraph/tools/__init__.py**

Add the import:

```python
from .resume_pdf import generate_resume_pdf
```

Add `generate_resume_pdf` to the `tools` list:

```python
tools: list[BaseTool] = [
    job_search_tool,
    company_research_tool,
    cover_letter_tool,
    application_tracker_tool,
    job_preferences_tool,
    duckduckgo_search_tool,
    trigger_resume_studio_skill,
    generate_resume_pdf,
]
```

- [ ] **Step 3: Verify tool loads**

Run: `uv run python -c "from app.core.langgraph.tools import tools; print([t.name for t in tools])"`

Expected: `generate_resume_pdf` appears in the list.

- [ ] **Step 4: Commit**

```bash
git add app/core/langgraph/tools/resume_pdf.py app/core/langgraph/tools/__init__.py
git commit -m "feat: add generate_resume_pdf LangGraph tool"
```

---

### Task 7: Rewrite SKILL.md

**Files:**
- Modify: `.agents/skills/resume-studio/SKILL.md`

The SKILL.md must be rewritten to:
1. Instruct the agent to analyze JD + resume and produce structured JSON
2. Specify the exact JSON schema
3. Tell the agent to call `generate_resume_pdf` with the JSON
4. Remove all HTML/CSS design guidelines (backend handles design)

- [ ] **Step 1: Replace .agents/skills/resume-studio/SKILL.md with new content**

```markdown
# Resume Studio — Content Tailoring Skill

You are now a Resume Expert. Your job is to tailor the user's resume for a specific job description, then generate a PDF.

## Workflow

1. **Analyze the JD** — Classify requirements by priority (P1 must-have, P2 preferred, P3 bonus).
2. **Map experience** — Match the user's resume content to JD requirements. Identify strengths to highlight and gaps to de-emphasize.
3. **Produce tailored JSON** — Output a complete JSON object matching the schema below. Improve the content: tighten bullets, use action-result phrasing, inject target-role keywords naturally, quantify impact where truthfully possible.
4. **Generate PDF** — Call `generate_resume_pdf` with the JSON string.
5. **Present the link** — Share the download link with the user and summarize what was changed and why.

## Content Rules

- Never fabricate experience, titles, metrics, or timelines.
- Use exact JD terminology where it truthfully matches the user's experience.
- Write bullets as: [Action] + [What] + [How] + [Result or value].
- Keep summary to 2-4 sentences.
- Group skills by domain. Put JD-required skills first. Mark core skills with `"accent": true`.
- Prefer one page. Omit or compress low-signal older experience.
- Experience entries use `sub_projects` — each sub-project has a name and bullet points.

## JSON Schema

You MUST output a JSON object with exactly this structure. All fields are required unless marked optional.

```json
{
  "name_zh": "中文名",
  "name_en": "English Name",
  "current_focus": "当前方向（如 AI Agent 开发者）",
  "contact": {
    "location": "城市",
    "phone": "手机号",
    "email": "邮箱",
    "github": "(optional) GitHub username",
    "twitter": "(optional) Twitter handle",
    "youtube": "(optional) YouTube channel",
    "telegram": "(optional) Telegram username",
    "wechat": "(optional) WeChat ID",
    "linkedin": "(optional) LinkedIn slug"
  },
  "skills": [
    {
      "domain": "技能分类名",
      "items": [
        { "name": "技能名", "accent": true }
      ]
    }
  ],
  "education": [
    {
      "school": "学校名",
      "degree": "学位 · 专业",
      "dates": "起止时间"
    }
  ],
  "summary": "2-4句专业摘要，对齐目标岗位",
  "projects": [
    {
      "name": "项目名",
      "status": "一句话描述 · 状态",
      "url": "(optional) 项目链接",
      "description": "项目简介",
      "points": [
        "**加粗关键词：**具体描述，支持 `code` 标记"
      ]
    }
  ],
  "experience": [
    {
      "company": "公司名",
      "dates": "起止时间 · 城市",
      "role": "职位",
      "sub_projects": [
        {
          "name": "子项目名称",
          "points": ["具体工作内容和成果"]
        }
      ]
    }
  ]
}
```

## Important

- Output the JSON as a code block so it is clean and parseable.
- After producing the JSON, immediately call `generate_resume_pdf` with the JSON string.
- Do NOT output HTML, CSS, or markdown resume — only JSON + tool call.
- The `current_focus` field should be adapted to match the target role from the JD.
- Skill items with `"accent": true` will be visually highlighted — use this for JD-critical skills.
```

- [ ] **Step 2: Commit**

```bash
git add .agents/skills/resume-studio/SKILL.md
git commit -m "feat: rewrite SKILL.md for JSON output + generate_resume_pdf tool call"
```

---

### Task 8: Frontend ResumeDownloadCard

**Files:**
- Create: `frontend/components/chat/ResumeDownloadCard.tsx`
- Modify: `frontend/components/chat/MessageBubble.tsx:1-6,29-34`

- [ ] **Step 1: Create frontend/components/chat/ResumeDownloadCard.tsx**

```tsx
"use client"

import { useState } from "react"
import type { ToolCallEntry } from "@/lib/types"
import { getSessionToken } from "@/lib/auth"

interface Props {
  entry: ToolCallEntry
}

function parseDownloadUrl(entry: ToolCallEntry): string | null {
  const text = entry.resultContent ?? ""
  const match = text.match(/\/api\/v1\/resume\/download\/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/)
  return match ? match[0] : null
}

export function ResumeDownloadCard({ entry }: Props) {
  const downloadUrl = parseDownloadUrl(entry)
  const [status, setStatus] = useState<"idle" | "downloading" | "done">("idle")

  if (!downloadUrl) {
    return (
      <div className="glass rounded-xl my-1 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
          <span className="w-[7px] h-[7px] rounded-full bg-red-500 flex-shrink-0" />
          <span className="font-body font-semibold">Resume PDF</span>
        </div>
        <p className="mt-2 text-xs font-body text-[var(--text-3)] italic">生成失败，请重试</p>
      </div>
    )
  }

  const handleDownload = async () => {
    setStatus("downloading")
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? ""
      const res = await fetch(`${baseUrl}${downloadUrl}`)
      if (!res.ok) throw new Error("Download failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "resume.pdf"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setStatus("done")
    } catch {
      setStatus("idle")
    }
  }

  return (
    <div className="glass rounded-xl my-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" />
          <span className="font-body font-semibold text-sm text-[var(--text-2)]">Resume PDF</span>
          <span className="font-mono text-xs text-[var(--text-3)]">10 分钟内有效</span>
        </div>
        {status === "done" ? (
          <span className="font-body text-xs font-semibold text-green-600">已下载 ✓</span>
        ) : (
          <button
            onClick={handleDownload}
            disabled={status === "downloading"}
            className={`font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              status === "downloading"
                ? "text-[var(--text-3)] bg-black/[0.03] cursor-not-allowed"
                : "text-[var(--accent-fg)] bg-[var(--accent)] hover:opacity-90 cursor-pointer"
            }`}
          >
            {status === "downloading" ? "下载中..." : "下载 PDF"}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Integrate into MessageBubble.tsx**

Add import at top of `frontend/components/chat/MessageBubble.tsx`:

```typescript
import { ResumeDownloadCard } from "./ResumeDownloadCard"
```

Replace the tool call rendering block (lines 29-34) with:

```tsx
{message.toolCalls.map((tc) =>
  tc.toolName === "job_search_tool" && tc.status === "done" ? (
    <JobSearchResultCard key={tc.toolCallId} entry={tc} />
  ) : tc.toolName === "generate_resume_pdf" && tc.status === "done" ? (
    <ResumeDownloadCard key={tc.toolCallId} entry={tc} />
  ) : (
    <ToolCallCard key={tc.toolCallId} entry={tc} isStreaming={isStreaming} />
  ),
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/chat/ResumeDownloadCard.tsx frontend/components/chat/MessageBubble.tsx
git commit -m "feat: add ResumeDownloadCard component for PDF download in chat"
```

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Restart backend**

Run: Kill existing process on port 8000, then `make dev`.

- [ ] **Step 2: Test the full flow**

1. Open the app in browser, log in.
2. Go to **Settings → Resume** tab, paste resume text, save.
3. Start a **new chat session**.
4. Send: "针对资深智能体工程师 - 嘉银科技的JD，为我润色简历"
5. Agent should:
   - Call `trigger_resume_studio_skill` (loads skill + resume)
   - Produce structured JSON
   - Call `generate_resume_pdf` (generates PDF)
   - Return download link
6. Frontend should render `ResumeDownloadCard` with download button.
7. Click download — PDF should download and open correctly with the styled layout.

- [ ] **Step 3: Verify PDF quality**

Open the downloaded PDF and check:
- A4 format, single page
- Dual-column layout with sidebar
- Fonts render correctly (EB Garamond, Noto Serif/Sans SC)
- Skills with `accent: true` have highlighted tags
- All sections populated from JSON data

- [ ] **Step 4: Commit the prepare_messages fix from earlier (if not yet committed)**

```bash
git add app/utils/graph.py
git commit -m "fix: preserve current turn messages from token-budget trimming"
```

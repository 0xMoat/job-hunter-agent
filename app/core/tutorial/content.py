"""Locale-aware tutorial content loaders."""

import json
from pathlib import Path
from typing import Literal

Locale = Literal["zh-CN", "en"]
TUTORIAL_SOURCE = "tutorial"

_DIR = Path(__file__).parent


def get_default_resume(locale: Locale) -> str:
    """Return the default resume plain text for a given locale."""
    filename = "default_resume_zh.md" if locale == "zh-CN" else "default_resume_en.md"
    return (_DIR / filename).read_text(encoding="utf-8")


def get_tutorial_session_name(locale: Locale) -> str:
    """Return the sidebar display name for the tutorial session."""
    return "📘 使用引导教学" if locale == "zh-CN" else "📘 Tutorial"


def normalize_locale(raw: str | None) -> Locale:
    """Normalize the value from the client's Accept-Language or form payload."""
    if raw and raw.lower().startswith("zh"):
        return "zh-CN"
    return "en"


def get_mock_application_payload(locale: Locale) -> dict:
    """Build a mock kanban application pre-filled with artifacts.

    Used so the tutorial session's 'jump to top-scored card' CTA has a real
    Application row to open. All fields are unmistakably marked as demo data.
    """
    if locale == "zh-CN":
        company = "示例科技（演示公司）"
        title = "【演示】AI 工程师 / Agent 方向"
        snippet = "【教学样例】这是引导教学用的演示职位，非真实岗位。展示简历定制与公司调研能力。"
        research = {
            "summary": "【教学样例】示例科技是用于演示的虚构公司。产品：AI Agent 平台。",
            "culture": "教学用演示数据",
            "funding": "教学用演示数据",
            "size": "50-200 人（演示）",
        }
        tailored_resume = (
            "# 【演示】为 AI 工程师（Agent 方向）定制的简历\n\n"
            "> 这是教学模式下的示例定制简历，实际投递时会基于你真实的简历自动生成。\n\n"
            "## 亮点\n- 5 年 LangGraph 经验（示例）\n- 主导 Agent 产品（示例）\n"
        )
        gap = "【教学样例】技能差距分析演示：建议补充 LangGraph 进阶、RAG 工程、Agent 评测。"
        match_breakdown = {
            "skills": {"score": 92, "reason": "【演示】LangGraph 与 Python 高度匹配"},
            "experience": {"score": 95, "reason": "【演示】5 年经验超出 JD 要求"},
            "domain": {"score": 96, "reason": "【演示】AI Agent 方向完全对口"},
            "soft": {"score": 90, "reason": "【演示】沟通协作符合团队文化"},
        }
        interview_qs = [
            {"question": "【演示】请介绍一个你使用 LangGraph 构建的项目。", "focus": "技术深度"},
            {"question": "【演示】如何设计 Agent 的工具调用失败重试？", "focus": "架构能力"},
            {"question": "【演示】怎么评估 RAG 系统的召回质量？", "focus": "评测方法"},
        ]
    else:
        company = "Demo Corp (Tutorial Mock)"
        title = "[DEMO] AI Engineer / Agent Focus"
        snippet = "[Sample] Tutorial-only demo listing. Showcases resume tailoring + research."
        research = {
            "summary": "[Sample] Demo Corp is a fictional company used for the tutorial.",
            "culture": "tutorial demo data",
            "funding": "tutorial demo data",
            "size": "50-200 (demo)",
        }
        tailored_resume = (
            "# [DEMO] Tailored Resume for AI Engineer (Agent focus)\n\n"
            "> This is a sample tailored resume shown in the tutorial.\n\n"
            "## Highlights\n- 5 yrs LangGraph (sample)\n- Led Agent product (sample)\n"
        )
        gap = "[Sample] Gap analysis demo: deepen LangGraph, RAG engineering, agent evaluation."
        match_breakdown = {
            "skills": {"score": 92, "reason": "[Demo] Strong LangGraph + Python match"},
            "experience": {"score": 95, "reason": "[Demo] 5 yrs exceeds JD requirement"},
            "domain": {"score": 96, "reason": "[Demo] Agent focus perfectly aligned"},
            "soft": {"score": 90, "reason": "[Demo] Collaboration fits team culture"},
        }
        interview_qs = [
            {"question": "[Demo] Walk me through a project you built with LangGraph.", "focus": "technical depth"},
            {"question": "[Demo] How would you design retries for failed tool calls?", "focus": "architecture"},
            {"question": "[Demo] How do you evaluate RAG recall quality?", "focus": "evaluation"},
        ]
    return {
        "company": company,
        "title": title,
        "url": "https://example.com/demo/job/001",
        "snippet": snippet,
        "source": TUTORIAL_SOURCE,
        "status": "pending",
        "match_score": 94,
        "company_research_json": json.dumps(research, ensure_ascii=False),
        "tailored_resume_text": tailored_resume,
        "match_breakdown": json.dumps(match_breakdown, ensure_ascii=False),
        "gap_analysis_text": gap,
        "interview_questions_json": json.dumps(interview_qs, ensure_ascii=False),
    }

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

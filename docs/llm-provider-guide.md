# LLM Provider Guide

本文档说明当前 LLM 配置方式、各提供商免费额度对比，以及切换建议。

---

## 当前架构

后端使用 `langchain_openai.ChatOpenAI` 作为统一客户端，通过 `base_url` + `api_key` 适配任意 OpenAI 兼容接口。切换提供商**只需修改 `.env` 文件，无需改动代码**。

```
.env.development
├── OPENAI_API_KEY   → 对应提供商的 API Key
├── LLM_BASE_URL     → 对应提供商的 OpenAI 兼容端点
└── DEFAULT_LLM_MODEL → 模型名称
```

### 当前配置（Gemini）

```bash
OPENAI_API_KEY="AIzaSy..."
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
DEFAULT_LLM_MODEL=gemini-2.5-flash
```

---

## 免费额度对比

> 数据截至 2026年3月。Gemini 于 2025年12月7日削减免费配额约 50–80%。

### Gemini（Google AI Studio）

| 模型 | RPM | RPD | TPM | 备注 |
|------|----:|----:|----:|------|
| gemini-2.5-pro | 5 | 100 | 250K | 最强，限制最严 |
| **gemini-2.5-flash** | **10** | **250** | **250K** | **当前使用** |
| gemini-2.5-flash-lite | 15 | 1,000 | 250K | 轻量，RPD 最高 |
| gemini-2.0-flash | — | — | — | ⚠️ 2026年3月已退役 |

- 额度按**项目**计算，不按 API Key
- 每日配额在太平洋时间午夜重置
- TPM 极高（250K）适合单次长上下文请求
- RPD=250 在开发压测时容易耗尽

### Groq（GroqCloud）

| 模型 | RPM | RPD | TPM | TPD | 特点 |
|------|----:|----:|----:|----:|------|
| llama-3.3-70b-versatile | 30 | 1K | 12K | 100K | 综合最强 |
| meta-llama/llama-4-scout-17b-16e-instruct | 30 | 1K | 30K | 500K | TPM 最高 |
| llama-3.1-8b-instant | 30 | 14.4K | 6K | 500K | 高频首选 |
| moonshotai/kimi-k2-instruct | 60 | 1K | 10K | 300K | RPM 最高 |
| qwen/qwen3-32b | 60 | 1K | 6K | 500K | 推理能力强 |
| whisper-large-v3 | 20 | 2K | — | — | 语音转文字 |

- 无需信用卡即可注册使用
- RPD 是 Gemini 的 4–60 倍，更适合开发期高频调试

---

## 对比总结

| 维度 | Gemini 2.5 Flash | Groq llama-3.3-70b |
|------|:---:|:---:|
| RPM | 10 | 30 |
| RPD | 250 | 1,000 |
| TPM | 250K | 12K |
| 上下文窗口 | 1M tokens | 128K tokens |
| 响应速度 | 中等 | 极快（专用硬件） |
| 工具调用 | ✓ | ✓ |
| 多模态（图片/视频） | ✓ | ✗ |
| 适合场景 | 长文档、复杂推理 | 高频对话、开发调试 |

**建议**：
- **日常开发**：Gemini 2.5 Flash 够用，注意 RPD=250 的上限
- **压测 / 高频场景**：切换到 Groq（RPD 4 倍，且完全免费）
- **需要长上下文或多模态**：保持 Gemini

---

## 切换到 Groq（备用方案）

暂未实施，记录备用。修改 `.env.development`：

```bash
OPENAI_API_KEY="gsk_xxxxxxxxxxxxxxxx"   # Groq API Key（console.groq.com）
LLM_BASE_URL=https://api.groq.com/openai/v1
DEFAULT_LLM_MODEL=llama-3.3-70b-versatile
```

同时更新 `app/services/llm.py` 中 `LLMRegistry.LLMS` 的模型列表为 Groq 模型名称。

---

## 参考链接

- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
- [Groq Supported Models](https://console.groq.com/docs/models)
- [Groq Console - 申请 API Key](https://console.groq.com)

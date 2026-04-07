import Link from "next/link"

export const metadata = {
  title: "隐私政策 — Job Hunter Agent",
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen py-24 px-6 sm:px-8 lg:px-12 max-w-3xl mx-auto">
      <Link
        href="/"
        className="font-body text-sm text-[var(--text-3)] hover:text-[var(--text)] transition-colors mb-8 inline-block"
      >
        &larr; 返回首页
      </Link>

      <h1 className="font-heading italic text-4xl sm:text-5xl tracking-tight text-[var(--text)] mb-4">
        隐私政策
      </h1>
      <p className="font-body text-sm text-[var(--text-3)] mb-12">
        最后更新：2026 年 4 月 7 日
      </p>

      <div className="space-y-10 font-body text-base text-[var(--text-2)] leading-relaxed">
        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">1. 我们收集的信息</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>账户信息：</strong>当您通过 Google 登录时，我们获取您的姓名、邮箱地址和头像。</li>
            <li><strong>对话内容：</strong>您与 AI 助手的对话记录存储在服务器数据库中，用于提供会话历史和长期记忆功能。</li>
            <li><strong>求职偏好：</strong>您提供的技能、目标职位、期望薪资等信息，用于个性化推荐。</li>
            <li><strong>使用数据：</strong>页面访问、功能使用频率等匿名统计数据，用于改进产品。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">2. 信息的使用方式</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>提供、维护和改进 Job Hunter Agent 服务。</li>
            <li>为您生成个性化的职位推荐、简历和求职信。</li>
            <li>通过长期记忆功能在不同会话间保持上下文连贯。</li>
            <li>发送服务相关的通知（如账户安全提醒）。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">3. 数据存储与安全</h2>
          <p>
            您的数据存储在受保护的 PostgreSQL 数据库中。对话记录通过 LangGraph 检查点机制持久化，
            长期记忆通过 mem0 以向量形式存储。我们采用加密传输（HTTPS）和访问控制来保护您的数据安全。
          </p>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">4. 第三方服务</h2>
          <p className="mb-3">我们使用以下第三方服务处理数据：</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>DeepSeek API：</strong>处理自然语言对话。您的消息会发送至 DeepSeek 服务器进行推理。</li>
            <li><strong>Google OAuth：</strong>提供身份验证服务。</li>
            <li><strong>DuckDuckGo Search：</strong>执行职位搜索和公司调研时使用。</li>
            <li><strong>Langfuse：</strong>用于服务质量监控和追踪（匿名化处理）。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">5. 数据保留与删除</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>您可以随时删除单个会话及其所有消息。</li>
            <li>您可以请求删除您的账户及所有关联数据。</li>
            <li>账户删除后，我们将在 30 天内清除所有个人数据。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">6. 您的权利</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>访问我们持有的您的个人数据。</li>
            <li>要求更正不准确的信息。</li>
            <li>要求删除您的数据。</li>
            <li>导出您的对话历史。</li>
          </ul>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">7. Cookie 政策</h2>
          <p>
            我们仅使用必要的会话 Cookie 来维持您的登录状态（JWT Token）。
            不使用任何跟踪 Cookie 或第三方广告 Cookie。
          </p>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">8. 政策更新</h2>
          <p>
            我们可能会不定期更新本隐私政策。重大变更将通过应用内通知告知您。
            继续使用本服务即表示您接受更新后的政策。
          </p>
        </section>

        <section>
          <h2 className="font-heading text-xl text-[var(--text)] mb-3">9. 联系我们</h2>
          <p>
            如果您对本隐私政策有任何疑问，请通过{" "}
            <a
              href="https://github.com/0xMoat/job-hunter-agent/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text)] underline underline-offset-4 decoration-[var(--text-3)] hover:decoration-[var(--text)] transition-colors"
            >
              GitHub Issues
            </a>
            {" "}与我们联系。
          </p>
        </section>
      </div>
    </main>
  )
}

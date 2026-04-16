"""Golden dataset for offline evaluation of the Job Hunter Agent.

Each test case defines an input message, expected output description,
and metadata including the category and expected tool calls.
"""

GOLDEN_DATASET = [
    # ── A. 纯对话（4 cases）──────────────────────────────────────
    {
        "input": "你好，你能帮我什么？",
        "expected_output": "介绍自己是求职助理，列出核心能力（职位搜索、公司调研、求职信、申请跟踪、简历优化），并主动询问用户背景信息",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    {
        "input": "今天天气怎么样？",
        "expected_output": "礼貌说明自己是求职助理，无法查询天气，引导用户回到求职话题",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    {
        "input": "谢谢你的帮助！",
        "expected_output": "友好回应感谢，询问是否还有其他求职需求",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    {
        "input": "你是谁？你是什么模型？",
        "expected_output": "介绍自己是求职助理，说明能提供的服务，不需要调用任何工具",
        "metadata": {"category": "chitchat", "expected_tools": []},
    },
    # ── B. 工作搜索（4 cases）────────────────────────────────────
    {
        "input": "帮我搜索深圳的Python后端开发岗位",
        "expected_output": "调用job_search_tool搜索深圳Python后端岗位，返回结构化的职位列表",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    {
        "input": "我想找上海的AI工程师工作，最好是远程的",
        "expected_output": "调用job_search_tool搜索上海AI工程师远程岗位",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    {
        "input": "有没有北京的Go语言开发岗位？",
        "expected_output": "调用job_search_tool搜索北京Go语言开发岗位",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    {
        "input": "帮我找一些杭州大数据相关的职位",
        "expected_output": "调用job_search_tool搜索杭州大数据相关岗位",
        "metadata": {"category": "job_search", "expected_tools": ["job_search_tool"]},
    },
    # ── C. 公司调研（4 cases）────────────────────────────────────
    {
        "input": "帮我调研一下字节跳动的工作环境和技术栈",
        "expected_output": "调用company_research_tool调研字节跳动，返回公司概况、文化、技术栈、近期动态",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    {
        "input": "我想了解一下蚂蚁集团这家公司怎么样",
        "expected_output": "调用company_research_tool调研蚂蚁集团",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    {
        "input": "Google的面试流程是怎样的？帮我调研下",
        "expected_output": "调用company_research_tool调研Google，包含面试流程相关信息",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    {
        "input": "帮我看看腾讯云部门的情况",
        "expected_output": "调用company_research_tool调研腾讯云部门",
        "metadata": {"category": "company_research", "expected_tools": ["company_research_tool"]},
    },
    # ── D. 求职信撰写（4 cases）──────────────────────────────────
    {
        "input": "帮我写一封投递Google SWE岗位的求职信",
        "expected_output": "调用cover_letter_tool生成针对Google SWE的个性化求职信",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    {
        "input": "我要投递字节跳动的后端开发岗，帮我写封求职信",
        "expected_output": "调用cover_letter_tool生成针对字节跳动后端的求职信",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    {
        "input": "帮我写一封英文的cold email给Stripe的招聘经理",
        "expected_output": "调用cover_letter_tool生成英文冷邮件",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    {
        "input": "写一封投递美团算法工程师的求职信，突出我的机器学习经验",
        "expected_output": "调用cover_letter_tool生成突出ML经验的求职信",
        "metadata": {"category": "cover_letter", "expected_tools": ["cover_letter_tool"]},
    },
    # ── E. 申请跟踪（4 cases）────────────────────────────────────
    {
        "input": "帮我记录一下，我已经投了美团的后端开发岗位",
        "expected_output": "调用application_tracker_tool(action=add)记录美团后端申请",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    {
        "input": "我现在有哪些在投的岗位？",
        "expected_output": "调用application_tracker_tool(action=list)列出所有申请记录",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    {
        "input": "把我投字节跳动的那个申请状态更新为面试中",
        "expected_output": "调用application_tracker_tool(action=update)更新字节跳动申请状态",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    {
        "input": "删除我之前投的那个不合适的岗位",
        "expected_output": "调用application_tracker_tool(action=delete)删除指定申请记录",
        "metadata": {"category": "application_tracking", "expected_tools": ["application_tracker_tool"]},
    },
    # ── F. 简历优化（3 cases）────────────────────────────────────
    {
        "input": "帮我针对这个Python后端岗位的JD优化我的简历",
        "expected_output": "调用trigger_resume_studio_skill启动简历优化流程",
        "metadata": {"category": "resume", "expected_tools": ["trigger_resume_studio_skill"]},
    },
    {
        "input": "我想让简历更匹配AI工程师的要求",
        "expected_output": "调用trigger_resume_studio_skill针对AI工程师优化简历",
        "metadata": {"category": "resume", "expected_tools": ["trigger_resume_studio_skill"]},
    },
    {
        "input": "帮我重新调整简历来匹配这个全栈开发的职位描述",
        "expected_output": "调用trigger_resume_studio_skill针对全栈开发岗位调整简历",
        "metadata": {"category": "resume", "expected_tools": ["trigger_resume_studio_skill"]},
    },
    # ── G. 求职策略（4 cases）────────────────────────────────────
    {
        "input": "我是应届毕业生，想进大厂，该怎么准备？",
        "expected_output": "提供系统性的大厂求职准备建议，包括技能提升、简历准备、面试策略等，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    {
        "input": "跳槽面试一般要准备多久？有什么建议吗？",
        "expected_output": "提供跳槽准备的时间规划和具体建议，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    {
        "input": "如何在面试中谈薪资？有什么技巧？",
        "expected_output": "提供薪资谈判的策略和技巧，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    {
        "input": "远程工作和驻场工作怎么选？各有什么优缺点？",
        "expected_output": "对比远程与驻场工作的优缺点，结合求职角度给出建议，不调用任何工具",
        "metadata": {"category": "strategy", "expected_tools": []},
    },
    # ── H. 每日搜索偏好（3 cases）───────────────────────────────
    {
        "input": "帮我设置每天自动搜索上海的Agent工程师岗位",
        "expected_output": "调用job_preferences_tool保存偏好：keywords=Agent工程师, location=上海",
        "metadata": {"category": "preferences", "expected_tools": ["job_preferences_tool"]},
    },
    {
        "input": "我想每天收到深圳Python开发的职位推荐",
        "expected_output": "调用job_preferences_tool保存偏好：keywords=Python开发, location=深圳",
        "metadata": {"category": "preferences", "expected_tools": ["job_preferences_tool"]},
    },
    {
        "input": "把我的每日搜索改成远程的全栈工程师",
        "expected_output": "调用job_preferences_tool更新偏好：keywords=全栈工程师, job_type=remote",
        "metadata": {"category": "preferences", "expected_tools": ["job_preferences_tool"]},
    },
    # ── I. Plan-and-Execute 批处理（2 cases）────────────────────
    {
        "input": "处理看板上所有状态为 pending 的职位：逐一研究公司、撰写求职信，并将处理结果更新回看板。",
        "expected_output": (
            "Planner 为 2 条 pending 分别规划：研究公司 → 撰写求职信 → 更新看板状态；"
            "最后一步汇总。每步应引用具体公司 + 职位名，且不应包含 job_search。"
        ),
        "metadata": {
            "category": "plan_execute",
            "pending_applications": [
                {"company": "蚂蚁集团", "title": "AI 应用研发（Agent/大模型应用）"},
                {"company": "腾讯", "title": "大模型应用 agent 开发工程师"},
            ],
        },
    },
    {
        "input": "自动处理看板上的待投递职位",
        "expected_output": (
            "Planner 为 1 条 pending 规划公司调研 → 求职信 → 看板更新 → 汇总；"
            "Replanner 正常终止并返回包含处理结果的 final_response。"
        ),
        "metadata": {
            "category": "plan_execute",
            "pending_applications": [
                {"company": "字节跳动", "title": "Agent Engineer / LLM Platform"},
            ],
        },
    },
]

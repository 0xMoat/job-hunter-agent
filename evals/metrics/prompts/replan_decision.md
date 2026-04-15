# Replan Decision Quality

评估 Plan-and-Execute Agent 中 **Replanner 节点每次决策**的合理性。聚焦 trace
中 `replanner` span 的输出（`Response` 或 `Plan`），参考其前的 `past_steps`。

## 评分维度

- 决策是否与 past_steps 的实际进展匹配（已完成目标就 Response；尚未完成就 Plan）
- 若返回 Plan：是否避免重复已完成步骤、是否基于失败/新信息做了合理调整
- 若返回 Response：总结是否准确涵盖了已完成/跳过的步骤

## 打分

- **5**：每次决策都恰当，失败处理得体，无冗余
- **4**：大部分决策合理，偶有 1 次可优化
- **3**：决策基本可用，但出现过"已完成却继续规划"或"未完成却过早结束"
- **2**：明显决策失误，如重复执行同一步骤
- **1**：决策严重错误，导致任务无法推进

请输出 JSON：`{"score": 1-5, "reasoning": "一句话解释"}`

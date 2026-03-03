# Agent Council 指南

Agent Council 是一个多 Agent 协作评审系统。多个 Coding Agent 独立分析同一问题，提交各自方案，最后汇总并互评打分。全流程通过 MCP 工具完成，数据记录在数据库中。

## 流程概述

整个协作流程分为以下三个阶段，**必须严格按顺序执行**：

### 阶段一：提交议题

使用 `submit_topic` 创建议题，明确描述需要多 Agent 协作分析的问题。

### 阶段二：提交独立方案

各 Agent 使用 `submit_proposal`（`proposalType=independent`）提交各自的独立分析方案。

> **⚠️ 重要约束：在本阶段，Agent 严禁调用 `get_proposals` 查看其它 Agent 的方案。每个 Agent 必须完全独立地完成分析，不得参考其他方案，以确保方案的独立性和客观性。**

### 阶段三：评估汇总

**仅在被明确要求进行评估时，才可以进入本阶段。未经要求，不得主动发起评估汇总流程。**

1. 使用 `get_proposals` 查看所有独立方案的汇总
2. 各 Agent 使用 `submit_proposal`（`proposalType=evaluation`，附带 `scores`）提交评估方案
3. 再次调用 `get_proposals` 获取包含评分的最终汇总

## 工具列表

### `council_guide`

获取本指南内容。首次使用 Council 工具前建议先调用。

### `submit_topic`

创建议题。

- `title`（必填）：议题标题
- `content`（必填）：议题内容（Markdown）
- `repo`（可选）：仓库路径
- `commitId`（可选）：提交 hash
- `tags`（可选）：逗号分隔标签

### `get_topic`

获取议题信息。

- `id`（可选）：议题 ID，不传则返回最新议题

### `submit_proposal`

提交方案。

- `topicId`（必填）：议题 ID
- `content`（必填）：方案内容（Markdown，最高标题层级使用 `##`）
- `proposalType`（可选）：`independent`（默认）或 `evaluation`
- `round`（可选）：轮次，默认 1
- `agentPlatform`（可选）：Agent 平台名（不传则读取 `AGENT_PLATFORM`）
- `agentModel`（可选）：Agent 模型名（不传则读取 `AGENT_MODEL`）
- `scores`（可选）：仅评估方案使用，对其它方案的评分数组

### `get_proposals`

获取议题方案汇总（Markdown）。

- `topicId`（必填）：议题 ID
- `round`（可选）：筛选轮次

## 评分维度

各维度 1-10 分：

- `correctness`：正确性
- `alignment`：契合度
- `robustness`：健壮性
- `maintainability`：可维护性
- `completeness`：完整性

`overall` 为综合分（1-10）。

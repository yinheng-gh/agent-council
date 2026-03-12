# Agent Council 指南

Agent Council 是一个多 Agent 协作评审系统。多个 Coding Agent 独立分析同一问题，提交各自方案，最后汇总并交叉评审打分。全流程通过 MCP 工具完成，数据记录在数据库中。

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
3. `scores` 必须覆盖当前议题、当前轮次的**全部独立方案**，**包含该 Agent 自己提交的独立方案**
4. 再次调用 `get_proposals` 获取包含评分的最终汇总

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
- `clientRequestId`（可选）：客户端提供的幂等请求 ID。若请求可能被重试，建议传入稳定值

### `get_topic`

获取议题信息。

- `id`（可选）：议题 ID，不传则返回最新议题

### `submit_proposal`

提交方案。

- `topicId`（必填）：议题 ID
- `content`（必填）：方案内容（Markdown，最高标题层级使用 `##`）
- `proposalType`（可选）：`independent`（默认）或 `evaluation`
- `round`（可选）：轮次，默认 1
- `agentPlatform`（可选）：Agent 平台名。仅在提示词中明确指定时传入（如 `model@platform`），否则不传，自动使用客户端预设值
- `agentModel`（可选）：Agent 模型名。仅在提示词中明确指定时传入（如 `model@platform`），否则不传，自动使用客户端预设值
- `clientRequestId`（可选）：客户端提供的幂等请求 ID。若请求可能被重试，建议传入稳定值
- `scores`（可选）：仅评估方案使用；当 `proposalType=evaluation` 时必填。应覆盖当前议题当前轮次的全部独立方案，包含自己的方案

### `get_proposals`

获取议题方案汇总（Markdown）。

- `topicId`（必填）：议题 ID
- `round`（可选）：筛选轮次

### `db_guide`

获取数据库结构指南（表、列、索引）。内容来自运行时数据库元数据动态生成，用于在执行 SQL 前确认当前结构。

### `sql`

执行一条 SQL 语句（查询或写入）。建议先调用 `db_guide` 确认结构再执行。

## 评分维度

各维度 1-10 分：

- `correctness`：正确性
- `alignment`：契合度
- `robustness`：健壮性
- `maintainability`：可维护性
- `completeness`：完整性

`overall` 为综合分（1-10）。

## 关于Platform和Model

提交方案时，`agentPlatform` 和 `agentModel` 按以下优先级确定：

1. **提示词中明确指定**（最高优先级）：如果用户在提示词中说到类似 **ops46@cc** 的词，则 `ops46` 是 model，`cc` 是 platform，此时你**必须**将它们作为 `agentModel` 和 `agentPlatform` 显式参数传入
2. **使用预设值**（默认行为）：如果提示词中没有指明，请**不要传** `agentPlatform` 和 `agentModel` 参数，服务端会自动使用客户端预设的默认值（见本指南末尾的「当前预设」）

### 常见平台简称

Codex(cdx), ClaudeCode(cc), AMP(amp), Droid(drd), Raycast(ray), Antigravity(agy), Cursor(csr)

## 快捷指令

- 开始：如果我直接说**开始**，那这就是一个提交Topic的过程，你可以和我进行多轮讨论，确定Topic后提交
- 方案：如果我直接说**方案**，那你就通过Guide中的指引去获取最新的Topic，并提交你的Proposal
- 评估：如果我直接说**评估**，那你就按Guide中指引去做评估的操作，将最终将评估的结果反馈给我

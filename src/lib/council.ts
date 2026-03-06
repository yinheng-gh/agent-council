import { readFileSync } from "node:fs";
import { join } from "node:path";

const councilGuidePath = join(import.meta.dir, "../council-guide.md");

export function getCouncilGuideContent(): string {
  return readFileSync(councilGuidePath, "utf-8");
}

interface ProposalRow {
  id: string;
  content: string;
  proposalType: string;
  round: number;
  agentPlatform: string;
  agentModel: string;
}

interface ScoreRow {
  proposalId: string;
  evaluatorProposalId: string;
  overall: number;
  dimensions: string;
  agentPlatform: string;
  agentModel: string;
}

interface TopicInfo {
  title: string;
  content: string;
}

function parseDimensions(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function buildProposalsSummary(
  topic: TopicInfo,
  proposals: ProposalRow[],
  scores: ScoreRow[],
): string {
  const parts: string[] = [];

  parts.push(`# 议题：${topic.title}\n\n${topic.content}`);

  for (const proposal of proposals) {
    const platform = proposal.agentPlatform || "Unknown";
    const model = proposal.agentModel || "Unknown";
    const typeLabel =
      proposal.proposalType === "evaluation" ? " (Evaluation)" : "";

    parts.push(
      `# Agent: ${model}@${platform} [Round ${proposal.round}]${typeLabel}\n\n${proposal.content}`,
    );
  }

  if (scores.length > 0) {
    const scoresByProposal = new Map<string, ScoreRow[]>();
    for (const score of scores) {
      const existing = scoresByProposal.get(score.proposalId) ?? [];
      existing.push(score);
      scoresByProposal.set(score.proposalId, existing);
    }

    const lines: string[] = [];
    lines.push("## 评分汇总\n");
    lines.push(
      "| 被评方案 | 评估者 | Overall | Correctness | Alignment | Robustness | Maintainability | Completeness |",
    );
    lines.push(
      "|----------|--------|---------|-------------|-----------|------------|-----------------|--------------|",
    );

    for (const [proposalId, proposalScores] of scoresByProposal) {
      const targetProposal = proposals.find(
        (proposal) => proposal.id === proposalId,
      );
      const targetLabel = targetProposal
        ? `${targetProposal.agentModel || "Unknown"}@${targetProposal.agentPlatform || "Unknown"}`
        : proposalId.slice(0, 8);

      for (const score of proposalScores) {
        const evaluator = `${score.agentModel || "Unknown"}@${score.agentPlatform || "Unknown"}`;
        const dimensions = parseDimensions(score.dimensions);
        lines.push(
          `| ${targetLabel} | ${evaluator} | ${score.overall} | ${dimensions.correctness ?? "-"} | ${dimensions.alignment ?? "-"} | ${dimensions.robustness ?? "-"} | ${dimensions.maintainability ?? "-"} | ${dimensions.completeness ?? "-"} |`,
        );
      }
    }

    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n---\n\n");
}

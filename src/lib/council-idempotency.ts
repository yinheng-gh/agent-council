import { hashValue } from "./request-meta";

interface TopicFingerprintInput {
  title: string;
  content: string;
  repo: string;
  commitId: string;
  tags: string;
}

interface ProposalScoreInput {
  proposalId: string;
  overall: number;
  dimensions?: Record<string, number | undefined>;
}

interface ProposalFingerprintInput {
  topicId: string;
  content: string;
  proposalType: string;
  round: number;
  agentPlatform: string;
  agentModel: string;
  scores: ProposalScoreInput[];
}

export const REQUEST_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

function normalizeDimensions(dimensions?: Record<string, number | undefined>) {
  return {
    alignment: dimensions?.alignment ?? null,
    completeness: dimensions?.completeness ?? null,
    correctness: dimensions?.correctness ?? null,
    maintainability: dimensions?.maintainability ?? null,
    robustness: dimensions?.robustness ?? null,
  };
}

export function getRequestBucket(date: Date): number {
  return Math.floor(date.getTime() / REQUEST_DEDUPE_WINDOW_MS);
}

export function buildTopicRequestFingerprint(input: TopicFingerprintInput): string {
  return hashValue({
    tool: "submit_topic",
    title: input.title,
    content: input.content,
    repo: input.repo,
    commitId: input.commitId,
    tags: input.tags,
  });
}

export function buildProposalRequestFingerprint(
  input: ProposalFingerprintInput,
): string {
  const normalizedScores = [...input.scores]
    .map((score) => ({
      proposalId: score.proposalId,
      overall: score.overall,
      dimensions: normalizeDimensions(score.dimensions),
    }))
    .sort((left, right) => left.proposalId.localeCompare(right.proposalId));

  return hashValue({
    tool: "submit_proposal",
    topicId: input.topicId,
    content: input.content,
    proposalType: input.proposalType,
    round: input.round,
    agentPlatform: input.agentPlatform,
    agentModel: input.agentModel,
    scores: normalizedScores,
  });
}

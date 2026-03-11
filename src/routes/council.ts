import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  councilProposalsTable,
  councilScoresTable,
  councilTopicsTable,
} from "../db/schema";
import {
  getClientDefaults,
  getRequestContext,
} from "../lib/client-context";
import {
  buildProposalRequestFingerprint,
  buildTopicRequestFingerprint,
  getRequestBucket,
} from "../lib/council-idempotency";
import { buildProposalsSummary, getCouncilGuideContent } from "../lib/council";
import db from "../lib/db";
import { logger } from "../lib/logger";
import { mcpServer } from "../lib/mcp-server";
import { shortHash } from "../lib/request-meta";

type TopicRecord = typeof councilTopicsTable.$inferSelect;
type ProposalRecord = typeof councilProposalsTable.$inferSelect;
type DuplicateMatchBy = "clientRequestId" | "requestFingerprint";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildJsonResponse(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function buildDuplicateResponse(
  key: "topic" | "proposal",
  value: TopicRecord | ProposalRecord,
  matchBy: DuplicateMatchBy,
) {
  return buildJsonResponse({
    success: true,
    deduplicated: true,
    matchBy,
    [key]: value,
  });
}

function normalizeClientRequestId(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed")
  );
}

async function findExistingTopic(args: {
  clientRequestId?: string;
  requestFingerprint: string;
  requestBucket: number;
}): Promise<
  | {
      topic: TopicRecord;
      matchBy: DuplicateMatchBy;
    }
  | undefined
> {
  if (args.clientRequestId) {
    const byClientRequestId = await db
      .select()
      .from(councilTopicsTable)
      .where(eq(councilTopicsTable.clientRequestId, args.clientRequestId))
      .limit(1);

    if (byClientRequestId[0]) {
      return {
        topic: byClientRequestId[0],
        matchBy: "clientRequestId",
      };
    }
  }

  const byFingerprint = await db
    .select()
    .from(councilTopicsTable)
    .where(
      and(
        eq(councilTopicsTable.requestFingerprint, args.requestFingerprint),
        eq(councilTopicsTable.requestBucket, args.requestBucket),
      ),
    )
    .limit(1);

  if (byFingerprint[0]) {
    return {
      topic: byFingerprint[0],
      matchBy: "requestFingerprint",
    };
  }

  return undefined;
}

async function findExistingProposal(args: {
  clientRequestId?: string;
  requestFingerprint: string;
  requestBucket: number;
}): Promise<
  | {
      proposal: ProposalRecord;
      matchBy: DuplicateMatchBy;
    }
  | undefined
> {
  if (args.clientRequestId) {
    const byClientRequestId = await db
      .select()
      .from(councilProposalsTable)
      .where(eq(councilProposalsTable.clientRequestId, args.clientRequestId))
      .limit(1);

    if (byClientRequestId[0]) {
      return {
        proposal: byClientRequestId[0],
        matchBy: "clientRequestId",
      };
    }
  }

  const byFingerprint = await db
    .select()
    .from(councilProposalsTable)
    .where(
      and(
        eq(councilProposalsTable.requestFingerprint, args.requestFingerprint),
        eq(councilProposalsTable.requestBucket, args.requestBucket),
      ),
    )
    .limit(1);

  if (byFingerprint[0]) {
    return {
      proposal: byFingerprint[0],
      matchBy: "requestFingerprint",
    };
  }

  return undefined;
}

function hasClientRequestIdConflict(args: {
  clientRequestId?: string;
  expectedFingerprint: string;
  actualFingerprint?: string | null;
}): boolean {
  return (
    Boolean(args.clientRequestId) &&
    Boolean(args.actualFingerprint) &&
    args.actualFingerprint !== args.expectedFingerprint
  );
}

function getRequestAuditMeta() {
  const requestContext = getRequestContext();

  return {
    requestId: requestContext?.requestId,
    requestHash: shortHash(requestContext?.requestHash),
    toolName: requestContext?.toolName,
    argumentsHash: shortHash(requestContext?.argumentsHash),
    batchSize: requestContext?.batchSize,
  };
}

mcpServer.registerTool(
  "council_guide",
  {
    title: "Agent Council Guide",
    description:
      "Get the Agent Council guide. Call this before using other council tools.",
  },
  async () => {
    const defaults = getClientDefaults();
    let guide = getCouncilGuideContent();

    const lines: string[] = ["\n\n## 当前预设\n"];
    lines.push(`- **默认平台**: ${defaults.platform || "(未设置)"}`);
    lines.push(`- **默认模型**: ${defaults.model || "(未设置)"}`);
    lines.push(
      "\n提交方案时不传 `agentPlatform` 和 `agentModel`，将自动使用以上预设值。若提示词中指定了 `model@platform` 格式，以提示词为准，将其作为显式参数传入。"
    );
    guide += lines.join("\n");

    return {
      content: [{ type: "text", text: guide }],
    };
  }
);

mcpServer.registerTool(
  "submit_topic",
  {
    title: "Submit Council Topic",
    description: "Create a new topic for Agent Council discussion.",
    inputSchema: {
      title: z.string().min(1).describe("Topic title"),
      content: z.string().min(1).describe("Topic content in Markdown"),
      repo: z.string().optional().describe("Git repository path"),
      commitId: z.string().optional().describe("Commit hash"),
      tags: z.string().optional().describe("Comma-separated tags"),
      clientRequestId: z
        .string()
        .optional()
        .describe("Optional idempotency key from the client"),
    },
  },
  async ({ title, content, repo, commitId, tags, clientRequestId }) => {
    try {
      const now = new Date();
      const normalizedClientRequestId = normalizeClientRequestId(clientRequestId);
      const requestFingerprint = buildTopicRequestFingerprint({
        title,
        content,
        repo: repo ?? "",
        commitId: commitId ?? "",
        tags: tags ?? "",
      });
      const requestBucket = getRequestBucket(now);
      const requestAudit = getRequestAuditMeta();

      logger.info("[Council] submit_topic request", {
        title,
        clientRequestId: normalizedClientRequestId,
        requestFingerprint: shortHash(requestFingerprint),
        requestBucket,
        ...requestAudit,
      });

      const existingTopic = await findExistingTopic({
        clientRequestId: normalizedClientRequestId,
        requestFingerprint,
        requestBucket,
      });

      if (existingTopic) {
        if (
          hasClientRequestIdConflict({
            clientRequestId: normalizedClientRequestId,
            expectedFingerprint: requestFingerprint,
            actualFingerprint: existingTopic.topic.requestFingerprint,
          })
        ) {
          return buildJsonResponse(
            {
              success: false,
              error:
                "clientRequestId 已被其他 topic 请求使用，请为新的请求生成新的 clientRequestId。",
            },
            true,
          );
        }

        logger.warn("[Council] Topic deduplicated", {
          topicId: existingTopic.topic.id,
          matchBy: existingTopic.matchBy,
          clientRequestId: normalizedClientRequestId,
          requestFingerprint: shortHash(requestFingerprint),
          ...requestAudit,
        });

        return buildDuplicateResponse(
          "topic",
          existingTopic.topic,
          existingTopic.matchBy,
        );
      }

      const id = crypto.randomUUID();
      const topic = {
        id,
        title,
        content,
        status: "collecting" as const,
        repo: repo ?? "",
        commitId: commitId ?? "",
        tags: tags ?? "",
        clientRequestId: normalizedClientRequestId ?? null,
        requestFingerprint,
        requestBucket,
        proposalCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await db.insert(councilTopicsTable).values(topic);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const duplicatedTopic = await findExistingTopic({
            clientRequestId: normalizedClientRequestId,
            requestFingerprint,
            requestBucket,
          });

          if (duplicatedTopic) {
            if (
              hasClientRequestIdConflict({
                clientRequestId: normalizedClientRequestId,
                expectedFingerprint: requestFingerprint,
                actualFingerprint: duplicatedTopic.topic.requestFingerprint,
              })
            ) {
              return buildJsonResponse(
                {
                  success: false,
                  error:
                    "clientRequestId 已被其他 topic 请求使用，请为新的请求生成新的 clientRequestId。",
                },
                true,
              );
            }

            logger.warn("[Council] Topic deduplicated after unique conflict", {
              topicId: duplicatedTopic.topic.id,
              matchBy: duplicatedTopic.matchBy,
              clientRequestId: normalizedClientRequestId,
              requestFingerprint: shortHash(requestFingerprint),
              ...requestAudit,
            });

            return buildDuplicateResponse(
              "topic",
              duplicatedTopic.topic,
              duplicatedTopic.matchBy,
            );
          }
        }

        throw error;
      }

      logger.info("[Council] Topic created", {
        topicId: id,
        clientRequestId: normalizedClientRequestId,
        requestFingerprint: shortHash(requestFingerprint),
        ...requestAudit,
      });

      return buildJsonResponse({ success: true, topic });
    } catch (error) {
      logger.error("[Council] submit_topic failed", error);
      return buildJsonResponse(
        {
          success: false,
          error: toErrorMessage(error),
        },
        true,
      );
    }
  }
);

mcpServer.registerTool(
  "get_topic",
  {
    title: "Get Council Topic",
    description:
      "Get a topic by ID. If no ID is provided, returns the latest topic.",
    inputSchema: {
      id: z.string().optional().describe("Topic ID"),
    },
  },
  async ({ id }) => {
    try {
      const topicResult = id
        ? await db
            .select()
            .from(councilTopicsTable)
            .where(eq(councilTopicsTable.id, id))
            .limit(1)
        : await db
            .select()
            .from(councilTopicsTable)
            .orderBy(desc(councilTopicsTable.createdAt))
            .limit(1);

      const topic = topicResult[0];
      if (!topic) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: false, error: "Topic not found" },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, topic }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error("[Council] get_topic failed", error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

mcpServer.registerTool(
  "submit_proposal",
  {
    title: "Submit Council Proposal",
    description:
      "Submit a proposal for a topic. Evaluation proposals may include scores.",
    inputSchema: {
      topicId: z.string().min(1).describe("Topic ID"),
      content: z
        .string()
        .min(1)
        .describe("Proposal content in Markdown, using ## as top heading"),
      proposalType: z
        .enum(["independent", "evaluation"])
        .optional()
        .describe("Proposal type"),
      round: z.number().int().min(1).optional().describe("Round number"),
      agentPlatform: z
        .string()
        .optional()
        .describe(
          "Agent platform name. Only pass when explicitly specified in prompt (e.g. model@platform). Otherwise omit to use client preset."
        ),
      agentModel: z
        .string()
        .optional()
        .describe(
          "Agent model name. Only pass when explicitly specified in prompt (e.g. model@platform). Otherwise omit to use client preset."
        ),
      clientRequestId: z
        .string()
        .optional()
        .describe("Optional idempotency key from the client"),
      scores: z
        .array(
          z.object({
            proposalId: z.string().describe("Proposal ID being scored"),
            overall: z.number().min(1).max(10).describe("Overall score 1-10"),
            dimensions: z
              .object({
                correctness: z.number().min(1).max(10).optional(),
                alignment: z.number().min(1).max(10).optional(),
                robustness: z.number().min(1).max(10).optional(),
                maintainability: z.number().min(1).max(10).optional(),
                completeness: z.number().min(1).max(10).optional(),
              })
              .optional(),
          })
        )
        .optional()
        .describe("Score records used for evaluation proposals"),
    },
  },
  async ({
    topicId,
    content,
    proposalType,
    round,
    agentPlatform,
    agentModel,
    clientRequestId,
    scores,
  }) => {
    try {
      const now = new Date();
      const type = proposalType ?? "independent";
      const normalizedClientRequestId = normalizeClientRequestId(clientRequestId);

      if (type === "independent" && scores && scores.length > 0) {
        return buildJsonResponse(
          {
            success: false,
            error: "scores is only allowed when proposalType is evaluation",
          },
          true,
        );
      }

      const defaults = getClientDefaults();
      const resolvedRound = round ?? 1;
      const resolvedAgentPlatform = agentPlatform ?? defaults.platform;
      const resolvedAgentModel = agentModel ?? defaults.model;
      const requestFingerprint = buildProposalRequestFingerprint({
        topicId,
        content,
        proposalType: type,
        round: resolvedRound,
        agentPlatform: resolvedAgentPlatform,
        agentModel: resolvedAgentModel,
        scores: scores ?? [],
      });
      const requestBucket = getRequestBucket(now);
      const requestAudit = getRequestAuditMeta();

      logger.info("[Council] submit_proposal request", {
        topicId,
        proposalType: type,
        round: resolvedRound,
        agentPlatform: resolvedAgentPlatform,
        agentModel: resolvedAgentModel,
        clientRequestId: normalizedClientRequestId,
        requestFingerprint: shortHash(requestFingerprint),
        requestBucket,
        ...requestAudit,
      });

      const existingProposal = await findExistingProposal({
        clientRequestId: normalizedClientRequestId,
        requestFingerprint,
        requestBucket,
      });

      if (existingProposal) {
        if (
          hasClientRequestIdConflict({
            clientRequestId: normalizedClientRequestId,
            expectedFingerprint: requestFingerprint,
            actualFingerprint: existingProposal.proposal.requestFingerprint,
          })
        ) {
          return buildJsonResponse(
            {
              success: false,
              error:
                "clientRequestId 已被其他 proposal 请求使用，请为新的请求生成新的 clientRequestId。",
            },
            true,
          );
        }

        logger.warn("[Council] Proposal deduplicated", {
          proposalId: existingProposal.proposal.id,
          matchBy: existingProposal.matchBy,
          topicId,
          clientRequestId: normalizedClientRequestId,
          requestFingerprint: shortHash(requestFingerprint),
          ...requestAudit,
        });

        return buildDuplicateResponse(
          "proposal",
          existingProposal.proposal,
          existingProposal.matchBy,
        );
      }

      const topicResult = await db
        .select({
          id: councilTopicsTable.id,
        })
        .from(councilTopicsTable)
        .where(eq(councilTopicsTable.id, topicId))
        .limit(1);

      if (topicResult.length === 0) {
        return buildJsonResponse(
          { success: false, error: "Topic not found" },
          true,
        );
      }

      const id = crypto.randomUUID();
      const proposal = {
        id,
        topicId,
        content,
        proposalType: type,
        round: resolvedRound,
        agentPlatform: resolvedAgentPlatform,
        agentModel: resolvedAgentModel,
        clientRequestId: normalizedClientRequestId ?? null,
        requestFingerprint,
        requestBucket,
        createdAt: now,
      };

      try {
        await db.transaction(async (tx) => {
          await tx.insert(councilProposalsTable).values(proposal);

          if (type === "evaluation" && scores && scores.length > 0) {
            const scoreRecords = scores.map((score) => ({
              topicId,
              proposalId: score.proposalId,
              evaluatorProposalId: id,
              overall: score.overall,
              dimensions: JSON.stringify(score.dimensions ?? {}),
              createdAt: now,
            }));

            await tx.insert(councilScoresTable).values(scoreRecords);
          }

          await tx
            .update(councilTopicsTable)
            .set({
              proposalCount: sql`${councilTopicsTable.proposalCount} + 1`,
              updatedAt: now,
              ...(type === "evaluation"
                ? { status: "evaluating" as const }
                : {}),
            })
            .where(eq(councilTopicsTable.id, topicId));
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const duplicatedProposal = await findExistingProposal({
            clientRequestId: normalizedClientRequestId,
            requestFingerprint,
            requestBucket,
          });

          if (duplicatedProposal) {
            if (
              hasClientRequestIdConflict({
                clientRequestId: normalizedClientRequestId,
                expectedFingerprint: requestFingerprint,
                actualFingerprint: duplicatedProposal.proposal.requestFingerprint,
              })
            ) {
              return buildJsonResponse(
                {
                  success: false,
                  error:
                    "clientRequestId 已被其他 proposal 请求使用，请为新的请求生成新的 clientRequestId。",
                },
                true,
              );
            }

            logger.warn(
              "[Council] Proposal deduplicated after unique conflict",
              {
                proposalId: duplicatedProposal.proposal.id,
                matchBy: duplicatedProposal.matchBy,
                topicId,
                clientRequestId: normalizedClientRequestId,
                requestFingerprint: shortHash(requestFingerprint),
                ...requestAudit,
              },
            );

            return buildDuplicateResponse(
              "proposal",
              duplicatedProposal.proposal,
              duplicatedProposal.matchBy,
            );
          }
        }

        throw error;
      }

      logger.info("[Council] Proposal submitted", {
        proposalId: id,
        topicId,
        clientRequestId: normalizedClientRequestId,
        requestFingerprint: shortHash(requestFingerprint),
        ...requestAudit,
      });

      return buildJsonResponse({ success: true, proposal });
    } catch (error) {
      logger.error("[Council] submit_proposal failed", error);
      return buildJsonResponse(
        {
          success: false,
          error: toErrorMessage(error),
        },
        true,
      );
    }
  }
);

mcpServer.registerTool(
  "get_proposals",
  {
    title: "Get Council Proposals",
    description:
      "Get proposals under a topic and return a structured Markdown summary.",
    inputSchema: {
      topicId: z.string().min(1).describe("Topic ID"),
      round: z.number().int().min(1).optional().describe("Optional round filter"),
    },
  },
  async ({ topicId, round }) => {
    try {
      const topicResult = await db
        .select({
          id: councilTopicsTable.id,
          title: councilTopicsTable.title,
          content: councilTopicsTable.content,
        })
        .from(councilTopicsTable)
        .where(eq(councilTopicsTable.id, topicId))
        .limit(1);

      const topic = topicResult[0];
      if (!topic) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: false, error: "Topic not found" },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const whereClause =
        round === undefined
          ? eq(councilProposalsTable.topicId, topicId)
          : and(
              eq(councilProposalsTable.topicId, topicId),
              eq(councilProposalsTable.round, round)
            );

      const proposals = await db
        .select()
        .from(councilProposalsTable)
        .where(whereClause)
        .orderBy(councilProposalsTable.round, councilProposalsTable.createdAt);

      const proposalIds = new Set(proposals.map((proposal) => proposal.id));

      const allScores = await db
        .select({
          proposalId: councilScoresTable.proposalId,
          evaluatorProposalId: councilScoresTable.evaluatorProposalId,
          overall: councilScoresTable.overall,
          dimensions: councilScoresTable.dimensions,
        })
        .from(councilScoresTable)
        .where(eq(councilScoresTable.topicId, topicId));

      const scoreRows = allScores.filter(
        (score) =>
          proposalIds.has(score.proposalId) &&
          proposalIds.has(score.evaluatorProposalId)
      );

      const proposalMap = new Map(proposals.map((proposal) => [proposal.id, proposal]));
      const enrichedScores = scoreRows.map((score) => {
        const evaluator = proposalMap.get(score.evaluatorProposalId);
        return {
          ...score,
          agentPlatform: evaluator?.agentPlatform ?? "",
          agentModel: evaluator?.agentModel ?? "",
        };
      });

      const markdown = buildProposalsSummary(
        { title: topic.title, content: topic.content },
        proposals,
        enrichedScores
      );

      return {
        content: [{ type: "text", text: markdown }],
      };
    } catch (error) {
      logger.error("[Council] get_proposals failed", error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

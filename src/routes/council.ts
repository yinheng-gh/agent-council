import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  councilProposalsTable,
  councilScoresTable,
  councilTopicsTable,
} from "../db/schema";
import { getClientDefaults } from "../lib/client-context";
import { buildProposalsSummary, getCouncilGuideContent } from "../lib/council";
import db from "../lib/db";
import { logger } from "../lib/logger";
import { mcpServer } from "../lib/mcp-server";

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
    },
  },
  async ({ title, content, repo, commitId, tags }) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date();
      const topic = {
        id,
        title,
        content,
        status: "collecting" as const,
        repo: repo ?? "",
        commitId: commitId ?? "",
        tags: tags ?? "",
        proposalCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(councilTopicsTable).values(topic);
      logger.info(`[Council] Topic created: ${id}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, topic }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error("[Council] submit_topic failed", error);
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
  async ({ topicId, content, proposalType, round, agentPlatform, agentModel, scores }) => {
    try {
      const topicResult = await db
        .select({
          id: councilTopicsTable.id,
        })
        .from(councilTopicsTable)
        .where(eq(councilTopicsTable.id, topicId))
        .limit(1);

      if (topicResult.length === 0) {
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

      const id = crypto.randomUUID();
      const now = new Date();
      const type = proposalType ?? "independent";

      if (type === "independent" && scores && scores.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "scores is only allowed when proposalType is evaluation",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const defaults = getClientDefaults();
      const proposal = {
        id,
        topicId,
        content,
        proposalType: type,
        round: round ?? 1,
        agentPlatform: agentPlatform ?? defaults.platform,
        agentModel: agentModel ?? defaults.model,
        createdAt: now,
      };

      await db.insert(councilProposalsTable).values(proposal);

      if (type === "evaluation" && scores && scores.length > 0) {
        const scoreRecords = scores.map((score) => ({
          topicId,
          proposalId: score.proposalId,
          evaluatorProposalId: id,
          overall: score.overall,
          dimensions: JSON.stringify(score.dimensions ?? {}),
          createdAt: now,
        }));

        await db.insert(councilScoresTable).values(scoreRecords);
      }

      await db
        .update(councilTopicsTable)
        .set({
          proposalCount: sql`${councilTopicsTable.proposalCount} + 1`,
          updatedAt: now,
          ...(type === "evaluation" ? { status: "evaluating" as const } : {}),
        })
        .where(eq(councilTopicsTable.id, topicId));

      logger.info(`[Council] Proposal submitted: ${id}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, proposal }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error("[Council] submit_proposal failed", error);
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


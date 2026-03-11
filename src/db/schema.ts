import {
  index,
  int,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { timestamp } from "./custom-types";

export const councilTopicsTable = sqliteTable(
  "council_topics",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    content: text().notNull(),
    status: text({ enum: ["collecting", "evaluating", "completed"] })
      .default("collecting")
      .notNull(),
    repo: text().default("").notNull(),
    commitId: text("commit_id").default("").notNull(),
    tags: text().default("").notNull(),
    clientRequestId: text("client_request_id"),
    requestFingerprint: text("request_fingerprint"),
    requestBucket: int("request_bucket"),
    proposalCount: int("proposal_count").default(0).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("idx_ct_status").on(table.status),
    index("idx_ct_created_at").on(table.createdAt),
    uniqueIndex("uidx_ct_client_request_id").on(table.clientRequestId),
    uniqueIndex("uidx_ct_request_fingerprint_bucket").on(
      table.requestFingerprint,
      table.requestBucket,
    ),
  ]
);

export const councilProposalsTable = sqliteTable(
  "council_proposals",
  {
    id: text().primaryKey(),
    topicId: text("topic_id").notNull(),
    content: text().notNull(),
    proposalType: text("proposal_type", {
      enum: ["independent", "evaluation"],
    })
      .default("independent")
      .notNull(),
    round: int().default(1).notNull(),
    agentPlatform: text("agent_platform").default("").notNull(),
    agentModel: text("agent_model").default("").notNull(),
    clientRequestId: text("client_request_id"),
    requestFingerprint: text("request_fingerprint"),
    requestBucket: int("request_bucket"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_cp_topic_id").on(table.topicId),
    index("idx_cp_round").on(table.round),
    index("idx_cp_created_at").on(table.createdAt),
    uniqueIndex("uidx_cp_client_request_id").on(table.clientRequestId),
    uniqueIndex("uidx_cp_request_fingerprint_bucket").on(
      table.requestFingerprint,
      table.requestBucket,
    ),
  ]
);

export const councilScoresTable = sqliteTable(
  "council_scores",
  {
    id: int().primaryKey({ autoIncrement: true }),
    topicId: text("topic_id").notNull(),
    proposalId: text("proposal_id").notNull(),
    evaluatorProposalId: text("evaluator_proposal_id").notNull(),
    overall: real().notNull(),
    dimensions: text().default("{}").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_cs_topic_id").on(table.topicId),
    index("idx_cs_proposal_id").on(table.proposalId),
    index("idx_cs_evaluator_proposal_id").on(table.evaluatorProposalId),
  ]
);

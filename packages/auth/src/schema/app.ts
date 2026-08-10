import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** Which upstream a call went to. Stored as text so adding one is not a migration. */
export type ProviderId = "openrouter" | "replicate";

/**
 * Whose money paid for a call.
 *
 * `default` — the deployment's own provider keys, metered by {@link dailyAllowance}.
 * `byok`    — the caller's own key from {@link providerCredential}, never metered.
 *
 * Derived per provider per request (there is no stored preference): a credential
 * exists ⇒ `byok`, none ⇒ `default`.
 */
export type GenerationMode = "default" | "byok";

export type GenerationKind = "analysis" | "image";
export type GenerationStatus = "processing" | "succeeded" | "failed";

/**
 * A caller's own provider key, encrypted at rest.
 *
 * The plaintext never leaves the Worker: the web app encrypts on save, the API
 * decrypts to make one call, and clients only ever see {@link last4}.
 */
export const providerCredential = sqliteTable(
  "provider_credential",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderId>().notNull(),
    /** AES-GCM ciphertext, base64. */
    ciphertext: text("ciphertext").notNull(),
    /** Base64 IV, fresh per record — never reused across writes. */
    iv: text("iv").notNull(),
    /** The only part of the key ever shown back to a client. */
    last4: text("last4").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(now)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(now)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("provider_credential_user_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

/**
 * One row per provider call — the job record, the history entry, and the cost
 * audit line, deliberately the same row.
 *
 * A row exists even when the caller asked not to retain anything ({@link retained}
 * false): the poll needs something to reconcile against, and spend has to be
 * auditable whether or not the output was kept.
 */
export const generation = sqliteTable(
  "generation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Which API key made the call. Kept as plain text: the key row may be revoked. */
    apiKeyId: text("api_key_id"),
    kind: text("kind").$type<GenerationKind>().notNull(),
    mode: text("mode").$type<GenerationMode>().notNull(),
    provider: text("provider").$type<ProviderId>().notNull(),
    model: text("model").notNull(),
    status: text("status").$type<GenerationStatus>().notNull(),
    /** False when the caller turned sync off: no prompt, no source, no stored output. */
    retained: integer("retained", { mode: "boolean" }).default(false).notNull(),
    prompt: text("prompt"),
    sourceImageUrl: text("source_image_url"),
    /** The upstream's own id — a Replicate prediction id, an OpenRouter generation id. */
    providerRequestId: text("provider_request_id"),
    /** R2 object key. Null when not retained; the caller got a provider URL instead. */
    outputKey: text("output_key"),
    outputContentType: text("output_content_type"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /**
     * Integer micro-USD, never a float: 1_000_000 = $1. Currency in floating point
     * is how a ledger stops adding up.
     */
    costMicroUsd: integer("cost_micro_usd"),
    /**
     * `provider` — the upstream reported this figure. `estimate` — we priced it from
     * a local table. Recorded per row so changing the table never rewrites history.
     */
    costSource: text("cost_source").$type<"provider" | "estimate">(),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(now)
      .notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("generation_user_created_idx").on(table.userId, table.createdAt),
    index("generation_status_idx").on(table.status),
  ],
);

/**
 * A user's free allowance for one UTC day, on the deployment's own provider keys.
 *
 * Consumed with a single conditional upsert (see the API's allowance service), so
 * two concurrent requests cannot both pass a check that only one should.
 */
export const dailyAllowance = sqliteTable(
  "daily_allowance",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `YYYY-MM-DD`, UTC. */
    day: text("day").notNull(),
    analysesUsed: integer("analyses_used").default(0).notNull(),
    imagesUsed: integer("images_used").default(0).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(now)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.day] }),
  ],
);

/**
 * A per-account override of the free daily allowance.
 *
 * Nullable on purpose, one column at a time: null means "whatever the deployment
 * default is", so raising one person's image limit does not freeze their analysis
 * limit at today's default. Zero is a real value and means zero — that is how you
 * take the free allowance away from one account without touching anyone else.
 *
 * The deployment-wide ceiling in {@link systemAllowance} still applies on top. An
 * override says how much of the shared pot one account may take, not that the pot is
 * bigger.
 */
export const userAllowance = sqliteTable("user_allowance", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Null ⇒ use `DEFAULT_DAILY_ANALYSES`. */
  analysesLimit: integer("analyses_limit"),
  /** Null ⇒ use `DEFAULT_DAILY_IMAGES`. */
  imagesLimit: integer("images_limit"),
  /** Why this account is different, for whoever reads the row in six months. */
  note: text("note"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(now)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * The same counters for the whole deployment — the circuit breaker.
 *
 * Per-user ceilings bound one stranger; sign-up is open, so nothing bounds the
 * number of strangers. This row does: once the day's ceiling is spent, Default
 * requests are refused while BYOK carries on untouched.
 */
export const systemAllowance = sqliteTable("system_allowance", {
  /** `YYYY-MM-DD`, UTC. */
  day: text("day").primaryKey(),
  analysesUsed: integer("analyses_used").default(0).notNull(),
  imagesUsed: integer("images_used").default(0).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(now)
    .notNull(),
});

export const providerCredentialRelations = relations(
  providerCredential,
  ({ one }) => ({
    user: one(user, {
      fields: [providerCredential.userId],
      references: [user.id],
    }),
  }),
);

export const generationRelations = relations(generation, ({ one }) => ({
  user: one(user, {
    fields: [generation.userId],
    references: [user.id],
  }),
}));

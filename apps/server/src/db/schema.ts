// apps/server/src/db/schema.ts
import { pgTable, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import type { ExtractionRule } from '@signal/shared-types';

export const statusEnum = pgEnum('status', ['active', 'paused', 'error']);

export const trackers = pgTable('trackers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()), 
  userId: text('user_id').notNull(), // We'll hardcode a dummy user ID for now until auth is added
  targetUrl: text('target_url').notNull(),
  
  // Drizzle enforces that this JSON strictly matches the Gemini output type
  rule: jsonb('rule').$type<ExtractionRule>().notNull(),
  
  status: statusEnum('status').default('active').notNull(),
  lastCheckedAt: timestamp('last_checked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
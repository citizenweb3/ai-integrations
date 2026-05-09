import { desc, eq } from 'drizzle-orm';

import db from '@/db';
import { chatLogs, type ChatLog, type NewChatLog } from '@/db/schema';

export type FeedbackValue = 'up' | 'down';

const record = async (input: NewChatLog): Promise<ChatLog> => {
  const [log] = await db.insert(chatLogs).values(input).returning();
  return log;
};

const recordFeedback = async (
  id: number,
  feedback: FeedbackValue,
  feedbackComment?: string,
): Promise<ChatLog | null> => {
  const [log] = await db
    .update(chatLogs)
    .set({
      feedback,
      feedbackComment: feedbackComment?.trim() || null,
    })
    .where(eq(chatLogs.id, id))
    .returning();

  return log ?? null;
};

const listRecent = async (limit = 50): Promise<ChatLog[]> => {
  return db.select().from(chatLogs).orderBy(desc(chatLogs.createdAt)).limit(limit);
};

const chatLogService = {
  record,
  recordFeedback,
  listRecent,
};

export default chatLogService;

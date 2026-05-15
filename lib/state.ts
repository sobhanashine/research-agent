import { Redis } from "@upstash/redis";

export type SessionStage = "awaiting_topic" | "awaiting_answers" | "researching";

export interface Session {
  stage: SessionStage;
  topic?: string;
  questions?: string[];
  answers?: string;
  messageId?: number;
}

let _redis: Redis | null = null;
function redis() {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

const key = (chatId: number) => `ra:session:${chatId}`;

export async function getSession(chatId: number): Promise<Session | null> {
  const data = await redis().get<Session>(key(chatId));
  return data ?? null;
}

export async function setSession(chatId: number, session: Session) {
  await redis().set(key(chatId), session, { ex: 60 * 60 * 6 });
}

export async function clearSession(chatId: number) {
  await redis().del(key(chatId));
}

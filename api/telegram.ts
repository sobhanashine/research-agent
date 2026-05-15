import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMessage, sendDocument, sendChatAction } from "../lib/telegram.js";
import { getSession, setSession, clearSession } from "../lib/state.js";
import { generateClarifyingQuestions, performResearch } from "../lib/research.js";
import { buildDocx, sanitizeFilename } from "../lib/docx.js";

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Respond to Telegram immediately to avoid retries; do work async.
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const update = req.body;
  res.status(200).send("ok");

  try {
    const msg = update?.message;
    if (!msg || !msg.text) return;

    const chatId: number = msg.chat.id;
    const text: string = msg.text.trim();
    const messageId: number = msg.message_id;

    if (text === "/start" || text === "/help") {
      await clearSession(chatId);
      await sendMessage(
        token,
        chatId,
        "👋 *Research Agent*\n\nSend me a research *title* or topic and I'll:\n1. Ask a few clarifying questions\n2. Research it with live web search\n3. Reply with a Word (.docx) report\n\nCommands:\n/start — reset\n/cancel — cancel current session"
      );
      return;
    }

    if (text === "/cancel") {
      await clearSession(chatId);
      await sendMessage(token, chatId, "❌ Cancelled. Send a new topic to begin.");
      return;
    }

    const session = await getSession(chatId);

    if (!session || session.stage === "awaiting_topic") {
      await sendChatAction(token, chatId, "typing");
      const questions = await generateClarifyingQuestions(text);
      await setSession(chatId, {
        stage: "awaiting_answers",
        topic: text,
        questions,
        messageId,
      });
      const formatted = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
      await sendMessage(
        token,
        chatId,
        `🔍 Topic received: *${text}*\n\nPlease answer these clarifying questions in *one message* (you can answer briefly or say "any"):\n\n${formatted}`,
        messageId
      );
      return;
    }

    if (session.stage === "awaiting_answers") {
      await sendMessage(token, chatId, "🧠 Researching... this may take 30-60 seconds.", session.messageId);
      await sendChatAction(token, chatId, "upload_document");

      await setSession(chatId, { ...session, stage: "researching", answers: text });

      try {
        const result = await performResearch(session.topic!, session.questions ?? [], text);
        const buffer = await buildDocx(result);
        const filename = `${sanitizeFilename(result.title)}.docx`;
        await sendDocument(
          token,
          chatId,
          filename,
          buffer,
          `✅ Research complete: ${result.title}`,
          session.messageId
        );
      } catch (err: any) {
        console.error("Research error:", err);
        await sendMessage(token, chatId, `⚠️ Research failed: ${err?.message ?? "unknown error"}`, session.messageId);
      } finally {
        await clearSession(chatId);
      }
      return;
    }

    if (session.stage === "researching") {
      await sendMessage(token, chatId, "⏳ Still working on your previous request. Send /cancel to abort.");
    }
  } catch (err) {
    console.error("Handler error:", err);
  }
}

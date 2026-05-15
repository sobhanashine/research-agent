import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMessage, sendDocument, sendChatAction, editMessage, deleteMessage } from "../lib/telegram.js";
import { getSession, setSession, clearSession } from "../lib/state.js";
import { generateClarifyingQuestions, performResearch } from "../lib/research.js";
import { buildDocx, sanitizeFilename } from "../lib/docx.js";

export const config = { maxDuration: 60 };

async function status(token: string, chatId: number, messageId: number, text: string) {
  try {
    await editMessage(token, chatId, messageId, text);
  } catch {}
  await sendChatAction(token, chatId, "typing").catch(() => {});
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    // STAGE 1: topic received → generate clarifying questions
    if (!session || session.stage === "awaiting_topic") {
      await sendChatAction(token, chatId, "typing");
      const statusMsg: any = await sendMessage(
        token,
        chatId,
        `📝 Topic received: *${text}*\n\n🤔 Analyzing and preparing clarifying questions...`,
        messageId
      );
      const statusId: number | undefined = statusMsg?.result?.message_id;

      try {
        const questions = await generateClarifyingQuestions(text);
        await setSession(chatId, {
          stage: "awaiting_answers",
          topic: text,
          questions,
          messageId,
        });
        const formatted = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
        const body = `🔍 Topic: *${text}*\n\nPlease answer these clarifying questions in *one message* (write \`any\` to skip):\n\n${formatted}`;
        if (statusId) await editMessage(token, chatId, statusId, body);
        else await sendMessage(token, chatId, body, messageId);
      } catch (err: any) {
        const errBody = `⚠️ Failed to generate questions: ${err?.message ?? "unknown error"}`;
        if (statusId) await editMessage(token, chatId, statusId, errBody);
        else await sendMessage(token, chatId, errBody);
        await clearSession(chatId);
      }
      return;
    }

    // STAGE 2: answers received → run research → build doc → send
    if (session.stage === "awaiting_answers") {
      const statusMsg: any = await sendMessage(
        token,
        chatId,
        "🚀 *Starting research...*\n\n⏳ Step 1/4 — Preparing search queries",
        session.messageId
      );
      const statusId: number | undefined = statusMsg?.result?.message_id;
      const update = (t: string) => statusId && status(token, chatId, statusId, t);

      await setSession(chatId, { ...session, stage: "researching", answers: text });

      try {
        await update("🔎 *Step 2/4* — Searching the web with Google Search\n\n_This may take 30–45 seconds..._");
        await sendChatAction(token, chatId, "typing");

        const result = await performResearch(session.topic!, session.questions ?? [], text);

        await update(`📝 *Step 3/4* — Writing report: _${result.title}_\n\n✅ Found ${result.sources.length} source${result.sources.length === 1 ? "" : "s"}`);

        const buffer = await buildDocx(result);

        await update(`📄 *Step 4/4* — Generating Word document\n\n📤 Uploading *${result.title}.docx*...`);
        await sendChatAction(token, chatId, "upload_document");

        const filename = `${sanitizeFilename(result.title)}.docx`;
        await sendDocument(
          token,
          chatId,
          filename,
          buffer,
          `✅ Research complete: *${result.title}*\n\n📚 ${result.sources.length} source${result.sources.length === 1 ? "" : "s"} cited inside the document.`,
          session.messageId
        );

        if (statusId) await deleteMessage(token, chatId, statusId);
      } catch (err: any) {
        console.error("Research error:", err);
        const errBody = `⚠️ *Research failed*\n\n${err?.message ?? "unknown error"}\n\nSend a new topic to try again.`;
        if (statusId) await editMessage(token, chatId, statusId, errBody);
        else await sendMessage(token, chatId, errBody, session.messageId);
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

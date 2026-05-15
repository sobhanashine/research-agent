import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMessage, sendDocument, sendChatAction, editMessage, deleteMessage } from "../lib/telegram.js";
import { getSession, setSession, clearSession, markUpdateSeen } from "../lib/state.js";
import { generateClarifyingQuestions, performResearch } from "../lib/research.js";
import { buildDocx, sanitizeFilename } from "../lib/docx.js";

export const config = { maxDuration: 60 };
//s
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

  // Ack Telegram immediately so it does not retry the webhook (which caused
  // duplicate /start messages). Processing continues after the response.
  res.status(200).send("ok");

  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const update = req.body;

  try {
    const updateId: number | undefined = update?.update_id;
    if (typeof updateId === "number") {
      const fresh = await markUpdateSeen(updateId);
      if (!fresh) return;
    }

    const msg = update?.message;
    if (!msg || !msg.text) return;

    const chatId: number = msg.chat.id;
    const text: string = msg.text.trim();
    const messageId: number = msg.message_id;

    if (text === "/start") {
      await clearSession(chatId);
      const firstName = msg.from?.first_name ? ` ${msg.from.first_name}` : "";
      await sendMessage(
        token,
        chatId,
        `👋 Hello${firstName}! Welcome aboard.`
      );
      await new Promise((r) => setTimeout(r, 600));
      await sendMessage(
        token,
        chatId,
        "🤖 *I'm your Research Agent.*\n\nI turn any topic into a polished Word document — powered by live web search and AI.\n\n*Here's how it works:*\n1️⃣  You send me a research *title* or topic\n2️⃣  I ask 3–5 quick clarifying questions to focus the research\n3️⃣  You answer them in a single message\n4️⃣  I search the web, write a structured report, and send you a *.docx* file with cited sources\n\n*Commands:*\n• /start — restart the conversation\n• /help — show this intro again\n• /cancel — cancel the current research\n\n✨ Ready when you are — *send me a topic to begin!*"
      );
      return;
    }

    if (text === "/help") {
      await sendMessage(
        token,
        chatId,
        "🤖 *Research Agent — Help*\n\nSend me a research *title* and I'll:\n1. Ask clarifying questions\n2. Search the web\n3. Reply with a Word (.docx) report\n\n*Commands:*\n• /start — restart\n• /cancel — cancel current research\n\nJust send a topic to begin!"
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

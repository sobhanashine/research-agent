import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });
import { sendMessage, sendDocument, sendChatAction, editMessage, deleteMessage } from "../lib/telegram.js";
import { getSession, setSession, clearSession } from "../lib/state.js";
import { generateClarifyingQuestions, performResearch } from "../lib/research.js";
import { buildDocx, sanitizeFilename } from "../lib/docx.js";

const token = process.env.TELEGRAM_BOT_TOKEN!;
const TG = `https://api.telegram.org/bot${token}`;

function log(...args: any[]) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...args);
}

async function handleUpdate(update: any) {
  const msg = update?.message;
  if (!msg || !msg.text) return;

  const chatId: number = msg.chat.id;
  const text: string = msg.text.trim();
  const messageId: number = msg.message_id;

  log(`📨 from ${msg.from?.username || msg.from?.id} (chat ${chatId}): "${text}"`);

  try {
    if (text === "/start") {
      await clearSession(chatId);
      const firstName = msg.from?.first_name ? ` ${msg.from.first_name}` : "";
      log("→ sending hello");
      await sendMessage(token, chatId, `👋 Hello${firstName}! Welcome aboard.`);
      await new Promise((r) => setTimeout(r, 600));
      log("→ sending intro");
      await sendMessage(
        token,
        chatId,
        "🤖 *I'm your Research Agent.*\n\nI turn any topic into a polished Word document — powered by live web search and AI.\n\n*Here's how it works:*\n1️⃣  You send me a research *title* or topic\n2️⃣  I ask 3–5 quick clarifying questions to focus the research\n3️⃣  You answer them in a single message\n4️⃣  I search the web, write a structured report, and send you a *.docx* file with cited sources\n\n*Commands:*\n• /start — restart the conversation\n• /help — show this intro again\n• /cancel — cancel the current research\n\n✨ Ready when you are — *send me a topic to begin!*"
      );
      return;
    }

    if (text === "/help") {
      await sendMessage(token, chatId, "🤖 *Research Agent — Help*\n\nSend me a research *title* and I'll:\n1. Ask clarifying questions\n2. Search the web\n3. Reply with a Word (.docx) report\n\n*Commands:*\n• /start — restart\n• /cancel — cancel current research\n\nJust send a topic to begin!");
      return;
    }

    if (text === "/cancel") {
      await clearSession(chatId);
      await sendMessage(token, chatId, "❌ Cancelled. Send a new topic to begin.");
      return;
    }

    const session = await getSession(chatId);
    log("session stage:", session?.stage ?? "none");

    if (!session || session.stage === "awaiting_topic") {
      await sendChatAction(token, chatId, "typing");
      const statusMsg: any = await sendMessage(
        token,
        chatId,
        `📝 Topic received: *${text}*\n\n🤔 Analyzing and preparing clarifying questions...`,
        messageId
      );
      const statusId: number | undefined = statusMsg?.result?.message_id;

      log("→ calling Gemini for clarifying questions");
      const questions = await generateClarifyingQuestions(text);
      log("✓ got", questions.length, "questions");

      await setSession(chatId, { stage: "awaiting_answers", topic: text, questions, messageId });
      const formatted = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
      const body = `🔍 Topic: *${text}*\n\nPlease answer these clarifying questions in *one message* (write \`any\` to skip):\n\n${formatted}`;
      if (statusId) await editMessage(token, chatId, statusId, body);
      else await sendMessage(token, chatId, body, messageId);
      return;
    }

    if (session.stage === "awaiting_answers") {
      const statusMsg: any = await sendMessage(
        token,
        chatId,
        "🚀 *Starting research...*\n\n⏳ Step 1/4 — Preparing search queries",
        session.messageId
      );
      const statusId: number | undefined = statusMsg?.result?.message_id;
      await setSession(chatId, { ...session, stage: "researching", answers: text });

      try {
        log("→ research: searching web");
        if (statusId) await editMessage(token, chatId, statusId, "🔎 *Step 2/4* — Searching the web with Google Search\n\n_This may take 30–45 seconds..._");
        await sendChatAction(token, chatId, "typing");

        const result = await performResearch(session.topic!, session.questions ?? [], text);
        log("✓ research done. title:", result.title, "sources:", result.sources.length);

        if (statusId) await editMessage(token, chatId, statusId, `📝 *Step 3/4* — Writing report: _${result.title}_\n\n✅ Found ${result.sources.length} source${result.sources.length === 1 ? "" : "s"}`);

        log("→ building docx");
        const buffer = await buildDocx(result);
        log("✓ docx built,", buffer.length, "bytes");

        if (statusId) await editMessage(token, chatId, statusId, `📄 *Step 4/4* — Generating Word document\n\n📤 Uploading *${result.title}.docx*...`);
        await sendChatAction(token, chatId, "upload_document");

        const filename = `${sanitizeFilename(result.title)}.docx`;
        log("→ sending document");
        await sendDocument(
          token,
          chatId,
          filename,
          buffer,
          `✅ Research complete: *${result.title}*\n\n📚 ${result.sources.length} source${result.sources.length === 1 ? "" : "s"} cited inside the document.`,
          session.messageId
        );
        log("✓ document sent");
        if (statusId) await deleteMessage(token, chatId, statusId);
      } catch (err: any) {
        log("❌ research error:", err?.message ?? err);
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
  } catch (err: any) {
    log("❌ HANDLER ERROR:", err?.stack || err?.message || err);
    try { await sendMessage(token, chatId, `⚠️ Error: ${err?.message ?? "unknown"}`); } catch {}
  }
}

async function main() {
  log("🤖 Research Agent — local polling mode");
  log("clearing webhook (so polling works)...");
  const wh = await fetch(`${TG}/deleteWebhook?drop_pending_updates=false`).then((r) => r.json());
  log("deleteWebhook:", wh);

  const me = await fetch(`${TG}/getMe`).then((r) => r.json());
  log("getMe:", me?.result?.username ? `@${me.result.username}` : me);

  let offset = 0;
  log("🟢 polling for messages... (Ctrl+C to stop)");
  while (true) {
    try {
      const res: any = await fetch(`${TG}/getUpdates?timeout=25&offset=${offset}`).then((r) => r.json());
      if (!res.ok) {
        log("getUpdates not ok:", res);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const update of res.result) {
        offset = update.update_id + 1;
        // Don't await — allow concurrent processing of fast messages
        handleUpdate(update).catch((e) => log("update crashed:", e));
      }
    } catch (e: any) {
      log("poll loop error:", e?.message ?? e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();

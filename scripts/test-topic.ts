import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { sendMessage, sendDocument, sendChatAction, editMessage, deleteMessage } from "../lib/telegram.js";
import { getSession, setSession, clearSession } from "../lib/state.js";
import { generateClarifyingQuestions, performResearch } from "../lib/research.js";
import { buildDocx, sanitizeFilename } from "../lib/docx.js";

const token = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = 683697189;
const TOPIC = process.argv[2] || "Impact of AI on healthcare in 2025";
const ANSWERS = process.argv[3] || "any";

function log(...args: any[]) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...args);
}

async function main() {
  log("🧪 simulating a full conversation");
  await clearSession(CHAT_ID);

  // Step 1: send topic
  log(`📨 simulated user message: "${TOPIC}"`);
  await sendMessage(token, CHAT_ID, `🧪 *Test injection* — simulating topic:\n\n_${TOPIC}_`);
  await sendChatAction(token, CHAT_ID, "typing");

  const statusMsg: any = await sendMessage(
    token,
    CHAT_ID,
    `📝 Topic received: *${TOPIC}*\n\n🤔 Analyzing and preparing clarifying questions...`
  );
  const statusId: number | undefined = statusMsg?.result?.message_id;

  log("→ calling Gemini for clarifying questions");
  const questions = await generateClarifyingQuestions(TOPIC);
  log("✓ got", questions.length, "questions:", questions);

  const formatted = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const body = `🔍 Topic: *${TOPIC}*\n\nClarifying questions:\n\n${formatted}\n\n💡 _Auto-answering with: "${ANSWERS}"_`;
  if (statusId) await editMessage(token, CHAT_ID, statusId, body);

  // Step 2: simulate user answers, run research
  await new Promise((r) => setTimeout(r, 1500));
  const status2: any = await sendMessage(token, CHAT_ID, "🚀 *Starting research...*\n\n⏳ Step 1/4 — Preparing search queries");
  const s2 = status2?.result?.message_id;

  log("→ research: searching web");
  if (s2) await editMessage(token, CHAT_ID, s2, "🔎 *Step 2/4* — Searching the web with Google Search\n\n_This may take 30–45 seconds..._");
  await sendChatAction(token, CHAT_ID, "typing");

  const result = await performResearch(TOPIC, questions, ANSWERS);
  log("✓ research done. title:", result.title, "| sources:", result.sources.length, "| markdown chars:", result.markdown.length);

  if (s2) await editMessage(token, CHAT_ID, s2, `📝 *Step 3/4* — Writing report: _${result.title}_\n\n✅ Found ${result.sources.length} source${result.sources.length === 1 ? "" : "s"}`);

  log("→ building docx");
  const buffer = await buildDocx(result);
  log("✓ docx built,", buffer.length, "bytes");

  if (s2) await editMessage(token, CHAT_ID, s2, `📄 *Step 4/4* — Generating Word document\n\n📤 Uploading *${result.title}.docx*...`);
  await sendChatAction(token, CHAT_ID, "upload_document");

  const filename = `${sanitizeFilename(result.title)}.docx`;
  log("→ sending document:", filename);
  await sendDocument(
    token,
    CHAT_ID,
    filename,
    buffer,
    `✅ Test research complete: *${result.title}*\n\n📚 ${result.sources.length} source${result.sources.length === 1 ? "" : "s"} cited inside.`
  );
  log("✓ document sent");
  if (s2) await deleteMessage(token, CHAT_ID, s2);

  await clearSession(CHAT_ID);
  log("✅ test complete");
}

main().catch((e) => {
  console.error("❌ TEST ERROR:", e?.stack || e);
  process.exit(1);
});

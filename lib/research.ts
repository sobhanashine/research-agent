import { GoogleGenerativeAI } from "@google/generative-ai";

function client() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 6): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      const is429 = msg.includes("429") || msg.toLowerCase().includes("too many requests") || msg.toLowerCase().includes("quota");
      if (!is429 || attempt === maxAttempts) throw err;
      const retryMatch = msg.match(/retry in ([\d.]+)s/i);
      const waitSec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 1 : Math.min(60, 15 * attempt);
      console.log(`[${label}] 429 hit, retry ${attempt}/${maxAttempts} after ${waitSec}s`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastErr;
}

export async function generateClarifyingQuestions(topic: string): Promise<string[]> {
  const model = client().getGenerativeModel({ model: "gemini-2.5-flash" });
  const prompt = `You are a research assistant. The user wants to research this topic:

"${topic}"

Generate 3-5 short clarifying questions to narrow down scope, audience, depth, and focus.
Return ONLY a JSON array of strings, no markdown, no extra text. Example:
["Question 1?", "Question 2?", "Question 3?"]`;

  const result = await withRetry(() => model.generateContent(prompt), "clarify");
  const text = result.response.text().trim();
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.slice(0, 5).map(String);
  } catch {}
  return [
    "What is the main purpose of this research (academic, business, personal)?",
    "Who is the target audience?",
    "How deep should the analysis go (overview vs. in-depth)?",
    "Are there specific subtopics or angles to focus on?",
  ];
}

export interface ResearchResult {
  title: string;
  markdown: string;
  sources: { title: string; uri: string }[];
}

export async function performResearch(
  topic: string,
  questions: string[],
  answers: string
): Promise<ResearchResult> {
  const model = client().getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ googleSearch: {} } as any],
  });

  const prompt = `You are an expert research assistant. Produce a thorough, well-structured research report.

TOPIC: ${topic}

CLARIFYING QUESTIONS ASKED:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

USER'S ANSWERS / EXTRA CONTEXT:
${answers}

INSTRUCTIONS:
- Use Google Search to gather up-to-date, accurate information.
- Write a comprehensive report in Markdown.
- Start with a single H1 title line: # <Title>
- Include an Executive Summary, then logical sections with H2 headings.
- Use bullet points and short paragraphs where appropriate.
- End with a "## Key Takeaways" section.
- Be factual; do NOT fabricate citations. Sources will be appended automatically.
- Length: aim for 800-1500 words depending on depth needed.

Output ONLY the Markdown report.`;

  const result = await withRetry(() => model.generateContent(prompt), "research");
  const response = result.response;
  const text = response.text();

  const grounding = (response as any).candidates?.[0]?.groundingMetadata;
  const chunks = grounding?.groundingChunks ?? [];
  const sources: { title: string; uri: string }[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const uri = c?.web?.uri;
    const title = c?.web?.title ?? uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title, uri });
    }
  }

  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : topic;

  return { title, markdown: text, sources };
}

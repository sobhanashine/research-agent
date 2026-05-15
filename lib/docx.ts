import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  ExternalHyperlink,
  AlignmentType,
} from "docx";
import type { ResearchResult } from "./research.js";

function parseInline(line: string): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) runs.push(new TextRun(line.slice(last, m.index)));
    if (m[2]) runs.push(new TextRun({ text: m[2], bold: true }));
    else if (m[4]) runs.push(new TextRun({ text: m[4], italics: true }));
    else if (m[6]) runs.push(new TextRun({ text: m[6], font: "Consolas" }));
    else if (m[8])
      runs.push(
        new ExternalHyperlink({
          link: m[9],
          children: [new TextRun({ text: m[8], style: "Hyperlink", color: "0563C1", underline: {} })],
        })
      );
    last = regex.lastIndex;
  }
  if (last < line.length) runs.push(new TextRun(line.slice(last)));
  return runs.length ? runs : [new TextRun(line)];
}

function mdToParagraphs(md: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = md.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }
    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: parseInline(line.slice(2)),
        })
      );
    } else if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(line.slice(3)) }));
    } else if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInline(line.slice(4)) }));
    } else if (/^[-*]\s+/.test(line)) {
      paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(line.replace(/^[-*]\s+/, "")) }));
    } else if (/^\d+\.\s+/.test(line)) {
      paragraphs.push(new Paragraph({ numbering: { reference: "num", level: 0 }, children: parseInline(line.replace(/^\d+\.\s+/, "")) }));
    } else {
      paragraphs.push(new Paragraph({ children: parseInline(line) }));
    }
  }
  return paragraphs;
}

export async function buildDocx(result: ResearchResult): Promise<Buffer> {
  const body = mdToParagraphs(result.markdown);

  if (result.sources.length) {
    body.push(new Paragraph({ children: [new TextRun("")] }));
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Sources")] }));
    for (const s of result.sources) {
      body.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new ExternalHyperlink({
              link: s.uri,
              children: [new TextRun({ text: s.title || s.uri, style: "Hyperlink", color: "0563C1", underline: {} })],
            }),
          ],
        })
      );
    }
  }

  const doc = new Document({
    creator: "Research Agent",
    title: result.title,
    sections: [{ children: body }],
  });

  return await Packer.toBuffer(doc);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 \-_]/g, "").trim().slice(0, 60).replace(/\s+/g, "_") || "research";
}

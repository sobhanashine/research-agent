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

const PERSIAN_FONT = "Vazirmatn";
const LATIN_FONT = "Calibri";
const RTL_REGEX = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

function isRtl(text: string): boolean {
  if (!text) return false;
  const rtlMatches = text.match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g);
  const latinMatches = text.match(/[A-Za-z]/g);
  const rtlCount = rtlMatches ? rtlMatches.length : 0;
  const latinCount = latinMatches ? latinMatches.length : 0;
  return rtlCount > 0 && rtlCount >= latinCount;
}

function runProps(text: string, extra: Record<string, any> = {}): any {
  const rtl = RTL_REGEX.test(text);
  return {
    text,
    font: { ascii: LATIN_FONT, hAnsi: LATIN_FONT, cs: PERSIAN_FONT },
    rightToLeft: rtl,
    ...extra,
  };
}

function parseInline(line: string): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) runs.push(new TextRun(runProps(line.slice(last, m.index))));
    if (m[2]) runs.push(new TextRun(runProps(m[2], { bold: true })));
    else if (m[4]) runs.push(new TextRun(runProps(m[4], { italics: true })));
    else if (m[6]) runs.push(new TextRun({ text: m[6], font: "Consolas" }));
    else if (m[8])
      runs.push(
        new ExternalHyperlink({
          link: m[9],
          children: [new TextRun(runProps(m[8], { style: "Hyperlink", color: "0563C1", underline: {} }))],
        })
      );
    last = regex.lastIndex;
  }
  if (last < line.length) runs.push(new TextRun(runProps(line.slice(last))));
  return runs.length ? runs : [new TextRun(runProps(line))];
}

function paragraph(opts: any, sourceText: string): Paragraph {
  const rtl = isRtl(sourceText);
  return new Paragraph({
    ...opts,
    bidirectional: rtl,
    alignment:
      opts.alignment ??
      (rtl ? AlignmentType.RIGHT : undefined),
  });
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
      const text = line.slice(2);
      paragraphs.push(
        paragraph(
          {
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: parseInline(text),
          },
          text
        )
      );
    } else if (line.startsWith("## ")) {
      const text = line.slice(3);
      paragraphs.push(paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(text) }, text));
    } else if (line.startsWith("### ")) {
      const text = line.slice(4);
      paragraphs.push(paragraph({ heading: HeadingLevel.HEADING_3, children: parseInline(text) }, text));
    } else if (/^[-*]\s+/.test(line)) {
      const text = line.replace(/^[-*]\s+/, "");
      paragraphs.push(paragraph({ bullet: { level: 0 }, children: parseInline(text) }, text));
    } else if (/^\d+\.\s+/.test(line)) {
      const text = line.replace(/^\d+\.\s+/, "");
      paragraphs.push(paragraph({ numbering: { reference: "num", level: 0 }, children: parseInline(text) }, text));
    } else {
      paragraphs.push(paragraph({ children: parseInline(line) }, line));
    }
  }
  return paragraphs;
}

export async function buildDocx(result: ResearchResult): Promise<Buffer> {
  const body = mdToParagraphs(result.markdown);
  const rtlDoc = isRtl(result.markdown);
  const sourcesLabel = rtlDoc ? "منابع" : "Sources";

  if (result.sources.length) {
    body.push(new Paragraph({ children: [new TextRun("")] }));
    body.push(
      paragraph(
        { heading: HeadingLevel.HEADING_2, children: [new TextRun(runProps(sourcesLabel))] },
        sourcesLabel
      )
    );
    for (const s of result.sources) {
      const label = s.title || s.uri;
      body.push(
        paragraph(
          {
            bullet: { level: 0 },
            children: [
              new ExternalHyperlink({
                link: s.uri,
                children: [new TextRun(runProps(label, { style: "Hyperlink", color: "0563C1", underline: {} }))],
              }),
            ],
          },
          label
        )
      );
    }
  }

  const doc = new Document({
    creator: "Research Agent",
    title: result.title,
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: LATIN_FONT, hAnsi: LATIN_FONT, cs: PERSIAN_FONT },
          },
        },
      },
    },
    sections: [{ children: body }],
  });

  return await Packer.toBuffer(doc);
}

export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\/\\?%*:|"<>\x00-\x1F]/g, "")
      .trim()
      .slice(0, 60)
      .replace(/\s+/g, "_") || "research"
  );
}

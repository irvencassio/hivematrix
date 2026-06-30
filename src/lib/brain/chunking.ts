import { chunkId, type BrainChunk } from "./index-db";

export interface ChunkDocumentOptions {
  chunkWords?: number;
  chunkOverlapWords?: number;
}

interface Section {
  heading: string | null;
  lines: string[];
}

function estimateTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function pushSection(sections: Section[], heading: string | null, lines: string[]): void {
  const text = lines.join("\n").trim();
  if (!text) return;
  sections.push({ heading, lines: [text] });
}

function sectionsFromMarkdown(text: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let lines: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      pushSection(sections, heading, lines);
      heading = match[2].trim();
      lines = [line];
      continue;
    }
    lines.push(line);
  }
  pushSection(sections, heading, lines);
  return sections;
}

export function chunkDocument(
  text: string,
  relPath: string,
  options: ChunkDocumentOptions = {},
): BrainChunk[] {
  if (!text.trim()) return [];

  const targetWords = Math.min(Math.max(options.chunkWords ?? 500, 1), 700);
  const overlapWords = Math.min(Math.max(options.chunkOverlapWords ?? 100, 0), targetWords - 1);
  const chunks: BrainChunk[] = [];

  for (const section of sectionsFromMarkdown(text)) {
    const sectionText = section.lines.join("\n").trim();
    const words = sectionText.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    let start = 0;
    while (start < words.length) {
      const slice = words.slice(start, start + targetWords);
      const chunkIndex = chunks.length;
      const chunkText = slice.join(" ");
      chunks.push({
        id: chunkId(relPath, chunkIndex),
        path: relPath,
        chunkIndex,
        heading: section.heading,
        text: chunkText,
        tokenEstimate: Math.max(1, estimateTokens(chunkText)),
      });
      if (start + targetWords >= words.length) break;
      start += targetWords - overlapWords;
    }
  }

  return chunks;
}

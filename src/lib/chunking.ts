export type ChunkType = 'theory' | 'formula' | 'case' | 'default';

export interface TextChunk {
  index: number;
  text: string;
  charCount: number;
  preview: { head: string; tail: string };
}

const TARGET_SIZE: Record<ChunkType, number> = {
  theory: 400,
  formula: 650,
  case: 900,
  default: 600,
};

function chunkPreview(text: string): { head: string; tail: string } {
  const t = text.trim();
  const head = t.slice(0, 30);
  const tail = t.length > 60 ? '…' + t.slice(-20) : '';
  return { head, tail };
}

function hardSplit(text: string, size: number): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < text.length) {
    result.push(text.slice(i, i + size));
    i += size;
  }
  return result;
}

function splitBySentence(text: string, targetSize: number): string[] {
  const parts = text.split(/(?<=[。；！？\n])/);
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if ((current + part).length <= targetSize * 1.5) {
      current += part;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function splitTextIntoChunks(text: string, chunkType: ChunkType = 'default'): TextChunk[] {
  const target = TARGET_SIZE[chunkType];
  const minSize = Math.floor(target * 0.3);

  // Split by blank lines first
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  // Group paragraphs into chunks near target size
  const rawChunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (para.length > target * 1.5) {
      // Oversized paragraph: split by sentence
      if (current.trim()) { rawChunks.push(current.trim()); current = ''; }
      for (const sub of splitBySentence(para, target)) {
        if (sub.length > target * 2) {
          // Still too long: hard split
          rawChunks.push(...hardSplit(sub, target));
        } else {
          rawChunks.push(sub);
        }
      }
    } else if ((current + '\n\n' + para).length <= target * 1.4) {
      current = current ? current + '\n\n' + para : para;
    } else {
      if (current.trim()) rawChunks.push(current.trim());
      current = para;
    }
  }
  if (current.trim()) rawChunks.push(current.trim());

  // Merge trailing short chunks into previous
  const merged: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i];
    if (chunk.length < minSize && merged.length > 0) {
      merged[merged.length - 1] += '\n\n' + chunk;
    } else {
      merged.push(chunk);
    }
  }

  return merged.map((text, i) => ({
    index: i,
    text,
    charCount: text.length,
    preview: chunkPreview(text),
  }));
}

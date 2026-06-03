import type { Section } from '../types.js';

// Section-level (not line-level): the ~18.7% token-spend noise floor means only
// heading-sized chunks move spend distinguishably from noise.

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

interface Building extends Section {
  _lines: string[];
}

export function splitSections(content: string): { sections: Section[]; lines: string[] } {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Building | null = null;

  const push = (): void => {
    if (!current) return;
    current.endLine = current._lines.length
      ? current.startLine + current._lines.length - 1
      : current.startLine;
    current.text = current._lines.join('\n');
    const { _lines, ...section } = current;
    void _lines;
    sections.push(section);
  };

  lines.forEach((line, idx) => {
    const m = HEADING_RE.exec(line);
    if (m) {
      push();
      const level = m[1]!.length;
      const heading = m[2]!.trim();
      current = {
        id: slug(heading || `section-${sections.length + 1}`, sections),
        heading,
        level,
        startLine: idx,
        endLine: idx,
        text: '',
        _lines: [line],
      };
    } else if (current) {
      current._lines.push(line);
    } else {
      current = {
        id: 'preamble',
        heading: null,
        level: 0,
        startLine: idx,
        endLine: idx,
        text: '',
        _lines: [line],
      };
    }
  });
  push();

  // Drop a blank-only preamble.
  const meaningful = sections.filter((s) => !(s.heading === null && s.text.trim() === ''));
  return { sections: meaningful, lines };
}

// Leave-one-out ablation; collapse 3+ newlines so the omitted gap doesn't skew spend.
export function buildAblated(sections: Section[], omitId: string): string {
  return (
    sections
      .filter((s) => s.id !== omitId)
      .map((s) => s.text)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

export function buildFull(sections: Section[]): string {
  return (
    sections
      .map((s) => s.text)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

function slug(s: string, existing: Section[]): string {
  const base =
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'section';
  let id = base;
  let n = 2;
  const taken = new Set(existing.map((x) => x.id));
  while (taken.has(id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

// Rough estimate (~4 chars/token) for display before a real run.
export function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

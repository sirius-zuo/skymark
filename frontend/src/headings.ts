export interface HeadingEntry {
  text: string;
  level: number;
  line: number;
  absPath: string;
  relPath: string;
  fileName: string;
}

export interface HeadingIndex {
  index(absPath: string, relPath: string, fileName: string, content: string): void;
  remove(absPath: string): void;
  getAll(): HeadingEntry[];
  search(query: string): HeadingEntry[];
}

export function createHeadingIndex(): HeadingIndex {
  const store = new Map<string, HeadingEntry[]>();

  function allSorted(): HeadingEntry[] {
    const all: HeadingEntry[] = [];
    for (const es of store.values()) all.push(...es);
    all.sort((a, b) =>
      a.absPath < b.absPath ? -1 : a.absPath > b.absPath ? 1 : a.line - b.line
    );
    return all;
  }

  return {
    index(absPath, relPath, fileName, content) {
      const result: HeadingEntry[] = [];
      const re = /^(#{1,6}) +(.+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const level = m[1].length;
        const text = m[2].trim();
        const line = content.slice(0, m.index).split("\n").length - 1;
        result.push({ text, level, line, absPath, relPath, fileName });
      }
      store.set(absPath, result);
    },

    remove(absPath) { store.delete(absPath); },

    getAll() { return allSorted(); },

    search(query) {
      const all = allSorted();
      if (!query) return all.slice(0, 50);
      const q = query.toLowerCase();
      return all.filter(e => subsequenceMatch(e.text.toLowerCase(), q)).slice(0, 50);
    },
  };
}

function subsequenceMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

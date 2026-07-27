import {create} from "zustand";

export type SpellLang = "ru" | "en" | "both";

export interface MisspelledWord {
  word: string;
  /** Офсеты в символах внутри текстового блока. */
  start: number;
  end: number;
}

export interface BlockErrors {
  /** ProseMirror-позиция начала textblock (перед нодой). */
  pos: number;
  errors: MisspelledWord[];
}

interface SpellState {
  enabled: boolean;
  lang: SpellLang;
  blocks: BlockErrors[];
  /** Растёт только при реальном изменении blocks — триггер перестройки декораций. */
  version: number;

  setEnabled: (enabled: boolean) => void;
  setLang: (lang: SpellLang) => void;
  setBlocks: (blocks: BlockErrors[]) => void;
}

function blocksEqual(a: BlockErrors[], b: BlockErrors[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].errors.length !== b[i].errors.length) return false;
    for (let j = 0; j < a[i].errors.length; j++) {
      const ea = a[i].errors[j];
      const eb = b[i].errors[j];
      if (ea.word !== eb.word || ea.start !== eb.start || ea.end !== eb.end) return false;
    }
  }
  return true;
}

export const useSpellStore = create<SpellState>((set, get) => ({
  enabled: true,
  lang: "both",
  blocks: [],
  version: 0,

  setEnabled: (enabled) => set({enabled}),
  setLang: (lang) => set({lang}),

  setBlocks: (blocks) => {
    // без изменений — не бампаем version (иначе плагин уйдёт в цикл перепроверок)
    if (blocksEqual(get().blocks, blocks)) return;
    set((s) => ({blocks, version: s.version + 1}));
  },
}));

import {useEffect, useState} from "react";
import {detectNer} from "../lib/agent/masking/ner";
import type {DetectorSpan} from "../lib/agent/masking/types";

/** Дебаунс NER-скана документа для кнопки тулбара (T2, N10): 400 мс покоя. */
const NER_DEBOUNCE_MS = 400;

/**
 * Скан активного документа детектором NER (T2). Вычисление тяжёлое только на
 * больших документах, поэтому с дебаунсом после ввода; ничего не отправляет
 * наружу — это навигация по документу, а не masking-прогон.
 */
export function useNerSpans(path: string, content: string): DetectorSpan[] {
  const [spans, setSpans] = useState<DetectorSpan[]>([]);

  useEffect(() => {
    setSpans([]);
    const timer = setTimeout(() => setSpans(detectNer(content)), NER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [path, content]);

  return spans;
}

/** 0-based строка по символьному смещению (для editor.moveCursor({line})). */
export function lineOfOffset(content: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

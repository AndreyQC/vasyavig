import {useEffect, useState} from "react";
import {applyDomainDictionary, detectNer} from "../lib/agent/masking/ner";
import type {DetectorSpan} from "../lib/agent/masking/types";
import {ensureEntityTypes} from "../lib/entityTypes";
import {getParentDir} from "../lib/utils";

/** Дебаунс NER-скана документа для кнопки тулбара (T2, N10): 400 мс покоя. */
const NER_DEBOUNCE_MS = 400;

/**
 * Скан активного документа детектором NER (T2). Вычисление тяжёлое только на
 * больших документах, поэтому с дебаунсом после ввода; ничего не отправляет
 * наружу — это навигация по документу, а не masking-прогон. T3c: перед сканом
 * подтягивается справочник типов и доменный словарь (harness.yaml, HY-5).
 */
export function useNerSpans(path: string, content: string): DetectorSpan[] {
  const [spans, setSpans] = useState<DetectorSpan[]>([]);

  useEffect(() => {
    setSpans([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      void ensureEntityTypes(getParentDir(path)).then(() => {
        applyDomainDictionary();
        if (!cancelled) setSpans(detectNer(content));
      });
    }, NER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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

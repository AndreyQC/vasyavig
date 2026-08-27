import {useDeferredValue, useEffect, useMemo, useRef} from "react";
import transform from "@diplodoc/transform";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import {useThemeValue} from "@gravity-ui/uikit";
import "@diplodoc/transform/dist/css/yfm.css";

interface Props {
  content: string;
}

/**
 * Правая панель превью: markdown/yfm -> HTML в реальном времени (идея §4.3).
 * Рендер через useDeferredValue — не блокирует печать (урок §5).
 * HTML санитизируется DOMPurify поверх встроенного санитайзера transform (идея §13).
 */
export function SplitPreview({content}: Props) {
  const deferred = useDeferredValue(content);
  const themeValue = useThemeValue();
  const rootRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    try {
      // supportGithubAnchors: заголовки получают кириллические якоря github-стиля
      // (id="1-введение") в дополнение к транслит-id — оглавления кликабельны
      const {result} = transform(deferred, {supportGithubAnchors: true});
      return DOMPurify.sanitize(result.html);
    } catch (e) {
      return `<pre class="split-preview__error">Ошибка рендера превью: ${String(e)}</pre>`;
    }
  }, [deferred]);

  // Тема mermaid следует за темой приложения
  useEffect(() => {
    mermaid.initialize({startOnLoad: false, theme: themeValue === "dark" ? "dark" : "default"});
  }, [themeValue]);

  // Постобработка mermaid-блоков: <pre><code class="language-mermaid"> -> SVG
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const blocks = root.querySelectorAll("pre > code.language-mermaid");
    blocks.forEach(async (block, i) => {
      const pre = block.parentElement;
      const text = block.textContent ?? "";
      try {
        const {svg} = await mermaid.render(`mmd-${Date.now()}-${i}`, text);
        const div = document.createElement("div");
        div.className = "mermaid-diagram";
        div.innerHTML = svg; // вывод mermaid (securityLevel=strict), не пользовательский HTML
        pre?.replaceWith(div);
      } catch {
        // некорректная диаграмма — оставляем как блок кода
      }
    });
  }, [html]);

  return (
    <div
      ref={rootRef}
      className="split-preview yfm"
      // санитизировано DOMPurify выше
      dangerouslySetInnerHTML={{__html: html}}
    />
  );
}

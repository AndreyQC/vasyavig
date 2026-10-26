import {useDeferredValue, useEffect, useMemo, useRef} from "react";
import transform from "@diplodoc/transform";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import {useThemeValue} from "@gravity-ui/uikit";
import {resolveImageDisplayUrl} from "../../lib/resolveImageSrc";
import {parseHarnessEnvelope, stripHiddenEnvelopes} from "../../lib/harnessEnvelope";
import {linkifyUlidsInElement, type UlidLinkMeta} from "../../lib/harnessIndex";
import {buildEnvelopeLinkChips} from "../../lib/harnessLinks";
import {HarnessLinkChips} from "../HarnessLinkChips";
import {openUlidTarget, useHarnessStore} from "../../store/harnessStore";
import i18n from "../../lib/i18n";
import "@diplodoc/transform/dist/css/yfm.css";

interface Props {
  content: string;
  /** Каталог открытого файла — база для относительных src картинок и резолва ULID. */
  basePath: string;
  /** Корень открытой папки — база для root-relative `/img.png` (phase 5). */
  rootPath?: string | null;
  /** Имя файла — fallback заголовка шапки, если конверта harness-yaml нет. */
  fileName?: string;
  /** Kind файла — fallback бейджа типа. */
  fallbackKind?: string;
}

/**
 * Дефолтный URI-регексп DOMPurify + схема `asset:` — иначе на macOS/Linux
 * sanitize вырежет asset-URL у картинок (на Windows форма http://asset.localhost
 * проходит и без этого).
 */
const ASSET_SAFE_URI_RE =
  /^(?:(?:(?:f|ht)tps?|asset|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** Переписывает src локальных картинок на asset-URL. Только для показа —
 *  markdown и файл не меняются (идея src/renderSrc из gramax, phase 5). */
function rewriteImageSrcs(html: string, basePath: string, rootPath?: string | null): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    const url = resolveImageDisplayUrl(src, basePath, rootPath);
    if (url) img.setAttribute("src", url);
  });
  return doc.body.innerHTML;
}

/**
 * Правая панель превью: markdown/yfm -> HTML в реальном времени (идея §4.3).
 * Рендер через useDeferredValue — не блокирует печать (урок §5).
 * HTML санитизируется DOMPurify поверх встроенного санитайзера transform (идея §13).
 *
 * harness-репозитории (task 20261025_001): шапка «title · type» из конверта
 * harness-yaml (fallback — имя файла), правдоподобные ULID — кликабельные
 * ссылки на документы реестра (D3/D6).
 */
export function SplitPreview({content, basePath, rootPath, fileName, fallbackKind}: Props) {
  const deferred = useDeferredValue(content);
  const themeValue = useThemeValue();
  const rootRef = useRef<HTMLDivElement>(null);
  // примитив: пересчёт html при загрузке/сбросе реестра (урок §3 — селекторы Zustand)
  const indexVersion = useHarnessStore((s) => s.version);

  const envelope = useMemo(() => parseHarnessEnvelope(deferred), [deferred]);

  const html = useMemo(() => {
    try {
      // supportGithubAnchors: заголовки получают кириллические якоря github-стиля
      // (id="1-введение") в дополнение к транслит-id — оглавления кликабельны;
      // скрытые конверты harness (harness-yaml/task-yaml) из рендера убираем (D13)
      const {result} = transform(stripHiddenEnvelopes(deferred), {supportGithubAnchors: true});
      const withImages = rewriteImageSrcs(result.html, basePath, rootPath);
      // ULID-линкификация (D3): один DOM-проход до sanitize, data-атрибуты DOMPurify пропускает
      const doc = new DOMParser().parseFromString(withImages, "text/html");
      linkifyUlidsInElement(
        doc.body,
        (ulid): UlidLinkMeta | null => {
          const res = useHarnessStore.getState().resolveFor(basePath, ulid);
          if (res.status !== "found") return null;
          return {title: res.entry.title ?? res.entry.path, type: res.entry.type ?? ""};
        },
        i18n.t("harness.ulidUnknownTooltip"),
      );
      return DOMPurify.sanitize(doc.body.innerHTML, {
        ALLOWED_URI_REGEXP: ASSET_SAFE_URI_RE,
      });
    } catch (e) {
      return `<pre class="split-preview__error">Ошибка рендера превью: ${String(e)}</pre>`;
    }
  }, [deferred, basePath, rootPath, indexVersion]);

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

  // Клик по ULID-ссылке (D5): контент в dangerouslySetInnerHTML — делегирование
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest?.("a[data-ulid]") as HTMLElement | null;
    if (!link) return;
    e.preventDefault();
    const ulid = link.getAttribute("data-ulid");
    if (ulid) void openUlidTarget(basePath, ulid);
  };

  /** Связи конверта (D9): скрытые ULID из related/based_on — кликабельные чипы. */
  const linkChips = useMemo(
    () => (envelope ? buildEnvelopeLinkChips(envelope, basePath) : []),
    [envelope, basePath, indexVersion],
  );

  const onChipClick = (ulid: string) => void openUlidTarget(basePath, ulid);

  const headerTitle = envelope?.title ?? fileName ?? "";
  const headerType = envelope?.type ?? fallbackKind ?? "";

  return (
    <div className="split-preview">
      <div className="split-preview__header">
        <span className="split-preview__doc-title" title={headerTitle}>
          {headerTitle}
        </span>
        {headerType && <span className="split-preview__doc-type">{headerType}</span>}
      </div>
      {linkChips.length > 0 && (
        <div className="split-preview__links">
          <HarnessLinkChips chips={linkChips} onOpen={onChipClick} />
        </div>
      )}
      <div
        ref={rootRef}
        className="split-preview__body yfm"
        onClick={onBodyClick}
        // санитизировано DOMPurify выше
        dangerouslySetInnerHTML={{__html: html}}
      />
    </div>
  );
}

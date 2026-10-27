import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Button, Label} from "@gravity-ui/uikit";
import {openUlidTarget, useHarnessStore} from "../store/harnessStore";
import i18n from "../lib/i18n";

/**
 * Плашечка ULID-ссылки (task 20261027_002, U3): видимый текст — имя файла,
 * при наведении — метаданные реестра. Делегирование на document: работает и в
 * превью, и в WYSIWYG (оба помечают элементы `data-ulid-dir` + `data-ulid`).
 */
interface HoverTarget {
  ulid: string;
  anchor?: string;
  dir: string;
  rect: DOMRect;
}

const SHOW_DELAY = 350;
const HIDE_DELAY = 200;

function findHovered(node: EventTarget | null): HTMLElement | null {
  const el = node as HTMLElement | null;
  return el?.closest?.(
    "[data-ulid][data-ulid-dir], [data-ulid-unknown][data-ulid-dir]",
  ) as HTMLElement | null;
}

function targetFromElement(el: HTMLElement): HoverTarget | null {
  const ulid = el.getAttribute("data-ulid") ?? el.getAttribute("data-ulid-unknown");
  const dir = el.getAttribute("data-ulid-dir");
  if (!ulid || !dir) return null;
  const anchor = el.getAttribute("data-anchor") ?? undefined;
  return {ulid, anchor, dir, rect: el.getBoundingClientRect()};
}

/** Человекочитаемая подпись связанного ULID (реестр -> title/path, иначе id). */
function refLabel(dir: string, ulid: string): string {
  const res = useHarnessStore.getState().resolveFor(dir, ulid);
  return res.status === "found" ? (res.entry.title ?? res.entry.path) : ulid;
}

export function HarnessUlidPopover() {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const [pos, setPos] = useState<{left: number; top: number} | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  // примитив: данные плашечки обновляются при перезагрузке реестра (урок §3)
  const version = useHarnessStore((s) => s.version);

  const clearTimers = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setTarget(null);
      setPos(null);
      hideTimer.current = null;
    }, HIDE_DELAY);
  }, []);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = findHovered(e.target);
      if (!el) return;
      const next = targetFromElement(el);
      if (!next) return;
      clearTimers();
      showTimer.current = window.setTimeout(() => {
        setTarget(next);
        showTimer.current = null;
      }, SHOW_DELAY);
    };
    const onOut = (e: MouseEvent) => {
      if (!findHovered(e.target)) return;
      clearTimers();
      scheduleHide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clearTimers();
      setTarget(null);
      setPos(null);
    };
    const onScroll = () => {
      clearTimers();
      setTarget(null);
      setPos(null);
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      clearTimers();
    };
  }, [clearTimers, scheduleHide]);

  const resolved = useMemo(() => {
    if (!target) return null;
    return useHarnessStore.getState().resolveFor(target.dir, target.ulid);
  }, [target, version]);
  const entry = resolved?.status === "found" ? resolved.entry : null;

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!target || !el) {
      setPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const left = Math.min(Math.max(8, target.rect.left), maxLeft);
    let top = target.rect.bottom + 6;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, target.rect.top - rect.height - 6);
    }
    setPos({left, top});
  }, [target, resolved]);

  if (!target) return null;

  const t = (key: string) => i18n.t(key);
  const related = entry?.related ?? [];
  const basedOn = entry?.basedOn ?? [];

  const openRelated = (ulid: string) => {
    void openUlidTarget(target.dir, ulid);
    clearTimers();
    setTarget(null);
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="ulid-popover"
      role="dialog"
      aria-label={entry?.title ?? target.ulid}
      style={pos ? {left: pos.left, top: pos.top} : {left: -9999, top: -9999}}
      onMouseEnter={clearTimers}
      onMouseLeave={scheduleHide}
    >
      <div className="ulid-popover__head">
        <span className="ulid-popover__title">{entry?.title ?? target.ulid}</span>
        {entry?.type && <Label size="xs">{entry.type}</Label>}
      </div>

      {entry ? (
        <dl className="ulid-popover__rows">
          {entry.project && (
            <div className="ulid-popover__row">
              <dt>{t("harness.link.project")}</dt>
              <dd>{entry.project}</dd>
            </div>
          )}
          <div className="ulid-popover__row">
            <dt>{t("harness.link.path")}</dt>
            <dd className="ulid-popover__path">{entry.path}</dd>
          </div>
          {entry.created && (
            <div className="ulid-popover__row">
              <dt>{t("harness.link.created")}</dt>
              <dd>{entry.created}</dd>
            </div>
          )}
          {entry.updated && (
            <div className="ulid-popover__row">
              <dt>{t("harness.link.updated")}</dt>
              <dd>{entry.updated}</dd>
            </div>
          )}
        </dl>
      ) : (
        <div className="ulid-popover__unknown">
          <div>{t("harness.link.unknown")}</div>
          <code>{t("harness.link.unknownHint")}</code>
        </div>
      )}

      {target.anchor && (
        <div className="ulid-popover__anchor">
          {t("harness.link.anchor")}: <code>{target.anchor}</code>
          <div className="ulid-popover__hint">{t("harness.link.anchorSoon")}</div>
        </div>
      )}

      {(related.length > 0 || basedOn.length > 0) && (
        <div className="ulid-popover__relations">
          {related.length > 0 && (
            <div className="ulid-popover__relation-row">
              <span className="ulid-popover__relation-label">{t("harness.link.related")}</span>
              {related.map((ref) => (
                <button
                  key={ref}
                  type="button"
                  className="ulid-popover__chip"
                  title={ref}
                  onClick={() => openRelated(ref)}
                >
                  {refLabel(target.dir, ref)}
                </button>
              ))}
            </div>
          )}
          {basedOn.length > 0 && (
            <div className="ulid-popover__relation-row">
              <span className="ulid-popover__relation-label">{t("harness.link.basedOn")}</span>
              {basedOn.map((ref) => (
                <button
                  key={ref}
                  type="button"
                  className="ulid-popover__chip"
                  title={ref}
                  onClick={() => openRelated(ref)}
                >
                  {refLabel(target.dir, ref)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ulid-popover__footer">
        {entry && (
          <Button
            size="s"
            view="action"
            onClick={() => {
              void openUlidTarget(target.dir, target.ulid, target.anchor);
              clearTimers();
              setTarget(null);
            }}
          >
            {t("harness.link.open")}
          </Button>
        )}
        <span className="ulid-popover__id" title={target.ulid}>
          {target.ulid}
        </span>
      </div>
    </div>,
    document.body,
  );
}

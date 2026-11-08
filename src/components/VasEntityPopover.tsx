import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Button, Label} from "@gravity-ui/uikit";
import {Xmark} from "@gravity-ui/icons";
import i18n from "../lib/i18n";
import {getParentDir} from "../lib/utils";
import {unmarkEntityAtDom} from "../lib/vasEntityExtension";
import {ensureEntitiesIndex, type EntityIndexEntry} from "../lib/entitiesIndex";
import {customTypeLabel, isMaskingTypeToken} from "../lib/entityTypes";

/**
 * Поповер чипа сущности `vas-entity:` (Phase 8.5, T3; план 20261105_001,
 * T3-6): тип, алиас `[[VAS_<TYPE>_<ULID>]]`, эталонная форма из словаря
 * identities (если известна), кнопка «Снять разметку». Наведение с задержкой —
 * паттерн `HarnessUlidPopover` (делегирование на document, работает в
 * WYSIWYG, Markup и превью).
 */

interface ChipTarget {
  ulid: string;
  type: string;
  path: string;
  value: string;
  rect: DOMRect;
  el: HTMLElement;
}

const SHOW_DELAY = 350;
const HIDE_DELAY = 250;

function findChip(node: EventTarget | null): HTMLElement | null {
  const el = node as HTMLElement | null;
  return el?.closest?.("[data-vas-entity]") as HTMLElement | null;
}

function targetFromElement(el: HTMLElement): ChipTarget | null {
  const ulid = el.getAttribute("data-vas-entity");
  const type = el.getAttribute("data-vas-type");
  const path = el.getAttribute("data-vas-entity-path");
  if (!ulid || !type || !path) return null;
  return {ulid, type, path, value: el.textContent ?? "", rect: el.getBoundingClientRect(), el};
}

export function VasEntityPopover() {
  const [target, setTarget] = useState<ChipTarget | null>(null);
  const [pos, setPos] = useState<{left: number; top: number} | null>(null);
  const [canonical, setCanonical] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimer.current != null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    setTarget(null);
    setPos(null);
    setCanonical(null);
  }, []);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = findChip(e.target);
      if (!el) return;
      const next = targetFromElement(el);
      if (!next) return;
      clearTimers();
      showTimer.current = window.setTimeout(() => {
        setTarget(next);
        showTimer.current = null;
        // эталонная форма — из словаря identities, если сущность известна
        void ensureEntitiesIndex(getParentDir(next.path)).then((file) => {
          const hit: EntityIndexEntry | undefined = file.entries.find(
            (entry) => entry.ulid === next.ulid,
          );
          setCanonical(hit?.canonical ?? null);
        });
      }, SHOW_DELAY);
    };
    const onOut = (e: MouseEvent) => {
      if (!findChip(e.target)) return;
      clearTimers();
      hideTimer.current = window.setTimeout(() => {
        hide();
        hideTimer.current = null;
      }, HIDE_DELAY);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clearTimers();
      hide();
    };
    const onScroll = () => {
      clearTimers();
      hide();
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
  }, [clearTimers, hide]);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !target) return;
    // над чипом, не выходя за правый край окна
    const left = Math.max(8, Math.min(target.rect.left, window.innerWidth - el.offsetWidth - 8));
    const top = Math.max(8, target.rect.top - el.offsetHeight - 6);
    setPos({left, top});
  }, [target, canonical]);

  if (!target) return null;
  // D-18 (приёмка 20261108_001): прежний гейт `!target || !pos` замыкался
  // в круг — pos выставлялся в useLayoutEffect только при живом ref, а ref
  // появляется лишь при рендере div, заблокированном отсутствием pos.
  // Поповер не мог появиться никогда. Теперь рендерим по rect чипа сразу,
  // useLayoutEffect уточняет позицию по фактическим размерам до отрисовки.
  const fallbackLeft = Math.max(8, target.rect.left);
  const fallbackTop = Math.max(8, target.rect.top - 48);
  const left = pos?.left ?? fallbackLeft;
  const top = pos?.top ?? fallbackTop;

  // Алиас показывается только у маскируемых типов (кастомные — для графов)
  const masking = isMaskingTypeToken(target.type);
  const alias = `[[VAS_${target.type.toUpperCase()}_${target.ulid}]]`;
  const typeLabel =
    customTypeLabel(target.type, i18n.language) ?? i18n.t(`assistant.entityType.${target.type}`);
  const unmark = () => {
    unmarkEntityAtDom(target.path, target.el);
    hide();
  };

  return createPortal(
    <div ref={popoverRef} className="vas-entity-popover" style={{left, top}}>
      <div className="vas-entity-popover__row">
        <Label theme="info">{typeLabel}</Label>
        <span className="vas-entity-popover__value">{target.value}</span>
      </div>
      {canonical != null && canonical !== target.value && (
        <div className="vas-entity-popover__row vas-entity-popover__muted">
          {i18n.t("entity.canonical")}: {canonical}
        </div>
      )}
      {masking && <div className="vas-entity-popover__row vas-entity-popover__mono">{alias}</div>}
      <div className="vas-entity-popover__actions">
        <Button size="s" view="flat" onClick={unmark}>
          <Xmark width={12} height={12} />
          {i18n.t("entity.unmark")}
        </Button>
      </div>
    </div>,
    document.body,
  );
}

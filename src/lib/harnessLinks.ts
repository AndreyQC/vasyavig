import type {HarnessEnvelope} from "./harnessEnvelope";
import {useHarnessStore} from "../store/harnessStore";
import i18n from "./i18n";

/**
 * Чипы скрытых связей конверта harness-yaml (task 20261025_001, D9/D11):
 * based_on (метка «осн.») и related. Известные реестру — кликабельные,
 * неизвестные — тихие. Общий билдер для панели превью и кнопки в тулбаре.
 */

export interface HarnessLinkChip {
  ulid: string;
  kind: "based" | "related";
  /** Подпись чипа: title из реестра или сам ULID. */
  label: string;
  /** Tooltip: «title · type» или «нет в реестре». */
  title: string;
  known: boolean;
}

export function buildEnvelopeLinkChips(envelope: HarnessEnvelope, dir: string): HarnessLinkChip[] {
  const chips: HarnessLinkChip[] = [];
  const resolve = (ulid: string, kind: "based" | "related") => {
    const res = useHarnessStore.getState().resolveFor(dir, ulid);
    if (res.status === "found") {
      chips.push({
        ulid,
        kind,
        label: res.entry.title ?? ulid,
        title: [res.entry.title ?? res.entry.path, res.entry.type].filter(Boolean).join(" · "),
        known: true,
      });
    } else {
      chips.push({ulid, kind, label: ulid, title: i18n.t("harness.ulidUnknownTooltip"), known: false});
    }
  };
  envelope.basedOn.forEach((ulid) => resolve(ulid, "based"));
  envelope.related.forEach((ulid) => resolve(ulid, "related"));
  return chips;
}

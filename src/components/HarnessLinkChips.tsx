import type {HarnessLinkChip} from "../lib/harnessLinks";
import i18n from "../lib/i18n";

interface Props {
  chips: HarnessLinkChip[];
  onOpen: (ulid: string) => void;
}

/** Список чипов связей конверта (превью-панель и тулбар-поповер, D9/D11). */
export function HarnessLinkChips({chips, onOpen}: Props) {
  return (
    <>
      {chips.map((chip) => (
        <button
          key={`${chip.kind}-${chip.ulid}`}
          type="button"
          className={`ulid-chip${chip.known ? " ulid-chip--link" : " ulid-chip--unknown"}`}
          title={chip.title}
          disabled={!chip.known}
          onClick={() => onOpen(chip.ulid)}
        >
          {chip.kind === "based" && <span className="ulid-chip__kind">{i18n.t("harness.linkBasedOn")}</span>}
          <span className="ulid-chip__label">{chip.label}</span>
        </button>
      ))}
    </>
  );
}

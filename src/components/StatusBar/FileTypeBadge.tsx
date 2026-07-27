import {Text} from "@gravity-ui/uikit";
import {getExtension} from "../../lib/utils";

interface Props {
  path: string;
}

const EXT_COLORS: Record<string, string> = {
  md: "var(--g-color-base-info-medium)",
  markdown: "var(--g-color-base-info-medium)",
  yfm: "var(--g-color-base-warning-medium)",
};

const DEFAULT_COLOR = "var(--g-color-base-neutral-medium)";

/** Яркий бейдж с расширением файла: .md — синий, .yfm — оранжевый, прочие — серый (идея §4.1.3). */
export function FileTypeBadge({path}: Props) {
  const ext = getExtension(path);
  const color = EXT_COLORS[ext] ?? DEFAULT_COLOR;

  return (
    <span className="file-type-badge" style={{background: color}}>
      <Text variant="caption-2" color="inverted-primary">
        .{ext || "?"}
      </Text>
    </span>
  );
}

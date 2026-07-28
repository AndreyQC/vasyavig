import {SegmentedRadioGroup} from "@gravity-ui/uikit";
import {useEditorStore, type EditorMode} from "../../store/editorStore";

interface Props {
  path: string;
}

/** Переключение режимов редактора: WYSIWYG / Markup. */
export function ModeSwitcher({path}: Props) {
  const mode = useEditorStore((s) => s.tabs.find((t) => t.path === path)?.mode ?? "wysiwyg");
  const setMode = useEditorStore((s) => s.setMode);

  return (
    <SegmentedRadioGroup
      size="m"
      value={mode}
      onUpdate={(value) => setMode(path, value as EditorMode)}
    >
      <SegmentedRadioGroup.Option value="wysiwyg">WYSIWYG</SegmentedRadioGroup.Option>
      <SegmentedRadioGroup.Option value="markup">Markup</SegmentedRadioGroup.Option>
      <SegmentedRadioGroup.Option value="split">Split</SegmentedRadioGroup.Option>
    </SegmentedRadioGroup>
  );
}

import { useNewEditorStore } from "../state/editorStore";
import type { NewEditorTool } from "../model/commands";

const TOOLS: Array<{ id: NewEditorTool; label: string }> = [
  { id: "select", label: "SEL" },
  { id: "draw-room", label: "ROOM" },
  { id: "opening", label: "OPEN" },
  { id: "guide", label: "GUIDE" },
  { id: "reference", label: "REF" },
  { id: "delete", label: "DEL" },
  { id: "pan", label: "PAN" },
];

export const ToolRail = () => {
  const { tool, setTool } = useNewEditorStore();

  return (
    <aside className="ne-toolrail">
      {TOOLS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={tool === entry.id ? "ne-tool-button is-active" : "ne-tool-button"}
          onClick={() => setTool(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </aside>
  );
};

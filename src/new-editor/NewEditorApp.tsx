import { useEffect, useRef, useState } from "react";
import { CanvasShell } from "./components/CanvasShell";
import { Inspector } from "./components/Inspector";
import { ToolRail } from "./components/ToolRail";
import { useNewEditorStore } from "./state/editorStore";
import type { CanonicalGuide, CanonicalIndoorDataset } from "../lib/types";
import { findSharedWallRoom, pointOnRoomEdge, projectPointToRoomEdge } from "./model/openings";
import "./new-editor.css";

const parseDataset = (json: string): CanonicalIndoorDataset => {
  const parsed = JSON.parse(json) as CanonicalIndoorDataset;
  if (!parsed.grid || !Array.isArray(parsed.rooms) || !Array.isArray(parsed.levels)) {
    throw new Error("Invalid indoor-data.json: missing grid, rooms, or levels");
  }
  if (parsed.guides && !Array.isArray(parsed.guides)) {
    throw new Error("Invalid indoor-data.json: guides must be an array");
  }
  return parsed;
};

const exportableGuides = (guides: CanonicalGuide[]): CanonicalGuide[] =>
  guides.map((guide) => ({
    id: guide.id,
    a: [guide.a[0], guide.a[1]],
    b: [guide.b[0], guide.b[1]],
  }));

const sanitizeExportDataset = (dataset: CanonicalIndoorDataset): CanonicalIndoorDataset => {
  const rooms = dataset.rooms.map((room) => ({
    ...room,
    polygon: room.polygon.map(([x, y]) => [x, y] as [number, number]),
    openings: (room.openings ?? []).map((opening) => ({
      ...opening,
      point: [opening.point[0], opening.point[1]] as [number, number],
    })),
  }));

  for (const room of rooms) {
    room.openings = (room.openings ?? []).flatMap((opening) => {
      const projected = projectPointToRoomEdge(room, opening.point).point;
      const nextOpening = {
        ...opening,
        point: [projected[0], projected[1]] as [number, number],
      };

      if (!pointOnRoomEdge(room, nextOpening.point)) {
        return [];
      }

      if (nextOpening.connectsTo) {
        const sharedRoomId = findSharedWallRoom(rooms, room.id, nextOpening.point);
        if (sharedRoomId !== nextOpening.connectsTo) {
          nextOpening.connectsTo = undefined;
        }
      }

      return [nextOpening];
    });
  }

  return {
    ...dataset,
    rooms,
  };
};

export const NewEditorApp = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 720 });
  const {
    selectedRoomId,
    selectedOpeningId,
    tool,
    hoveredSnap,
    dataset,
    guides,
    draftRoomPoints,
    undoStack,
    redoStack,
    loadDataset,
    undo,
    redo,
  } = useNewEditorStore();

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const selectedRoom = dataset.rooms.find((room) => room.id === selectedRoomId) ?? null;
  const selectedOpening = selectedRoom?.openings?.find((opening) => opening.id === selectedOpeningId) ?? null;

  const handleExport = () => {
    const exportDataset: CanonicalIndoorDataset = {
      ...sanitizeExportDataset(dataset),
      guides: exportableGuides(guides),
    };
    const blob = new Blob([JSON.stringify(exportDataset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "indoor-data.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const nextDataset = parseDataset(text);
      loadDataset(nextDataset);
    });
    event.target.value = "";
  };

  return (
    <div className="ne-root">
      <header className="ne-topbar">
        <div>
          <div className="ne-title">New Editor</div>
          <div className="ne-subtitle">Clean-room rewrite running in parallel with `/editor`</div>
        </div>
        <div className="ne-chip-row">
          <span className="ne-chip">Tool: {tool}</span>
          <span className="ne-chip">Rooms: {dataset.rooms.length}</span>
          <span className="ne-chip">Guides: {guides.length}</span>
          <span className="ne-chip">Draft: {draftRoomPoints.length} pts</span>
          <span className="ne-chip">
            Snap: {hoveredSnap ? `${hoveredSnap.kind} @ ${hoveredSnap.point[0].toFixed(2)}, ${hoveredSnap.point[1].toFixed(2)}` : "off"}
          </span>
          <button type="button" className="ne-chip ne-chip-button" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button type="button" className="ne-chip ne-chip-button" onClick={handleExport}>
            Export
          </button>
          <button type="button" className="ne-chip ne-chip-button" onClick={undo} disabled={undoStack.length === 0}>
            Undo
          </button>
          <button type="button" className="ne-chip ne-chip-button" onClick={redo} disabled={redoStack.length === 0}>
            Redo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="ne-file-input"
            onChange={handleImport}
          />
        </div>
      </header>
      <div className="ne-body">
        <ToolRail />
        <main className="ne-stage-area" ref={containerRef}>
          <CanvasShell width={size.width} height={size.height} />
        </main>
        <Inspector selectedRoom={selectedRoom} selectedOpening={selectedOpening} />
      </div>
    </div>
  );
};

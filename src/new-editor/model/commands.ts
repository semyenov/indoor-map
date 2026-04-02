import { nanoid } from "nanoid";
import type { CanonicalIndoorDataset, CanonicalRoom, LevelId } from "../../lib/types";
import type { HoverSnap } from "./snapping";
import type { Point } from "./geometry";
import { distance } from "./geometry";

export type NewEditorTool = "select" | "draw-room" | "opening" | "guide" | "reference" | "delete" | "pan";

export interface EditorGuide {
  id: string;
  a: Point;
  b: Point;
}

export interface ViewportState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export type EditorHoverSnap = HoverSnap;
export type { Point } from "./geometry";

export const initialDataset = (): CanonicalIndoorDataset => ({
  grid: { origin: [37.61888, 55.75112], xStep: 0.000018, yStep: 0.00001 },
  levels: [{ id: "L1", label: "Этаж 1", order: 1, defaultCenter: [28, 15], defaultZoom: 20.6 }],
  rooms: [
    {
      id: "demo-room-1",
      level: "L1",
      kind: "room",
      name: "North Studio",
      polygon: [
        [3, 3],
        [10, 3],
        [10, 7.5],
        [3, 7.5],
      ],
      subtitle: "",
      department: "Design",
      searchTokens: [],
    },
    {
      id: "demo-room-2",
      level: "L1",
      kind: "meeting_room",
      name: "Forum",
      polygon: [
        [12, 3.5],
        [18.5, 3.5],
        [18.5, 9],
        [12, 9],
      ],
      subtitle: "",
      department: "Ops",
      searchTokens: [],
    },
  ],
  pois: [],
  structures: [],
});

const datasetMaxY = (dataset: CanonicalIndoorDataset): number => {
  const points = dataset.rooms.flatMap((room) => room.polygon);
  if (points.length === 0) return 0;
  return Math.max(...points.map(([, y]) => y));
};

export const defaultViewportForDataset = (
  dataset: CanonicalIndoorDataset,
  zoom = 42,
): ViewportState => ({
  zoom,
  offsetX: 120,
  offsetY: 100 + datasetMaxY(dataset) * zoom,
});

export const localPointToScreenPoint = (point: Point, viewport: ViewportState): Point => [
  point[0] * viewport.zoom + viewport.offsetX,
  viewport.offsetY - point[1] * viewport.zoom,
];

export const screenPointToLocalPoint = (point: Point, viewport: ViewportState): Point => [
  (point[0] - viewport.offsetX) / viewport.zoom,
  (viewport.offsetY - point[1]) / viewport.zoom,
];

export const localUnitsFromScreenPixels = (pixels: number, viewport: ViewportState): number =>
  pixels / Math.max(viewport.zoom, 1e-6);

export const shouldCloseDraftPolygon = (
  point: Point,
  draftPoints: Point[],
  viewport: ViewportState,
): boolean => {
  if (draftPoints.length < 3) return false;
  return distance(point, draftPoints[0]!) <= localUnitsFromScreenPixels(12, viewport);
};

export const appendDraftPoint = (draftPoints: Point[], point: Point): Point[] => [...draftPoints, point];

export const createRoomFromDraft = (
  draftPoints: Point[],
  level: LevelId,
): CanonicalRoom => ({
  id: `room-${level.toLowerCase()}-${nanoid(6)}`,
  level,
  kind: "room",
  name: "New Room",
  polygon: draftPoints,
  subtitle: "",
  department: "",
  searchTokens: [],
});

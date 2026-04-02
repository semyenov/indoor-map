import { nanoid } from "nanoid";
import { create } from "zustand";
import type { CanonicalGuide, CanonicalIndoorDataset, CanonicalOpening, CanonicalRoom, LevelId } from "../../lib/types";
import {
  appendDraftPoint,
  createRoomFromDraft,
  defaultViewportForDataset,
  initialDataset,
  localUnitsFromScreenPixels,
  localPointToScreenPoint,
  screenPointToLocalPoint,
  shouldCloseDraftPolygon,
} from "../model/commands";
import type { EditorGuide, EditorHoverSnap, NewEditorTool, Point, ViewportState } from "../model/commands";
import { findHoverSnap, type HoverSnap } from "../model/snapping";
import {
  buildOpeningPlacements,
  createLinkedSiblingOpening,
  findLinkedOpening,
  findSharedWallRoom,
  projectPointToRoomEdge,
} from "../model/openings";
import { distance } from "../model/geometry";

const NEW_EDITOR_STORAGE_KEY = "indoor-map.new-editor.workspace";
const MAX_HISTORY_ENTRIES = 100;

const revokeObjectUrl = (url: string | null | undefined) => {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

const cloneValue = <T,>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;

const cloneRooms = (rooms: CanonicalRoom[]): CanonicalRoom[] =>
  rooms.map((room) => ({
    ...room,
    polygon: room.polygon.map(([x, y]) => [x, y] as Point),
    openings: room.openings?.map((opening) => ({
      ...opening,
      point: [opening.point[0], opening.point[1]] as Point,
    })),
  }));

const findRoom = (rooms: CanonicalRoom[], roomId: string) => rooms.find((room) => room.id === roomId) ?? null;

const findOpening = (rooms: CanonicalRoom[], roomId: string, openingId: string) =>
  findRoom(rooms, roomId)?.openings?.find((opening) => opening.id === openingId) ?? null;

const exportableGuides = (guides: EditorGuide[]): CanonicalGuide[] =>
  guides.map((guide) => ({
    id: guide.id,
    a: [guide.a[0], guide.a[1]],
    b: [guide.b[0], guide.b[1]],
  }));

type PersistedReferenceImageState = {
  opacity: number;
  localX: number;
  localY: number;
  localWidth: number;
};

type PersistedWorkspaceState = {
  dataset: CanonicalIndoorDataset;
  guides: CanonicalGuide[];
  viewport: ViewportState;
  tool: NewEditorTool;
  referenceImage: PersistedReferenceImageState;
};

type HistorySnapshot = {
  dataset: CanonicalIndoorDataset;
  guides: EditorGuide[];
  referenceImage: PersistedReferenceImageState;
};

type PendingDragHistory = {
  snapshot: HistorySnapshot;
};

const readPersistedWorkspace = (): PersistedWorkspaceState | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(NEW_EDITOR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
    if (!parsed || !parsed.dataset || !Array.isArray(parsed.dataset.rooms) || !Array.isArray(parsed.dataset.levels)) {
      return null;
    }

    return {
      dataset: parsed.dataset,
      guides: Array.isArray(parsed.guides) ? parsed.guides : [],
      viewport:
        parsed.viewport &&
        typeof parsed.viewport.zoom === "number" &&
        typeof parsed.viewport.offsetX === "number" &&
        typeof parsed.viewport.offsetY === "number"
          ? parsed.viewport
          : defaultViewportForDataset(parsed.dataset),
      tool:
        parsed.tool === "select" ||
        parsed.tool === "draw-room" ||
        parsed.tool === "opening" ||
        parsed.tool === "guide" ||
        parsed.tool === "reference" ||
        parsed.tool === "delete" ||
        parsed.tool === "pan"
          ? parsed.tool
          : "select",
      referenceImage: {
        opacity:
          typeof parsed.referenceImage?.opacity === "number"
            ? parsed.referenceImage.opacity
            : 0.45,
        localX:
          typeof parsed.referenceImage?.localX === "number"
            ? parsed.referenceImage.localX
            : 0,
        localY:
          typeof parsed.referenceImage?.localY === "number"
            ? parsed.referenceImage.localY
            : 0,
        localWidth:
          typeof parsed.referenceImage?.localWidth === "number"
            ? parsed.referenceImage.localWidth
            : 54,
      },
    };
  } catch {
    return null;
  }
};

const createHistorySnapshot = (state: Pick<NewEditorState, "dataset" | "guides" | "referenceImage">): HistorySnapshot => ({
  dataset: cloneValue(state.dataset),
  guides: cloneValue(state.guides),
  referenceImage: {
    opacity: state.referenceImage.opacity,
    localX: state.referenceImage.localX,
    localY: state.referenceImage.localY,
    localWidth: state.referenceImage.localWidth,
  },
});

const applyHistorySnapshot = (
  state: NewEditorState,
  snapshot: HistorySnapshot,
  undoStack: HistorySnapshot[],
  redoStack: HistorySnapshot[],
) => ({
  dataset: cloneValue(snapshot.dataset),
  guides: cloneValue(snapshot.guides),
  referenceImage: {
    ...state.referenceImage,
    opacity: snapshot.referenceImage.opacity,
    localX: snapshot.referenceImage.localX,
    localY: snapshot.referenceImage.localY,
    localWidth: snapshot.referenceImage.localWidth,
  },
  undoStack,
  redoStack,
  selectedRoomId: null,
  selectedOpeningId: null,
  hoveredSnap: null,
  draftRoomPoints: [],
  draftCursorPoint: null,
});

const withHistory = (
  state: NewEditorState,
  patch: Partial<NewEditorState>,
): Partial<NewEditorState> => {
  const undoStack = [...state.undoStack, createHistorySnapshot(state)].slice(-MAX_HISTORY_ENTRIES);
  return {
    ...patch,
    undoStack,
    redoStack: [],
  };
};

const removeOpeningFromRoom = (room: CanonicalRoom, openingId: string) => ({
  ...room,
  openings: (room.openings ?? []).filter((opening) => opening.id !== openingId),
});

const clearRoomLinks = (rooms: CanonicalRoom[], deletedRoomId: string) => {
  for (const room of rooms) {
    room.openings = (room.openings ?? []).flatMap((opening) =>
      opening.connectsTo === deletedRoomId
        ? [{ ...opening, connectsTo: undefined }]
        : [opening],
    );
  }
};

const reconcileLinkedOpening = (rooms: CanonicalRoom[], roomId: string, openingId: string) => {
  const room = findRoom(rooms, roomId);
  const opening = findOpening(rooms, roomId, openingId);
  if (!room || !opening) return;

  const projected = projectPointToRoomEdge(room, opening.point).point;
  opening.point = projected;

  const linkedRef = findLinkedOpening(rooms, roomId, openingId);
  const sharedRoomId = findSharedWallRoom(rooms, roomId, projected);

  if (!sharedRoomId) {
    opening.connectsTo = undefined;
    if (linkedRef) {
      const linkedRoom = findRoom(rooms, linkedRef.roomId);
      if (linkedRoom) {
        linkedRoom.openings = (linkedRoom.openings ?? []).filter((entry) => entry.id !== linkedRef.openingId);
      }
    }
    return;
  }

  opening.connectsTo = sharedRoomId;

  if (linkedRef && linkedRef.roomId !== sharedRoomId) {
    const staleRoom = findRoom(rooms, linkedRef.roomId);
    if (staleRoom) {
      staleRoom.openings = (staleRoom.openings ?? []).filter((entry) => entry.id !== linkedRef.openingId);
    }
  }

  const linkedRoom = findRoom(rooms, sharedRoomId);
  if (!linkedRoom) return;

  let linkedOpening =
    linkedRef && linkedRef.roomId === sharedRoomId
      ? findOpening(rooms, linkedRef.roomId, linkedRef.openingId)
      : null;

  if (!linkedOpening) {
    linkedOpening = createLinkedSiblingOpening(opening, sharedRoomId, room.id);
    linkedRoom.openings = [...(linkedRoom.openings ?? []), linkedOpening];
  }

  linkedOpening.point = projected;
  linkedOpening.width = opening.width;
  linkedOpening.kind = opening.kind;
  linkedOpening.traversable = opening.traversable;
  linkedOpening.connectsTo = room.id;
};

const reconcileRoomOpenings = (rooms: CanonicalRoom[], roomId: string) => {
  const room = findRoom(rooms, roomId);
  if (!room) return;
  for (const opening of room.openings ?? []) {
    reconcileLinkedOpening(rooms, roomId, opening.id);
  }
};

const mergeNearbyVerticesForLevel = (rooms: CanonicalRoom[], level: LevelId, maxDistance: number) => {
  const vertices = rooms.flatMap((room) =>
    room.level === level
      ? room.polygon.map((point, vertexIndex) => ({
          roomId: room.id,
          vertexIndex,
          point,
        }))
      : [],
  );

  if (vertices.length < 2) {
    return { rooms, changed: false };
  }

  const parent = vertices.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      cursor = parent[cursor]!;
    }
    let current = index;
    while (parent[current] !== current) {
      const next = parent[current]!;
      parent[current] = cursor;
      current = next;
    }
    return cursor;
  };
  const unite = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (let leftIndex = 0; leftIndex < vertices.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < vertices.length; rightIndex += 1) {
      if (distance(vertices[leftIndex]!.point, vertices[rightIndex]!.point) <= maxDistance) {
        unite(leftIndex, rightIndex);
      }
    }
  }

  const clusters = new Map<number, typeof vertices>();
  for (let index = 0; index < vertices.length; index += 1) {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) ?? []), vertices[index]!]);
  }

  let changed = false;
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    const target: Point = [
      Number((cluster.reduce((sum, entry) => sum + entry.point[0], 0) / cluster.length).toFixed(3)),
      Number((cluster.reduce((sum, entry) => sum + entry.point[1], 0) / cluster.length).toFixed(3)),
    ];
    for (const entry of cluster) {
      const room = findRoom(rooms, entry.roomId);
      const current = room?.polygon[entry.vertexIndex];
      if (!room || !current) continue;
      if (current[0] !== target[0] || current[1] !== target[1]) {
        room.polygon[entry.vertexIndex] = target;
        changed = true;
      }
    }
  }

  if (!changed) {
    return { rooms, changed: false };
  }

  for (const room of rooms) {
    if (room.level === level) {
      reconcileRoomOpenings(rooms, room.id);
    }
  }

  return { rooms, changed: true };
};

const alignVerticesToGuidesForLevel = (
  rooms: CanonicalRoom[],
  guides: EditorGuide[],
  level: LevelId,
  maxDistance: number,
) => {
  if (guides.length === 0) {
    return { rooms, changed: false };
  }

  let changed = false;

  for (const room of rooms) {
    if (room.level !== level) continue;

    room.polygon = room.polygon.map((point) => {
      const snap =
        findHoverSnap(point, [], guides, maxDistance, {
          includeGuides: true,
          includeGuideIntersections: true,
          includeGuideWallIntersections: false,
        })?.point ?? null;

      if (!snap) {
        return point;
      }

      const aligned: Point = [
        Number(snap[0].toFixed(3)),
        Number(snap[1].toFixed(3)),
      ];

      if (aligned[0] !== point[0] || aligned[1] !== point[1]) {
        changed = true;
        return aligned;
      }

      return point;
    });
  }

  if (!changed) {
    return { rooms, changed: false };
  }

  for (const room of rooms) {
    if (room.level === level) {
      reconcileRoomOpenings(rooms, room.id);
    }
  }

  return { rooms, changed: true };
};

interface NewEditorState {
  dataset: CanonicalIndoorDataset;
  activeLevel: LevelId;
  tool: NewEditorTool;
  selectedRoomId: string | null;
  selectedOpeningId: string | null;
  guides: EditorGuide[];
  referenceImage: {
    src: string | null;
    sourceName: string | null;
    opacity: number;
    localX: number;
    localY: number;
    localWidth: number;
    naturalWidth: number;
    naturalHeight: number;
    isLoading: boolean;
    error: string | null;
  };
  hoveredSnap: EditorHoverSnap | null;
  draftRoomPoints: Point[];
  draftCursorPoint: Point | null;
  viewport: ViewportState;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  pendingDragHistory: PendingDragHistory | null;
  setTool(tool: NewEditorTool): void;
  setSelection(roomId: string | null, openingId?: string | null): void;
  loadDataset(dataset: CanonicalIndoorDataset): void;
  setReferenceImage(
    patch: Partial<{
      src: string | null;
      sourceName: string | null;
      opacity: number;
      localX: number;
      localY: number;
      localWidth: number;
      naturalWidth: number;
      naturalHeight: number;
      isLoading: boolean;
      error: string | null;
    }>,
  ): void;
  setViewport(viewport: ViewportState): void;
  addGuide(a: Point, b: Point): void;
  updateGuide(guideId: string, a: Point, b: Point): void;
  removeGuide(guideId: string): void;
  panViewport(dx: number, dy: number): void;
  zoomAt(nextZoom: number, anchor: Point): void;
  updateHover(localPoint: Point): void;
  clearHover(): void;
  setDraftCursorPoint(point: Point | null): void;
  pushDraftRoomPoint(point: Point): void;
  commitDraftRoom(): void;
  cancelDraftRoom(): void;
  placeOpening(snap: HoverSnap | null): void;
  updateRoomFields(roomId: string, patch: Partial<Omit<CanonicalRoom, "id">>): void;
  moveRoom(roomId: string, delta: Point): void;
  moveRoomVertex(roomId: string, vertexIndex: number, point: Point): void;
  moveRoomVertices(vertices: Array<{ roomId: string; vertexIndex: number }>, point: Point): void;
  insertRoomVertex(roomId: string, edgeIndex: number, point: Point): void;
  removeRoomVertex(roomId: string, vertexIndex: number): void;
  updateOpeningFields(roomId: string, openingId: string, patch: Partial<CanonicalOpening>): void;
  beginDragHistory(): void;
  moveOpening(roomId: string, openingId: string, point: Point): void;
  commitDragHistory(): void;
  cancelDragHistory(): void;
  mergeNearbyVertices(maxDistance: number): void;
  alignVerticesToGuides(maxDistance: number): void;
  deleteOpening(roomId: string, openingId: string): void;
  deleteRoom(roomId: string): void;
  undo(): void;
  redo(): void;
}

const persistedWorkspace = readPersistedWorkspace();
const initialEditorDataset = persistedWorkspace?.dataset ?? initialDataset();
const initialViewport = persistedWorkspace?.viewport ?? defaultViewportForDataset(initialEditorDataset);

export const useNewEditorStore = create<NewEditorState>((set, get) => ({
  dataset: initialEditorDataset,
  activeLevel: initialEditorDataset.levels[0]?.id ?? "L1",
  tool: persistedWorkspace?.tool ?? "select",
  selectedRoomId: null,
  selectedOpeningId: null,
  guides: (persistedWorkspace?.guides ?? []).map((guide) => ({
    id: guide.id,
    a: [guide.a[0], guide.a[1]] as CanonicalGuide["a"],
    b: [guide.b[0], guide.b[1]] as CanonicalGuide["b"],
  })),
  referenceImage: {
    src: null,
    sourceName: null,
    opacity: persistedWorkspace?.referenceImage.opacity ?? 0.45,
    localX: persistedWorkspace?.referenceImage.localX ?? 0,
    localY: persistedWorkspace?.referenceImage.localY ?? 0,
    localWidth: persistedWorkspace?.referenceImage.localWidth ?? 54,
    naturalWidth: 0,
    naturalHeight: 0,
    isLoading: false,
    error: null,
  },
  hoveredSnap: null,
  draftRoomPoints: [],
  draftCursorPoint: null,
  viewport: initialViewport,
  undoStack: [],
  redoStack: [],
  pendingDragHistory: null,
  setTool: (tool) =>
    set({
      tool,
      draftRoomPoints: tool === "draw-room" ? get().draftRoomPoints : [],
      draftCursorPoint: tool === "draw-room" ? get().draftCursorPoint : null,
    }),
  setSelection: (selectedRoomId, selectedOpeningId = null) => set({ selectedRoomId, selectedOpeningId }),
  loadDataset: (dataset) =>
    set({
      dataset,
      activeLevel: dataset.levels[0]?.id ?? "L1",
      selectedRoomId: null,
      selectedOpeningId: null,
      guides: (dataset.guides ?? []).map((guide) => ({
        id: guide.id,
        a: [guide.a[0], guide.a[1]] as CanonicalGuide["a"],
        b: [guide.b[0], guide.b[1]] as CanonicalGuide["b"],
      })),
      draftRoomPoints: [],
      draftCursorPoint: null,
      hoveredSnap: null,
      tool: "select",
      viewport: defaultViewportForDataset(dataset, get().viewport.zoom),
      undoStack: [],
      redoStack: [],
      pendingDragHistory: null,
    }),
  setReferenceImage: (patch) =>
    set((state) => {
      const nextSrc = patch.src === undefined ? state.referenceImage.src : patch.src;
      if (state.referenceImage.src && state.referenceImage.src !== nextSrc) {
        revokeObjectUrl(state.referenceImage.src);
      }

      const nextReferenceImage = {
        ...state.referenceImage,
        ...patch,
      };
      const touchesHistory =
        patch.opacity !== undefined ||
        patch.localX !== undefined ||
        patch.localY !== undefined ||
        patch.localWidth !== undefined;

      if (!touchesHistory) {
        return { referenceImage: nextReferenceImage };
      }

      return state.pendingDragHistory
        ? { referenceImage: nextReferenceImage }
        : withHistory(state, { referenceImage: nextReferenceImage });
    }),
  setViewport: (viewport) => set({ viewport }),
  addGuide: (a, b) =>
    set((state) => {
      const normalizedA: Point = [Number(a[0].toFixed(3)), Number(a[1].toFixed(3))];
      const normalizedB: Point = [Number(b[0].toFixed(3)), Number(b[1].toFixed(3))];
      if (Math.hypot(normalizedB[0] - normalizedA[0], normalizedB[1] - normalizedA[1]) < 0.05) {
        return {};
      }
      const duplicate = state.guides.some(
        (guide) =>
          Math.hypot(guide.a[0] - normalizedA[0], guide.a[1] - normalizedA[1]) <= 0.05 &&
          Math.hypot(guide.b[0] - normalizedB[0], guide.b[1] - normalizedB[1]) <= 0.05,
      );
      if (duplicate) return {};

      return withHistory(state, {
        guides: [...state.guides, { id: `guide-${nanoid(6)}`, a: normalizedA, b: normalizedB }],
      });
    }),
  updateGuide: (guideId, a, b) =>
    set((state) => {
      const normalizedA: Point = [Number(a[0].toFixed(3)), Number(a[1].toFixed(3))];
      const normalizedB: Point = [Number(b[0].toFixed(3)), Number(b[1].toFixed(3))];
      if (Math.hypot(normalizedB[0] - normalizedA[0], normalizedB[1] - normalizedA[1]) < 0.05) {
        return {};
      }

      const guides = state.guides.map((guide) =>
        guide.id === guideId
          ? { ...guide, a: normalizedA, b: normalizedB }
          : guide,
      );

      return state.pendingDragHistory
        ? { guides }
        : withHistory(state, { guides });
    }),
  removeGuide: (guideId) =>
    set((state) =>
      withHistory(state, {
        guides: state.guides.filter((guide) => guide.id !== guideId),
        hoveredSnap:
          state.hoveredSnap?.kind === "guide" && state.hoveredSnap.guideId === guideId
            ? null
            : state.hoveredSnap,
      }),
    ),
  panViewport: (dx, dy) =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        offsetX: state.viewport.offsetX + dx,
        offsetY: state.viewport.offsetY + dy,
      },
    })),
  zoomAt: (nextZoom, anchor) =>
    set((state) => {
      const clampedZoom = Math.max(2, Math.min(480, nextZoom));
      const local = screenPointToLocalPoint(anchor, state.viewport);
      const viewport = {
        zoom: clampedZoom,
        offsetX: 0,
        offsetY: 0,
      };
      const anchorScreen = localPointToScreenPoint(local, viewport);
      return {
        viewport: {
          zoom: clampedZoom,
          offsetX: anchor[0] - anchorScreen[0],
          offsetY: anchor[1] - anchorScreen[1],
        },
      };
    }),
  updateHover: (localPoint) =>
    set((state) => ({
      hoveredSnap: findHoverSnap(
        localPoint,
        state.dataset.rooms.filter((room) => room.level === state.activeLevel),
        state.tool === "opening" ? [] : state.guides,
        localUnitsFromScreenPixels(20, state.viewport),
        state.tool === "opening"
          ? {
              includeGuides: false,
              includeGuideIntersections: false,
              includeGuideWallIntersections: false,
            }
          : state.tool === "guide"
          ? {
              includeGuides: true,
              includeGuideIntersections: true,
              includeGuideWallIntersections: true,
            }
            : undefined,
      ),
    })),
  clearHover: () => set({ hoveredSnap: null }),
  setDraftCursorPoint: (draftCursorPoint) => set({ draftCursorPoint }),
  pushDraftRoomPoint: (point) =>
    set((state) => {
      if (shouldCloseDraftPolygon(point, state.draftRoomPoints, state.viewport)) {
        const room = createRoomFromDraft(state.draftRoomPoints, state.activeLevel);
        return withHistory(state, {
          dataset: { ...state.dataset, rooms: [...state.dataset.rooms, room] },
          selectedRoomId: room.id,
          selectedOpeningId: null,
          draftRoomPoints: [],
          draftCursorPoint: null,
        });
      }

      return {
        draftRoomPoints: appendDraftPoint(state.draftRoomPoints, point),
      };
    }),
  commitDraftRoom: () =>
    set((state) => {
      if (state.draftRoomPoints.length < 3) return {};
      const room = createRoomFromDraft(state.draftRoomPoints, state.activeLevel);
      return withHistory(state, {
        dataset: { ...state.dataset, rooms: [...state.dataset.rooms, room] },
        selectedRoomId: room.id,
        selectedOpeningId: null,
        draftRoomPoints: [],
        draftCursorPoint: null,
      });
    }),
  cancelDraftRoom: () => set({ draftRoomPoints: [], draftCursorPoint: null }),
  placeOpening: (snap) =>
    set((state) => {
      if (!snap || snap.kind !== "edge") return {};
      const rooms = state.dataset.rooms.filter((room) => room.level === state.activeLevel);
      const placements = buildOpeningPlacements(rooms, snap);
      if (placements.length === 0) return {};

      return withHistory(state, {
        dataset: {
          ...state.dataset,
          rooms: state.dataset.rooms.map((room) => {
            const placement = placements.find((entry) => entry.roomId === room.id);
            if (!placement) return room;
            return {
              ...room,
              openings: [...(room.openings ?? []), placement.opening],
            };
          }),
        },
        selectedRoomId: snap.roomId,
        selectedOpeningId: placements[0]?.opening.id ?? null,
      });
    }),
  updateRoomFields: (roomId, patch) =>
    set((state) =>
      withHistory(state, {
        dataset: {
          ...state.dataset,
          rooms: state.dataset.rooms.map((room) => (room.id === roomId ? { ...room, ...patch } : room)),
        },
      }),
    ),
  moveRoom: (roomId, delta) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms);
      const room = findRoom(rooms, roomId);
      if (!room) return {};

      room.polygon = room.polygon.map(([x, y]) => [x + delta[0], y + delta[1]]);
      room.openings = (room.openings ?? []).map((opening) => ({
        ...opening,
        point: [opening.point[0] + delta[0], opening.point[1] + delta[1]],
      }));
      reconcileRoomOpenings(rooms, roomId);

      return withHistory(state, {
        dataset: { ...state.dataset, rooms },
      });
    }),
  moveRoomVertex: (roomId, vertexIndex, point) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms);
      const room = findRoom(rooms, roomId);
      if (!room || !room.polygon[vertexIndex]) return {};

      room.polygon[vertexIndex] = point;
      reconcileRoomOpenings(rooms, roomId);

      return state.pendingDragHistory
        ? { dataset: { ...state.dataset, rooms } }
        : withHistory(state, {
            dataset: { ...state.dataset, rooms },
          });
    }),
  moveRoomVertices: (vertices, point) =>
    set((state) => {
      if (vertices.length === 0) return {};
      const rooms = cloneRooms(state.dataset.rooms);
      const touchedRoomIds = new Set<string>();
      let changed = false;

      for (const vertex of vertices) {
        const room = findRoom(rooms, vertex.roomId);
        if (!room || !room.polygon[vertex.vertexIndex]) continue;
        room.polygon[vertex.vertexIndex] = point;
        touchedRoomIds.add(vertex.roomId);
        changed = true;
      }

      if (!changed) return {};

      for (const roomId of touchedRoomIds) {
        reconcileRoomOpenings(rooms, roomId);
      }

      return state.pendingDragHistory
        ? { dataset: { ...state.dataset, rooms } }
        : withHistory(state, {
            dataset: { ...state.dataset, rooms },
          });
    }),
  insertRoomVertex: (roomId, edgeIndex, point) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms);
      const room = findRoom(rooms, roomId);
      if (!room) return {};

      room.polygon.splice(edgeIndex + 1, 0, point);
      reconcileRoomOpenings(rooms, roomId);

      return withHistory(state, {
        dataset: { ...state.dataset, rooms },
        selectedRoomId: roomId,
        selectedOpeningId: null,
      });
    }),
  removeRoomVertex: (roomId, vertexIndex) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms);
      const room = findRoom(rooms, roomId);
      if (!room || room.polygon.length <= 3 || !room.polygon[vertexIndex]) return {};

      room.polygon.splice(vertexIndex, 1);
      reconcileRoomOpenings(rooms, roomId);

      return withHistory(state, {
        dataset: { ...state.dataset, rooms },
        selectedRoomId: roomId,
        selectedOpeningId: null,
      });
    }),
  updateOpeningFields: (roomId, openingId, patch) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms);
      const opening = findOpening(rooms, roomId, openingId);
      if (!opening) return {};

      Object.assign(opening, patch);
      reconcileLinkedOpening(rooms, roomId, openingId);

      return withHistory(state, {
        dataset: { ...state.dataset, rooms },
      });
    }),
  beginDragHistory: () =>
    set((state) =>
      state.pendingDragHistory
        ? {}
        : {
            pendingDragHistory: {
              snapshot: createHistorySnapshot(state),
            },
          },
    ),
  moveOpening: (roomId, openingId, point) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms);
      const opening = findOpening(rooms, roomId, openingId);
      if (!opening) return {};

      opening.point = point;
      reconcileLinkedOpening(rooms, roomId, openingId);

      return state.pendingDragHistory
        ? {
            dataset: { ...state.dataset, rooms },
          }
        : withHistory(state, {
            dataset: { ...state.dataset, rooms },
          });
    }),
  commitDragHistory: () =>
    set((state) => {
      if (!state.pendingDragHistory) return {};
      const undoStack = [...state.undoStack, state.pendingDragHistory.snapshot].slice(-MAX_HISTORY_ENTRIES);
      return {
        undoStack,
        redoStack: [],
        pendingDragHistory: null,
      };
    }),
  cancelDragHistory: () => set({ pendingDragHistory: null }),
  mergeNearbyVertices: (maxDistance) =>
    set((state) => {
      if (!(maxDistance > 0)) return {};
      const rooms = cloneRooms(state.dataset.rooms);
      const merged = mergeNearbyVerticesForLevel(rooms, state.activeLevel, maxDistance);
      if (!merged.changed) return {};
      return withHistory(state, {
        dataset: { ...state.dataset, rooms },
        pendingDragHistory: null,
      });
    }),
  alignVerticesToGuides: (maxDistance) =>
    set((state) => {
      if (!(maxDistance > 0) || state.guides.length === 0) return {};
      const rooms = cloneRooms(state.dataset.rooms);
      const aligned = alignVerticesToGuidesForLevel(rooms, state.guides, state.activeLevel, maxDistance);
      if (!aligned.changed) return {};
      return withHistory(state, {
        dataset: { ...state.dataset, rooms },
        pendingDragHistory: null,
      });
    }),
  deleteOpening: (roomId, openingId) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms);
      const linkedRef = findLinkedOpening(rooms, roomId, openingId);

      const nextRooms = rooms.map((room) => {
        if (room.id === roomId) return removeOpeningFromRoom(room, openingId);
        if (linkedRef && room.id === linkedRef.roomId) return removeOpeningFromRoom(room, linkedRef.openingId);
        return room;
      });

      return withHistory(state, {
        dataset: { ...state.dataset, rooms: nextRooms },
        selectedOpeningId: state.selectedOpeningId === openingId || state.selectedOpeningId === linkedRef?.openingId ? null : state.selectedOpeningId,
        pendingDragHistory: null,
      });
    }),
  deleteRoom: (roomId) =>
    set((state) => {
      const rooms = cloneRooms(state.dataset.rooms).filter((room) => room.id !== roomId);
      clearRoomLinks(rooms, roomId);

      return withHistory(state, {
        dataset: { ...state.dataset, rooms },
        selectedRoomId: state.selectedRoomId === roomId ? null : state.selectedRoomId,
        selectedOpeningId: null,
        pendingDragHistory: null,
      });
    }),
  undo: () =>
    set((state) => {
      const snapshot = state.undoStack.at(-1);
      if (!snapshot) return {};
      const redoStack = [...state.redoStack, createHistorySnapshot(state)].slice(-MAX_HISTORY_ENTRIES);
      return {
        ...applyHistorySnapshot(state, snapshot, state.undoStack.slice(0, -1), redoStack),
        pendingDragHistory: null,
      };
    }),
  redo: () =>
    set((state) => {
      const snapshot = state.redoStack.at(-1);
      if (!snapshot) return {};
      const undoStack = [...state.undoStack, createHistorySnapshot(state)].slice(-MAX_HISTORY_ENTRIES);
      return {
        ...applyHistorySnapshot(state, snapshot, undoStack, state.redoStack.slice(0, -1)),
        pendingDragHistory: null,
      };
    }),
}));

let lastPersistedWorkspace = "";

useNewEditorStore.subscribe((state) => {
  if (typeof window === "undefined") return;

  const workspace: PersistedWorkspaceState = {
    dataset: cloneValue(state.dataset),
    guides: exportableGuides(state.guides),
    viewport: state.viewport,
    tool: state.tool,
    referenceImage: {
      opacity: state.referenceImage.opacity,
      localX: state.referenceImage.localX,
      localY: state.referenceImage.localY,
      localWidth: state.referenceImage.localWidth,
    },
  };

  const serialized = JSON.stringify(workspace);
  if (serialized === lastPersistedWorkspace) return;
  lastPersistedWorkspace = serialized;
  window.localStorage.setItem(NEW_EDITOR_STORAGE_KEY, serialized);
});

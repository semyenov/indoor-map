import { useRef, useState } from "react";
import { CanvasViewport } from "./CanvasViewport";
import { useNewEditorStore } from "../state/editorStore";
import { guideAngleFromPoints, guideReferencePoints, localUnitsFromScreenPixels, screenPointToLocalPoint } from "../model/commands";
import { hitTestRooms } from "../model/hitTest";
import { findHoverSnap } from "../model/snapping";

const SNAP_RADIUS_PX = 20;
const GUIDE_HIT_RADIUS_PX = 12;
const REFERENCE_HANDLE_RADIUS_PX = 14;

type DragState =
  | { kind: "vertex"; roomId: string; vertexIndex: number; moved: boolean }
  | { kind: "vertex-group"; vertices: Array<{ roomId: string; vertexIndex: number }>; roomId: string; moved: boolean }
  | { kind: "guide-point"; guideId: string; moved: boolean }
  | { kind: "reference"; lastLocal: [number, number]; moved: boolean }
  | { kind: "reference-scale"; anchorX: number; anchorY: number; aspect: number; moved: boolean }
  | { kind: "opening"; roomId: string; openingId: string; moved: boolean };

interface Props {
  width: number;
  height: number;
}

export const CanvasShell = ({ width, height }: Props) => {
  const shellRef = useRef<HTMLDivElement>(null);
  const [panOrigin, setPanOrigin] = useState<[number, number] | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [draftGuideStart, setDraftGuideStart] = useState<[number, number] | null>(null);
  const [guideCursorPoint, setGuideCursorPoint] = useState<[number, number] | null>(null);
  const {
    activeLevel,
    dataset,
    guides,
    hoveredSnap,
    selectedRoomId,
    selectedGuideId,
    referenceImage,
    addGuide,
    updateGuide,
    removeGuide,
    setSelection,
    setSelectedGuide,
    setReferenceImage,
    viewport,
    panViewport,
    zoomAt,
    updateHover,
    clearHover,
    setDraftCursorPoint,
    pushDraftRoomPoint,
    placeOpening,
    deleteRoom,
    mergeRooms,
    moveRoomVertex,
    moveRoomVertices,
    insertRoomVertex,
    removeRoomVertex,
    beginDragHistory,
    moveOpening,
    commitDragHistory,
    cancelDragHistory,
    deleteOpening,
    tool,
  } = useNewEditorStore();

  const rooms = dataset.rooms.filter((room) => room.level === activeLevel);
  const stackedRooms =
    selectedRoomId
      ? [
          ...rooms.filter((room) => room.id !== selectedRoomId),
          ...rooms.filter((room) => room.id === selectedRoomId),
        ]
      : rooms;
  const hitRooms = [...stackedRooms].reverse();

  const eventPoint = (clientX: number, clientY: number): [number, number] => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [clientX - rect.left, clientY - rect.top];
  };

  const referenceHeight =
    referenceImage.naturalWidth > 0 && referenceImage.naturalHeight > 0
      ? referenceImage.localWidth * (referenceImage.naturalHeight / referenceImage.naturalWidth)
      : 0;

  const pointInsideReference = (localPoint: [number, number]) =>
    referenceImage.src &&
    referenceHeight > 0 &&
    localPoint[0] >= referenceImage.localX &&
    localPoint[0] <= referenceImage.localX + referenceImage.localWidth &&
    localPoint[1] >= referenceImage.localY &&
    localPoint[1] <= referenceImage.localY + referenceHeight;

  const pointNearReferenceScaleHandle = (localPoint: [number, number]) => {
    if (!referenceImage.src || referenceHeight <= 0) return false;
    const handlePoint: [number, number] = [
      referenceImage.localX + referenceImage.localWidth,
      referenceImage.localY + referenceHeight,
    ];
    return (
      Math.hypot(localPoint[0] - handlePoint[0], localPoint[1] - handlePoint[1]) <=
      localUnitsFromScreenPixels(REFERENCE_HANDLE_RADIUS_PX, viewport)
    );
  };

  const findGuideHit = (localPoint: [number, number]) => {
    let bestGuide: { id: string; distance: number } | null = null;
    for (const guide of guides) {
      const reference = guideReferencePoints(guide);
      const dx = reference.b[0] - reference.a[0];
      const dy = reference.b[1] - reference.a[1];
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-9) continue;
      const t = ((localPoint[0] - reference.a[0]) * dx + (localPoint[1] - reference.a[1]) * dy) / lenSq;
      const projected: [number, number] = [reference.a[0] + dx * t, reference.a[1] + dy * t];
      const guideDistance = Math.hypot(localPoint[0] - projected[0], localPoint[1] - projected[1]);
      if (guideDistance > localUnitsFromScreenPixels(GUIDE_HIT_RADIUS_PX, viewport)) continue;
      if (!bestGuide || guideDistance < bestGuide.distance) {
        bestGuide = { id: guide.id, distance: guideDistance };
      }
    }
    return bestGuide;
  };

  const findGuideHandleHit = (localPoint: [number, number]) => {
    let bestHandle: { guideId: string; distance: number } | null = null;
    for (const guide of guides) {
      const handleDistance = Math.hypot(localPoint[0] - guide.point[0], localPoint[1] - guide.point[1]);
      if (handleDistance > localUnitsFromScreenPixels(GUIDE_HIT_RADIUS_PX, viewport)) continue;
      if (!bestHandle || handleDistance < bestHandle.distance) {
        bestHandle = { guideId: guide.id, distance: handleDistance };
      }
    }
    return bestHandle;
  };

  const guidePreview =
    draftGuideStart
      ? (() => {
          const point = guideCursorPoint;
          if (!point) return null;
          if (Math.hypot(point[0] - draftGuideStart[0], point[1] - draftGuideStart[1]) < 0.05) return null;
          return { a: draftGuideStart, b: point };
        })()
      : null;

  const findUnderlyingVertices = (point: [number, number]) => {
    const threshold = localUnitsFromScreenPixels(12, viewport);
    const vertices: Array<{ roomId: string; vertexIndex: number }> = [];
    for (const room of hitRooms) {
      for (let vertexIndex = 0; vertexIndex < room.polygon.length; vertexIndex += 1) {
        const vertex = room.polygon[vertexIndex]!;
        if (Math.hypot(vertex[0] - point[0], vertex[1] - point[1]) <= threshold) {
          vertices.push({ roomId: room.id, vertexIndex });
        }
      }
    }
    return vertices;
  };

  const finishDrag = (state: DragState | null) => {
    if (!state) return;
    if (state.moved) {
      commitDragHistory();
    } else {
      cancelDragHistory();
    }
  };

  return (
    <div
      ref={shellRef}
      className="ne-canvas-shell"
      style={{ cursor: tool === "pan" ? "grab" : tool === "reference" ? "move" : tool === "delete" ? "not-allowed" : "crosshair" }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = eventPoint(event.clientX, event.clientY);
        if (tool === "pan" || event.button === 1) {
          setPanOrigin(point);
          return;
        }

        const localPoint = screenPointToLocalPoint(point, viewport);
        if (tool === "delete") {
          const guideHit = findGuideHit(localPoint);
          if (guideHit) {
            removeGuide(guideHit.id);
            return;
          }
          const hit = hitTestRooms(localPoint, hitRooms, {
            preferredRoomId: selectedRoomId,
            zoom: viewport.zoom,
          });
          if (hit?.kind === "opening") {
            deleteOpening(hit.roomId, hit.openingId);
            return;
          }
          if (hit?.kind === "room" || hit?.kind === "vertex" || hit?.kind === "edge") {
            deleteRoom(hit.roomId);
          }
          return;
        }
        if (tool === "guide") {
          const snappedGuidePoint =
            findHoverSnap(localPoint, rooms, guides, localUnitsFromScreenPixels(SNAP_RADIUS_PX, viewport), {
              includeGuides: true,
              includeGuideIntersections: true,
              includeGuideWallIntersections: true,
            })?.point ?? localPoint;
          if (!draftGuideStart) {
            setDraftGuideStart(snappedGuidePoint);
            setGuideCursorPoint(snappedGuidePoint);
            return;
          }
          if (Math.hypot(snappedGuidePoint[0] - draftGuideStart[0], snappedGuidePoint[1] - draftGuideStart[1]) >= 0.05) {
            addGuide(draftGuideStart, guideAngleFromPoints(draftGuideStart, snappedGuidePoint));
          }
          setDraftGuideStart(null);
          setGuideCursorPoint(null);
          return;
        }
        if (tool === "reference") {
          if (pointNearReferenceScaleHandle(localPoint) && referenceImage.naturalWidth > 0) {
            beginDragHistory();
            setDragState({
              kind: "reference-scale",
              anchorX: referenceImage.localX,
              anchorY: referenceImage.localY,
              aspect: referenceImage.naturalHeight / referenceImage.naturalWidth,
              moved: false,
            });
            return;
          }
          if (pointInsideReference(localPoint)) {
            beginDragHistory();
            setDragState({ kind: "reference", lastLocal: localPoint, moved: false });
          }
          return;
        }
        const immediateSnap = findHoverSnap(
          localPoint,
          rooms,
          tool === "opening" ? [] : guides,
          localUnitsFromScreenPixels(SNAP_RADIUS_PX, viewport),
          tool === "opening"
            ? {
                includeGuides: false,
                includeGuideIntersections: false,
                includeGuideWallIntersections: false,
              }
            : undefined,
        );
        const snappedPoint = immediateSnap?.point ?? localPoint;
        if (tool === "draw-room") {
          pushDraftRoomPoint(snappedPoint);
          return;
        }
        if (tool === "opening") {
          placeOpening(immediateSnap);
          return;
        }

        const hit = hitTestRooms(localPoint, hitRooms, {
          preferredRoomId: selectedRoomId,
          zoom: viewport.zoom,
        });
        if (tool === "merge") {
          if (hit?.kind === "opening") {
            setSelection(hit.roomId, null);
            return;
          }
          if (hit?.kind === "vertex" || hit?.kind === "edge" || hit?.kind === "room") {
            if (!selectedRoomId || selectedRoomId === hit.roomId) {
              setSelection(hit.roomId, null);
              return;
            }
            const merged = mergeRooms(selectedRoomId, hit.roomId);
            if (!merged) {
              setSelection(hit.roomId, null);
            }
            return;
          }
          setSelection(null, null);
          if (selectedGuideId) {
            setSelectedGuide(null);
          }
          return;
        }
        if (hit?.kind === "opening") {
          setSelection(hit.roomId, hit.openingId);
          beginDragHistory();
          setDragState({ kind: "opening", roomId: hit.roomId, openingId: hit.openingId, moved: false });
          return;
        }
        if (hit?.kind === "vertex") {
          beginDragHistory();
          if (!selectedRoomId) {
            const vertices = findUnderlyingVertices(hit.point);
            setSelection(null, null);
            setDragState({
              kind: "vertex-group",
              vertices: vertices.length > 0 ? vertices : [{ roomId: hit.roomId, vertexIndex: hit.vertexIndex }],
              roomId: hit.roomId,
              moved: false,
            });
            return;
          }
          setSelection(hit.roomId, null);
          setDragState({ kind: "vertex", roomId: hit.roomId, vertexIndex: hit.vertexIndex, moved: false });
          return;
        }
        if (hit?.kind === "room") {
          setSelection(hit.roomId, null);
          return;
        }
        if (tool === "select") {
          const handleHit = findGuideHandleHit(localPoint);
          if (handleHit) {
            setSelectedGuide(handleHit.guideId);
            beginDragHistory();
            setDragState({ kind: "guide-point", guideId: handleHit.guideId, moved: false });
            return;
          }
          const guideHit = findGuideHit(localPoint);
          if (guideHit) {
            setSelectedGuide(guideHit.id);
            return;
          }
        }
        if (!hit) {
          setSelection(null, null);
          if (selectedGuideId) {
            setSelectedGuide(null);
          }
          return;
        }
        setSelection(hit.roomId ?? null, null);
      }}
      onPointerMove={(event) => {
        if (panOrigin || dragState) {
          event.preventDefault();
        }
        const point = eventPoint(event.clientX, event.clientY);
        const localPoint = screenPointToLocalPoint(point, viewport);
        const immediateSnap = findHoverSnap(
          localPoint,
          rooms,
          tool === "opening" ? [] : guides,
          localUnitsFromScreenPixels(SNAP_RADIUS_PX, viewport),
          tool === "opening"
            ? {
                includeGuides: false,
                includeGuideIntersections: false,
                includeGuideWallIntersections: false,
              }
            : tool === "guide"
              ? {
                  includeGuides: true,
                  includeGuideIntersections: true,
                  includeGuideWallIntersections: true,
                }
              : undefined,
        );
        updateHover(localPoint);
        setDraftCursorPoint(immediateSnap?.point ?? localPoint);
        if (tool === "guide" && draftGuideStart) {
          setGuideCursorPoint(immediateSnap?.point ?? localPoint);
        } else if (guideCursorPoint) {
          setGuideCursorPoint(null);
        }
        if (panOrigin) {
          panViewport(point[0] - panOrigin[0], point[1] - panOrigin[1]);
          setPanOrigin(point);
          return;
        }
        if (dragState?.kind === "reference") {
          setReferenceImage({
            localX: referenceImage.localX + (localPoint[0] - dragState.lastLocal[0]),
            localY: referenceImage.localY + (localPoint[1] - dragState.lastLocal[1]),
          });
          setDragState({ kind: "reference", lastLocal: localPoint, moved: true });
          return;
        }
        if (dragState?.kind === "guide-point") {
          const guide = guides.find((entry) => entry.id === dragState.guideId);
          if (!guide) return;
          const snapTarget =
            findHoverSnap(
              localPoint,
              rooms,
              guides.filter((entry) => entry.id !== dragState.guideId),
              localUnitsFromScreenPixels(SNAP_RADIUS_PX, viewport),
            )?.point ?? localPoint;
          updateGuide(dragState.guideId, snapTarget, guide.angle);
          setDragState({ ...dragState, moved: true });
          return;
        }
        if (dragState?.kind === "reference-scale") {
          const widthFromX = localPoint[0] - dragState.anchorX;
          const widthFromY = (localPoint[1] - dragState.anchorY) / Math.max(dragState.aspect, 1e-6);
          const nextWidth =
            Math.abs(widthFromX) >= Math.abs(widthFromY)
              ? widthFromX
              : widthFromY;
          setReferenceImage({
            localWidth: Math.max(1, nextWidth),
          });
          setDragState({ ...dragState, moved: true });
          return;
        }
        if (dragState?.kind === "vertex") {
          const snapTarget =
            findHoverSnap(
              localPoint,
              rooms.filter((room) => room.id !== dragState.roomId),
              guides,
              localUnitsFromScreenPixels(SNAP_RADIUS_PX, viewport),
            )?.point ?? localPoint;
          moveRoomVertex(dragState.roomId, dragState.vertexIndex, snapTarget);
          setDragState({ ...dragState, moved: true });
          return;
        }
        if (dragState?.kind === "vertex-group") {
          const excludedRoomIds = new Set(dragState.vertices.map((vertex) => vertex.roomId));
          const snapTarget =
            findHoverSnap(
              localPoint,
              rooms.filter((room) => !excludedRoomIds.has(room.id)),
              guides,
              localUnitsFromScreenPixels(SNAP_RADIUS_PX, viewport),
            )?.point ?? localPoint;
          moveRoomVertices(dragState.vertices, snapTarget);
          setDragState({ ...dragState, moved: true });
          return;
        }
        if (dragState?.kind === "opening") {
          moveOpening(dragState.roomId, dragState.openingId, localPoint);
          setDragState({ ...dragState, moved: true });
        }
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        finishDrag(dragState);
        setPanOrigin(null);
        setDragState(null);
      }}
      onPointerLeave={() => {
        finishDrag(dragState);
        setPanOrigin(null);
        setDragState(null);
        setGuideCursorPoint(null);
        clearHover();
        setDraftCursorPoint(null);
      }}
      onDoubleClick={(event) => {
        if (tool !== "select") return;
        const point = eventPoint(event.clientX, event.clientY);
        const localPoint = screenPointToLocalPoint(point, viewport);
        const hit = hitTestRooms(localPoint, hitRooms, {
          preferredRoomId: selectedRoomId,
          zoom: viewport.zoom,
        });
        if (hit?.kind === "edge") {
          insertRoomVertex(hit.roomId, hit.edgeIndex, hit.point);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (tool === "guide" && draftGuideStart) {
          setDraftGuideStart(null);
          setGuideCursorPoint(null);
          return;
        }
        if (tool !== "select") return;
        const point = eventPoint(event.clientX, event.clientY);
        const localPoint = screenPointToLocalPoint(point, viewport);
        const hit = hitTestRooms(localPoint, hitRooms, {
          preferredRoomId: selectedRoomId,
          zoom: viewport.zoom,
        });
        if (hit?.kind === "vertex") {
          removeRoomVertex(hit.roomId, hit.vertexIndex);
        }
      }}
      onWheel={(event) => {
        event.preventDefault();
        const point = eventPoint(event.clientX, event.clientY);
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        zoomAt(viewport.zoom * factor, point);
      }}
    >
      <CanvasViewport
        width={width}
        height={height}
        rooms={rooms}
        hoveredSnap={hoveredSnap}
        guidePreview={guidePreview}
      />
    </div>
  );
};

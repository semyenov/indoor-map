import type { CanonicalRoom } from "../../lib/types";
import type { EditorHoverSnap } from "../model/commands";
import { polygonCentroid } from "../model/geometry";
import { localPointToScreenPoint } from "../model/commands";
import { useNewEditorStore } from "../state/editorStore";
import { findOpeningEdge, pairIdFromOpeningId } from "../model/openings";

interface Props {
  width: number;
  height: number;
  rooms: CanonicalRoom[];
  hoveredSnap: EditorHoverSnap | null;
  guidePreview: { a: [number, number]; b: [number, number] } | null;
}

export const CanvasViewport = ({ width, height, rooms, hoveredSnap, guidePreview }: Props) => {
  const {
    guides,
    viewport,
    selectedRoomId,
    selectedOpeningId,
    draftRoomPoints,
    draftCursorPoint,
    tool,
    referenceImage,
  } = useNewEditorStore();
  const cols = Math.ceil(width / 40);
  const rows = Math.ceil(height / 40);
  const orderedRooms = [...rooms].sort((left, right) => {
    if (left.id === selectedRoomId) return 1;
    if (right.id === selectedRoomId) return -1;
    return 0;
  });
  const baseRooms = orderedRooms.filter((room) => room.id !== selectedRoomId);
  const selectedRoom = selectedRoomId ? rooms.find((room) => room.id === selectedRoomId) ?? null : null;
  const renderRoom = (room: CanonicalRoom, emphasizeSelection: boolean, showVertices: boolean) => {
    const polygon = room.polygon.map((point) => localPointToScreenPoint(point, viewport));
    const centroid = localPointToScreenPoint(polygonCentroid(room.polygon), viewport);
    const isSelected = room.id === selectedRoomId;
    return (
      <g key={emphasizeSelection ? `${room.id}:overlay` : room.id}>
        <polygon
          className={isSelected ? "ne-room is-selected" : "ne-room"}
          points={polygon.map(([x, y]) => `${x},${y}`).join(" ")}
          fill={emphasizeSelection ? "rgba(0,0,0,0)" : undefined}
        />
        <text className="ne-room-label" x={centroid[0]} y={centroid[1]}>
          {room.name}
        </text>
        {isSelected && showVertices &&
          polygon.map(([x, y], index) => (
            <circle key={index} className="ne-vertex" cx={x} cy={y} r={6} />
          ))}
      </g>
    );
  };
  const draftScreenPoints = draftRoomPoints.map((point) => localPointToScreenPoint(point, viewport));
  const draftPreviewPoints =
    draftCursorPoint && draftRoomPoints.length > 0
      ? [...draftScreenPoints, localPointToScreenPoint(draftCursorPoint, viewport)]
      : draftScreenPoints;
  const openingPreviewRoom =
    tool === "opening" && hoveredSnap?.kind === "edge"
      ? rooms.find((room) => room.id === hoveredSnap.roomId) ?? null
      : null;
  const openingPreviewEdge = openingPreviewRoom && hoveredSnap?.kind === "edge"
    ? findOpeningEdge(openingPreviewRoom, hoveredSnap.point)
    : null;
  const renderedOpeningKeys = new Set<string>();
  const referenceHeight =
    referenceImage.naturalWidth > 0 && referenceImage.naturalHeight > 0
      ? referenceImage.localWidth * (referenceImage.naturalHeight / referenceImage.naturalWidth)
      : 0;
  const referenceTopLeft =
    referenceImage.src && referenceHeight > 0
      ? localPointToScreenPoint(
          [referenceImage.localX, referenceImage.localY + referenceHeight],
          viewport,
        )
      : null;
  const referenceTopRight =
    referenceImage.src && referenceHeight > 0
      ? localPointToScreenPoint(
          [referenceImage.localX + referenceImage.localWidth, referenceImage.localY + referenceHeight],
          viewport,
        )
      : null;
  const screenGuide = (a: [number, number], b: [number, number]) => {
    const aScreen = localPointToScreenPoint(a, viewport);
    const bScreen = localPointToScreenPoint(b, viewport);
    const dx = bScreen[0] - aScreen[0];
    const dy = bScreen[1] - aScreen[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      return null;
    }
    const ux = dx / len;
    const uy = dy / len;
    const margin = 240;
    const minX = -margin;
    const maxX = width + margin;
    const minY = -margin;
    const maxY = height + margin;
    const intersections: Array<{ t: number; x: number; y: number }> = [];
    const pushIntersection = (t: number) => {
      const x = aScreen[0] + ux * t;
      const y = aScreen[1] + uy * t;
      if (x < minX - 1 || x > maxX + 1 || y < minY - 1 || y > maxY + 1) return;
      intersections.push({ t, x, y });
    };

    if (Math.abs(ux) > 1e-6) {
      pushIntersection((minX - aScreen[0]) / ux);
      pushIntersection((maxX - aScreen[0]) / ux);
    }
    if (Math.abs(uy) > 1e-6) {
      pushIntersection((minY - aScreen[1]) / uy);
      pushIntersection((maxY - aScreen[1]) / uy);
    }

    intersections.sort((left, right) => left.t - right.t);
    const start = intersections[0];
    const end = intersections.at(-1);
    if (!start || !end) {
      return null;
    }
    return {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      ax: aScreen[0],
      ay: aScreen[1],
      bx: bScreen[0],
      by: bScreen[1],
    };
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} aria-label="New floor plan editor canvas">
      <g>
        {Array.from({ length: cols }).map((_, index) => (
          <line
            key={`v-${index}`}
            className="ne-canvas-grid"
            x1={index * 40}
            y1={0}
            x2={index * 40}
            y2={height}
          />
        ))}
        {Array.from({ length: rows }).map((_, index) => (
          <line
            key={`h-${index}`}
            className="ne-canvas-grid"
            x1={0}
            y1={index * 40}
            x2={width}
            y2={index * 40}
          />
        ))}
      </g>
      {referenceImage.src && referenceTopLeft && referenceHeight > 0 && (
        <g opacity={referenceImage.opacity}>
          <image
            href={referenceImage.src}
            x={referenceTopLeft[0]}
            y={referenceTopLeft[1]}
            width={referenceImage.localWidth * viewport.zoom}
            height={referenceHeight * viewport.zoom}
            preserveAspectRatio="none"
          />
          {tool === "reference" && (
            <>
              <rect
                x={referenceTopLeft[0]}
                y={referenceTopLeft[1]}
                width={referenceImage.localWidth * viewport.zoom}
                height={referenceHeight * viewport.zoom}
                fill="none"
                stroke="rgba(15, 118, 110, 0.9)"
                strokeWidth={2}
                strokeDasharray="10 6"
              />
              {referenceTopRight && (
                <circle
                  cx={referenceTopRight[0]}
                  cy={referenceTopRight[1]}
                  r={7}
                  fill="#fffaf5"
                  stroke="rgba(15, 118, 110, 0.95)"
                  strokeWidth={2}
                />
              )}
            </>
          )}
        </g>
      )}
      {baseRooms.map((room) => renderRoom(room, false, false))}
      {guides.map((guide) => {
        const line = screenGuide(guide.a, guide.b);
        if (!line) return null;
        return (
          <g key={guide.id}>
            <line
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="rgba(37, 99, 235, 0.62)"
              strokeWidth={2}
              strokeDasharray="10 6"
            />
            <circle cx={line.ax} cy={line.ay} r={tool === "select" ? 5.5 : 4.5} fill="#eff6ff" stroke="rgba(37, 99, 235, 0.82)" strokeWidth={1.5} />
            <circle cx={line.bx} cy={line.by} r={tool === "select" ? 5.5 : 4.5} fill="#eff6ff" stroke="rgba(37, 99, 235, 0.82)" strokeWidth={1.5} />
          </g>
        );
      })}
      {guidePreview &&
        (() => {
          const line = screenGuide(guidePreview.a, guidePreview.b);
          if (!line) return null;
          return (
            <g>
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="rgba(37, 99, 235, 0.9)"
                strokeWidth={2}
                strokeDasharray="12 6"
              />
              <circle cx={line.ax} cy={line.ay} r={5} fill="#dbeafe" stroke="rgba(37, 99, 235, 0.95)" strokeWidth={1.5} />
              <circle cx={line.bx} cy={line.by} r={5} fill="#dbeafe" stroke="rgba(37, 99, 235, 0.95)" strokeWidth={1.5} />
            </g>
          );
        })()}
      {orderedRooms.map((room) =>
        (room.openings ?? []).map((opening) => {
          const pairId = pairIdFromOpeningId(opening.id);
          const renderKey = pairId
            ? `pair:${pairId}`
            : opening.connectsTo
              ? `link:${[room.id, opening.connectsTo].sort().join(":")}:${opening.point[0].toFixed(2)}:${opening.point[1].toFixed(2)}`
              : `opening:${room.id}:${opening.id}`;
          if (renderedOpeningKeys.has(renderKey)) {
            return null;
          }
          renderedOpeningKeys.add(renderKey);

          const edge = findOpeningEdge(room, opening.point);
          const edgeScreenA = localPointToScreenPoint(edge.a, viewport);
          const edgeScreenB = localPointToScreenPoint(edge.b, viewport);
          const dx = edgeScreenB[0] - edgeScreenA[0];
          const dy = edgeScreenB[1] - edgeScreenA[1];
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const nx = -uy;
          const ny = ux;
          const halfWidth = (opening.width * viewport.zoom) / 2;
          const screenPoint = localPointToScreenPoint(opening.point, viewport);
          const isSelectedOpening =
            room.id === selectedRoomId && opening.id === selectedOpeningId;
          const isConnectedOpening = Boolean(opening.connectsTo);
          return (
            <g key={opening.id}>
              {isConnectedOpening && (
                <>
                  <line
                    x1={screenPoint[0] - nx * 8}
                    y1={screenPoint[1] - ny * 8}
                    x2={screenPoint[0] + nx * 8}
                    y2={screenPoint[1] + ny * 8}
                    stroke={isSelectedOpening ? "#0f766e" : "rgba(20, 184, 166, 0.9)"}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={screenPoint[0] - nx * 8}
                    cy={screenPoint[1] - ny * 8}
                    r={2.6}
                    fill="#f0fdfa"
                    stroke={isSelectedOpening ? "#0f766e" : "rgba(20, 184, 166, 0.95)"}
                    strokeWidth={1.4}
                  />
                  <circle
                    cx={screenPoint[0] + nx * 8}
                    cy={screenPoint[1] + ny * 8}
                    r={2.6}
                    fill="#f0fdfa"
                    stroke={isSelectedOpening ? "#0f766e" : "rgba(20, 184, 166, 0.95)"}
                    strokeWidth={1.4}
                  />
                </>
              )}
              {isSelectedOpening && (
                <circle
                  cx={screenPoint[0]}
                  cy={screenPoint[1]}
                  r={10}
                  fill="rgba(15, 118, 110, 0.14)"
                  stroke="#0f766e"
                  strokeWidth={2}
                />
              )}
              <line
                x1={screenPoint[0] - ux * halfWidth}
                y1={screenPoint[1] - uy * halfWidth}
                x2={screenPoint[0] + ux * halfWidth}
                y2={screenPoint[1] + uy * halfWidth}
                stroke={isSelectedOpening ? "#0f766e" : "#0f172a"}
                strokeWidth={isSelectedOpening ? 5 : 4}
                strokeLinecap="round"
              />
              <circle
                cx={screenPoint[0]}
                cy={screenPoint[1]}
                r={isSelectedOpening ? 4.5 : 3}
                fill="#fffaf5"
                stroke={isSelectedOpening ? "#0f766e" : "#0f172a"}
                strokeWidth={1.5}
              />
            </g>
          );
        }),
      )}
      {selectedRoom && renderRoom(selectedRoom, true, false)}
      {selectedRoom &&
        (() => {
          const polygon = selectedRoom.polygon.map((point) => localPointToScreenPoint(point, viewport));
          return (
            <g key={`${selectedRoom.id}:vertices`}>
              {polygon.map(([x, y], index) => (
                <circle key={index} className="ne-vertex" cx={x} cy={y} r={6} />
              ))}
            </g>
          );
        })()}
      {draftScreenPoints.length > 0 && (
        <g>
          {draftPreviewPoints.length >= 2 && (
            <polyline
              points={draftPreviewPoints.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="var(--ne-accent)"
              strokeWidth={2.5}
              strokeDasharray="8 6"
            />
          )}
          {draftScreenPoints.map(([x, y], index) => (
            <circle key={index} className="ne-vertex" cx={x} cy={y} r={5} />
          ))}
        </g>
      )}
      {openingPreviewRoom && openingPreviewEdge && hoveredSnap?.kind === "edge" && (
        <g>
          {(() => {
            const edgeScreenA = localPointToScreenPoint(openingPreviewEdge.a, viewport);
            const edgeScreenB = localPointToScreenPoint(openingPreviewEdge.b, viewport);
            const dx = edgeScreenB[0] - edgeScreenA[0];
            const dy = edgeScreenB[1] - edgeScreenA[1];
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const center = localPointToScreenPoint(hoveredSnap.point, viewport);
            return (
              <line
                x1={center[0] - ux * (viewport.zoom / 2)}
                y1={center[1] - uy * (viewport.zoom / 2)}
                x2={center[0] + ux * (viewport.zoom / 2)}
                y2={center[1] + uy * (viewport.zoom / 2)}
                stroke="rgba(15, 23, 42, 0.55)"
                strokeWidth={4}
                strokeLinecap="round"
              />
            );
          })()}
        </g>
      )}
      {hoveredSnap && (
        <g>
          {hoveredSnap.kind === "guide" &&
            (() => {
              const guide = guides.find((entry) => entry.id === hoveredSnap.guideId);
              const line = guide ? screenGuide(guide.a, guide.b) : null;
              if (!line) return null;
              return (
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke="rgba(37, 99, 235, 0.72)"
                  strokeWidth={2}
                  strokeDasharray="8 5"
                />
              );
            })()}
          <circle className="ne-snap-ring" cx={localPointToScreenPoint(hoveredSnap.point, viewport)[0]} cy={localPointToScreenPoint(hoveredSnap.point, viewport)[1]} r={12} />
          <circle className="ne-snap-dot" cx={localPointToScreenPoint(hoveredSnap.point, viewport)[0]} cy={localPointToScreenPoint(hoveredSnap.point, viewport)[1]} r={4} />
          {hoveredSnap.kind === "edge" && (
            <circle
              cx={localPointToScreenPoint(hoveredSnap.point, viewport)[0]}
              cy={localPointToScreenPoint(hoveredSnap.point, viewport)[1]}
              r={18}
              fill="none"
              stroke="rgba(15, 23, 42, 0.25)"
              strokeDasharray="6 5"
            />
          )}
        </g>
      )}
    </svg>
  );
};

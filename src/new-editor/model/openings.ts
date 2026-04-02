import { nanoid } from "nanoid";
import type { CanonicalOpening, CanonicalRoom } from "../../lib/types";
import type { HoverSnap } from "./snapping";
import type { Point } from "./geometry";
import { distance, nearestPointOnSegment } from "./geometry";

const EDGE_EPSILON = 0.08;
const OPENING_PAIR_ID_RE = /^opening-([A-Za-z0-9_-]+)-[ab]$/;

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];

export const edgeAt = (room: CanonicalRoom, edgeIndex: number) => {
  const a = room.polygon[edgeIndex]!;
  const b = room.polygon[(edgeIndex + 1) % room.polygon.length]!;
  return { a, b };
};

const pointOnSegment = (point: Point, a: Point, b: Point) => {
  const ap = sub(point, a);
  const ab = sub(b, a);
  const abLenSq = dot(ab, ab);
  if (abLenSq < 1e-9) return false;
  const cross = Math.abs(ap[0] * ab[1] - ap[1] * ab[0]);
  if (cross > EDGE_EPSILON) return false;
  const t = dot(ap, ab) / abLenSq;
  return t >= -EDGE_EPSILON && t <= 1 + EDGE_EPSILON;
};

const areSharedEdges = (a0: Point, a1: Point, b0: Point, b1: Point, point: Point) => {
  const av = sub(a1, a0);
  const bv = sub(b1, b0);
  const cross = Math.abs(av[0] * bv[1] - av[1] * bv[0]);
  if (cross > EDGE_EPSILON) return false;
  if (!pointOnSegment(point, a0, a1) || !pointOnSegment(point, b0, b1)) return false;
  return true;
};

export const pairIdFromOpeningId = (openingId: string) => openingId.match(OPENING_PAIR_ID_RE)?.[1] ?? null;

const openingForRoom = (
  pairId: string | null,
  side: "a" | "b",
  roomId: string,
  point: Point,
  connectsTo?: string,
): CanonicalOpening => ({
  id: pairId ? `opening-${pairId}-${side}` : `opening-${roomId}-${nanoid(5)}`,
  point,
  width: 1,
  kind: "door",
  traversable: true,
  connectsTo,
});

export interface OpeningPlacementResult {
  roomId: string;
  opening: CanonicalOpening;
}

export const buildOpeningPlacements = (
  rooms: CanonicalRoom[],
  snap: HoverSnap,
): OpeningPlacementResult[] => {
  if (snap.kind !== "edge") return [];

  const sourceRoom = rooms.find((room) => room.id === snap.roomId);
  if (!sourceRoom) return [];

  const sourceEdge = edgeAt(sourceRoom, snap.index);
  const sibling = rooms.find((room) => {
    if (room.id === sourceRoom.id) return false;
    for (let i = 0; i < room.polygon.length; i++) {
      const edge = edgeAt(room, i);
      if (areSharedEdges(sourceEdge.a, sourceEdge.b, edge.a, edge.b, snap.point)) {
        return true;
      }
    }
    return false;
  });
  const pairId = sibling ? nanoid(6) : null;

  if (!sibling) {
    return [{ roomId: sourceRoom.id, opening: openingForRoom(null, "a", sourceRoom.id, snap.point) }];
  }

  return [
    {
      roomId: sourceRoom.id,
      opening: openingForRoom(pairId, "a", sourceRoom.id, snap.point, sibling.id),
    },
    {
      roomId: sibling.id,
      opening: openingForRoom(pairId, "b", sibling.id, snap.point, sourceRoom.id),
    },
  ];
};

export const projectPointToRoomEdge = (room: CanonicalRoom, point: Point) => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPoint: Point = room.polygon[0] ?? point;

  for (let i = 0; i < room.polygon.length; i++) {
    const a = room.polygon[i]!;
    const b = room.polygon[(i + 1) % room.polygon.length]!;
    const nearest = nearestPointOnSegment(point, a, b);
    const edgeDistance = distance(point, nearest);
    if (edgeDistance < bestDistance) {
      bestDistance = edgeDistance;
      bestIndex = i;
      bestPoint = nearest;
    }
  }

  return { ...edgeAt(room, bestIndex), edgeIndex: bestIndex, point: bestPoint };
};

export const findOpeningEdge = (room: CanonicalRoom, point: Point) => {
  const projection = projectPointToRoomEdge(room, point);
  return { a: projection.a, b: projection.b, edgeIndex: projection.edgeIndex };
};

export const pointOnRoomEdge = (room: CanonicalRoom, point: Point) => {
  for (let i = 0; i < room.polygon.length; i++) {
    const { a, b } = edgeAt(room, i);
    if (pointOnSegment(point, a, b)) return true;
  }
  return false;
};

export const findSharedWallRoom = (
  rooms: CanonicalRoom[],
  sourceRoomId: string,
  point: Point,
): string | null => {
  const sourceRoom = rooms.find((room) => room.id === sourceRoomId);
  if (!sourceRoom) return null;

  const sourceEdge = projectPointToRoomEdge(sourceRoom, point);
  for (const room of rooms) {
    if (room.id === sourceRoomId) continue;
    for (let i = 0; i < room.polygon.length; i++) {
      const edge = edgeAt(room, i);
      if (areSharedEdges(sourceEdge.a, sourceEdge.b, edge.a, edge.b, sourceEdge.point)) {
        return room.id;
      }
    }
  }
  return null;
};

export const createLinkedSiblingOpening = (
  opening: CanonicalOpening,
  roomId: string,
  connectsTo: string,
): CanonicalOpening => ({
  id: `opening-${roomId}-${nanoid(5)}`,
  point: [opening.point[0], opening.point[1]],
  width: opening.width,
  kind: opening.kind,
  traversable: opening.traversable,
  connectsTo,
});

export const openingSegmentForRoom = (room: CanonicalRoom, opening: CanonicalOpening) => {
  const { a, b } = findOpeningEdge(room, opening.point);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const halfWidth = opening.width / 2;

  return {
    a: [opening.point[0] - ux * halfWidth, opening.point[1] - uy * halfWidth] as Point,
    b: [opening.point[0] + ux * halfWidth, opening.point[1] + uy * halfWidth] as Point,
  };
};

export const findLinkedOpening = (
  rooms: CanonicalRoom[],
  roomId: string,
  openingId: string,
): { roomId: string; openingId: string } | null => {
  const room = rooms.find((entry) => entry.id === roomId);
  const opening = room?.openings?.find((entry) => entry.id === openingId);
  if (!room || !opening?.connectsTo) return null;

  const linkedRoom = rooms.find((entry) => entry.id === opening.connectsTo);
  if (!linkedRoom) return null;

  const pairId = pairIdFromOpeningId(opening.id);
  const candidates = (linkedRoom.openings ?? []).filter((entry) => entry.connectsTo === roomId);
  if (pairId) {
    const exact = candidates.find((entry) => pairIdFromOpeningId(entry.id) === pairId);
    if (exact) {
      return { roomId: linkedRoom.id, openingId: exact.id };
    }
  }

  let best: CanonicalOpening | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateDistance = distance(candidate.point, opening.point);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      best = candidate;
    }
  }

  return best ? { roomId: linkedRoom.id, openingId: best.id } : null;
};

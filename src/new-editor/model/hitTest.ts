import type { CanonicalRoom } from "../../lib/types";
import type { Point } from "./geometry";
import { distance, nearestPointOnSegment } from "./geometry";
import { openingSegmentForRoom } from "./openings";

export type HitTarget =
  | { kind: "opening"; roomId: string; openingId: string; point: Point }
  | { kind: "vertex"; roomId: string; vertexIndex: number; point: Point }
  | { kind: "edge"; roomId: string; edgeIndex: number; point: Point }
  | { kind: "room"; roomId: string };

interface HitTestOptions {
  preferredRoomId?: string | null;
  zoom?: number;
}

const isPointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0];
    const yi = polygon[i]![1];
    const xj = polygon[j]![0];
    const yj = polygon[j]![1];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const hitTestRooms = (
  point: Point,
  rooms: CanonicalRoom[],
  options: HitTestOptions = {},
): HitTarget | null => {
  const zoom = Math.max(options.zoom ?? 1, 1);
  const openingCenterThreshold = 14 / zoom;
  const openingSegmentThreshold = 12 / zoom;
  const vertexThreshold = 12 / zoom;
  const edgeThreshold = 10 / zoom;
  let bestOpening: HitTarget | null = null;
  let bestOpeningScore = Number.POSITIVE_INFINITY;

  for (const room of rooms) {
    for (const opening of room.openings ?? []) {
      const segment = openingSegmentForRoom(room, opening);
      const nearest = nearestPointOnSegment(point, segment.a, segment.b);
      const segmentDistance = distance(point, nearest);
      const centerDistance = distance(point, opening.point);
      if (segmentDistance <= openingSegmentThreshold || centerDistance <= openingCenterThreshold) {
        const preferredBias = room.id === options.preferredRoomId ? -openingSegmentThreshold * 0.4 : 0;
        const score = Math.min(segmentDistance, centerDistance * 0.8) + preferredBias;
        if (score < bestOpeningScore) {
          bestOpeningScore = score;
          bestOpening = { kind: "opening", roomId: room.id, openingId: opening.id, point: opening.point };
        }
      }
    }
  }

  if (bestOpening) {
    return bestOpening;
  }

  for (const room of rooms) {
    for (let i = 0; i < room.polygon.length; i++) {
      const vertex = room.polygon[i]!;
      if (distance(point, vertex) < vertexThreshold) {
        return { kind: "vertex", roomId: room.id, vertexIndex: i, point: vertex };
      }
    }

    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i]!;
      const b = room.polygon[(i + 1) % room.polygon.length]!;
      const nearest = nearestPointOnSegment(point, a, b);
      if (distance(point, nearest) < edgeThreshold) {
        return { kind: "edge", roomId: room.id, edgeIndex: i, point: nearest };
      }
    }

    if (isPointInPolygon(point, room.polygon)) {
      return { kind: "room", roomId: room.id };
    }
  }

  return null;
};

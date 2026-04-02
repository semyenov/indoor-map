import type { CanonicalRoom } from "../../lib/types";
import type { EditorGuide } from "./commands";
import type { Point } from "./geometry";
import { distance, lineIntersection, nearestPointOnLine, nearestPointOnSegment } from "./geometry";

export type HoverSnapKind =
  | "vertex"
  | "edge"
  | "guide"
  | "guide-endpoint"
  | "guide-intersection"
  | "guide-wall-intersection";

interface RoomHoverSnap {
  kind: "vertex" | "edge";
  point: Point;
  roomId: string;
  index: number;
}

interface GuideHoverSnap {
  kind: "guide";
  point: Point;
  guideId: string;
}

interface GuideEndpointHoverSnap {
  kind: "guide-endpoint";
  point: Point;
  guideId: string;
  endpoint: "a" | "b";
}

interface GuideIntersectionHoverSnap {
  kind: "guide-intersection";
  point: Point;
  guideIds: [string, string];
}

interface GuideWallIntersectionHoverSnap {
  kind: "guide-wall-intersection";
  point: Point;
  guideId: string;
  roomId: string;
  index: number;
}

export type HoverSnap =
  | RoomHoverSnap
  | GuideHoverSnap
  | GuideEndpointHoverSnap
  | GuideIntersectionHoverSnap
  | GuideWallIntersectionHoverSnap;

interface SnapOptions {
  includeGuides?: boolean;
  includeGuideIntersections?: boolean;
  includeGuideWallIntersections?: boolean;
}

const pointOnSegment = (point: Point, a: Point, b: Point) => {
  const minX = Math.min(a[0], b[0]) - 1e-6;
  const maxX = Math.max(a[0], b[0]) + 1e-6;
  const minY = Math.min(a[1], b[1]) - 1e-6;
  const maxY = Math.max(a[1], b[1]) + 1e-6;
  return point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY;
};

export const findHoverSnap = (
  point: Point,
  rooms: CanonicalRoom[],
  guides: EditorGuide[],
  threshold: number,
  options: SnapOptions = {},
): HoverSnap | null => {
  const includeGuides = options.includeGuides ?? true;
  const includeGuideEndpoints = options.includeGuides ?? true;
  const includeGuideIntersections = options.includeGuideIntersections ?? true;
  const includeGuideWallIntersections = options.includeGuideWallIntersections ?? true;
  const vertexThreshold = threshold * 1.35;
  const guideIntersectionThreshold = threshold * 1.35;
  const guideWallIntersectionThreshold = threshold * 1.35;
  const guideThreshold = threshold;
  const edgeThreshold = threshold * 0.8;
  let bestVertex: RoomHoverSnap | GuideEndpointHoverSnap | null = null;
  let bestVertexDistance = vertexThreshold;

  for (const room of rooms) {
    for (let i = 0; i < room.polygon.length; i++) {
      const vertex = room.polygon[i]!;
      const vertexDistance = distance(point, vertex);
      if (vertexDistance < bestVertexDistance) {
        bestVertexDistance = vertexDistance;
        bestVertex = { kind: "vertex", point: vertex, roomId: room.id, index: i };
      }
    }
  }

  if (includeGuideEndpoints) {
    for (const guide of guides) {
      const endpoints: Array<{ point: Point; endpoint: "a" | "b" }> = [
        { point: guide.a, endpoint: "a" },
        { point: guide.b, endpoint: "b" },
      ];
      for (const endpoint of endpoints) {
        const endpointDistance = distance(point, endpoint.point);
        if (endpointDistance < bestVertexDistance) {
          bestVertexDistance = endpointDistance;
          bestVertex = {
            kind: "guide-endpoint",
            point: endpoint.point,
            guideId: guide.id,
            endpoint: endpoint.endpoint,
          };
        }
      }
    }
  }

  if (bestVertex) {
    return bestVertex;
  }

  let bestGuideIntersection: GuideIntersectionHoverSnap | null = null;
  let bestGuideIntersectionDistance = guideIntersectionThreshold;

  if (includeGuideIntersections) {
    for (let i = 0; i < guides.length; i++) {
      const leftGuide = guides[i]!;
      for (let j = i + 1; j < guides.length; j++) {
        const rightGuide = guides[j]!;
        const intersection = lineIntersection(leftGuide.a, leftGuide.b, rightGuide.a, rightGuide.b);
        if (!intersection) continue;
        const intersectionDistance = distance(point, intersection);
        if (intersectionDistance < bestGuideIntersectionDistance) {
          bestGuideIntersectionDistance = intersectionDistance;
          bestGuideIntersection = {
            kind: "guide-intersection",
            point: intersection,
            guideIds: [leftGuide.id, rightGuide.id],
          };
        }
      }
    }
  }

  if (bestGuideIntersection) {
    return bestGuideIntersection;
  }

  let bestGuideWallIntersection: GuideWallIntersectionHoverSnap | null = null;
  let bestGuideWallIntersectionDistance = guideWallIntersectionThreshold;

  if (includeGuideWallIntersections) {
    for (const guide of guides) {
      for (const room of rooms) {
        for (let i = 0; i < room.polygon.length; i++) {
          const a = room.polygon[i]!;
          const b = room.polygon[(i + 1) % room.polygon.length]!;
          const intersection = lineIntersection(guide.a, guide.b, a, b);
          if (!intersection || !pointOnSegment(intersection, a, b)) continue;
          const intersectionDistance = distance(point, intersection);
          if (intersectionDistance < bestGuideWallIntersectionDistance) {
            bestGuideWallIntersectionDistance = intersectionDistance;
            bestGuideWallIntersection = {
              kind: "guide-wall-intersection",
              point: intersection,
              guideId: guide.id,
              roomId: room.id,
              index: i,
            };
          }
        }
      }
    }
  }

  if (bestGuideWallIntersection) {
    return bestGuideWallIntersection;
  }

  let bestGuide: GuideHoverSnap | null = null;
  let bestGuideDistance = guideThreshold;

  if (includeGuides) {
    for (const guide of guides) {
      const guidePoint = nearestPointOnLine(point, guide.a, guide.b);
      const guideDistance = distance(point, guidePoint);
      if (guideDistance < bestGuideDistance) {
        bestGuideDistance = guideDistance;
        bestGuide = {
          kind: "guide",
          point: guidePoint,
          guideId: guide.id,
        };
      }
    }
  }

  if (bestGuide) {
    return bestGuide;
  }

  let bestEdge: RoomHoverSnap | null = null;
  let bestEdgeDistance = edgeThreshold;

  for (const room of rooms) {
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i]!;
      const b = room.polygon[(i + 1) % room.polygon.length]!;
      const edgePoint = nearestPointOnSegment(point, a, b);
      const edgeDistance = distance(point, edgePoint);
      if (edgeDistance < bestEdgeDistance) {
        bestEdgeDistance = edgeDistance;
        bestEdge = { kind: "edge", point: edgePoint, roomId: room.id, index: i };
      }
    }
  }

  return bestEdge;
};

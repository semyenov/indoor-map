import type {
  CanonicalIndoorDataset,
  CanonicalLevelMeta,
  CanonicalOpening,
  CanonicalPoi,
  CanonicalRoom,
  CanonicalStructure,
  Coordinate,
  FeatureKind,
  IndoorRuntimeDataset,
  LevelId,
  LevelMeta,
  LocalRectBounds,
  OfficeFeature,
  OfficeFeatureCollection,
  OfficeFeatureProperties,
  OfficeLineFeature,
  OfficePointFeature,
  OfficePolygonFeature,
  RouteTarget,
  RoutingEdge,
  RoutingGraph,
  SearchEntry,
} from "./types";

interface WallBoxOptions {
  north?: boolean;
  south?: boolean;
  west?: boolean;
  east?: boolean;
  northOpenings?: Array<{ center: number; width: number }>;
  southOpenings?: Array<{ center: number; width: number }>;
  westOpenings?: Array<{ center: number; width: number }>;
  eastOpenings?: Array<{ center: number; width: number }>;
}

interface RoomAssembly {
  room: OfficePolygonFeature;
  walls: OfficePolygonFeature[];
  doors: OfficeLineFeature[];
  showLabel: boolean;
}

interface DerivedPortalNode {
  id: string;
  roomId: string;
  level: LevelId;
  point: Coordinate;
}

interface DerivedPortalConnection {
  id: string;
  fromPortalId: string;
  toPortalId: string;
  boundaryPoint: Coordinate;
}

// --- Polygon geometry helpers (module-level, no closure dependency) ---

const polygonBounds = (pts: [number, number][]): LocalRectBounds => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x1) x1 = x; if (x > x2) x2 = x;
    if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return [x1, y1, x2, y2];
};

const localRoomCenter = (bounds: LocalRectBounds): Coordinate => [
  (bounds[0] + bounds[2]) / 2,
  (bounds[1] + bounds[3]) / 2,
];

/** Area-weighted polygon centroid (more robust than vertex average for concave shapes). */
const polygonCentroid = (pts: [number, number][]): [number, number] => {
  let area = 0, cx = 0, cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % n]!;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-10) return pts[0]!;
  return [cx / (6 * area), cy / (6 * area)];
};

const pointToSegmentDistance = (point: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  const px = a[0] + dx * t;
  const py = a[1] + dy * t;
  return Math.hypot(point[0] - px, point[1] - py);
};

const polygonClearance = (point: [number, number], pts: [number, number][]) => {
  if (!pointInPolygon(point[0], point[1], pts)) {
    return -1;
  }

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pts.length; index += 1) {
    const a = pts[index]!;
    const b = pts[(index + 1) % pts.length]!;
    best = Math.min(best, pointToSegmentDistance(point, a, b));
  }
  return best;
};

/**
 * Returns an interior point that maximizes clearance from walls.
 * This is more stable than centroid/bbox-center for narrow or concave rooms.
 */
const safePolygonCenter = (pts: [number, number][]): [number, number] => {
  const [x1, y1, x2, y2] = polygonBounds(pts);
  const centroid = polygonCentroid(pts);
  const bboxCenter: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
  let bestPoint = pointInPolygon(centroid[0], centroid[1], pts) ? centroid : pts[0]!;
  let bestClearance = polygonClearance(bestPoint, pts);

  const tryCandidate = (candidate: [number, number]) => {
    const clearance = polygonClearance(candidate, pts);
    if (clearance > bestClearance) {
      bestPoint = candidate;
      bestClearance = clearance;
    }
  };

  tryCandidate(bboxCenter);
  for (const vertex of pts) {
    tryCandidate(vertex);
  }

  const initialStep = Math.max(x2 - x1, y2 - y1) / 6;
  if (initialStep < 1e-6) {
    return bestPoint;
  }

  let step = initialStep;
  while (step > 0.02) {
    const origin: [number, number] = bestClearance >= 0 ? bestPoint : bboxCenter;
    for (let ix = -3; ix <= 3; ix += 1) {
      for (let iy = -3; iy <= 3; iy += 1) {
        tryCandidate([origin[0] + ix * step, origin[1] + iy * step]);
      }
    }
    step *= 0.5;
  }

  return bestPoint;
};


const polygonSignedArea = (pts: [number, number][]): number => {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i]!;
    const p1 = pts[(i + 1) % n]!;
    a += p0[0] * p1[1] - p1[0] * p0[1];
  }
  return a / 2;
};

const pointInPolygon = (px: number, py: number, pts: [number, number][]): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i]!, pj = pts[j]!;
    const xi = pi[0], yi = pi[1], xj = pj[0], yj = pj[1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};

// ---

const PORTAL_INSET = 0.45;
const ROUTE_WALL_CLEARANCE = 0.8;
const ROUTE_EPSILON = 0.000001;

const roomAnchorNodeId = (roomId: string) => `node-room-${roomId}`;
const poiNodeId = (featureId: string) => `node-poi-${featureId}`;
const autoPortalNodeId = (roomId: string, openingId: string) => `node-portal-${roomId}-${openingId}`;
const derivedTargetId = (featureId: string) => `target-${featureId}`;


const coordinateKey = (coordinate: Coordinate) => `${coordinate[0].toFixed(9)}:${coordinate[1].toFixed(9)}`;

const coordinateDistance = (left: Coordinate, right: Coordinate) =>
  Math.hypot(right[0] - left[0], right[1] - left[1]);

const coordinatePathLength = (coordinates: Coordinate[]) =>
  coordinates.slice(1).reduce((total, coordinate, index) => {
    const previous = coordinates[index];
    if (!previous) return total;
    return total + Math.hypot(coordinate[0] - previous[0], coordinate[1] - previous[1]);
  }, 0);

const coordinatesEqual = (left: Coordinate, right: Coordinate) => left[0] === right[0] && left[1] === right[1];

const appendCoordinate = (target: Coordinate[], coordinate: Coordinate) => {
  const lastCoordinate = target.at(-1);

  if (lastCoordinate && coordinatesEqual(lastCoordinate, coordinate)) {
    return;
  }

  target.push(coordinate);
};

const appendCoordinates = (target: Coordinate[], coordinates: Coordinate[]) => {
  for (const coordinate of coordinates) {
    appendCoordinate(target, coordinate);
  }
};

const vectorDot = (left: Coordinate, right: Coordinate) => left[0] * right[0] + left[1] * right[1];

const vectorSub = (left: Coordinate, right: Coordinate): Coordinate => [left[0] - right[0], left[1] - right[1]];

const pointOnSegment = (point: Coordinate, a: Coordinate, b: Coordinate, tolerance = 0.08) => {
  const ap = vectorSub(point, a);
  const ab = vectorSub(b, a);
  const abLengthSquared = vectorDot(ab, ab);
  if (abLengthSquared < 1e-9) return false;
  const cross = Math.abs(ap[0] * ab[1] - ap[1] * ab[0]);
  if (cross > tolerance) return false;
  const t = vectorDot(ap, ab) / abLengthSquared;
  return t >= -tolerance && t <= 1 + tolerance;
};

const normalizeVector = (vector: Coordinate): Coordinate => {
  const length = Math.hypot(vector[0], vector[1]);
  if (length < 1e-9) {
    return [1, 0];
  }
  return [vector[0] / length, vector[1] / length];
};

const axisProjection = (point: Coordinate, axis: Coordinate) => point[0] * axis[0] + point[1] * axis[1];

const roomHasDiagonalEdge = (room: CanonicalRoom) =>
  room.polygon.some((point, index) => {
    const nextPoint = room.polygon[(index + 1) % room.polygon.length];
    if (!nextPoint) return false;
    return Math.abs(point[0] - nextPoint[0]) > 1e-6 && Math.abs(point[1] - nextPoint[1]) > 1e-6;
  });

const nearestPointOnSegment = (point: Coordinate, a: Coordinate, b: Coordinate): Coordinate => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return a;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return [a[0] + dx * t, a[1] + dy * t];
};

const lineIntersection = (
  a1: Coordinate,
  a2: Coordinate,
  b1: Coordinate,
  b2: Coordinate,
): Coordinate | null => {
  const ax = a2[0] - a1[0];
  const ay = a2[1] - a1[1];
  const bx = b2[0] - b1[0];
  const by = b2[1] - b1[1];
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-9) return null;
  const cx = b1[0] - a1[0];
  const cy = b1[1] - a1[1];
  const t = (cx * by - cy * bx) / det;
  return [a1[0] + ax * t, a1[1] + ay * t];
};

const projectPointToRoomEdge = (room: CanonicalRoom, point: Coordinate) => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPoint: Coordinate = room.polygon[0] ?? point;

  for (let i = 0; i < room.polygon.length; i += 1) {
    const a = room.polygon[i]!;
    const b = room.polygon[(i + 1) % room.polygon.length]!;
    const projected = nearestPointOnSegment(point, a, b);
    const distance = Math.hypot(point[0] - projected[0], point[1] - projected[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestPoint = projected;
    }
  }

  return {
    a: room.polygon[bestIndex]!,
    b: room.polygon[(bestIndex + 1) % room.polygon.length]!,
    point: bestPoint,
  };
};

const edgesShareBoundaryAtPoint = (
  a0: Coordinate,
  a1: Coordinate,
  b0: Coordinate,
  b1: Coordinate,
  point: Coordinate,
  tolerance = 0.08,
) => {
  const av = vectorSub(a1, a0);
  const bv = vectorSub(b1, b0);
  const cross = Math.abs(av[0] * bv[1] - av[1] * bv[0]);
  if (cross > tolerance) return false;
  return pointOnSegment(point, a0, a1, tolerance) && pointOnSegment(point, b0, b1, tolerance);
};

const roomsShareOpeningBoundary = (sourceRoom: CanonicalRoom, targetRoom: CanonicalRoom, openingPoint: Coordinate) => {
  const sourceEdge = projectPointToRoomEdge(sourceRoom, openingPoint);
  for (let i = 0; i < targetRoom.polygon.length; i += 1) {
    const a = targetRoom.polygon[i]!;
    const b = targetRoom.polygon[(i + 1) % targetRoom.polygon.length]!;
    if (edgesShareBoundaryAtPoint(sourceEdge.a, sourceEdge.b, a, b, sourceEdge.point)) {
      return true;
    }
  }
  return false;
};

const findConnectingRoomId = (
  roomId: string,
  level: string,
  openingPoint: [number, number],
  rooms: CanonicalRoom[],
): string | undefined => {
  const sourceRoom = rooms.find((room) => room.id === roomId && room.level === level);
  if (!sourceRoom) return undefined;
  for (const other of rooms) {
    if (other.id === roomId || other.level !== level) continue;
    if (roomsShareOpeningBoundary(sourceRoom, other, openingPoint)) return other.id;
  }
  return undefined;
};

export const deriveIndoorRuntimeDataset = (_source: CanonicalIndoorDataset): IndoorRuntimeDataset => {
  // Enrich openings with auto-resolved connectsTo so all downstream code works without manual data entries
  const source: CanonicalIndoorDataset = {
    ..._source,
    rooms: _source.rooms.map((room) => ({
      ...room,
      openings: (room.openings ?? []).map((o) => ({
        ...o,
        connectsTo: o.connectsTo ?? findConnectingRoomId(room.id, room.level, o.point, _source.rooms),
      })),
    })),
  };
  const point = (x: number, y: number): Coordinate => [
    source.grid.origin[0] + x * source.grid.xStep,
    source.grid.origin[1] + y * source.grid.yStep,
  ];

  const ring = (x1: number, y1: number, x2: number, y2: number): Coordinate[] => [
    point(x1, y1),
    point(x2, y1),
    point(x2, y2),
    point(x1, y2),
    point(x1, y1),
  ];

  const path = (coordinates: Coordinate[]) => coordinates.map(([x, y]) => point(x, y));

  const levelById = new Map(source.levels.map((level) => [level.id, level]));
  const roomById = new Map(source.rooms.map((room) => [room.id, room]));
  const safeName = (value: string | undefined, fallback: string) => {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : fallback;
  };
  const normalizedSearchTokens = (...tokens: Array<string | undefined>) =>
    [...new Set(tokens.filter((token): token is string => Boolean(token && token.trim())).map((token) => token.toLowerCase()))];

  const polygon = (
    id: string,
    level: LevelId,
    kind: OfficeFeatureProperties["kind"],
    name: string | undefined,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "number" | "focusPoint" | "searchTokens"> & {
      focusPoint?: Coordinate;
      searchTokens?: string[];
    } = {},
  ): OfficePolygonFeature => {
    const displayName = name?.trim() ?? "";
    const resolvedName = safeName(name, id);
    return {
      id,
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [ring(x1, y1, x2, y2)],
      },
      properties: {
        featureId: id,
        level,
        kind,
        name: displayName,
        focusPoint: properties.focusPoint ?? point((x1 + x2) / 2, (y1 + y2) / 2),
        searchTokens: properties.searchTokens ?? normalizedSearchTokens(resolvedName),
        subtitle: properties.subtitle,
        department: properties.department,
        employee: properties.employee,
        capacity: properties.capacity,
        equipment: properties.equipment,
        status: properties.status,
        routeNodeId: properties.routeNodeId,
        baseHeight: properties.baseHeight,
        height: properties.height,
      },
    };
  };

  const arbitraryPolygonFeature = (
    id: string,
    level: LevelId,
    kind: OfficeFeatureProperties["kind"],
    name: string | undefined,
    localPts: [number, number][],
    properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> & {
      focusPoint?: Coordinate;
      searchTokens?: string[];
    } = {},
  ): OfficePolygonFeature => {
    const coords = localPts.map(([x, y]) => point(x, y));
    const first = coords[0], last = coords[coords.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      coords.push(first);
    }
    const center = safePolygonCenter(localPts);
    const displayName = name?.trim() ?? "";
    const resolvedName = safeName(name, id);
    return {
      id,
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
      properties: {
        featureId: id,
        level,
        kind,
        name: displayName,
        number: properties.number,
        focusPoint: properties.focusPoint ?? point(center[0], center[1]),
        searchTokens: properties.searchTokens ?? normalizedSearchTokens(resolvedName),
        subtitle: properties.subtitle,
        department: properties.department,
        employee: properties.employee,
        capacity: properties.capacity,
        equipment: properties.equipment,
        status: properties.status,
        routeNodeId: properties.routeNodeId,
        baseHeight: properties.baseHeight,
        height: properties.height,
      },
    };
  };

  const marker = (
    poi: CanonicalPoi,
    properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> = {},
  ): OfficePointFeature => {
    const displayName = poi.name?.trim() ?? "";
    const resolvedName = safeName(poi.name, poi.id);
    return {
      id: poi.id,
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: point(poi.point[0], poi.point[1]),
      },
      properties: {
        featureId: poi.id,
        level: poi.level,
        kind: poi.kind,
        name: displayName,
        focusPoint: point(poi.point[0], poi.point[1]),
        searchTokens: poi.searchTokens?.length ? poi.searchTokens : normalizedSearchTokens(resolvedName, poi.subtitle, poi.department, poi.employee),
        subtitle: poi.subtitle,
        department: poi.department,
        employee: poi.employee,
        status: properties.status,
        routeNodeId: properties.routeNodeId,
        baseHeight: properties.baseHeight,
        height: properties.height,
        equipment: properties.equipment,
        capacity: properties.capacity,
      },
    };
  };

  const lineFeature = (
    id: string,
    level: LevelId,
    kind: OfficeFeatureProperties["kind"],
    name: string | undefined,
    coordinates: Coordinate[],
    properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> & {
      focusPoint?: Coordinate;
      searchTokens?: string[];
    } = {},
  ): OfficeLineFeature => {
    const displayName = name?.trim() ?? "";
    const resolvedName = safeName(name, id);
    return {
      id,
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: path(coordinates),
      },
      properties: {
        featureId: id,
        level,
        kind,
        name: displayName,
        number: properties.number,
        focusPoint: properties.focusPoint ?? point(coordinates[0]?.[0] ?? 0, coordinates[0]?.[1] ?? 0),
        searchTokens: properties.searchTokens ?? normalizedSearchTokens(resolvedName),
        subtitle: properties.subtitle,
        department: properties.department,
        employee: properties.employee,
        capacity: properties.capacity,
        equipment: properties.equipment,
        status: properties.status,
        routeNodeId: properties.routeNodeId,
        baseHeight: properties.baseHeight,
        height: properties.height,
      },
    };
  };

  const labelPoint = (feature: OfficeFeature): OfficePointFeature => ({
    id: feature.id,
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: feature.properties.focusPoint,
    },
    properties: feature.properties,
  });

  const wallBox = (
    idPrefix: string,
    level: LevelId,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness = 0.35,
    height = 3.1,
    options: WallBoxOptions = {},
  ): OfficePolygonFeature[] => {
    const walls: OfficePolygonFeature[] = [];
    const {
      north = true,
      south = true,
      west = true,
      east = true,
      northOpenings = [],
      southOpenings = [],
      westOpenings = [],
      eastOpenings = [],
    } = options;

    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const orderedOpenings = (openings: Array<{ center: number; width: number }>) =>
      [...openings].sort((left, right) => left.center - right.center);

    const horizontalWall = (
      side: "north" | "south",
      fromX: number,
      toX: number,
      yStart: number,
      yEnd: number,
      openings: Array<{ center: number; width: number }>,
    ) => {
      if (openings.length === 0) {
        walls.push(polygon(`${idPrefix}-${side}`, level, "wall", `${idPrefix} ${side} Wall`, fromX, yStart, toX, yEnd, { baseHeight: 0, height }));
        return;
      }

      let cursor = fromX;

      for (const [index, opening] of orderedOpenings(openings).entries()) {
        const halfWidth = opening.width / 2;
        const gapStart = clamp(opening.center - halfWidth, fromX + thickness, toX - thickness);
        const gapEnd = clamp(opening.center + halfWidth, fromX + thickness, toX - thickness);

        if (gapStart > cursor) {
          walls.push(
            polygon(`${idPrefix}-${side}-${index + 1}`, level, "wall", `${idPrefix} ${side} Wall ${index + 1}`, cursor, yStart, gapStart, yEnd, {
              baseHeight: 0,
              height,
            }),
          );
        }

        cursor = Math.max(cursor, gapEnd);
      }

      if (cursor < toX) {
        walls.push(
          polygon(`${idPrefix}-${side}-tail`, level, "wall", `${idPrefix} ${side} Wall Tail`, cursor, yStart, toX, yEnd, {
            baseHeight: 0,
            height,
          }),
        );
      }
    };

    const verticalWall = (
      side: "west" | "east",
      xStart: number,
      xEnd: number,
      fromY: number,
      toY: number,
      openings: Array<{ center: number; width: number }>,
    ) => {
      if (openings.length === 0) {
        walls.push(polygon(`${idPrefix}-${side}`, level, "wall", `${idPrefix} ${side} Wall`, xStart, fromY, xEnd, toY, { baseHeight: 0, height }));
        return;
      }

      let cursor = fromY;

      for (const [index, opening] of orderedOpenings(openings).entries()) {
        const halfWidth = opening.width / 2;
        const gapStart = clamp(opening.center - halfWidth, fromY + thickness, toY - thickness);
        const gapEnd = clamp(opening.center + halfWidth, fromY + thickness, toY - thickness);

        if (gapStart > cursor) {
          walls.push(
            polygon(`${idPrefix}-${side}-${index + 1}`, level, "wall", `${idPrefix} ${side} Wall ${index + 1}`, xStart, cursor, xEnd, gapStart, {
              baseHeight: 0,
              height,
            }),
          );
        }

        cursor = Math.max(cursor, gapEnd);
      }

      if (cursor < toY) {
        walls.push(
          polygon(`${idPrefix}-${side}-tail`, level, "wall", `${idPrefix} ${side} Wall Tail`, xStart, cursor, xEnd, toY, {
            baseHeight: 0,
            height,
          }),
        );
      }
    };

    if (north) {
      horizontalWall("north", x1, x2, y2 - thickness, y2, northOpenings);
    }

    if (south) {
      horizontalWall("south", x1, x2, y1, y1 + thickness, southOpenings);
    }

    if (west) {
      verticalWall("west", x1, x1 + thickness, y1, y2, westOpenings);
    }

    if (east) {
      verticalWall("east", x2 - thickness, x2, y1, y2, eastOpenings);
    }

    return walls;
  };

  const stairRun = (
    idPrefix: string,
    level: LevelId,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stepCount: number,
    rise = 0.32,
    treadThickness = 0.08,
    treadCoverage = 0.44,
  ): OfficePolygonFeature[] => {
    const steps: OfficePolygonFeature[] = [];
    const stepDepth = (y2 - y1) / stepCount;

    for (let index = 0; index < stepCount; index += 1) {
      const stepY1 = y1 + stepDepth * index;
      const stepY2 = stepY1 + stepDepth * treadCoverage;
      const baseHeight = rise * index;
      const inset = index * 0.03;

      steps.push(
        polygon(`${idPrefix}-step-${index + 1}`, level, "furniture", `${idPrefix} Step ${index + 1}`, x1 + inset, stepY1, x2 - inset, stepY2, {
          department: "Вертикальные связи",
          baseHeight,
          height: baseHeight + treadThickness,
        }),
      );
    }

    return steps;
  };

  const openingWallInfo = (
    room: CanonicalRoom,
    pt: [number, number],
  ): { dir: [number, number]; inNormal: [number, number] } => {
    const pts = room.polygon;
    const n = pts.length;
    const ccw = polygonSignedArea(pts) > 0;
    let bestI = 0, bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const p0 = pts[i]!, p1 = pts[(i + 1) % n]!;
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((pt[0] - p0[0]) * dx + (pt[1] - p0[1]) * dy) / len2)) : 0;
      const dist = Math.hypot(pt[0] - (p0[0] + t * dx), pt[1] - (p0[1] + t * dy));
      if (dist < bestDist) { bestDist = dist; bestI = i; }
    }
    const p0 = pts[bestI]!, p1 = pts[(bestI + 1) % n]!;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const dx = (p1[0] - p0[0]) / len, dy = (p1[1] - p0[1]) / len;
    return { dir: [dx, dy], inNormal: ccw ? [-dy, dx] : [dy, -dx] };
  };

  const openingCoordinates = (room: CanonicalRoom, opening: CanonicalOpening): Coordinate[] => {
    const [px, py] = opening.point;
    const { dir } = openingWallInfo(room, opening.point);
    const hw = opening.width / 2;
    return [[px - dir[0] * hw, py - dir[1] * hw], [px + dir[0] * hw, py + dir[1] * hw]];
  };

  const createPolygonRoomAssembly = (spec: CanonicalRoom, allGapOpenings: CanonicalOpening[] = spec.openings ?? []): RoomAssembly => {
    const pts = spec.polygon!;
    const n = pts.length;
    const wallEdgeSet = spec.wallEdges ? new Set(spec.wallEdges) : null;
    const ccw = polygonSignedArea(pts) > 0;
    const WALL_T = 0.22;
    const WALL_H = 3.1;

    const room = arbitraryPolygonFeature(spec.id, spec.level, spec.kind, spec.name, pts, {
      number: spec.number,
      subtitle: spec.subtitle,
      department: spec.department,
      searchTokens: spec.searchTokens,
      focusPoint: spec.focusPoint ? point(spec.focusPoint[0], spec.focusPoint[1]) : undefined,
      capacity: spec.capacity,
      equipment: spec.equipment,
      status: spec.status,
    });

    const GAP_TOL = 0.05;
    const edgeData = pts.map((point, index) => {
      const nextPoint = pts[(index + 1) % n]!;
      const dx = nextPoint[0] - point[0];
      const dy = nextPoint[1] - point[1];
      const len = Math.hypot(dx, dy);
      const ux = len > 1e-9 ? dx / len : 0;
      const uy = len > 1e-9 ? dy / len : 0;
      const nx = ccw ? -uy : uy;
      const ny = ccw ? ux : -ux;
      return {
        start: point,
        end: nextPoint,
        len,
        u: [ux, uy] as Coordinate,
        n: [nx, ny] as Coordinate,
      };
    });

    const offsetCornerPoint = (
      edgeIndex: number,
      atStart: boolean,
      fallback: Coordinate,
    ): Coordinate => {
      const current = edgeData[edgeIndex];
      if (!current || current.len < 1e-9) return fallback;
      const neighborIndex = atStart ? (edgeIndex - 1 + n) % n : (edgeIndex + 1) % n;
      const neighbor = edgeData[neighborIndex];
      if (!neighbor || neighbor.len < 1e-9) return fallback;
      const anchor = atStart ? current.start : current.end;
      const currentOffsetStart: Coordinate = [
        current.start[0] + current.n[0] * WALL_T,
        current.start[1] + current.n[1] * WALL_T,
      ];
      const currentOffsetEnd: Coordinate = [
        current.end[0] + current.n[0] * WALL_T,
        current.end[1] + current.n[1] * WALL_T,
      ];
      const neighborOffsetStart: Coordinate = [
        neighbor.start[0] + neighbor.n[0] * WALL_T,
        neighbor.start[1] + neighbor.n[1] * WALL_T,
      ];
      const neighborOffsetEnd: Coordinate = [
        neighbor.end[0] + neighbor.n[0] * WALL_T,
        neighbor.end[1] + neighbor.n[1] * WALL_T,
      ];
      const intersection = atStart
        ? lineIntersection(neighborOffsetStart, neighborOffsetEnd, currentOffsetStart, currentOffsetEnd)
        : lineIntersection(currentOffsetStart, currentOffsetEnd, neighborOffsetStart, neighborOffsetEnd);
      if (!intersection) return fallback;
      const miterLength = Math.hypot(intersection[0] - anchor[0], intersection[1] - anchor[1]);
      if (!Number.isFinite(miterLength) || miterLength > WALL_T * 4) {
        return fallback;
      }
      return intersection;
    };

    const walls: OfficePolygonFeature[] = [];
    for (let i = 0; i < n; i++) {
      if (wallEdgeSet && !wallEdgeSet.has(i)) continue;
      const j = (i + 1) % n;
      const pi = pts[i]!, pj = pts[j]!;
      const edge = edgeData[i]!;
      const x0 = pi[0], y0 = pi[1], x1 = pj[0], y1 = pj[1];
      const len = edge.len;
      if (len < 1e-9) continue;
      const [ux, uy] = edge.u;
      const [nx, ny] = edge.n;

      // Find openings on this edge and compute gap intervals along [0, len]
      const gaps: [number, number][] = [];
      for (const opening of allGapOpenings) {
        const [opx, opy] = opening.point;
        const t = (opx - x0) * ux + (opy - y0) * uy;
        const projX = x0 + t * ux, projY = y0 + t * uy;
        const dist = Math.hypot(opx - projX, opy - projY);
        if (dist < GAP_TOL && t >= -0.01 && t <= len + 0.01) {
          const hw = opening.width / 2;
          gaps.push([Math.max(0, t - hw), Math.min(len, t + hw)]);
        }
      }

      // Sort and merge overlapping gaps
      gaps.sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const g of gaps) {
        const last = merged[merged.length - 1];
        if (last && g[0] <= last[1]) {
          last[1] = Math.max(last[1], g[1]);
        } else {
          merged.push([g[0], g[1]]);
        }
      }

      const wallStrip = (tStart: number, tEnd: number, seg: number): OfficePolygonFeature => {
        const ax = x0 + tStart * ux, ay = y0 + tStart * uy;
        const bx = x0 + tEnd * ux, by = y0 + tEnd * uy;
        const baseInnerStart: Coordinate = [ax + nx * WALL_T, ay + ny * WALL_T];
        const baseInnerEnd: Coordinate = [bx + nx * WALL_T, by + ny * WALL_T];
        const innerStart = tStart <= 0.001 ? offsetCornerPoint(i, true, baseInnerStart) : baseInnerStart;
        const innerEnd = tEnd >= len - 0.001 ? offsetCornerPoint(i, false, baseInnerEnd) : baseInnerEnd;
        const strip: [number, number][] = [
          [ax, ay], [bx, by],
          innerEnd,
          innerStart,
        ];
        return arbitraryPolygonFeature(
          `wall-${spec.id}-edge-${i}-seg-${seg}`, spec.level, "wall", `${spec.name} Wall ${i}`,
          strip, { baseHeight: 0, height: WALL_H },
        );
      };

      if (merged.length === 0) {
        walls.push(wallStrip(0, len, 0));
      } else {
        let seg = 0;
        let prev = 0;
        for (const [gStart, gEnd] of merged) {
          if (gStart > prev + 0.001) walls.push(wallStrip(prev, gStart, seg++));
          prev = gEnd;
        }
        if (prev < len - 0.001) walls.push(wallStrip(prev, len, seg));
      }
    }

    const doors = (spec.openings ?? [])
      .filter((o) => o.kind === "door")
      .map((o) => lineFeature(`door-${spec.id}-${o.id}`, spec.level, "door", `${spec.name} Door`, openingCoordinates(spec, o)));

    return { room, walls, doors, showLabel: spec.showLabel ?? true };
  };


  const buildStructureFeatures = (): { structures: OfficePolygonFeature[]; extraDoors: OfficeLineFeature[] } => {
    const structures: OfficePolygonFeature[] = [];
    const extraDoors: OfficeLineFeature[] = [];

    for (const structure of source.structures) {
      switch (structure.geometry.type) {
        case "rect": {
          const [x1, y1, x2, y2] = structure.geometry.bounds;
          structures.push(
            polygon(structure.id, structure.level, structure.featureKind, structure.name, x1, y1, x2, y2, {
              department: structure.department,
              baseHeight: structure.baseHeight,
              height: "height" in structure ? structure.height : undefined,
              searchTokens: structure.searchTokens,
            }),
          );
          break;
        }
        case "wall_box": {
          const [x1, y1, x2, y2] = structure.geometry.bounds;
          structures.push(
            ...wallBox(
              structure.id,
              structure.level,
              x1,
              y1,
              x2,
              y2,
              structure.geometry.thickness,
              structure.geometry.height,
              structure.geometry.options,
            ),
          );
          break;
        }
        case "stair_run": {
          const [x1, y1, x2, y2] = structure.geometry.bounds;
          structures.push(
            ...stairRun(
              structure.id,
              structure.level,
              x1,
              y1,
              x2,
              y2,
              structure.geometry.stepCount,
              structure.geometry.rise,
              structure.geometry.treadThickness,
              structure.geometry.treadCoverage,
            ),
          );
          break;
        }
        case "line":
          extraDoors.push(
            lineFeature(structure.id, structure.level, structure.featureKind, structure.name, structure.geometry.coordinates, {
              department: structure.department,
              searchTokens: structure.searchTokens,
            }),
          );
          break;
      }
    }

    return { structures, extraDoors };
  };

  const levels: LevelMeta[] = source.levels.map((level: CanonicalLevelMeta) => ({
    id: level.id,
    label: level.label,
    order: level.order,
    defaultCenter: point(level.defaultCenter[0], level.defaultCenter[1]),
    defaultZoom: level.defaultZoom,
  }));

  // Build a map of openings that connect TO each room, so the target room can cut its wall too
  const inboundOpenings = new Map<string, CanonicalOpening[]>();
  for (const room of source.rooms) {
    for (const opening of room.openings ?? []) {
      if (opening.connectsTo) {
        const list = inboundOpenings.get(opening.connectsTo) ?? [];
        list.push(opening);
        inboundOpenings.set(opening.connectsTo, list);
      }
    }
  }

  const roomAssemblies = source.rooms.map((room) =>
    createPolygonRoomAssembly(room, [...(room.openings ?? []), ...(inboundOpenings.get(room.id) ?? [])]),
  );
  const roomFeatures = roomAssemblies.map((assembly) => assembly.room);
  const roomWallFeatures = roomAssemblies.flatMap((assembly) => assembly.walls);
  const roomLabelIds = new Set(roomAssemblies.filter((assembly) => assembly.showLabel).map((assembly) => assembly.room.id));
  const builtStructures = buildStructureFeatures();
  const structureFeatures = [...roomWallFeatures, ...builtStructures.structures];
  const doorFeatures = [...roomAssemblies.flatMap((assembly) => assembly.doors), ...builtStructures.extraDoors];
  const poiFeatures = source.pois.map((poi) => marker(poi));

  const spacesCollection: OfficeFeatureCollection = {
    type: "FeatureCollection",
    features: roomFeatures,
  };

  const structuresCollection: OfficeFeatureCollection = {
    type: "FeatureCollection",
    features: [...structureFeatures, ...doorFeatures],
  };

  const poiCollection: OfficeFeatureCollection = {
    type: "FeatureCollection",
    features: poiFeatures,
  };

  const roomLabelCollection: OfficeFeatureCollection = {
    type: "FeatureCollection",
    features: roomFeatures.filter((feature) => roomLabelIds.has(feature.id)).map((feature) => labelPoint(feature)),
  };

  const poiLabelCollection: OfficeFeatureCollection = {
    type: "FeatureCollection",
    features: poiFeatures
      .filter((feature) => feature.properties.kind === "workstation" || feature.properties.kind === "connector")
      .map((feature) => labelPoint(feature)),
  };

  const allFeatures = [...roomFeatures, ...structureFeatures, ...doorFeatures, ...poiFeatures] satisfies OfficeFeature[];

  const routeAnchorPoint = (room: CanonicalRoom): Coordinate => safePolygonCenter(room.polygon);

  const localOpeningBoundaryPoint = (opening: CanonicalOpening): Coordinate => opening.point;

  const localPortalPoint = (room: CanonicalRoom, opening: CanonicalOpening): Coordinate => {
    const { inNormal } = openingWallInfo(room, opening.point);
    const [px, py] = opening.point;
    return [px + inNormal[0] * PORTAL_INSET, py + inNormal[1] * PORTAL_INSET];
  };

  const withinBounds = (coordinate: Coordinate, bounds: LocalRectBounds, padding = 0) =>
    coordinate[0] >= bounds[0] - padding &&
    coordinate[0] <= bounds[2] + padding &&
    coordinate[1] >= bounds[1] - padding &&
    coordinate[1] <= bounds[3] + padding;

  const clampToBounds = (coordinate: Coordinate, bounds: LocalRectBounds, inset = 0.2): Coordinate => [
    Math.min(Math.max(coordinate[0], bounds[0] + inset), bounds[2] - inset),
    Math.min(Math.max(coordinate[1], bounds[1] + inset), bounds[3] - inset),
  ];

  const roomPreferredClearance = (room: CanonicalRoom, bounds: LocalRectBounds) => {
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];
    const minDimension = Math.max(0.3, Math.min(width, height));
    const baseClearance = room.department === "Коридоры" ? minDimension * 0.32 : minDimension * 0.24;
    return Math.min(ROUTE_WALL_CLEARANCE, Math.max(0.18, baseClearance));
  };

  const segmentClearance = (room: CanonicalRoom, start: Coordinate, end: Coordinate, preferredClearance: number) => {
    const length = coordinateDistance(start, end);
    const samples = Math.max(4, Math.ceil(length / Math.max(0.25, preferredClearance * 0.6)));
    let best = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= samples; index += 1) {
      const progress = index / samples;
      const point: Coordinate = [
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress,
      ];
      const clearance = polygonClearance(point, room.polygon);
      const threshold = index === 0 || index === samples ? preferredClearance * 0.2 : preferredClearance * 0.35;
      if (clearance < threshold) {
        return -1;
      }
      best = Math.min(best, clearance);
    }

    return best;
  };

  const roomPrimaryAxis = (room: CanonicalRoom, bounds: LocalRectBounds): Coordinate => {
    let bestVector: Coordinate | null = null;
    let bestLength = 0;

    for (let index = 0; index < room.polygon.length; index += 1) {
      const current = room.polygon[index]!;
      const next = room.polygon[(index + 1) % room.polygon.length]!;
      const vector: Coordinate = [next[0] - current[0], next[1] - current[1]];
      const length = Math.hypot(vector[0], vector[1]);
      if (length > bestLength) {
        bestLength = length;
        bestVector = vector;
      }
    }

    if (bestVector && bestLength > 1e-6) {
      return normalizeVector(bestVector);
    }

    return bounds[2] - bounds[0] >= bounds[3] - bounds[1] ? [1, 0] : [0, 1];
  };

  const roomSpineCache = new Map<string, Coordinate[]>();

  const roomSpinePoints = (room: CanonicalRoom, bounds: LocalRectBounds): Coordinate[] => {
    const cached = roomSpineCache.get(room.id);
    if (cached) {
      return cached;
    }

    const preferredClearance = roomPreferredClearance(room, bounds);
    const axis = roomPrimaryAxis(room, bounds);
    const normal: Coordinate = [-axis[1], axis[0]];
    const alongValues = room.polygon.map((point) => axisProjection(point, axis));
    const normalValues = room.polygon.map((point) => axisProjection(point, normal));
    const alongMin = Math.min(...alongValues);
    const alongMax = Math.max(...alongValues);
    const normalMin = Math.min(...normalValues);
    const normalMax = Math.max(...normalValues);
    const span = alongMax - alongMin;
    const sampleCount = Math.max(3, Math.min(14, Math.ceil(span / Math.max(1, preferredClearance * 1.8))));
    const scanCount = 28;
    const candidates: Coordinate[] = [];
    const addCandidate = (candidate: Coordinate | null) => {
      if (!candidate) return;
      const rounded: Coordinate = [Number(candidate[0].toFixed(3)), Number(candidate[1].toFixed(3))];
      if (candidates.some((existing) => Math.hypot(existing[0] - rounded[0], existing[1] - rounded[1]) <= 0.08)) {
        return;
      }
      candidates.push(rounded);
    };

    addCandidate(safePolygonCenter(room.polygon));

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const along =
        sampleCount === 1
          ? (alongMin + alongMax) / 2
          : alongMin + ((alongMax - alongMin) * sampleIndex) / (sampleCount - 1);
      let bestPoint: Coordinate | null = null;
      let bestClearance = -1;

      for (let scanIndex = 0; scanIndex <= scanCount; scanIndex += 1) {
        const normalOffset =
          normalMin + ((normalMax - normalMin) * scanIndex) / scanCount;
        const point: Coordinate = [
          axis[0] * along + normal[0] * normalOffset,
          axis[1] * along + normal[1] * normalOffset,
        ];
        const clearance = polygonClearance(point, room.polygon);
        if (clearance > bestClearance) {
          bestClearance = clearance;
          bestPoint = point;
        }
      }

      if (bestPoint && bestClearance >= preferredClearance * 0.35) {
        addCandidate(bestPoint);
      }
    }

    const center = safePolygonCenter(room.polygon);
    candidates.sort((left, right) => axisProjection(left, axis) - axisProjection(right, axis));
    if (candidates.every((candidate) => Math.hypot(candidate[0] - center[0], candidate[1] - center[1]) > 0.08)) {
      candidates.push(center);
      candidates.sort((left, right) => axisProjection(left, axis) - axisProjection(right, axis));
    }

    roomSpineCache.set(room.id, candidates);
    return candidates;
  };

  const anchorSpineRoomPath = (room: CanonicalRoom, start: Coordinate, end: Coordinate, bounds: LocalRectBounds): Coordinate[] => {
    const anchor = clampToBounds(routeAnchorPoint(room), bounds, ROUTE_WALL_CLEARANCE);
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];
    const points: Coordinate[] = [];

    appendCoordinate(points, start);

    if (width >= height) {
      appendCoordinate(points, [start[0], anchor[1]]);
      appendCoordinate(points, [end[0], anchor[1]]);
    } else {
      appendCoordinate(points, [anchor[0], start[1]]);
      appendCoordinate(points, [anchor[0], end[1]]);
    }

    appendCoordinate(points, end);
    return points;
  };

  const orthogonalRoomPath = (start: Coordinate, end: Coordinate, bounds: LocalRectBounds): Coordinate[] => {
    if (start[0] === end[0] || start[1] === end[1]) {
      return [start, end];
    }

    const horizontalFirst: Coordinate = [end[0], start[1]];
    const verticalFirst: Coordinate = [start[0], end[1]];

    if (withinBounds(horizontalFirst, bounds, 0.001)) {
      return [start, horizontalFirst, end];
    }

    if (withinBounds(verticalFirst, bounds, 0.001)) {
      return [start, verticalFirst, end];
    }

    const startClamp = clampToBounds(start, bounds);
    const endClamp = clampToBounds(end, bounds);
    return [startClamp, [endClamp[0], startClamp[1]], endClamp];
  };

  const portalSideForPoint = (bounds: LocalRectBounds, coordinate: Coordinate): "north" | "south" | "east" | "west" | null => {
    const [x1, y1, x2, y2] = bounds;
    const tolerance = PORTAL_INSET + 0.05;

    if (Math.abs(coordinate[0] - (x1 + PORTAL_INSET)) <= tolerance) {
      return "west";
    }

    if (Math.abs(coordinate[0] - (x2 - PORTAL_INSET)) <= tolerance) {
      return "east";
    }

    if (Math.abs(coordinate[1] - (y1 + PORTAL_INSET)) <= tolerance) {
      return "south";
    }

    if (Math.abs(coordinate[1] - (y2 - PORTAL_INSET)) <= tolerance) {
      return "north";
    }

    return null;
  };

  const centerlineRoomPath = (start: Coordinate, end: Coordinate, bounds: LocalRectBounds): Coordinate[] => {
    const center = localRoomCenter(bounds);
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];
    const points: Coordinate[] = [];

    appendCoordinate(points, start);

    if (width >= height) {
      appendCoordinate(points, [start[0], center[1]]);
      appendCoordinate(points, [end[0], center[1]]);
    } else {
      appendCoordinate(points, [center[0], start[1]]);
      appendCoordinate(points, [center[0], end[1]]);
    }

    appendCoordinate(points, end);
    return points;
  };

  const roomLocalNavPath = (room: CanonicalRoom, start: Coordinate, end: Coordinate, bounds: LocalRectBounds): Coordinate[] | null => {
    if (coordinateDistance(start, end) <= ROUTE_EPSILON) {
      return [start, end];
    }

    const preferredClearance = roomPreferredClearance(room, bounds);
    const spine = roomSpinePoints(room, bounds);
    const nodes: Coordinate[] = [start, ...spine, end];
    const adjacency = nodes.map(() => [] as Array<{ to: number; weight: number }>);
    const connect = (from: number, to: number) => {
      const left = nodes[from];
      const right = nodes[to];
      if (!left || !right) return;
      const clearance = segmentClearance(room, left, right, preferredClearance);
      if (clearance < 0) return;
      const distance = coordinateDistance(left, right);
      const clearancePenalty = Math.max(0, preferredClearance - clearance) * 1.75;
      const weight = distance + clearancePenalty;
      adjacency[from]!.push({ to, weight });
      adjacency[to]!.push({ to: from, weight });
    };

    const nearestSpineIndexes = (point: Coordinate) =>
      nodes
        .slice(1, -1)
        .map((coordinate, offset) => ({
          index: offset + 1,
          distance: coordinateDistance(point, coordinate),
        }))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 2)
        .map((entry) => entry.index);

    const spineIndexes = nodes.slice(1, -1).map((_, offset) => offset + 1);

    if (spineIndexes.length === 0) {
      connect(0, nodes.length - 1);
    } else {
      for (const index of nearestSpineIndexes(start)) {
        connect(0, index);
      }
      for (const index of nearestSpineIndexes(end)) {
        connect(index, nodes.length - 1);
      }
    }

    for (let index = 1; index < nodes.length - 2; index += 1) {
      connect(index, index + 1);
    }

    const distances = nodes.map(() => Number.POSITIVE_INFINITY);
    const previous = nodes.map(() => -1);
    const queue = [{ index: 0, distance: 0 }];
    distances[0] = 0;

    while (queue.length > 0) {
      queue.sort((left, right) => left.distance - right.distance);
      const current = queue.shift();
      if (!current) break;
      if (current.index === nodes.length - 1) break;
      if (current.distance > distances[current.index]!) continue;

      for (const edge of adjacency[current.index]!) {
        const nextDistance = current.distance + edge.weight;
        if (nextDistance >= distances[edge.to]!) continue;
        distances[edge.to] = nextDistance;
        previous[edge.to] = current.index;
        queue.push({ index: edge.to, distance: nextDistance });
      }
    }

    if (!Number.isFinite(distances[nodes.length - 1]!)) {
      return null;
    }

    const path: Coordinate[] = [];
    let cursor = nodes.length - 1;
    while (cursor >= 0) {
      const coordinate = nodes[cursor];
      if (coordinate) {
        path.unshift(coordinate);
      }
      cursor = previous[cursor] ?? -1;
    }

    return path;
  };

  const roomTraversalPath = (room: CanonicalRoom, start: Coordinate, end: Coordinate): Coordinate[] => {
    const bounds = polygonBounds(room.polygon);
    const navPath = roomLocalNavPath(room, start, end, bounds);
    if (navPath && navPath.length >= 2) {
      return navPath;
    }

    if (room.department === "Коридоры") {
      const width = bounds[2] - bounds[0];
      const height = bounds[3] - bounds[1];
      const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
      const startSide = portalSideForPoint(bounds, start);
      const endSide = portalSideForPoint(bounds, end);
      const oppositeSides =
        (startSide === "west" && endSide === "east") ||
        (startSide === "east" && endSide === "west") ||
        (startSide === "north" && endSide === "south") ||
        (startSide === "south" && endSide === "north");

      if (oppositeSides || aspectRatio >= 2) {
        return centerlineRoomPath(start, end, bounds);
      }
    }

    if (roomHasDiagonalEdge(room)) {
      return anchorSpineRoomPath(room, start, end, bounds);
    }

    return orthogonalRoomPath(start, end, bounds);
  };

  const roomContainingPoint = (level: LevelId, localCoordinate: Coordinate): CanonicalRoom | null => {
    for (const room of source.rooms) {
      if (room.level !== level) continue;
      if (pointInPolygon(localCoordinate[0], localCoordinate[1], room.polygon)) return room;
    }

    return null;
  };

  const openingPairKey = (room: CanonicalRoom, opening: CanonicalOpening) => {
    const [x, y] = opening.point;
    const roomKey = [room.id, opening.connectsTo ?? "unlinked"].sort().join("::");
    return `${room.level}::${roomKey}::${x.toFixed(3)}::${y.toFixed(3)}::${opening.width.toFixed(3)}`;
  };

  const reciprocalOpening = (sourceRoom: CanonicalRoom, targetRoom: CanonicalRoom, opening: CanonicalOpening) =>
    (targetRoom.openings ?? []).find(
      (candidate) =>
        candidate.traversable !== false &&
        candidate.connectsTo === sourceRoom.id &&
        Math.abs(candidate.point[0] - opening.point[0]) < 0.01 &&
        Math.abs(candidate.point[1] - opening.point[1]) < 0.01 &&
        candidate.width === opening.width,
    );

  const derivedPortalNodes: DerivedPortalNode[] = [];
  const derivedPortalConnections: DerivedPortalConnection[] = [];
  const portalsByRoomId = new Map<string, DerivedPortalNode[]>();
  const processedOpenings = new Set<string>();

  for (const room of source.rooms) {
    for (const opening of room.openings ?? []) {
      if (opening.traversable === false || !opening.connectsTo) {
        continue;
      }

      const targetRoom = roomById.get(opening.connectsTo);

      if (!targetRoom) {
        continue;
      }

      const pairKey = openingPairKey(room, opening);

      if (processedOpenings.has(pairKey)) {
        continue;
      }

      const targetOpening = reciprocalOpening(room, targetRoom, opening);
      const targetOpeningForPortal: CanonicalOpening = targetOpening ?? {
        ...opening,
        id: `auto-${room.id}-${opening.id}`,
      };
      const boundaryPoint = localOpeningBoundaryPoint(opening);
      const sourcePortal: DerivedPortalNode = {
        id: autoPortalNodeId(room.id, opening.id),
        roomId: room.id,
        level: room.level,
        point: localPortalPoint(room, opening),
      };
      const targetPortal: DerivedPortalNode = {
        id: autoPortalNodeId(targetRoom.id, targetOpeningForPortal.id),
        roomId: targetRoom.id,
        level: targetRoom.level,
        point: localPortalPoint(targetRoom, targetOpeningForPortal),
      };

      derivedPortalNodes.push(sourcePortal, targetPortal);
      derivedPortalConnections.push({
        id: pairKey,
        fromPortalId: sourcePortal.id,
        toPortalId: targetPortal.id,
        boundaryPoint,
      });
      portalsByRoomId.set(sourcePortal.roomId, [...(portalsByRoomId.get(sourcePortal.roomId) ?? []), sourcePortal]);
      portalsByRoomId.set(targetPortal.roomId, [...(portalsByRoomId.get(targetPortal.roomId) ?? []), targetPortal]);
      processedOpenings.add(pairKey);
    }
  }

  for (const poi of source.pois) {
    const containingRoom = poi.roomId ? roomById.get(poi.roomId) ?? null : roomContainingPoint(poi.level, poi.point);

    if (!containingRoom) {
      throw new Error(`Point feature ${poi.id} is not contained in any room.`);
    }
  }

  const roomAnchorNodes: RoutingGraph["nodes"] = source.rooms.map((room) => {
    const anchor = routeAnchorPoint(room);
    return {
      id: roomAnchorNodeId(room.id),
      level: room.level,
      point: point(anchor[0], anchor[1]),
      kind: "room_anchor",
      featureRef: room.id,
    };
  });

  const portalGraphNodes: RoutingGraph["nodes"] = derivedPortalNodes.map((portal) => ({
    id: portal.id,
    level: portal.level,
    point: point(portal.point[0], portal.point[1]),
    kind: "junction",
  }));

  const poiNavigationNodes: RoutingGraph["nodes"] = source.pois.map((poi) => ({
    id: poiNodeId(poi.id),
    level: poi.level,
    point: point(poi.point[0], poi.point[1]),
    kind: poi.kind === "connector" ? "connector" : "room_anchor",
    featureRef: poi.id,
  }));

  const routeEdge = (
    id: string,
    from: string,
    to: string,
    weight: number,
    coordinates: Coordinate[],
    options: Pick<RoutingEdge, "accessible" | "connectorType">,
  ): RoutingEdge => ({
    id,
    from,
    to,
    weight,
    path: path(coordinates),
    connectorType: options.connectorType,
    accessible: options.accessible,
  });

  const derivedEdges: RoutingEdge[] = [];

  for (const room of source.rooms) {
    const anchor = routeAnchorPoint(room);
    const anchorNode = roomAnchorNodeId(room.id);
    const roomPortals = portalsByRoomId.get(room.id) ?? [];

    for (const portal of roomPortals) {
      const portalPath = roomTraversalPath(room, anchor, portal.point);
      derivedEdges.push(
        routeEdge(
          `edge-room-${room.id}-${portal.id}`,
          anchorNode,
          portal.id,
          coordinatePathLength(portalPath),
          portalPath,
          { accessible: true },
        ),
      );
    }

    for (let leftIndex = 0; leftIndex < roomPortals.length; leftIndex += 1) {
      const leftPortal = roomPortals[leftIndex];

      if (!leftPortal) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < roomPortals.length; rightIndex += 1) {
        const rightPortal = roomPortals[rightIndex];

        if (!rightPortal) {
          continue;
        }

        const portalPath = roomTraversalPath(room, leftPortal.point, rightPortal.point);
        derivedEdges.push(
          routeEdge(
            `edge-room-pass-${room.id}-${leftPortal.id}-${rightPortal.id}`,
            leftPortal.id,
            rightPortal.id,
            coordinatePathLength(portalPath),
            portalPath,
            { accessible: true },
          ),
        );
      }
    }
  }

  const portalNodeById = new Map(derivedPortalNodes.map((portal) => [portal.id, portal]));

  for (const connection of derivedPortalConnections) {
    const fromPortal = portalNodeById.get(connection.fromPortalId);
    const toPortal = portalNodeById.get(connection.toPortalId);

    if (!fromPortal || !toPortal) {
      continue;
    }

    derivedEdges.push(
      routeEdge(
        `edge-portal-${connection.id}`,
        fromPortal.id,
        toPortal.id,
        coordinatePathLength([fromPortal.point, connection.boundaryPoint, toPortal.point]),
        [fromPortal.point, connection.boundaryPoint, toPortal.point],
        { accessible: true },
      ),
    );
  }

  const featureRouteNodeIdByFeatureId = new Map<string, string>();

  for (const room of source.rooms) {
    featureRouteNodeIdByFeatureId.set(room.id, roomAnchorNodeId(room.id));
  }

  for (const poi of source.pois) {
    const nodeId = poiNodeId(poi.id);
    const containingRoom = poi.roomId ? roomById.get(poi.roomId) ?? null : roomContainingPoint(poi.level, poi.point);

    featureRouteNodeIdByFeatureId.set(poi.id, nodeId);

    if (!containingRoom) {
      continue;
    }

    const roomPortals = portalsByRoomId.get(containingRoom.id) ?? [];

    if (poi.kind === "connector" && roomPortals.length > 0) {
      for (const portal of roomPortals) {
        const connectorPath: Coordinate[] = [];

        if (poi.accessPath) {
          const roomApproach = poi.accessPath.roomApproach ?? poi.accessPath.threshold;
          appendCoordinate(connectorPath, portal.point);
          appendCoordinate(connectorPath, [portal.point[0], roomApproach[1]]);

          if (!coordinatesEqual(roomApproach, poi.accessPath.threshold)) {
            appendCoordinate(connectorPath, roomApproach);
          }

          appendCoordinate(connectorPath, poi.accessPath.threshold);

          if (poi.accessPath.interiorApproach) {
            appendCoordinate(connectorPath, poi.accessPath.interiorApproach);
            appendCoordinate(connectorPath, [poi.point[0], poi.accessPath.interiorApproach[1]]);
          }

          appendCoordinate(connectorPath, poi.point);
        } else {
          appendCoordinates(connectorPath, roomTraversalPath(containingRoom, portal.point, poi.point));
        }

        derivedEdges.push(
          routeEdge(
            `edge-poi-${poi.id}-${portal.id}`,
            portal.id,
            nodeId,
            connectorPath.slice(1).reduce(
              (distance, coordinate, index) => distance + coordinateDistance(connectorPath[index] ?? coordinate, coordinate),
              0,
            ),
            connectorPath,
            { accessible: poi.kind !== "connector" || poi.accessible !== false },
          ),
        );
      }

      continue;
    }

    const anchor = routeAnchorPoint(containingRoom);
    const poiPath = roomTraversalPath(containingRoom, poi.point, anchor);

    derivedEdges.push(
      routeEdge(
        `edge-poi-${poi.id}`,
        nodeId,
        roomAnchorNodeId(containingRoom.id),
        coordinatePathLength(poiPath),
        poiPath,
        { accessible: true },
      ),
    );
  }

  const connectorsByGroup = new Map<string, CanonicalPoi[]>();

  for (const poi of source.pois.filter((item) => item.kind === "connector")) {
    const groupId = poi.connectorGroupId ?? poi.id;
    connectorsByGroup.set(groupId, [...(connectorsByGroup.get(groupId) ?? []), poi]);
  }

  for (const connectorPois of connectorsByGroup.values()) {
    const sortedConnectors = [...connectorPois].sort((left, right) => (levelById.get(left.level)?.order ?? 0) - (levelById.get(right.level)?.order ?? 0));

    for (let index = 0; index < sortedConnectors.length - 1; index += 1) {
      const current = sortedConnectors[index];
      const next = sortedConnectors[index + 1];

      if (!current || !next) {
        continue;
      }

      const connectorType = current.connectorType ?? "stairs";

      derivedEdges.push(
        routeEdge(
          `edge-connector-${current.id}-${next.id}`,
          poiNodeId(current.id),
          poiNodeId(next.id),
          connectorType === "elevator" ? 6 : 10,
          [current.point, current.point],
          { connectorType, accessible: current.accessible ?? connectorType === "elevator" },
        ),
      );
    }
  }

  const routingGraph: RoutingGraph = {
    nodes: [...roomAnchorNodes, ...portalGraphNodes, ...poiNavigationNodes],
    edges: derivedEdges,
  };

  const sameCoordinate = (left: Coordinate, right: Coordinate) => left[0] === right[0] && left[1] === right[1];
  const pathIsOrthogonal = (coordinates: Coordinate[]) =>
    coordinates.every((coordinate, index) => {
      if (index === 0) {
        return true;
      }

      const previous = coordinates[index - 1];
      return !previous || coordinate[0] === previous[0] || coordinate[1] === previous[1];
    });

  const allowsDiagonalRouteEdge = (edgeId: string) =>
    edgeId.startsWith("edge-portal-") ||
    edgeId.startsWith("edge-room-") ||
    edgeId.startsWith("edge-poi-");

  for (const room of source.rooms) {
    for (const opening of room.openings ?? []) {
      if (!opening.connectsTo) {
        continue;
      }

      const target = roomById.get(opening.connectsTo);

      if (!target) {
        throw new Error(`Opening ${room.id}:${opening.id} points to missing room ${opening.connectsTo}.`);
      }

      if (target.level !== room.level) {
        throw new Error(`Opening ${room.id}:${opening.id} crosses levels (${room.level} -> ${target.level}).`);
      }

      const [opx, opy] = opening.point;
      if (!roomsShareOpeningBoundary(room, target, [opx, opy])) {
        throw new Error(`Opening ${room.id}:${opening.id} point [${opx},${opy}] does not lie on boundary with ${opening.connectsTo}.`);
      }
    }
  }

  const graphNodeById = new Map(routingGraph.nodes.map((node) => [node.id, node]));

  for (const edge of routingGraph.edges) {
    const fromNode = graphNodeById.get(edge.from);
    const toNode = graphNodeById.get(edge.to);

    if (!fromNode || !toNode) {
      throw new Error(`Route edge ${edge.id} points to a missing node.`);
    }

    const firstCoordinate = edge.path[0];
    const lastCoordinate = edge.path[edge.path.length - 1];

    if (!firstCoordinate || !lastCoordinate) {
      throw new Error(`Route edge ${edge.id} has an incomplete path.`);
    }

    if (!sameCoordinate(firstCoordinate, fromNode.point)) {
      throw new Error(`Route edge ${edge.id} does not start at node ${edge.from}.`);
    }

    if (!sameCoordinate(lastCoordinate, toNode.point)) {
      throw new Error(`Route edge ${edge.id} does not end at node ${edge.to}.`);
    }

    if (!edge.connectorType && fromNode.level !== toNode.level) {
      throw new Error(`Route edge ${edge.id} crosses levels without a connector type.`);
    }

    if (!edge.connectorType && !pathIsOrthogonal(edge.path) && !allowsDiagonalRouteEdge(edge.id)) {
      throw new Error(`Route edge ${edge.id} contains a diagonal segment.`);
    }
  }

  for (const feature of roomFeatures) {
    feature.properties.routeNodeId = featureRouteNodeIdByFeatureId.get(feature.id);
  }

  for (const feature of poiFeatures) {
    feature.properties.routeNodeId = featureRouteNodeIdByFeatureId.get(feature.id);
  }

  const searchableRooms = source.rooms.filter((room) => room.showLabel !== false && room.department !== "Коридоры");
  const searchEntries: SearchEntry[] = [
    ...searchableRooms.map((room) => {
      const level = levelById.get(room.level);
      const roomLabel =
        room.kind === "meeting_room" ? "Переговорная" : room.kind === "amenity" ? "Сервисная зона" : "Помещение";

      return {
        id: `search-${room.id}`,
        label: room.number ? `${room.number} · ${safeName(room.name, room.id)}` : safeName(room.name, room.id),
        description: `${roomLabel} · ${level?.label ?? room.level}`,
        level: room.level,
        featureId: room.id,
        tokens: normalizedSearchTokens(room.name, room.number, room.subtitle, room.department, ...(room.equipment ?? []), ...(room.searchTokens ?? [])),
      };
    }),
    ...source.pois.map((poi) => ({
      id: `search-${poi.id}`,
      label: poi.employee ?? safeName(poi.name, poi.id),
      description:
        poi.kind === "workstation"
          ? `${safeName(poi.name, poi.id)} · ${poi.department ?? "Рабочая зона"}`
          : `${poi.kind === "connector" ? "Переход" : "Сервисная зона"} · ${levelById.get(poi.level)?.label ?? poi.level}`,
      level: poi.level,
      featureId: poi.id,
      tokens: normalizedSearchTokens(poi.name, poi.subtitle, poi.department, poi.employee, ...(poi.searchTokens ?? [])),
    })),
  ].sort((left, right) => left.label.localeCompare(right.label));

  const routeableRoomFeature = (feature: OfficeFeature) => {
    if (feature.properties.kind !== "room" && feature.properties.kind !== "meeting_room" && feature.properties.kind !== "amenity") {
      return false;
    }

    const room = roomById.get(feature.id);
    return Boolean(room && (room.openings ?? []).some((opening) => opening.traversable !== false && opening.connectsTo));
  };

  const routeTargetLabel = (feature: OfficeFeature) => feature.properties.employee ?? safeName(feature.properties.name, feature.id);
  const routeTargets: RouteTarget[] = [...roomFeatures.filter(routeableRoomFeature), ...poiFeatures.filter((feature) => feature.properties.kind === "connector")]
    .map((feature) => {
      const routeNodeId = featureRouteNodeIdByFeatureId.get(feature.id);

      if (!routeNodeId) {
        throw new Error(`Feature ${feature.id} has no derived route node.`);
      }

      return {
        id: derivedTargetId(feature.id),
        label: routeTargetLabel(feature),
        level: feature.properties.level,
        featureId: feature.id,
        routeNodeIds: [routeNodeId],
        routeNodeId,
      };
    })
    .sort((left, right) => (levelById.get(left.level)?.order ?? 0) - (levelById.get(right.level)?.order ?? 0) || left.label.localeCompare(right.label));

  const statusRoomIds = source.rooms.filter((room) => room.status !== undefined).map((room) => room.id);

  return {
    levels,
    collections: {
      spaces: spacesCollection,
      structures: structuresCollection,
      pois: poiCollection,
      roomLabels: roomLabelCollection,
      poiLabels: poiLabelCollection,
    },
    routing: {
      graph: routingGraph,
      targets: routeTargets,
    },
    search: {
      entries: searchEntries,
    },
    status: {
      roomIds: statusRoomIds,
    },
    features: allFeatures,
  };
};

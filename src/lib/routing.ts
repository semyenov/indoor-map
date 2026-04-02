import type { FeatureCollection, LineString, Point } from "geojson";
import type { Coordinate, LevelId, RouteResult, RouteSummary, RoutingEdge, RoutingGraph, RoutingOptions } from "./types";

interface QueueItem {
  nodeId: string;
  distance: number;
}

interface EdgeTraversalMeta {
  edge: RoutingEdge;
  distance: number;
  connectorType?: "stairs" | "elevator";
}

const edgeKey = (from: string, to: string) => `${from}::${to}`;
const EPSILON = 0.000001;
const SMOOTHING_EPSILON = 0.00000005;
// Push corridor turns toward a more guided spline-like shape without drifting off the route graph.
const MAX_CORNER_RADIUS = 1.5;
const CORNER_RADIUS_FACTOR = 0.5;
const MIN_CURVE_STEPS = 18;
const MAX_CURVE_STEPS = 36;

const coordinatesEqual = (left: Coordinate, right: Coordinate) => left[0] === right[0] && left[1] === right[1];

const reversePath = (coordinates: Coordinate[]): Coordinate[] => [...coordinates].reverse();
const coordinateKey = (coordinate: Coordinate) => `${coordinate[0].toFixed(9)}:${coordinate[1].toFixed(9)}`;

const coordinateDistance = (left: Coordinate, right: Coordinate) =>
  Math.hypot(right[0] - left[0], right[1] - left[1]);

const isZeroLength = (left: Coordinate, right: Coordinate, epsilon = EPSILON) =>
  coordinateDistance(left, right) <= epsilon;

const nearlyEqual = (left: number, right: number, epsilon = EPSILON) => Math.abs(left - right) <= epsilon;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isCollinear = (left: Coordinate, pivot: Coordinate, right: Coordinate, epsilon = EPSILON) =>
  (nearlyEqual(left[0], pivot[0], epsilon) && nearlyEqual(pivot[0], right[0], epsilon)) ||
  (nearlyEqual(left[1], pivot[1], epsilon) && nearlyEqual(pivot[1], right[1], epsilon));

const pointTowards = (from: Coordinate, to: Coordinate, distance: number): Coordinate => {
  const fullDistance = coordinateDistance(from, to);

  if (fullDistance <= EPSILON || distance <= EPSILON) {
    return from;
  }

  const ratio = Math.min(1, distance / fullDistance);

  return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
};

const quadraticPoint = (start: Coordinate, control: Coordinate, end: Coordinate, progress: number): Coordinate => {
  const inverse = 1 - progress;
  const x = inverse * inverse * start[0] + 2 * inverse * progress * control[0] + progress * progress * end[0];
  const y = inverse * inverse * start[1] + 2 * inverse * progress * control[1] + progress * progress * end[1];

  return [x, y];
};

const cornerCurveSteps = (previous: Coordinate, current: Coordinate, next: Coordinate) => {
  const incomingX = previous[0] - current[0];
  const incomingY = previous[1] - current[1];
  const outgoingX = next[0] - current[0];
  const outgoingY = next[1] - current[1];
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);

  if (incomingLength <= EPSILON || outgoingLength <= EPSILON) {
    return MIN_CURVE_STEPS;
  }

  const normalizedDot = clamp(
    (incomingX * outgoingX + incomingY * outgoingY) / (incomingLength * outgoingLength),
    -1,
    1,
  );
  const turnAngle = Math.acos(normalizedDot);
  const extraSteps = Math.ceil((turnAngle / Math.PI) * MIN_CURVE_STEPS);

  return clamp(MIN_CURVE_STEPS + extraSteps, MIN_CURVE_STEPS, MAX_CURVE_STEPS);
};

const appendUniqueCoordinate = (target: Coordinate[], coordinate: Coordinate, epsilon = EPSILON) => {
  const lastCoordinate = target.at(-1);

  if (lastCoordinate && isZeroLength(lastCoordinate, coordinate, epsilon)) {
    return;
  }

  target.push(coordinate);
};

const normalizeCoordinates = (
  coordinates: Coordinate[],
  protectedCoordinates: ReadonlySet<string> = new Set(),
  epsilon = EPSILON,
): Coordinate[] => {
  const deduped: Coordinate[] = [];

  for (const coordinate of coordinates) {
    appendUniqueCoordinate(deduped, coordinate, epsilon);
  }

  if (deduped.length <= 2) {
    return deduped;
  }

  const normalized: Coordinate[] = [];

  for (const coordinate of deduped) {
    appendUniqueCoordinate(normalized, coordinate, epsilon);

    while (normalized.length >= 3) {
      const right = normalized.at(-1);
      const pivot = normalized.at(-2);
      const left = normalized.at(-3);

      if (!left || !pivot || !right || !isCollinear(left, pivot, right, epsilon) || protectedCoordinates.has(coordinateKey(pivot))) {
        break;
      }

      normalized.splice(normalized.length - 2, 1);
    }
  }

  return normalized;
};

const smoothCoordinates = (coordinates: Coordinate[], protectedCoordinates: ReadonlySet<string> = new Set()): Coordinate[] => {
  const normalized = normalizeCoordinates(coordinates, protectedCoordinates);

  if (normalized.length <= 2) {
    return normalized;
  }

  const firstCoordinate = normalized[0];

  if (!firstCoordinate) {
    return [];
  }

  const smoothed: Coordinate[] = [firstCoordinate];

  for (let index = 1; index < normalized.length - 1; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    const next = normalized[index + 1];

    if (!previous || !current || !next) {
      continue;
    }

    if (protectedCoordinates.has(coordinateKey(current))) {
      appendUniqueCoordinate(smoothed, current, SMOOTHING_EPSILON);
      continue;
    }

    if (isCollinear(previous, current, next)) {
      appendUniqueCoordinate(smoothed, current, SMOOTHING_EPSILON);
      continue;
    }

    const incomingLength = coordinateDistance(previous, current);
    const outgoingLength = coordinateDistance(current, next);
    const radius = Math.min(MAX_CORNER_RADIUS, incomingLength * CORNER_RADIUS_FACTOR, outgoingLength * CORNER_RADIUS_FACTOR);

    if (radius <= EPSILON) {
      appendUniqueCoordinate(smoothed, current, SMOOTHING_EPSILON);
      continue;
    }

    const cornerStart = pointTowards(current, previous, radius);
    const cornerEnd = pointTowards(current, next, radius);
    const curveSteps = cornerCurveSteps(previous, current, next);

    appendUniqueCoordinate(smoothed, cornerStart, SMOOTHING_EPSILON);

    for (let step = 1; step < curveSteps; step += 1) {
      const progress = step / curveSteps;
      appendUniqueCoordinate(smoothed, quadraticPoint(cornerStart, current, cornerEnd, progress), SMOOTHING_EPSILON);
    }

    appendUniqueCoordinate(smoothed, cornerEnd, SMOOTHING_EPSILON);
  }

  const lastCoordinate = normalized.at(-1);

  if (lastCoordinate) {
    appendUniqueCoordinate(smoothed, lastCoordinate, SMOOTHING_EPSILON);
  }

  return normalizeCoordinates(smoothed, protectedCoordinates, SMOOTHING_EPSILON);
};

const directedEdgePath = (edge: RoutingEdge, fromNodeId: string, toNodeId: string): Coordinate[] => {
  if (edge.from === fromNodeId && edge.to === toNodeId) {
    return edge.path;
  }

  return reversePath(edge.path);
};

const appendCoordinates = (target: Coordinate[], nextCoordinates: Coordinate[]) => {
  for (const coordinate of nextCoordinates) {
    const lastCoordinate = target.at(-1);

    if (lastCoordinate && coordinatesEqual(lastCoordinate, coordinate)) {
      continue;
    }

    target.push(coordinate);
  }
};

export const computeRoute = (
  graph: RoutingGraph,
  fromNodeId: string,
  toNodeId: string,
  options: RoutingOptions = {},
): RouteResult | null => {
  if (fromNodeId === toNodeId) {
    const node = graph.nodes.find((item) => item.id === fromNodeId);

    if (!node) {
      return null;
    }

    return {
      nodeIds: [fromNodeId],
      legs: [],
      segments: [{ level: node.level, coordinates: [node.point] }],
      summary: {
        distance: 0,
        levels: [node.level],
        connectorTypes: [],
      },
    };
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, QueueItem[]>();
  const edgeMeta = new Map<string, EdgeTraversalMeta>();

  for (const edge of graph.edges) {
    if (options.accessibleOnly && !edge.accessible) {
      continue;
    }

    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { nodeId: edge.to, distance: edge.weight }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { nodeId: edge.from, distance: edge.weight }]);
    edgeMeta.set(edgeKey(edge.from, edge.to), { edge, connectorType: edge.connectorType, distance: edge.weight });
    edgeMeta.set(edgeKey(edge.to, edge.from), { edge, connectorType: edge.connectorType, distance: edge.weight });
  }

  const distances = new Map<string, number>(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map<string, string | null>(graph.nodes.map((node) => [node.id, null]));
  const queue: QueueItem[] = [{ nodeId: fromNodeId, distance: 0 }];
  distances.set(fromNodeId, 0);

  while (queue.length > 0) {
    queue.sort((left, right) => left.distance - right.distance);
    const current = queue.shift();

    if (!current) {
      break;
    }

    if (current.nodeId === toNodeId) {
      break;
    }

    const neighbors = adjacency.get(current.nodeId) ?? [];

    for (const neighbor of neighbors) {
      const nextDistance = current.distance + neighbor.distance;
      const bestDistance = distances.get(neighbor.nodeId) ?? Number.POSITIVE_INFINITY;

      if (nextDistance >= bestDistance) {
        continue;
      }

      distances.set(neighbor.nodeId, nextDistance);
      previous.set(neighbor.nodeId, current.nodeId);
      queue.push({ nodeId: neighbor.nodeId, distance: nextDistance });
    }
  }

  if ((distances.get(toNodeId) ?? Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY) {
    return null;
  }

  const path: string[] = [];
  let cursor: string | null = toNodeId;

  while (cursor) {
    path.unshift(cursor);
    cursor = previous.get(cursor) ?? null;
  }

  const segments: RouteResult["segments"] = [];
  const legs: RouteResult["legs"] = [];
  const levels: LevelId[] = [];
  const connectorTypes = new Set<"stairs" | "elevator">();

  for (let index = 0; index < path.length; index += 1) {
    const currentId = path[index];

    if (!currentId) {
      continue;
    }

    const currentNode = nodeById.get(currentId);

    if (!currentNode) {
      continue;
    }

    if (!levels.includes(currentNode.level)) {
      levels.push(currentNode.level);
    }

    if (index < path.length - 1) {
      const nextId = path[index + 1];

      if (!nextId) {
        continue;
      }

      const connector = edgeMeta.get(edgeKey(currentId, nextId));
      const nextNode = nodeById.get(nextId);

      if (nextNode && connector) {
        const edgePath = directedEdgePath(connector.edge, currentId, nextId);

        legs.push({
          id: connector.edge.id,
          level: currentNode.level,
          fromNodeId: currentId,
          toNodeId: nextId,
          distance: connector.distance,
          path: edgePath,
          connectorType: connector.connectorType,
        });

        if (!connector.connectorType) {
          const activeSegment = segments.at(-1);

          if (!activeSegment || activeSegment.level !== currentNode.level) {
            const segment: RouteResult["segments"][number] = {
              level: currentNode.level,
              coordinates: [],
            };

            appendCoordinates(segment.coordinates, edgePath);
            segments.push(segment);
          } else {
            appendCoordinates(activeSegment.coordinates, edgePath);
          }
        }
      }

      if (connector?.connectorType) {
        connectorTypes.add(connector.connectorType);
      }
    }
  }

  return {
    nodeIds: path,
    legs,
    segments,
    summary: {
      distance: distances.get(toNodeId) ?? 0,
      levels,
      connectorTypes: [...connectorTypes],
    },
  };
};

export const computeShortestRoute = (
  graph: RoutingGraph,
  fromNodeIds: string[],
  toNodeIds: string[],
  options: RoutingOptions = {},
): RouteResult | null => {
  let bestRoute: RouteResult | null = null;

  for (const fromNodeId of fromNodeIds) {
    for (const toNodeId of toNodeIds) {
      const candidate = computeRoute(graph, fromNodeId, toNodeId, options);

      if (!candidate) {
        continue;
      }

      if (!bestRoute || candidate.summary.distance < bestRoute.summary.distance) {
        bestRoute = candidate;
      }
    }
  }

  return bestRoute;
};

export const buildRouteCollection = (
  route: RouteResult | null,
): FeatureCollection<LineString, { level: LevelId }> => {
  if (!route) {
    return { type: "FeatureCollection", features: [] };
  }

  const isPortalLeg = (legId: string) => legId.startsWith("edge-portal-");

  const displayPathForLeg = (legs: RouteResult["legs"], index: number): Coordinate[] => {
    const leg = legs[index];
    if (!leg) return [];

    if (isPortalLeg(leg.id)) {
      return leg.path.slice(1, -1);
    }

    let startIndex = 0;
    let endIndex = leg.path.length;

    const previousLeg = legs[index - 1];
    if (
      previousLeg &&
      !previousLeg.connectorType &&
      previousLeg.level === leg.level &&
      isPortalLeg(previousLeg.id) &&
      leg.path.length > 1
    ) {
      startIndex = 1;
      if (leg.path.length > 3) {
        startIndex = 2;
      }
    }

    const nextLeg = legs[index + 1];
    if (
      nextLeg &&
      !nextLeg.connectorType &&
      nextLeg.level === leg.level &&
      isPortalLeg(nextLeg.id) &&
      leg.path.length - startIndex > 1
    ) {
      endIndex -= 1;
      if (endIndex - startIndex > 2) {
        endIndex -= 1;
      }
    }

    return leg.path.slice(startIndex, endIndex);
  };

  const segments: Array<{ level: LevelId; coordinates: Coordinate[]; protectedCoordinates: Set<string> }> = [];
  let activeSegment: { level: LevelId; coordinates: Coordinate[]; protectedCoordinates: Set<string> } | null = null;

  for (const [index, leg] of route.legs.entries()) {
    if (leg.connectorType) {
      activeSegment = null;
      continue;
    }

    if (!activeSegment || activeSegment.level !== leg.level) {
      activeSegment = {
        level: leg.level,
        coordinates: [],
        protectedCoordinates: new Set(),
      };
      segments.push(activeSegment);
    }

    const displayPath = displayPathForLeg(route.legs, index);
    appendCoordinates(activeSegment.coordinates, displayPath);

  }

  return {
    type: "FeatureCollection",
    features: segments
      .map((segment) => ({
        ...segment,
        coordinates: smoothCoordinates(segment.coordinates, segment.protectedCoordinates),
      }))
      .filter((segment) => segment.coordinates.length > 1)
      .map((segment, index) => ({
        id: `route-${segment.level}-${index}`,
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: segment.coordinates,
        },
        properties: {
          level: segment.level,
        },
      })),
  };
};

export const buildRouteMarkerCollection = (
  route: RouteResult | null,
): FeatureCollection<Point, { level: LevelId; terminal: boolean }> => {
  if (!route) {
    return { type: "FeatureCollection", features: [] };
  }

  return {
    type: "FeatureCollection",
    features: route.segments.flatMap((segment, segmentIndex) => {
      const sampledIndexes = new Set<number>();

      for (let index = 0; index < segment.coordinates.length; index += 4) {
        sampledIndexes.add(index);
      }

      if (segment.coordinates.length > 0) {
        sampledIndexes.add(0);
        sampledIndexes.add(segment.coordinates.length - 1);
      }

      return [...sampledIndexes]
        .sort((left, right) => left - right)
        .map((index) => {
          const coordinate = segment.coordinates[index];

          if (!coordinate) {
            return null;
          }

          return {
            id: `route-marker-${segment.level}-${segmentIndex}-${index}`,
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: coordinate,
            },
            properties: {
              level: segment.level,
              terminal: index === 0 || index === segment.coordinates.length - 1,
            },
          };
        })
        .filter((feature): feature is NonNullable<typeof feature> => feature !== null);
    }),
  };
};

export const summarizeRoute = (summary: RouteSummary | null) => {
  if (!summary) {
    return "No active route";
  }

  const connectors = summary.connectorTypes.length > 0 ? summary.connectorTypes.join(" + ") : "same floor";

  return `${summary.distance.toFixed(0)} m · ${summary.levels.join(" -> ")} · ${connectors}`;
};

import type { FeatureCollection, LineString } from "geojson";
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
// Push corridor turns toward a more guided spline-like shape without drifting off the route graph.
const MAX_CORNER_RADIUS = 1.5;
const CURVE_STEPS = 10;

const coordinatesEqual = (left: Coordinate, right: Coordinate) => left[0] === right[0] && left[1] === right[1];

const reversePath = (coordinates: Coordinate[]): Coordinate[] => [...coordinates].reverse();
const coordinateKey = (coordinate: Coordinate) => `${coordinate[0].toFixed(9)}:${coordinate[1].toFixed(9)}`;

const coordinateDistance = (left: Coordinate, right: Coordinate) =>
  Math.hypot(right[0] - left[0], right[1] - left[1]);

const isZeroLength = (left: Coordinate, right: Coordinate) => coordinateDistance(left, right) <= EPSILON;

const nearlyEqual = (left: number, right: number) => Math.abs(left - right) <= EPSILON;

const isCollinear = (left: Coordinate, pivot: Coordinate, right: Coordinate) =>
  (nearlyEqual(left[0], pivot[0]) && nearlyEqual(pivot[0], right[0])) ||
  (nearlyEqual(left[1], pivot[1]) && nearlyEqual(pivot[1], right[1]));

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

const appendUniqueCoordinate = (target: Coordinate[], coordinate: Coordinate) => {
  const lastCoordinate = target.at(-1);

  if (lastCoordinate && isZeroLength(lastCoordinate, coordinate)) {
    return;
  }

  target.push(coordinate);
};

const normalizeCoordinates = (coordinates: Coordinate[], protectedCoordinates: ReadonlySet<string> = new Set()): Coordinate[] => {
  const deduped: Coordinate[] = [];

  for (const coordinate of coordinates) {
    appendUniqueCoordinate(deduped, coordinate);
  }

  if (deduped.length <= 2) {
    return deduped;
  }

  const normalized: Coordinate[] = [];

  for (const coordinate of deduped) {
    appendUniqueCoordinate(normalized, coordinate);

    while (normalized.length >= 3) {
      const right = normalized.at(-1);
      const pivot = normalized.at(-2);
      const left = normalized.at(-3);

      if (!left || !pivot || !right || !isCollinear(left, pivot, right) || protectedCoordinates.has(coordinateKey(pivot))) {
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
      appendUniqueCoordinate(smoothed, current);
      continue;
    }

    if (isCollinear(previous, current, next)) {
      appendUniqueCoordinate(smoothed, current);
      continue;
    }

    const incomingLength = coordinateDistance(previous, current);
    const outgoingLength = coordinateDistance(current, next);
    const radius = Math.min(MAX_CORNER_RADIUS, incomingLength / 2, outgoingLength / 2);

    if (radius <= EPSILON) {
      appendUniqueCoordinate(smoothed, current);
      continue;
    }

    const cornerStart = pointTowards(current, previous, radius);
    const cornerEnd = pointTowards(current, next, radius);

    appendUniqueCoordinate(smoothed, cornerStart);

    for (let step = 1; step < CURVE_STEPS; step += 1) {
      const progress = step / CURVE_STEPS;
      appendUniqueCoordinate(smoothed, quadraticPoint(cornerStart, current, cornerEnd, progress));
    }

    appendUniqueCoordinate(smoothed, cornerEnd);
  }

  const lastCoordinate = normalized.at(-1);

  if (lastCoordinate) {
    appendUniqueCoordinate(smoothed, lastCoordinate);
  }

  return normalizeCoordinates(smoothed, protectedCoordinates);
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

  const segments: Array<{ level: LevelId; coordinates: Coordinate[]; protectedCoordinates: Set<string> }> = [];
  let activeSegment: { level: LevelId; coordinates: Coordinate[]; protectedCoordinates: Set<string> } | null = null;

  for (const leg of route.legs) {
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

    appendCoordinates(activeSegment.coordinates, leg.path);

    if (leg.id.startsWith("edge-portal-")) {
      for (const coordinate of leg.path) {
        activeSegment.protectedCoordinates.add(coordinateKey(coordinate));
      }
    }
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

export const summarizeRoute = (summary: RouteSummary | null) => {
  if (!summary) {
    return "No active route";
  }

  const connectors = summary.connectorTypes.length > 0 ? summary.connectorTypes.join(" + ") : "same floor";

  return `${summary.distance.toFixed(0)} m · ${summary.levels.join(" -> ")} · ${connectors}`;
};

import type { FeatureCollection, LineString } from "geojson";
import type { LevelId, RouteResult, RouteSummary, RoutingGraph, RoutingOptions } from "./types";

interface QueueItem {
  nodeId: string;
  distance: number;
}

const edgeKey = (from: string, to: string) => `${from}::${to}`;

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
  const edgeMeta = new Map<string, { connectorType?: "stairs" | "elevator"; distance: number }>();

  for (const edge of graph.edges) {
    if (options.accessibleOnly && !edge.accessible) {
      continue;
    }

    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { nodeId: edge.to, distance: edge.weight }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { nodeId: edge.from, distance: edge.weight }]);
    edgeMeta.set(edgeKey(edge.from, edge.to), { connectorType: edge.connectorType, distance: edge.weight });
    edgeMeta.set(edgeKey(edge.to, edge.from), { connectorType: edge.connectorType, distance: edge.weight });
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
  let activeSegment: RouteResult["segments"][number] | null = null;
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

    if (!activeSegment || activeSegment.level !== currentNode.level) {
      activeSegment = {
        level: currentNode.level,
        coordinates: [currentNode.point],
      };
      segments.push(activeSegment);
    } else {
      activeSegment.coordinates.push(currentNode.point);
    }

    if (index < path.length - 1) {
      const nextId = path[index + 1];

      if (!nextId) {
        continue;
      }

      const connector = edgeMeta.get(edgeKey(currentId, nextId));
      const nextNode = nodeById.get(nextId);

      if (nextNode && connector) {
        legs.push({
          id: `leg-${index}`,
          level: currentNode.level,
          fromNodeId: currentId,
          toNodeId: nextId,
          distance: connector.distance,
          connectorType: connector.connectorType,
        });
      }

      if (connector?.connectorType) {
        connectorTypes.add(connector.connectorType);
      }

      if (nextNode && nextNode.level !== currentNode.level) {
        activeSegment = null;
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

export const buildRouteCollection = (
  route: RouteResult | null,
): FeatureCollection<LineString, { level: LevelId }> => ({
  type: "FeatureCollection",
  features:
    route?.segments
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
      })) ?? [],
});

export const summarizeRoute = (summary: RouteSummary | null) => {
  if (!summary) {
    return "No active route";
  }

  const connectors = summary.connectorTypes.length > 0 ? summary.connectorTypes.join(" + ") : "same floor";

  return `${summary.distance.toFixed(0)} m · ${summary.levels.join(" -> ")} · ${connectors}`;
};

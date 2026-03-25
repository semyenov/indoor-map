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
  RoomSide,
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

const PORTAL_INSET = 0.45;
const BUILDING_BOUNDS = {
  west: 2,
  south: 2,
  east: 52,
  north: 28,
};

const roomAnchorNodeId = (roomId: string) => `node-room-${roomId}`;
const poiNodeId = (featureId: string) => `node-poi-${featureId}`;
const autoPortalNodeId = (roomId: string, openingId: string) => `node-portal-${roomId}-${openingId}`;
const derivedTargetId = (featureId: string) => `target-${featureId}`;

const oppositeRoomSide = (side: RoomSide): RoomSide => {
  switch (side) {
    case "north":
      return "south";
    case "south":
      return "north";
    case "west":
      return "east";
    case "east":
      return "west";
  }
};

const coordinateKey = (coordinate: Coordinate) => `${coordinate[0].toFixed(9)}:${coordinate[1].toFixed(9)}`;

const coordinateDistance = (left: Coordinate, right: Coordinate) =>
  Math.abs(right[0] - left[0]) + Math.abs(right[1] - left[1]);

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

export const deriveIndoorRuntimeDataset = (source: CanonicalIndoorDataset): IndoorRuntimeDataset => {
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

  const polygon = (
    id: string,
    level: LevelId,
    kind: OfficeFeatureProperties["kind"],
    name: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> & {
      focusPoint?: Coordinate;
      searchTokens?: string[];
    } = {},
  ): OfficePolygonFeature => ({
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
      name,
      focusPoint: properties.focusPoint ?? point((x1 + x2) / 2, (y1 + y2) / 2),
      searchTokens: properties.searchTokens ?? [name.toLowerCase()],
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
  });

  const marker = (
    poi: CanonicalPoi,
    properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> = {},
  ): OfficePointFeature => ({
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
      name: poi.name,
      focusPoint: point(poi.point[0], poi.point[1]),
      searchTokens: poi.searchTokens,
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
  });

  const lineFeature = (
    id: string,
    level: LevelId,
    kind: OfficeFeatureProperties["kind"],
    name: string,
    coordinates: Coordinate[],
    properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> & {
      focusPoint?: Coordinate;
      searchTokens?: string[];
    } = {},
  ): OfficeLineFeature => ({
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
      name,
      focusPoint: properties.focusPoint ?? point(coordinates[0]?.[0] ?? 0, coordinates[0]?.[1] ?? 0),
      searchTokens: properties.searchTokens ?? [name.toLowerCase()],
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
  });

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
      const inset = index * 0.05;

      steps.push(
        polygon(`${idPrefix}-step-${index + 1}`, level, "furniture", `${idPrefix} Step ${index + 1}`, x1 + inset, stepY1, x2 - inset, stepY2, {
          department: "Vertical circulation",
          baseHeight,
          height: baseHeight + treadThickness,
        }),
      );
    }

    return steps;
  };

  const rangesOverlap = (startA: number, endA: number, startB: number, endB: number) =>
    Math.min(endA, endB) - Math.max(startA, startB) > 0.001;

  const roomHasOpeningOnSide = (spec: CanonicalRoom, side: RoomSide) =>
    (spec.openings ?? []).some((opening) => opening.side === side);

  const sharesBoundaryOnSide = (specBounds: LocalRectBounds, otherBounds: LocalRectBounds, side: RoomSide) => {
    const [x1, y1, x2, y2] = specBounds;
    const [otherX1, otherY1, otherX2, otherY2] = otherBounds;

    switch (side) {
      case "north":
        return y2 === otherY1 && rangesOverlap(x1, x2, otherX1, otherX2);
      case "south":
        return y1 === otherY2 && rangesOverlap(x1, x2, otherX1, otherX2);
      case "west":
        return x1 === otherX2 && rangesOverlap(y1, y2, otherY1, otherY2);
      case "east":
        return x2 === otherX1 && rangesOverlap(y1, y2, otherY1, otherY2);
    }
  };

  const neighboringRooms = (spec: CanonicalRoom, side: RoomSide) =>
    source.rooms.filter((other) => other.id !== spec.id && sharesBoundaryOnSide(spec.bounds, other.bounds, side));

  const sideTouchesExterior = (bounds: LocalRectBounds, side: RoomSide) => {
    const [x1, y1, x2, y2] = bounds;

    switch (side) {
      case "north":
        return y2 === BUILDING_BOUNDS.north;
      case "south":
        return y1 === BUILDING_BOUNDS.south;
      case "west":
        return x1 === BUILDING_BOUNDS.west;
      case "east":
        return x2 === BUILDING_BOUNDS.east;
    }
  };

  const resolveRoomWallSides = (spec: CanonicalRoom) => {
    const explicitWalls = spec.wallSides ?? {};
    const shouldRenderSide = (side: RoomSide, defaultOwnerSide: boolean) => {
      if (explicitWalls[side] === false) {
        return false;
      }

      if (sideTouchesExterior(spec.bounds, side)) {
        return true;
      }

      if (roomHasOpeningOnSide(spec, side)) {
        return true;
      }

      const neighbors = neighboringRooms(spec, side);

      if (neighbors.length === 0) {
        return explicitWalls[side] === true;
      }

      if (neighbors.some((neighbor) => roomHasOpeningOnSide(neighbor, oppositeRoomSide(side)))) {
        return false;
      }

      return defaultOwnerSide;
    };

    return {
      north: shouldRenderSide("north", true),
      south: shouldRenderSide("south", false),
      west: shouldRenderSide("west", false),
      east: shouldRenderSide("east", true),
    };
  };

  const openingCoordinates = (bounds: LocalRectBounds, opening: CanonicalOpening): Coordinate[] => {
    const [x1, y1, x2, y2] = bounds;
    const halfWidth = opening.width / 2;

    switch (opening.side) {
      case "north":
        return [[opening.center - halfWidth, y2], [opening.center + halfWidth, y2]];
      case "south":
        return [[opening.center - halfWidth, y1], [opening.center + halfWidth, y1]];
      case "west":
        return [[x1, opening.center - halfWidth], [x1, opening.center + halfWidth]];
      case "east":
        return [[x2, opening.center - halfWidth], [x2, opening.center + halfWidth]];
    }
  };

  const createRoomAssembly = (spec: CanonicalRoom): RoomAssembly => {
    const [x1, y1, x2, y2] = spec.bounds;
    const wallSides = resolveRoomWallSides(spec);
    const openings = spec.openings ?? [];
    const wallOptions: WallBoxOptions = {
      north: wallSides.north,
      south: wallSides.south,
      west: wallSides.west,
      east: wallSides.east,
      northOpenings: openings.filter((opening) => opening.side === "north").map((opening) => ({ center: opening.center, width: opening.width })),
      southOpenings: openings.filter((opening) => opening.side === "south").map((opening) => ({ center: opening.center, width: opening.width })),
      westOpenings: openings.filter((opening) => opening.side === "west").map((opening) => ({ center: opening.center, width: opening.width })),
      eastOpenings: openings.filter((opening) => opening.side === "east").map((opening) => ({ center: opening.center, width: opening.width })),
    };

    return {
      room: polygon(spec.id, spec.level, spec.kind, spec.name, x1, y1, x2, y2, {
        subtitle: spec.subtitle,
        department: spec.department,
        searchTokens: spec.searchTokens,
        focusPoint: spec.focusPoint ? point(spec.focusPoint[0], spec.focusPoint[1]) : undefined,
        capacity: spec.capacity,
        equipment: spec.equipment,
        status: spec.status,
      }),
      walls: wallBox(`wall-${spec.id}`, spec.level, x1, y1, x2, y2, 0.22, 3.1, wallOptions),
      doors: openings
        .filter((opening) => opening.kind === "door")
        .map((opening) =>
          lineFeature(`door-${spec.id}-${opening.id}`, spec.level, "door", `${spec.name} Door`, openingCoordinates(spec.bounds, opening)),
        ),
      showLabel: spec.showLabel ?? true,
    };
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

  const roomAssemblies = source.rooms.map((room) => createRoomAssembly(room));
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

  const localRoomCenter = (bounds: LocalRectBounds): Coordinate => [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const routeAnchorPoint = (room: CanonicalRoom): Coordinate => room.focusPoint ?? localRoomCenter(room.bounds);

  const localOpeningBoundaryPoint = (bounds: LocalRectBounds, opening: CanonicalOpening): Coordinate => {
    const [x1, y1, x2, y2] = bounds;

    switch (opening.side) {
      case "north":
        return [opening.center, y2];
      case "south":
        return [opening.center, y1];
      case "west":
        return [x1, opening.center];
      case "east":
        return [x2, opening.center];
    }
  };

  const localPortalPoint = (bounds: LocalRectBounds, opening: CanonicalOpening): Coordinate => {
    const [x1, y1, x2, y2] = bounds;

    switch (opening.side) {
      case "north":
        return [opening.center, y2 - PORTAL_INSET];
      case "south":
        return [opening.center, y1 + PORTAL_INSET];
      case "west":
        return [x1 + PORTAL_INSET, opening.center];
      case "east":
        return [x2 - PORTAL_INSET, opening.center];
    }
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

  const portalSideForPoint = (bounds: LocalRectBounds, coordinate: Coordinate): RoomSide | null => {
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

  const roomTraversalPath = (room: CanonicalRoom, start: Coordinate, end: Coordinate): Coordinate[] => {
    if (room.department === "Circulation") {
      const width = room.bounds[2] - room.bounds[0];
      const height = room.bounds[3] - room.bounds[1];
      const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
      const startSide = portalSideForPoint(room.bounds, start);
      const endSide = portalSideForPoint(room.bounds, end);
      const oppositeSides =
        (startSide === "west" && endSide === "east") ||
        (startSide === "east" && endSide === "west") ||
        (startSide === "north" && endSide === "south") ||
        (startSide === "south" && endSide === "north");

      if (oppositeSides || aspectRatio >= 2) {
        return centerlineRoomPath(start, end, room.bounds);
      }
    }

    return orthogonalRoomPath(start, end, room.bounds);
  };

  const roomContainingPoint = (level: LevelId, localCoordinate: Coordinate): CanonicalRoom | null => {
    for (const room of source.rooms) {
      if (room.level === level && withinBounds(localCoordinate, room.bounds, 0.001)) {
        return room;
      }
    }

    return null;
  };

  const openingPairKey = (room: CanonicalRoom, opening: CanonicalOpening) => {
    const [x, y] = localOpeningBoundaryPoint(room.bounds, opening);
    const axis = opening.side === "north" || opening.side === "south" ? "h" : "v";
    const roomKey = [room.id, opening.connectsTo ?? "unlinked"].sort().join("::");
    return `${room.level}::${roomKey}::${axis}::${x.toFixed(3)}::${y.toFixed(3)}::${opening.width.toFixed(3)}`;
  };

  const reciprocalOpening = (sourceRoom: CanonicalRoom, targetRoom: CanonicalRoom, opening: CanonicalOpening) =>
    (targetRoom.openings ?? []).find(
      (candidate) =>
        candidate.traversable !== false &&
        candidate.connectsTo === sourceRoom.id &&
        candidate.side === oppositeRoomSide(opening.side) &&
        candidate.center === opening.center &&
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
        side: oppositeRoomSide(opening.side),
      };
      const boundaryPoint = localOpeningBoundaryPoint(room.bounds, opening);
      const sourcePortal: DerivedPortalNode = {
        id: autoPortalNodeId(room.id, opening.id),
        roomId: room.id,
        level: room.level,
        point: localPortalPoint(room.bounds, opening),
      };
      const targetPortal: DerivedPortalNode = {
        id: autoPortalNodeId(targetRoom.id, targetOpeningForPortal.id),
        roomId: targetRoom.id,
        level: targetRoom.level,
        point: localPortalPoint(targetRoom.bounds, targetOpeningForPortal),
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
          coordinateDistance(anchor, portal.point),
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
            coordinateDistance(leftPortal.point, rightPortal.point),
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
        coordinateDistance(fromPortal.point, connection.boundaryPoint) + coordinateDistance(connection.boundaryPoint, toPortal.point),
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
        coordinateDistance(poi.point, anchor),
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

      if (!sharesBoundaryOnSide(room.bounds, target.bounds, opening.side)) {
        throw new Error(`Opening ${room.id}:${opening.id} does not touch ${opening.connectsTo} on ${opening.side}.`);
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

    if (!edge.connectorType && !pathIsOrthogonal(edge.path)) {
      throw new Error(`Route edge ${edge.id} contains a diagonal segment.`);
    }
  }

  for (const feature of roomFeatures) {
    feature.properties.routeNodeId = featureRouteNodeIdByFeatureId.get(feature.id);
  }

  for (const feature of poiFeatures) {
    feature.properties.routeNodeId = featureRouteNodeIdByFeatureId.get(feature.id);
  }

  const searchableRooms = source.rooms.filter((room) => room.showLabel !== false && room.department !== "Circulation");
  const searchEntries: SearchEntry[] = [
    ...searchableRooms.map((room) => {
      const level = levelById.get(room.level);
      const roomLabel =
        room.kind === "meeting_room" ? "Meeting room" : room.kind === "amenity" ? "Amenity" : "Room";

      return {
        id: `search-${room.id}`,
        label: room.name,
        description: `${roomLabel} · ${level?.label ?? room.level}`,
        level: room.level,
        featureId: room.id,
        tokens: [...new Set([room.name, room.subtitle, room.department, ...(room.equipment ?? []), ...room.searchTokens].map((token) => token.toLowerCase()))],
      };
    }),
    ...source.pois.map((poi) => ({
      id: `search-${poi.id}`,
      label: poi.employee ?? poi.name,
      description:
        poi.kind === "workstation"
          ? `${poi.name} · ${poi.department ?? "Workspace"}`
          : `${poi.kind === "connector" ? "Connector" : "Amenity"} · ${levelById.get(poi.level)?.label ?? poi.level}`,
      level: poi.level,
      featureId: poi.id,
      tokens: [
        ...new Set(
          [poi.name, poi.subtitle, poi.department, poi.employee, ...poi.searchTokens]
            .filter((token): token is string => Boolean(token))
            .map((token) => token.toLowerCase()),
        ),
      ],
    })),
  ].sort((left, right) => left.label.localeCompare(right.label));

  const routeableRoomFeature = (feature: OfficeFeature) => {
    if (feature.properties.kind !== "room" && feature.properties.kind !== "meeting_room" && feature.properties.kind !== "amenity") {
      return false;
    }

    const room = roomById.get(feature.id);
    return Boolean(room && (room.openings ?? []).some((opening) => opening.traversable !== false && opening.connectsTo));
  };

  const routeTargetLabel = (feature: OfficeFeature) => feature.properties.employee ?? feature.properties.name;
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

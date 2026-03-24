import type {
  Coordinate,
  LevelId,
  LevelMeta,
  OfficeFeature,
  OfficeFeatureCollection,
  OfficeLineFeature,
  OfficeFeatureProperties,
  OfficePointFeature,
  OfficePolygonFeature,
  RouteTarget,
  RoutingEdge,
  RoutingGraph,
  SearchEntry,
} from "../../lib/types";

const origin: [number, number] = [37.61888, 55.75112];
const xStep = 0.000018;
const yStep = 0.00001;

const point = (x: number, y: number): [number, number] => [
  origin[0] + x * xStep,
  origin[1] + y * yStep,
];

const ring = (x1: number, y1: number, x2: number, y2: number): Coordinate[] => [
  point(x1, y1),
  point(x2, y1),
  point(x2, y2),
  point(x1, y2),
  point(x1, y1),
];

const path = (coordinates: Coordinate[]) => coordinates.map(([x, y]) => point(x, y));

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

const polygonFromPoints = (
  id: string,
  level: LevelId,
  kind: OfficeFeatureProperties["kind"],
  name: string,
  coordinates: Coordinate[],
  properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> & {
    focusPoint?: Coordinate;
    searchTokens?: string[];
  } = {},
): OfficePolygonFeature => ({
  id,
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [[...path(coordinates), point(coordinates[0]![0], coordinates[0]![1])]],
  },
  properties: {
    featureId: id,
    level,
    kind,
    name,
    focusPoint: properties.focusPoint ?? point(coordinates[0]![0], coordinates[0]![1]),
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
  id: string,
  level: LevelId,
  kind: OfficeFeatureProperties["kind"],
  name: string,
  x: number,
  y: number,
  properties: Omit<OfficeFeatureProperties, "featureId" | "level" | "kind" | "name" | "focusPoint" | "searchTokens"> & {
    searchTokens?: string[];
  } = {},
): OfficePointFeature => ({
  id,
  type: "Feature",
  geometry: {
    type: "Point",
    coordinates: point(x, y),
  },
  properties: {
    featureId: id,
    level,
    kind,
    name,
    focusPoint: point(x, y),
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

const labelPoint = (
  feature: OfficeFeature,
  id: string = feature.id,
): OfficePointFeature => ({
  id,
  type: "Feature",
  geometry: {
    type: "Point",
    coordinates: feature.properties.focusPoint,
  },
  properties: feature.properties,
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
    focusPoint: properties.focusPoint ?? point(coordinates[0]![0], coordinates[0]![1]),
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
      walls.push(
        polygon(`${idPrefix}-${side}`, level, "wall", `${idPrefix} ${side} Wall`, fromX, yStart, toX, yEnd, {
          baseHeight: 0,
          height,
        }),
      );

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
      walls.push(
        polygon(`${idPrefix}-${side}`, level, "wall", `${idPrefix} ${side} Wall`, xStart, fromY, xEnd, toY, {
          baseHeight: 0,
          height,
        }),
      );

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

export const levels: LevelMeta[] = [
  {
    id: "L1",
    label: "Floor 1",
    order: 1,
    defaultCenter: point(28, 15),
    defaultZoom: 20.6,
  },
  {
    id: "L2",
    label: "Floor 2",
    order: 2,
    defaultCenter: point(28, 15),
    defaultZoom: 20.6,
  },
];

type RoomKind = "room" | "meeting_room" | "amenity";
type RoomSide = "north" | "south" | "west" | "east";
type RectBounds = [number, number, number, number];
type RoomWallSides = Record<RoomSide, boolean>;
type OpeningKind = "door" | "opening";

interface OpeningSpec {
  id: string;
  side: RoomSide;
  center: number;
  width: number;
  kind: OpeningKind;
  traversable?: boolean;
  connectsTo?: string;
}

interface RoomSpec {
  id: string;
  level: LevelId;
  kind: RoomKind;
  name: string;
  bounds: RectBounds;
  subtitle: string;
  department: string;
  routeNodeId: string;
  searchTokens: string[];
  focusPoint?: Coordinate;
  capacity?: number;
  equipment?: string[];
  status?: OfficeFeatureProperties["status"];
  showLabel?: boolean;
  wallSides?: Partial<Record<RoomSide, boolean>>;
  openings?: OpeningSpec[];
}

interface RoomAssembly {
  room: OfficePolygonFeature;
  walls: OfficePolygonFeature[];
  doors: OfficeLineFeature[];
  showLabel: boolean;
}

interface OfficeModel {
  levels: LevelMeta[];
  rooms: RoomSpec[];
  poiFeatures: OfficePointFeature[];
  searchEntries: SearchEntry[];
  routeTargets: RouteTarget[];
  routingGraph: RoutingGraph;
}

interface AuthoredRouteEdge {
  id: string;
  from: string;
  to: string;
  weight: number;
  path: Coordinate[];
  connectorType?: "stairs" | "elevator";
  accessible: boolean;
}

const BUILDING_BOUNDS = {
  west: 2,
  south: 2,
  east: 52,
  north: 28,
};

const circulationRoom = (spec: Omit<RoomSpec, "kind" | "department" | "showLabel">): RoomSpec => ({
  ...spec,
  kind: "room",
  department: "Circulation",
  showLabel: false,
});

const openingCoordinates = (
  bounds: RectBounds,
  opening: OpeningSpec,
): Coordinate[] => {
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

const rangesOverlap = (startA: number, endA: number, startB: number, endB: number) =>
  Math.min(endA, endB) - Math.max(startA, startB) > 0.001;

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

const roomHasOpeningOnSide = (spec: RoomSpec, side: RoomSide) =>
  (spec.openings ?? []).some((opening) => opening.side === side);

const sharesBoundaryOnSide = (specBounds: RectBounds, otherBounds: RectBounds, side: RoomSide) => {
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

const neighboringRooms = (spec: RoomSpec, roomSpecs: RoomSpec[], side: RoomSide) =>
  roomSpecs.filter((other) => other.id !== spec.id && sharesBoundaryOnSide(spec.bounds, other.bounds, side));

const sideTouchesExterior = (bounds: RectBounds, side: RoomSide) => {
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

const resolveRoomWallSides = (
  spec: RoomSpec,
  roomSpecs: RoomSpec[],
): RoomWallSides => {
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

    const neighbors = neighboringRooms(spec, roomSpecs, side);

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

const createRoomAssembly = (spec: RoomSpec, roomSpecs: RoomSpec[]): RoomAssembly => {
  const [x1, y1, x2, y2] = spec.bounds;
  const wallSides = resolveRoomWallSides(spec, roomSpecs);
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
      routeNodeId: spec.routeNodeId,
      searchTokens: spec.searchTokens,
      focusPoint: spec.focusPoint,
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

const routeEdge = (
  id: string,
  from: string,
  to: string,
  weight: number,
  coordinates: Coordinate[],
  options: Pick<AuthoredRouteEdge, "accessible" | "connectorType">,
): RoutingEdge => ({
  id,
  from,
  to,
  weight,
  path: path(coordinates),
  connectorType: options.connectorType,
  accessible: options.accessible,
});

const l1RoomSpecs: RoomSpec[] = [
  {
    id: "room-l1-lobby",
    level: "L1",
    kind: "room",
    name: "Lobby",
    bounds: [2, 2, 10, 8],
    subtitle: "Welcome + reception",
    department: "Operations",
    routeNodeId: "n-l1-lobby",
    searchTokens: ["lobby", "reception", "welcome"],
    wallSides: { north: true, east: true },
    openings: [{ id: "north-entry", side: "north", center: 6, width: 1.6, kind: "door", connectsTo: "room-l1-west-link" }],
  },
  {
    id: "room-l1-reception",
    level: "L1",
    kind: "amenity",
    name: "Reception Desk",
    bounds: [10, 2, 16, 8],
    subtitle: "Visitor check-in",
    department: "Operations",
    routeNodeId: "n-l1-reception",
    searchTokens: ["reception desk", "check-in", "front desk"],
    wallSides: { north: true, east: true },
    openings: [{ id: "north-entry", side: "north", center: 13, width: 1.8, kind: "door", connectsTo: "room-l1-south-spine" }],
  },
  {
    id: "room-l1-booth-a",
    level: "L1",
    kind: "room",
    name: "Phone Booth A",
    bounds: [16, 2, 20, 8],
    subtitle: "Acoustic call booth",
    department: "Shared",
    routeNodeId: "n-l1-wellness",
    searchTokens: ["phone booth a", "booth", "call"],
    wallSides: { north: true, east: true },
    openings: [{ id: "north-entry", side: "north", center: 18, width: 1.2, kind: "door", connectsTo: "room-l1-south-spine" }],
  },
  {
    id: "room-l1-wellness",
    level: "L1",
    kind: "room",
    name: "Wellness Room",
    bounds: [20, 2, 28, 8],
    subtitle: "Quiet reset space",
    department: "Shared",
    routeNodeId: "n-l1-wellness",
    searchTokens: ["wellness room", "quiet room", "reset"],
    wallSides: { north: true, east: true },
    openings: [{ id: "north-entry", side: "north", center: 24, width: 1.8, kind: "door", connectsTo: "room-l1-south-spine" }],
  },
  {
    id: "room-l1-it-bar",
    level: "L1",
    kind: "amenity",
    name: "IT Bar",
    bounds: [28, 2, 38, 8],
    subtitle: "Hardware swaps and support",
    department: "IT",
    routeNodeId: "n-l1-support",
    searchTokens: ["it bar", "support", "hardware"],
    wallSides: { north: true, east: true },
    openings: [{ id: "north-entry", side: "north", center: 33, width: 2, kind: "door", connectsTo: "room-l1-south-spine" }],
  },
  {
    id: "room-l1-kitchen",
    level: "L1",
    kind: "amenity",
    name: "Kitchen",
    bounds: [40, 2, 52, 10],
    subtitle: "Coffee point and snacks",
    department: "Shared",
    routeNodeId: "n-l1-kitchen",
    searchTokens: ["kitchen", "coffee", "snacks"],
    wallSides: { north: true, west: true },
    openings: [{ id: "north-entry", side: "north", center: 46, width: 2.2, kind: "door", connectsTo: "room-l1-east-link" }],
  },
  {
    id: "room-l1-service-core",
    level: "L1",
    kind: "room",
    name: "Service Core",
    bounds: [38, 2, 40, 10],
    subtitle: "Storage and building services",
    department: "Operations",
    routeNodeId: "n-l1-support",
    searchTokens: ["service core", "storage", "building services"],
    showLabel: false,
    wallSides: { north: true },
  },
  {
    id: "room-l1-ocean",
    level: "L1",
    kind: "meeting_room",
    name: "Ocean Room",
    bounds: [2, 14, 12, 22],
    subtitle: "10 seats, video conferencing",
    department: "Shared",
    routeNodeId: "n-l1-ocean",
    searchTokens: ["ocean room", "meeting", "room 1.2"],
    capacity: 10,
    equipment: ["VC", "Whiteboard"],
    status: "occupied",
    wallSides: { south: true, east: true },
    openings: [{ id: "east-entry", side: "east", center: 18, width: 1.8, kind: "door", connectsTo: "room-l1-corridor-west" }],
  },
  {
    id: "room-l1-harbor",
    level: "L1",
    kind: "meeting_room",
    name: "Harbor Room",
    bounds: [2, 22, 12, 28],
    subtitle: "6 seats, partner calls",
    department: "Shared",
    routeNodeId: "n-l1-harbor",
    searchTokens: ["harbor room", "meeting", "partner calls"],
    capacity: 6,
    equipment: ["Display", "Speakerphone"],
    status: "available",
    wallSides: { east: true },
    openings: [{ id: "east-entry", side: "east", center: 25, width: 1.8, kind: "door", connectsTo: "room-l1-corridor-west" }],
  },
  circulationRoom({
    id: "room-l1-west-link",
    level: "L1",
    name: "West Link",
    bounds: [2, 8, 12, 14],
    subtitle: "West-side circulation link",
    routeNodeId: "n-l1-west-hall",
    searchTokens: ["west link", "circulation"],
    openings: [{ id: "east-pass", side: "east", center: 9, width: 1.8, kind: "opening", connectsTo: "room-l1-south-spine" }],
  }),
  circulationRoom({
    id: "room-l1-south-spine",
    level: "L1",
    name: "South Spine",
    bounds: [12, 8, 38, 10],
    subtitle: "South circulation spine",
    routeNodeId: "n-l1-core",
    searchTokens: ["south spine", "circulation"],
    openings: [
      { id: "west-pass", side: "west", center: 9, width: 1.8, kind: "opening", connectsTo: "room-l1-west-link" },
      { id: "north-pass", side: "north", center: 26, width: 3.6, kind: "opening", connectsTo: "zone-l1-corridor" },
    ],
  }),
  {
    id: "zone-l1-corridor",
    level: "L1",
    kind: "room",
    name: "Central Spine",
    bounds: [12, 10, 38, 14],
    subtitle: "Primary route corridor",
    department: "Circulation",
    routeNodeId: "n-l1-core",
    searchTokens: ["corridor", "spine", "hall"],
    focusPoint: point(25, 12),
    showLabel: false,
    openings: [
      { id: "south-pass", side: "south", center: 26, width: 3.6, kind: "opening", connectsTo: "room-l1-south-spine" },
      { id: "east-pass", side: "east", center: 12, width: 3.2, kind: "opening", connectsTo: "room-l1-east-link" },
    ],
  },
  circulationRoom({
    id: "room-l1-corridor-west",
    level: "L1",
    name: "West Corridor",
    bounds: [12, 14, 14, 28],
    subtitle: "West circulation link",
    routeNodeId: "n-l1-west-hall",
    searchTokens: ["west corridor", "circulation"],
    openings: [{ id: "south-pass", side: "south", center: 13, width: 1.6, kind: "opening", connectsTo: "zone-l1-corridor" }],
  }),
  circulationRoom({
    id: "room-l1-corridor-east",
    level: "L1",
    name: "East Corridor",
    bounds: [38, 14, 40, 28],
    subtitle: "East circulation link",
    routeNodeId: "n-l1-ops",
    searchTokens: ["east corridor", "circulation"],
    openings: [{ id: "south-pass", side: "south", center: 39, width: 1.6, kind: "opening", connectsTo: "room-l1-east-link" }],
  }),
  {
    id: "zone-l1-engineering-north",
    level: "L1",
    kind: "room",
    name: "Engineering North",
    bounds: [14, 14, 30, 22],
    subtitle: "Backend + Platform",
    department: "Engineering",
    routeNodeId: "n-l1-eng-north",
    searchTokens: ["engineering north", "backend", "platform"],
    wallSides: { south: true, west: true, east: true },
    openings: [{ id: "south-opening", side: "south", center: 22, width: 7.2, kind: "opening", connectsTo: "zone-l1-corridor" }],
  },
  {
    id: "zone-l1-engineering-south",
    level: "L1",
    kind: "room",
    name: "Engineering South",
    bounds: [14, 22, 30, 28],
    subtitle: "Developer experience and SRE",
    department: "Engineering",
    routeNodeId: "n-l1-eng-south",
    searchTokens: ["engineering south", "sre", "developer experience"],
    wallSides: { south: true, west: true, east: true },
  },
  {
    id: "zone-l1-operations",
    level: "L1",
    kind: "room",
    name: "Operations Bay",
    bounds: [30, 14, 38, 28],
    subtitle: "People Ops + Finance",
    department: "Operations",
    routeNodeId: "n-l1-ops",
    searchTokens: ["operations bay", "finance", "people ops"],
    wallSides: { south: true, west: true, east: true },
    openings: [{ id: "south-opening", side: "south", center: 34, width: 4.8, kind: "opening", connectsTo: "zone-l1-corridor" }],
  },
  circulationRoom({
    id: "room-l1-east-link",
    level: "L1",
    name: "East Link",
    bounds: [38, 10, 52, 14],
    subtitle: "East-side circulation link",
    routeNodeId: "n-l1-kitchen",
    searchTokens: ["east link", "circulation"],
    openings: [
      { id: "west-pass", side: "west", center: 12, width: 3.2, kind: "opening", connectsTo: "zone-l1-corridor" },
      { id: "north-pass", side: "north", center: 39, width: 1.6, kind: "opening", connectsTo: "room-l1-corridor-east" },
    ],
  }),
  {
    id: "room-l1-huddle",
    level: "L1",
    kind: "meeting_room",
    name: "Huddle 1",
    bounds: [40, 14, 52, 22],
    subtitle: "4 seats, quick syncs",
    department: "Shared",
    routeNodeId: "n-l1-huddle",
    searchTokens: ["huddle 1", "small meeting"],
    capacity: 4,
    equipment: ["Display"],
    status: "available",
    wallSides: { south: true, west: true },
    openings: [{ id: "west-entry", side: "west", center: 18, width: 1.8, kind: "door", connectsTo: "room-l1-corridor-east" }],
  },
  {
    id: "room-l1-summit",
    level: "L1",
    kind: "meeting_room",
    name: "Summit Room",
    bounds: [40, 22, 52, 28],
    subtitle: "12 seats, board setup",
    department: "Shared",
    routeNodeId: "n-l1-summit",
    searchTokens: ["summit room", "board room", "large meeting"],
    capacity: 12,
    equipment: ["VC", "Whiteboard", "Ceiling Mic"],
    status: "offline",
    wallSides: { west: true },
    openings: [{ id: "west-entry", side: "west", center: 25, width: 1.8, kind: "door", connectsTo: "room-l1-corridor-east" }],
  },
];

const l2RoomSpecs: RoomSpec[] = [
  circulationRoom({
    id: "room-l2-west-suite",
    level: "L2",
    name: "West Suite",
    bounds: [2, 2, 14, 8],
    subtitle: "Quiet touchdown zone",
    routeNodeId: "n-l2-west-hall",
    searchTokens: ["west suite", "touchdown", "quiet"],
    openings: [{ id: "north-entry", side: "north", center: 8, width: 2.2, kind: "door", connectsTo: "room-l2-west-link" }],
  }),
  {
    id: "room-l2-war-room",
    level: "L2",
    kind: "room",
    name: "War Room",
    bounds: [14, 2, 22, 8],
    subtitle: "Incident coordination",
    department: "Engineering",
    routeNodeId: "n-l2-war-room",
    searchTokens: ["war room", "incident", "coordination"],
    wallSides: { north: true, west: true },
    openings: [{ id: "north-entry", side: "north", center: 18, width: 1.8, kind: "door", connectsTo: "room-l2-south-spine" }],
  },
  {
    id: "room-l2-library",
    level: "L2",
    kind: "room",
    name: "Library",
    bounds: [22, 2, 30, 8],
    subtitle: "Reference library and quiet reading",
    department: "Shared",
    routeNodeId: "n-l2-library",
    searchTokens: ["library", "reading", "quiet"],
    wallSides: { north: true, east: true },
    openings: [{ id: "north-entry", side: "north", center: 26, width: 1.8, kind: "door", connectsTo: "room-l2-south-spine" }],
  },
  {
    id: "room-l2-pods",
    level: "L2",
    kind: "room",
    name: "Focus Pods",
    bounds: [40, 2, 52, 10],
    subtitle: "Quiet calls and deep work",
    department: "Shared",
    routeNodeId: "n-l2-pods",
    searchTokens: ["focus pods", "quiet", "deep work"],
    status: "focus",
    wallSides: { north: true, west: true },
    openings: [{ id: "north-entry", side: "north", center: 46, width: 2.2, kind: "door", connectsTo: "room-l2-east-link" }],
  },
  {
    id: "room-l2-service-core",
    level: "L2",
    kind: "room",
    name: "Support Core",
    bounds: [30, 2, 40, 10],
    subtitle: "IT storage, lockers, and service chase",
    department: "Operations",
    routeNodeId: "n-l2-core",
    searchTokens: ["support core", "storage", "service chase"],
    showLabel: false,
    wallSides: { north: true },
  },
  {
    id: "room-l2-cedar",
    level: "L2",
    kind: "meeting_room",
    name: "Cedar Room",
    bounds: [2, 14, 12, 22],
    subtitle: "8 seats, townhall overflow",
    department: "Shared",
    routeNodeId: "n-l2-cedar",
    searchTokens: ["cedar room", "meeting", "room 2.2"],
    capacity: 8,
    equipment: ["Display", "Speakerphone"],
    status: "available",
    wallSides: { south: true, east: true },
    openings: [{ id: "east-entry", side: "east", center: 18, width: 1.8, kind: "door", connectsTo: "room-l2-corridor-west" }],
  },
  {
    id: "room-l2-birch",
    level: "L2",
    kind: "meeting_room",
    name: "Birch Room",
    bounds: [2, 22, 12, 28],
    subtitle: "5 seats, sprint reviews",
    department: "Shared",
    routeNodeId: "n-l2-birch",
    searchTokens: ["birch room", "meeting", "sprint review"],
    capacity: 5,
    equipment: ["Display"],
    status: "occupied",
    wallSides: { east: true },
    openings: [{ id: "east-entry", side: "east", center: 25, width: 1.8, kind: "door", connectsTo: "room-l2-corridor-west" }],
  },
  circulationRoom({
    id: "room-l2-west-link",
    level: "L2",
    name: "West Link",
    bounds: [2, 8, 12, 14],
    subtitle: "West-side circulation link",
    routeNodeId: "n-l2-west-hall",
    searchTokens: ["west link", "circulation"],
    openings: [{ id: "east-pass", side: "east", center: 9, width: 1.8, kind: "opening", connectsTo: "room-l2-south-spine" }],
  }),
  circulationRoom({
    id: "room-l2-south-spine",
    level: "L2",
    name: "South Spine",
    bounds: [12, 8, 30, 10],
    subtitle: "South circulation spine",
    routeNodeId: "n-l2-core",
    searchTokens: ["south spine", "circulation"],
    openings: [
      { id: "west-pass", side: "west", center: 9, width: 1.8, kind: "opening", connectsTo: "room-l2-west-link" },
      { id: "north-pass", side: "north", center: 26, width: 3.6, kind: "opening", connectsTo: "zone-l2-corridor" },
    ],
  }),
  {
    id: "zone-l2-corridor",
    level: "L2",
    kind: "room",
    name: "North Spine",
    bounds: [12, 10, 38, 14],
    subtitle: "Primary route corridor",
    department: "Circulation",
    routeNodeId: "n-l2-core",
    searchTokens: ["corridor", "spine", "hall"],
    focusPoint: point(25, 12),
    showLabel: false,
    openings: [
      { id: "south-pass", side: "south", center: 26, width: 3.6, kind: "opening", connectsTo: "room-l2-south-spine" },
      { id: "east-pass", side: "east", center: 12, width: 3.2, kind: "opening", connectsTo: "room-l2-east-link" },
    ],
  },
  circulationRoom({
    id: "room-l2-corridor-west",
    level: "L2",
    name: "West Corridor",
    bounds: [12, 14, 14, 28],
    subtitle: "West circulation link",
    routeNodeId: "n-l2-west-hall",
    searchTokens: ["west corridor", "circulation"],
    openings: [{ id: "south-pass", side: "south", center: 13, width: 1.6, kind: "opening", connectsTo: "zone-l2-corridor" }],
  }),
  circulationRoom({
    id: "room-l2-corridor-east",
    level: "L2",
    name: "East Corridor",
    bounds: [38, 14, 40, 28],
    subtitle: "East circulation link",
    routeNodeId: "n-l2-design",
    searchTokens: ["east corridor", "circulation"],
    openings: [{ id: "south-pass", side: "south", center: 39, width: 1.6, kind: "opening", connectsTo: "room-l2-east-link" }],
  }),
  {
    id: "zone-l2-product",
    level: "L2",
    kind: "room",
    name: "Product Studio",
    bounds: [14, 14, 30, 24],
    subtitle: "Product + Research",
    department: "Product",
    routeNodeId: "n-l2-product",
    searchTokens: ["product studio", "product", "research"],
    wallSides: { south: true, west: true },
    openings: [{ id: "south-opening", side: "south", center: 22, width: 7.2, kind: "opening", connectsTo: "zone-l2-corridor" }],
  },
  {
    id: "zone-l2-design",
    level: "L2",
    kind: "room",
    name: "Design Bay",
    bounds: [30, 14, 38, 24],
    subtitle: "Design systems + prototyping",
    department: "Design",
    routeNodeId: "n-l2-design",
    searchTokens: ["design bay", "design systems", "prototyping"],
    wallSides: { south: true, west: true, east: true },
    openings: [{ id: "south-opening", side: "south", center: 34, width: 4.8, kind: "opening", connectsTo: "zone-l2-corridor" }],
  },
  {
    id: "zone-l2-touchdown",
    level: "L2",
    kind: "room",
    name: "Touchdown Area",
    bounds: [14, 24, 38, 28],
    subtitle: "Flexible hot desks for visitors",
    department: "Shared",
    routeNodeId: "n-l2-touchdown",
    searchTokens: ["touchdown area", "hot desk", "visitors"],
    wallSides: { south: true },
  },
  circulationRoom({
    id: "room-l2-east-link",
    level: "L2",
    name: "East Link",
    bounds: [38, 10, 52, 14],
    subtitle: "East-side circulation link",
    routeNodeId: "n-l2-pods",
    searchTokens: ["east link", "circulation"],
    openings: [
      { id: "west-pass", side: "west", center: 12, width: 3.2, kind: "opening", connectsTo: "zone-l2-corridor" },
      { id: "north-pass", side: "north", center: 39, width: 1.6, kind: "opening", connectsTo: "room-l2-corridor-east" },
    ],
  }),
  {
    id: "room-l2-lounge",
    level: "L2",
    kind: "amenity",
    name: "Lounge",
    bounds: [40, 14, 52, 22],
    subtitle: "Informal collaboration",
    department: "Shared",
    routeNodeId: "n-l2-lounge",
    searchTokens: ["lounge", "informal", "collaboration"],
    wallSides: { south: true, west: true },
    openings: [{ id: "west-entry", side: "west", center: 18, width: 1.8, kind: "door", connectsTo: "room-l2-corridor-east" }],
  },
  {
    id: "room-l2-maker",
    level: "L2",
    kind: "amenity",
    name: "Maker Bench",
    bounds: [40, 22, 52, 28],
    subtitle: "Prototyping and testing",
    department: "Design",
    routeNodeId: "n-l2-maker",
    searchTokens: ["maker bench", "prototype", "testing"],
    wallSides: { west: true },
    openings: [{ id: "west-entry", side: "west", center: 25, width: 1.8, kind: "door", connectsTo: "room-l2-corridor-east" }],
  },
];

const allRoomSpecs = [...l1RoomSpecs, ...l2RoomSpecs];
const roomAssemblies = allRoomSpecs.map((spec) => createRoomAssembly(spec, allRoomSpecs));
const roomFeatures: OfficePolygonFeature[] = roomAssemblies.map((assembly) => assembly.room);
const roomWallFeatures: OfficePolygonFeature[] = roomAssemblies.flatMap((assembly) => assembly.walls);
const roomLabelIds = new Set(roomAssemblies.filter((assembly) => assembly.showLabel).map((assembly) => assembly.room.id));

const structureFeatures: OfficePolygonFeature[] = [
  ...roomWallFeatures,
  ...wallBox("wall-l1-elevator-core", "L1", 40.7, 22.35, 43.8, 26.35, 0.18, 3.3, {
    westOpenings: [{ center: 24.3, width: 1.2 }],
  }),
  ...wallBox("wall-l2-elevator-core", "L2", 40.7, 22.35, 43.8, 26.35, 0.18, 3.3, {
    westOpenings: [{ center: 24.3, width: 1.2 }],
  }),
  polygon("furniture-l1-table-ocean", "L1", "furniture", "Ocean Table", 4.6, 16.8, 9.4, 19.6, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-desk-cluster-a", "L1", "furniture", "Desk Cluster A", 18, 18, 26, 21.5, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-desk-cluster-b", "L1", "furniture", "Desk Cluster B", 26.8, 20.2, 34.2, 23.8, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-ops-desks", "L1", "furniture", "Ops Desks", 31.4, 18.5, 36.4, 24.8, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-kitchen-island", "L1", "furniture", "Kitchen Island", 43.2, 4.6, 48.2, 7.6, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-elevator-cabin", "L1", "furniture", "Elevator Cabin", 41.15, 22.9, 43.15, 25.55, {
    department: "Vertical circulation",
    baseHeight: 0,
    height: 2.45,
  }),
  polygon("furniture-l1-elevator-panel", "L1", "furniture", "Elevator Panel", 43.2, 23.15, 43.45, 25.25, {
    department: "Vertical circulation",
    baseHeight: 0.4,
    height: 1.55,
  }),
  polygon("furniture-l1-stairs-landing", "L1", "furniture", "Stairs Landing", 47.35, 22.7, 50.95, 23.2, {
    department: "Vertical circulation",
    baseHeight: 0,
    height: 0.26,
  }),
  polygon("furniture-l1-stairs-top", "L1", "furniture", "Stairs Upper Landing", 47.75, 25.9, 50.55, 26.2, {
    department: "Vertical circulation",
    baseHeight: 2.86,
    height: 2.98,
  }),
  ...stairRun("furniture-l1-stairs", "L1", 47.55, 23.3, 50.75, 26, 9),
  polygon("furniture-l2-table-cedar", "L2", "furniture", "Cedar Table", 4.6, 16.8, 9.4, 19.6, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l2-soft-seating-a", "L2", "furniture", "Soft Seating A", 42.4, 16.2, 46.4, 18.7, { baseHeight: 0, height: 0.98 }),
  polygon("furniture-l2-soft-seating-b", "L2", "furniture", "Soft Seating B", 46.9, 17, 49.4, 19.4, { baseHeight: 0, height: 0.98 }),
  polygon("furniture-l2-product-wall", "L2", "furniture", "Product Wall", 24.4, 15, 25.1, 22.4, { baseHeight: 0, height: 1.35 }),
  polygon("furniture-l2-maker-bench", "L2", "furniture", "Maker Bench", 43.6, 24.4, 48.4, 26.6, { baseHeight: 0, height: 1 }),
  polygon("furniture-l2-elevator-cabin", "L2", "furniture", "Elevator Cabin", 41.15, 22.9, 43.15, 25.55, {
    department: "Vertical circulation",
    baseHeight: 0,
    height: 2.45,
  }),
  polygon("furniture-l2-elevator-panel", "L2", "furniture", "Elevator Panel", 43.2, 23.15, 43.45, 25.25, {
    department: "Vertical circulation",
    baseHeight: 0.4,
    height: 1.55,
  }),
  polygon("furniture-l2-stairs-landing", "L2", "furniture", "Stairs Landing", 47.35, 22.7, 50.95, 23.2, {
    department: "Vertical circulation",
    baseHeight: 0,
    height: 0.26,
  }),
  polygon("furniture-l2-stairs-top", "L2", "furniture", "Stairs Upper Landing", 47.75, 25.9, 50.55, 26.2, {
    department: "Vertical circulation",
    baseHeight: 2.86,
    height: 2.98,
  }),
  ...stairRun("furniture-l2-stairs", "L2", 47.55, 23.3, 50.75, 26, 9),
];

const doorFeatures: OfficeLineFeature[] = [
  ...roomAssemblies.flatMap((assembly) => assembly.doors),
  lineFeature("door-l1-elevator", "L1", "door", "Elevator Cabin Door", [[40.7, 23.65], [40.7, 24.95]]),
  lineFeature("door-l2-elevator", "L2", "door", "Elevator Cabin Door", [[40.7, 23.65], [40.7, 24.95]]),
];

const poiFeatures: OfficePointFeature[] = [
  marker("desk-l1-alex", "L1", "workstation", "Desk A-14", 22, 20, {
    subtitle: "Alex Petrov",
    employee: "Alex Petrov",
    department: "Engineering",
    routeNodeId: "n-l1-eng-north",
    searchTokens: ["alex petrov", "desk a-14", "backend"],
  }),
  marker("desk-l1-maria", "L1", "workstation", "Desk A-18", 30, 22, {
    subtitle: "Maria Volkova",
    employee: "Maria Volkova",
    department: "Engineering",
    routeNodeId: "n-l1-eng-north",
    searchTokens: ["maria volkova", "desk a-18", "platform"],
  }),
  marker("desk-l1-pavel", "L1", "workstation", "Desk O-03", 33, 24, {
    subtitle: "Pavel Smirnov",
    employee: "Pavel Smirnov",
    department: "Operations",
    routeNodeId: "n-l1-ops",
    searchTokens: ["pavel smirnov", "desk o-03", "finance"],
  }),
  marker("desk-l1-nina", "L1", "workstation", "Desk O-06", 35, 20, {
    subtitle: "Nina Pavlova",
    employee: "Nina Pavlova",
    department: "Operations",
    routeNodeId: "n-l1-ops",
    searchTokens: ["nina pavlova", "desk o-06", "people ops"],
  }),
  marker("desk-l2-anna", "L2", "workstation", "Desk P-04", 20, 20, {
    subtitle: "Anna Sidorova",
    employee: "Anna Sidorova",
    department: "Product",
    routeNodeId: "n-l2-product",
    searchTokens: ["anna sidorova", "desk p-04", "product"],
  }),
  marker("desk-l2-ivan", "L2", "workstation", "Desk P-09", 30, 22, {
    subtitle: "Ivan Orlov",
    employee: "Ivan Orlov",
    department: "Design",
    routeNodeId: "n-l2-design",
    searchTokens: ["ivan orlov", "desk p-09", "design"],
  }),
  marker("desk-l2-olga", "L2", "workstation", "Desk P-12", 24, 18, {
    subtitle: "Olga Voronina",
    employee: "Olga Voronina",
    department: "Product",
    routeNodeId: "n-l2-product",
    searchTokens: ["olga voronina", "desk p-12", "research"],
  }),
  marker("desk-l2-denis", "L2", "workstation", "Desk D-02", 34, 20, {
    subtitle: "Denis Lebedev",
    employee: "Denis Lebedev",
    department: "Design",
    routeNodeId: "n-l2-design",
    searchTokens: ["denis lebedev", "desk d-02", "design systems"],
  }),
  marker("poi-l1-printer", "L1", "amenity", "Printer Hub", 38, 12, {
    subtitle: "Print and scan point",
    routeNodeId: "n-l1-core",
    searchTokens: ["printer hub", "print", "scan"],
  }),
  marker("poi-l2-lockers", "L2", "amenity", "Visitor Lockers", 30, 26, {
    subtitle: "Touchdown storage",
    routeNodeId: "n-l2-touchdown",
    searchTokens: ["visitor lockers", "lockers", "storage"],
  }),
  marker("connector-l1-stairs", "L1", "connector", "Stairs", 49.2, 24.2, {
    subtitle: "North stair core",
    routeNodeId: "n-l1-stairs",
    searchTokens: ["stairs", "stair core"],
  }),
  marker("connector-l2-stairs", "L2", "connector", "Stairs", 49.2, 24.2, {
    subtitle: "North stair core",
    routeNodeId: "n-l2-stairs",
    searchTokens: ["stairs", "stair core"],
  }),
  marker("connector-l1-elevator", "L1", "connector", "Elevator", 42.15, 24.2, {
    subtitle: "Accessible vertical core",
    routeNodeId: "n-l1-elevator",
    searchTokens: ["elevator", "lift", "accessible"],
  }),
  marker("connector-l2-elevator", "L2", "connector", "Elevator", 42.15, 24.2, {
    subtitle: "Accessible vertical core",
    routeNodeId: "n-l2-elevator",
    searchTokens: ["elevator", "lift", "accessible"],
  }),
];

export const spacesCollection: OfficeFeatureCollection = {
  type: "FeatureCollection",
  features: roomFeatures,
};

export const structuresCollection: OfficeFeatureCollection = {
  type: "FeatureCollection",
  features: [...structureFeatures, ...doorFeatures],
};

export const poiCollection: OfficeFeatureCollection = {
  type: "FeatureCollection",
  features: poiFeatures,
};

export const roomLabelCollection: OfficeFeatureCollection = {
  type: "FeatureCollection",
  features: roomFeatures
    .filter((feature) => roomLabelIds.has(feature.id))
    .map((feature) => labelPoint(feature)),
};

export const poiLabelCollection: OfficeFeatureCollection = {
  type: "FeatureCollection",
  features: poiFeatures
    .filter((feature) => feature.properties.kind === "workstation" || feature.properties.kind === "connector")
    .map((feature) => labelPoint(feature)),
};

export const allFeatures = [...roomFeatures, ...structureFeatures, ...doorFeatures, ...poiFeatures] satisfies OfficeFeature[];

export const featureById = new Map(allFeatures.map((feature) => [feature.id, feature]));
type FeatureSourceId = "spaces" | "structures" | "pois";
type FeatureLabelSourceId = "room-label-points" | "poi-label-points";

const featureSourceEntries: Array<[string, FeatureSourceId]> = [
  ...roomFeatures.map((feature): [string, FeatureSourceId] => [feature.id, "spaces"]),
  ...structureFeatures.map((feature): [string, FeatureSourceId] => [feature.id, "structures"]),
  ...poiFeatures.map((feature): [string, FeatureSourceId] => [feature.id, "pois"]),
];

const featureLabelSourceEntries: Array<[string, FeatureLabelSourceId]> = [
  ...roomFeatures
    .filter((feature) => roomLabelIds.has(feature.id))
    .map((feature): [string, FeatureLabelSourceId] => [feature.id, "room-label-points"]),
  ...poiFeatures
    .filter((feature) => feature.properties.kind === "workstation" || feature.properties.kind === "connector")
    .map((feature): [string, FeatureLabelSourceId] => [feature.id, "poi-label-points"]),
];

export const featureSourceById = new Map<string, FeatureSourceId>(featureSourceEntries);
export const featureLabelSourceById = new Map<string, FeatureLabelSourceId>(featureLabelSourceEntries);

export const selectableSpaceFeatures: OfficePolygonFeature[] = roomFeatures.filter(
  (feature) =>
    feature.properties.kind === "room" ||
    feature.properties.kind === "meeting_room" ||
    feature.properties.kind === "amenity",
);

export const statusRoomIds: readonly string[] = allRoomSpecs
  .filter((spec) => spec.status !== undefined)
  .map((spec) => spec.id);

const searchEntryData: SearchEntry[] = [
  {
    id: "search-ocean-room",
    label: "Ocean Room",
    description: "Meeting room · Floor 1",
    level: "L1",
    featureId: "room-l1-ocean",
    tokens: ["ocean", "meeting room", "room 1.2", "conference"],
  },
  {
    id: "search-harbor-room",
    label: "Harbor Room",
    description: "Meeting room · Floor 1",
    level: "L1",
    featureId: "room-l1-harbor",
    tokens: ["harbor", "meeting room", "partner calls"],
  },
  {
    id: "search-cedar-room",
    label: "Cedar Room",
    description: "Meeting room · Floor 2",
    level: "L2",
    featureId: "room-l2-cedar",
    tokens: ["cedar", "meeting room", "room 2.2", "conference"],
  },
  {
    id: "search-birch-room",
    label: "Birch Room",
    description: "Meeting room · Floor 2",
    level: "L2",
    featureId: "room-l2-birch",
    tokens: ["birch", "meeting room", "sprint review"],
  },
  {
    id: "search-kitchen",
    label: "Kitchen",
    description: "Amenity · Floor 1",
    level: "L1",
    featureId: "room-l1-kitchen",
    tokens: ["kitchen", "coffee", "snacks"],
  },
  {
    id: "search-summit",
    label: "Summit Room",
    description: "Board room · Floor 1",
    level: "L1",
    featureId: "room-l1-summit",
    tokens: ["summit room", "board room", "large meeting"],
  },
  {
    id: "search-focus-pods",
    label: "Focus Pods",
    description: "Quiet room · Floor 2",
    level: "L2",
    featureId: "room-l2-pods",
    tokens: ["focus pods", "quiet", "deep work"],
  },
  {
    id: "search-alex",
    label: "Alex Petrov",
    description: "Desk A-14 · Engineering",
    level: "L1",
    featureId: "desk-l1-alex",
    tokens: ["alex petrov", "desk a-14", "backend"],
  },
  {
    id: "search-maria",
    label: "Maria Volkova",
    description: "Desk A-18 · Engineering",
    level: "L1",
    featureId: "desk-l1-maria",
    tokens: ["maria volkova", "desk a-18", "platform"],
  },
  {
    id: "search-anna",
    label: "Anna Sidorova",
    description: "Desk P-04 · Product",
    level: "L2",
    featureId: "desk-l2-anna",
    tokens: ["anna sidorova", "desk p-04", "product"],
  },
  {
    id: "search-ivan",
    label: "Ivan Orlov",
    description: "Desk P-09 · Design",
    level: "L2",
    featureId: "desk-l2-ivan",
    tokens: ["ivan orlov", "desk p-09", "design"],
  },
  {
    id: "search-pavel",
    label: "Pavel Smirnov",
    description: "Desk O-03 · Operations",
    level: "L1",
    featureId: "desk-l1-pavel",
    tokens: ["pavel smirnov", "desk o-03", "finance"],
  },
  {
    id: "search-olga",
    label: "Olga Voronina",
    description: "Desk P-12 · Product",
    level: "L2",
    featureId: "desk-l2-olga",
    tokens: ["olga voronina", "desk p-12", "research"],
  },
];

const roomSpecById = new Map(allRoomSpecs.map((spec) => [spec.id, spec]));
const levelRankById = new Map(levels.map((level) => [level.id, level.order]));

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

const roomAnchorNodeId = (roomId: string) => `node-room-${roomId}`;
const poiNodeId = (featureId: string) => `node-poi-${featureId}`;
const autoPortalNodeId = (roomId: string, openingId: string) => `node-portal-${roomId}-${openingId}`;
const derivedTargetId = (featureId: string) => `target-${featureId}`;
const PORTAL_INSET = 0.45;

const localPoint = (x: number, y: number): Coordinate => [x, y];

const mapCoordinateToGrid = (coordinate: Coordinate): Coordinate => [
  (coordinate[0] - origin[0]) / xStep,
  (coordinate[1] - origin[1]) / yStep,
];

const localRoomCenter = (bounds: RectBounds): Coordinate => localPoint((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);

const routeAnchorPoint = (spec: RoomSpec): Coordinate => (spec.focusPoint ? mapCoordinateToGrid(spec.focusPoint) : localRoomCenter(spec.bounds));

const localOpeningBoundaryPoint = (bounds: RectBounds, opening: OpeningSpec): Coordinate => {
  const [x1, y1, x2, y2] = bounds;

  switch (opening.side) {
    case "north":
      return localPoint(opening.center, y2);
    case "south":
      return localPoint(opening.center, y1);
    case "west":
      return localPoint(x1, opening.center);
    case "east":
      return localPoint(x2, opening.center);
  }
};

const localPortalPoint = (bounds: RectBounds, opening: OpeningSpec, inset = PORTAL_INSET): Coordinate => {
  const [x1, y1, x2, y2] = bounds;

  switch (opening.side) {
    case "north":
      return localPoint(opening.center, y2 - inset);
    case "south":
      return localPoint(opening.center, y1 + inset);
    case "west":
      return localPoint(x1 + inset, opening.center);
    case "east":
      return localPoint(x2 - inset, opening.center);
  }
};

const withinBounds = (coordinate: Coordinate, bounds: RectBounds, padding = 0) =>
  coordinate[0] >= bounds[0] - padding &&
  coordinate[0] <= bounds[2] + padding &&
  coordinate[1] >= bounds[1] - padding &&
  coordinate[1] <= bounds[3] + padding;

const clampToBounds = (coordinate: Coordinate, bounds: RectBounds, inset = 0.2): Coordinate => [
  Math.min(Math.max(coordinate[0], bounds[0] + inset), bounds[2] - inset),
  Math.min(Math.max(coordinate[1], bounds[1] + inset), bounds[3] - inset),
];

const manhattanDistance = (start: Coordinate, end: Coordinate) => Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);

const orthogonalRoomPath = (start: Coordinate, end: Coordinate, bounds: RectBounds): Coordinate[] => {
  if (start[0] === end[0] || start[1] === end[1]) {
    return [start, end];
  }

  const horizontalFirst = localPoint(end[0], start[1]);
  const verticalFirst = localPoint(start[0], end[1]);

  if (withinBounds(horizontalFirst, bounds, 0.001)) {
    return [start, horizontalFirst, end];
  }

  if (withinBounds(verticalFirst, bounds, 0.001)) {
    return [start, verticalFirst, end];
  }

  const startClamp = clampToBounds(start, bounds);
  const endClamp = clampToBounds(end, bounds);
  const pivot = localPoint(endClamp[0], startClamp[1]);

  return [startClamp, pivot, endClamp];
};

const coordinatesMatch = (left: Coordinate, right: Coordinate) => left[0] === right[0] && left[1] === right[1];

const appendRoomPathPoint = (target: Coordinate[], coordinate: Coordinate) => {
  const lastCoordinate = target.at(-1);

  if (lastCoordinate && coordinatesMatch(lastCoordinate, coordinate)) {
    return;
  }

  target.push(coordinate);
};

const centerlineRoomPath = (start: Coordinate, end: Coordinate, bounds: RectBounds): Coordinate[] => {
  const center = localRoomCenter(bounds);
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];
  const points: Coordinate[] = [];

  appendRoomPathPoint(points, start);

  if (width >= height) {
    appendRoomPathPoint(points, localPoint(start[0], center[1]));
    appendRoomPathPoint(points, localPoint(end[0], center[1]));
  } else {
    appendRoomPathPoint(points, localPoint(center[0], start[1]));
    appendRoomPathPoint(points, localPoint(center[0], end[1]));
  }

  appendRoomPathPoint(points, end);

  return points;
};

const roomTraversalPath = (spec: RoomSpec, start: Coordinate, end: Coordinate): Coordinate[] => {
  if (spec.department === "Circulation") {
    return centerlineRoomPath(start, end, spec.bounds);
  }

  return orthogonalRoomPath(start, end, spec.bounds);
};

const officePointCoordinate = (feature: OfficePointFeature): Coordinate => {
  const longitude = feature.geometry.coordinates[0];
  const latitude = feature.geometry.coordinates[1];

  if (longitude === undefined || latitude === undefined) {
    throw new Error(`Point feature ${feature.id} is missing coordinates.`);
  }

  return [longitude, latitude];
};

const roomContainingCoordinate = (level: LevelId, coordinate: Coordinate): RoomSpec | null => {
  const localCoordinate = mapCoordinateToGrid(coordinate);

  for (const spec of allRoomSpecs) {
    if (spec.level !== level) {
      continue;
    }

    if (withinBounds(localCoordinate, spec.bounds, 0.001)) {
      return spec;
    }
  }

  return null;
};

const connectorGroupId = (featureId: string) => featureId.replace(/^connector-l[12]-/, "");
const connectorTypeForFeature = (feature: OfficePointFeature): "stairs" | "elevator" =>
  feature.properties.name.toLowerCase().includes("elevator") ? "elevator" : "stairs";

const openingPairKey = (spec: RoomSpec, opening: OpeningSpec) => {
  const [x, y] = localOpeningBoundaryPoint(spec.bounds, opening);
  const axis = opening.side === "north" || opening.side === "south" ? "h" : "v";
  const roomKey = [spec.id, opening.connectsTo ?? "unlinked"].sort().join("::");
  return `${spec.level}::${roomKey}::${axis}::${x.toFixed(3)}::${y.toFixed(3)}::${opening.width.toFixed(3)}`;
};

const reciprocalOpening = (sourceRoom: RoomSpec, targetRoom: RoomSpec, opening: OpeningSpec) =>
  (targetRoom.openings ?? []).find(
    (candidate) =>
      candidate.traversable !== false &&
      candidate.connectsTo === sourceRoom.id &&
      candidate.side === oppositeRoomSide(opening.side) &&
      candidate.center === opening.center &&
      candidate.width === opening.width,
  );

const routeableRoomFeature = (feature: OfficeFeature) => {
  if (feature.properties.kind !== "room" && feature.properties.kind !== "meeting_room" && feature.properties.kind !== "amenity") {
    return false;
  }

  const spec = roomSpecById.get(feature.id);

  if (!spec) {
    return false;
  }

  return (spec.openings ?? []).some((opening) => opening.traversable !== false && Boolean(opening.connectsTo));
};

const routeTargetLabel = (feature: OfficeFeature) => feature.properties.employee ?? feature.properties.name;

const levelDescription = (feature: OfficeFeature) => {
  switch (feature.properties.kind) {
    case "meeting_room":
      return `Meeting room · ${feature.properties.level}`;
    case "amenity":
      return `Amenity · ${feature.properties.level}`;
    case "workstation":
      return `Desk · ${feature.properties.level}`;
    case "connector":
      return `Connector · ${feature.properties.level}`;
    default:
      return `Room · ${feature.properties.level}`;
  }
};

const validateRoutablePoiRooms = (features: OfficePointFeature[]) => {
  for (const feature of features) {
    const room = roomContainingCoordinate(feature.properties.level, officePointCoordinate(feature));

    if (!room) {
      throw new Error(`Point feature ${feature.id} is not contained in any room.`);
    }
  }
};

const derivedPortalNodes: DerivedPortalNode[] = [];
const derivedPortalConnections: DerivedPortalConnection[] = [];
const portalsByRoomId = new Map<string, DerivedPortalNode[]>();
const processedOpenings = new Set<string>();

for (const spec of allRoomSpecs) {
  for (const opening of spec.openings ?? []) {
    if (opening.traversable === false || !opening.connectsTo) {
      continue;
    }

    const targetRoom = roomSpecById.get(opening.connectsTo);

    if (!targetRoom) {
      continue;
    }

    const pairKey = openingPairKey(spec, opening);

    if (processedOpenings.has(pairKey)) {
      continue;
    }

    const targetOpening = reciprocalOpening(spec, targetRoom, opening);
    const targetOpeningForPortal: OpeningSpec = targetOpening ?? {
      ...opening,
      id: `auto-${spec.id}-${opening.id}`,
      side: oppositeRoomSide(opening.side),
      center: opening.center,
      width: opening.width,
    };
    const boundaryPoint = localOpeningBoundaryPoint(spec.bounds, opening);
    const sourcePortal: DerivedPortalNode = {
      id: autoPortalNodeId(spec.id, opening.id),
      roomId: spec.id,
      level: spec.level,
      point: localPortalPoint(spec.bounds, opening),
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

validateRoutablePoiRooms(poiFeatures);

const preferredPortalForRoom = (spec: RoomSpec): DerivedPortalNode | null => {
  const portals = portalsByRoomId.get(spec.id) ?? [];

  if (portals.length === 0) {
    return null;
  }

  const anchor = routeAnchorPoint(spec);
  let bestPortal: DerivedPortalNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const portal of portals) {
    const distance = manhattanDistance(anchor, portal.point);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestPortal = portal;
    }
  }

  return bestPortal;
};

const roomAnchorNodes: RoutingGraph["nodes"] = allRoomSpecs.map((spec) => ({
  id: roomAnchorNodeId(spec.id),
  level: spec.level,
  point: point(routeAnchorPoint(spec)[0], routeAnchorPoint(spec)[1]),
  kind: "room_anchor",
  featureRef: spec.id,
}));

const portalGraphNodes: RoutingGraph["nodes"] = derivedPortalNodes.map((portal) => ({
  id: portal.id,
  level: portal.level,
  point: point(portal.point[0], portal.point[1]),
  kind: "junction",
}));

const poiNavigationNodes: RoutingGraph["nodes"] = poiFeatures.map((feature) => ({
  id: poiNodeId(feature.id),
  level: feature.properties.level,
  point: officePointCoordinate(feature),
  kind: feature.properties.kind === "connector" ? "connector" : "room_anchor",
  featureRef: feature.id,
}));

const derivedEdges: RoutingEdge[] = [];

for (const spec of allRoomSpecs) {
  const anchor = routeAnchorPoint(spec);
  const anchorNodeId = roomAnchorNodeId(spec.id);
  const roomPortals = portalsByRoomId.get(spec.id) ?? [];

  for (const portal of roomPortals) {
    const portalPath = roomTraversalPath(spec, anchor, portal.point);

    derivedEdges.push(
      routeEdge(
        `edge-room-${spec.id}-${portal.id}`,
        anchorNodeId,
        portal.id,
        manhattanDistance(anchor, portal.point),
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

      const roomPortalPath = roomTraversalPath(spec, leftPortal.point, rightPortal.point);

      derivedEdges.push(
        routeEdge(
          `edge-room-pass-${spec.id}-${leftPortal.id}-${rightPortal.id}`,
          leftPortal.id,
          rightPortal.id,
          manhattanDistance(leftPortal.point, rightPortal.point),
          roomPortalPath,
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
      manhattanDistance(fromPortal.point, connection.boundaryPoint) + manhattanDistance(connection.boundaryPoint, toPortal.point),
      [fromPortal.point, connection.boundaryPoint, toPortal.point],
      { accessible: true },
    ),
  );
}

const featureRouteNodeIdByFeatureId = new Map<string, string>();

for (const spec of allRoomSpecs) {
  const preferredPortal = preferredPortalForRoom(spec);
  featureRouteNodeIdByFeatureId.set(spec.id, preferredPortal?.id ?? roomAnchorNodeId(spec.id));
}

for (const feature of poiFeatures) {
  const nodeId = poiNodeId(feature.id);
  const containingRoom = roomContainingCoordinate(feature.properties.level, officePointCoordinate(feature));

  featureRouteNodeIdByFeatureId.set(feature.id, nodeId);

  if (!containingRoom) {
    continue;
  }

  const roomAnchor = routeAnchorPoint(containingRoom);
  const poiLocalCoordinate = mapCoordinateToGrid(officePointCoordinate(feature));
  const poiPath = roomTraversalPath(containingRoom, poiLocalCoordinate, roomAnchor);

  derivedEdges.push(
    routeEdge(
      `edge-poi-${feature.id}`,
      nodeId,
      roomAnchorNodeId(containingRoom.id),
      manhattanDistance(poiLocalCoordinate, roomAnchor),
      poiPath,
      { accessible: true },
    ),
  );
}

const connectorsByGroup = new Map<string, OfficePointFeature[]>();

for (const feature of poiFeatures.filter((item) => item.properties.kind === "connector")) {
  const groupId = connectorGroupId(feature.id);
  connectorsByGroup.set(groupId, [...(connectorsByGroup.get(groupId) ?? []), feature]);
}

for (const [groupId, connectorFeatures] of connectorsByGroup) {
  const sortedConnectors = [...connectorFeatures].sort(
    (left, right) => (levelRankById.get(left.properties.level) ?? 0) - (levelRankById.get(right.properties.level) ?? 0),
  );

  for (let index = 0; index < sortedConnectors.length - 1; index += 1) {
    const current = sortedConnectors[index];
    const next = sortedConnectors[index + 1];

    if (!current || !next) {
      continue;
    }

    const connectorCoordinate = mapCoordinateToGrid(officePointCoordinate(current));
    const connectorType = connectorTypeForFeature(current);

    derivedEdges.push(
      routeEdge(
        `edge-connector-${groupId}-${current.properties.level}-${next.properties.level}`,
        poiNodeId(current.id),
        poiNodeId(next.id),
        connectorType === "elevator" ? 6 : 10,
        [connectorCoordinate, connectorCoordinate],
        { connectorType, accessible: connectorType === "elevator" },
      ),
    );
  }
}

const routingGraphData: RoutingGraph = {
  nodes: [...roomAnchorNodes, ...portalGraphNodes, ...poiNavigationNodes],
  edges: derivedEdges,
};

const routeTargetData: RouteTarget[] = [...roomFeatures.filter(routeableRoomFeature), ...poiFeatures.filter((feature) => feature.properties.kind === "connector")]
  .map((feature) => {
    const roomSpec = roomSpecById.get(feature.id);
    const roomPortalNodeIds = roomSpec ? (portalsByRoomId.get(roomSpec.id) ?? []).map((portal) => portal.id) : [];
    const fallbackNodeId = featureRouteNodeIdByFeatureId.get(feature.id);
    const routeNodeIds =
      roomPortalNodeIds.length > 0
        ? roomPortalNodeIds
        : [fallbackNodeId].filter((nodeId): nodeId is string => Boolean(nodeId));
    const routeNodeId = routeNodeIds[0];

    if (!routeNodeId) {
      throw new Error(`Feature ${feature.id} has no derived route node.`);
    }

    return {
      id: derivedTargetId(feature.id),
      label: routeTargetLabel(feature),
      level: feature.properties.level,
      featureId: feature.id,
      routeNodeIds,
      routeNodeId,
    };
  })
  .sort((left, right) => {
    const levelOrder = (levelRankById.get(left.level) ?? 0) - (levelRankById.get(right.level) ?? 0);

    if (levelOrder !== 0) {
      return levelOrder;
    }

    return left.label.localeCompare(right.label);
  });

const sameCoordinate = (left: Coordinate, right: Coordinate) => left[0] === right[0] && left[1] === right[1];

const pathIsOrthogonal = (coordinates: Coordinate[]) =>
  coordinates.every((coordinate, index) => {
    if (index === 0) {
      return true;
    }

    const previous = coordinates[index - 1];

    if (!previous) {
      return true;
    }

    return coordinate[0] === previous[0] || coordinate[1] === previous[1];
  });

const validateOpenings = (roomSpecs: RoomSpec[]) => {
  const roomById = new Map(roomSpecs.map((spec) => [spec.id, spec]));

  for (const spec of roomSpecs) {
    for (const opening of spec.openings ?? []) {
      if (!opening.connectsTo) {
        continue;
      }

      const target = roomById.get(opening.connectsTo);

      if (!target) {
        throw new Error(`Opening ${spec.id}:${opening.id} points to missing room ${opening.connectsTo}.`);
      }

      if (target.level !== spec.level) {
        throw new Error(`Opening ${spec.id}:${opening.id} crosses levels (${spec.level} -> ${target.level}).`);
      }

      if (!sharesBoundaryOnSide(spec.bounds, target.bounds, opening.side)) {
        throw new Error(`Opening ${spec.id}:${opening.id} does not touch ${opening.connectsTo} on ${opening.side}.`);
      }
    }
  }
};

const validateRoutingGraph = (graph: RoutingGraph) => {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);

    if (!fromNode || !toNode) {
      throw new Error(`Route edge ${edge.id} points to a missing node.`);
    }

    if (edge.path.length === 0) {
      throw new Error(`Route edge ${edge.id} has no authored path.`);
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
};

validateOpenings(allRoomSpecs);
validateRoutingGraph(routingGraphData);

for (const feature of roomFeatures) {
  feature.properties.routeNodeId = featureRouteNodeIdByFeatureId.get(feature.id);
}

for (const feature of poiFeatures) {
  feature.properties.routeNodeId = featureRouteNodeIdByFeatureId.get(feature.id);
}

export const officeModel: OfficeModel = {
  levels,
  rooms: allRoomSpecs,
  poiFeatures,
  searchEntries: searchEntryData,
  routeTargets: routeTargetData,
  routingGraph: routingGraphData,
};

export const searchEntries = officeModel.searchEntries;
export const routeTargets = officeModel.routeTargets;
export const routingGraph = officeModel.routingGraph;

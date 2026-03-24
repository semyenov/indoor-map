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

const routeTargetData: RouteTarget[] = [
  { id: "target-lobby", label: "Lobby", level: "L1", featureId: "room-l1-lobby", routeNodeId: "n-l1-lobby" },
  { id: "target-reception", label: "Reception Desk", level: "L1", featureId: "room-l1-reception", routeNodeId: "n-l1-reception" },
  { id: "target-ocean", label: "Ocean Room", level: "L1", featureId: "room-l1-ocean", routeNodeId: "n-l1-ocean" },
  { id: "target-harbor", label: "Harbor Room", level: "L1", featureId: "room-l1-harbor", routeNodeId: "n-l1-harbor" },
  { id: "target-wellness", label: "Wellness Room", level: "L1", featureId: "room-l1-wellness", routeNodeId: "n-l1-wellness" },
  { id: "target-kitchen", label: "Kitchen", level: "L1", featureId: "room-l1-kitchen", routeNodeId: "n-l1-kitchen" },
  { id: "target-huddle", label: "Huddle 1", level: "L1", featureId: "room-l1-huddle", routeNodeId: "n-l1-huddle" },
  { id: "target-summit", label: "Summit Room", level: "L1", featureId: "room-l1-summit", routeNodeId: "n-l1-summit" },
  { id: "target-engineering", label: "Engineering North", level: "L1", featureId: "zone-l1-engineering-north", routeNodeId: "n-l1-eng-north" },
  { id: "target-ops", label: "Operations Bay", level: "L1", featureId: "zone-l1-operations", routeNodeId: "n-l1-ops" },
  { id: "target-cedar", label: "Cedar Room", level: "L2", featureId: "room-l2-cedar", routeNodeId: "n-l2-cedar" },
  { id: "target-birch", label: "Birch Room", level: "L2", featureId: "room-l2-birch", routeNodeId: "n-l2-birch" },
  { id: "target-war-room", label: "War Room", level: "L2", featureId: "room-l2-war-room", routeNodeId: "n-l2-war-room" },
  { id: "target-library", label: "Library", level: "L2", featureId: "room-l2-library", routeNodeId: "n-l2-library" },
  { id: "target-product", label: "Product Studio", level: "L2", featureId: "zone-l2-product", routeNodeId: "n-l2-product" },
  { id: "target-design", label: "Design Bay", level: "L2", featureId: "zone-l2-design", routeNodeId: "n-l2-design" },
  { id: "target-pods", label: "Focus Pods", level: "L2", featureId: "room-l2-pods", routeNodeId: "n-l2-pods" },
  { id: "target-lounge", label: "Lounge", level: "L2", featureId: "room-l2-lounge", routeNodeId: "n-l2-lounge" },
  { id: "target-maker", label: "Maker Bench", level: "L2", featureId: "room-l2-maker", routeNodeId: "n-l2-maker" },
];

const routingGraphData: RoutingGraph = {
  nodes: [
    { id: "n-l1-lobby", level: "L1", point: point(6, 8), kind: "room_anchor", featureRef: "room-l1-lobby" },
    { id: "n-l1-reception", level: "L1", point: point(13, 8), kind: "room_anchor", featureRef: "room-l1-reception" },
    { id: "n-l1-wellness", level: "L1", point: point(24, 8), kind: "room_anchor", featureRef: "room-l1-wellness" },
    { id: "n-l1-support", level: "L1", point: point(33, 8), kind: "room_anchor", featureRef: "room-l1-it-bar" },
    { id: "n-l1-ocean", level: "L1", point: point(12, 18), kind: "room_anchor", featureRef: "room-l1-ocean" },
    { id: "n-l1-harbor", level: "L1", point: point(12, 25), kind: "room_anchor", featureRef: "room-l1-harbor" },
    { id: "n-l1-west-hall", level: "L1", point: point(12, 11), kind: "junction" },
    { id: "n-l1-south-hall", level: "L1", point: point(26, 9), kind: "junction" },
    { id: "n-l1-core", level: "L1", point: point(26, 12), kind: "junction" },
    { id: "n-l1-eng-north", level: "L1", point: point(22, 14), kind: "room_anchor", featureRef: "zone-l1-engineering-north" },
    { id: "n-l1-eng-south", level: "L1", point: point(24, 22), kind: "room_anchor", featureRef: "zone-l1-engineering-south" },
    { id: "n-l1-ops", level: "L1", point: point(34, 14), kind: "room_anchor", featureRef: "zone-l1-operations" },
    { id: "n-l1-kitchen", level: "L1", point: point(46, 10), kind: "room_anchor", featureRef: "room-l1-kitchen" },
    { id: "n-l1-east-hall", level: "L1", point: point(40, 12), kind: "junction" },
    { id: "n-l1-huddle", level: "L1", point: point(40, 18), kind: "room_anchor", featureRef: "room-l1-huddle" },
    { id: "n-l1-summit", level: "L1", point: point(40, 25), kind: "room_anchor", featureRef: "room-l1-summit" },
    { id: "n-l1-elevator", level: "L1", point: point(42.15, 24.2), kind: "connector", featureRef: "connector-l1-elevator" },
    { id: "n-l1-stairs", level: "L1", point: point(49.2, 24.2), kind: "connector", featureRef: "connector-l1-stairs" },
    { id: "n-l2-cedar", level: "L2", point: point(12, 18), kind: "room_anchor", featureRef: "room-l2-cedar" },
    { id: "n-l2-birch", level: "L2", point: point(12, 25), kind: "room_anchor", featureRef: "room-l2-birch" },
    { id: "n-l2-war-room", level: "L2", point: point(18, 8), kind: "room_anchor", featureRef: "room-l2-war-room" },
    { id: "n-l2-library", level: "L2", point: point(26, 8), kind: "room_anchor", featureRef: "room-l2-library" },
    { id: "n-l2-west-hall", level: "L2", point: point(12, 11), kind: "junction" },
    { id: "n-l2-south-hall", level: "L2", point: point(26, 9), kind: "junction" },
    { id: "n-l2-core", level: "L2", point: point(26, 12), kind: "junction" },
    { id: "n-l2-product", level: "L2", point: point(22, 14), kind: "room_anchor", featureRef: "zone-l2-product" },
    { id: "n-l2-design", level: "L2", point: point(34, 14), kind: "room_anchor", featureRef: "zone-l2-design" },
    { id: "n-l2-touchdown", level: "L2", point: point(30, 26), kind: "room_anchor", featureRef: "zone-l2-touchdown" },
    { id: "n-l2-pods", level: "L2", point: point(46, 10), kind: "room_anchor", featureRef: "room-l2-pods" },
    { id: "n-l2-east-hall", level: "L2", point: point(40, 12), kind: "junction" },
    { id: "n-l2-lounge", level: "L2", point: point(40, 18), kind: "room_anchor", featureRef: "room-l2-lounge" },
    { id: "n-l2-maker", level: "L2", point: point(40, 25), kind: "room_anchor", featureRef: "room-l2-maker" },
    { id: "n-l2-elevator", level: "L2", point: point(42.15, 24.2), kind: "connector", featureRef: "connector-l2-elevator" },
    { id: "n-l2-stairs", level: "L2", point: point(49.2, 24.2), kind: "connector", featureRef: "connector-l2-stairs" },
  ],
  edges: [
    routeEdge("e-l1-lobby-west", "n-l1-lobby", "n-l1-west-hall", 6, [[6, 8], [6, 11], [12, 11]], { accessible: true }),
    routeEdge("e-l1-reception-south", "n-l1-reception", "n-l1-south-hall", 13, [[13, 8], [13, 9], [26, 9]], { accessible: true }),
    routeEdge("e-l1-wellness-south", "n-l1-wellness", "n-l1-south-hall", 2, [[24, 8], [24, 9], [26, 9]], { accessible: true }),
    routeEdge("e-l1-support-south", "n-l1-support", "n-l1-south-hall", 7, [[33, 8], [33, 9], [26, 9]], { accessible: true }),
    routeEdge("e-l1-west-south", "n-l1-west-hall", "n-l1-south-hall", 14, [[12, 11], [12, 9], [26, 9]], { accessible: true }),
    routeEdge("e-l1-south-core", "n-l1-south-hall", "n-l1-core", 3, [[26, 9], [26, 10], [26, 12]], { accessible: true }),
    routeEdge("e-l1-ocean-west", "n-l1-ocean", "n-l1-west-hall", 7, [[12, 18], [13, 18], [13, 14], [13, 11], [12, 11]], { accessible: true }),
    routeEdge("e-l1-harbor-west", "n-l1-harbor", "n-l1-west-hall", 14, [[12, 25], [13, 25], [13, 14], [13, 11], [12, 11]], { accessible: true }),
    routeEdge("e-l1-eng-north-core", "n-l1-eng-north", "n-l1-core", 4, [[22, 14], [22, 13], [26, 13], [26, 12]], { accessible: true }),
    routeEdge("e-l1-ops-core", "n-l1-ops", "n-l1-core", 8, [[34, 14], [34, 13], [26, 13], [26, 12]], { accessible: true }),
    routeEdge("e-l1-core-east", "n-l1-core", "n-l1-east-hall", 14, [[26, 12], [38, 12], [40, 12]], { accessible: true }),
    routeEdge("e-l1-east-kitchen", "n-l1-east-hall", "n-l1-kitchen", 7, [[40, 12], [46, 12], [46, 10]], { accessible: true }),
    routeEdge("e-l1-east-huddle", "n-l1-east-hall", "n-l1-huddle", 6, [[40, 12], [39, 12], [39, 18], [40, 18]], { accessible: true }),
    routeEdge("e-l1-east-summit", "n-l1-east-hall", "n-l1-summit", 13, [[40, 12], [39, 12], [39, 25], [40, 25]], { accessible: true }),
    routeEdge("e-l1-summit-elevator", "n-l1-summit", "n-l1-elevator", 3, [[40, 25], [42.15, 25], [42.15, 24.2]], { accessible: true }),
    routeEdge("e-l1-summit-stairs", "n-l1-summit", "n-l1-stairs", 9, [[40, 25], [49.2, 25], [49.2, 24.2]], { accessible: true }),
    routeEdge("e-l2-war-south", "n-l2-war-room", "n-l2-south-hall", 8, [[18, 8], [18, 9], [26, 9]], { accessible: true }),
    routeEdge("e-l2-library-south", "n-l2-library", "n-l2-south-hall", 4, [[26, 8], [26, 9]], { accessible: true }),
    routeEdge("e-l2-west-south", "n-l2-west-hall", "n-l2-south-hall", 14, [[12, 11], [12, 9], [26, 9]], { accessible: true }),
    routeEdge("e-l2-south-core", "n-l2-south-hall", "n-l2-core", 3, [[26, 9], [26, 10], [26, 12]], { accessible: true }),
    routeEdge("e-l2-cedar-west", "n-l2-cedar", "n-l2-west-hall", 7, [[12, 18], [13, 18], [13, 14], [13, 11], [12, 11]], { accessible: true }),
    routeEdge("e-l2-birch-west", "n-l2-birch", "n-l2-west-hall", 14, [[12, 25], [13, 25], [13, 14], [13, 11], [12, 11]], { accessible: true }),
    routeEdge("e-l2-product-core", "n-l2-product", "n-l2-core", 4, [[22, 14], [22, 13], [26, 13], [26, 12]], { accessible: true }),
    routeEdge("e-l2-design-core", "n-l2-design", "n-l2-core", 8, [[34, 14], [34, 13], [26, 13], [26, 12]], { accessible: true }),
    routeEdge("e-l2-core-east", "n-l2-core", "n-l2-east-hall", 14, [[26, 12], [38, 12], [40, 12]], { accessible: true }),
    routeEdge("e-l2-east-pods", "n-l2-east-hall", "n-l2-pods", 7, [[40, 12], [46, 12], [46, 10]], { accessible: true }),
    routeEdge("e-l2-east-lounge", "n-l2-east-hall", "n-l2-lounge", 6, [[40, 12], [39, 12], [39, 18], [40, 18]], { accessible: true }),
    routeEdge("e-l2-east-maker", "n-l2-east-hall", "n-l2-maker", 13, [[40, 12], [39, 12], [39, 25], [40, 25]], { accessible: true }),
    routeEdge("e-l2-maker-elevator", "n-l2-maker", "n-l2-elevator", 3, [[40, 25], [42.15, 25], [42.15, 24.2]], { accessible: true }),
    routeEdge("e-l2-maker-stairs", "n-l2-maker", "n-l2-stairs", 9, [[40, 25], [49.2, 25], [49.2, 24.2]], { accessible: true }),
    routeEdge("e-elevator", "n-l1-elevator", "n-l2-elevator", 6, [[42.15, 24.2], [42.15, 24.2]], { connectorType: "elevator", accessible: true }),
    routeEdge("e-stairs", "n-l1-stairs", "n-l2-stairs", 10, [[49.2, 24.2], [49.2, 24.2]], { connectorType: "stairs", accessible: false }),
  ],
};

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

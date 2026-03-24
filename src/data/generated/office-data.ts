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
  northDoor?: { center: number; width: number };
  southDoor?: { center: number; width: number };
  westDoor?: { center: number; width: number };
  eastDoor?: { center: number; width: number };
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
    northDoor,
    southDoor,
    westDoor,
    eastDoor,
  } = options;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const horizontalWall = (
    side: "north" | "south",
    fromX: number,
    toX: number,
    yStart: number,
    yEnd: number,
    door?: { center: number; width: number },
  ) => {
    if (door) {
      const halfWidth = door.width / 2;
      const gapStart = clamp(door.center - halfWidth, fromX + thickness, toX - thickness);
      const gapEnd = clamp(door.center + halfWidth, fromX + thickness, toX - thickness);

      if (gapStart > fromX) {
        walls.push(
          polygon(`${idPrefix}-${side}-left`, level, "wall", `${idPrefix} ${side} Left Wall`, fromX, yStart, gapStart, yEnd, {
            baseHeight: 0,
            height,
          }),
        );
      }

      if (gapEnd < toX) {
        walls.push(
          polygon(`${idPrefix}-${side}-right`, level, "wall", `${idPrefix} ${side} Right Wall`, gapEnd, yStart, toX, yEnd, {
            baseHeight: 0,
            height,
          }),
        );
      }

      return;
    }

    walls.push(
      polygon(`${idPrefix}-${side}`, level, "wall", `${idPrefix} ${side} Wall`, fromX, yStart, toX, yEnd, {
        baseHeight: 0,
        height,
      }),
    );
  };

  const verticalWall = (
    side: "west" | "east",
    xStart: number,
    xEnd: number,
    fromY: number,
    toY: number,
    door?: { center: number; width: number },
  ) => {
    if (door) {
      const halfWidth = door.width / 2;
      const gapStart = clamp(door.center - halfWidth, fromY + thickness, toY - thickness);
      const gapEnd = clamp(door.center + halfWidth, fromY + thickness, toY - thickness);

      if (gapStart > fromY) {
        walls.push(
          polygon(`${idPrefix}-${side}-lower`, level, "wall", `${idPrefix} ${side} Lower Wall`, xStart, fromY, xEnd, gapStart, {
            baseHeight: 0,
            height,
          }),
        );
      }

      if (gapEnd < toY) {
        walls.push(
          polygon(`${idPrefix}-${side}-upper`, level, "wall", `${idPrefix} ${side} Upper Wall`, xStart, gapEnd, xEnd, toY, {
            baseHeight: 0,
            height,
          }),
        );
      }

      return;
    }

    walls.push(
      polygon(`${idPrefix}-${side}`, level, "wall", `${idPrefix} ${side} Wall`, xStart, fromY, xEnd, toY, {
        baseHeight: 0,
        height,
      }),
    );
  };

  if (north) {
    horizontalWall("north", x1, x2, y2 - thickness, y2, northDoor);
  }

  if (south) {
    horizontalWall("south", x1, x2, y1, y1 + thickness, southDoor);
  }

  if (west) {
    verticalWall("west", x1, x1 + thickness, y1, y2, westDoor);
  }

  if (east) {
    verticalWall("east", x2 - thickness, x2, y1, y2, eastDoor);
  }

  return walls;
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

const roomFeatures: OfficePolygonFeature[] = [
  polygon("room-l1-lobby", "L1", "room", "Lobby", 2, 2, 10, 8, {
    subtitle: "Welcome + reception",
    department: "Operations",
    routeNodeId: "n-l1-lobby",
    searchTokens: ["lobby", "reception", "welcome"],
  }),
  polygon("room-l1-reception", "L1", "amenity", "Reception Desk", 10, 2, 16, 8, {
    subtitle: "Visitor check-in",
    department: "Operations",
    routeNodeId: "n-l1-reception",
    searchTokens: ["reception desk", "check-in", "front desk"],
  }),
  polygon("room-l1-booth-a", "L1", "room", "Phone Booth A", 16, 2, 20, 8, {
    subtitle: "Acoustic call booth",
    department: "Shared",
    routeNodeId: "n-l1-wellness",
    searchTokens: ["phone booth a", "booth", "call"],
  }),
  polygon("room-l1-wellness", "L1", "room", "Wellness Room", 20, 2, 28, 8, {
    subtitle: "Quiet reset space",
    department: "Shared",
    routeNodeId: "n-l1-wellness",
    searchTokens: ["wellness room", "quiet room", "reset"],
  }),
  polygon("room-l1-it-bar", "L1", "amenity", "IT Bar", 28, 2, 38, 8, {
    subtitle: "Hardware swaps and support",
    department: "IT",
    routeNodeId: "n-l1-support",
    searchTokens: ["it bar", "support", "hardware"],
  }),
  polygon("room-l1-ocean", "L1", "meeting_room", "Ocean Room", 2, 14, 12, 22, {
    subtitle: "10 seats, video conferencing",
    department: "Shared",
    capacity: 10,
    equipment: ["VC", "Whiteboard"],
    status: "occupied",
    routeNodeId: "n-l1-ocean",
    searchTokens: ["ocean room", "meeting", "room 1.2"],
  }),
  polygon("room-l1-harbor", "L1", "meeting_room", "Harbor Room", 2, 22, 12, 28, {
    subtitle: "6 seats, partner calls",
    department: "Shared",
    capacity: 6,
    equipment: ["Display", "Speakerphone"],
    status: "available",
    routeNodeId: "n-l1-harbor",
    searchTokens: ["harbor room", "meeting", "partner calls"],
  }),
  polygon("zone-l1-engineering-north", "L1", "zone", "Engineering North", 14, 14, 30, 22, {
    subtitle: "Backend + Platform",
    department: "Engineering",
    routeNodeId: "n-l1-eng-north",
    searchTokens: ["engineering north", "backend", "platform"],
  }),
  polygon("zone-l1-engineering-south", "L1", "zone", "Engineering South", 14, 22, 30, 28, {
    subtitle: "Developer experience and SRE",
    department: "Engineering",
    routeNodeId: "n-l1-eng-south",
    searchTokens: ["engineering south", "sre", "developer experience"],
  }),
  polygon("zone-l1-operations", "L1", "zone", "Operations Bay", 30, 14, 38, 28, {
    subtitle: "People Ops + Finance",
    department: "Operations",
    routeNodeId: "n-l1-ops",
    searchTokens: ["operations bay", "finance", "people ops"],
  }),
  polygon("room-l1-kitchen", "L1", "amenity", "Kitchen", 40, 2, 52, 10, {
    subtitle: "Coffee point and snacks",
    department: "Shared",
    routeNodeId: "n-l1-kitchen",
    searchTokens: ["kitchen", "coffee", "snacks"],
  }),
  polygon("room-l1-huddle", "L1", "meeting_room", "Huddle 1", 40, 14, 52, 22, {
    subtitle: "4 seats, quick syncs",
    department: "Shared",
    capacity: 4,
    equipment: ["Display"],
    status: "available",
    routeNodeId: "n-l1-huddle",
    searchTokens: ["huddle 1", "small meeting"],
  }),
  polygon("room-l1-summit", "L1", "meeting_room", "Summit Room", 40, 22, 52, 28, {
    subtitle: "12 seats, board setup",
    department: "Shared",
    capacity: 12,
    equipment: ["VC", "Whiteboard", "Ceiling Mic"],
    status: "offline",
    routeNodeId: "n-l1-summit",
    searchTokens: ["summit room", "board room", "large meeting"],
  }),
  polygonFromPoints("zone-l1-corridor", "L1", "zone", "Central Spine", [
    [12, 10],
    [40, 10],
    [40, 14],
    [36, 14],
    [36, 28],
    [28, 28],
    [28, 14],
    [12, 14],
  ], {
    subtitle: "Primary route corridor",
    routeNodeId: "n-l1-core",
    searchTokens: ["corridor", "spine", "hall"],
    focusPoint: point(25, 12),
  }),
  polygon("room-l2-cedar", "L2", "meeting_room", "Cedar Room", 2, 14, 12, 22, {
    subtitle: "8 seats, townhall overflow",
    department: "Shared",
    capacity: 8,
    equipment: ["Display", "Speakerphone"],
    status: "available",
    routeNodeId: "n-l2-cedar",
    searchTokens: ["cedar room", "meeting", "room 2.2"],
  }),
  polygon("room-l2-birch", "L2", "meeting_room", "Birch Room", 2, 22, 12, 28, {
    subtitle: "5 seats, sprint reviews",
    department: "Shared",
    capacity: 5,
    equipment: ["Display"],
    status: "occupied",
    routeNodeId: "n-l2-birch",
    searchTokens: ["birch room", "meeting", "sprint review"],
  }),
  polygon("room-l2-war-room", "L2", "room", "War Room", 14, 2, 22, 8, {
    subtitle: "Incident coordination",
    department: "Engineering",
    routeNodeId: "n-l2-war-room",
    searchTokens: ["war room", "incident", "coordination"],
  }),
  polygon("room-l2-library", "L2", "room", "Library", 22, 2, 30, 8, {
    subtitle: "Reference library and quiet reading",
    department: "Shared",
    routeNodeId: "n-l2-library",
    searchTokens: ["library", "reading", "quiet"],
  }),
  polygon("zone-l2-product", "L2", "zone", "Product Studio", 14, 14, 30, 24, {
    subtitle: "Product + Research",
    department: "Product",
    routeNodeId: "n-l2-product",
    searchTokens: ["product studio", "product", "research"],
  }),
  polygon("zone-l2-design", "L2", "zone", "Design Bay", 30, 14, 38, 24, {
    subtitle: "Design systems + prototyping",
    department: "Design",
    routeNodeId: "n-l2-design",
    searchTokens: ["design bay", "design systems", "prototyping"],
  }),
  polygon("zone-l2-touchdown", "L2", "zone", "Touchdown Area", 14, 24, 38, 28, {
    subtitle: "Flexible hot desks for visitors",
    department: "Shared",
    routeNodeId: "n-l2-touchdown",
    searchTokens: ["touchdown area", "hot desk", "visitors"],
  }),
  polygon("room-l2-pods", "L2", "room", "Focus Pods", 40, 2, 52, 10, {
    subtitle: "Quiet calls and deep work",
    department: "Shared",
    status: "focus",
    routeNodeId: "n-l2-pods",
    searchTokens: ["focus pods", "quiet", "deep work"],
  }),
  polygon("room-l2-lounge", "L2", "amenity", "Lounge", 40, 14, 52, 22, {
    subtitle: "Informal collaboration",
    department: "Shared",
    routeNodeId: "n-l2-lounge",
    searchTokens: ["lounge", "informal", "collaboration"],
  }),
  polygon("room-l2-maker", "L2", "amenity", "Maker Bench", 40, 22, 52, 28, {
    subtitle: "Prototyping and testing",
    department: "Design",
    routeNodeId: "n-l2-maker",
    searchTokens: ["maker bench", "prototype", "testing"],
  }),
  polygonFromPoints("zone-l2-corridor", "L2", "zone", "North Spine", [
    [12, 10],
    [40, 10],
    [40, 14],
    [34, 14],
    [34, 28],
    [26, 28],
    [26, 14],
    [12, 14],
  ], {
    subtitle: "Primary route corridor",
    routeNodeId: "n-l2-core",
    searchTokens: ["corridor", "spine", "hall"],
    focusPoint: point(25, 12),
  }),
];

const structureFeatures: OfficePolygonFeature[] = [
  polygon("wall-l1-west", "L1", "wall", "West Wall", 1.2, 1.2, 1.8, 28.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l1-east", "L1", "wall", "East Wall", 52.2, 1.2, 52.8, 28.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l1-south", "L1", "wall", "South Wall", 1.2, 1.2, 52.8, 1.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l1-north", "L1", "wall", "North Wall", 1.2, 28.2, 52.8, 28.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l2-west", "L2", "wall", "West Wall", 1.2, 1.2, 1.8, 28.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l2-east", "L2", "wall", "East Wall", 52.2, 1.2, 52.8, 28.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l2-south", "L2", "wall", "South Wall", 1.2, 1.2, 52.8, 1.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l2-north", "L2", "wall", "North Wall", 1.2, 28.2, 52.8, 28.8, { baseHeight: 0, height: 3.6 }),
  polygon("wall-l1-core-divider", "L1", "wall", "Core Divider", 38.6, 10, 39.2, 28, { baseHeight: 0, height: 3 }),
  polygon("wall-l2-core-divider", "L2", "wall", "Core Divider", 38.6, 10, 39.2, 28, { baseHeight: 0, height: 3 }),
  ...wallBox("wall-room-l1-lobby", "L1", 2, 2, 10, 8, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    northDoor: { center: 6, width: 1.6 },
  }),
  ...wallBox("wall-room-l1-reception", "L1", 10, 2, 16, 8, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    northDoor: { center: 13, width: 1.8 },
  }),
  ...wallBox("wall-room-l1-booth-a", "L1", 16, 2, 20, 8, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    northDoor: { center: 18, width: 1.2 },
  }),
  ...wallBox("wall-room-l1-wellness", "L1", 20, 2, 28, 8, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    northDoor: { center: 24, width: 1.8 },
  }),
  ...wallBox("wall-room-l1-it-bar", "L1", 28, 2, 38, 8, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    northDoor: { center: 33, width: 2 },
  }),
  ...wallBox("wall-room-l1-ocean", "L1", 2, 14, 12, 22, 0.22, 3.1, {
    north: false,
    south: true,
    west: false,
    east: true,
    eastDoor: { center: 18, width: 1.8 },
  }),
  ...wallBox("wall-room-l1-harbor", "L1", 2, 22, 12, 28, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    eastDoor: { center: 25, width: 1.8 },
  }),
  ...wallBox("wall-room-l1-kitchen", "L1", 40, 2, 52, 10, 0.22, 3.1, {
    north: true,
    south: false,
    west: true,
    east: false,
    northDoor: { center: 46, width: 2.2 },
  }),
  ...wallBox("wall-room-l1-huddle", "L1", 40, 14, 52, 22, 0.22, 3.1, {
    north: false,
    south: true,
    west: true,
    east: false,
    westDoor: { center: 18, width: 1.8 },
  }),
  ...wallBox("wall-room-l1-summit", "L1", 40, 22, 52, 28, 0.22, 3.1, {
    north: true,
    south: false,
    west: true,
    east: false,
    westDoor: { center: 25, width: 1.8 },
  }),
  ...wallBox("wall-room-l2-cedar", "L2", 2, 14, 12, 22, 0.22, 3.1, {
    north: false,
    south: true,
    west: false,
    east: true,
    eastDoor: { center: 18, width: 1.8 },
  }),
  ...wallBox("wall-room-l2-birch", "L2", 2, 22, 12, 28, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    eastDoor: { center: 25, width: 1.8 },
  }),
  ...wallBox("wall-room-l2-war-room", "L2", 14, 2, 22, 8, 0.22, 3.1, {
    north: true,
    south: false,
    west: true,
    east: false,
    northDoor: { center: 18, width: 1.8 },
  }),
  ...wallBox("wall-room-l2-library", "L2", 22, 2, 30, 8, 0.22, 3.1, {
    north: true,
    south: false,
    west: false,
    east: true,
    northDoor: { center: 26, width: 1.8 },
  }),
  ...wallBox("wall-room-l2-pods", "L2", 40, 2, 52, 10, 0.22, 3.1, {
    north: true,
    south: false,
    west: true,
    east: false,
    northDoor: { center: 46, width: 2.2 },
  }),
  ...wallBox("wall-room-l2-lounge", "L2", 40, 14, 52, 22, 0.22, 3.1, {
    north: false,
    south: true,
    west: true,
    east: false,
    westDoor: { center: 18, width: 1.8 },
  }),
  ...wallBox("wall-room-l2-maker", "L2", 40, 22, 52, 28, 0.22, 3.1, {
    north: true,
    south: false,
    west: true,
    east: false,
    westDoor: { center: 25, width: 1.8 },
  }),
  polygon("furniture-l1-table-ocean", "L1", "furniture", "Ocean Table", 4.6, 16.8, 9.4, 19.6, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-desk-cluster-a", "L1", "furniture", "Desk Cluster A", 18, 18, 26, 21.5, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-desk-cluster-b", "L1", "furniture", "Desk Cluster B", 26.8, 20.2, 34.2, 23.8, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-ops-desks", "L1", "furniture", "Ops Desks", 31.4, 18.5, 36.4, 24.8, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l1-kitchen-island", "L1", "furniture", "Kitchen Island", 43.2, 4.6, 48.2, 7.6, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l2-table-cedar", "L2", "furniture", "Cedar Table", 4.6, 16.8, 9.4, 19.6, { baseHeight: 0, height: 0.92 }),
  polygon("furniture-l2-soft-seating-a", "L2", "furniture", "Soft Seating A", 42.4, 16.2, 46.4, 18.7, { baseHeight: 0, height: 0.98 }),
  polygon("furniture-l2-soft-seating-b", "L2", "furniture", "Soft Seating B", 46.9, 17, 49.4, 19.4, { baseHeight: 0, height: 0.98 }),
  polygon("furniture-l2-product-wall", "L2", "furniture", "Product Wall", 24.4, 15, 25.1, 22.4, { baseHeight: 0, height: 1.35 }),
  polygon("furniture-l2-maker-bench", "L2", "furniture", "Maker Bench", 43.6, 24.4, 48.4, 26.6, { baseHeight: 0, height: 1 }),
];

const doorFeatures: OfficeLineFeature[] = [
  lineFeature("door-l1-lobby", "L1", "door", "Lobby Door", [[5.2, 8], [6.8, 8]]),
  lineFeature("door-l1-reception", "L1", "door", "Reception Door", [[12.1, 8], [13.9, 8]]),
  lineFeature("door-l1-booth-a", "L1", "door", "Phone Booth A Door", [[17.4, 8], [18.6, 8]]),
  lineFeature("door-l1-wellness", "L1", "door", "Wellness Door", [[23.1, 8], [24.9, 8]]),
  lineFeature("door-l1-it-bar", "L1", "door", "IT Bar Door", [[32, 8], [34, 8]]),
  lineFeature("door-l1-ocean", "L1", "door", "Ocean Room Door", [[12, 17.1], [12, 18.9]]),
  lineFeature("door-l1-harbor", "L1", "door", "Harbor Room Door", [[12, 24.1], [12, 25.9]]),
  lineFeature("door-l1-kitchen", "L1", "door", "Kitchen Door", [[44.9, 10], [47.1, 10]]),
  lineFeature("door-l1-huddle", "L1", "door", "Huddle 1 Door", [[40, 17.1], [40, 18.9]]),
  lineFeature("door-l1-summit", "L1", "door", "Summit Room Door", [[40, 24.1], [40, 25.9]]),
  lineFeature("door-l2-cedar", "L2", "door", "Cedar Room Door", [[12, 17.1], [12, 18.9]]),
  lineFeature("door-l2-birch", "L2", "door", "Birch Room Door", [[12, 24.1], [12, 25.9]]),
  lineFeature("door-l2-war-room", "L2", "door", "War Room Door", [[17.1, 8], [18.9, 8]]),
  lineFeature("door-l2-library", "L2", "door", "Library Door", [[25.1, 8], [26.9, 8]]),
  lineFeature("door-l2-pods", "L2", "door", "Focus Pods Door", [[44.9, 10], [47.1, 10]]),
  lineFeature("door-l2-lounge", "L2", "door", "Lounge Door", [[40, 17.1], [40, 18.9]]),
  lineFeature("door-l2-maker", "L2", "door", "Maker Bench Door", [[40, 24.1], [40, 25.9]]),
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
  marker("connector-l1-stairs", "L1", "connector", "Stairs", 50, 24, {
    subtitle: "North stair core",
    routeNodeId: "n-l1-stairs",
    searchTokens: ["stairs", "stair core"],
  }),
  marker("connector-l2-stairs", "L2", "connector", "Stairs", 50, 24, {
    subtitle: "North stair core",
    routeNodeId: "n-l2-stairs",
    searchTokens: ["stairs", "stair core"],
  }),
  marker("connector-l1-elevator", "L1", "connector", "Elevator", 42, 24, {
    subtitle: "Accessible vertical core",
    routeNodeId: "n-l1-elevator",
    searchTokens: ["elevator", "lift", "accessible"],
  }),
  marker("connector-l2-elevator", "L2", "connector", "Elevator", 42, 24, {
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
    .filter((feature) => feature.properties.kind === "room" || feature.properties.kind === "meeting_room" || feature.properties.kind === "amenity")
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
    .filter((feature) => feature.properties.kind === "room" || feature.properties.kind === "meeting_room" || feature.properties.kind === "amenity")
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
    feature.properties.kind === "amenity" ||
    feature.properties.kind === "zone",
);

export const statusRoomIds: readonly string[] = [
  "room-l1-ocean",
  "room-l1-harbor",
  "room-l1-huddle",
  "room-l1-summit",
  "room-l2-cedar",
  "room-l2-birch",
  "room-l2-pods",
];

export const searchEntries: SearchEntry[] = [
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

export const routeTargets: RouteTarget[] = [
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

export const routingGraph: RoutingGraph = {
  nodes: [
    { id: "n-l1-lobby", level: "L1", point: point(10, 11), kind: "room_anchor", featureRef: "room-l1-lobby" },
    { id: "n-l1-reception", level: "L1", point: point(16, 9), kind: "room_anchor", featureRef: "room-l1-reception" },
    { id: "n-l1-wellness", level: "L1", point: point(24, 9), kind: "room_anchor", featureRef: "room-l1-wellness" },
    { id: "n-l1-support", level: "L1", point: point(33, 9), kind: "room_anchor", featureRef: "room-l1-it-bar" },
    { id: "n-l1-ocean", level: "L1", point: point(12, 18), kind: "room_anchor", featureRef: "room-l1-ocean" },
    { id: "n-l1-harbor", level: "L1", point: point(12, 25), kind: "room_anchor", featureRef: "room-l1-harbor" },
    { id: "n-l1-west-hall", level: "L1", point: point(12, 12), kind: "junction" },
    { id: "n-l1-core", level: "L1", point: point(26, 12), kind: "junction" },
    { id: "n-l1-eng-north", level: "L1", point: point(24, 18), kind: "room_anchor", featureRef: "zone-l1-engineering-north" },
    { id: "n-l1-eng-south", level: "L1", point: point(24, 25), kind: "room_anchor", featureRef: "zone-l1-engineering-south" },
    { id: "n-l1-ops", level: "L1", point: point(36, 23), kind: "room_anchor", featureRef: "zone-l1-operations" },
    { id: "n-l1-kitchen", level: "L1", point: point(40, 11), kind: "room_anchor", featureRef: "room-l1-kitchen" },
    { id: "n-l1-huddle", level: "L1", point: point(40, 18), kind: "room_anchor", featureRef: "room-l1-huddle" },
    { id: "n-l1-summit", level: "L1", point: point(40, 25), kind: "room_anchor", featureRef: "room-l1-summit" },
    { id: "n-l1-elevator", level: "L1", point: point(42, 24), kind: "connector", featureRef: "connector-l1-elevator" },
    { id: "n-l1-stairs", level: "L1", point: point(50, 24), kind: "connector", featureRef: "connector-l1-stairs" },
    { id: "n-l2-cedar", level: "L2", point: point(12, 18), kind: "room_anchor", featureRef: "room-l2-cedar" },
    { id: "n-l2-birch", level: "L2", point: point(12, 25), kind: "room_anchor", featureRef: "room-l2-birch" },
    { id: "n-l2-war-room", level: "L2", point: point(22, 9), kind: "room_anchor", featureRef: "room-l2-war-room" },
    { id: "n-l2-library", level: "L2", point: point(30, 9), kind: "room_anchor", featureRef: "room-l2-library" },
    { id: "n-l2-west-hall", level: "L2", point: point(12, 12), kind: "junction" },
    { id: "n-l2-core", level: "L2", point: point(26, 12), kind: "junction" },
    { id: "n-l2-product", level: "L2", point: point(26, 18), kind: "room_anchor", featureRef: "zone-l2-product" },
    { id: "n-l2-design", level: "L2", point: point(36, 18), kind: "room_anchor", featureRef: "zone-l2-design" },
    { id: "n-l2-touchdown", level: "L2", point: point(30, 26), kind: "room_anchor", featureRef: "zone-l2-touchdown" },
    { id: "n-l2-pods", level: "L2", point: point(40, 11), kind: "room_anchor", featureRef: "room-l2-pods" },
    { id: "n-l2-lounge", level: "L2", point: point(40, 18), kind: "room_anchor", featureRef: "room-l2-lounge" },
    { id: "n-l2-maker", level: "L2", point: point(40, 25), kind: "room_anchor", featureRef: "room-l2-maker" },
    { id: "n-l2-elevator", level: "L2", point: point(42, 24), kind: "connector", featureRef: "connector-l2-elevator" },
    { id: "n-l2-stairs", level: "L2", point: point(50, 24), kind: "connector", featureRef: "connector-l2-stairs" },
  ],
  edges: [
    { id: "e-l1-lobby-west", from: "n-l1-lobby", to: "n-l1-west-hall", weight: 5, accessible: true },
    { id: "e-l1-reception-west", from: "n-l1-reception", to: "n-l1-west-hall", weight: 4, accessible: true },
    { id: "e-l1-west-core", from: "n-l1-west-hall", to: "n-l1-core", weight: 14, accessible: true },
    { id: "e-l1-wellness-core", from: "n-l1-wellness", to: "n-l1-core", weight: 6, accessible: true },
    { id: "e-l1-support-core", from: "n-l1-support", to: "n-l1-core", weight: 7, accessible: true },
    { id: "e-l1-ocean-west", from: "n-l1-ocean", to: "n-l1-west-hall", weight: 6, accessible: true },
    { id: "e-l1-harbor-ocean", from: "n-l1-harbor", to: "n-l1-ocean", weight: 7, accessible: true },
    { id: "e-l1-eng-north-core", from: "n-l1-eng-north", to: "n-l1-core", weight: 6, accessible: true },
    { id: "e-l1-eng-south-north", from: "n-l1-eng-south", to: "n-l1-eng-north", weight: 7, accessible: true },
    { id: "e-l1-ops-eng", from: "n-l1-ops", to: "n-l1-eng-north", weight: 12, accessible: true },
    { id: "e-l1-core-kitchen", from: "n-l1-core", to: "n-l1-kitchen", weight: 14, accessible: true },
    { id: "e-l1-core-huddle", from: "n-l1-core", to: "n-l1-huddle", weight: 18, accessible: true },
    { id: "e-l1-huddle-summit", from: "n-l1-huddle", to: "n-l1-summit", weight: 7, accessible: true },
    { id: "e-l1-summit-elevator", from: "n-l1-summit", to: "n-l1-elevator", weight: 4, accessible: true },
    { id: "e-l1-summit-stairs", from: "n-l1-summit", to: "n-l1-stairs", weight: 10, accessible: true },
    { id: "e-l2-war-core", from: "n-l2-war-room", to: "n-l2-core", weight: 8, accessible: true },
    { id: "e-l2-library-core", from: "n-l2-library", to: "n-l2-core", weight: 5, accessible: true },
    { id: "e-l2-west-core", from: "n-l2-west-hall", to: "n-l2-core", weight: 14, accessible: true },
    { id: "e-l2-cedar-west", from: "n-l2-cedar", to: "n-l2-west-hall", weight: 6, accessible: true },
    { id: "e-l2-birch-cedar", from: "n-l2-birch", to: "n-l2-cedar", weight: 7, accessible: true },
    { id: "e-l2-product-core", from: "n-l2-product", to: "n-l2-core", weight: 6, accessible: true },
    { id: "e-l2-design-product", from: "n-l2-design", to: "n-l2-product", weight: 10, accessible: true },
    { id: "e-l2-touchdown-product", from: "n-l2-touchdown", to: "n-l2-product", weight: 8, accessible: true },
    { id: "e-l2-core-pods", from: "n-l2-core", to: "n-l2-pods", weight: 14, accessible: true },
    { id: "e-l2-design-lounge", from: "n-l2-design", to: "n-l2-lounge", weight: 5, accessible: true },
    { id: "e-l2-lounge-maker", from: "n-l2-lounge", to: "n-l2-maker", weight: 7, accessible: true },
    { id: "e-l2-maker-elevator", from: "n-l2-maker", to: "n-l2-elevator", weight: 4, accessible: true },
    { id: "e-l2-maker-stairs", from: "n-l2-maker", to: "n-l2-stairs", weight: 10, accessible: true },
    { id: "e-elevator", from: "n-l1-elevator", to: "n-l2-elevator", weight: 6, connectorType: "elevator", accessible: true },
    { id: "e-stairs", from: "n-l1-stairs", to: "n-l2-stairs", weight: 10, connectorType: "stairs", accessible: false },
  ],
};

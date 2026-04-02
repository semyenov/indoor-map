import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";

export type LevelId = "L1" | "L2";
export type Coordinate = [number, number];

export type FeatureKind =
  | "room"
  | "meeting_room"
  | "zone"
  | "amenity"
  | "workstation"
  | "wall"
  | "door"
  | "furniture"
  | "connector";

export type RoomStatus = "available" | "occupied" | "focus" | "offline";

export interface LevelMeta {
  id: LevelId;
  label: string;
  order: number;
  defaultCenter: Coordinate;
  defaultZoom: number;
}

export interface OfficeFeatureProperties {
  featureId: string;
  level: LevelId;
  kind: FeatureKind;
  name: string;
  number?: string;
  subtitle?: string;
  department?: string;
  employee?: string;
  capacity?: number;
  equipment?: string[];
  status?: RoomStatus;
  searchTokens: string[];
  routeNodeId?: string;
  focusPoint: Coordinate;
  baseHeight?: number;
  height?: number;
}

export type OfficeFeature = Feature<Geometry, OfficeFeatureProperties> & {
  id: string;
};

export type OfficePolygonFeature = Feature<Polygon, OfficeFeatureProperties> & {
  id: string;
};

export type OfficePointFeature = Feature<Point, OfficeFeatureProperties> & {
  id: string;
};

export type OfficeLineFeature = Feature<LineString, OfficeFeatureProperties> & {
  id: string;
};

export interface SearchEntry {
  id: string;
  label: string;
  description: string;
  level: LevelId;
  featureId: string;
  tokens: string[];
}

export interface RouteTarget {
  id: string;
  label: string;
  level: LevelId;
  featureId: string;
  routeNodeIds: string[];
  routeNodeId: string;
}

export interface RoutingNode {
  id: string;
  level: LevelId;
  point: Coordinate;
  kind: "junction" | "room_anchor" | "connector";
  featureRef?: string;
}

export interface RoutingEdge {
  id: string;
  from: string;
  to: string;
  weight: number;
  path: Coordinate[];
  connectorType?: "stairs" | "elevator";
  accessible: boolean;
}

export interface RoutingGraph {
  nodes: RoutingNode[];
  edges: RoutingEdge[];
}

export interface RoutingOptions {
  accessibleOnly?: boolean;
}

export interface RouteSegment {
  level: LevelId;
  coordinates: Coordinate[];
}

export interface RouteLeg {
  id: string;
  level: LevelId;
  fromNodeId: string;
  toNodeId: string;
  distance: number;
  path: Coordinate[];
  connectorType?: "stairs" | "elevator";
}

export interface RouteSummary {
  distance: number;
  levels: LevelId[];
  connectorTypes: ("stairs" | "elevator")[];
}

export interface RouteResult {
  nodeIds: string[];
  legs: RouteLeg[];
  segments: RouteSegment[];
  summary: RouteSummary;
}

export interface RoomStatuses {
  [featureId: string]: RoomStatus;
}

export type OfficeFeatureCollection = FeatureCollection<Geometry, OfficeFeatureProperties>;
export type OfficeLineCollection = FeatureCollection<LineString, { level: LevelId }>;
export type FeatureSourceId = "spaces" | "structures" | "pois";
export type FeatureLabelSourceId = "room-label-points" | "poi-label-points";

export interface IndoorCollections {
  spaces: OfficeFeatureCollection;
  structures: OfficeFeatureCollection;
  pois: OfficeFeatureCollection;
  roomLabels: OfficeFeatureCollection;
  poiLabels: OfficeFeatureCollection;
}

export interface IndoorRoutingPayload {
  graph: RoutingGraph;
  targets: RouteTarget[];
}

export interface IndoorSearchPayload {
  entries: SearchEntry[];
}

export interface IndoorStatusPayload {
  roomIds: string[];
}

export type OpeningKind = "door" | "opening";
export type LocalRectBounds = [number, number, number, number];

export interface CanonicalGrid {
  origin: Coordinate;
  xStep: number;
  yStep: number;
}

export interface CanonicalLevelMeta {
  id: LevelId;
  label: string;
  order: number;
  defaultCenter: Coordinate;
  defaultZoom: number;
}

export interface CanonicalOpening {
  id: string;
  point: [number, number];
  width: number;
  kind: OpeningKind;
  traversable?: boolean;
  connectsTo?: string;
}

export interface CanonicalGuide {
  id: string;
  point: [number, number];
  angle: number;
}

export interface CanonicalRoom {
  id: string;
  level: LevelId;
  kind: "room" | "meeting_room" | "amenity";
  name: string;
  number?: string;
  polygon: [number, number][];
  wallEdges?: number[];
  subtitle: string;
  department: string;
  searchTokens: string[];
  focusPoint?: Coordinate;
  capacity?: number;
  equipment?: string[];
  status?: RoomStatus;
  showLabel?: boolean;
  openings?: CanonicalOpening[];
}

export interface CanonicalPoi {
  id: string;
  level: LevelId;
  kind: "amenity" | "workstation" | "connector";
  name: string;
  point: Coordinate;
  subtitle?: string;
  department?: string;
  employee?: string;
  searchTokens: string[];
  roomId?: string;
  connectorGroupId?: string;
  connectorType?: "stairs" | "elevator";
  accessible?: boolean;
  accessPath?: {
    roomApproach?: Coordinate;
    threshold: Coordinate;
    interiorApproach?: Coordinate;
  };
}

export interface CanonicalWallOpening {
  center: number;
  width: number;
}

export interface CanonicalWallBoxOptions {
  north?: boolean;
  south?: boolean;
  west?: boolean;
  east?: boolean;
  northOpenings?: CanonicalWallOpening[];
  southOpenings?: CanonicalWallOpening[];
  westOpenings?: CanonicalWallOpening[];
  eastOpenings?: CanonicalWallOpening[];
}

export interface CanonicalRectStructure {
  id: string;
  level: LevelId;
  featureKind: "furniture";
  geometry: {
    type: "rect";
    bounds: LocalRectBounds;
  };
  name: string;
  department?: string;
  baseHeight?: number;
  height?: number;
  searchTokens?: string[];
}

export interface CanonicalWallBoxStructure {
  id: string;
  level: LevelId;
  featureKind: "wall";
  geometry: {
    type: "wall_box";
    bounds: LocalRectBounds;
    thickness?: number;
    height?: number;
    options?: CanonicalWallBoxOptions;
  };
  name: string;
  department?: string;
  baseHeight?: number;
  searchTokens?: string[];
}

export interface CanonicalStairRunStructure {
  id: string;
  level: LevelId;
  featureKind: "furniture";
  geometry: {
    type: "stair_run";
    bounds: LocalRectBounds;
    stepCount: number;
    rise?: number;
    treadThickness?: number;
    treadCoverage?: number;
  };
  name: string;
  department?: string;
  baseHeight?: number;
  height?: number;
  searchTokens?: string[];
}

export interface CanonicalLineStructure {
  id: string;
  level: LevelId;
  featureKind: "door";
  geometry: {
    type: "line";
    coordinates: Coordinate[];
  };
  name: string;
  department?: string;
  baseHeight?: number;
  height?: number;
  searchTokens?: string[];
}

export type CanonicalStructure =
  | CanonicalRectStructure
  | CanonicalWallBoxStructure
  | CanonicalStairRunStructure
  | CanonicalLineStructure;

export interface CanonicalIndoorDataset {
  grid: CanonicalGrid;
  levels: CanonicalLevelMeta[];
  rooms: CanonicalRoom[];
  pois: CanonicalPoi[];
  structures: CanonicalStructure[];
  guides?: CanonicalGuide[];
}

export interface IndoorRuntimeDataset {
  levels: LevelMeta[];
  collections: IndoorCollections;
  routing: IndoorRoutingPayload;
  search: IndoorSearchPayload;
  status: IndoorStatusPayload;
  features: OfficeFeature[];
}

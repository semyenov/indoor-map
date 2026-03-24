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

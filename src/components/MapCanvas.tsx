import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Compass,
  Crosshair,
  LayoutGrid,
  Orbit,
  RotateCcw,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import maplibregl, {
  type CustomRenderMethodInput,
  type ExpressionSpecification,
  type FilterSpecification,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildRouteCollection, buildRouteMarkerCollection } from "../lib/routing";
import type {
  Coordinate,
  FeatureKind,
  FeatureLabelSourceId,
  FeatureSourceId,
  IndoorCollections,
  LevelId,
  LevelMeta,
  OfficeFeature,
  OfficePolygonFeature,
  RouteResult,
} from "../lib/types";

export type MapThemeVariant = "light" | "dark";

const MAP_PALETTES = {
  light: {
    background: "#edf2f5",
    circulationFill: "#d7e2e8",
    workspaceFill: "#dbe9de",
    meetingFill: "#e7c7a7",
    amenityFill: "#c8def1",
    engineeringFill: "#c8e2ce",
    operationsFill: "#c2d9ee",
    productFill: "#ddd0f1",
    designFill: "#edccda",
    sharedFill: "#e5d2af",
    circulationAccentFill: "#c9dde6",
    verticalFill: "#d7dbed",
    selectedFill: "#36aee4",
    hoverFill: "#85cfee",
    outline: "#586771",
    selectedOutline: "#0b8bce",
    hoverOutline: "#339fce",
    wall: "#87939b",
    wallOpacity: 0.58,
    door: "#bc8348",
    furniture: "#a8b2b8",
    connector: "#c9d3db",
    connectorSelected: "#e0b56a",
    routeCasing: "rgba(251,253,254,0.9)",
    routeLine: "#de4c57",
    workstation: "#244c60",
    connectorPoi: "#dc616a",
    poiHover: "#309dc9",
    poiSelected: "#3eb5e6",
    label: "#233b48",
    labelHover: "#1f739a",
    labelSelected: "#0c6697",
    labelHalo: "rgba(250,252,253,0.98)",
  },
  dark: {
    background: "#11171c",
    circulationFill: "#202b31",
    workspaceFill: "#24312e",
    meetingFill: "#463127",
    amenityFill: "#24384c",
    engineeringFill: "#1f4b39",
    operationsFill: "#1f4354",
    productFill: "#443664",
    designFill: "#5b3244",
    sharedFill: "#4b4030",
    circulationAccentFill: "#29414a",
    verticalFill: "#3f4058",
    selectedFill: "#3aaee8",
    hoverFill: "#2f789d",
    outline: "#7f8b96",
    selectedOutline: "#69d1ff",
    hoverOutline: "#4eb1df",
    wall: "#4d565f",
    wallOpacity: 0.76,
    door: "#d0a06a",
    furniture: "#6f7880",
    connector: "#87919b",
    connectorSelected: "#f0c57b",
    routeCasing: "rgba(236,241,244,0.24)",
    routeLine: "#ff6670",
    workstation: "#c4d7e3",
    connectorPoi: "#ff6a73",
    poiHover: "#65c5f0",
    poiSelected: "#7fd7ff",
    label: "#dbe4ea",
    labelHover: "#8bd8ff",
    labelSelected: "#a4e5ff",
    labelHalo: "rgba(10,13,16,0.96)",
  },
} as const;

type MapPalette = (typeof MAP_PALETTES)[MapThemeVariant];

const zoneFillExpression = (palette: MapPalette): ExpressionSpecification => [
  "case",
  ["==", ["get", "department"], "Инженерия"],
  palette.engineeringFill,
  ["==", ["get", "department"], "Операции"],
  palette.operationsFill,
  ["==", ["get", "department"], "Продукт"],
  palette.productFill,
  ["==", ["get", "department"], "Дизайн"],
  palette.designFill,
  ["==", ["get", "department"], "Вертикальные связи"],
  palette.verticalFill,
  ["==", ["get", "department"], "Коридоры"],
  palette.circulationAccentFill,
  ["==", ["get", "department"], "Общие"],
  palette.sharedFill,
  palette.circulationFill,
];

const roomFillExpression = (palette: MapPalette): ExpressionSpecification => [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  palette.selectedFill,
  ["boolean", ["feature-state", "hover"], false],
  palette.hoverFill,
  ["==", ["get", "kind"], "meeting_room"],
  palette.meetingFill,
  ["==", ["get", "kind"], "amenity"],
  palette.amenityFill,
  ["==", ["get", "department"], "Инженерия"],
  palette.engineeringFill,
  ["==", ["get", "department"], "Операции"],
  palette.operationsFill,
  ["==", ["get", "department"], "Продукт"],
  palette.productFill,
  ["==", ["get", "department"], "Дизайн"],
  palette.designFill,
  ["==", ["get", "department"], "Вертикальные связи"],
  palette.verticalFill,
  ["==", ["get", "department"], "Коридоры"],
  palette.circulationAccentFill,
  ["==", ["get", "department"], "Общие"],
  palette.sharedFill,
  palette.workspaceFill,
];

const styleForTheme = (themeVariant: MapThemeVariant): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": MAP_PALETTES[themeVariant].background,
      },
    },
  ],
});

const SPACE_SOURCE = "spaces";
const STRUCTURE_SOURCE = "structures";
const POI_SOURCE = "pois";
const ROOM_LABEL_SOURCE = "room-label-points";
const POI_LABEL_SOURCE = "poi-label-points";
const ROUTE_PATH_SOURCE = "route-path";
const ROUTE_BREADCRUMB_SOURCE = "route-breadcrumbs";
const ROUTE_CUSTOM_LAYER_ID = "route-custom";
const SELECTION_SOURCE = "selection";
type FilteredLayerId =
  | "zone-fill"
  | "room-fill"
  | "selection-area-fill"
  | "room-outline"
  | "selection-area-glow"
  | "selection-area-outline"
  | "room-labels"
  | "room-hit-area"
  | "wall-extrusion"
  | "door-line"
  | "connector-structure"
  | "furniture-extrusion"
  | "poi-circle"
  | "poi-labels"
  | "selection-halo"
  | "selection-core"
  | "route-path-glow"
  | "route-path"
  | "route-breadcrumb-glow"
  | "route-breadcrumb"
  | "route-terminal-glow"
  | "route-terminal";

const FILTERED_LAYER_IDS: FilteredLayerId[] = [
  "zone-fill",
  "room-fill",
  "selection-area-fill",
  "room-outline",
  "selection-area-glow",
  "selection-area-outline",
  "room-labels",
  "room-hit-area",
  "wall-extrusion",
  "door-line",
  "connector-structure",
  "furniture-extrusion",
  "poi-circle",
  "poi-labels",
  "selection-halo",
  "selection-core",
  "route-path-glow",
  "route-path",
  "route-breadcrumb-glow",
  "route-breadcrumb",
  "route-terminal-glow",
  "route-terminal",
];

export type MapSceneMode = "plan" | "explore" | "theatre";
type ScenePreset = {
  pitch: number;
  bearing: number;
  zoomOffset: number;
};
const ROUTE_SAMPLE_STEP = 0.0000025;

type RGBAColor = readonly [number, number, number, number];

type RouteCustomLayer = maplibregl.CustomLayerInterface & {
  map?: maplibregl.Map;
  gl?: WebGLRenderingContext | WebGL2RenderingContext;
  program?: WebGLProgram | null;
  pathBuffer?: WebGLBuffer | null;
  terminalBuffer?: WebGLBuffer | null;
  aPos?: number;
  uMatrix?: WebGLUniformLocation | null;
  uPointSize?: WebGLUniformLocation | null;
  uColor?: WebGLUniformLocation | null;
  pathVertices?: Float32Array;
  terminalVertices?: Float32Array;
  pathVertexCount: number;
  terminalVertexCount: number;
  colors: {
    casing: RGBAColor;
    line: RGBAColor;
  };
  hasLoggedRender: boolean;
  uploadBuffers: () => void;
  updateData: (route: RouteResult | null, level: LevelId) => void;
  updatePalette: (palette: MapPalette) => void;
};

const SCENE_PRESETS: Record<MapSceneMode, ScenePreset> = {
  plan: { pitch: 18, bearing: 0, zoomOffset: -0.15 },
  explore: { pitch: 58, bearing: -18, zoomOffset: 0 },
  theatre: { pitch: 70, bearing: -42, zoomOffset: 0.2 },
};

const SCENE_MODES: MapSceneMode[] = ["plan", "explore", "theatre"];
const SCENE_MODE_LABELS: Record<MapSceneMode, string> = {
  plan: "План",
  explore: "Обзор",
  theatre: "Сцена",
};
const DEFAULT_SCENE_MODE: MapSceneMode = "plan";
const DEFAULT_SCENE_PRESET = SCENE_PRESETS[DEFAULT_SCENE_MODE];
const BASE_MAP_PADDING: maplibregl.PaddingOptions = {
  top: 112,
  right: 112,
  bottom: 112,
  left: 112,
};
const TOOLBAR_MAP_PADDING: maplibregl.PaddingOptions = {
  top: 112,
  right: 112,
  bottom: 112,
  left: 336,
};
const TOOLBAR_COLLAPSED_MAP_PADDING: maplibregl.PaddingOptions = {
  top: 96,
  right: 96,
  bottom: 96,
  left: 160,
};

const TOOLBAR_ICON_PROPS = {
  absoluteStrokeWidth: true,
  strokeWidth: 1.85,
} as const;

const toolbarIcon = (Icon: LucideIcon, size: number) => () => <Icon size={size} {...TOOLBAR_ICON_PROPS} />;

const ToolbarIcons = {
  plan: toolbarIcon(LayoutGrid, 16),
  explore: toolbarIcon(Compass, 16),
  theatre: toolbarIcon(Clapperboard, 16),
  rotateLeft: toolbarIcon(RotateCcw, 14),
  rotateRight: toolbarIcon(RotateCw, 14),
  orbit: toolbarIcon(Orbit, 14),
  focus: toolbarIcon(Crosshair, 14),
};

const floorFilter = (
  level: LevelId,
  kinds: FeatureKind[],
  geometryType: "Point" | "Polygon" | "LineString",
): FilterSpecification => [
  "all",
  ["==", ["geometry-type"], geometryType],
  ["==", ["get", "level"], level],
  ["in", ["get", "kind"], ["literal", kinds]],
];

const departmentFilter = (
  level: LevelId,
  kinds: FeatureKind[],
  geometryType: "Point" | "Polygon" | "LineString",
  department: string,
): FilterSpecification => [
  "all",
  ["==", ["geometry-type"], geometryType],
  ["==", ["get", "level"], level],
  ["in", ["get", "kind"], ["literal", kinds]],
  ["==", ["get", "department"], department],
];

const excludedDepartmentFilter = (
  level: LevelId,
  kinds: FeatureKind[],
  geometryType: "Point" | "Polygon" | "LineString",
  department: string,
): FilterSpecification => [
  "all",
  ["==", ["geometry-type"], geometryType],
  ["==", ["get", "level"], level],
  ["in", ["get", "kind"], ["literal", kinds]],
  ["!=", ["get", "department"], department],
];

const getLevelMeta = (levels: LevelMeta[], level: LevelId): LevelMeta => {
  const firstLevel = levels[0];

  if (!firstLevel) {
    throw new Error("Indoor map requires at least one configured level.");
  }

  return levels.find((item) => item.id === level) ?? firstLevel;
};

type RectBounds = [number, number, number, number];
type CoordinateInput = readonly number[];

const mergeBounds = (bounds: RectBounds | null, next: RectBounds | null): RectBounds | null => {
  if (!next) {
    return bounds;
  }

  if (!bounds) {
    return [...next] as RectBounds;
  }

  return [
    Math.min(bounds[0], next[0]),
    Math.min(bounds[1], next[1]),
    Math.max(bounds[2], next[2]),
    Math.max(bounds[3], next[3]),
  ];
};

const extendBoundsWithCoordinate = (bounds: RectBounds | null, coordinate: CoordinateInput): RectBounds | null => {
  const [longitude, latitude] = coordinate;

  if (typeof longitude !== "number" || typeof latitude !== "number") {
    return bounds;
  }

  if (!bounds) {
    return [longitude, latitude, longitude, latitude];
  }

  return [
    Math.min(bounds[0], longitude),
    Math.min(bounds[1], latitude),
    Math.max(bounds[2], longitude),
    Math.max(bounds[3], latitude),
  ];
};

const coordinatesBounds = (input: unknown, bounds: RectBounds | null = null): RectBounds | null => {
  if (!Array.isArray(input)) {
    return bounds;
  }

  if (input.length >= 2 && typeof input[0] === "number" && typeof input[1] === "number") {
    return extendBoundsWithCoordinate(bounds, input as CoordinateInput);
  }

  let nextBounds = bounds;

  for (const item of input) {
    nextBounds = coordinatesBounds(item, nextBounds);
  }

  return nextBounds;
};

const geometryBounds = (geometry: OfficeFeature["geometry"]): RectBounds | null => {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.reduce<RectBounds | null>(
      (bounds, item) => mergeBounds(bounds, geometryBounds(item)),
      null,
    );
  }

  return "coordinates" in geometry ? coordinatesBounds(geometry.coordinates) : null;
};

const levelGeometryBounds = (collections: IndoorCollections, level: LevelId): RectBounds | null => {
  let footprintBounds: RectBounds | null = null;
  let fallbackBounds: RectBounds | null = null;

  for (const collection of [collections.spaces, collections.structures, collections.pois]) {
    for (const feature of collection.features) {
      if (feature.properties.level !== level) {
        continue;
      }

      const bounds = geometryBounds(feature.geometry);

      if (!bounds) {
        continue;
      }

      fallbackBounds = mergeBounds(fallbackBounds, bounds);

      if (feature.geometry.type !== "Point" && feature.geometry.type !== "MultiPoint") {
        footprintBounds = mergeBounds(footprintBounds, bounds);
      }
    }
  }

  return footprintBounds ?? fallbackBounds;
};

const routeBoundsForLevel = (route: RouteResult | null, level: LevelId): RectBounds | null => {
  if (!route) {
    return null;
  }

  let bounds: RectBounds | null = null;

  for (const segment of route.segments) {
    if (segment.level !== level || segment.coordinates.length < 2) {
      continue;
    }

    bounds = mergeBounds(bounds, coordinatesBounds(segment.coordinates));
  }

  return bounds;
};

const mapPaddingForFrame = (
  showControls: boolean,
  controlsHidden: boolean,
): maplibregl.PaddingOptions => {
  if (!showControls) {
    return BASE_MAP_PADDING;
  }

  return controlsHidden ? TOOLBAR_COLLAPSED_MAP_PADDING : TOOLBAR_MAP_PADDING;
};

const fitLevelBounds = (
  map: maplibregl.Map,
  level: LevelId,
  levels: LevelMeta[],
  collections: IndoorCollections,
  mode: MapSceneMode,
  padding: maplibregl.PaddingOptions,
  duration: number,
) => {
  const preset = SCENE_PRESETS[mode];
  const levelMeta = getLevelMeta(levels, level);
  const bounds = levelGeometryBounds(collections, level);

  if (!bounds) {
    map.flyTo({
      center: levelMeta.defaultCenter,
      zoom: levelMeta.defaultZoom + preset.zoomOffset,
      pitch: preset.pitch,
      bearing: preset.bearing,
      duration,
      essential: true,
    });
    return;
  }

  map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    {
      padding,
      maxZoom: levelMeta.defaultZoom + preset.zoomOffset,
      pitch: preset.pitch,
      bearing: preset.bearing,
      duration,
      essential: true,
    },
  );
};

const fitRouteBounds = (
  map: maplibregl.Map,
  route: RouteResult,
  level: LevelId,
  padding: maplibregl.PaddingOptions,
  pitch: number,
  bearing: number,
  duration: number,
) => {
  const bounds = routeBoundsForLevel(route, level);

  if (!bounds) {
    return false;
  }

  map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    {
      padding,
      maxZoom: 21.25,
      pitch,
      bearing,
      duration,
      essential: true,
    },
  );

  return true;
};

const parseColor = (value: string): RGBAColor => {
  if (value.startsWith("#")) {
    const normalized = value.slice(1);
    const hex = normalized.length === 3
      ? normalized.split("").map((part) => `${part}${part}`).join("")
      : normalized;

    const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
    const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;

    return [red, green, blue, 1];
  }

  const rgbaMatch = value.match(/^rgba?\(([^)]+)\)$/i);

  if (!rgbaMatch) {
    return [1, 1, 1, 1];
  }

  const [red = "255", green = "255", blue = "255", alpha = "1"] = rgbaMatch[1]?.split(",").map((part) => part.trim()) ?? [];
  return [
    Number.parseFloat(red) / 255,
    Number.parseFloat(green) / 255,
    Number.parseFloat(blue) / 255,
    Number.parseFloat(alpha),
  ];
};

const sampleRouteCoordinates = (coordinates: Coordinate[]) => {
  const sampled: Coordinate[] = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];

    if (!start || !end) {
      continue;
    }

    if (sampled.length === 0) {
      sampled.push(start);
    }

    const steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / ROUTE_SAMPLE_STEP));

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      sampled.push([
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress,
      ]);
    }
  }

  return sampled;
};

const mercatorVerticesFromCoordinates = (coordinates: Coordinate[]) => new Float32Array(
  coordinates.flatMap((coordinate) => {
    const mercator = maplibregl.MercatorCoordinate.fromLngLat({ lng: coordinate[0], lat: coordinate[1] });
    return [mercator.x, mercator.y];
  }),
);

const buildCustomRouteVertices = (route: RouteResult | null, level: LevelId) => {
  if (!route) {
    return {
      pathVertices: new Float32Array(),
      terminalVertices: new Float32Array(),
    };
  }

  const routeCollection = buildRouteCollection(route);
  const routeMarkerCollection = buildRouteMarkerCollection(route);
  const activeSegments = routeCollection.features.filter((feature) => feature.properties.level === level);
  const terminalCoordinates = routeMarkerCollection.features
    .filter((feature) => feature.properties.level === level && feature.properties.terminal)
    .map((feature) => feature.geometry.coordinates as Coordinate);

  return {
    pathVertices: mercatorVerticesFromCoordinates(
      activeSegments.flatMap((feature) => sampleRouteCoordinates(feature.geometry.coordinates as Coordinate[])),
    ),
    terminalVertices: mercatorVerticesFromCoordinates(terminalCoordinates),
  };
};

const buildRouteBreadcrumbCollection = (route: RouteResult | null) => {
  const markerCollection = buildRouteMarkerCollection(route);

  return {
    ...markerCollection,
    features: markerCollection.features.filter((feature) => feature.properties.terminal),
  };
};

const hasRouteOnLevel = (route: RouteResult | null, level: LevelId) =>
  buildRouteCollection(route).features.some((feature) => feature.properties.level === level);

const syncRouteBreadcrumbPresentation = (
  map: maplibregl.Map,
  palette: (typeof MAP_PALETTES)[MapThemeVariant],
) => {
  if (map.getLayer("route-breadcrumb-glow")) {
    map.setPaintProperty("route-breadcrumb-glow", "circle-color", palette.routeCasing);
    map.setPaintProperty("route-breadcrumb-glow", "circle-radius", 4.2);
    map.setPaintProperty("route-breadcrumb-glow", "circle-opacity", 0.5);
  }

  if (map.getLayer("route-path-glow")) {
    map.setPaintProperty("route-path-glow", "line-color", palette.routeCasing);
    map.setPaintProperty("route-path-glow", "line-width", [
      "interpolate",
      ["linear"],
      ["zoom"],
      16,
      8,
      20,
      11,
      22,
      13,
    ]);
    map.setPaintProperty("route-path-glow", "line-opacity", 0.88);
    map.setPaintProperty("route-path-glow", "line-blur", 0.7);
  }

  if (map.getLayer("route-path")) {
    map.setPaintProperty("route-path", "line-color", palette.routeLine);
    map.setPaintProperty("route-path", "line-width", [
      "interpolate",
      ["linear"],
      ["zoom"],
      16,
      3.2,
      20,
      4.6,
      22,
      5.8,
    ]);
    map.setPaintProperty("route-path", "line-opacity", 1);
  }

  if (map.getLayer("route-breadcrumb")) {
    map.setPaintProperty("route-breadcrumb", "circle-color", palette.routeLine);
    map.setPaintProperty("route-breadcrumb", "circle-radius", 1.45);
    map.setPaintProperty("route-breadcrumb", "circle-opacity", 0.92);
  }

  if (map.getLayer("route-terminal-glow")) {
    map.setPaintProperty("route-terminal-glow", "circle-color", palette.routeCasing);
    map.setPaintProperty("route-terminal-glow", "circle-radius", 12.5);
    map.setPaintProperty("route-terminal-glow", "circle-opacity", 0.96);
  }

  if (map.getLayer("route-terminal")) {
    map.setPaintProperty("route-terminal", "circle-color", palette.routeLine);
    map.setPaintProperty("route-terminal", "circle-stroke-color", palette.routeCasing);
    map.setPaintProperty("route-terminal", "circle-radius", 5.4);
    map.setPaintProperty("route-terminal", "circle-stroke-width", 2.6);
    map.setPaintProperty("route-terminal", "circle-opacity", 1);
  }
};

const createShader = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
) => {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("Failed to create route shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(`Route shader compilation failed: ${log}`);
  }

  return shader;
};

const createProgram = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Failed to create route program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "Unknown program link error.";
    gl.deleteProgram(program);
    throw new Error(`Route program linking failed: ${log}`);
  }

  return program;
};

const createRouteCustomLayer = (palette: MapPalette): RouteCustomLayer => ({
  id: ROUTE_CUSTOM_LAYER_ID,
  type: "custom",
  renderingMode: "2d",
  pathVertexCount: 0,
  terminalVertexCount: 0,
  pathVertices: new Float32Array(),
  terminalVertices: new Float32Array(),
  colors: {
    casing: parseColor(palette.routeCasing),
    line: parseColor(palette.routeLine),
  },
  hasLoggedRender: false,
  uploadBuffers() {
    const gl = this.gl;

    if (!gl || !this.pathBuffer || !this.terminalBuffer) {
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.pathVertices ?? new Float32Array(), gl.STATIC_DRAW);
    this.pathVertexCount = (this.pathVertices?.length ?? 0) / 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.terminalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.terminalVertices ?? new Float32Array(), gl.STATIC_DRAW);
    this.terminalVertexCount = (this.terminalVertices?.length ?? 0) / 2;
  },
  updateData(route, level) {
    const { pathVertices, terminalVertices } = buildCustomRouteVertices(route, level);
    this.pathVertices = pathVertices;
    this.terminalVertices = terminalVertices;
    this.hasLoggedRender = false;
    this.uploadBuffers();
    console.debug("[route:maplibre] uploaded route vertices", {
      level,
      hasRoute: Boolean(route),
      pathVertexCount: pathVertices.length / 2,
      terminalVertexCount: terminalVertices.length / 2,
    });
    this.map?.triggerRepaint();
  },
  updatePalette(nextPalette) {
    this.colors = {
      casing: parseColor(nextPalette.routeCasing),
      line: parseColor(nextPalette.routeLine),
    };
    this.map?.triggerRepaint();
  },
  onAdd(map, gl) {
    this.map = map;
    this.gl = gl;

    const vertexSource = `
      precision mediump float;
      attribute vec2 a_pos;
      uniform mat4 u_matrix;
      uniform float u_point_size;

      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
        gl_PointSize = u_point_size;
      }
    `;

    const fragmentSource = `
      precision mediump float;
      uniform vec4 u_color;

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);

        if (dot(centered, centered) > 0.25) {
          discard;
        }

        gl_FragColor = u_color;
      }
    `;

    this.program = createProgram(gl, vertexSource, fragmentSource);
    this.pathBuffer = gl.createBuffer();
    this.terminalBuffer = gl.createBuffer();
    this.aPos = gl.getAttribLocation(this.program, "a_pos");
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    this.uPointSize = gl.getUniformLocation(this.program, "u_point_size");
    this.uColor = gl.getUniformLocation(this.program, "u_color");
    this.uploadBuffers();
  },
  render(gl, renderInput: CustomRenderMethodInput) {
    if (!this.program || this.aPos === undefined || !this.uMatrix || !this.uPointSize || !this.uColor) {
      return;
    }

    const projectionMatrix = renderInput.defaultProjectionData.mainMatrix ?? renderInput.modelViewProjectionMatrix;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMatrix, false, projectionMatrix);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    if (!this.hasLoggedRender && (this.pathVertexCount > 0 || this.terminalVertexCount > 0)) {
      this.hasLoggedRender = true;
      console.debug("[route:maplibre] rendering route layer", {
        pathVertexCount: this.pathVertexCount,
        terminalVertexCount: this.terminalVertexCount,
        projectionVariant: renderInput.shaderData.variantName,
      });
    }

    if (this.pathBuffer && this.pathVertexCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(this.uPointSize, 11);
      gl.uniform4f(this.uColor, ...this.colors.casing);
      gl.drawArrays(gl.POINTS, 0, this.pathVertexCount);

      gl.uniform1f(this.uPointSize, 5.5);
      gl.uniform4f(this.uColor, ...this.colors.line);
      gl.drawArrays(gl.POINTS, 0, this.pathVertexCount);
    }

    if (this.terminalBuffer && this.terminalVertexCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.terminalBuffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(this.uPointSize, 16);
      gl.uniform4f(this.uColor, ...this.colors.casing);
      gl.drawArrays(gl.POINTS, 0, this.terminalVertexCount);

      gl.uniform1f(this.uPointSize, 9);
      gl.uniform4f(this.uColor, ...this.colors.line);
      gl.drawArrays(gl.POINTS, 0, this.terminalVertexCount);
    }

    gl.enable(gl.DEPTH_TEST);
  },
  onRemove(_map, gl) {
    if (this.pathBuffer) {
      gl.deleteBuffer(this.pathBuffer);
      this.pathBuffer = null;
    }

    if (this.terminalBuffer) {
      gl.deleteBuffer(this.terminalBuffer);
      this.terminalBuffer = null;
    }

    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
  },
});

const updateFilters = (map: maplibregl.Map, level: LevelId) => {
  const hasLayer = (layerId: FilteredLayerId) => Boolean(map.getLayer(layerId));

  if (hasLayer("zone-fill")) {
    map.setFilter("zone-fill", floorFilter(level, ["zone"], "Polygon"));
  }

  if (hasLayer("room-fill")) {
    map.setFilter("room-fill", floorFilter(level, ["room", "meeting_room", "amenity"], "Polygon"));
  }

  if (hasLayer("selection-area-fill")) {
    map.setFilter("selection-area-fill", ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "role"], "shape"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("room-outline")) {
    map.setFilter("room-outline", floorFilter(level, ["room", "meeting_room", "amenity"], "Polygon"));
  }

  if (hasLayer("selection-area-glow")) {
    map.setFilter("selection-area-glow", ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "role"], "shape"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("selection-area-outline")) {
    map.setFilter("selection-area-outline", ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "role"], "shape"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("room-labels")) {
    map.setFilter("room-labels", floorFilter(level, ["room", "meeting_room", "amenity"], "Point"));
  }

  if (hasLayer("room-hit-area")) {
    map.setFilter("room-hit-area", floorFilter(level, ["room", "meeting_room", "amenity"], "Polygon"));
  }

  if (hasLayer("wall-extrusion")) {
    map.setFilter("wall-extrusion", floorFilter(level, ["wall"], "Polygon"));
  }

  if (hasLayer("door-line")) {
    map.setFilter("door-line", floorFilter(level, ["door"], "LineString"));
  }

  if (hasLayer("connector-structure")) {
    map.setFilter("connector-structure", departmentFilter(level, ["furniture"], "Polygon", "Вертикальные связи"));
  }

  if (hasLayer("furniture-extrusion")) {
    map.setFilter("furniture-extrusion", excludedDepartmentFilter(level, ["furniture"], "Polygon", "Вертикальные связи"));
  }

  if (hasLayer("poi-circle")) {
    map.setFilter("poi-circle", floorFilter(level, ["workstation", "connector"], "Point"));
  }

  if (hasLayer("poi-labels")) {
    map.setFilter("poi-labels", floorFilter(level, ["workstation", "connector"], "Point"));
  }

  if (hasLayer("selection-halo")) {
    map.setFilter("selection-halo", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "marker"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("selection-core")) {
    map.setFilter("selection-core", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "marker"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("route-path-glow")) {
    map.setFilter("route-path-glow", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("route-path")) {
    map.setFilter("route-path", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("route-breadcrumb-glow")) {
    map.setFilter("route-breadcrumb-glow", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], level], ["==", ["get", "terminal"], false]]);
  }

  if (hasLayer("route-breadcrumb")) {
    map.setFilter("route-breadcrumb", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], level], ["==", ["get", "terminal"], false]]);
  }

  if (hasLayer("route-terminal-glow")) {
    map.setFilter("route-terminal-glow", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], level], ["==", ["get", "terminal"], true]]);
  }

  if (hasLayer("route-terminal")) {
    map.setFilter("route-terminal", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], level], ["==", ["get", "terminal"], true]]);
  }
};

const interactiveLayerOrder: string[] = ["poi-circle", "poi-labels", "room-labels", "room-fill", "zone-fill", "room-hit-area"];
const selectableFeatureKinds: FeatureKind[] = ["room", "meeting_room", "amenity"];
const preferredInteractiveKinds: FeatureKind[] = ["workstation", "connector", "meeting_room", "room", "amenity"];

const buildSelectionCollection = (feature: OfficeFeature | null) => ({
  type: "FeatureCollection" as const,
  features: feature
    ? [
        {
          type: "Feature" as const,
          id: feature.id,
          geometry: feature.geometry,
          properties: {
            featureId: feature.id,
            level: feature.properties.level,
            kind: feature.properties.kind,
            role: "shape",
          },
        },
        {
          type: "Feature" as const,
          id: `${feature.id}::marker`,
          geometry: {
            type: "Point" as const,
            coordinates:
              feature.geometry.type === "Polygon"
                ? [feature.properties.focusPoint[0], feature.properties.focusPoint[1] - 0.35]
                : feature.properties.focusPoint,
          },
          properties: {
            featureId: feature.id,
            level: feature.properties.level,
            kind: feature.properties.kind,
            role: "marker",
          },
        },
      ]
    : [],
});

const toFeatureId = (featureId: string | number | undefined): string | null => {
  if (typeof featureId === "string") {
    return featureId;
  }

  if (typeof featureId === "number") {
    return String(featureId);
  }

  return null;
};

const canonicalFeatureId = (featureById: Map<string, OfficeFeature>, feature: maplibregl.MapGeoJSONFeature) => {
  const candidate = feature.properties?.featureId;

  if (typeof candidate === "string" && featureById.has(candidate)) {
    return candidate;
  }

  const fallbackId = toFeatureId(feature.id);
  return fallbackId && featureById.has(fallbackId) ? fallbackId : null;
};

const pickInteractiveFeatureId = (featureById: Map<string, OfficeFeature>, features: maplibregl.MapGeoJSONFeature[] | undefined) => {
  if (!features || features.length === 0) {
    return null;
  }

  for (const kind of preferredInteractiveKinds) {
    const match = features.find(
      (feature) =>
        feature.properties &&
        feature.properties.kind === kind,
    );

    if (match) {
      return canonicalFeatureId(featureById, match);
    }
  }

  const fallback = features.find((feature) => feature.id !== undefined);
  return fallback ? canonicalFeatureId(featureById, fallback) : null;
};

const polygonArea = (coordinates: Coordinate[]) => {
  let area = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const current = coordinates[index];
    const next = coordinates[index + 1];

    if (!current || !next) {
      continue;
    }

    area += current[0] * next[1] - next[0] * current[1];
  }

  return Math.abs(area / 2);
};

const toCoordinate = (position: readonly number[]): Coordinate | null => {
  const [longitude, latitude] = position;

  if (typeof longitude !== "number" || typeof latitude !== "number") {
    return null;
  }

  return [longitude, latitude];
};

const toCoordinateRing = (positions: readonly (readonly number[])[]) => positions.map(toCoordinate).filter((coordinate) => coordinate !== null);

const isPointInRing = (point: Coordinate, ring: Coordinate[]) => {
  let inside = false;

  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] < ((previous[0] - current[0]) * (point[1] - current[1])) / ((previous[1] - current[1]) || Number.EPSILON) + current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const pickRoomFeatureIdAtLngLat = (
  selectableSpaceFeatures: OfficePolygonFeature[],
  level: LevelId,
  lngLat: maplibregl.LngLat,
) => {
  const point: Coordinate = [lngLat.lng, lngLat.lat];
  const candidates = selectableSpaceFeatures
    .filter(
      (feature) =>
        feature.properties.level === level &&
        selectableFeatureKinds.includes(feature.properties.kind),
    )
    .map((feature) => {
      const ring = toCoordinateRing(feature.geometry.coordinates[0] ?? []);

      return {
        feature,
        ring,
        area: polygonArea(ring),
      };
    })
    .sort((left, right) => left.area - right.area);

  for (const candidate of candidates) {
    if (isPointInRing(point, candidate.ring)) {
      return candidate.feature.id;
    }
  }

  return null;
};

const setFeatureState = (
  featureSourceById: Map<string, FeatureSourceId>,
  featureLabelSourceById: Map<string, FeatureLabelSourceId>,
  map: maplibregl.Map,
  featureId: string | null,
  key: "hover" | "selected",
  value: boolean,
) => {
  if (!featureId) {
    return;
  }

  const source = featureSourceById.get(featureId);
  const labelSource = featureLabelSourceById.get(featureId);

  if (!source) {
    if (!labelSource) {
      return;
    }
  } else {
    map.setFeatureState({ source, id: featureId }, { [key]: value });
  }

  if (labelSource) {
    map.setFeatureState({ source: labelSource, id: featureId }, { [key]: value });
  }
};

const coordinateDistance = (left: Coordinate, right: Coordinate) =>
  Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]);

const isGeoJsonSource = (
  source: ReturnType<maplibregl.Map["getSource"]>,
): source is maplibregl.GeoJSONSource => {
  if (!source) {
    return false;
  }

  return source.type === "geojson" && "setData" in source;
};

interface PendingFocusRequest {
  requestId: number;
  featureId: string;
  level: LevelId;
  center: Coordinate;
}

export interface MapCanvasProps {
  activeLevel: LevelId;
  collections: IndoorCollections;
  externalSceneMode?: MapSceneMode;
  featureById: Map<string, OfficeFeature>;
  featureLabelSourceById: Map<string, FeatureLabelSourceId>;
  featureSourceById: Map<string, FeatureSourceId>;
  focusRequestId: number;
  levels: LevelMeta[];
  showControls?: boolean;
  themeVariant?: MapThemeVariant;
  selectedFeatureId: string | null;
  route: RouteResult | null;
  selectableSpaceFeatures: OfficePolygonFeature[];
  zoomCommand?: { id: number; delta: 1 | -1 } | null;
  onSelectFeature: (featureId: string) => void;
}

export function MapCanvas({
  activeLevel,
  collections,
  externalSceneMode,
  featureById,
  featureLabelSourceById,
  featureSourceById,
  focusRequestId,
  levels,
  showControls = true,
  themeVariant = "light",
  selectedFeatureId,
  route,
  selectableSpaceFeatures,
  zoomCommand,
  onSelectFeature,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const routeCustomLayerRef = useRef<RouteCustomLayer | null>(null);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const activeLevelRef = useRef(activeLevel);
  const routeRef = useRef(route);
  const onSelectFeatureRef = useRef(onSelectFeature);
  const pendingFocusRef = useRef<PendingFocusRequest | null>(null);
  const focusPulseTimerRef = useRef<number | null>(null);
  const handledFocusRequestIdRef = useRef(focusRequestId);
  const processedZoomCommandIdRef = useRef(0);
  const [sceneMode, setSceneMode] = useState<MapSceneMode>(externalSceneMode ?? DEFAULT_SCENE_MODE);
  const [pitch, setPitch] = useState<number>(SCENE_PRESETS[externalSceneMode ?? DEFAULT_SCENE_MODE].pitch);
  const [bearing, setBearing] = useState<number>(SCENE_PRESETS[externalSceneMode ?? DEFAULT_SCENE_MODE].bearing);
  const [orbitEnabled, setOrbitEnabled] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const palette = MAP_PALETTES[themeVariant];
  const selectedFeature = selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null;
  const normalizedBearing = ((Math.round(bearing) % 360) + 360) % 360;
  const roundedPitch = Math.round(pitch);
  const activeFramePadding = mapPaddingForFrame(showControls, controlsHidden);

  const clearFocusPulseTimer = () => {
    const timerId = focusPulseTimerRef.current;

    if (timerId === null) {
      return;
    }

    window.clearTimeout(timerId);
    focusPulseTimerRef.current = null;
  };

  const runFocusRequest = (map: maplibregl.Map, request: PendingFocusRequest) => {
    const latestRequest = pendingFocusRef.current;

    if (!latestRequest || latestRequest.requestId !== request.requestId) {
      return;
    }

    clearFocusPulseTimer();

    const currentCenter = map.getCenter();
    const currentCoordinate: Coordinate = [currentCenter.lng, currentCenter.lat];
    const targetZoom = 21;
    const needsPulse = coordinateDistance(currentCoordinate, request.center) < 0.0000015;

    if (needsPulse) {
      map.easeTo({
        center: request.center,
        zoom: Math.max(map.getZoom(), targetZoom) + 0.55,
        duration: 240,
        essential: true,
      });

      focusPulseTimerRef.current = window.setTimeout(() => {
        const activeRequest = pendingFocusRef.current;

        if (!activeRequest || activeRequest.requestId !== request.requestId) {
          return;
        }

        map.easeTo({
          center: request.center,
          zoom: targetZoom,
          duration: 320,
          essential: true,
        });
        pendingFocusRef.current = null;
        focusPulseTimerRef.current = null;
      }, 240);

      return;
    }

    map.flyTo({
      center: request.center,
      zoom: targetZoom,
      duration: 760,
      essential: true,
    });
    pendingFocusRef.current = null;
  };

  const syncSelectionState = (map: maplibregl.Map) => {
    updateFilters(map, activeLevel);

    const selectionSource = map.getSource(SELECTION_SOURCE);

    if (isGeoJsonSource(selectionSource)) {
      selectionSource.setData(buildSelectionCollection(selectedFeature));
    }

    setFeatureState(featureSourceById, featureLabelSourceById, map, selectedRef.current, "selected", false);
    selectedRef.current = selectedFeatureId;
    setFeatureState(featureSourceById, featureLabelSourceById, map, selectedRef.current, "selected", true);
    map.triggerRepaint();

    const hasFreshSelectionFocus =
      selectedFeature !== null &&
      selectedFeature.properties.level === activeLevel &&
      focusRequestId > handledFocusRequestIdRef.current;

    if (hasFreshSelectionFocus && selectedFeature) {
      handledFocusRequestIdRef.current = focusRequestId;

      if (selectedFeature.properties.level === activeLevel) {
        const request: PendingFocusRequest = {
          requestId: focusRequestId,
          featureId: selectedFeature.id,
          level: selectedFeature.properties.level,
          center: selectedFeature.properties.focusPoint,
        };

        pendingFocusRef.current = request;
        runFocusRequest(map, request);
        return true;
      }
    }

    pendingFocusRef.current = null;
    clearFocusPulseTimer();
    return false;
  };

  const syncRouteBreadcrumbRendering = (map: maplibregl.Map) => {
    const currentRoute = routeRef.current;
    const currentLevel = activeLevelRef.current;
    const routePathSource = map.getSource(ROUTE_PATH_SOURCE);
    const routeBreadcrumbSource = map.getSource(ROUTE_BREADCRUMB_SOURCE);

    if (!isGeoJsonSource(routePathSource) || !isGeoJsonSource(routeBreadcrumbSource)) {
      console.debug("[route:maplibre-fallback] route sources unavailable", {
        currentLevel,
        hasRoute: Boolean(currentRoute),
        hasRoutePathSource: isGeoJsonSource(routePathSource),
        hasRouteMarkerSource: isGeoJsonSource(routeBreadcrumbSource),
      });
      return false;
    }

    const routeCollection = buildRouteCollection(currentRoute);
    const breadcrumbCollection = buildRouteBreadcrumbCollection(currentRoute);
    routePathSource.setData(routeCollection);
    routeBreadcrumbSource.setData(breadcrumbCollection);
    updateFilters(map, currentLevel);
    syncRouteBreadcrumbPresentation(map, palette);

    if (map.getLayer("route-path-glow")) {
      map.moveLayer("route-path-glow");
    }

    if (map.getLayer("route-path")) {
      map.moveLayer("route-path");
    }

    if (map.getLayer("route-breadcrumb-glow")) {
      map.moveLayer("route-breadcrumb-glow");
    }

    if (map.getLayer("route-breadcrumb")) {
      map.moveLayer("route-breadcrumb");
    }

    if (map.getLayer("route-terminal-glow")) {
      map.moveLayer("route-terminal-glow");
    }

    if (map.getLayer("route-terminal")) {
      map.moveLayer("route-terminal");
    }

    map.triggerRepaint();

    const hasRouteOnActiveLevel = breadcrumbCollection.features.some((feature) => feature.properties.level === currentLevel);

    console.debug("[route:maplibre-fallback] synced breadcrumb route", {
      currentLevel,
      hasRoute: Boolean(currentRoute),
      segmentCount: routeCollection.features.length,
      featureCount: breadcrumbCollection.features.length,
      hasRouteOnActiveLevel,
    });

    return hasRouteOnActiveLevel;
  };

  useEffect(() => {
    activeLevelRef.current = activeLevel;
  }, [activeLevel]);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    onSelectFeatureRef.current = onSelectFeature;
  }, [onSelectFeature]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const levelMeta = getLevelMeta(levels, activeLevel);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleForTheme(themeVariant),
      center: levelMeta.defaultCenter,
      zoom: levelMeta.defaultZoom + DEFAULT_SCENE_PRESET.zoomOffset,
      pitch: DEFAULT_SCENE_PRESET.pitch,
      bearing: DEFAULT_SCENE_PRESET.bearing,
      attributionControl: false,
    });

    map.on("load", () => {
      map.addSource(SPACE_SOURCE, { type: "geojson", data: collections.spaces });
      map.addSource(STRUCTURE_SOURCE, { type: "geojson", data: collections.structures });
      map.addSource(POI_SOURCE, { type: "geojson", data: collections.pois });
      map.addSource(ROOM_LABEL_SOURCE, { type: "geojson", data: collections.roomLabels });
      map.addSource(POI_LABEL_SOURCE, { type: "geojson", data: collections.poiLabels });
      map.addSource(ROUTE_PATH_SOURCE, { type: "geojson", data: buildRouteCollection(routeRef.current) });
      map.addSource(ROUTE_BREADCRUMB_SOURCE, { type: "geojson", data: buildRouteBreadcrumbCollection(routeRef.current) });
      map.addSource(SELECTION_SOURCE, { type: "geojson", data: buildSelectionCollection(selectedFeature) });

      console.debug("[route:map] map loaded", {
        activeLevel: activeLevelRef.current,
        hasRoute: Boolean(routeRef.current),
      });

      map.addLayer({
        id: "zone-fill",
        type: "fill",
        source: SPACE_SOURCE,
        filter: floorFilter(activeLevel, ["zone"], "Polygon"),
        paint: {
          "fill-color": zoneFillExpression(palette),
          "fill-opacity": 0.62,
        },
      });

      map.addLayer({
        id: "room-fill",
        type: "fill",
        source: SPACE_SOURCE,
        filter: floorFilter(activeLevel, ["room", "meeting_room", "amenity"], "Polygon"),
        paint: {
          "fill-color": roomFillExpression(palette),
          "fill-opacity": 0.86,
        },
      });

      map.addLayer({
        id: "selection-area-fill",
        type: "fill",
        source: SELECTION_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "role"], "shape"], ["==", ["get", "level"], activeLevel]],
        paint: {
          "fill-color": palette.selectedFill,
          "fill-opacity": 0.2,
        },
      });

      map.addLayer({
        id: "room-outline",
        type: "line",
        source: SPACE_SOURCE,
        filter: floorFilter(activeLevel, ["room", "meeting_room", "amenity"], "Polygon"),
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            palette.selectedOutline,
            ["boolean", ["feature-state", "hover"], false],
            palette.hoverOutline,
            palette.outline,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            4,
            ["boolean", ["feature-state", "hover"], false],
            3,
            2,
          ],
        },
      });

      map.addLayer({
        id: "wall-extrusion",
        type: "fill-extrusion",
        source: STRUCTURE_SOURCE,
        filter: floorFilter(activeLevel, ["wall"], "Polygon"),
        paint: {
          "fill-extrusion-color": palette.wall,
          "fill-extrusion-base": ["coalesce", ["get", "baseHeight"], 0],
          "fill-extrusion-height": ["coalesce", ["get", "height"], 3],
          "fill-extrusion-opacity": palette.wallOpacity,
        },
      });

      map.addLayer({
        id: "door-line",
        type: "line",
        source: STRUCTURE_SOURCE,
        filter: floorFilter(activeLevel, ["door"], "LineString"),
        paint: {
          "line-color": palette.door,
          "line-width": 3,
          "line-opacity": 0.95,
        },
      });

      map.addLayer({
        id: "room-hit-area",
        type: "fill",
        source: SPACE_SOURCE,
        filter: floorFilter(activeLevel, ["room", "meeting_room", "amenity"], "Polygon"),
        paint: {
          "fill-color": "#000000",
          "fill-opacity": 0.001,
        },
      });

      map.addLayer({
        id: "furniture-extrusion",
        type: "fill-extrusion",
        source: STRUCTURE_SOURCE,
        filter: excludedDepartmentFilter(activeLevel, ["furniture"], "Polygon", "Вертикальные связи"),
        paint: {
          "fill-extrusion-color": palette.furniture,
          "fill-extrusion-base": ["coalesce", ["get", "baseHeight"], 0],
          "fill-extrusion-height": ["coalesce", ["get", "height"], 1],
          "fill-extrusion-opacity": 0.46,
        },
      });

      map.addLayer({
        id: "connector-structure",
        type: "fill-extrusion",
        source: STRUCTURE_SOURCE,
        filter: departmentFilter(activeLevel, ["furniture"], "Polygon", "Вертикальные связи"),
        paint: {
          "fill-extrusion-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            palette.connectorSelected,
            palette.connector,
          ],
          "fill-extrusion-base": ["coalesce", ["get", "baseHeight"], 0],
          "fill-extrusion-height": ["coalesce", ["get", "height"], 1],
          "fill-extrusion-opacity": 0.86,
        },
      });

      map.addLayer({
        id: "selection-area-glow",
        type: "line",
        source: SELECTION_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "role"], "shape"], ["==", ["get", "level"], activeLevel]],
        layout: {
          "line-join": "round",
        },
        paint: {
          "line-color": palette.selectedOutline,
          "line-width": 9,
          "line-opacity": 0.22,
          "line-blur": 1.1,
        },
      });

      map.addLayer({
        id: "selection-area-outline",
        type: "line",
        source: SELECTION_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "role"], "shape"], ["==", ["get", "level"], activeLevel]],
        layout: {
          "line-join": "round",
        },
        paint: {
          "line-color": palette.selectedOutline,
          "line-width": 3.2,
          "line-opacity": 0.98,
        },
      });

      const routeCustomLayer = createRouteCustomLayer(palette);
      routeCustomLayer.updateData(routeRef.current, activeLevelRef.current);
      routeCustomLayerRef.current = routeCustomLayer;
      map.addLayer(routeCustomLayer);

      map.addLayer({
        id: "poi-circle",
        type: "circle",
        source: POI_SOURCE,
        filter: floorFilter(activeLevel, ["workstation", "connector"], "Point"),
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "kind"], "connector"],
            5.5,
            5,
          ],
          "circle-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            palette.poiSelected,
            ["boolean", ["feature-state", "hover"], false],
            palette.poiHover,
            ["==", ["get", "kind"], "connector"],
            palette.connectorPoi,
            palette.workstation,
          ],
          "circle-stroke-color": "#f7fafc",
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "selection-halo",
        type: "circle",
        source: SELECTION_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "marker"], ["==", ["get", "level"], activeLevel]],
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "kind"], "connector"],
            14,
            ["==", ["get", "kind"], "workstation"],
            13,
            12,
          ],
          "circle-color": palette.selectedOutline,
          "circle-opacity": 0.12,
          "circle-stroke-color": palette.selectedOutline,
          "circle-stroke-width": 1.6,
          "circle-stroke-opacity": 0.32,
        },
      });

      map.addLayer({
        id: "selection-core",
        type: "circle",
        source: SELECTION_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "marker"], ["==", ["get", "level"], activeLevel]],
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "kind"], "connector"],
            5,
            ["==", ["get", "kind"], "workstation"],
            4.5,
            4.5,
          ],
          "circle-color": palette.selectedFill,
          "circle-stroke-color": palette.labelHalo,
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "route-path-glow",
        type: "line",
        source: ROUTE_PATH_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], activeLevel]],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": palette.routeCasing,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            16,
            8,
            20,
            11,
            22,
            13,
          ],
          "line-opacity": 0.88,
          "line-blur": 0.7,
        },
      });

      map.addLayer({
        id: "route-path",
        type: "line",
        source: ROUTE_PATH_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], activeLevel]],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": palette.routeLine,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            16,
            3.2,
            20,
            4.6,
            22,
            5.8,
          ],
          "line-opacity": 1,
        },
      });

      map.addLayer({
        id: "route-breadcrumb-glow",
        type: "circle",
        source: ROUTE_BREADCRUMB_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], activeLevel], ["==", ["get", "terminal"], false]],
        paint: {
          "circle-radius": 4.2,
          "circle-color": palette.routeCasing,
          "circle-opacity": 0.5,
          "circle-blur": 0.2,
        },
      });

      map.addLayer({
        id: "route-breadcrumb",
        type: "circle",
        source: ROUTE_BREADCRUMB_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], activeLevel], ["==", ["get", "terminal"], false]],
        paint: {
          "circle-radius": 1.45,
          "circle-color": palette.routeLine,
          "circle-opacity": 0.92,
        },
      });

      map.addLayer({
        id: "route-terminal-glow",
        type: "circle",
        source: ROUTE_BREADCRUMB_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], activeLevel], ["==", ["get", "terminal"], true]],
        paint: {
          "circle-radius": 12.5,
          "circle-color": palette.routeCasing,
          "circle-opacity": 0.96,
          "circle-blur": 0.25,
        },
      });

      map.addLayer({
        id: "route-terminal",
        type: "circle",
        source: ROUTE_BREADCRUMB_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "level"], activeLevel], ["==", ["get", "terminal"], true]],
        paint: {
          "circle-radius": 5.4,
          "circle-color": palette.routeLine,
          "circle-stroke-color": palette.routeCasing,
          "circle-stroke-width": 2.6,
          "circle-opacity": 1,
        },
      });

      map.addLayer({
        id: "poi-labels",
        type: "symbol",
        source: POI_LABEL_SOURCE,
        filter: floorFilter(activeLevel, ["workstation", "connector"], "Point"),
        layout: {
          "text-field": [
            "case",
            ["==", ["get", "kind"], "connector"],
            ["get", "name"],
            ["coalesce", ["get", "employee"], ["get", "name"]],
          ],
          "text-size": [
            "case",
            ["==", ["get", "kind"], "connector"],
            10,
            10.5,
          ],
          "text-offset": [
            "case",
            ["==", ["get", "kind"], "connector"],
            ["literal", [0, 0.85]],
            ["literal", [0, 1.2]],
          ],
          "text-font": ["Open Sans Semibold"],
          "text-max-width": 9,
        },
        paint: {
          "text-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            palette.labelSelected,
            ["boolean", ["feature-state", "hover"], false],
            palette.labelHover,
            palette.label,
          ],
          "text-halo-color": palette.labelHalo,
          "text-halo-width": 1.25,
        },
      });

      map.addLayer({
        id: "room-labels",
        type: "symbol",
        source: ROOM_LABEL_SOURCE,
        filter: floorFilter(activeLevel, ["room", "meeting_room", "amenity"], "Point"),
        layout: {
          "text-field": ["get", "name"],
          "text-size": [
            "case",
            ["==", ["get", "kind"], "meeting_room"],
            12.5,
            11.5,
          ],
          "text-font": ["Open Sans Semibold"],
          "text-allow-overlap": true,
          "text-max-width": 9,
        },
        paint: {
          "text-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            palette.labelSelected,
            ["boolean", ["feature-state", "hover"], false],
            palette.labelHover,
            palette.label,
          ],
          "text-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            1,
            0.96,
          ],
          "text-halo-color": palette.labelHalo,
          "text-halo-width": 1.6,
        },
      });

      map.moveLayer(ROUTE_CUSTOM_LAYER_ID);

      map.on("mousemove", (event) => {
        const featureId = pickInteractiveFeatureId(
          featureById,
          map.queryRenderedFeatures(event.point, { layers: [...interactiveLayerOrder] }),
        );

        if (featureId === hoverRef.current) {
          return;
        }

        setFeatureState(featureSourceById, featureLabelSourceById, map, hoverRef.current, "hover", false);
        hoverRef.current = featureId;
        setFeatureState(featureSourceById, featureLabelSourceById, map, hoverRef.current, "hover", true);
        map.getCanvas().style.cursor = featureId ? "pointer" : "";
      });

      map.on("mouseleave", () => {
        setFeatureState(featureSourceById, featureLabelSourceById, map, hoverRef.current, "hover", false);
        hoverRef.current = null;
        map.getCanvas().style.cursor = "";
      });

      map.on("click", (event) => {
        let featureId = pickInteractiveFeatureId(
          featureById,
          map.queryRenderedFeatures(event.point, { layers: [...interactiveLayerOrder] }),
        );

        if (!featureId) {
          featureId = pickRoomFeatureIdAtLngLat(selectableSpaceFeatures, activeLevelRef.current, event.lngLat);
        }

        if (!featureId) {
          return;
        }

        onSelectFeatureRef.current(featureId);
      });

      const hasRouteOnActiveLevel = syncRouteBreadcrumbRendering(map);
      const didFocusSelection = syncSelectionState(map);

      if (!didFocusSelection) {
        if (route && hasRouteOnActiveLevel && fitRouteBounds(map, route, activeLevel, activeFramePadding, pitch, bearing, 0)) {
          return;
        }

        fitLevelBounds(map, activeLevel, levels, collections, sceneMode, activeFramePadding, 0);
      }
    });

    mapRef.current = map;

    return () => {
      clearFocusPulseTimer();
      routeCustomLayerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [themeVariant]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const didFocusSelection = syncSelectionState(map);

    if (!didFocusSelection && !route) {
      fitLevelBounds(map, activeLevel, levels, collections, sceneMode, activeFramePadding, 720);
    }
  }, [
    activeFramePadding,
    activeLevel,
    collections,
    featureLabelSourceById,
    featureSourceById,
    focusRequestId,
    levels,
    route,
    sceneMode,
    selectedFeature,
    selectedFeatureId,
  ]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.easeTo({
      pitch,
      bearing,
      duration: 500,
      essential: true,
    });
  }, [bearing, pitch]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const hasRouteOnActiveLevel = syncRouteBreadcrumbRendering(map);

    if (!route) {
      return;
    }

    if (hasRouteOnActiveLevel && fitRouteBounds(map, route, activeLevel, activeFramePadding, pitch, bearing, 720)) {
      return;
    }

    fitLevelBounds(map, activeLevel, levels, collections, sceneMode, activeFramePadding, 720);
  }, [activeFramePadding, activeLevel, bearing, collections, levels, pitch, route, sceneMode]);

  useEffect(() => {
    if (!orbitEnabled) {
      return;
    }

    const timer = window.setInterval(() => {
      const map = mapRef.current;

      if (!map) {
        return;
      }

      setBearing((current) => {
        const next = current + 3;
        map.rotateTo(next, { duration: 280, easing: (value) => value });
        return next;
      });
    }, 320);

    return () => {
      window.clearInterval(timer);
    };
  }, [orbitEnabled]);

  const applySceneMode = (mode: MapSceneMode) => {
    const preset = SCENE_PRESETS[mode];
    const map = mapRef.current;

    setSceneMode(mode);
    setPitch(preset.pitch);
    setBearing(preset.bearing);

    if (!map) {
      return;
    }

    fitLevelBounds(map, activeLevel, levels, collections, mode, activeFramePadding, 800);
  };

  const rotateBy = (delta: number) => {
    setBearing((current) => current + delta);
  };

  const focusSelection = () => {
    const feature = selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null;

    if (!feature) {
      return;
    }

    const map = mapRef.current;

    if (!map) {
      return;
    }

    const request: PendingFocusRequest = {
      requestId: focusRequestId + 1,
      featureId: feature.id,
      level: feature.properties.level,
      center: feature.properties.focusPoint,
    };

    pendingFocusRef.current = request;
    runFocusRequest(map, request);
  };

  const zoomBy = (delta: 1 | -1) => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (delta > 0) {
      map.zoomIn({ duration: 180 });
      return;
    }

    map.zoomOut({ duration: 180 });
  };

  useEffect(() => {
    if (!externalSceneMode || externalSceneMode === sceneMode) {
      return;
    }

    applySceneMode(externalSceneMode);
  }, [externalSceneMode, sceneMode]);

  useEffect(() => {
    if (!zoomCommand || zoomCommand.id === processedZoomCommandIdRef.current) {
      return;
    }

    processedZoomCommandIdRef.current = zoomCommand.id;
    zoomBy(zoomCommand.delta);
  }, [zoomCommand]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const routePathSource = map.getSource(ROUTE_PATH_SOURCE);
    const routeBreadcrumbSource = map.getSource(ROUTE_BREADCRUMB_SOURCE);
    const routeCollection = buildRouteCollection(route);
    const breadcrumbCollection = buildRouteBreadcrumbCollection(route);

    if (isGeoJsonSource(routePathSource)) {
      routePathSource.setData(routeCollection);
    }

    if (isGeoJsonSource(routeBreadcrumbSource)) {
      routeBreadcrumbSource.setData(breadcrumbCollection);
      updateFilters(map, activeLevel);
      syncRouteBreadcrumbPresentation(map, palette);

      if (map.getLayer("route-path-glow")) {
        map.moveLayer("route-path-glow");
      }

      if (map.getLayer("route-path")) {
        map.moveLayer("route-path");
      }

      if (map.getLayer("route-breadcrumb-glow")) {
        map.moveLayer("route-breadcrumb-glow");
      }

      if (map.getLayer("route-breadcrumb")) {
        map.moveLayer("route-breadcrumb");
      }

      if (map.getLayer("route-terminal-glow")) {
        map.moveLayer("route-terminal-glow");
      }

      if (map.getLayer("route-terminal")) {
        map.moveLayer("route-terminal");
      }

      console.log("[route:maplibre-fallback] synced breadcrumb route", {
        activeLevel,
        hasRoute: Boolean(route),
        segmentCount: routeCollection.features.length,
        featureCount: breadcrumbCollection.features.length,
        hasRouteOnActiveLevel: breadcrumbCollection.features.some((feature) => feature.properties.level === activeLevel),
      });
    }

    routeCustomLayerRef.current?.updatePalette(palette);
    routeCustomLayerRef.current?.updateData(route, activeLevel);
  }, [activeLevel, palette, route]);

  return (
    <div className="map-frame">
      <div className="map-shell" ref={containerRef} />
      {showControls ? <div className={controlsHidden ? "map-toolbar map-toolbar-collapsed" : "map-toolbar"}>
        <div className="map-toolbar-header">
          <div className="map-toolbar-copy">
            <span className="map-toolbar-kicker">Управление видом</span>
            <strong>Сцена карты</strong>
          </div>
          <div className="map-toolbar-header-actions">
            {!controlsHidden ? <span className="map-toolbar-badge">{activeLevel}</span> : null}
            <button
              aria-expanded={!controlsHidden}
              className="map-tool map-toolbar-toggle"
              onClick={() => setControlsHidden((current) => !current)}
              type="button"
            >
              {controlsHidden ? "Показать" : "Скрыть"}
            </button>
          </div>
        </div>
        {!controlsHidden ? (
          <div className="map-toolbar-body">
            <section className="map-toolbar-section">
              <span className="map-toolbar-section-label">Режим сцены</span>
              <div className="map-toolbar-group map-toolbar-group-segmented">
                {SCENE_MODES.map((mode) => {
                  const label = SCENE_MODE_LABELS[mode];
                  const Icon = ToolbarIcons[mode];

                  return (
                    <button
                      className={mode === sceneMode ? "map-tool map-tool-active" : "map-tool"}
                      key={mode}
                      onClick={() => applySceneMode(mode)}
                      type="button"
                    >
                      <Icon />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="map-toolbar-section">
              <span className="map-toolbar-section-label">Ориентация</span>
              <div className="map-readout-grid">
                <div className="map-readout">
                  <span>Азимут</span>
                  <strong>{normalizedBearing}°</strong>
                </div>
                <div className="map-readout">
                  <span>Наклон</span>
                  <strong>{roundedPitch}°</strong>
                </div>
              </div>
              <div className="map-toolbar-group">
                <button className="map-tool" onClick={() => rotateBy(-20)} type="button">
                  <ToolbarIcons.rotateLeft />
                  <span>−20°</span>
                </button>
                <button className="map-tool" onClick={() => rotateBy(20)} type="button">
                  <ToolbarIcons.rotateRight />
                  <span>+20°</span>
                </button>
                <button
                  className={orbitEnabled ? "map-tool map-tool-active" : "map-tool"}
                  onClick={() => setOrbitEnabled((current) => !current)}
                  type="button"
                >
                  <ToolbarIcons.orbit />
                  <span>Орбита</span>
                </button>
              </div>
            </section>

            <section className="map-toolbar-section">
              <span className="map-toolbar-section-label">Наклон камеры</span>
              <label className="map-slider">
                <span>Наклон камеры</span>
                <input
                  max="75"
                  min="0"
                  onChange={(event) => {
                    setSceneMode("explore");
                    setPitch(Number(event.target.value));
                  }}
                  type="range"
                  value={pitch}
                />
              </label>
            </section>

            {selectedFeature ? (
              <div className="map-focus-row">
                <div className="map-focus-copy">
                  <span className="map-focus-label">Выбор</span>
                  <strong>{selectedFeature.properties.name}</strong>
                </div>
                <button className="map-tool focus-tool" disabled={!selectedFeature} onClick={focusSelection} type="button">
                  <ToolbarIcons.focus />
                  <span>Фокус</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div> : null}
      {showControls ? <div className="map-zoom-controls">
        <button className="map-zoom-btn" onClick={() => zoomBy(1)} type="button">
          +
        </button>
        <button className="map-zoom-btn" onClick={() => zoomBy(-1)} type="button">
          −
        </button>
      </div> : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import maplibregl, { type ExpressionSpecification, type FilterSpecification, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildRouteCollection } from "../lib/routing";
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
    background: "#dfe5e8",
    circulationFill: "#d8e0e3",
    workspaceFill: "#d6dccf",
    meetingFill: "#e6c3a0",
    amenityFill: "#bfd7f0",
    engineeringFill: "#bfe6cf",
    operationsFill: "#bde2f2",
    productFill: "#d7caf5",
    designFill: "#f3c3d3",
    sharedFill: "#e5d2af",
    circulationAccentFill: "#bfd6dc",
    verticalFill: "#d8d3ee",
    selectedFill: "#56b7ed",
    hoverFill: "#8fd3f4",
    outline: "#495761",
    selectedOutline: "#1f6d97",
    hoverOutline: "#3a7fa5",
    wall: "#667079",
    door: "#b27c45",
    furniture: "#a8b1b8",
    connector: "#c8cfd6",
    connectorSelected: "#e5c28c",
    routeCasing: "rgba(255,255,255,0.88)",
    routeLine: "#d83d46",
    workstation: "#294858",
    connectorPoi: "#d84a54",
    poiHover: "#3fa0c7",
    poiSelected: "#4bb9f2",
    label: "#2a3f52",
    labelHover: "#2f7aa1",
    labelSelected: "#205f84",
    labelHalo: "rgba(244,247,249,0.98)",
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
  ["==", ["get", "department"], "Engineering"],
  palette.engineeringFill,
  ["==", ["get", "department"], "Operations"],
  palette.operationsFill,
  ["==", ["get", "department"], "Product"],
  palette.productFill,
  ["==", ["get", "department"], "Design"],
  palette.designFill,
  ["==", ["get", "department"], "Vertical circulation"],
  palette.verticalFill,
  ["==", ["get", "department"], "Circulation"],
  palette.circulationAccentFill,
  ["==", ["get", "department"], "Shared"],
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
  ["==", ["get", "department"], "Engineering"],
  palette.engineeringFill,
  ["==", ["get", "department"], "Operations"],
  palette.operationsFill,
  ["==", ["get", "department"], "Product"],
  palette.productFill,
  ["==", ["get", "department"], "Design"],
  palette.designFill,
  ["==", ["get", "department"], "Vertical circulation"],
  palette.verticalFill,
  ["==", ["get", "department"], "Circulation"],
  palette.circulationAccentFill,
  ["==", ["get", "department"], "Shared"],
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
const ROUTE_SOURCE = "route";
type FilteredLayerId =
  | "zone-fill"
  | "room-fill"
  | "room-outline"
  | "room-labels"
  | "room-hit-area"
  | "wall-extrusion"
  | "door-line"
  | "connector-structure"
  | "furniture-extrusion"
  | "poi-circle"
  | "poi-labels"
  | "route-line"
  | "route-glow";

const FILTERED_LAYER_IDS: FilteredLayerId[] = [
  "zone-fill",
  "room-fill",
  "room-outline",
  "room-labels",
  "room-hit-area",
  "wall-extrusion",
  "door-line",
  "connector-structure",
  "furniture-extrusion",
  "poi-circle",
  "poi-labels",
  "route-line",
  "route-glow",
];

export type MapSceneMode = "plan" | "explore" | "theatre";
type ScenePreset = {
  pitch: number;
  bearing: number;
  zoomOffset: number;
};

const SCENE_PRESETS: Record<MapSceneMode, ScenePreset> = {
  plan: { pitch: 18, bearing: 0, zoomOffset: -0.15 },
  explore: { pitch: 58, bearing: -18, zoomOffset: 0 },
  theatre: { pitch: 70, bearing: -42, zoomOffset: 0.2 },
};

const SCENE_MODES: MapSceneMode[] = ["plan", "explore", "theatre"];

const ToolbarIcons = {
  plan: () => (
    <svg fill="none" height="16" viewBox="0 0 16 16" width="16">
      <rect height="10" rx="1" stroke="currentColor" strokeWidth="1.3" width="12" x="2" y="3" />
      <line stroke="currentColor" strokeWidth="1" x1="2" x2="14" y1="7" y2="7" />
      <line stroke="currentColor" strokeWidth="1" x1="7" x2="7" y1="7" y2="13" />
    </svg>
  ),
  explore: () => (
    <svg fill="none" height="16" viewBox="0 0 16 16" width="16">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 5.5L7 9L10.5 10.5L9 7L5.5 5.5Z" fill="currentColor" opacity="0.6" />
    </svg>
  ),
  theatre: () => (
    <svg fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path d="M2 6C2 6 5 2 8 2C11 2 14 6 14 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
      <path d="M2 6C2 6 5 10 8 10C11 10 14 6 14 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
      <circle cx="8" cy="6" fill="currentColor" opacity="0.6" r="2" />
    </svg>
  ),
  rotateLeft: () => (
    <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
      <path d="M4 2L2 4L4 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
      <path d="M2 4H8C10.2 4 12 5.8 12 8C12 10.2 10.2 12 8 12H6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
    </svg>
  ),
  rotateRight: () => (
    <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
      <path d="M10 2L12 4L10 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
      <path d="M12 4H6C3.8 4 2 5.8 2 8C2 10.2 3.8 12 6 12H8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
    </svg>
  ),
  orbit: () => (
    <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
      <ellipse cx="7" cy="7" rx="6" ry="3" stroke="currentColor" strokeWidth="1.2" transform="rotate(-30 7 7)" />
      <circle cx="7" cy="7" fill="currentColor" r="1.5" />
    </svg>
  ),
  focus: () => (
    <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 1V3M7 11V13M1 7H3M11 7H13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
    </svg>
  ),
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

const updateFilters = (map: maplibregl.Map, level: LevelId) => {
  const hasLayer = (layerId: FilteredLayerId) => Boolean(map.getLayer(layerId));

  if (hasLayer("zone-fill")) {
    map.setFilter("zone-fill", floorFilter(level, ["zone"], "Polygon"));
  }

  if (hasLayer("room-fill")) {
    map.setFilter("room-fill", floorFilter(level, ["room", "meeting_room", "amenity"], "Polygon"));
  }

  if (hasLayer("room-outline")) {
    map.setFilter("room-outline", floorFilter(level, ["room", "meeting_room", "amenity"], "Polygon"));
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
    map.setFilter("connector-structure", departmentFilter(level, ["furniture"], "Polygon", "Vertical circulation"));
  }

  if (hasLayer("furniture-extrusion")) {
    map.setFilter("furniture-extrusion", excludedDepartmentFilter(level, ["furniture"], "Polygon", "Vertical circulation"));
  }

  if (hasLayer("poi-circle")) {
    map.setFilter("poi-circle", floorFilter(level, ["workstation", "connector"], "Point"));
  }

  if (hasLayer("poi-labels")) {
    map.setFilter("poi-labels", floorFilter(level, ["workstation", "connector"], "Point"));
  }

  if (hasLayer("route-line")) {
    map.setFilter("route-line", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], level]]);
  }

  if (hasLayer("route-glow")) {
    map.setFilter("route-glow", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], level]]);
  }
};

const popupHtml = (featureById: Map<string, OfficeFeature>, featureId: string) => {
  const feature = featureById.get(featureId);

  if (!feature) {
    return "<strong>Unknown feature</strong>";
  }

  const { name, subtitle, department, capacity } = feature.properties;
  const lines = [name, subtitle, department, capacity ? `${capacity} seats` : undefined].filter(Boolean);

  return lines.map((line, index) => (index === 0 ? `<strong>${line}</strong>` : `<div>${line}</div>`)).join("");
};

const interactiveLayerOrder: string[] = ["poi-circle", "poi-labels", "room-labels", "room-fill", "zone-fill", "room-hit-area"];
const selectableFeatureKinds: FeatureKind[] = ["room", "meeting_room", "amenity"];
const preferredInteractiveKinds: FeatureKind[] = ["workstation", "connector", "meeting_room", "room", "amenity"];

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
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onSelectFeatureRef = useRef(onSelectFeature);
  const pendingFocusRef = useRef<PendingFocusRequest | null>(null);
  const focusPulseTimerRef = useRef<number | null>(null);
  const processedZoomCommandIdRef = useRef(0);
  const [sceneMode, setSceneMode] = useState<MapSceneMode>("explore");
  const [pitch, setPitch] = useState<number>(SCENE_PRESETS.explore.pitch);
  const [bearing, setBearing] = useState<number>(SCENE_PRESETS.explore.bearing);
  const [orbitEnabled, setOrbitEnabled] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const palette = MAP_PALETTES[themeVariant];
  const selectedFeature = selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null;
  const normalizedBearing = ((Math.round(bearing) % 360) + 360) % 360;
  const roundedPitch = Math.round(pitch);

  const clearFocusPulseTimer = () => {
    const timerId = focusPulseTimerRef.current;

    if (timerId === null) {
      return;
    }

    window.clearTimeout(timerId);
    focusPulseTimerRef.current = null;
  };

  const openFeaturePopup = (map: maplibregl.Map, featureId: string) => {
    const feature = featureById.get(featureId);

    if (!feature) {
      return;
    }

    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ offset: 12, closeButton: false, className: `map-popup map-popup-${themeVariant}` })
      .setLngLat(feature.properties.focusPoint)
      .setHTML(popupHtml(featureById, featureId))
      .addTo(map);
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
        openFeaturePopup(map, request.featureId);
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
    openFeaturePopup(map, request.featureId);
    pendingFocusRef.current = null;
  };

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
      zoom: levelMeta.defaultZoom + SCENE_PRESETS.explore.zoomOffset,
      pitch: SCENE_PRESETS.explore.pitch,
      bearing: SCENE_PRESETS.explore.bearing,
      attributionControl: false,
    });

    map.on("load", () => {
      map.addSource(SPACE_SOURCE, { type: "geojson", data: collections.spaces });
      map.addSource(STRUCTURE_SOURCE, { type: "geojson", data: collections.structures });
      map.addSource(POI_SOURCE, { type: "geojson", data: collections.pois });
      map.addSource(ROOM_LABEL_SOURCE, { type: "geojson", data: collections.roomLabels });
      map.addSource(POI_LABEL_SOURCE, { type: "geojson", data: collections.poiLabels });
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: buildRouteCollection(route) });

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
          "fill-extrusion-opacity": 0.76,
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
        filter: excludedDepartmentFilter(activeLevel, ["furniture"], "Polygon", "Vertical circulation"),
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
        filter: departmentFilter(activeLevel, ["furniture"], "Polygon", "Vertical circulation"),
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
        id: "route-glow",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], activeLevel]],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": palette.routeCasing,
          "line-width": 9,
          "line-opacity": 0.74,
          "line-blur": 1.4,
        },
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], activeLevel]],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": palette.routeLine,
          "line-width": 3.5,
          "line-blur": 0.22,
          "line-opacity": 0.96,
        },
      });

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
          featureId = pickRoomFeatureIdAtLngLat(selectableSpaceFeatures, activeLevel, event.lngLat);
        }

        if (!featureId) {
          return;
        }

        onSelectFeatureRef.current(featureId);
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ offset: 12, closeButton: false, className: `map-popup map-popup-${themeVariant}` })
          .setLngLat(event.lngLat)
          .setHTML(popupHtml(featureById, featureId))
          .addTo(map);
      });

      updateFilters(map, activeLevel);
      selectedRef.current = selectedFeatureId;
      setFeatureState(featureSourceById, featureLabelSourceById, map, selectedRef.current, "selected", true);
    });

    mapRef.current = map;

    return () => {
      clearFocusPulseTimer();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [themeVariant]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      return;
    }

    updateFilters(map, activeLevel);
  }, [activeLevel]);

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

    const routeSource = map.getSource(ROUTE_SOURCE);

    if (!isGeoJsonSource(routeSource)) {
      return;
    }

    routeSource.setData(buildRouteCollection(route));
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      return;
    }

    setFeatureState(featureSourceById, featureLabelSourceById, map, selectedRef.current, "selected", false);
    selectedRef.current = selectedFeatureId;
    setFeatureState(featureSourceById, featureLabelSourceById, map, selectedRef.current, "selected", true);
  }, [featureLabelSourceById, featureSourceById, selectedFeatureId]);

  useEffect(() => {
    const map = mapRef.current;
    const feature = selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null;

    if (!map || !map.isStyleLoaded() || !feature) {
      pendingFocusRef.current = null;
      clearFocusPulseTimer();
      return;
    }

    const request: PendingFocusRequest = {
      requestId: focusRequestId,
      featureId: feature.id,
      level: feature.properties.level,
      center: feature.properties.focusPoint,
    };

    pendingFocusRef.current = request;

    if (request.level !== activeLevel) {
      return;
    }

    let cancelled = false;
    const resolveAfterIdle = () => {
      if (cancelled) {
        return;
      }

      const activeRequest = pendingFocusRef.current;

      if (!activeRequest || activeRequest.requestId !== request.requestId) {
        return;
      }

      runFocusRequest(map, request);
    };

    map.once("idle", resolveAfterIdle);
    map.triggerRepaint();

    return () => {
      cancelled = true;
      map.off("idle", resolveAfterIdle);
    };
  }, [activeLevel, focusRequestId, selectedFeatureId]);

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
    const levelMeta = getLevelMeta(levels, activeLevel);
    const map = mapRef.current;

    setSceneMode(mode);
    setPitch(preset.pitch);
    setBearing(preset.bearing);

    if (!map) {
      return;
    }

    map.flyTo({
      center: levelMeta.defaultCenter,
      zoom: levelMeta.defaultZoom + preset.zoomOffset,
      pitch: preset.pitch,
      bearing: preset.bearing,
      duration: 800,
      essential: true,
    });
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

  return (
    <div className="map-frame">
      <div className="map-shell" ref={containerRef} />
      {showControls ? <div className={controlsHidden ? "map-toolbar map-toolbar-collapsed" : "map-toolbar"}>
        <div className="map-toolbar-header">
          <div className="map-toolbar-copy">
            <span className="map-toolbar-kicker">View Control</span>
            <strong>Scene Deck</strong>
          </div>
          <div className="map-toolbar-header-actions">
            {!controlsHidden ? <span className="map-toolbar-badge">{activeLevel}</span> : null}
            <button
              aria-expanded={!controlsHidden}
              className="map-tool map-toolbar-toggle"
              onClick={() => setControlsHidden((current) => !current)}
              type="button"
            >
              {controlsHidden ? "Show" : "Hide"}
            </button>
          </div>
        </div>
        {!controlsHidden ? (
          <div className="map-toolbar-body">
            <section className="map-toolbar-section">
              <span className="map-toolbar-section-label">Scene Preset</span>
              <div className="map-toolbar-group map-toolbar-group-segmented">
                {SCENE_MODES.map((mode) => {
                  const label = mode.charAt(0).toUpperCase() + mode.slice(1);
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
              <span className="map-toolbar-section-label">Orientation</span>
              <div className="map-readout-grid">
                <div className="map-readout">
                  <span>Bearing</span>
                  <strong>{normalizedBearing}°</strong>
                </div>
                <div className="map-readout">
                  <span>Tilt</span>
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
                  <span>Orbit</span>
                </button>
              </div>
            </section>

            <section className="map-toolbar-section">
              <span className="map-toolbar-section-label">Camera Tilt</span>
              <label className="map-slider">
                <span>Camera tilt</span>
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
                  <span className="map-focus-label">Selection</span>
                  <strong>{selectedFeature.properties.name}</strong>
                </div>
                <button className="map-tool focus-tool" disabled={!selectedFeature} onClick={focusSelection} type="button">
                  <ToolbarIcons.focus />
                  <span>Focus</span>
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

import { useEffect, useRef, useState } from "react";
import maplibregl, { type FilterSpecification, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  featureById,
  featureLabelSourceById,
  featureSourceById,
  levels,
  poiCollection,
  poiLabelCollection,
  roomLabelCollection,
  selectableSpaceFeatures,
  spacesCollection,
  structuresCollection,
} from "../data/generated/office-data";
import { buildRouteCollection } from "../lib/routing";
import type { Coordinate, FeatureKind, LevelId, LevelMeta, RouteResult } from "../lib/types";

const style: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#edf2f4",
      },
    },
  ],
};

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
  "furniture-extrusion",
  "poi-circle",
  "poi-labels",
  "route-line",
  "route-glow",
];

type SceneMode = "plan" | "explore" | "theatre";
type ScenePreset = {
  pitch: number;
  bearing: number;
  zoomOffset: number;
};

const SCENE_PRESETS: Record<SceneMode, ScenePreset> = {
  plan: { pitch: 18, bearing: 0, zoomOffset: -0.15 },
  explore: { pitch: 58, bearing: -18, zoomOffset: 0 },
  theatre: { pitch: 70, bearing: -42, zoomOffset: 0.2 },
};

const SCENE_MODES: SceneMode[] = ["plan", "explore", "theatre"];

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

const firstLevel = levels[0];

if (!firstLevel) {
  throw new Error("Indoor map requires at least one configured level.");
}

const getLevelMeta = (level: LevelId): LevelMeta => levels.find((item) => item.id === level) ?? firstLevel;

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
    map.setFilter("room-hit-area", floorFilter(level, ["room", "meeting_room", "amenity", "zone"], "Polygon"));
  }

  if (hasLayer("wall-extrusion")) {
    map.setFilter("wall-extrusion", floorFilter(level, ["wall"], "Polygon"));
  }

  if (hasLayer("door-line")) {
    map.setFilter("door-line", floorFilter(level, ["door"], "LineString"));
  }

  if (hasLayer("furniture-extrusion")) {
    map.setFilter("furniture-extrusion", floorFilter(level, ["furniture"], "Polygon"));
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

const popupHtml = (featureId: string) => {
  const feature = featureById.get(featureId);

  if (!feature) {
    return "<strong>Unknown feature</strong>";
  }

  const { name, subtitle, department, capacity } = feature.properties;
  const lines = [name, subtitle, department, capacity ? `${capacity} seats` : undefined].filter(Boolean);

  return lines.map((line, index) => (index === 0 ? `<strong>${line}</strong>` : `<div>${line}</div>`)).join("");
};

const interactiveLayerOrder: string[] = ["poi-circle", "poi-labels", "room-labels", "room-fill", "zone-fill", "room-hit-area"];
const selectableFeatureKinds: FeatureKind[] = ["room", "meeting_room", "amenity", "zone"];
const preferredInteractiveKinds: FeatureKind[] = ["workstation", "connector", "meeting_room", "room", "amenity", "zone"];

const toFeatureId = (featureId: string | number | undefined): string | null => {
  if (typeof featureId === "string") {
    return featureId;
  }

  if (typeof featureId === "number") {
    return String(featureId);
  }

  return null;
};

const canonicalFeatureId = (feature: maplibregl.MapGeoJSONFeature) => {
  const candidate = feature.properties?.featureId;

  if (typeof candidate === "string" && featureById.has(candidate)) {
    return candidate;
  }

  const fallbackId = toFeatureId(feature.id);
  return fallbackId && featureById.has(fallbackId) ? fallbackId : null;
};

const pickInteractiveFeatureId = (features: maplibregl.MapGeoJSONFeature[] | undefined) => {
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
      return canonicalFeatureId(match);
    }
  }

  const fallback = features.find((feature) => feature.id !== undefined);
  return fallback ? canonicalFeatureId(fallback) : null;
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

const pickRoomFeatureIdAtLngLat = (level: LevelId, lngLat: maplibregl.LngLat) => {
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

const setFeatureState = (map: maplibregl.Map, featureId: string | null, key: "hover" | "selected", value: boolean) => {
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
  focusRequestId: number;
  selectedFeatureId: string | null;
  route: RouteResult | null;
  onSelectFeature: (featureId: string) => void;
}

export function MapCanvas({ activeLevel, focusRequestId, selectedFeatureId, route, onSelectFeature }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onSelectFeatureRef = useRef(onSelectFeature);
  const pendingFocusRef = useRef<PendingFocusRequest | null>(null);
  const focusPulseTimerRef = useRef<number | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("explore");
  const [pitch, setPitch] = useState<number>(SCENE_PRESETS.explore.pitch);
  const [bearing, setBearing] = useState<number>(SCENE_PRESETS.explore.bearing);
  const [orbitEnabled, setOrbitEnabled] = useState(false);

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
    popupRef.current = new maplibregl.Popup({ offset: 12, closeButton: false, className: "map-popup" })
      .setLngLat(feature.properties.focusPoint)
      .setHTML(popupHtml(featureId))
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

    const levelMeta = getLevelMeta(activeLevel);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: levelMeta.defaultCenter,
      zoom: levelMeta.defaultZoom + SCENE_PRESETS.explore.zoomOffset,
      pitch: SCENE_PRESETS.explore.pitch,
      bearing: SCENE_PRESETS.explore.bearing,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource(SPACE_SOURCE, { type: "geojson", data: spacesCollection });
      map.addSource(STRUCTURE_SOURCE, { type: "geojson", data: structuresCollection });
      map.addSource(POI_SOURCE, { type: "geojson", data: poiCollection });
      map.addSource(ROOM_LABEL_SOURCE, { type: "geojson", data: roomLabelCollection });
      map.addSource(POI_LABEL_SOURCE, { type: "geojson", data: poiLabelCollection });
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: buildRouteCollection(route) });

      map.addLayer({
        id: "zone-fill",
        type: "fill",
        source: SPACE_SOURCE,
        filter: floorFilter(activeLevel, ["zone"], "Polygon"),
        paint: {
          "fill-color": "#dbe7e1",
          "fill-opacity": 0.48,
        },
      });

      map.addLayer({
        id: "room-fill",
        type: "fill",
        source: SPACE_SOURCE,
        filter: floorFilter(activeLevel, ["room", "meeting_room", "amenity"], "Polygon"),
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#ffb703",
            ["boolean", ["feature-state", "hover"], false],
            "#8ecae6",
            ["==", ["get", "kind"], "meeting_room"],
            "#f2cc8f",
            ["==", ["get", "kind"], "amenity"],
            "#bde0fe",
            "#dde5b6",
          ],
          "fill-opacity": 0.9,
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
            "#7f5539",
            ["boolean", ["feature-state", "hover"], false],
            "#1d4e89",
            "#17324d",
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
          "fill-extrusion-color": "#59636d",
          "fill-extrusion-base": ["coalesce", ["get", "baseHeight"], 0],
          "fill-extrusion-height": ["coalesce", ["get", "height"], 3],
          "fill-extrusion-opacity": 0.82,
        },
      });

      map.addLayer({
        id: "door-line",
        type: "line",
        source: STRUCTURE_SOURCE,
        filter: floorFilter(activeLevel, ["door"], "LineString"),
        paint: {
          "line-color": "#8c5e34",
          "line-width": 3,
          "line-opacity": 0.95,
        },
      });

      map.addLayer({
        id: "room-hit-area",
        type: "fill",
        source: SPACE_SOURCE,
        filter: floorFilter(activeLevel, ["room", "meeting_room", "amenity", "zone"], "Polygon"),
        paint: {
          "fill-color": "#000000",
          "fill-opacity": 0.001,
        },
      });

      map.addLayer({
        id: "furniture-extrusion",
        type: "fill-extrusion",
        source: STRUCTURE_SOURCE,
        filter: floorFilter(activeLevel, ["furniture"], "Polygon"),
        paint: {
          "fill-extrusion-color": "#8b949e",
          "fill-extrusion-base": ["coalesce", ["get", "baseHeight"], 0],
          "fill-extrusion-height": ["coalesce", ["get", "height"], 1],
          "fill-extrusion-opacity": 0.56,
        },
      });

      map.addLayer({
        id: "route-glow",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], activeLevel]],
        paint: {
          "line-color": "#ffffff",
          "line-width": 10,
          "line-opacity": 0.6,
        },
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "level"], activeLevel]],
        paint: {
          "line-color": "#d62828",
          "line-width": 4,
        },
      });

      map.addLayer({
        id: "poi-circle",
        type: "circle",
        source: POI_SOURCE,
        filter: floorFilter(activeLevel, ["workstation", "connector"], "Point"),
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "connector"], 7, 5],
          "circle-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#ffb703",
            ["boolean", ["feature-state", "hover"], false],
            "#219ebc",
            ["==", ["get", "kind"], "connector"],
            "#d62828",
            "#264653",
          ],
          "circle-stroke-color": "#ffffff",
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
          "text-size": 10.5,
          "text-offset": [0, 1.2],
          "text-font": ["Open Sans Semibold"],
          "text-max-width": 9,
        },
        paint: {
          "text-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#7f5539",
            ["boolean", ["feature-state", "hover"], false],
            "#1d4e89",
            "#102a43",
          ],
          "text-halo-color": "rgba(255,255,255,0.92)",
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
            "#7f5539",
            ["boolean", ["feature-state", "hover"], false],
            "#1d4e89",
            "#102a43",
          ],
          "text-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            1,
            0.96,
          ],
          "text-halo-color": "rgba(255,255,255,0.96)",
          "text-halo-width": 1.6,
        },
      });

      map.on("mousemove", (event) => {
        const featureId = pickInteractiveFeatureId(
          map.queryRenderedFeatures(event.point, { layers: [...interactiveLayerOrder] }),
        );

        if (featureId === hoverRef.current) {
          return;
        }

        setFeatureState(map, hoverRef.current, "hover", false);
        hoverRef.current = featureId;
        setFeatureState(map, hoverRef.current, "hover", true);
        map.getCanvas().style.cursor = featureId ? "pointer" : "";
      });

      map.on("mouseleave", () => {
        setFeatureState(map, hoverRef.current, "hover", false);
        hoverRef.current = null;
        map.getCanvas().style.cursor = "";
      });

      map.on("click", (event) => {
        let featureId = pickInteractiveFeatureId(
          map.queryRenderedFeatures(event.point, { layers: [...interactiveLayerOrder] }),
        );

        if (!featureId) {
          featureId = pickRoomFeatureIdAtLngLat(activeLevel, event.lngLat);
        }

        if (!featureId) {
          return;
        }

        onSelectFeatureRef.current(featureId);
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ offset: 12, closeButton: false, className: "map-popup" })
          .setLngLat(event.lngLat)
          .setHTML(popupHtml(featureId))
          .addTo(map);
      });

      updateFilters(map, activeLevel);
      selectedRef.current = selectedFeatureId;
      setFeatureState(map, selectedRef.current, "selected", true);
    });

    mapRef.current = map;

    return () => {
      clearFocusPulseTimer();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

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

    setFeatureState(map, selectedRef.current, "selected", false);
    selectedRef.current = selectedFeatureId;
    setFeatureState(map, selectedRef.current, "selected", true);
  }, [selectedFeatureId]);

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

  const applySceneMode = (mode: SceneMode) => {
    const preset = SCENE_PRESETS[mode];
    const levelMeta = getLevelMeta(activeLevel);
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

  return (
    <div className="map-frame">
      <div className="map-shell" ref={containerRef} />
      <div className="map-toolbar">
        <div className="map-toolbar-group">
          {SCENE_MODES.map((mode) => (
            <button
              className={mode === sceneMode ? "map-tool map-tool-active" : "map-tool"}
              key={mode}
              onClick={() => applySceneMode(mode)}
              type="button"
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="map-toolbar-group">
          <button className="map-tool" onClick={() => rotateBy(-20)} type="button">
            Rotate -
          </button>
          <button className="map-tool" onClick={() => rotateBy(20)} type="button">
            Rotate +
          </button>
          <button
            className={orbitEnabled ? "map-tool map-tool-active" : "map-tool"}
            onClick={() => setOrbitEnabled((current) => !current)}
            type="button"
          >
            Orbit
          </button>
        </div>
        <label className="map-slider">
          <span>Tilt</span>
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
        <button className="map-tool focus-tool" onClick={focusSelection} type="button">
          Focus selection
        </button>
      </div>
    </div>
  );
}

import {
  Fragment,
  lazy,
  Suspense,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import type { MapSceneMode, MapThemeVariant } from "./components/MapCanvas";
import { MockOccupancyProvider } from "./lib/occupancy";
import { loadIndoorDataset, type IndoorRuntimeData } from "./lib/indoor-dataset";
import { computeShortestRoute } from "./lib/routing";
import { searchOffice } from "./lib/search";
import type { LevelId, RoomStatus, RoomStatuses, RouteResult } from "./lib/types";

const LazyMapCanvas = lazy(() =>
  import("./components/MapCanvas").then((module) => ({ default: module.MapCanvas })),
);

const occupancyProvider = new MockOccupancyProvider();
const spatialKinds = new Set(["room", "meeting_room", "amenity"]);
const routeableKinds = new Set(["room", "meeting_room", "amenity", "connector"]);

type GroupKey = "level" | "kind" | "dept" | "status";
type AtlasKind = "room" | "meeting" | "amenity" | "connector" | "workstation";
type IndoorFeature = IndoorRuntimeData["dataset"]["features"][number];
type DrawerMode = "search" | "route" | "detail" | "route-result" | "ops";
type RouteBuilderStep = "from" | "to";

type AtlasSpace = {
  id: string;
  featureId: string;
  routeTargetId: string | null;
  name: string;
  level: LevelId;
  kind: AtlasKind;
  kindLabel: string;
  dept: string;
  cap: number;
  status: RoomStatus;
  employee?: string;
  equipment: string[];
};

type AtlasPerson = {
  featureId: string;
  name: string;
  desk: string;
  level: LevelId;
  dept: string;
};

const GROUP_OPTIONS: Array<{ key: GroupKey; label: string }> = [
  { key: "level", label: "Этаж" },
  { key: "kind", label: "Тип" },
  { key: "dept", label: "Отдел" },
  { key: "status", label: "Статус" },
];

const VIEW_MODES: Array<{ id: MapSceneMode; label: string }> = [
  { id: "plan", label: "План" },
  { id: "explore", label: "Обзор" },
  { id: "theatre", label: "Сцена" },
];

const THEME_OPTIONS: Array<{ id: MapThemeVariant; label: string }> = [
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" },
];

const ST: Record<RoomStatus, { c: string; bg: string; label: string }> = {
  available: { c: "#34d399", bg: "rgba(52,211,153,.12)", label: "Свободно" },
  occupied: { c: "#f87171", bg: "rgba(248,113,113,.12)", label: "Занято" },
  focus: { c: "#fbbf24", bg: "rgba(251,191,36,.12)", label: "Фокус" },
  offline: { c: "#64748b", bg: "rgba(100,116,139,.10)", label: "Не в сети" },
};

const KIND_L: Record<AtlasKind, string> = {
  room: "Рабочая зона",
  meeting: "Переговорная",
  amenity: "Сервисная зона",
  connector: "Переход",
  workstation: "Рабочее место",
};

const getAtlasKind = (feature: IndoorFeature): AtlasKind => {
  switch (feature.properties.kind) {
    case "meeting_room":
      return "meeting";
    case "connector":
      return "connector";
    case "workstation":
      return "workstation";
    case "amenity":
      return "amenity";
    default:
      return "room";
  }
};

const searchText = (space: AtlasSpace) =>
  [space.name, space.dept, space.kindLabel, space.employee, ...space.equipment].join(" ").toLowerCase();

const matchesQuery = (space: AtlasSpace, query: string) => {
  const normalized = query.trim().toLowerCase();
  return normalized.length === 0 || searchText(space).includes(normalized);
};

const matchesPersonQuery = (person: AtlasPerson, query: string) => {
  const normalized = query.trim().toLowerCase();
  return normalized.length === 0 || [person.name, person.desk, person.dept].join(" ").toLowerCase().includes(normalized);
};

const groupBy = (spaces: AtlasSpace[], key: GroupKey): Array<[string, AtlasSpace[]]> => {
  const map = new Map<string, AtlasSpace[]>();

  for (const space of spaces) {
    const groupValue =
      key === "kind"
        ? space.kindLabel
        : key === "status"
          ? ST[space.status].label
          : key === "dept"
            ? space.dept
            : space.level;
    map.set(groupValue, [...(map.get(groupValue) ?? []), space]);
  }

  return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0]));
};

const featureStatus = (
  featureById: Map<string, IndoorFeature>,
  featureId: string | null,
  roomStatuses: RoomStatuses,
) => {
  if (!featureId) {
    return null;
  }

  const feature = featureById.get(featureId);
  if (!feature) {
    return null;
  }

  return roomStatuses[featureId] ?? feature.properties.status ?? null;
};

const featureLevel = (featureById: Map<string, IndoorFeature>, featureId: string | null): LevelId | null => {
  if (!featureId) {
    return null;
  }

  return featureById.get(featureId)?.properties.level ?? null;
};

const routeConnectorLabel = (connectorTypes: readonly ("stairs" | "elevator")[]) => {
  const unique = [...new Set(connectorTypes)];
  const connectorLabel = (type: "stairs" | "elevator") => (type === "stairs" ? "лестница" : "лифт");
  return unique.length > 0 ? unique.map(connectorLabel).join(" + ") : "без перехода";
};

const levelOrder = (level: LevelId) => Number(level.replace(/\D+/g, "")) || 0;

const featureDisplayName = (feature: IndoorFeature | null | undefined) =>
  feature ? feature.properties.employee ?? feature.properties.name : null;

const edgeFeatureRef = (
  edgeId: string,
  prefix: string,
  featureById: Map<string, IndoorFeature>,
): string | null => {
  if (!edgeId.startsWith(prefix)) {
    return null;
  }

  const tail = edgeId.slice(prefix.length);
  const candidates = [...featureById.keys()]
    .filter((featureId) => tail === featureId || tail.startsWith(`${featureId}-`))
    .sort((left, right) => right.length - left.length);

  return candidates[0] ?? null;
};

const connectorVerb = (connectorType: "stairs" | "elevator", fromLevel: LevelId, toLevel: LevelId) => {
  const ascending = levelOrder(toLevel) > levelOrder(fromLevel);

  if (connectorType === "elevator") {
    return ascending ? "Поднимитесь на лифте" : "Спуститесь на лифте";
  }

  return ascending ? "Поднимитесь по лестнице" : "Спуститесь по лестнице";
};

const routeSteps = (
  route: RouteResult | null,
  fromLabel: string,
  toLabel: string,
  routingGraph: IndoorRuntimeData["dataset"]["routing"]["graph"],
  featureById: Map<string, IndoorFeature>,
) => {
  if (!route) {
    return [];
  }

  const nodeById = new Map(routingGraph.nodes.map((node) => [node.id, node]));
  const steps: string[] = [];
  const pushStep = (step: string | null) => {
    if (!step) {
      return;
    }

    if (steps.at(-1) === step) {
      return;
    }

    steps.push(step);
  };

  pushStep(`Выйдите из ${fromLabel}`);

  for (const leg of route.legs) {
    const fromNode = nodeById.get(leg.fromNodeId);
    const toNode = nodeById.get(leg.toNodeId);
    const fromFeature = fromNode?.featureRef ? featureById.get(fromNode.featureRef) ?? null : null;
    const toFeature = toNode?.featureRef ? featureById.get(toNode.featureRef) ?? null : null;

    if (leg.connectorType && fromNode && toNode) {
      pushStep(`${connectorVerb(leg.connectorType, fromNode.level, toNode.level)} на ${toNode.level}`);
      continue;
    }

    const passRoomId = edgeFeatureRef(leg.id, "edge-room-pass-", featureById);

    if (passRoomId) {
      const passFeature = featureById.get(passRoomId) ?? null;
      const passName = featureDisplayName(passFeature);

      if (passName && passName !== fromLabel && passName !== toLabel) {
        pushStep(`Следуйте через ${passName}`);
      }

      continue;
    }

    const poiFeatureId = edgeFeatureRef(leg.id, "edge-poi-", featureById);

    if (poiFeatureId) {
      const poiFeature = featureById.get(poiFeatureId) ?? null;
      const poiName = featureDisplayName(poiFeature);

      if (poiFeature?.properties.kind === "connector" && poiName && poiName !== fromLabel && poiName !== toLabel) {
        pushStep(`Подойдите к ${poiName}`);
      }

      continue;
    }

    if (toFeature && featureDisplayName(toFeature) && featureDisplayName(toFeature) !== fromLabel && featureDisplayName(toFeature) !== toLabel && toFeature.id !== fromFeature?.id) {
      pushStep(`Перейдите в ${featureDisplayName(toFeature)}`);
    }
  }

  pushStep(`Войдите в ${toLabel}`);
  pushStep(`Вы пришли: ${toLabel}`);
  return steps;
};

const routeDurationLabel = (distance: number) => `~${Math.max(1, Math.round(distance / 60))} мин пешком`;

const STATUS_ORDER: Record<RoomStatus, number> = {
  available: 0,
  occupied: 1,
  focus: 2,
  offline: 3,
};

const Ic = {
  Search: ({ s = 15 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="6.8" cy="6.8" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.5 10.5L14.5 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  X: ({ s = 13 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Nav: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 6L12 2L8 11.5L6.5 7.5L2.5 6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="currentColor" opacity="0.15" />
    </svg>
  ),
  Route: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.4" fill="currentColor" opacity="0.15" />
      <path d="M5.8 5.8L10.2 10.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2.5 2.5" />
    </svg>
  ),
  User: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 12.5C2.5 10 4.5 8 7 8S11.5 10 11.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  Floor: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 3.5V12.5M2.5 8H13.5" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      <circle cx="5.25" cy="5.25" r="0.75" fill="currentColor" opacity="0.7" />
    </svg>
  ),
  Check: () => (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Swap: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M10 3V11M10 11L8 9M10 11L12 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 11V3M4 3L2 5M4 3L6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Compass: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10.9 5.1L8.9 9L5.1 10.9L7.1 7L10.9 5.1Z" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  ),
  Eye: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 8C3.45 5.55 5.52 4.25 8 4.25C10.48 4.25 12.55 5.55 14 8C12.55 10.45 10.48 11.75 8 11.75C5.52 11.75 3.45 10.45 2 8Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2.15" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="0.85" fill="currentColor" opacity="0.82" />
    </svg>
  ),
  Grid: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2.25" y="2.25" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.75" y="2.25" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" opacity="0.75" />
      <rect x="2.25" y="9.75" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" opacity="0.75" />
      <rect x="9.75" y="9.75" width="4" height="4" rx="0.8" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  Walk: () => (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
      <circle cx="8" cy="2.5" r="1.5" fill="currentColor" opacity="0.7" />
      <path d="M6 5.5L5 9L6.5 9L7.5 12.5M9 5.5L10.5 9L9 9L8 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 5.5H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  Elev: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8L7 5L9 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ArrowR: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Pulse: () => (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="3" fill="currentColor" opacity="0.3" />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
    </svg>
  ),
  Seats: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="5" width="8" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4 5V3.5C4 2.7 4.7 2 5.5 2H6.5C7.3 2 8 2.7 8 3.5V5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3 9V10.5M9 9V10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
};

type SpaceCardProps = {
  space: AtlasSpace;
  onClick: (space: AtlasSpace) => void;
  selectedFeatureId: string | null;
  compact?: boolean;
};

function SpaceCard({ space, onClick, selectedFeatureId, compact = false }: SpaceCardProps) {
  const st = ST[space.status];
  const isSelected = selectedFeatureId === space.featureId;

  return (
    <button
      onClick={() => onClick(space)}
      className="hud-card"
      style={{
        ...S.card,
        ...(isSelected ? S.cardSelected : {}),
        ...(compact ? { padding: "10px 12px" } : {}),
      }}
      type="button"
    >
      <div style={S.cardTop}>
        <div style={S.cardNameRow}>
          <span style={{ ...S.statusDot, background: st.c }} />
          <span style={{ ...S.cardName, ...(compact ? { fontSize: 12 } : {}) }}>{space.name}</span>
        </div>
        <span style={S.cardLevel}>{space.level}</span>
      </div>
      <div style={S.cardBottom}>
        <span style={S.cardKind}>{space.kindLabel}</span>
        {space.cap > 0 ? (
          <span style={S.cardCap}>
            <Ic.Seats /> {space.cap}
          </span>
        ) : null}
      </div>
      {!compact && space.dept !== "Общие" ? <span style={S.cardDept}>{space.dept}</span> : null}
    </button>
  );
}

function PersonRow({ person, onClick }: { person: AtlasPerson; onClick: (person: AtlasPerson) => void }) {
  return (
    <button style={S.personRow} className="hud-card" onClick={() => onClick(person)} type="button">
      <div style={S.personAv}>{person.name[0]}</div>
      <div style={S.personInfo}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{person.name}</span>
        <span style={{ fontSize: 11, color: T.sec }}>{person.desk} · {person.dept}</span>
      </div>
      <span style={S.cardLevel}>{person.level}</span>
    </button>
  );
}

function GroupedGrid({
  spaces,
  groupKey,
  onSelect,
  selectedFeatureId,
  compact = false,
}: {
  spaces: AtlasSpace[];
  groupKey: GroupKey;
  onSelect: (space: AtlasSpace) => void;
  selectedFeatureId: string | null;
  compact?: boolean;
}) {
  const groups = groupBy(spaces, groupKey);

  return (
    <div style={S.groupedGrid}>
      {groups.map(([label, items]) => (
        <div key={label} style={S.group}>
          <div style={S.groupHeader}>
            <span style={S.groupLabel}>{label}</span>
            <span style={S.groupCount}>{items.length}</span>
          </div>
          <div style={{ ...S.grid, ...(compact ? S.gridCompact : {}) }}>
            {items.map((space) => (
              <SpaceCard
                key={space.id}
                space={space}
                onClick={onSelect}
                selectedFeatureId={selectedFeatureId}
                compact={compact}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RouteCandidateGrid({
  spaces,
  groupKey,
  onSelect,
  selectedFeatureId,
}: {
  spaces: AtlasSpace[];
  groupKey: GroupKey;
  onSelect: (space: AtlasSpace) => void;
  selectedFeatureId: string | null;
}) {
  const groups = groupBy(spaces, groupKey);

  return (
    <div style={S.groupedGrid}>
      {groups.map(([label, items]) => (
        <div key={label} style={S.group}>
          <div style={S.groupHeader}>
            <span style={S.groupLabel}>{label}</span>
            <span style={S.groupCount}>{items.length}</span>
          </div>
          <div style={S.routeChoiceGrid}>
            {items.map((space) => {
              const status = ST[space.status];
              const isSelected = selectedFeatureId === space.featureId;

              return (
                <button
                  key={space.id}
                  style={{ ...S.routeChoiceCard, ...(isSelected ? S.routeChoiceCardSelected : {}) }}
                  className="hud-card"
                  onClick={() => onSelect(space)}
                  type="button"
                >
                  <div style={S.routeChoiceTop}>
                    <div style={S.routeChoiceNameRow}>
                      <span style={{ ...S.statusDot, background: status.c }} />
                      <span style={S.routeChoiceName}>{space.name}</span>
                    </div>
                    <span style={S.cardLevel}>{space.level}</span>
                  </div>
                  <div style={S.routeChoiceMeta}>
                    <span style={S.routeChoiceMetaText}>{space.kindLabel}</span>
                    {space.cap > 0 ? (
                      <span style={S.routeChoiceMetaText}>
                        <Ic.Seats /> {space.cap}
                      </span>
                    ) : null}
                  </div>
                  <div style={S.routeChoiceFooter}>
                    <span style={S.routeChoiceDept}>{space.dept}</span>
                    <span style={{ ...S.statusPill, ...S.routeChoiceStatus, color: status.c, background: status.bg }}>{status.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AtlasV4() {
  const [indoorData, setIndoorData] = useState<IndoorRuntimeData | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [activeLevel, setActiveLevel] = useState<LevelId>("L1");
  const [viewMode, setViewMode] = useState<MapSceneMode>("plan");
  const [themeVariant, setThemeVariant] = useState<MapThemeVariant>("dark");
  const [time, setTime] = useState(new Date());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("search");
  const [browseQ, setBrowseQ] = useState("");
  const [browseGroup, setBrowseGroup] = useState<GroupKey>("level");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>("room-l1-lobby");
  const [routeFromId, setRouteFromId] = useState("");
  const [routeToId, setRouteToId] = useState("");
  const [routeFromQ, setRouteFromQ] = useState("");
  const [routeToQ, setRouteToQ] = useState("");
  const [routeFromGroup, setRouteFromGroup] = useState<GroupKey>("level");
  const [routeToGroup, setRouteToGroup] = useState<GroupKey>("level");
  const [routeBuilderStep, setRouteBuilderStep] = useState<RouteBuilderStep>("from");
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [roomStatuses, setRoomStatuses] = useState<RoomStatuses>({});
  const [occupancyUpdatedAt, setOccupancyUpdatedAt] = useState<Date | null>(null);
  const [zoomCommand, setZoomCommand] = useState<{ id: number; delta: 1 | -1 } | null>(null);
  const topSearchRef = useRef<HTMLInputElement | null>(null);
  const deferredBrowseQuery = useDeferredValue(browseQ);
  const themeVars = ATLAS_THEME_VARS[themeVariant] as Record<string, string>;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const runtimeData = await loadIndoorDataset();

        if (!cancelled) {
          setIndoorData(runtimeData);
        }
      } catch (error) {
        if (!cancelled) {
          setDatasetError(error instanceof Error ? error.message : "Failed to load indoor dataset.");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshStatuses = async () => {
      const statuses = await occupancyProvider.getRoomStatuses();

      if (!cancelled) {
        setRoomStatuses(statuses);
        setOccupancyUpdatedAt(new Date());
      }
    };

    void refreshStatuses();
    const interval = window.setInterval(() => {
      void refreshStatuses();
    }, 12000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const dataset = indoorData?.dataset ?? null;
  const indexes = indoorData?.indexes ?? null;
  const featureById = indexes?.featureById ?? new Map<string, IndoorFeature>();
  const levels = dataset?.levels ?? [];
  const routeTargets = dataset?.routing.targets ?? [];
  const routingGraph = dataset?.routing.graph ?? { nodes: [], edges: [] };
  const searchEntries = dataset?.search.entries ?? [];
  const statusRoomIds = dataset?.status.roomIds ?? [];

  const atlasSpaces = useMemo<AtlasSpace[]>(() => {
    const routeTargetByFeatureId = new Map(routeTargets.map((target) => [target.featureId, target.id]));

    return [...featureById.values()]
      .filter((feature) => routeableKinds.has(feature.properties.kind))
      .map((feature) => {
        const atlasKind = getAtlasKind(feature);
        const status = roomStatuses[feature.id] ?? feature.properties.status ?? "offline";

        return {
          id: feature.id,
          featureId: feature.id,
          routeTargetId: routeTargetByFeatureId.get(feature.id) ?? null,
          name: feature.properties.employee ?? feature.properties.name,
          level: feature.properties.level,
          kind: atlasKind,
          kindLabel: KIND_L[atlasKind],
          dept: feature.properties.department ?? "Общие",
          cap: feature.properties.capacity ?? 0,
          status,
          employee: feature.properties.employee,
          equipment: feature.properties.equipment ?? [],
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [featureById, routeTargets, roomStatuses]);

  const browseSpaces = useMemo(() => atlasSpaces.filter((space) => spatialKinds.has(space.kind === "meeting" ? "meeting_room" : space.kind) && matchesQuery(space, deferredBrowseQuery)), [atlasSpaces, deferredBrowseQuery]);

  const people = useMemo<AtlasPerson[]>(
    () =>
      [...featureById.values()]
        .filter((feature) => feature.properties.kind === "workstation" && Boolean(feature.properties.employee))
        .map((feature) => ({
          featureId: feature.id,
          name: feature.properties.employee ?? feature.properties.name,
          desk: feature.properties.name,
          level: feature.properties.level,
          dept: feature.properties.department ?? "Общие",
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [featureById],
  );

  const browsePeople = useMemo(
    () => people.filter((person) => matchesPersonQuery(person, browseQ)),
    [people, browseQ],
  );

  const routeChoices = useMemo(
    () => atlasSpaces.filter((space) => space.routeTargetId !== null),
    [atlasSpaces],
  );

  const routeFromChoices = useMemo(
    () => routeChoices.filter((space) => matchesQuery(space, routeFromQ)),
    [routeChoices, routeFromQ],
  );

  const routeToChoices = useMemo(
    () => routeChoices.filter((space) => matchesQuery(space, routeToQ)),
    [routeChoices, routeToQ],
  );

  const routeChoiceByTargetId = useMemo(
    () => new Map(routeChoices.map((space) => [space.routeTargetId ?? "", space])),
    [routeChoices],
  );

  const routeFrom = routeChoiceByTargetId.get(routeFromId) ?? null;
  const routeTo = routeChoiceByTargetId.get(routeToId) ?? null;
  const activeRouteStep = routeBuilderStep === "to" && routeFrom ? "to" : "from";
  const isEditingFrom = activeRouteStep === "from";
  const activeRouteChoiceList = isEditingFrom ? routeFromChoices : routeToChoices;
  const activeRouteGroup = isEditingFrom ? routeFromGroup : routeToGroup;
  const activeRouteSelectedFeatureId = isEditingFrom ? routeFrom?.featureId ?? null : routeTo?.featureId ?? null;
  const activeRouteQuery = isEditingFrom ? routeFromQ : routeToQ;
  const activeRouteTitle = isEditingFrom ? "Шаг 1. Выберите стартовую точку" : "Шаг 2. Выберите точку назначения";
  const activeRouteSubtitle = isEditingFrom
    ? "Выберите, откуда начинается маршрут. После выбора акцент автоматически перейдёт к точке назначения."
    : "Уточните, куда должен привести маршрут. Когда обе точки заданы, маршрут можно сразу построить.";
  const activeRouteEmpty = isEditingFrom ? "Стартовая точка не выбрана" : "Точка назначения не выбрана";

  const selectedFeature = selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null;
  const selectedSpace = selectedFeatureId ? atlasSpaces.find((space) => space.featureId === selectedFeatureId) ?? null : null;
  const selectedRouteTarget = routeTargets.find((target) => target.featureId === selectedFeatureId) ?? null;
  const selectedStatus = featureStatus(featureById, selectedFeatureId, roomStatuses) ?? "offline";
  const selectedStatusLabel = ST[selectedStatus].label;
  const routeSummaryDistance = route ? Math.round(route.summary.distance) : 0;
  const routeStepsList = routeSteps(
    route,
    routeFrom?.name ?? "Старт",
    routeTo?.name ?? "Точка назначения",
    routingGraph,
    featureById,
  );
  const routeStepColumnCount =
    routeStepsList.length >= 8 ? 4 : routeStepsList.length >= 5 ? 3 : routeStepsList.length >= 3 ? 2 : 1;
  const routeStepRows = Math.max(1, Math.ceil(routeStepsList.length / routeStepColumnCount));
  const routeStepColumns = Array.from({ length: routeStepColumnCount }, (_, columnIndex) =>
    routeStepsList.filter((_, index) => Math.floor(index / routeStepRows) === columnIndex),
  );
  const isWorkspaceDrawerMode = drawerMode === "search" || drawerMode === "route";
  const isInfoDrawerMode = drawerMode === "detail" || drawerMode === "route-result" || drawerMode === "ops";
  const activeViewModeLabel = VIEW_MODES.find((mode) => mode.id === viewMode)?.label ?? viewMode;
  const bottomHeadline = route
    ? `${routeFrom?.name ?? "Старт"} → ${routeTo?.name ?? "Точка назначения"}`
    : selectedFeature
      ? selectedFeature.properties.employee ?? selectedFeature.properties.name
      : "Готово к навигации";
  const bottomMeta = route
    ? `${routeSummaryDistance} м · ${routeDurationLabel(route.summary.distance)}`
    : selectedFeature
      ? `${selectedFeature.properties.department ?? "Общие"} · ${selectedFeature.properties.level}`
      : `${activeLevel} · ${activeViewModeLabel}`;
  const matchedSearchResults = browseQ.trim()
    ? searchOffice(searchEntries, browseQ).map((entry) => atlasSpaces.find((space) => space.featureId === entry.featureId)).filter((space): space is AtlasSpace => Boolean(space))
    : [];

  const statusCounts = statusRoomIds.reduce<Record<RoomStatus, number>>(
    (counts, featureId) => {
      const status = featureStatus(featureById, featureId, roomStatuses) ?? "offline";
      counts[status] += 1;
      return counts;
    },
    { available: 0, occupied: 0, focus: 0, offline: 0 },
  );

  const levelRooms = atlasSpaces.filter((space) => space.level === activeLevel && space.cap > 0);
  const opsRooms = [...levelRooms].sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.name.localeCompare(right.name));
  const levelStatusCounts = levelRooms.reduce<Record<RoomStatus, number>>(
    (counts, space) => {
      counts[space.status] += 1;
      return counts;
    },
    { available: 0, occupied: 0, focus: 0, offline: 0 },
  );
  const levelRoomCount = levelRooms.length;
  const occupiedNow = levelStatusCounts.occupied + levelStatusCounts.focus;
  const levelAvailabilityRate = levelRoomCount > 0 ? Math.round((levelStatusCounts.available / levelRoomCount) * 100) : 0;
  const levelLoadRate = levelRoomCount > 0 ? Math.round((occupiedNow / levelRoomCount) * 100) : 0;
  const totalTrackedRooms = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);

  useEffect(() => {
    if (routeFromId || routeTargets.length === 0) {
      return;
    }

    const defaultFrom = routeTargets.find((target) => target.featureId === "room-l1-lobby")?.id ?? routeTargets[0]?.id ?? "";
    const defaultTo = routeTargets.find((target) => target.featureId === "room-l2-cedar")?.id ?? routeTargets[1]?.id ?? defaultFrom;
    setRouteFromId(defaultFrom);
    setRouteToId(defaultTo);
  }, [routeFromId, routeTargets]);

  const onSelectFeature = (featureId: string) => {
    const nextLevel = featureLevel(featureById, featureId);

    startTransition(() => {
      setSelectedFeatureId(featureId);
      setFocusRequestId((current) => current + 1);
      if (drawerMode !== "route") {
        setDrawerMode("detail");
        setDrawerOpen(true);
      }

      if (nextLevel) {
        setActiveLevel(nextLevel);
      }
    });
  };

  const openBrowse = () => {
    setDrawerMode("search");
    setDrawerOpen(true);
    window.setTimeout(() => topSearchRef.current?.focus(), 80);
  };

  const openRouteBuilder = (fromTargetId: string | null = null, toTargetId: string | null = null) => {
    const nextFromId = fromTargetId ?? routeFromId;
    const nextToId = toTargetId ?? routeToId;
    setDrawerMode("route");
    setDrawerOpen(true);
    setRouteFromId(nextFromId);
    setRouteToId(nextToId);
    setRouteFromQ("");
    setRouteToQ("");
    setRouteBuilderStep(nextFromId ? "to" : "from");
    setRouteError(null);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const closeSearch = () => {
    if (drawerMode === "search") {
      setDrawerOpen(false);
    }
  };

  const buildRoute = () => {
    const fromNodeIds = routeTargets.find((target) => target.id === routeFromId)?.routeNodeIds ?? [];
    const toNodeIds = routeTargets.find((target) => target.id === routeToId)?.routeNodeIds ?? [];

    if (fromNodeIds.length === 0 || toNodeIds.length === 0) {
      setRoute(null);
      setRouteError("Выберите обе точки маршрута.");
      return;
    }

    const result = computeShortestRoute(routingGraph, fromNodeIds, toNodeIds, { accessibleOnly });

    if (!result) {
      setRoute(null);
      setRouteError(accessibleOnly ? "Доступный маршрут не найден." : "Маршрут не найден.");
      return;
    }

    setRoute(result);
    setRouteError(null);
    setDrawerMode("route-result");
    setDrawerOpen(true);
    const firstLevel = result.summary.levels[0];

    if (firstLevel) {
      setActiveLevel(firstLevel);
    }
  };

  const swapRouteEndpoints = () => {
    const fromId = routeFromId;
    setRouteFromId(routeToId);
    setRouteToId(fromId);
    setRouteFromQ("");
    setRouteToQ("");
    setRouteError(null);
    setRouteBuilderStep(fromId ? "to" : "from");
  };

  const clearRoutePoint = (step: RouteBuilderStep) => {
    if (step === "from") {
      setRouteFromId("");
      setRouteFromQ("");
      setRouteBuilderStep("from");
    } else {
      setRouteToId("");
      setRouteToQ("");
      setRouteBuilderStep(routeFromId ? "to" : "from");
    }
    setRouteError(null);
  };

  const selectRoutePoint = (step: RouteBuilderStep, targetId: string) => {
    if (step === "from") {
      setRouteFromId(targetId);
      setRouteFromQ("");
      setRouteBuilderStep("to");
    } else {
      setRouteToId(targetId);
      setRouteToQ("");
      setRouteBuilderStep("to");
    }
    setRouteError(null);
  };

  const setActiveRouteQuery = (value: string) => {
    if (isEditingFrom) {
      setRouteFromQ(value);
      return;
    }
    setRouteToQ(value);
  };

  const clearActiveRouteQuery = () => {
    if (isEditingFrom) {
      setRouteFromQ("");
      return;
    }
    setRouteToQ("");
  };

  const setActiveRouteGrouping = (group: GroupKey) => {
    if (isEditingFrom) {
      setRouteFromGroup(group);
      return;
    }
    setRouteToGroup(group);
  };

  const queueZoom = (delta: 1 | -1) => {
    setZoomCommand((current) => ({ id: (current?.id ?? 0) + 1, delta }));
  };

  if (datasetError) {
    return (
      <div style={{ ...S.shell, ...(themeVars as CSSProperties) }}>
        <style>{CSS}</style>
        <div style={S.emptyState}>Dataset error: {datasetError}</div>
      </div>
    );
  }

  if (!indoorData || !dataset || !indexes) {
    return (
      <div style={{ ...S.shell, ...(themeVars as CSSProperties) }}>
        <style>{CSS}</style>
        <div style={S.emptyState}>Loading indoor dataset…</div>
      </div>
    );
  }

  return (
    <div style={{ ...S.shell, ...(themeVars as CSSProperties) }}>
      <style>{CSS}</style>

      <div style={S.mapBg}>
        <Suspense fallback={<div style={S.mapLoading}>Загрузка карты…</div>}>
          <LazyMapCanvas
            activeLevel={activeLevel}
            collections={dataset.collections}
            externalSceneMode={viewMode}
            featureById={indexes.featureById}
            featureLabelSourceById={indexes.featureLabelSourceById}
            featureSourceById={indexes.featureSourceById}
            focusRequestId={focusRequestId}
            levels={dataset.levels}
            onSelectFeature={onSelectFeature}
            route={route}
            selectableSpaceFeatures={indexes.selectableSpaceFeatures}
            selectedFeatureId={selectedFeatureId}
            showControls={false}
            themeVariant={themeVariant}
            zoomCommand={zoomCommand}
          />
        </Suspense>
      </div>

      <header style={S.topBar}>
        <div style={S.topBrandBlock}>
          <div style={S.topSectionLabel}>Пространство</div>
          <div style={S.topBrandRow}>
            <div style={S.logo}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="1" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.9" />
                <rect x="10" y="1" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.45" />
                <rect x="1" y="10" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.25" />
                <rect x="10" y="10" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.65" />
              </svg>
              <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-.02em" }}>Atlas</span>
            </div>
            <div style={S.searchField} className="hud-input-shell">
              <Ic.Search s={14} />
              <input
                ref={topSearchRef}
                style={S.searchInput}
                placeholder="Поиск помещений и людей…"
                value={browseQ}
                onFocus={openBrowse}
                onChange={(event) => {
                  setBrowseQ(event.target.value);
                  setDrawerMode("search");
                  setDrawerOpen(true);
                }}
              />
              {browseQ ? (
                <button
                  style={S.searchClearBtn}
                  className="hud-btn"
                  onClick={() => {
                    setBrowseQ("");
                    closeSearch();
                  }}
                  type="button"
                >
                  <Ic.X s={11} />
                </button>
              ) : null}
              <kbd style={S.kbd}>/</kbd>
            </div>
          </div>
        </div>

        <div style={S.topSceneBlock}>
          <div style={S.topSectionLabel}>Сцена</div>
          <div style={S.viewModes}>
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                style={{ ...S.segmentBtn, ...S.segmentBtnEqual, ...(viewMode === mode.id ? S.segmentBtnActive : {}) }}
                className="hud-btn hud-segment-btn"
                data-active={viewMode === mode.id ? "true" : undefined}
                onClick={() => setViewMode(mode.id)}
                type="button"
              >
                {mode.id === "plan" ? <Ic.Floor /> : mode.id === "explore" ? <Ic.Compass /> : <Ic.Eye />}
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={S.topActionBlock}>
          <div style={S.topSectionLabel}>Управление</div>
          <div style={S.topActionRow}>
            <div style={S.topFloorGroup}>
              {levels.map((level) => (
                <button
                  key={level.id}
                  style={{ ...S.segmentBtn, ...S.segmentBtnMono, ...(activeLevel === level.id ? S.segmentBtnActive : {}) }}
                  className="hud-btn hud-segment-btn"
                  data-active={activeLevel === level.id ? "true" : undefined}
                  onClick={() => setActiveLevel(level.id)}
                  type="button"
                >
                  {level.id}
                </button>
              ))}
            </div>
            <div style={S.topFloorGroup}>
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  style={{ ...S.segmentBtn, ...(themeVariant === option.id ? S.segmentBtnActive : {}) }}
                  className="hud-btn hud-segment-btn"
                  data-active={themeVariant === option.id ? "true" : undefined}
                  onClick={() => setThemeVariant(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div style={S.zoomStack}>
              <button style={S.zoomBtn} className="hud-btn hud-segment-btn" onClick={() => queueZoom(-1)} type="button">
                −
              </button>
              <div style={S.zoomDivider} />
              <button style={S.zoomBtn} className="hud-btn hud-segment-btn" onClick={() => queueZoom(1)} type="button">
                +
              </button>
            </div>
            <button
              style={S.opsBtn}
              className="hud-btn"
              onClick={() => {
                if (drawerOpen && drawerMode === "ops") {
                  closeDrawer();
                  return;
                }
                setDrawerMode("ops");
                setDrawerOpen(true);
              }}
              type="button"
            >
              <Ic.Grid />
              <span style={S.opsBadge}>
                <span style={{ ...S.liveDot, background: ST.available.c, width: 6, height: 6 }} /> {statusCounts.available} свободно
              </span>
            </button>
            <div style={S.syncChip}>
              <span style={{ ...S.liveDot, background: "#34d399", width: 5, height: 5 }} />
              {(occupancyUpdatedAt ?? time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </header>

      <div style={S.bottomBar}>
        <div style={{ ...S.bottomContextBlock, ...(drawerOpen && drawerMode === "route" ? S.bottomContextBlockRoute : {}) }}>
          <div style={S.bottomContext}>
            <div style={S.bottomModuleLabel}>
              {drawerOpen && drawerMode === "route"
                ? "Построение маршрута"
                : drawerOpen && drawerMode === "route-result"
                  ? "Активный маршрут"
                  : drawerOpen && drawerMode === "detail"
                    ? "Выбор"
                    : drawerOpen && drawerMode === "ops"
                      ? "Операции"
                      : route
                        ? "Активный маршрут"
                        : selectedFeature
                          ? "Выбор"
                          : "Пространство"}
            </div>
            <div style={S.bottomHeadline}>
              {drawerOpen && drawerMode === "route" ? (
                <>
                  {routeFrom?.name ?? "Выберите старт"} <span style={{ color: T.muted }}>→</span> {routeTo?.name ?? "Выберите точку назначения"}
                </>
              ) : drawerOpen && drawerMode === "route-result" && route ? (
                <>
                  {routeFrom?.name ?? "Старт"} <span style={{ color: T.muted }}>→</span> {routeTo?.name ?? "Точка назначения"}
                </>
              ) : drawerOpen && drawerMode === "detail" && selectedFeature ? (
                selectedFeature.properties.employee ?? selectedFeature.properties.name
              ) : drawerOpen && drawerMode === "ops" ? (
                "Оперативная сводка"
              ) : (
                bottomHeadline
              )}
            </div>
            <div style={S.bottomMetaRow}>
              {drawerOpen && drawerMode === "route" ? (
                <>
                  <span style={S.bottomMeta}>{routeFrom && routeTo ? "Маршрут готов к построению" : "Выберите обе точки, чтобы продолжить"}</span>
                  {routeFrom ? <span style={S.bottomChip}>{routeFrom.level}</span> : null}
                  {routeTo ? <span style={S.bottomChip}>{routeTo.level}</span> : null}
                </>
              ) : drawerOpen && drawerMode === "route-result" && route ? (
                <>
                  <span style={S.bottomMeta}>{routeSummaryDistance} м · {routeDurationLabel(route.summary.distance)}</span>
                  {route.summary.levels.map((level) => (
                    <span key={level} style={S.bottomChip}>{level}</span>
                  ))}
                </>
              ) : drawerOpen && drawerMode === "detail" && selectedFeature ? (
                <>
                  <span style={S.bottomMeta}>{selectedFeature.properties.department ?? "Общие"} · {selectedFeature.properties.level}</span>
                  <span style={S.bottomChip}>{selectedStatusLabel}</span>
                </>
              ) : drawerOpen && drawerMode === "ops" ? (
                <>
                  <span style={S.bottomMeta}>{statusCounts.available} свободно · {statusCounts.occupied} занято</span>
                  <span style={S.bottomChip}>{activeLevel}</span>
                </>
              ) : (
                <>
                  <span style={S.bottomMeta}>{bottomMeta}</span>
                  {route ? <span style={S.bottomChip}>{route.summary.levels.join(" · ")}</span> : null}
                </>
              )}
            </div>
          </div>
        </div>

        {drawerOpen && drawerMode === "route" ? (
          <div style={S.bottomRouteActions}>
            <label style={S.checkRow}>
              <div
                style={{ ...S.checkBox, ...(accessibleOnly ? S.checkBoxOn : {}) }}
                onClick={(event) => {
                  event.preventDefault();
                  setAccessibleOnly((current) => !current);
                }}
              >
                {accessibleOnly ? <Ic.Check /> : null}
              </div>
              <span>Только доступные маршруты</span>
            </label>
            <button
              style={{ ...S.ghostBtn, opacity: routeFrom && routeTo ? 1 : 0.45, pointerEvents: routeFrom && routeTo ? "auto" : "none" }}
              className="hud-btn"
              onClick={swapRouteEndpoints}
              type="button"
            >
              <Ic.Swap /> Поменять местами
            </button>
            <button
              style={{ ...S.ghostBtn, opacity: routeFrom || routeTo ? 1 : 0.45, pointerEvents: routeFrom || routeTo ? "auto" : "none" }}
              className="hud-btn"
              onClick={() => {
                setRouteFromId("");
                setRouteToId("");
                setRouteFromQ("");
                setRouteToQ("");
                setRouteBuilderStep("from");
                setRouteError(null);
              }}
              type="button"
            >
              Очистить
            </button>
            <button style={S.ghostBtn} className="hud-btn" onClick={closeDrawer} type="button">
              Закрыть
            </button>
            <button
              style={{ ...S.accentBtn, opacity: routeFrom && routeTo ? 1 : 0.35, pointerEvents: routeFrom && routeTo ? "auto" : "none" }}
              className="hud-accent"
              onClick={buildRoute}
              type="button"
            >
              <Ic.Nav /> Построить маршрут
            </button>
          </div>
        ) : drawerOpen && drawerMode === "route-result" && route ? (
          <div style={S.bottomRouteActions}>
            <button style={S.ghostBtn} className="hud-btn" onClick={closeDrawer} type="button">
              Закрыть
            </button>
            <button style={S.ghostBtn} className="hud-btn" onClick={() => openRouteBuilder()} type="button">
              <Ic.Route /> Изменить маршрут
            </button>
            <button
              style={S.accentBtn}
              className="hud-accent"
              onClick={() => {
                setRoute(null);
                setRouteError(null);
                closeDrawer();
              }}
              type="button"
            >
              Очистить
            </button>
          </div>
        ) : drawerOpen && drawerMode === "detail" && selectedFeature ? (
          <div style={S.bottomRouteActions}>
            <button style={S.ghostBtn} className="hud-btn" onClick={closeDrawer} type="button">
              Закрыть
            </button>
            <button
              style={{ ...S.ghostBtn, opacity: selectedRouteTarget ? 1 : 0.45, pointerEvents: selectedRouteTarget ? "auto" : "none" }}
              className="hud-btn"
              onClick={() => openRouteBuilder(selectedRouteTarget?.id ?? null, routeToId)}
              type="button"
            >
              <Ic.Route /> Маршрут отсюда
            </button>
            <button
              style={{ ...S.accentBtn, opacity: selectedRouteTarget ? 1 : 0.45, pointerEvents: selectedRouteTarget ? "auto" : "none" }}
              className="hud-accent"
              onClick={() => openRouteBuilder(routeTargets.find((target) => target.featureId === "room-l1-lobby")?.id ?? null, selectedRouteTarget?.id ?? null)}
              type="button"
            >
              <Ic.Nav /> Построить сюда
            </button>
          </div>
        ) : drawerOpen && drawerMode === "search" ? (
          <div style={S.bottomRouteActions}>
            <button style={S.ghostBtn} className="hud-btn" onClick={closeDrawer} type="button">
              Закрыть поиск
            </button>
          </div>
        ) : drawerOpen && drawerMode === "ops" ? (
          <div style={S.bottomRouteActions}>
            <button style={S.ghostBtn} className="hud-btn" onClick={closeDrawer} type="button">
              Закрыть панель
            </button>
          </div>
        ) : (
          <div style={S.bottomActionPrimary}>
            <button
              style={{ ...S.fab, ...(drawerOpen && drawerMode === "route" ? S.fabActive : {}) }}
              className="hud-accent"
              data-active={drawerOpen && drawerMode === "route" ? "true" : undefined}
              onClick={() => {
                if (drawerOpen && drawerMode === "route") {
                  setDrawerOpen(false);
                  return;
                }
                openRouteBuilder();
              }}
              type="button"
            >
              <Ic.Route /> <span>{route ? "Изменить маршрут" : "Построить маршрут"}</span>
            </button>
          </div>
        )}
      </div>

      {drawerOpen ? (
        <div
          style={{
            ...S.drawerLayer,
            ...(isWorkspaceDrawerMode ? S.drawerLayerWorkspace : S.drawerLayerInfo),
            ...(isInfoDrawerMode ? S.drawerLayerInfoInteractive : null),
          }}
          onClick={isWorkspaceDrawerMode ? closeDrawer : undefined}
        >
          <div
            style={{
              ...S.drawerSheet,
              ...(isWorkspaceDrawerMode ? S.drawerSheetWorkspace : S.drawerSheetInfo),
            }}
            className="hud-glass oa-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            {drawerMode === "search" ? (
              <div style={S.browsePanel}>
                <div style={S.bpHeader}>
                  <div style={S.bpToolbar}>
                    <div style={S.bpGroupRow}>
                      <span style={S.bpGroupLabel}>Группировать</span>
                      {GROUP_OPTIONS.map((group) => (
                        <button
                          key={group.key}
                          style={{ ...S.pill, ...(browseGroup === group.key ? S.pillActive : {}) }}
                          className="hud-btn"
                          data-active={browseGroup === group.key ? "true" : undefined}
                          onClick={() => setBrowseGroup(group.key)}
                          type="button"
                        >
                          {group.label}
                        </button>
                      ))}
                    </div>
                    <div style={S.bpToolbarMeta}>
                      <span style={S.bpCount}>
                        {browseQ.trim() ? `${matchedSearchResults.length} совпадений` : `${browseSpaces.length} помещений`}
                        {browsePeople.length > 0 ? ` · ${browsePeople.length} человек` : ""}
                      </span>
                      <button style={S.iconBtn} className="hud-btn" onClick={closeSearch} type="button">
                        <Ic.X />
                      </button>
                    </div>
                  </div>
                </div>
                <div style={S.bpBody}>
                  {browsePeople.length > 0 ? (
                    <div style={S.bpPeopleSection}>
                      <div style={S.bpSectionTitle}>
                        <Ic.User /> Люди
                      </div>
                      <div style={S.bpPeopleGrid}>
                        {browsePeople.slice(0, 6).map((person) => (
                          <PersonRow
                            key={person.featureId}
                            person={person}
                            onClick={(nextPerson) => {
                              setBrowseQ("");
                              onSelectFeature(nextPerson.featureId);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <GroupedGrid
                    spaces={browseQ.trim() ? matchedSearchResults : browseSpaces}
                    groupKey={browseGroup}
                    onSelect={(space) => {
                      setBrowseQ("");
                      onSelectFeature(space.featureId);
                    }}
                    selectedFeatureId={selectedFeatureId}
                  />
                </div>
              </div>
            ) : null}

            {drawerMode === "route" ? (
              <div style={S.routePanel}>
                <div style={S.bpHeader}>
                  <div style={S.rpTopToolbar}>
                    <div style={S.rpTopFlow}>
                      <div style={S.rpTopFlowText}>
                        <span style={S.bpGroupLabel}>Активный шаг</span>
                        <div style={S.rpTopFlowTitle}>{activeRouteTitle}</div>
                        <div style={S.rpTopFlowSubline}>{activeRouteSubtitle}</div>
                      </div>
                    </div>
                    <div style={S.bpToolbarMeta}>
                      <span style={S.bpCount}>
                        {routeError
                          ? routeError
                          : routeFrom && routeTo
                            ? "Маршрут готов к построению"
                            : `${activeRouteChoiceList.length} вариантов`}
                      </span>
                      <button style={S.iconBtn} className="hud-btn" onClick={closeDrawer} type="button">
                        <Ic.X />
                      </button>
                    </div>
                  </div>
                </div>
                <div style={S.rpFlowShell}>
                  <div style={S.rpPlannerBar}>
                    {[
                      { step: "from" as const, title: "Старт", point: routeFrom, helper: "Выберите, откуда начать маршрут." },
                      { step: "to" as const, title: "Назначение", point: routeTo, helper: "Выберите, куда нужно попасть." },
                    ].map(({ step, title, point, helper }, plannerIndex) => {
                      const isActive = activeRouteStep === step;
                      return (
                        <Fragment key={step}>
                          {plannerIndex === 1 ? (
                            <div style={S.rpSwapDock}>
                              <button style={S.rpSwapBtn} className="hud-btn" onClick={swapRouteEndpoints} type="button">
                                <Ic.Swap />
                              </button>
                            </div>
                          ) : null}
                          <div
                            style={{ ...S.rpPlannerCard, ...(isActive ? S.rpPlannerCardActive : {}) }}
                            onClick={() => setRouteBuilderStep(step)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setRouteBuilderStep(step);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div style={S.rpStepCard}>
                              <div style={S.rpStepCardTop}>
                                <span style={S.panelSectionLabel}>{title}</span>
                                <span
                                  style={{
                                    ...S.rpActiveStateChip,
                                    ...(isActive ? null : S.rpActiveStateChipHidden),
                                  }}
                                >
                                  Активно
                                </span>
                              </div>
                              {point ? (
                                <div style={S.rpStepCardBody}>
                                  <div style={S.rpStepCardName}>{point.name}</div>
                                  <div style={S.rpStepCardMeta}>
                                    <span style={S.rpStepMiniChip}>{point.level}</span>
                                    <span style={S.rpStepMiniChip}>{point.kindLabel}</span>
                                    {point.cap > 0 ? <span style={S.rpStepMiniChip}>{point.cap} мест</span> : null}
                                  </div>
                                </div>
                              ) : (
                                <div style={S.rpStepCardBody}>
                                  <div style={S.rpStepCardPlaceholder}>{helper}</div>
                                </div>
                              )}
                              <div style={S.rpStepCardActions}>
                                <button
                                  style={{ ...S.ghostBtn, ...S.rpStepAction }}
                                  className="hud-btn"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setRouteBuilderStep(step);
                                  }}
                                  type="button"
                                >
                                  {point ? "Изменить" : "Выбрать"}
                                </button>
                                {point ? (
                                  <button
                                    style={{ ...S.iconBtn, width: 28, height: 28 }}
                                    className="hud-btn"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      clearRoutePoint(step);
                                    }}
                                    type="button"
                                  >
                                    <Ic.X s={10} />
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>

                  <div style={S.rpStage}>
                    <div style={S.rpStageControls}>
                      <div style={S.rpColSearch} className="hud-input-shell">
                        <Ic.Search s={13} />
                        <input
                          style={S.rpColInput}
                          placeholder={isEditingFrom ? "Найдите стартовую точку…" : "Найдите точку назначения…"}
                          value={activeRouteQuery}
                          onChange={(event) => setActiveRouteQuery(event.target.value)}
                        />
                        {activeRouteQuery ? (
                          <button style={{ ...S.iconBtn, width: 22, height: 22 }} className="hud-btn" onClick={clearActiveRouteQuery} type="button">
                            <Ic.X s={10} />
                          </button>
                        ) : null}
                      </div>
                      <div style={S.rpColToolbar}>
                        <span style={{ fontSize: 10, color: T.muted, fontWeight: 600 }}>ГРУППА</span>
                        {GROUP_OPTIONS.slice(0, 3).map((group) => (
                          <button
                            key={group.key}
                            style={{ ...S.pillSm, ...(activeRouteGroup === group.key ? S.pillSmActive : {}) }}
                            className="hud-btn"
                            data-active={activeRouteGroup === group.key ? "true" : undefined}
                            onClick={() => setActiveRouteGrouping(group.key)}
                            type="button"
                          >
                            {group.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={S.rpStageBody}>
                      {activeRouteChoiceList.length > 0 ? (
                        <RouteCandidateGrid
                          spaces={activeRouteChoiceList}
                          groupKey={activeRouteGroup}
                          onSelect={(space) => selectRoutePoint(activeRouteStep, space.routeTargetId ?? "")}
                          selectedFeatureId={activeRouteSelectedFeatureId}
                        />
                      ) : (
                        <div style={S.rpEmptyState}>
                          <div style={S.rpEmptyTitle}>{activeRouteEmpty}</div>
                          <div style={S.sidePanelSubline}>
                            {activeRouteQuery.trim() ? "По текущему фильтру ничего не найдено. Попробуйте изменить запрос или группу." : "Начните с выбора точки или используйте поиск, чтобы быстро сузить список."}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {drawerMode === "route-result" && route ? (
              <div style={S.drawerInfoPanel}>
                <div style={S.infoDrawerHeader}>
                  <div style={S.infoDrawerHeaderMain}>
                    <span style={S.panelSectionLabel}>Маршрут</span>
                    <div style={S.infoDrawerHeaderTitle}>
                      {routeFrom?.name ?? "Старт"} <span style={{ color: T.muted }}>→</span> {routeTo?.name ?? "Точка назначения"}
                    </div>
                  </div>
                  <button style={S.iconBtn} className="hud-btn" onClick={closeDrawer} type="button">
                    <Ic.X />
                  </button>
                </div>
                <div style={S.sidePanelBody}>
                  <div style={{ ...S.sidePanelSectionCompact, minHeight: 0 }}>
                    <div style={S.sidePanelSectionHeader}>
                      <span style={S.panelSectionLabel}>Шаги</span>
                    </div>
                    <div
                      style={{
                        ...S.panelInsetScroll,
                        ...S.infoPanelScrollArea,
                        ...S.rrStepsGrid,
                        gridTemplateColumns: `repeat(${routeStepColumnCount}, minmax(0, 1fr))`,
                      }}
                    >
                      {routeStepColumns.map((column, columnIndex) => (
                        <div key={`col-${columnIndex}`} style={S.rrStepsColumn}>
                          {column.map((step, rowIndex) => {
                            const index = columnIndex * routeStepRows + rowIndex;
                            return (
                              <div key={`${index}-${step}`} style={S.rrStep}>
                                <div style={{ ...S.rrStepN, ...(index === routeStepsList.length - 1 ? { background: T.accent, color: "#0c1018", border: `1px solid ${T.accent}` } : {}) }}>
                                  {index === routeStepsList.length - 1 ? <Ic.Check /> : index + 1}
                                </div>
                                <span style={S.rrStepT}>{step}</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {drawerMode === "detail" && selectedFeature ? (
              <div style={S.drawerInfoPanel}>
                <div style={S.infoDrawerHeader}>
                  <div style={S.infoDrawerHeaderMain}>
                    <span style={S.panelSectionLabel}>
                      {selectedFeature.properties.employee ? "Сотрудник" : "Пространство"}
                    </span>
                    <div style={S.infoDrawerHeaderTitle}>
                      {selectedFeature.properties.employee ?? selectedFeature.properties.name}
                    </div>
                  </div>
                  <button style={S.iconBtn} className="hud-btn" onClick={closeDrawer} type="button">
                    <Ic.X />
                  </button>
                </div>
                <div style={{ ...S.sidePanelBody, ...S.sidePanelBodyDetail }}>
                  {(() => {
                    const equipment = selectedFeature.properties.equipment ?? [];
                    const hasEquipment = equipment.length > 0;
                    const hasSubtitle = Boolean(selectedFeature.properties.subtitle);
                    const hasCapacity = (selectedFeature.properties.capacity ?? 0) > 0;

                    return (
                      <>
                  {selectedFeature.properties.employee ? (
                    <div style={S.detailSummaryCard}>
                      <div style={S.personAv}>{selectedFeature.properties.employee[0]}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedFeature.properties.employee}</div>
                        <div style={{ fontSize: 11, color: T.muted }}>{selectedFeature.properties.name}</div>
                      </div>
                    </div>
                  ) : null}
                  {hasSubtitle || hasCapacity ? (
                    <div style={S.detailSummaryCard}>
                      <div style={S.detailSummaryContent}>
                        <div style={S.detailSummaryRow}>
                          {hasSubtitle ? (
                            <div style={S.detailSummaryText}>{selectedFeature.properties.subtitle}</div>
                          ) : <div />}
                          <div style={S.detailSummaryMeta}>
                            <span style={S.infoChip}>{selectedFeature.properties.department ?? "Общие"}</span>
                            {hasCapacity ? <span style={S.infoChip}>{selectedFeature.properties.capacity} мест</span> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div style={S.detailMetaGrid}>
                    {[
                      ["Отдел", selectedFeature.properties.department ?? "Общие"],
                      ["Этаж", selectedFeature.properties.level],
                      ["ID", selectedFeature.id],
                      ["Маршрут", selectedRouteTarget?.routeNodeId ?? "Н/Д"],
                    ].map(([label, value]) => (
                      <div key={label} style={S.detailMetaCell}>
                        <span style={{ fontSize: 9, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, ...(label === "ID" || label === "Маршрут" ? { fontFamily: MONO, fontSize: 10 } : {}) }}>{value}</span>
                      </div>
                    ))}
                  </div>
                  {hasEquipment ? (
                    <div style={S.detailEquipmentRow}>
                      {equipment.map((equipment) => (
                        <span key={equipment} style={S.infoChip}>
                          {equipment}
                        </span>
                      ))}
                    </div>
                  ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : null}

            {drawerMode === "ops" ? (
              <div style={S.drawerInfoPanel}>
                <div style={S.infoDrawerHeader}>
                  <div style={S.infoDrawerHeaderMain}>
                    <span style={S.panelSectionLabel}>Операции</span>
                    <div style={S.infoDrawerHeaderTitle}>Оперативная сводка</div>
                  </div>
                  <button style={S.iconBtn} className="hud-btn" onClick={closeDrawer} type="button">
                    <Ic.X />
                  </button>
                </div>
                <div style={S.sidePanelBody}>
                  <div style={S.opsOverviewGrid}>
                    <div style={S.opsHeroCard}>
                      <div style={S.sidePanelSectionHeader}>
                        <span style={S.panelSectionLabel}>Этаж</span>
                        <div style={S.panelChipRow}>
                          <span style={S.infoChip}>{activeLevel}</span>
                          <span style={S.infoChip}>{levelRoomCount} помещений</span>
                        </div>
                      </div>
                      <div style={S.opsHeroMain}>
                        <div style={S.opsHeroMetricBlock}>
                          <span style={{ ...S.opsHeroMetric, color: ST.available.c }}>{levelStatusCounts.available}</span>
                          <span style={S.opsHeroMetricLabel}>свободно сейчас</span>
                        </div>
                        <div style={S.opsHeroCopy}>
                          <div style={S.opsHeroTitle}>Оперативная загрузка этажа</div>
                          <div style={S.sidePanelSubline}>
                            Доступно {levelAvailabilityRate}% помещений. В использовании сейчас {occupiedNow} из {levelRoomCount}.
                          </div>
                        </div>
                      </div>
                      <div style={S.opsBreakdownBar}>
                        {Object.entries(ST).map(([statusKey, config]) => {
                          const count = levelStatusCounts[statusKey as RoomStatus];
                          return (
                            <div
                              key={statusKey}
                              style={{
                                ...S.opsBreakdownSegment,
                                flex: Math.max(count, 1),
                                background: count > 0 ? config.bg : "rgba(255,255,255,.02)",
                                border: count > 0 ? `1px solid ${config.c}22` : CONTROL_BORDER,
                                color: count > 0 ? config.c : T.muted,
                              }}
                            >
                              <span style={S.opsBreakdownValue}>{count}</span>
                              <span style={S.opsBreakdownLabel}>{config.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={S.opsMetaRow}>
                        <div style={S.opsMetaCard}>
                          <span style={S.opsMetaLabel}>ДОСТУПНОСТЬ</span>
                          <span style={S.opsMetaValue}>{levelAvailabilityRate}%</span>
                        </div>
                        <div style={S.opsMetaCard}>
                          <span style={S.opsMetaLabel}>ЗАГРУЗКА</span>
                          <span style={S.opsMetaValue}>{levelLoadRate}%</span>
                        </div>
                        <div style={S.opsMetaCard}>
                          <span style={S.opsMetaLabel}>ВНЕ СЕТИ</span>
                          <span style={S.opsMetaValue}>{levelStatusCounts.offline}</span>
                        </div>
                      </div>
                    </div>
                    <div style={S.sidePanelSection}>
                      <div style={S.sidePanelSectionHeader}>
                        <span style={S.panelSectionLabel}>Общий статус</span>
                        <span style={S.infoChip}>{totalTrackedRooms} помещений</span>
                      </div>
                      <div style={S.opsStatusGrid}>
                        {Object.entries(ST).map(([statusKey, config]) => (
                          <div key={statusKey} style={S.opsStatusCard}>
                            <span style={{ ...S.opsStatusValue, color: config.c }}>{statusCounts[statusKey as RoomStatus]}</span>
                            <span style={S.opsStatusLabel}>{config.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={S.sidePanelSection}>
                    <div style={S.sidePanelSectionHeader}>
                      <span style={S.panelSectionLabel}>Живые помещения</span>
                      <div style={S.panelChipRow}>
                        <span style={S.infoChip}>{opsRooms.length} позиций</span>
                        <span style={S.infoChip}>{levelStatusCounts.available} свободно</span>
                      </div>
                    </div>
                    <div style={S.opsRoomGrid}>
                      {opsRooms.map((space) => {
                        const config = ST[space.status];
                        return (
                          <button
                            key={space.id}
                            style={{
                              ...S.opsRoomCard,
                              ...(selectedFeatureId === space.featureId ? S.opsRoomCardSelected : {}),
                            }}
                            className="hud-card"
                            onClick={() => {
                              onSelectFeature(space.featureId);
                            }}
                            type="button"
                          >
                            <div style={S.opsRoomHeader}>
                              <div style={S.opsRoomTitleRow}>
                                <span style={{ ...S.statusDot, background: config.c, width: 8, height: 8 }} />
                                <span style={S.opsRoomName}>{space.name}</span>
                              </div>
                              <span style={{ ...S.statusPill, ...S.opsStatusPill, color: config.c, background: config.bg }}>{config.label}</span>
                            </div>
                            <div style={S.opsRoomMeta}>
                              <span style={S.opsRoomMetaItem}>{space.level}</span>
                              <span style={S.opsRoomMetaItem}>{space.cap} мест</span>
                              <span style={S.opsRoomMetaItem}>{space.kindLabel}</span>
                            </div>
                            <div style={S.opsRoomFooter}>
                              <span style={S.opsRoomDept}>{space.dept}</span>
                              {space.status === "occupied" || space.status === "focus" ? (
                                <span style={S.opsRoomSignal}>Требует внимания</span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const FONT = "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const TOP_BAR_CLEARANCE = 96;
const BOTTOM_BAR_CLEARANCE = 96;
const SIDE_PANEL_TOP_INSET = 16;
const ATLAS_THEME_VARS = {
  dark: {
    "--atlas-bg": "#0c1018",
    "--atlas-glass": "rgba(15,20,32,.72)",
    "--atlas-glass-heavy": "rgba(12,16,26,.92)",
    "--atlas-chrome-surface": "rgba(255,255,255,.032)",
    "--atlas-chrome-surface-soft": "rgba(255,255,255,.018)",
    "--atlas-chrome-surface-strong": "rgba(255,255,255,.045)",
    "--atlas-panel-surface": "rgba(255,255,255,.026)",
    "--atlas-panel-surface-soft": "rgba(255,255,255,.016)",
    "--atlas-panel-surface-strong": "rgba(255,255,255,.038)",
    "--atlas-border": "rgba(255,255,255,.07)",
    "--atlas-border-strong": "rgba(255,255,255,.12)",
    "--atlas-text": "#e4e6ea",
    "--atlas-sec": "rgba(255,255,255,.50)",
    "--atlas-muted": "rgba(255,255,255,.28)",
    "--atlas-accent": "#38bdf8",
    "--atlas-accent-bg": "rgba(56,189,248,.10)",
    "--atlas-accent-border": "rgba(56,189,248,.22)",
    "--atlas-hover-surface": "rgba(255,255,255,.06)",
    "--atlas-focus-surface": "rgba(56,189,248,.08)",
    "--atlas-btn-surface": "rgba(255,255,255,.045)",
    "--atlas-btn-surface-hover": "rgba(255,255,255,.075)",
    "--atlas-btn-surface-active": "rgba(56,189,248,.08)",
    "--atlas-btn-surface-border": "rgba(255,255,255,.14)",
    "--atlas-btn-primary-bg": "linear-gradient(180deg,#46c7ff,#27a8e4)",
    "--atlas-btn-primary-bg-hover": "linear-gradient(180deg,#59d1ff,#2eb2ee)",
    "--atlas-btn-primary-text": "#081018",
    "--atlas-control-shadow": "inset 0 1px 0 rgba(255,255,255,.028)",
    "--atlas-elev-top": "0 10px 34px rgba(0,0,0,.22)",
    "--atlas-elev-bottom": "0 -2px 28px rgba(0,0,0,.18)",
    "--atlas-elev-drawer": "0 8px 34px rgba(0,0,0,.24)",
    "--atlas-elev-side": "-8px 0 28px rgba(0,0,0,.18)",
    "--atlas-elev-floating": "0 6px 18px rgba(0,0,0,.18)",
    "--atlas-elev-accent": "0 10px 26px rgba(56,189,248,.16)",
    "--atlas-elev-accent-active": "0 10px 28px rgba(56,189,248,.22)",
    "--atlas-overlay": "rgba(0,0,0,.08)",
  },
  light: {
    "--atlas-bg": "#e4eaee",
    "--atlas-glass": "rgba(239,244,247,.88)",
    "--atlas-glass-heavy": "rgba(248,251,253,.96)",
    "--atlas-chrome-surface": "rgba(255,255,255,.72)",
    "--atlas-chrome-surface-soft": "rgba(245,249,251,.58)",
    "--atlas-chrome-surface-strong": "rgba(255,255,255,.84)",
    "--atlas-panel-surface": "rgba(247,250,252,.78)",
    "--atlas-panel-surface-soft": "rgba(239,245,248,.68)",
    "--atlas-panel-surface-strong": "rgba(255,255,255,.90)",
    "--atlas-border": "rgba(39,63,81,.14)",
    "--atlas-border-strong": "rgba(39,63,81,.22)",
    "--atlas-text": "#162632",
    "--atlas-sec": "rgba(22,38,50,.76)",
    "--atlas-muted": "rgba(34,55,71,.48)",
    "--atlas-accent": "#0f84c9",
    "--atlas-accent-bg": "rgba(15,132,201,.14)",
    "--atlas-accent-border": "rgba(15,132,201,.28)",
    "--atlas-hover-surface": "rgba(28,58,78,.075)",
    "--atlas-focus-surface": "rgba(15,132,201,.11)",
    "--atlas-btn-surface": "rgba(255,255,255,.86)",
    "--atlas-btn-surface-hover": "rgba(239,246,250,.98)",
    "--atlas-btn-surface-active": "rgba(15,132,201,.12)",
    "--atlas-btn-surface-border": "rgba(39,63,81,.18)",
    "--atlas-btn-primary-bg": "linear-gradient(180deg,#1498df,#0f84c9)",
    "--atlas-btn-primary-bg-hover": "linear-gradient(180deg,#1ca5ee,#1290d7)",
    "--atlas-btn-primary-text": "#f7fbfe",
    "--atlas-control-shadow": "inset 0 1px 0 rgba(255,255,255,.34)",
    "--atlas-elev-top": "0 8px 18px rgba(26,42,55,.10)",
    "--atlas-elev-bottom": "0 -1px 16px rgba(26,42,55,.08)",
    "--atlas-elev-drawer": "0 8px 18px rgba(26,42,55,.10)",
    "--atlas-elev-side": "-4px 0 16px rgba(26,42,55,.08)",
    "--atlas-elev-floating": "0 4px 12px rgba(26,42,55,.08)",
    "--atlas-elev-accent": "0 6px 16px rgba(15,132,201,.12)",
    "--atlas-elev-accent-active": "0 8px 18px rgba(15,132,201,.18)",
    "--atlas-overlay": "rgba(26,42,55,.04)",
  },
} as const;
const T = {
  bg: "var(--atlas-bg)",
  glass: "var(--atlas-glass)",
  glassH: "var(--atlas-glass-heavy)",
  border: "var(--atlas-border)",
  borderH: "var(--atlas-border-strong)",
  text: "var(--atlas-text)",
  sec: "var(--atlas-sec)",
  muted: "var(--atlas-muted)",
  accent: "var(--atlas-accent)",
  accentBg: "var(--atlas-accent-bg)",
  accentBorder: "var(--atlas-accent-border)",
  btnSurface: "var(--atlas-btn-surface)",
  btnSurfaceHover: "var(--atlas-btn-surface-hover)",
  btnSurfaceActive: "var(--atlas-btn-surface-active)",
  btnSurfaceBorder: "var(--atlas-btn-surface-border)",
  btnPrimaryBg: "var(--atlas-btn-primary-bg)",
  btnPrimaryBgHover: "var(--atlas-btn-primary-bg-hover)",
  btnPrimaryText: "var(--atlas-btn-primary-text)",
  controlShadow: "var(--atlas-control-shadow)",
  elevTop: "var(--atlas-elev-top)",
  elevBottom: "var(--atlas-elev-bottom)",
  elevDrawer: "var(--atlas-elev-drawer)",
  elevSide: "var(--atlas-elev-side)",
  elevFloating: "var(--atlas-elev-floating)",
  elevAccent: "var(--atlas-elev-accent)",
  elevAccentActive: "var(--atlas-elev-accent-active)",
  overlay: "var(--atlas-overlay)",
};

const CONTROL_HEIGHT = 42;
const CONTROL_INNER_HEIGHT = 34;
const CHROME_SURFACE = "var(--atlas-chrome-surface)";
const CHROME_SURFACE_SOFT = "var(--atlas-chrome-surface-soft)";
const CHROME_SURFACE_STRONG = "var(--atlas-chrome-surface-strong)";
const PANEL_SURFACE = "var(--atlas-panel-surface)";
const PANEL_SURFACE_SOFT = "var(--atlas-panel-surface-soft)";
const PANEL_SURFACE_STRONG = "var(--atlas-panel-surface-strong)";
const CONTROL_BORDER = `1px solid ${T.border}`;
const CONTROL_BORDER_STRONG = `1px solid ${T.borderH}`;
const CONTROL_SHADOW = T.controlShadow;
const segmentedFrame: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: 4,
  minHeight: CONTROL_HEIGHT,
  background: CHROME_SURFACE,
  border: CONTROL_BORDER,
  boxShadow: CONTROL_SHADOW,
};
const segmentedButtonBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minWidth: 0,
  minHeight: CONTROL_INNER_HEIGHT,
  padding: "0 12px",
  background: CHROME_SURFACE_SOFT,
  border: "1px solid transparent",
  borderRadius: 0,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: FONT,
  color: T.muted,
  whiteSpace: "nowrap",
};
const segmentedButtonActive: CSSProperties = {
  color: T.accent,
  background: T.accentBg,
  border: `1px solid ${T.accentBorder}`,
  boxShadow: `inset 0 0 0 1px ${T.accent}1f`,
};
const utilityControlBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: CONTROL_HEIGHT,
  padding: "0 14px",
  borderRadius: 0,
  background: CHROME_SURFACE,
  border: CONTROL_BORDER,
  boxShadow: CONTROL_SHADOW,
};
const secondaryActionBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  minHeight: CONTROL_HEIGHT,
  padding: "0 15px",
  background: T.btnSurface,
  color: T.text,
  border: `1px solid ${T.btnSurfaceBorder}`,
  borderRadius: 0,
  fontSize: 12,
  fontWeight: 650,
  fontFamily: FONT,
  letterSpacing: ".01em",
  boxShadow: CONTROL_SHADOW,
};
const primaryActionBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: CONTROL_HEIGHT,
  padding: "0 18px",
  background: T.btnPrimaryBg,
  color: T.btnPrimaryText,
  border: `1px solid ${T.accent}`,
  borderRadius: 0,
  fontSize: 13,
  fontWeight: 700,
  fontFamily: FONT,
  letterSpacing: ".01em",
  boxShadow: T.elevAccent,
};
const chromeSectionBase: CSSProperties = {
  background: PANEL_SURFACE,
  border: CONTROL_BORDER,
  boxShadow: CONTROL_SHADOW,
};
const microChipBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 28,
  padding: "0 10px",
  fontSize: 11,
  fontWeight: 650,
  color: T.sec,
  background: CHROME_SURFACE,
  border: CONTROL_BORDER,
  borderRadius: 0,
  letterSpacing: ".01em",
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  ::placeholder{color:${T.muted}}
  select{-webkit-appearance:none;-moz-appearance:none;appearance:none}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:5px}
  @keyframes oa-fade{from{opacity:0}to{opacity:1}}
  @keyframes oa-slide-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes oa-slide-left{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
  @keyframes oa-pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .oa-fade{animation:oa-fade .18s ease-out}
  .oa-slide-up{animation:oa-slide-up .22s ease-out}
  .oa-slide-left{animation:oa-slide-left .2s ease-out}
  .hud-glass{background:${T.glass};backdrop-filter:blur(24px) saturate(145%);-webkit-backdrop-filter:blur(24px) saturate(145%);border:1px solid ${T.border}}
  .hud-glass-heavy{background:${T.glassH};backdrop-filter:blur(40px) saturate(145%);-webkit-backdrop-filter:blur(40px) saturate(145%);border:1px solid ${T.borderH}}
  .hud-hover{cursor:pointer;transition:background .12s,border-color .12s}.hud-hover:hover{background:${T.glassH}!important;border-color:${T.borderH}!important}
  .hud-btn,.hud-card,.hud-accent,.hud-input-shell{transition:background .12s,border-color .12s,color .12s,box-shadow .12s,transform .08s}
  .hud-btn,.hud-accent{-webkit-appearance:none;appearance:none;outline:none}
  .hud-btn::-moz-focus-inner,.hud-accent::-moz-focus-inner{border:0;padding:0}
  .hud-segment-btn:focus,.hud-segment-btn:active{outline:none!important;box-shadow:none!important}
  .hud-segment-btn:focus:not(:focus-visible):not([data-active="true"]){background:rgba(255,255,255,.012)!important;border-color:transparent!important;box-shadow:none!important;color:${T.muted}!important}
  .hud-btn{cursor:pointer}.hud-btn:hover{background:${T.btnSurfaceHover}!important;border-color:${T.btnSurfaceBorder}!important;color:${T.text}!important}
  .hud-btn:focus-visible{outline:none;background:${T.btnSurfaceActive}!important;border-color:${T.accentBorder}!important;box-shadow:none!important;color:${T.text}!important}
  .hud-btn[data-active="true"],.hud-btn[data-active="true"]:hover,.hud-btn[data-active="true"]:focus-visible,.hud-btn[data-active="true"]:active{outline:none;background:${T.accentBg}!important;border-color:${T.accentBorder}!important;box-shadow:inset 0 0 0 1px ${T.accent}1f!important;color:${T.accent}!important}
  .hud-accent{cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s,transform .08s}.hud-accent:hover{background:${T.btnPrimaryBgHover}!important;border-color:${T.accent}!important;box-shadow:${T.elevAccentActive}!important;color:${T.btnPrimaryText}!important}.hud-accent:focus-visible{outline:none;background:${T.btnPrimaryBgHover}!important;border-color:${T.accent}!important;box-shadow:${T.elevAccentActive}!important;color:${T.btnPrimaryText}!important}.hud-accent:active{transform:scale(.97)}
  .hud-accent[data-active="true"],.hud-accent[data-active="true"]:hover,.hud-accent[data-active="true"]:focus-visible{background:${T.btnPrimaryBgHover}!important;border-color:${T.accent}!important;color:${T.btnPrimaryText}!important}
  .hud-card{cursor:pointer}.hud-card:hover{background:var(--atlas-hover-surface)!important;border-color:${T.borderH}!important;box-shadow:none!important}.hud-card:focus-visible{outline:none;background:var(--atlas-focus-surface)!important;border-color:${T.accentBorder}!important;box-shadow:none!important}
  .hud-input-shell:hover{background:var(--atlas-hover-surface)!important;border-color:${T.borderH}!important}
  .hud-input-shell:focus-within{background:var(--atlas-focus-surface)!important;border-color:${T.accentBorder}!important;box-shadow:none!important}
`;

const S: Record<string, CSSProperties> = {
  shell: { position: "relative", width: "100%", height: "100vh", overflow: "hidden", fontFamily: FONT, color: T.text, fontSize: 13, background: T.bg, lineHeight: 1.5 },
  mapBg: { position: "absolute", inset: 0, zIndex: 0 },
  mapLoading: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.sec },
  emptyState: { width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, color: T.sec, fontFamily: FONT },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    display: "grid",
    gridTemplateColumns: "minmax(320px, 1.2fr) auto auto",
    alignItems: "stretch",
    gap: 0,
    padding: 0,
    background: T.glass,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    border: CONTROL_BORDER_STRONG,
    borderRadius: 0,
    boxShadow: T.elevTop,
    minHeight: TOP_BAR_CLEARANCE,
  },
  topBrandBlock: { display: "grid", gap: 8, minWidth: 0, padding: "12px 14px", borderRight: CONTROL_BORDER, background: CHROME_SURFACE_SOFT },
  topBrandRow: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  topSectionLabel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" },
  logo: { display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minHeight: CONTROL_HEIGHT, background: CHROME_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0, flexShrink: 0 },
  searchField: { display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: 500, color: T.sec, background: CHROME_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, minWidth: 320, minHeight: CONTROL_HEIGHT, flex: 1 },
  searchInput: { flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: T.text, fontSize: 13, fontWeight: 500, fontFamily: FONT },
  searchClearBtn: { width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.05)", border: "1px solid transparent", borderRadius: 0, color: T.muted, flexShrink: 0 },
  kbd: { marginLeft: "auto", padding: "0 8px", minHeight: 24, display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 600, fontFamily: MONO, color: T.muted, background: "rgba(255,255,255,.04)", borderRadius: 0, border: CONTROL_BORDER },
  topSceneBlock: { display: "grid", alignContent: "center", gap: 8, padding: "12px 14px", borderRight: CONTROL_BORDER, minWidth: 280, background: CHROME_SURFACE_SOFT },
  topActionBlock: { display: "grid", alignContent: "center", gap: 8, padding: "12px 14px", minWidth: 420, background: CHROME_SURFACE_SOFT },
  topActionRow: { display: "flex", alignItems: "stretch", justifyContent: "flex-end", gap: 8, flexWrap: "nowrap" },
  topFloorGroup: { ...segmentedFrame },
  themeSwitch: { display: "flex", gap: 2, padding: 3, borderRadius: 0, background: "rgba(255,255,255,.03)", border: `1px solid ${T.border}` },
  themeBtn: { padding: "7px 12px", background: "none", border: "none", borderRadius: 0, fontSize: 12, fontWeight: 600, fontFamily: FONT, color: T.muted },
  themeBtnActive: { color: T.text, background: "rgba(255,255,255,.08)" },
  viewModes: { ...segmentedFrame, width: "100%" },
  segmentBtn: { ...segmentedButtonBase },
  segmentBtnEqual: { flex: "1 1 0" },
  segmentBtnMono: { fontFamily: MONO, fontWeight: 700, letterSpacing: ".01em" },
  segmentBtnActive: { ...segmentedButtonActive },
  opsBtn: { ...utilityControlBase, gap: 8, fontFamily: FONT, color: T.sec },
  opsBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" },
  syncChip: { ...utilityControlBase, gap: 7, padding: "0 12px", fontSize: 10, fontFamily: MONO, color: T.sec, whiteSpace: "nowrap", letterSpacing: ".04em" },
  liveDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0, animation: "oa-pulse 2.5s ease infinite" },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "stretch",
    gap: 0,
    padding: 0,
    background: T.glass,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    border: CONTROL_BORDER_STRONG,
    borderRadius: 0,
    boxShadow: T.elevBottom,
    minHeight: BOTTOM_BAR_CLEARANCE,
  },
  bottomModuleLabel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" },
  bottomContextBlock: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    minHeight: BOTTOM_BAR_CLEARANCE,
    padding: "12px 16px",
    background: "linear-gradient(90deg, rgba(255,255,255,.055), rgba(255,255,255,.024))",
    borderRight: CONTROL_BORDER_STRONG,
  },
  bottomContextBlockRoute: {
    padding: "14px 16px",
  },
  bottomActionPrimary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    minHeight: BOTTOM_BAR_CLEARANCE,
    padding: "12px 16px",
    background: "transparent",
    flexWrap: "wrap",
  },
  bottomRouteActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    minHeight: BOTTOM_BAR_CLEARANCE,
    padding: "12px 16px",
    background: "transparent",
    flexWrap: "wrap",
  },
  bottomContext: { display: "grid", gap: 4, minWidth: 0, maxWidth: 560 },
  bottomHeadline: {
    fontSize: 15,
    fontWeight: 750,
    letterSpacing: "-.02em",
    color: T.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  bottomMetaRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  bottomMeta: { fontSize: 11, color: T.sec, fontWeight: 500 },
  bottomChip: { ...microChipBase, padding: "0 8px", fontSize: 10, fontWeight: 700, fontFamily: MONO, textTransform: "uppercase" },
  floorPicker: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4 },
  zoomStack: { ...utilityControlBase, padding: 0, overflow: "hidden" },
  zoomBtn: {
    width: 36,
    minHeight: CONTROL_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "1px solid transparent",
    fontSize: 17,
    fontWeight: 400,
    fontFamily: FONT,
    color: T.sec,
  },
  zoomDivider: { width: 1, height: 22, background: T.border },
  fab: { ...primaryActionBase, whiteSpace: "nowrap", boxShadow: T.elevAccent },
  fabActive: { background: "#0ea5e9", border: "1px solid #0ea5e9", boxShadow: T.elevAccentActive },
  searchDrawerLayer: {
    position: "absolute",
    top: TOP_BAR_CLEARANCE,
    right: 0,
    bottom: BOTTOM_BAR_CLEARANCE,
    left: 0,
    zIndex: 9,
    background: T.overlay,
    display: "flex",
    alignItems: "stretch",
    justifyContent: "stretch",
    padding: 0,
  },
  searchDrawerSheet: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    maxHeight: "none",
    borderRadius: 0,
    overflow: "hidden",
    boxShadow: T.elevDrawer,
  },
  drawerLayer: {
    position: "absolute",
    top: TOP_BAR_CLEARANCE,
    right: 0,
    bottom: BOTTOM_BAR_CLEARANCE,
    left: 0,
    zIndex: 9,
    background: T.overlay,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "stretch",
    padding: 0,
  },
  drawerLayerWorkspace: {
    alignItems: "stretch",
  },
  drawerLayerInfo: {
    alignItems: "flex-end",
  },
  drawerLayerInfoInteractive: {
    pointerEvents: "none",
    background: "transparent",
  },
  drawerSheet: {
    width: "100%",
    minHeight: 0,
    borderRadius: 0,
    overflow: "hidden",
    boxShadow: T.elevDrawer,
    display: "flex",
    flexDirection: "column",
  },
  drawerSheetWorkspace: {
    height: "100%",
    maxHeight: "none",
  },
  drawerSheetInfo: {
    height: "auto",
    maxHeight: `calc(100vh - ${TOP_BAR_CLEARANCE + BOTTOM_BAR_CLEARANCE}px)`,
    pointerEvents: "auto",
  },
  browsePanel: {
    width: "100%",
    height: "100%",
    maxWidth: "none",
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  bpHeader: { padding: "10px 14px", borderBottom: CONTROL_BORDER_STRONG, flexShrink: 0, background: PANEL_SURFACE_STRONG },
  bpToolbarMeta: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  bpSearchRow: { display: "flex", alignItems: "center", gap: 10, color: T.sec },
  bpInput: { flex: 1, background: "none", border: "none", outline: "none", color: T.text, fontSize: 15, fontWeight: 500, fontFamily: FONT },
  bpDivider: { width: 1, height: 20, background: T.border },
  bpToolbar: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  bpGroupRow: { display: "flex", alignItems: "center", gap: 5 },
  bpGroupLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", marginRight: 4 },
  bpCount: { fontSize: 11, color: T.muted, fontWeight: 500 },
  bpBody: { flex: 1, overflowY: "auto", padding: "14px 16px" },
  bpPeopleSection: { marginBottom: 18 },
  bpSectionTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: T.sec, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 },
  bpPeopleGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 4 },
  pill: { ...microChipBase, padding: "0 12px", minHeight: 30, fontSize: 11, fontWeight: 600, color: T.sec, fontFamily: FONT },
  pillActive: { ...segmentedButtonActive },
  pillSm: { ...microChipBase, padding: "0 10px", minHeight: 26, fontSize: 10, fontWeight: 600, color: T.muted, fontFamily: FONT },
  pillSmActive: { ...segmentedButtonActive },
  groupedGrid: { display: "flex", flexDirection: "column", gap: 18 },
  group: {},
  groupHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  groupLabel: { fontSize: 12, fontWeight: 700, color: T.sec, textTransform: "uppercase", letterSpacing: ".04em" },
  groupCount: { fontSize: 10, fontWeight: 600, color: T.muted, background: "rgba(255,255,255,.04)", padding: "1px 7px", borderRadius: 10 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 6 },
  gridCompact: { gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 4 },
  card: { display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0, textAlign: "left", fontFamily: FONT, color: T.text },
  cardSelected: { border: `1px solid ${T.accent}`, background: T.accentBg, boxShadow: `0 0 0 1px ${T.accent}40` },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  cardNameRow: { display: "flex", alignItems: "center", gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  cardName: { fontSize: 13, fontWeight: 650, lineHeight: 1.3 },
  cardLevel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.accent, background: T.accentBg, padding: "2px 6px", borderRadius: 0, flexShrink: 0 },
  cardBottom: { display: "flex", alignItems: "center", gap: 8 },
  cardKind: { fontSize: 11, color: T.muted, fontWeight: 500 },
  cardCap: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: T.sec, fontWeight: 500 },
  cardDept: { fontSize: 10, color: T.muted, fontWeight: 500, marginTop: -2 },
  routeChoiceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 },
  routeChoiceCard: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 13px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0, textAlign: "left", fontFamily: FONT, color: T.text, minHeight: 114 },
  routeChoiceCardSelected: { border: `1px solid ${T.accent}`, background: T.accentBg, boxShadow: `0 0 0 1px ${T.accent}40` },
  routeChoiceTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  routeChoiceNameRow: { display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
  routeChoiceName: { fontSize: 13, fontWeight: 650, lineHeight: 1.3, minWidth: 0 },
  routeChoiceMeta: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  routeChoiceMetaText: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: T.sec, fontWeight: 500 },
  routeChoiceFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: "auto" },
  routeChoiceDept: { fontSize: 10, color: T.muted, fontWeight: 500 },
  routeChoiceStatus: { fontSize: 10, padding: "2px 8px", flexShrink: 0 },
  personRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0, fontFamily: FONT, color: T.text, textAlign: "left" },
  personAv: { width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,rgba(56,189,248,.2),rgba(56,189,248,.05))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: T.accent, flexShrink: 0 },
  personInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  routePanel: {
    width: "100%",
    height: "100%",
    maxWidth: "none",
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: 0,
    background: PANEL_SURFACE_SOFT,
  },
  rpTopToolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rpTopFlow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 },
  rpTopFlowText: { display: "grid", gap: 2, minWidth: 0 },
  rpTopFlowTitle: { fontSize: 15, fontWeight: 750, letterSpacing: "-.02em", lineHeight: 1.15, minWidth: 0 },
  rpTopFlowSubline: { fontSize: 12, color: T.muted, lineHeight: 1.35, minWidth: 0 },
  rpFlowStep: { ...microChipBase, padding: "0 12px", minHeight: 30, gap: 6, fontSize: 11, fontWeight: 700, color: T.sec, fontFamily: FONT },
  rpFlowStepActive: { ...segmentedButtonActive },
  rpFlowStepReady: { color: ST.available.c, fontSize: 12, lineHeight: 1, marginTop: -1 },
  rpFlowShell: { flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "hidden", padding: "8px 12px 10px" },
  rpPlannerBar: { display: "grid", gridTemplateColumns: "minmax(0,1fr) 34px minmax(0,1fr)", gap: 8, alignItems: "stretch", flexShrink: 0 },
  rpPlannerCard: { display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 104, padding: "10px 12px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, minWidth: 0 },
  rpPlannerCardActive: { background: T.accentBg, border: `1px solid ${T.accentBorder}`, boxShadow: `0 0 0 1px ${T.accent}26` },
  rpSummaryPanel: { display: "grid", gap: 10, alignContent: "start", minHeight: 152, padding: "14px 16px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, minWidth: 0 },
  rpSwapDock: { display: "flex", alignItems: "center", justifyContent: "center" },
  rpStage: { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW },
  rpStageTitle: { fontSize: 15, fontWeight: 750, letterSpacing: "-.02em", lineHeight: 1.2, marginTop: 0 },
  rpStageStat: { ...microChipBase, padding: "0 9px", minHeight: 26, fontSize: 10, fontWeight: 700, color: T.sec, fontFamily: MONO, letterSpacing: ".04em", flexShrink: 0 },
  rpStageControls: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: CONTROL_BORDER, flexShrink: 0, background: PANEL_SURFACE },
  rpStageBody: { flex: 1, overflowY: "auto", padding: "10px 14px 14px", minHeight: 0, scrollPaddingBottom: 18 },
  rpAside: { display: "flex", flexDirection: "column", gap: 12, minHeight: 0 },
  rpAsideShell: { display: "flex", flexDirection: "column", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, minHeight: 0 },
  rpAsideSection: { display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", borderBottom: CONTROL_BORDER_STRONG },
  rpAsideSectionActive: { background: T.accentBg },
  rpAsideSectionLast: { borderBottom: "none" },
  rpColumns: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 40px minmax(0, 1fr)",
    gap: 12,
    overflow: "hidden",
    minHeight: 0,
  },
  rpCol: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
    background: PANEL_SURFACE,
    border: CONTROL_BORDER,
    boxShadow: CONTROL_SHADOW,
  },
  rpColLast: { borderRight: CONTROL_BORDER },
  rpColHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 14px",
    borderBottom: CONTROL_BORDER,
    flexShrink: 0,
    background: PANEL_SURFACE_STRONG,
  },
  rpColLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 },
  rpSelected: { display: "flex", alignItems: "center", gap: 7, padding: "0 10px", minHeight: 30, background: T.accentBg, border: `1px solid ${T.accentBorder}`, boxShadow: `inset 0 0 0 1px ${T.accent}1f`, borderRadius: 0, marginTop: 0 },
  rpSelectedName: { fontSize: 13, fontWeight: 650 },
  rpSelectedLevel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.accent, marginLeft: "auto" },
  rpClearBtn: { width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.06)", border: "1px solid transparent", borderRadius: 0, color: T.muted, marginLeft: 4, flexShrink: 0 },
  rpColSearch: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderBottom: "none",
    color: T.muted,
    flexShrink: 0,
    background: "transparent",
  },
  rpColInput: { flex: 1, background: "none", border: "none", outline: "none", color: T.text, fontSize: 12, fontFamily: FONT },
  rpColToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    flexWrap: "nowrap",
    padding: 0,
    background: "transparent",
  },
  rpColBody: { flex: 1, overflowY: "auto", padding: "14px", scrollPaddingBottom: 18 },
  rpEmptyState: { display: "grid", gap: 6, padding: "16px 14px", background: PANEL_SURFACE, border: CONTROL_BORDER },
  rpEmptyTitle: { fontSize: 13, fontWeight: 650, color: T.text },
  rpStepCard: { display: "flex", flexDirection: "column", gap: 8, color: T.text, textAlign: "left" },
  rpStepCardActive: { background: "transparent" },
  rpStepCardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rpActiveStateChip: { ...microChipBase, minWidth: 72, padding: "0 10px", minHeight: 24, fontSize: 10, fontWeight: 700, color: T.sec, justifyContent: "center", fontFamily: FONT },
  rpActiveStateChipHidden: { visibility: "hidden" },
  rpStepCardBody: { display: "grid", gap: 6 },
  rpStepCardName: { fontSize: 13, fontWeight: 650, lineHeight: 1.3 },
  rpStepCardPlaceholder: { fontSize: 11, color: T.muted, lineHeight: 1.4 },
  rpStepCardMeta: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rpStepCardActions: { display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, flexWrap: "wrap" },
  rpStepAction: { minHeight: 26, padding: "0 9px", fontSize: 10 },
  rpStepMiniChip: { ...microChipBase, padding: "0 7px", minHeight: 22, fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.sec, letterSpacing: ".03em" },
  rpSummaryCard: { display: "grid", gap: 10 },
  rpSummaryPath: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text, fontWeight: 600, lineHeight: 1.45, flexWrap: "wrap" },
  rpSummaryMetaRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rpSwapCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    position: "relative",
    background: "transparent",
    paddingTop: 92,
    overflow: "hidden",
    flexShrink: 0,
  },
  rpSwapBtn: {
    width: 26,
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: CHROME_SURFACE,
    border: CONTROL_BORDER,
    boxShadow: `${CONTROL_SHADOW}, ${T.elevFloating}`,
    borderRadius: 0,
    color: T.muted,
    position: "relative",
    zIndex: 1,
  },
  drawerInfoPanel: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: PANEL_SURFACE_SOFT,
    borderTop: CONTROL_BORDER_STRONG,
  },
  infoDrawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 16px",
    borderBottom: CONTROL_BORDER_STRONG,
    background: PANEL_SURFACE_STRONG,
    flexShrink: 0,
  },
  infoDrawerHeaderMain: {
    display: "grid",
    gap: 4,
    minWidth: 0,
  },
  infoDrawerHeaderTitle: {
    fontSize: 18,
    fontWeight: 750,
    letterSpacing: "-.02em",
    lineHeight: 1.15,
    color: T.text,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  drawerSectionGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 },
  drawerSectionGridSingle: { display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12 },
  sidePanelSectionFull: { gridColumn: "1 / -1" },
  rpFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 16px",
    borderTop: CONTROL_BORDER_STRONG,
    background: PANEL_SURFACE_STRONG,
    flexShrink: 0,
  },
  rpFooterSummary: { display: "grid", gap: 3, minWidth: 0 },
  rpFooterHeadline: {
    fontSize: 15,
    fontWeight: 750,
    letterSpacing: "-.02em",
    color: T.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rpFooterMeta: { fontSize: 11, color: T.sec },
  rpFooterActions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" },
  rpResult: { padding: "16px 20px", borderTop: CONTROL_BORDER, flexShrink: 0, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" },
  rrHero: { display: "flex", alignItems: "center", gap: 14, flex: "1 1 400px", flexWrap: "wrap" },
  rrIcon: { width: 42, height: 42, borderRadius: 0, background: T.accentBg, color: T.accent, border: `1px solid ${T.accentBorder}`, boxShadow: `inset 0 0 0 1px ${T.accent}1f`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rrMain: { display: "flex", flexDirection: "column" },
  rrDist: { fontSize: 22, fontWeight: 800, fontFamily: MONO, letterSpacing: "-.02em" },
  rrTime: { fontSize: 11, color: T.sec },
  rrPath: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.sec, fontWeight: 500, width: "100%" },
  rrStats: { display: "flex", gap: 16, marginTop: 4, width: "100%" },
  rrStat: { display: "flex", flexDirection: "column", alignItems: "center", gap: 1 },
  rrStatV: { fontSize: 15, fontWeight: 800, fontFamily: MONO, lineHeight: 1, display: "flex", alignItems: "center" },
  rrStatL: { fontSize: 9, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: ".05em" },
  rrDirections: { flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 0 },
  rrStep: { display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0", marginBottom: 10 },
  rrStepN: { width: 22, height: 22, borderRadius: 0, background: CHROME_SURFACE, border: CONTROL_BORDER, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, color: T.sec },
  rrStepT: { fontSize: 12, color: T.sec, lineHeight: 1.5, paddingTop: 2 },
  rrStepsGrid: { display: "grid", gap: 20, alignItems: "start" },
  rrStepsColumn: { display: "grid", alignContent: "start", gap: 0, minWidth: 0 },
  accentBtn: { ...primaryActionBase },
  ghostBtn: { ...secondaryActionBase },
  iconBtn: { width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: CHROME_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0, color: T.sec, flexShrink: 0 },
  detailFloat: {
    position: "absolute",
    top: TOP_BAR_CLEARANCE + SIDE_PANEL_TOP_INSET,
    right: 0,
    bottom: BOTTOM_BAR_CLEARANCE,
    zIndex: 20,
    width: 352,
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    background: T.glass,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    borderLeft: CONTROL_BORDER_STRONG,
    boxShadow: T.elevSide,
    overflow: "hidden",
  },
  routeResultFloat: {
    position: "absolute",
    top: TOP_BAR_CLEARANCE + SIDE_PANEL_TOP_INSET,
    right: 0,
    bottom: BOTTOM_BAR_CLEARANCE,
    zIndex: 22,
    width: 416,
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    background: T.glass,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    borderLeft: CONTROL_BORDER_STRONG,
    boxShadow: T.elevSide,
    overflow: "hidden",
  },
  statusPill: { display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 20 },
  opsPanel: {
    position: "absolute",
    top: TOP_BAR_CLEARANCE + SIDE_PANEL_TOP_INSET,
    right: 0,
    bottom: BOTTOM_BAR_CLEARANCE,
    zIndex: 40,
    width: 372,
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    background: T.glass,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    borderLeft: CONTROL_BORDER_STRONG,
    boxShadow: T.elevSide,
    overflow: "hidden",
  },
  checkRow: { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none", fontSize: 12, color: T.sec, fontWeight: 500 },
  checkBox: { width: 15, height: 15, borderRadius: 4, border: "1.5px solid rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all .12s", color: "#0c1018", flexShrink: 0 },
  checkBoxOn: { background: T.accent, border: `1.5px solid ${T.accent}` },
  rrStatsPanel: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 },
  rrStatCard: { display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 0, background: PANEL_SURFACE_STRONG, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW },
  opsOverviewGrid: { display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(320px,.95fr)", gap: 12, alignItems: "stretch" },
  opsHeroCard: { display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, minHeight: 0 },
  opsHeroMain: { display: "flex", alignItems: "flex-start", gap: 16 },
  opsHeroMetricBlock: { display: "grid", gap: 4, minWidth: 108, flexShrink: 0 },
  opsHeroMetric: { fontSize: 42, fontWeight: 800, fontFamily: MONO, letterSpacing: "-.04em", lineHeight: 0.95 },
  opsHeroMetricLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" },
  opsHeroCopy: { display: "grid", gap: 4, minWidth: 0, paddingTop: 2 },
  opsHeroTitle: { fontSize: 16, fontWeight: 750, letterSpacing: "-.02em", color: T.text },
  opsBreakdownBar: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 },
  opsBreakdownSegment: { display: "grid", gap: 4, padding: "10px 12px", minWidth: 0 },
  opsBreakdownValue: { fontSize: 16, fontWeight: 800, fontFamily: MONO, lineHeight: 1 },
  opsBreakdownLabel: { fontSize: 10, fontWeight: 600, color: "currentColor", textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.9 },
  opsMetaRow: { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 },
  opsMetaCard: { display: "grid", gap: 4, padding: "10px 12px", background: PANEL_SURFACE_STRONG, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW },
  opsMetaLabel: { fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" },
  opsMetaValue: { fontSize: 18, fontWeight: 800, fontFamily: MONO, letterSpacing: "-.03em", lineHeight: 1 },
  opsStatusGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 },
  opsStatusCard: { display: "grid", gap: 4, padding: "12px 14px", background: PANEL_SURFACE_STRONG, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW },
  opsStatusValue: { fontSize: 26, fontWeight: 800, fontFamily: MONO, lineHeight: 1 },
  opsStatusLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em" },
  opsRoomGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 },
  opsRoomCard: { width: "100%", display: "flex", flexDirection: "column", gap: 12, padding: "14px", background: PANEL_SURFACE_STRONG, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0, fontFamily: FONT, color: T.text, textAlign: "left", minHeight: 132 },
  opsRoomCardSelected: { border: `1px solid ${T.accent}`, background: T.accentBg, boxShadow: `0 0 0 1px ${T.accent}40` },
  opsRoomHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  opsRoomTitleRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  opsRoomName: { fontSize: 14, fontWeight: 650, lineHeight: 1.3, minWidth: 0 },
  opsStatusPill: { marginLeft: "auto", flexShrink: 0, fontSize: 10, padding: "3px 9px" },
  opsRoomMeta: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  opsRoomMetaItem: { ...microChipBase, padding: "0 8px", minHeight: 24, fontSize: 10, fontWeight: 700, color: T.sec, fontFamily: MONO, letterSpacing: ".03em" },
  opsRoomFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: "auto" },
  opsRoomDept: { fontSize: 11, color: T.muted, fontWeight: 500, minWidth: 0 },
  opsRoomSignal: { fontSize: 10, fontWeight: 700, color: T.accent, textTransform: "uppercase", letterSpacing: ".05em", flexShrink: 0 },
  floatHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 12, borderBottom: CONTROL_BORDER_STRONG, background: PANEL_SURFACE_STRONG },
  panelHeaderTight: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    padding: "14px 16px",
    borderBottom: CONTROL_BORDER_STRONG,
    background: PANEL_SURFACE_STRONG,
    flexShrink: 0,
  },
  sidePanelBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    minHeight: 0,
    padding: "14px 16px",
    flex: "0 1 auto",
    maxHeight: `calc(100vh - ${TOP_BAR_CLEARANCE + BOTTOM_BAR_CLEARANCE + 104}px)`,
    background: PANEL_SURFACE_SOFT,
  },
  sidePanelBodyDetail: {
    paddingTop: 12,
    gap: 8,
  },
  infoPanelScrollArea: {
    maxHeight: 280,
  },
  sidePanelFooter: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    padding: "14px 16px",
    borderTop: CONTROL_BORDER_STRONG,
    background: PANEL_SURFACE_STRONG,
    flexShrink: 0,
  },
  sidePanelFooterColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 16px",
    borderTop: CONTROL_BORDER_STRONG,
    background: PANEL_SURFACE_STRONG,
    flexShrink: 0,
  },
  sidePanelTitle: { margin: 0, fontSize: 16, fontWeight: 750, letterSpacing: "-.02em", lineHeight: 1.15 },
  sidePanelSubline: { fontSize: 11, color: T.sec },
  sidePanelSection: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW },
  sidePanelSectionCompact: { display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW },
  sidePanelSectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  floatKicker: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: T.accent },
  floatTitle: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.15 },
  floatSubline: { fontSize: 12, color: T.sec },
  panelInset: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: PANEL_SURFACE_STRONG, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0 },
  panelInsetAccent: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, boxShadow: `inset 0 0 0 1px ${T.accent}1f`, borderRadius: 0 },
  panelInsetScroll: { overflowY: "auto", padding: "0 0 2px", minHeight: 0, flex: 1 },
  panelSectionLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", fontFamily: MONO },
  panelMetaGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  panelMetaCell: { display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px", background: PANEL_SURFACE_STRONG, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, borderRadius: 0 },
  panelChipRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  panelActionRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  panelActionColumn: { display: "flex", flexDirection: "column", gap: 8 },
  infoChip: { ...microChipBase, padding: "0 10px", fontSize: 11, fontWeight: 600, color: T.sec },
  detailSummaryCard: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: PANEL_SURFACE_STRONG, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW },
  detailSummaryContent: { display: "grid", gap: 6, minWidth: 0, width: "100%" },
  detailSummaryRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 },
  detailSummaryMeta: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexShrink: 0, whiteSpace: "nowrap" },
  detailSummaryText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  detailMetaGrid: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 },
  detailMetaCell: { display: "flex", flexDirection: "column", gap: 3, padding: "9px 10px", background: PANEL_SURFACE, border: CONTROL_BORDER, boxShadow: CONTROL_SHADOW, minWidth: 0 },
  detailEquipmentRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 2 },
};

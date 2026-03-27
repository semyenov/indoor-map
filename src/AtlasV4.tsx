import {
  Fragment,
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Accessibility,
  Armchair,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Compass,
  Flag,
  LayoutGrid,
  Layers2,
  Map as MapIcon,
  MapPinned,
  Navigation2,
  PanelLeftClose,
  PencilLine,
  Route as RouteIcon,
  Search,
  SquareX,
  X as CloseIcon,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
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
type InfoDrawerMode = Extract<DrawerMode, "detail" | "route-result">;

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
  return steps;
};

const routeDurationLabel = (distance: number) => `~${Math.max(1, Math.round(distance / 60))} мин пешком`;

const STATUS_ORDER: Record<RoomStatus, number> = {
  available: 0,
  occupied: 1,
  focus: 2,
  offline: 3,
};

const ICON_PROPS = {
  absoluteStrokeWidth: true,
  strokeWidth: 1.85,
} as const;

type SizedIconProps = {
  s?: number;
};

const sizedIcon = (Icon: LucideIcon, defaultSize: number) => ({ s = defaultSize }: SizedIconProps) => (
  <Icon size={s} {...ICON_PROPS} />
);

const fixedIcon = (Icon: LucideIcon, size: number) => () => <Icon size={size} {...ICON_PROPS} />;

const Ic = {
  Brand: fixedIcon(MapIcon, 18),
  Search: sizedIcon(Search, 15),
  X: sizedIcon(CloseIcon, 13),
  Nav: fixedIcon(Navigation2, 14),
  ClosePanel: fixedIcon(PanelLeftClose, 14),
  Route: fixedIcon(RouteIcon, 15),
  RouteEdit: fixedIcon(PencilLine, 15),
  RouteFrom: fixedIcon(MapPinned, 15),
  RouteTo: fixedIcon(Flag, 15),
  ClearRoute: fixedIcon(SquareX, 15),
  User: fixedIcon(Users, 13),
  Floor: fixedIcon(Layers2, 14),
  Check: fixedIcon(Check, 11),
  Swap: fixedIcon(ArrowUpDown, 13),
  Compass: fixedIcon(Compass, 14),
  Eye: fixedIcon(Clapperboard, 14),
  Grid: fixedIcon(LayoutGrid, 14),
  Seats: fixedIcon(Armchair, 12),
  Accessible: fixedIcon(Accessibility, 14),
  ChevronUp: fixedIcon(ChevronUp, 11),
  ChevronDown: fixedIcon(ChevronDown, 11),
};

function BottomActionLabel({
  accent = false,
  icon,
  label,
}: {
  accent?: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <span style={S.bottomActionLabel}>
      <span style={{ ...S.bottomActionGlyph, ...(accent ? S.bottomActionGlyphAccent : {}) }}>{icon}</span>
      <span style={S.bottomActionText}>{label}</span>
    </span>
  );
}

type SpaceCardProps = {
  space: AtlasSpace;
  onClick: (space: AtlasSpace) => void;
  selectedFeatureId: string | null;
  compact?: boolean;
  index?: number;
};

function SpaceCard({ space, onClick, selectedFeatureId, compact = false, index = 0 }: SpaceCardProps) {
  const st = ST[space.status];
  const isSelected = selectedFeatureId === space.featureId;

  return (
    <button
      onClick={() => onClick(space)}
      className="hud-card card-anim"
      style={{
        ...S.card,
        ...(isSelected ? S.cardSelected : {}),
        ...(compact ? { padding: "10px 12px" } : {}),
        "--ci": index,
      } as CSSProperties}
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
  let offset = 0;

  return (
    <div style={S.groupedGrid}>
      {groups.map(([label, items]) => {
        const groupOffset = offset;
        offset += items.length;
        return (
          <div key={label} style={S.group}>
            <div style={S.groupHeader}>
              <span style={S.groupLabel}>{label}</span>
              <span style={S.groupCount}>{items.length}</span>
            </div>
            <div style={{ ...S.grid, ...(compact ? S.gridCompact : {}) }}>
              {items.map((space, i) => (
                <SpaceCard
                  key={space.id}
                  space={space}
                  onClick={onSelect}
                  selectedFeatureId={selectedFeatureId}
                  compact={compact}
                  index={groupOffset + i}
                />
              ))}
            </div>
          </div>
        );
      })}
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
  let offset = 0;

  return (
    <div style={S.groupedGrid}>
      {groups.map(([label, items]) => {
        const groupOffset = offset;
        offset += items.length;
        return (
          <div key={label} style={S.group}>
            <div style={S.groupHeader}>
              <span style={S.groupLabel}>{label}</span>
              <span style={S.groupCount}>{items.length}</span>
            </div>
            <div style={S.routeChoiceGrid}>
              {items.map((space, i) => {
                const status = ST[space.status];
                const isSelected = selectedFeatureId === space.featureId;

                return (
                  <button
                    key={space.id}
                    style={{ ...S.routeChoiceCard, ...(isSelected ? S.routeChoiceCardSelected : {}), "--ci": groupOffset + i } as CSSProperties}
                    className="hud-card card-anim"
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
        );
      })}
    </div>
  );
}

export default function AtlasV4() {
  const [indoorData, setIndoorData] = useState<IndoorRuntimeData | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [activeLevel, setActiveLevel] = useState<LevelId>("L1");
  const [viewMode, setViewMode] = useState<MapSceneMode>(
    () => (localStorage.getItem("atlas.viewMode") as MapSceneMode | null) ?? "plan",
  );
  const [themeVariant, setThemeVariant] = useState<MapThemeVariant>(
    () => (localStorage.getItem("atlas.theme") as MapThemeVariant | null) ?? "dark",
  );
  const [time, setTime] = useState(new Date());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("search");
  const [lastInfoDrawerMode, setLastInfoDrawerMode] = useState<InfoDrawerMode>("detail");
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
  const [opsSearchQ, setOpsSearchQ] = useState("");
  const [opsGroupKey, setOpsGroupKey] = useState<GroupKey>("level");
  const [opsStatusFilter, setOpsStatusFilter] = useState<Set<RoomStatus>>(new Set());
  const [hoveredStepIdx, setHoveredStepIdx] = useState<number | null>(null);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeRevision, setRouteRevision] = useState(0);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [roomStatuses, setRoomStatuses] = useState<RoomStatuses>({});
  const [occupancyUpdatedAt, setOccupancyUpdatedAt] = useState<Date | null>(null);
  const [zoomCommand, setZoomCommand] = useState<{ id: number; delta: 1 | -1 } | null>(null);
  const [mapControlsOpen, setMapControlsOpen] = useState(true);
  const topSearchRef = useRef<HTMLInputElement | null>(null);
  const routeDefaultsAppliedRef = useRef(false);
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

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (e.key === "/" && !drawerOpen) {
        const a = document.activeElement;
        if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        setDrawerMode("search");
        setDrawerOpen(true);
        setTimeout(() => topSearchRef.current?.focus(), 40);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [drawerOpen]);

  useEffect(() => {
    localStorage.setItem("atlas.viewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("atlas.theme", themeVariant);
  }, [themeVariant]);

  useEffect(() => {
    if (drawerOpen) setDrawerMounted(true);
  }, [drawerOpen]);

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
    () => people.filter((person) => matchesPersonQuery(person, deferredBrowseQuery)),
    [people, deferredBrowseQuery],
  );

  const routeChoices = useMemo(
    () => atlasSpaces.filter((space) => space.routeTargetId !== null && space.kind !== "connector"),
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
  const hasRouteBuilderSelection = Boolean(routeFrom || routeTo);
  const activeRouteStep = routeBuilderStep === "to" && routeFrom ? "to" : "from";
  const isEditingFrom = activeRouteStep === "from";
  const activeRouteChoiceList = isEditingFrom ? routeFromChoices : routeToChoices;
  const activeRouteGroup = isEditingFrom ? routeFromGroup : routeToGroup;
  const activeRouteSelectedFeatureId = isEditingFrom ? routeFrom?.featureId ?? null : routeTo?.featureId ?? null;
  const activeRouteQuery = isEditingFrom ? routeFromQ : routeToQ;
  const activeRouteTitle = isEditingFrom ? "Выберите стартовую точку" : "Выберите точку назначения";
  const activeRouteSubtitle = isEditingFrom
    ? "Выберите старт, затем система переключит вас к назначению."
    : "Укажите назначение. Когда обе точки заданы, маршрут можно сразу построить.";
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
  const isWorkspaceDrawerMode = drawerMode === "search" || drawerMode === "route" || drawerMode === "ops";
  const isInfoDrawerMode = drawerMode === "detail" || drawerMode === "route-result";
  const bottomPanelMode: DrawerMode | null = drawerOpen
    ? drawerMode
    : lastInfoDrawerMode === "route-result" && route
      ? "route-result"
      : lastInfoDrawerMode === "detail" && selectedFeature
        ? "detail"
          : route
            ? "route-result"
            : selectedFeature
              ? "detail"
              : null;
  const hasBottomActionPanel = drawerOpen
    ? (drawerMode === "route")
      || (drawerMode === "route-result" && Boolean(route))
      || (drawerMode === "detail" && Boolean(selectedFeature))
    : true;
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
  const bottomSearchHeadline = browseQ.trim() ? `Поиск: ${browseQ.trim()}` : "Поиск помещений и людей";
  const bottomSearchMeta = browseQ.trim()
    ? `${matchedSearchResults.length} совпадений${browsePeople.length > 0 ? ` · ${browsePeople.length} человек` : ""}`
    : `${browseSpaces.length} помещений${browsePeople.length > 0 ? ` · ${browsePeople.length} человек` : ""}`;

  const statusCounts = statusRoomIds.reduce<Record<RoomStatus, number>>(
    (counts, featureId) => {
      const status = featureStatus(featureById, featureId, roomStatuses) ?? "offline";
      counts[status] += 1;
      return counts;
    },
    { available: 0, occupied: 0, focus: 0, offline: 0 },
  );

  const levelRank = new Map(levels.map((level, index) => [level.id, index]));
  const opsAllRooms = [...atlasSpaces.filter((space) => space.cap > 0)].sort(
    (left, right) =>
      (levelRank.get(left.level) ?? Number.MAX_SAFE_INTEGER) - (levelRank.get(right.level) ?? Number.MAX_SAFE_INTEGER) ||
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
      left.name.localeCompare(right.name),
  );
  const opsFilteredRooms = useMemo(
    () => opsAllRooms.filter((space) => matchesQuery(space, opsSearchQ)),
    [opsAllRooms, opsSearchQ],
  );
  const opsRooms = opsStatusFilter.size > 0 ? opsFilteredRooms.filter((space) => opsStatusFilter.has(space.status)) : opsFilteredRooms;
  const opsStatusCounts = opsRooms.reduce<Record<RoomStatus, number>>(
    (counts, space) => {
      counts[space.status] += 1;
      return counts;
    },
    { available: 0, occupied: 0, focus: 0, offline: 0 },
  );
  const opsRoomCount = opsRooms.length;
  const opsOccupiedNow = opsStatusCounts.occupied + opsStatusCounts.focus;
  const opsAvailabilityRate = opsRoomCount > 0 ? Math.round((opsStatusCounts.available / opsRoomCount) * 100) : 0;
  const opsLoadRate = opsRoomCount > 0 ? Math.round((opsOccupiedNow / opsRoomCount) * 100) : 0;
  const availableStatusConfig = ST.available;
  const opsLevelSummaries = levels
    .map((level) => {
      const rooms = opsRooms.filter((space) => space.level === level.id);
      const counts = rooms.reduce<Record<RoomStatus, number>>(
        (acc, space) => {
          acc[space.status] += 1;
          return acc;
        },
        { available: 0, occupied: 0, focus: 0, offline: 0 },
      );
      const occupied = counts.occupied + counts.focus;
      const availabilityRate = rooms.length > 0 ? Math.round((counts.available / rooms.length) * 100) : 0;
      const loadRate = rooms.length > 0 ? Math.round((occupied / rooms.length) * 100) : 0;

      return {
        level: level.id,
        rooms,
        counts,
        occupied,
        availabilityRate,
        loadRate,
      };
    })
    .filter((summary) => summary.rooms.length > 0);
  const opsUpdatedLabel = (occupancyUpdatedAt ?? time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    if (routeDefaultsAppliedRef.current || routeTargets.length === 0) {
      return;
    }

    const defaultFrom = routeTargets.find((target) => target.featureId === "room-l1-lobby")?.id ?? routeTargets[0]?.id ?? "";
    const defaultTo = routeTargets.find((target) => target.featureId === "room-l2-cedar")?.id ?? routeTargets[1]?.id ?? defaultFrom;
    routeDefaultsAppliedRef.current = true;
    setRouteFromId(defaultFrom);
    setRouteToId(defaultTo);
  }, [routeTargets]);

  useEffect(() => {
    if (drawerMode === "detail" || drawerMode === "route-result") {
      setLastInfoDrawerMode(drawerMode);
    }
  }, [drawerMode]);

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

  const clearSelectedFeature = () => {
    startTransition(() => {
      setSelectedFeatureId(null);

      if (drawerMode === "detail") {
        setDrawerOpen(false);
      }
    });
  };

  const onSelectRoute = useCallback(() => {
    if (!route) {
      return;
    }

    setDrawerMode("route-result");
    setDrawerOpen(true);
  }, [route]);

  const openBrowse = () => {
    setDrawerMode("search");
    setDrawerOpen(true);
    window.setTimeout(() => topSearchRef.current?.focus(), 80);
  };

  const openRouteBuilder = (
    fromTargetId: string | null = null,
    toTargetId: string | null = null,
    activeStep: RouteBuilderStep | null = null,
  ) => {
    const nextFromId = fromTargetId ?? routeFromId;
    const nextToId = toTargetId ?? routeToId;
    setDrawerMode("route");
    setDrawerOpen(true);
    setRouteFromId(nextFromId);
    setRouteToId(nextToId);
    setRouteFromQ("");
    setRouteToQ("");
    setRouteBuilderStep(activeStep ?? (nextFromId ? "to" : "from"));
    setRouteError(null);
  };

  const openRouteFromSelected = () => {
    if (!selectedRouteTarget) {
      return;
    }

    openRouteBuilder(selectedRouteTarget.id, routeToId === selectedRouteTarget.id ? null : routeToId, "to");
  };

  const openRouteToSelected = () => {
    if (!selectedRouteTarget) {
      return;
    }

    openRouteBuilder(routeFromId === selectedRouteTarget.id ? null : routeFromId, selectedRouteTarget.id, "from");
  };

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const closeSearch = () => {
    if (drawerMode === "search") {
      closeDrawer();
    }
  };

  const openBottomContextDrawer = () => {
    if (drawerOpen) {
      setDrawerOpen(false);
      return;
    }

    if (lastInfoDrawerMode === "route-result" && route) {
      setDrawerMode("route-result");
      setDrawerOpen(true);
      return;
    }

    if (lastInfoDrawerMode === "detail" && selectedFeature) {
      setDrawerMode("detail");
      setDrawerOpen(true);
      return;
    }

    if (route) {
      setDrawerMode("route-result");
      setDrawerOpen(true);
      return;
    }

    if (selectedFeature) {
      setDrawerMode("detail");
      setDrawerOpen(true);
      return;
    }

    openBrowse();
  };

  const buildRoute = () => {
    const fromNodeIds = routeTargets.find((target) => target.id === routeFromId)?.routeNodeIds ?? [];
    const toNodeIds = routeTargets.find((target) => target.id === routeToId)?.routeNodeIds ?? [];

    console.debug("[route:build] requested", {
      routeFromId,
      routeToId,
      fromNodeIds,
      toNodeIds,
      accessibleOnly,
    });

    if (fromNodeIds.length === 0 || toNodeIds.length === 0) {
      console.debug("[route:build] aborted: missing endpoints");
      setRoute(null);
      setRouteRevision((current) => current + 1);
      setRouteError("Выберите обе точки маршрута.");
      return;
    }

    const result = computeShortestRoute(routingGraph, fromNodeIds, toNodeIds, { accessibleOnly });

    if (!result) {
      console.debug("[route:build] no route found", {
        accessibleOnly,
      });
      setRoute(null);
      setRouteRevision((current) => current + 1);
      setRouteError(accessibleOnly ? "Доступный маршрут не найден." : "Маршрут не найден.");
      return;
    }

    console.debug("[route:build] route ready", {
      distance: result.summary.distance,
      levels: result.summary.levels,
      connectorTypes: result.summary.connectorTypes,
      legCount: result.legs.length,
      segmentCount: result.segments.length,
    });

    setRoute(result);
    setRouteRevision((current) => current + 1);
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

  const clearRouteBuilder = () => {
    setRouteFromId("");
    setRouteToId("");
    setRouteFromQ("");
    setRouteToQ("");
    setRouteBuilderStep("from");
    setRouteError(null);
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
            onClearSelection={clearSelectedFeature}
            onSelectRoute={onSelectRoute}
            hoveredStepIdx={hoveredStepIdx}
            route={route}
            routeRevision={routeRevision}
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
              <span style={{ color: T.accent, display: "inline-flex" }}>
                <Ic.Brand />
              </span>
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
                  aria-label="Очистить поиск"
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
            <button
              style={S.opsBtn}
              className="hud-btn"
              aria-label="Панель операций"
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
          </div>
        </div>

      </header>

      <div style={S.mapControls}>
        <div style={S.mapControlsHeader}>
          <span style={S.topSectionLabel}>Управление</span>
          <button
            style={S.mapControlsToggle}
            className="hud-btn"
            aria-label={mapControlsOpen ? "Свернуть панель управления" : "Развернуть панель управления"}
            onClick={() => setMapControlsOpen((v) => !v)}
            type="button"
          >
            {mapControlsOpen ? <Ic.ChevronUp /> : <Ic.ChevronDown />}
          </button>
        </div>
        {mapControlsOpen && <div style={S.mapControlsRow}>
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
        </div>}
        {mapControlsOpen && <div style={S.mapControlsRow}>
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
            <button style={{ ...S.segmentBtn, ...S.segmentBtnMono }} className="hud-btn hud-segment-btn" onClick={() => queueZoom(-1)} aria-label="Уменьшить масштаб" type="button">
              −
            </button>
            <button style={{ ...S.segmentBtn, ...S.segmentBtnMono }} className="hud-btn hud-segment-btn" onClick={() => queueZoom(1)} aria-label="Увеличить масштаб" type="button">
              +
            </button>
          </div>
        </div>}
      </div>

      <div style={{ ...S.bottomBar, ...(drawerOpen ? S.bottomBarDrawerOpen : null) }}>
        <button
          style={{
            ...S.bottomContextBlock,
            ...(drawerOpen ? S.bottomContextBlockDrawerOpen : null),
            ...(hasBottomActionPanel ? null : S.bottomContextBlockSolo),
          }}
          className="hud-btn"
          aria-label="Открыть панель"
          onClick={openBottomContextDrawer}
          type="button"
        >
          <div style={S.bottomContextStrip} />
          <div style={S.bottomContext}>
            <div key={`${bottomPanelMode}:${selectedFeatureId ?? ""}:${routeFrom?.id ?? ""}:${routeTo?.id ?? ""}`} style={S.bottomContextContent}>
            <div style={S.bottomModuleLabel}>
              {bottomPanelMode === "route"
                ? "Построение маршрута"
                : bottomPanelMode === "route-result"
                  ? "Активный маршрут"
                  : bottomPanelMode === "detail"
                    ? "Детали"
                    : bottomPanelMode === "search"
                      ? "Поиск"
                      : bottomPanelMode === "ops"
                        ? "Операции"
                        : route
                          ? "Активный маршрут"
                          : selectedFeature
                            ? "Выбранный объект"
                            : "Пространство"}
            </div>
            <div style={S.bottomHeadline}>
              {bottomPanelMode === "route" ? (
                <>
                  {routeFrom?.name ?? "Выберите старт"} <span style={{ color: T.muted }}>→</span> {routeTo?.name ?? "Выберите точку назначения"}
                </>
              ) : bottomPanelMode === "route-result" && route ? (
                <>
                  {routeFrom?.name ?? "Старт"} <span style={{ color: T.muted }}>→</span> {routeTo?.name ?? "Точка назначения"}
                </>
              ) : bottomPanelMode === "detail" && selectedFeature ? (
                selectedFeature.properties.employee ?? selectedFeature.properties.name
              ) : bottomPanelMode === "search" ? (
                bottomSearchHeadline
              ) : bottomPanelMode === "ops" ? (
                "Оперативная сводка"
              ) : (
                bottomHeadline
              )}
            </div>
            <div style={S.bottomMetaRow}>
              {bottomPanelMode === "route" ? (
                <>
                  <span style={S.bottomMeta}>{routeFrom && routeTo ? "Маршрут готов к построению" : "Выберите обе точки, чтобы продолжить"}</span>
                </>
              ) : bottomPanelMode === "route-result" && route ? (
                <>
                  <span style={S.bottomMeta}>{routeSummaryDistance} м · {routeDurationLabel(route.summary.distance)}</span>
                </>
              ) : bottomPanelMode === "detail" && selectedFeature ? (
                <>
                  <span style={S.bottomMeta}>{selectedFeature.properties.department ?? "Общие"} · {selectedFeature.properties.level}</span>
                </>
              ) : bottomPanelMode === "search" ? (
                <>
                  <span style={S.bottomMeta}>{bottomSearchMeta}</span>
                </>
              ) : bottomPanelMode === "ops" ? (
                <>
                  <span style={S.bottomMeta}>{statusCounts.available} свободно · {statusCounts.occupied} занято</span>
                </>
              ) : (
                <>
                  <span style={S.bottomMeta}>{bottomMeta}</span>
                </>
              )}
            </div>
            </div>
          </div>
          <div style={{ ...S.bottomExpandArrow, ...(drawerOpen ? S.bottomExpandArrowDrawerOpen : null) }}>
            {drawerOpen ? <Ic.ChevronDown /> : <Ic.ChevronUp />}
          </div>
        </button>

        {drawerOpen && drawerMode === "route" ? (
          <div style={{ ...S.bottomRouteActions, ...S.bottomRouteActionsDrawerOpen }}>
            <div style={S.bottomSecondaryGroup}>
              <button
                style={{ ...S.bottomSegBtn, opacity: hasRouteBuilderSelection ? 1 : 0.45, pointerEvents: hasRouteBuilderSelection ? "auto" : "none" }}
                className="hud-btn hud-segment-btn"
                onClick={clearRouteBuilder}
                type="button"
              >
                <BottomActionLabel icon={<Ic.ClearRoute />} label="Очистить" />
              </button>
            </div>
            <button
              style={{ ...S.bottomPrimaryBtn, opacity: routeFrom && routeTo ? 1 : 0.35, pointerEvents: routeFrom && routeTo ? "auto" : "none" }}
              className="hud-accent"
              onClick={buildRoute}
              type="button"
            >
              <BottomActionLabel accent icon={<Ic.Nav />} label="Построить маршрут" />
            </button>
          </div>
        ) : drawerOpen && drawerMode === "route-result" && route ? (
          <div style={{ ...S.bottomRouteActions, ...S.bottomRouteActionsDrawerOpen }}>
            <div style={S.bottomSecondaryGroup}>
              <button style={S.bottomSegBtn} className="hud-btn hud-segment-btn" onClick={() => openRouteBuilder()} type="button">
                <BottomActionLabel icon={<Ic.RouteEdit />} label="Изменить маршрут" />
              </button>
            </div>
            <button
              style={S.bottomPrimaryBtn}
              className="hud-accent"
              onClick={() => {
                setRoute(null);
                setRouteRevision((current) => current + 1);
                setRouteError(null);
                closeDrawer();
              }}
              type="button"
            >
              <BottomActionLabel accent icon={<Ic.ClearRoute />} label="Очистить" />
            </button>
          </div>
        ) : drawerOpen && drawerMode === "detail" && selectedFeature ? (
          <div style={{ ...S.bottomRouteActions, ...S.bottomRouteActionsDrawerOpen }}>
            <div style={S.bottomSecondaryGroup}>
              <button
                style={{ ...S.bottomSegBtn, opacity: selectedRouteTarget ? 1 : 0.45, pointerEvents: selectedRouteTarget ? "auto" : "none" }}
                className="hud-btn hud-segment-btn"
                onClick={openRouteFromSelected}
                type="button"
              >
                <BottomActionLabel icon={<Ic.RouteFrom />} label="Маршрут отсюда" />
              </button>
            </div>
            <button
              style={{ ...S.bottomPrimaryBtn, opacity: selectedRouteTarget ? 1 : 0.45, pointerEvents: selectedRouteTarget ? "auto" : "none" }}
              className="hud-accent"
              onClick={openRouteToSelected}
              type="button"
            >
              <BottomActionLabel accent icon={<Ic.RouteTo />} label="Построить сюда" />
            </button>
          </div>
        ) : drawerOpen ? null : (
          <div style={S.bottomActionPrimary}>
            <button
              style={{ ...S.bottomPrimaryBtn, ...(drawerOpen && drawerMode === "route" ? S.fabActive : {}) }}
              className="hud-accent"
              data-active={drawerOpen && drawerMode === "route" ? "true" : undefined}
              onClick={() => {
                if (drawerOpen && drawerMode === "route") {
                  closeDrawer();
                  return;
                }
                openRouteBuilder();
              }}
              type="button"
            >
              <BottomActionLabel accent icon={route ? <Ic.RouteEdit /> : <Ic.Route />} label={route ? "Изменить маршрут" : "Построить маршрут"} />
            </button>
          </div>
        )}
      </div>

      {drawerMounted ? (
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
            className={`hud-glass ${drawerMounted && !drawerOpen ? "oa-slide-out" : "oa-slide-up"}`}
            onClick={(event) => event.stopPropagation()}
            onAnimationEnd={() => {
              if (!drawerOpen) setDrawerMounted(false);
            }}
          >
            {drawerMode === "search" ? (
              <div style={S.browsePanel} className="oa-fade">
                <div style={S.rpFlowShell}>
                  <div style={S.rpStage}>
                    <div style={S.rpStageControls}>
                      <div style={S.rpColToolbar}>
                        <span style={{ fontSize: 10, color: T.muted, fontWeight: 700, letterSpacing: ".06em", fontFamily: MONO }}>ГРУППА</span>
                        {GROUP_OPTIONS.map((group) => (
                          <button
                            key={group.key}
                            style={{ ...S.pillSm, ...(browseGroup === group.key ? S.pillSmActive : {}) }}
                            className="hud-btn"
                            data-active={browseGroup === group.key ? "true" : undefined}
                            onClick={() => setBrowseGroup(group.key)}
                            type="button"
                          >
                            {group.label}
                          </button>
                        ))}
                      </div>
                      <span style={{ ...S.rpStageStat, marginLeft: "auto" }}>
                        {browseQ.trim() ? `${matchedSearchResults.length} совп` : `${browseSpaces.length} пом`}
                        {browsePeople.length > 0 ? ` · ${browsePeople.length} чел` : ""}
                      </span>
                    </div>
                    <div style={{ ...S.rpStageBody, display: "flex", flexDirection: "column", gap: 12 }}>
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
                      {browseQ.trim() && matchedSearchResults.length === 0 && browsePeople.length === 0 ? (
                        <div style={S.emptySearchBlock}>
                          <div style={S.emptySearchIcon}><Ic.Search s={22} /></div>
                          <div style={S.emptySearchTitle}>Ничего не найдено</div>
                          <div style={S.emptySearchSub}>Нет совпадений для «{browseQ}»</div>
                        </div>
                      ) : (
                        <GroupedGrid
                          spaces={browseQ.trim() ? matchedSearchResults : browseSpaces}
                          groupKey={browseGroup}
                          onSelect={(space) => {
                            setBrowseQ("");
                            onSelectFeature(space.featureId);
                          }}
                          selectedFeatureId={selectedFeatureId}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {drawerMode === "route" ? (
              <div style={S.routePanel} className="oa-fade">
                <div style={S.rpFlowShell}>
                  <div style={S.rpStage}>
                    <div style={{ ...S.rpStageControls, ...S.rpStageControlsRoute }} className="hud-focus-shell">
                      <div style={S.rpStageSearchRow}>
                        <div style={S.rpColSearch}>
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
                      </div>
                      <div style={S.rpStageMetaRow}>
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
                        <span style={S.rpStageStat}>
                          {activeRouteQuery.trim() ? `${activeRouteChoiceList.length} совп` : `${activeRouteChoiceList.length} точек`}
                        </span>
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
                  <div style={S.rpPlannerBar}>
                    {[
                      { step: "from" as const, point: routeFrom, placeholder: "Откуда", helper: "Выберите начальную точку", label: "СТАРТ" },
                      { step: "to" as const, point: routeTo, placeholder: "Куда", helper: "Выберите конечную точку", label: "ФИНИШ" },
                    ].map(({ step, point, placeholder, helper, label }, plannerIndex) => {
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
                            <div style={S.rpPlannerRow}>
                              <div style={{ ...S.rpPlannerGlyph, ...(isActive || point ? S.rpPlannerGlyphActive : {}) }}>
                                {step === "from" ? <Ic.RouteFrom /> : <Ic.RouteTo />}
                              </div>
                              <div style={S.rpPlannerBody}>
                                <div style={S.rpPlannerLabel}>{label}</div>
                                <div style={point ? S.rpPlannerName : S.rpPlannerNameEmpty}>
                                  {point ? point.name : placeholder}
                                </div>
                                <div style={S.rpPlannerHint}>
                                  {point
                                    ? `${point.level} · ${point.kindLabel}${point.cap > 0 ? ` · ${point.cap} мест` : ""}`
                                    : helper}
                                </div>
                              </div>
                              {point ? (
                                <button
                                  style={S.rpStepClearBtn}
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
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {drawerMode === "route-result" && route ? (
              <div style={S.drawerInfoPanel} className="oa-fade">
                <div style={S.sidePanelBody}>
                  <div style={S.rrSummaryCard}>
                    <div style={S.rrSummaryMain}>
                      <span style={S.rrSummaryDist}>{routeSummaryDistance} м</span>
                      <span style={S.rrSummaryTime}>{routeDurationLabel(route.summary.distance)}</span>
                    </div>
                    <div style={S.rrSummaryMeta}>
                      {route.summary.levels.map((l) => <span key={l} style={S.infoChip}>{l}</span>)}
                      <span style={S.infoChip}>{routeStepsList.length} шагов</span>
                    </div>
                  </div>
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
                            const isLast = index === routeStepsList.length - 1;
                            const isLastInColumn = rowIndex === column.length - 1;
                            const isHovered = hoveredStepIdx === index;
                            return (
                              <div
                                key={`${index}-${step}`}
                                style={{ ...S.rrStep, position: "relative", ...(isHovered ? { background: T.accentBg, borderRadius: 0 } : {}) }}
                                onMouseEnter={() => setHoveredStepIdx(index)}
                                onMouseLeave={() => setHoveredStepIdx(null)}
                                onClick={() => setHoveredStepIdx(index)}
                              >
                                {!isLastInColumn && (
                                  <div style={{ position: "absolute", left: 10, top: 28, width: 1, bottom: -10, background: T.border }} />
                                )}
                                <div style={{ ...S.rrStepN, position: "relative", zIndex: 1, ...(isLast ? { background: T.accent, color: T.bg, border: `1px solid ${T.accent}` } : isHovered ? { background: T.accentBg, border: `1px solid ${T.accentBorder}`, color: T.accent } : {}) }}>
                                  {isLast ? <Ic.Check /> : index + 1}
                                </div>
                                <span style={{ ...S.rrStepT, ...(isHovered ? { color: T.text } : {}) }}>{step}</span>
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
              <div style={S.drawerInfoPanel} className="oa-fade">
                {(() => {
                  const equipment = selectedFeature.properties.equipment ?? [];
                  const hasEquipment = equipment.length > 0;
                  const hasSubtitle = Boolean(selectedFeature.properties.subtitle);
                  const hasCapacity = (selectedSpace?.cap ?? 0) > 0;
                  const spaceStatus = selectedSpace?.status ?? null;
                  const stCfg = spaceStatus ? ST[spaceStatus] : null;

                  return (
                    <>
                      {stCfg ? (
                        <div style={{ ...S.detailStatusBand, background: stCfg.band, borderLeft: `3px solid ${stCfg.c}`, borderBottom: `1px solid ${stCfg.border}` }}>
                          <div style={{ ...S.detailStatusDot, background: stCfg.c, boxShadow: `0 0 8px ${stCfg.c}` }} />
                          <span style={{ ...S.detailStatusLbl, color: stCfg.c }}>{stCfg.label}</span>
                        </div>
                      ) : null}

                      <div style={{ ...S.sidePanelBody, ...S.sidePanelBodyDetail }}>
                        {hasSubtitle && !selectedFeature.properties.employee ? (
                          <div style={S.detailDescBlock}>
                            <span style={S.detailSectionLabel}>Описание</span>
                            <span style={S.detailDescText}>{selectedFeature.properties.subtitle}</span>
                          </div>
                        ) : null}

                        <div style={S.detailMetaGrid}>
                          {([
                            ["Отдел", selectedFeature.properties.department ?? "Общие", false],
                            ["Этаж", selectedFeature.properties.level, false],
                            ["Тип", selectedSpace?.kindLabel ?? "–", false],
                            ["Вместимость", hasCapacity ? `${selectedSpace?.cap} мест` : "–", hasCapacity],
                          ] as [string, string, boolean][]).map(([label, value, accent]) => (
                            <div key={label} style={accent ? S.detailMetaCellAccent : S.detailMetaCell}>
                              <span style={S.detailMetaLabel}>{label}</span>
                              <span style={S.detailMetaValue}>{value}</span>
                            </div>
                          ))}
                        </div>

                        {hasEquipment ? (
                          <div style={S.detailDescBlock}>
                            <span style={S.detailSectionLabel}>Оснащение</span>
                            <div style={S.detailEquipmentRow}>
                              {equipment.map((e: string) => (
                                <span key={e} style={S.infoChip}>{e}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {selectedFeature.properties.employee ? (
                          <div style={S.detailDescBlock}>
                            <span style={S.detailSectionLabel}>Рабочее место</span>
                            <span style={S.detailDescText}>{selectedFeature.properties.name}</span>
                          </div>
                        ) : null}
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : null}

            {drawerMode === "ops" ? (
              <div style={S.opsWorkspacePanel} className="oa-fade">
                <div style={S.opsWorkspaceBody}>
                  <div style={S.opsShell}>
                    <div style={S.opsShellHero}>
                      <div style={S.opsHeroSummaryRow}>
                        <div style={S.opsHeroMetricCard}>
                          <div style={S.opsHeroMetricValueRow}>
                            <span style={{ ...S.opsHeroMetricValue, color: availableStatusConfig.c }}>
                              {opsStatusCounts.available}
                            </span>
                            <span style={S.opsHeroMetricUnit}>СВОБОДНО</span>
                          </div>
                          <div style={S.opsHeroMetricSubtext}>{opsAvailabilityRate}% из {opsRoomCount}</div>
                        </div>
                        <div style={S.opsMetricsGrid}>
                          {[
                            { label: "СВОБОДНО", value: opsStatusCounts.available, color: availableStatusConfig.c },
                            { label: "ЗАНЯТО", value: opsStatusCounts.occupied + opsStatusCounts.focus, color: ST.occupied.c },
                            { label: "ВНЕ СЕТИ", value: opsStatusCounts.offline, color: T.muted },
                          ].map(({ label, value, color }) => (
                            <div key={label} style={S.opsMetricItem}>
                              <span style={S.opsMetricLabel}>{label}</span>
                              <span style={{ ...S.opsMetricValue, color }}>{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={S.opsBreakdownBar}>
                        {Object.entries(ST).map(([statusKey, config]) => {
                          const count = opsStatusCounts[statusKey as RoomStatus];
                          return (
                            <div
                              key={statusKey}
                              style={{
                                ...S.opsBreakdownSegment,
                                background: count > 0 ? config.bg : T.overlay,
                                border: count > 0 ? `1px solid ${config.border}` : T.controlBorder,
                                color: count > 0 ? config.c : T.muted,
                              }}
                            >
                              <span style={S.opsBreakdownValue}>{count}</span>
                              <span style={S.opsBreakdownLabel}>{config.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ ...S.rpStage, ...S.opsSelectorStage }}>
                      {/* Search and grouping controls */}
                      <div style={S.rpStageControls} className="hud-focus-shell">
                        <div style={S.rpColSearch}>
                          <Ic.Search s={13} />
                          <input
                            style={S.rpColInput}
                            placeholder="Поиск помещений…"
                            value={opsSearchQ}
                            onChange={(event) => setOpsSearchQ(event.target.value)}
                          />
                          {opsSearchQ ? (
                            <button style={{ ...S.iconBtn, width: 22, height: 22 }} className="hud-btn" onClick={() => setOpsSearchQ("")} type="button">
                              <Ic.X s={10} />
                            </button>
                          ) : null}
                        </div>
                        <div style={S.rpColToolbar}>
                          <span style={{ fontSize: 10, color: T.muted, fontWeight: 600 }}>ГРУППА</span>
                          {GROUP_OPTIONS.slice(0, 3).map((group) => (
                            <button
                              key={group.key}
                              style={{ ...S.pillSm, ...(opsGroupKey === group.key ? S.pillSmActive : {}) }}
                              className="hud-btn"
                              data-active={opsGroupKey === group.key ? "true" : undefined}
                              onClick={() => setOpsGroupKey(group.key)}
                              type="button"
                            >
                              {group.label}
                            </button>
                          ))}
                        </div>
                        <div style={S.rpColToolbar}>
                          {(Object.entries(ST) as [RoomStatus, { c: string; bg: string; label: string }][]).map(([status, cfg]) => {
                            const active = opsStatusFilter.has(status);
                            return (
                              <button
                                key={status}
                                style={{
                                  ...S.pillSm,
                                  ...(active ? { background: cfg.bg, border: `1px solid ${cfg.c}44`, color: cfg.c } : {}),
                                }}
                                className="hud-btn"
                                data-active={active ? "true" : undefined}
                                onClick={() => {
                                  setOpsStatusFilter((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(status)) next.delete(status);
                                    else next.add(status);
                                    return next;
                                  });
                                }}
                                type="button"
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.c, display: "inline-block", flexShrink: 0 }} />
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Room grid */}
                      <div style={S.rpStageBody}>
                        {opsRooms.length > 0 ? (
                          <RouteCandidateGrid
                            spaces={opsRooms}
                            groupKey={opsGroupKey}
                            onSelect={(space) => onSelectFeature(space.featureId)}
                            selectedFeatureId={selectedFeatureId}
                          />
                        ) : (
                          <div style={S.rpEmptyState}>
                            <div style={S.rpEmptyTitle}>Помещения не найдены</div>
                            <div style={S.sidePanelSubline}>
                              {opsSearchQ.trim() ? "По текущему фильтру ничего не найдено. Попробуйте изменить запрос или группу." : "Нет доступных помещений."}
                            </div>
                          </div>
                        )}
                      </div>
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
    "--atlas-bg": "#060e1e",
    "--atlas-glass": "rgba(5,11,24,.74)",
    "--atlas-glass-heavy": "rgba(5,11,24,.97)",
    "--atlas-chrome-surface": "rgba(120,170,255,.09)",
    "--atlas-chrome-surface-soft": "rgba(100,150,255,.055)",
    "--atlas-chrome-surface-strong": "rgba(140,185,255,.15)",
    "--atlas-panel-surface": "rgba(100,150,255,.07)",
    "--atlas-panel-surface-soft": "rgba(80,130,255,.035)",
    "--atlas-panel-surface-strong": "rgba(140,185,255,.17)",
    "--atlas-border": "rgba(120,170,255,.17)",
    "--atlas-border-strong": "rgba(140,190,255,.30)",
    "--atlas-text": "#e6eeff",
    "--atlas-sec": "rgba(200,218,255,.72)",
    "--atlas-muted": "rgba(170,196,245,.44)",
    "--atlas-accent": "#3dc8ff",
    "--atlas-accent-bg": "rgba(61,200,255,.15)",
    "--atlas-accent-bg-faint": "rgba(61,200,255,.06)",
    "--atlas-accent-border": "rgba(61,200,255,.36)",
    "--atlas-hover-surface": "rgba(120,170,255,.09)",
    "--atlas-focus-surface": "rgba(61,200,255,.13)",
    "--atlas-btn-surface": "rgba(120,165,255,.08)",
    "--atlas-btn-surface-hover": "rgba(140,180,255,.12)",
    "--atlas-btn-surface-active": "rgba(61,200,255,.15)",
    "--atlas-btn-primary-bg": "rgba(61,200,255,.18)",
    "--atlas-btn-primary-bg-hover": "rgba(61,200,255,.28)",
    "--atlas-btn-primary-text": "#90e4ff",
    "--atlas-control-shadow": "inset 0 1px 0 rgba(160,200,255,.12), 0 1px 4px rgba(0,4,18,.32)",
    "--atlas-elev-top": "0 4px 16px rgba(0,4,20,.38), 0 12px 36px rgba(0,4,20,.28)",
    "--atlas-elev-bottom": "0 -2px 28px rgba(0,4,20,.32)",
    "--atlas-elev-drawer": "0 8px 36px rgba(0,4,20,.44)",
    "--atlas-elev-side": "-8px 0 28px rgba(0,4,20,.32)",
    "--atlas-elev-floating": "0 4px 12px rgba(0,4,20,.34), 0 8px 24px rgba(0,4,20,.26)",
    "--atlas-elev-accent": "inset 0 0 0 1px rgba(61,200,255,.18)",
    "--atlas-elev-accent-active": "inset 0 0 0 1px rgba(61,200,255,.34)",
    "--atlas-status-available": "#2fd68e",
    "--atlas-status-available-bg": "rgba(47,214,142,.16)",
    "--atlas-status-available-border": "rgba(47,214,142,.32)",
    "--atlas-status-available-band": "rgba(47,214,142,.24)",
    "--atlas-status-occupied": "#f96b6b",
    "--atlas-status-occupied-bg": "rgba(249,107,107,.16)",
    "--atlas-status-occupied-border": "rgba(249,107,107,.32)",
    "--atlas-status-occupied-band": "rgba(249,107,107,.28)",
    "--atlas-status-focus": "#f9c030",
    "--atlas-status-focus-bg": "rgba(249,192,48,.16)",
    "--atlas-status-focus-border": "rgba(249,192,48,.32)",
    "--atlas-status-focus-band": "rgba(249,192,48,.24)",
    "--atlas-status-offline": "#7e95b8",
    "--atlas-status-offline-bg": "rgba(126,149,184,.12)",
    "--atlas-status-offline-border": "rgba(126,149,184,.22)",
    "--atlas-status-offline-band": "rgba(126,149,184,.16)",
    "--atlas-scrollbar-thumb": "rgba(120,160,255,.14)",
    "--atlas-panel-blur": "blur(24px) saturate(180%)",
    "--atlas-overlay": "rgba(0,4,18,.14)",
  },
  light: {
    "--atlas-bg": "#f0f4f7",
    "--atlas-glass": "rgba(248,251,253,.94)",
    "--atlas-glass-heavy": "rgba(255,255,255,.98)",
    "--atlas-chrome-surface": "rgba(255,255,255,.96)",
    "--atlas-chrome-surface-soft": "rgba(250,252,254,.82)",
    "--atlas-chrome-surface-strong": "rgba(255,255,255,.99)",
    "--atlas-panel-surface": "rgba(240,244,247,.82)",
    "--atlas-panel-surface-soft": "rgba(235,241,246,.64)",
    "--atlas-panel-surface-strong": "rgba(255,255,255,.94)",
    "--atlas-border": "rgba(16,44,66,.12)",
    "--atlas-border-strong": "rgba(16,44,66,.22)",
    "--atlas-text": "#0d1f2e",
    "--atlas-sec": "rgba(13,31,46,.78)",
    "--atlas-muted": "rgba(13,31,46,.48)",
    "--atlas-accent": "#0775b5",
    "--atlas-accent-bg": "rgba(7,117,181,.10)",
    "--atlas-accent-bg-faint": "rgba(7,117,181,.04)",
    "--atlas-accent-border": "rgba(7,117,181,.24)",
    "--atlas-hover-surface": "rgba(13,38,60,.06)",
    "--atlas-focus-surface": "rgba(7,117,181,.10)",
    "--atlas-btn-surface": "rgba(255,255,255,.96)",
    "--atlas-btn-surface-hover": "#ffffff",
    "--atlas-btn-surface-active": "rgba(7,117,181,.09)",
    "--atlas-btn-primary-bg": "rgba(7,117,181,.12)",
    "--atlas-btn-primary-bg-hover": "rgba(7,117,181,.20)",
    "--atlas-btn-primary-text": "#0775b5",
    "--atlas-control-shadow": "inset 0 1px 0 rgba(255,255,255,.80), 0 1px 4px rgba(10,28,46,.10)",
    "--atlas-elev-top": "0 2px 12px rgba(10,28,46,.10), 0 8px 32px rgba(10,28,46,.10)",
    "--atlas-elev-bottom": "0 -1px 12px rgba(10,28,46,.08)",
    "--atlas-elev-drawer": "0 8px 32px rgba(10,28,46,.12)",
    "--atlas-elev-side": "-4px 0 16px rgba(10,28,46,.10)",
    "--atlas-elev-floating": "0 2px 8px rgba(10,28,46,.10), 0 6px 20px rgba(10,28,46,.10)",
    "--atlas-elev-accent": "inset 0 0 0 1px rgba(7,117,181,.12)",
    "--atlas-elev-accent-active": "inset 0 0 0 1px rgba(7,117,181,.24)",
    "--atlas-status-available": "#34d399",
    "--atlas-status-available-bg": "rgba(52,211,153,.12)",
    "--atlas-status-available-border": "rgba(52,211,153,.17)",
    "--atlas-status-available-band": "rgba(52,211,153,.18)",
    "--atlas-status-occupied": "#f87171",
    "--atlas-status-occupied-bg": "rgba(248,113,113,.12)",
    "--atlas-status-occupied-border": "rgba(248,113,113,.17)",
    "--atlas-status-occupied-band": "rgba(248,113,113,.20)",
    "--atlas-status-focus": "#fbbf24",
    "--atlas-status-focus-bg": "rgba(251,191,36,.12)",
    "--atlas-status-focus-border": "rgba(251,191,36,.17)",
    "--atlas-status-focus-band": "rgba(251,191,36,.18)",
    "--atlas-status-offline": "#64748b",
    "--atlas-status-offline-bg": "rgba(100,116,139,.10)",
    "--atlas-status-offline-border": "rgba(100,116,139,.15)",
    "--atlas-status-offline-band": "rgba(100,116,139,.14)",
    "--atlas-scrollbar-thumb": "rgba(16,44,66,.14)",
    "--atlas-panel-blur": "blur(100px) saturate(140%)",
    "--atlas-overlay": "rgba(10,28,46,.04)",
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
  accentBgFaint: "var(--atlas-accent-bg-faint)",
  btnSurface: "var(--atlas-btn-surface)",
  btnSurfaceHover: "var(--atlas-btn-surface-hover)",
  btnSurfaceActive: "var(--atlas-btn-surface-active)",
  btnSurfaceBorder: "var(--atlas-border-strong)",
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
  chromeSurface: "var(--atlas-chrome-surface)",
  chromeSurfaceSoft: "var(--atlas-chrome-surface-soft)",
  chromeSurfaceStrong: "var(--atlas-chrome-surface-strong)",
  panelSurface: "var(--atlas-panel-surface)",
  panelSurfaceSoft: "var(--atlas-panel-surface-soft)",
  panelSurfaceStrong: "var(--atlas-panel-surface-strong)",
  controlBorder: "1px solid var(--atlas-border)",
  controlBorderStrong: "1px solid var(--atlas-border-strong)",
  statusAvailable: "var(--atlas-status-available)",
  statusAvailableBg: "var(--atlas-status-available-bg)",
  statusAvailableBorder: "var(--atlas-status-available-border)",
  statusAvailableBand: "var(--atlas-status-available-band)",
  statusOccupied: "var(--atlas-status-occupied)",
  statusOccupiedBg: "var(--atlas-status-occupied-bg)",
  statusOccupiedBorder: "var(--atlas-status-occupied-border)",
  statusOccupiedBand: "var(--atlas-status-occupied-band)",
  statusFocus: "var(--atlas-status-focus)",
  statusFocusBg: "var(--atlas-status-focus-bg)",
  statusFocusBorder: "var(--atlas-status-focus-border)",
  statusFocusBand: "var(--atlas-status-focus-band)",
  statusOffline: "var(--atlas-status-offline)",
  statusOfflineBg: "var(--atlas-status-offline-bg)",
  statusOfflineBorder: "var(--atlas-status-offline-border)",
  statusOfflineBand: "var(--atlas-status-offline-band)",
  scrollbarThumb: "var(--atlas-scrollbar-thumb)",
  panelBlur: "var(--atlas-panel-blur)",
};

const ST: Record<RoomStatus, { c: string; bg: string; border: string; band: string; label: string }> = {
  available: { c: T.statusAvailable, bg: T.statusAvailableBg, border: T.statusAvailableBorder, band: T.statusAvailableBand, label: "Свободно" },
  occupied: { c: T.statusOccupied, bg: T.statusOccupiedBg, border: T.statusOccupiedBorder, band: T.statusOccupiedBand, label: "Занято" },
  focus: { c: T.statusFocus, bg: T.statusFocusBg, border: T.statusFocusBorder, band: T.statusFocusBand, label: "Фокус" },
  offline: { c: T.statusOffline, bg: T.statusOfflineBg, border: T.statusOfflineBorder, band: T.statusOfflineBand, label: "Не в сети" },
};

const CONTROL_HEIGHT = 42;
const ACTION_HEIGHT = 42;
const ACTION_RADIUS = 0;
const CONTROL_INNER_HEIGHT = 34;
const segmentedFrame: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: 4,
  minHeight: CONTROL_HEIGHT,
  background: T.chromeSurface,
  border: T.controlBorder,
  boxShadow: T.controlShadow,
};
const segmentedButtonBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minWidth: 0,
  minHeight: CONTROL_INNER_HEIGHT,
  padding: "0 12px",
  background: T.chromeSurfaceSoft,
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
  background: T.chromeSurface,
  border: T.controlBorder,
  boxShadow: T.controlShadow,
};
const secondaryActionBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: ACTION_HEIGHT,
  padding: "0 14px",
  background: T.btnSurface,
  color: T.text,
  border: `1px solid ${T.btnSurfaceBorder}`,
  borderRadius: ACTION_RADIUS,
  fontSize: 12,
  fontWeight: 700,
  fontFamily: FONT,
  letterSpacing: ".01em",
  boxShadow: T.controlShadow,
};
const primaryActionBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: ACTION_HEIGHT,
  padding: "0 16px",
  background: T.btnPrimaryBg,
  color: T.btnPrimaryText,
  border: `1px solid ${T.accentBorder}`,
  borderRadius: ACTION_RADIUS,
  fontSize: 12,
  fontWeight: 700,
  fontFamily: FONT,
  letterSpacing: ".01em",
  boxShadow: `${T.controlShadow}, ${T.elevAccent}`,
};
const chromeSectionBase: CSSProperties = {
  background: T.panelSurface,
  border: T.controlBorder,
  boxShadow: T.controlShadow,
};
const microChipBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 28,
  padding: "0 10px",
  fontSize: 11,
  fontWeight: 700,
  color: T.sec,
  background: T.chromeSurface,
  border: T.controlBorder,
  borderRadius: 0,
  letterSpacing: ".01em",
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  ::placeholder{color:${T.muted}}
  select{-webkit-appearance:none;-moz-appearance:none;appearance:none}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.scrollbarThumb};border-radius:5px}
  @keyframes oa-fade{from{opacity:0}to{opacity:1}}
  @keyframes oa-slide-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes oa-slide-out{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(10px)}}
  @keyframes oa-slide-left{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
  @keyframes oa-pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes card-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
  .card-anim{animation:card-in 200ms ease-out both;animation-delay:calc(var(--ci,0)*14ms)}
  .oa-fade{animation:oa-fade .18s ease-out}
  .oa-slide-up{animation:oa-slide-up .22s ease-out}
  .oa-slide-out{animation:oa-slide-out .2s ease-in both}
  .oa-slide-left{animation:oa-slide-left .2s ease-out}
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
    gridTemplateColumns: "1fr",
    alignItems: "stretch",
    gap: 0,
    padding: 0,
    background: T.glass,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    borderBottom: T.controlBorderStrong,
    borderRadius: 0,
    minHeight: TOP_BAR_CLEARANCE,
  },
  topBrandBlock: { display: "grid", gap: 8, minWidth: 0, padding: "12px 14px", background: T.chromeSurfaceSoft },
  mapControls: {
    position: "absolute",
    top: TOP_BAR_CLEARANCE + 12,
    right: 12,
    zIndex: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "stretch",
    padding: 8,
    background: T.glass,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    border: T.controlBorderStrong,
    boxShadow: T.elevTop,
  },
  mapControlsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 2,
  },
  mapControlsToggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    background: "none",
    border: "none",
    color: T.muted,
    flexShrink: 0,
    padding: 0,
  },
  mapControlsRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  topBrandRow: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  topSectionLabel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.sec, textTransform: "uppercase", letterSpacing: ".06em" },
  logo: { display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minHeight: CONTROL_HEIGHT, background: T.chromeSurface, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0, flexShrink: 0 },
  searchField: { display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: 500, color: T.sec, background: T.chromeSurface, border: T.controlBorder, boxShadow: T.controlShadow, minWidth: 320, minHeight: CONTROL_HEIGHT, flex: 1 },
  searchInput: { flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: T.text, fontSize: 13, fontWeight: 500, fontFamily: FONT },
  searchClearBtn: { width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: T.chromeSurface, border: "1px solid transparent", borderRadius: 0, color: T.muted, flexShrink: 0 },
  kbd: { marginLeft: "auto", padding: "0 8px", minHeight: 24, display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 600, fontFamily: MONO, color: T.muted, background: T.chromeSurfaceSoft, borderRadius: 0, border: T.controlBorder },
  topSceneBlock: { display: "grid", alignContent: "center", gap: 8, padding: "12px 14px", borderRight: T.controlBorder, minWidth: 280, background: T.chromeSurfaceSoft },
  topActionBlock: { display: "grid", alignContent: "center", gap: 8, padding: "12px 14px", minWidth: 420, background: T.chromeSurfaceSoft },
  topActionRow: { display: "flex", alignItems: "stretch", justifyContent: "flex-end", gap: 8, flexWrap: "nowrap" },
  topFloorGroup: { ...segmentedFrame },
  themeSwitch: { display: "flex", gap: 2, padding: 3, borderRadius: 0, background: T.chromeSurfaceSoft, border: T.controlBorder },
  themeBtn: { padding: "7px 12px", background: "none", border: "none", borderRadius: 0, fontSize: 12, fontWeight: 600, fontFamily: FONT, color: T.muted },
  themeBtnActive: { color: T.text, background: T.chromeSurfaceStrong },
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
    borderTop: T.controlBorderStrong,
    borderRadius: 0,
    minHeight: BOTTOM_BAR_CLEARANCE,
    boxShadow: T.elevBottom,
  },
  bottomBarDrawerOpen: {
    background: T.glass,
  },
  bottomModuleLabel: { fontSize: 11, lineHeight: 1, fontWeight: 700, fontFamily: MONO, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em" },
  bottomContextBlock: {
    display: "flex",
    alignItems: "stretch",
    width: "100%",
    minWidth: 0,
    minHeight: BOTTOM_BAR_CLEARANCE,
    padding: 0,
    background: T.glass,
    border: "none",
    borderRight: T.controlBorderStrong,
    textAlign: "left",
    overflow: "hidden",
  },
  bottomContextBlockDrawerOpen: {
    background: T.glass,
  },
  bottomContextBlockSolo: {
    borderRight: "none",
  },
  bottomContextStrip: {
    display: "none",
  },
  bottomExpandArrow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 42,
    flexShrink: 0,
    color: T.muted,
    background: T.glass,
    borderLeft: T.controlBorder,
  },
  bottomExpandArrowDrawerOpen: {
    background: T.glass,
  },
  bottomActionPrimary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    minHeight: BOTTOM_BAR_CLEARANCE,
    padding: "12px 14px",
    background: T.glass,
  },
  bottomRouteActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    minHeight: BOTTOM_BAR_CLEARANCE,
    padding: "12px 14px",
    background: T.glass,
  },
  bottomRouteActionsDrawerOpen: {
    background: T.glass,
  },
  bottomSecondaryGroup: {
    display: "flex",
    alignItems: "center",
    background: T.glass,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
  },
  bottomSegBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: ACTION_HEIGHT,
    padding: "0 14px",
    background: T.chromeSurfaceSoft,
    color: T.text,
    border: "none",
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    borderRadius: 0,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    letterSpacing: ".01em",
    whiteSpace: "nowrap",
  },
  bottomPrimaryBtn: {
    ...primaryActionBase,
    padding: "0 18px",
    whiteSpace: "nowrap",
  },
  bottomContext: { display: "grid", minWidth: 0, flex: 1, padding: "12px 14px", alignContent: "center" },
  bottomContextContent: { display: "flex", flexDirection: "column", gap: 3, animation: "oa-fade .15s ease-out", minWidth: 0 },
  bottomHeadline: {
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: "-.02em",
    color: T.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  bottomMetaRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  bottomMeta: { fontSize: 12, color: T.sec, fontWeight: 500 },
  bottomChip: { ...microChipBase, padding: "0 8px", fontSize: 10, fontWeight: 700, fontFamily: MONO, textTransform: "uppercase" },
  bottomActionLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    whiteSpace: "nowrap",
  },
  bottomActionText: {
    fontWeight: 600,
    letterSpacing: ".01em",
    lineHeight: 1,
  },
  bottomActionGlyph: {
    width: 15,
    height: 15,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: T.sec,
    background: "none",
    border: "none",
    boxShadow: "none",
  },
  bottomActionGlyphAccent: {
    color: T.btnPrimaryText,
    background: "none",
    border: "none",
    boxShadow: "none",
  },
  floorPicker: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4 },
  zoomStack: { ...segmentedFrame },
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
  fab: { ...primaryActionBase, whiteSpace: "nowrap" },
  fabActive: { background: T.btnPrimaryBgHover, border: `1px solid ${T.accentBorder}`, boxShadow: `${T.controlShadow}, ${T.elevAccentActive}` },
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
    top: TOP_BAR_CLEARANCE - 1,
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
    background: T.glass,
    backdropFilter: T.panelBlur,
    WebkitBackdropFilter: T.panelBlur,
  },
  drawerSheetWorkspace: {
    height: "100%",
    maxHeight: "none",
    borderTop: "none",
    borderRight: "none",
    borderBottom: "none",
    borderLeft: "none",
  },
  drawerSheetInfo: {
    height: "auto",
    maxHeight: `calc(100vh - ${TOP_BAR_CLEARANCE + BOTTOM_BAR_CLEARANCE}px)`,
    pointerEvents: "auto",
    borderTop: T.controlBorderStrong,
    borderRight: "none",
    borderBottom: "none",
    borderLeft: "none",
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
  bpHeader: { padding: "10px 12px", borderBottom: T.controlBorderStrong, flexShrink: 0, background: T.panelSurfaceStrong },
  bpDivider: { width: 1, height: 20, background: T.border },
  bpBody: { flex: 1, overflowY: "auto", padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12 },
  bpPeopleSection: { display: "grid", gap: 8 },
  bpSectionTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: T.sec, textTransform: "uppercase", letterSpacing: ".06em" },
  bpPeopleGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 },
  pill: { ...microChipBase, padding: "0 12px", minHeight: 30, fontSize: 11, fontWeight: 600, color: T.sec, fontFamily: FONT },
  pillActive: { ...segmentedButtonActive },
  pillSm: { ...microChipBase, padding: "0 10px", minHeight: 26, fontSize: 10, fontWeight: 600, color: T.muted, fontFamily: FONT },
  pillSmActive: { ...segmentedButtonActive },
  groupedGrid: { display: "flex", flexDirection: "column", gap: 12 },
  group: { display: "flex", flexDirection: "column", gap: 8 },
  groupHeader: { display: "flex", alignItems: "center", gap: 8 },
  groupLabel: { fontSize: 12, fontWeight: 700, color: T.sec, textTransform: "uppercase", letterSpacing: ".04em" },
  groupCount: { fontSize: 10, fontWeight: 600, color: T.muted, background: T.chromeSurfaceSoft, padding: "1px 7px", borderRadius: 10 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 },
  gridCompact: { gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8 },
  card: { display: "flex", flexDirection: "column", gap: 8, padding: "12px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0, textAlign: "left", fontFamily: FONT, color: T.text },
  cardSelected: { border: `1px solid ${T.accent}`, background: T.accentBg, boxShadow: `0 0 0 1px ${T.accent}40` },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  cardNameRow: { display: "flex", alignItems: "center", gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  cardName: { fontSize: 13, fontWeight: 700, lineHeight: 1.3 },
  cardLevel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.accent, background: T.accentBg, padding: "2px 6px", borderRadius: 0, flexShrink: 0 },
  cardBottom: { display: "flex", alignItems: "center", gap: 8 },
  cardKind: { fontSize: 11, color: T.muted, fontWeight: 500 },
  cardCap: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: T.sec, fontWeight: 500 },
  cardDept: { fontSize: 10, color: T.muted, fontWeight: 500, marginTop: -2 },
  routeChoiceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 },
  routeChoiceCard: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0, textAlign: "left", fontFamily: FONT, color: T.text, minHeight: 108 },
  routeChoiceCardSelected: { border: `1px solid ${T.accent}`, background: T.accentBg, boxShadow: `0 0 0 1px ${T.accent}40` },
  routeChoiceTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  routeChoiceNameRow: { display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
  routeChoiceName: { fontSize: 13, fontWeight: 700, lineHeight: 1.3, minWidth: 0 },
  routeChoiceMeta: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  routeChoiceMetaText: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: T.sec, fontWeight: 500 },
  routeChoiceFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: "auto" },
  routeChoiceDept: { fontSize: 10, color: T.muted, fontWeight: 500 },
  routeChoiceStatus: { fontSize: 10, padding: "2px 8px", flexShrink: 0 },
  personRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0, fontFamily: FONT, color: T.text, textAlign: "left" },
  personAv: { width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg,${T.accentBg},${T.accentBgFaint})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: T.accent, flexShrink: 0 },
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
    background: "transparent",
  },
  rpTopStatusChip: {
    ...microChipBase,
    minHeight: 24,
    padding: "0 9px",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: MONO,
    color: T.sec,
    letterSpacing: ".04em",
    textTransform: "uppercase",
  },
  rpTopStatusChipReady: {
    color: ST.available.c,
    background: ST.available.bg,
    border: `1px solid ${ST.available.border}`,
  },
  rpTopStatusChipError: {
    color: ST.occupied.c,
    background: ST.occupied.bg,
    border: `1px solid ${ST.occupied.border}`,
  },
  rpTopAside: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, minWidth: 0, flexWrap: "wrap" },
  rpTopActions: { display: "flex", alignItems: "stretch", justifyContent: "flex-end", gap: 8, flexShrink: 0, flexWrap: "wrap", minWidth: 0 },
  rpTopToggle: {
    ...secondaryActionBase,
    minHeight: 34,
    padding: "0 11px",
    gap: 6,
    fontSize: 10,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  rpTopToggleActive: {
    color: T.accent,
    background: T.accentBg,
    border: `1px solid ${T.accentBorder}`,
    boxShadow: `inset 0 0 0 1px ${T.accent}1f`,
  },
  rpFlowStep: { ...microChipBase, padding: "0 12px", minHeight: 30, gap: 6, fontSize: 11, fontWeight: 700, color: T.sec, fontFamily: FONT },
  rpFlowStepActive: { ...segmentedButtonActive },
  rpFlowStepReady: { color: ST.available.c, fontSize: 12, lineHeight: 1, marginTop: -1 },
  rpFlowShell: { flex: 1, display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflow: "hidden", padding: "10px 14px 14px" },
  rpPlannerBar: { display: "grid", gridTemplateColumns: "minmax(0,1fr) 36px minmax(0,1fr)", gap: 10, alignItems: "stretch", flexShrink: 0, minWidth: 0, padding: 8, background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow },
  rpPlannerCard: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minHeight: 74,
    padding: "12px 14px",
    background: T.chromeSurface,
    border: T.controlBorder,
    boxShadow: "none",
    minWidth: 0,
    cursor: "pointer",
  },
  rpPlannerCardActive: { background: T.panelSurfaceStrong, border: `1px solid ${T.accentBorder}`, boxShadow: `inset 0 0 0 1px ${T.accent}1f` },
  rpPlannerRow: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 },
  rpPlannerGlyph: {
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: T.muted,
    flexShrink: 0,
    background: T.chromeSurfaceSoft,
    border: T.controlBorder,
  },
  rpPlannerGlyphActive: { color: T.accent },
  rpPlannerBody: { display: "grid", gap: 3, minWidth: 0, flex: 1 },
  rpPlannerLabel: { fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: ".07em", fontFamily: MONO, lineHeight: 1 },
  rpPlannerName: { fontSize: 15, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.2, color: T.text, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rpPlannerNameEmpty: { fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.2, color: T.muted, minWidth: 0 },
  rpPlannerHint: { fontSize: 11, color: T.muted, lineHeight: 1.35, minWidth: 0 },
  rpSummaryPanel: { display: "grid", gap: 10, alignContent: "start", minHeight: 152, padding: "14px 16px", background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow, minWidth: 0 },
  rpSwapDock: { display: "flex", alignItems: "center", justifyContent: "center" },
  rpStage: { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow },
  rpStageTitle: { fontSize: 15, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.2, marginTop: 0 },
  rpStageStat: { ...microChipBase, padding: "0 9px", minHeight: 26, fontSize: 10, fontWeight: 700, color: T.sec, fontFamily: MONO, letterSpacing: ".04em", flexShrink: 0 },
  rpStageControls: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: T.controlBorder, flexShrink: 0, background: T.chromeSurface },
  rpStageControlsRoute: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  rpStageSearchRow: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  rpStageMetaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0, flexWrap: "wrap" },
  rpStageBody: { flex: 1, overflowY: "auto", padding: "10px 14px 14px", minHeight: 0, scrollPaddingBottom: 18 },
  rpAside: { display: "flex", flexDirection: "column", gap: 12, minHeight: 0 },
  rpAsideShell: { display: "flex", flexDirection: "column", background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow, minHeight: 0 },
  rpAsideSection: { display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", borderBottom: T.controlBorderStrong },
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
    background: T.panelSurface,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
  },
  rpColLast: { borderRight: T.controlBorder },
  rpColHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 14px",
    borderBottom: T.controlBorder,
    flexShrink: 0,
    background: T.panelSurfaceStrong,
  },
  rpColLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 },
  rpSelected: { display: "flex", alignItems: "center", gap: 7, padding: "0 10px", minHeight: 30, background: T.accentBg, border: `1px solid ${T.accentBorder}`, boxShadow: `inset 0 0 0 1px ${T.accent}1f`, borderRadius: 0, marginTop: 0 },
  rpSelectedName: { fontSize: 13, fontWeight: 650 },
  rpSelectedLevel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.accent, marginLeft: "auto" },
  rpClearBtn: { width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: T.chromeSurface, border: "1px solid transparent", borderRadius: 0, color: T.muted, marginLeft: 4, flexShrink: 0 },
  rpColSearch: {
    display: "flex",
    alignItems: "center",
    gap: 8,
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
    gap: 6,
    flexShrink: 0,
    flexWrap: "wrap",
    padding: 0,
    background: "transparent",
  },
  rpColBody: { flex: 1, overflowY: "auto", padding: "14px", scrollPaddingBottom: 18 },
  rpEmptyState: { display: "grid", gap: 6, padding: "12px 14px", background: T.panelSurface, border: T.controlBorder },
  rpEmptyTitle: { fontSize: 13, fontWeight: 700, color: T.text },
  rpStepCard: { display: "flex", flexDirection: "column", gap: 5, color: T.text, textAlign: "left" },
  rpStepClearBtn: { width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: T.chromeSurfaceSoft, border: T.controlBorder, color: T.muted, padding: 0, flexShrink: 0 },
  rpStepCardActive: { background: "transparent" },
  rpStepCardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rpActiveStateChip: { ...microChipBase, minWidth: 72, padding: "0 10px", minHeight: 24, fontSize: 10, fontWeight: 700, color: T.sec, justifyContent: "center", fontFamily: FONT },
  rpActiveStateChipHidden: { visibility: "hidden" },
  rpStepCardBody: { display: "grid", gap: 4 },
  rpStepCardName: { fontSize: 13, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rpStepCardPlaceholder: { fontSize: 11, color: T.muted, lineHeight: 1.4 },
  rpStepCardMeta: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  rpStepCardActions: { display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, flexWrap: "wrap", paddingTop: 2 },
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
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: T.chromeSurfaceSoft,
    border: T.controlBorder,
    boxShadow: "none",
    borderRadius: 0,
    color: T.sec,
    position: "relative",
    zIndex: 1,
  },
  drawerInfoPanel: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "transparent",
  },
  infoDrawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 16px",
    borderBottom: T.controlBorderStrong,
    background: T.panelSurfaceStrong,
    flexShrink: 0,
  },
  infoDrawerHeaderMain: {
    display: "grid",
    gap: 4,
    minWidth: 0,
  },
  infoDrawerHeaderTitle: {
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: "-.02em",
    lineHeight: 1.2,
    color: T.text,
    minWidth: 0,
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
    borderTop: T.controlBorderStrong,
    background: T.panelSurfaceStrong,
    flexShrink: 0,
  },
  rpFooterSummary: { display: "grid", gap: 3, minWidth: 0 },
  rpFooterHeadline: {
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: "-.02em",
    color: T.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rpFooterMeta: { fontSize: 11, color: T.sec },
  rpFooterActions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" },
  rpResult: { padding: "16px 20px", borderTop: T.controlBorder, flexShrink: 0, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" },
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
  rrStepN: { width: 22, height: 22, borderRadius: 0, background: T.chromeSurface, border: T.controlBorder, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, color: T.sec },
  rrStepT: { fontSize: 12, color: T.sec, lineHeight: 1.5, paddingTop: 2 },
  rrStepsGrid: { display: "grid", gap: 20, alignItems: "start" },
  rrStepsColumn: { display: "grid", alignContent: "start", gap: 0, minWidth: 0 },
  accentBtn: { ...primaryActionBase },
  ghostBtn: { ...secondaryActionBase },
  iconBtn: { width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: T.chromeSurface, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0, color: T.sec, flexShrink: 0 },
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
    borderLeft: T.controlBorderStrong,
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
    borderLeft: T.controlBorderStrong,
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
    borderLeft: T.controlBorderStrong,
    boxShadow: T.elevSide,
    overflow: "hidden",
  },
  checkRow: { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none", fontSize: 12, color: T.sec, fontWeight: 500 },
  checkBox: { width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${T.borderH}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all .12s", color: T.bg, flexShrink: 0 },
  checkBoxOn: { background: T.accent, border: `1.5px solid ${T.accent}` },
  rrStatsPanel: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 },
  rrStatCard: { display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 0, background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow },
  opsShellBody: {
    padding: "14px 16px 16px",
  },
  opsWorkspacePanel: {
    width: "100%",
    height: "100%",
    maxWidth: "none",
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "transparent",
  },
  opsWorkspaceToolbar: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) auto",
    alignItems: "center",
    gap: 14,
  },
  opsWorkspaceToolbarMain: {
    display: "grid",
    gap: 4,
    minWidth: 0,
  },
  opsWorkspaceToolbarMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  opsWorkspaceBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    padding: "10px 14px 14px",
  },
  opsShell: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "transparent",
    border: "none",
    boxShadow: "none",
    overflow: "hidden",
    flex: 1,
    minHeight: 0,
  },
  opsShellHero: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px",
    background: T.panelSurface,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
    flexShrink: 0,
  },
  opsHeroSummaryRow: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, .72fr) minmax(0, 1.28fr)",
    gap: 8,
    alignItems: "stretch",
  },
  opsSelectorStage: {
    flex: 1,
    minHeight: 0,
  },
  opsHeroMetricCard: {
    display: "grid",
    gap: 4,
    padding: "10px 12px",
    background: `linear-gradient(135deg, ${T.accentBg} 0%, ${T.accentBgFaint} 100%)`,
    border: `1px solid ${T.accentBorder}`,
    boxShadow: `inset 0 0 0 1px ${T.accent}14`,
  },
  opsHeroMetricValueRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  },
  opsHeroMetricValue: {
    fontSize: 34,
    fontWeight: 800,
    fontFamily: MONO,
    lineHeight: 1,
    letterSpacing: "-.02em",
  },
  opsHeroMetricUnit: {
    fontSize: 10,
    fontWeight: 700,
    color: T.muted,
    letterSpacing: ".06em",
    textTransform: "uppercase",
  },
  opsHeroMetricSubtext: {
    fontSize: 10,
    color: T.sec,
    fontWeight: 500,
  },
  opsMetricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
  },
  opsMetricItem: {
    display: "grid",
    gap: 2,
    padding: "9px 10px",
    background: T.panelSurfaceSoft,
    border: T.controlBorder,
    textAlign: "center",
    alignContent: "center",
  },
  opsMetricLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: T.muted,
    letterSpacing: ".05em",
  },
  opsMetricValue: {
    fontSize: 22,
    fontWeight: 800,
    fontFamily: MONO,
    lineHeight: 1,
  },
  opsShellHeroTop: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, .8fr) minmax(0, 1.5fr)",
    gap: 10,
    alignItems: "stretch",
  },
  opsShellLeadCard: {
    display: "grid",
    gap: 8,
    padding: "12px 14px",
    background: T.panelSurfaceStrong,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
    minWidth: 0,
  },
  opsShellLeadValueRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 14,
    minWidth: 0,
  },
  opsShellLeadMeta: {
    display: "grid",
    gap: 6,
    paddingBottom: 2,
    minWidth: 0,
  },
  opsShellHeroSummary: {
    display: "grid",
    gap: 10,
    padding: "12px 14px",
    background: T.panelSurfaceStrong,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
    minWidth: 0,
  },
  opsShellHeroFacts: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
  },
  opsShellFact: {
    display: "grid",
    gap: 4,
    padding: "10px 12px",
    background: T.panelSurface,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
    minWidth: 0,
  },
  opsShellFactLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: T.muted,
    textTransform: "uppercase",
    letterSpacing: ".06em",
  },
  opsShellFactValue: {
    fontSize: 18,
    fontWeight: 800,
    fontFamily: MONO,
    lineHeight: 1,
    color: T.text,
  },
  opsShellHeroBar: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  opsShellHeroMeta: {
    display: "grid",
    gap: 6,
    minWidth: 0,
  },
  opsShellLiveTag: {
    ...microChipBase,
    minHeight: 26,
    padding: "0 10px",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: MONO,
    color: T.sec,
    letterSpacing: ".04em",
    whiteSpace: "nowrap",
  },
  opsShellMetricRail: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
  },
  opsLevelRail: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 10,
  },
  opsLevelCard: {
    display: "grid",
    gap: 10,
    padding: "12px 14px",
    background: T.panelSurface,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
    textAlign: "left",
    color: T.text,
    fontFamily: FONT,
  },
  opsLevelCardActive: {
    border: `1px solid ${T.accentBorder}`,
    background: T.accentBg,
    boxShadow: `0 0 0 1px ${T.accent}24`,
  },
  opsLevelCardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  opsLevelCardBody: {
    display: "grid",
    gap: 4,
  },
  opsLevelCardValue: {
    fontSize: 26,
    fontWeight: 800,
    fontFamily: MONO,
    lineHeight: 1,
  },
  opsLevelCardMeta: {
    fontSize: 11,
    color: T.sec,
    fontWeight: 500,
  },
  opsLevelCardStats: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  opsLevelCardStat: {
    ...microChipBase,
    padding: "0 8px",
    minHeight: 22,
    fontSize: 10,
    fontWeight: 700,
    color: T.sec,
    fontFamily: MONO,
  },
  opsShellSection: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 14px",
    background: T.panelSurface,
    border: T.controlBorder,
    boxShadow: T.controlShadow,
    minWidth: 0,
  },
  opsShellSectionWide: {
    background: T.panelSurface,
  },
  opsShellSectionIntro: {
    display: "flex",
    alignItems: "center",
    minHeight: 18,
  },
  opsLevelGroupStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  opsLevelGroup: {
    display: "grid",
    gap: 10,
  },
  opsLevelGroupHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  opsLevelGroupTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  opsLevelBadge: {
    ...microChipBase,
    padding: "0 9px",
    minHeight: 24,
    fontSize: 10,
    fontWeight: 700,
    color: T.accent,
    fontFamily: MONO,
    background: T.accentBg,
    border: `1px solid ${T.accentBorder}`,
  },
  opsLevelGroupTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: T.sec,
    letterSpacing: ".01em",
  },
  opsOverviewGrid: { display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(320px,.95fr)", gap: 12, alignItems: "stretch" },
  opsHeroCard: { display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow, minHeight: 0 },
  opsHeroMain: { display: "flex", alignItems: "flex-start", gap: 16 },
  opsHeroMetricBlock: { display: "grid", gap: 4, minWidth: 108, flexShrink: 0 },
  opsHeroMetric: { fontSize: 42, fontWeight: 800, fontFamily: MONO, letterSpacing: "-.04em", lineHeight: 0.95 },
  opsHeroMetricLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em" },
  opsHeroCopy: { display: "grid", gap: 4, minWidth: 0, paddingTop: 2 },
  opsHeroTitle: { fontSize: 16, fontWeight: 800, letterSpacing: "-.02em", color: T.text },
  opsBreakdownBar: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 },
  opsBreakdownSegment: { display: "grid", gap: 3, padding: "8px 12px", minWidth: 0, minHeight: 50, alignContent: "center", boxShadow: T.controlShadow },
  opsBreakdownValue: { fontSize: 14, fontWeight: 800, fontFamily: MONO, lineHeight: 1 },
  opsBreakdownLabel: { fontSize: 9, fontWeight: 700, color: "currentColor", textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.9 },
  opsMetaRow: { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 },
  opsMetaCard: { display: "grid", gap: 4, padding: "10px 12px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow },
  opsMetaLabel: { fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em" },
  opsMetaValue: { fontSize: 18, fontWeight: 800, fontFamily: MONO, letterSpacing: "-.03em", lineHeight: 1 },
  opsStatusGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 },
  opsStatusCard: { display: "grid", gap: 6, padding: "12px 14px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow, minHeight: 92, alignContent: "space-between" },
  opsStatusValue: { fontSize: 26, fontWeight: 800, fontFamily: MONO, lineHeight: 1 },
  opsStatusLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em" },
  opsRoomGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 },
  opsRoomCard: { width: "100%", display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0, fontFamily: FONT, color: T.text, textAlign: "left", minHeight: 128 },
  opsRoomCardSelected: { border: `1px solid ${T.accent}`, background: T.accentBg, boxShadow: `0 0 0 1px ${T.accent}40` },
  opsRoomHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  opsRoomTitleRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  opsRoomName: { fontSize: 14, fontWeight: 700, lineHeight: 1.3, minWidth: 0 },
  opsStatusPill: { marginLeft: "auto", flexShrink: 0, fontSize: 10, padding: "3px 9px" },
  opsRoomMeta: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  opsRoomMetaItem: { ...microChipBase, padding: "0 8px", minHeight: 24, fontSize: 10, fontWeight: 700, color: T.sec, fontFamily: MONO, letterSpacing: ".03em" },
  opsRoomFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: "auto" },
  opsRoomDept: { fontSize: 11, color: T.muted, fontWeight: 500, minWidth: 0 },
  opsRoomSignal: { fontSize: 10, fontWeight: 700, color: T.accent, textTransform: "uppercase", letterSpacing: ".05em", flexShrink: 0 },
  floatHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 12, borderBottom: T.controlBorderStrong, background: T.panelSurfaceStrong },
  panelHeaderTight: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    padding: "14px 16px",
    borderBottom: T.controlBorderStrong,
    background: T.panelSurfaceStrong,
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
    background: "transparent",
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
    borderTop: T.controlBorderStrong,
    background: T.panelSurfaceStrong,
    flexShrink: 0,
  },
  sidePanelFooterColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 16px",
    borderTop: T.controlBorderStrong,
    background: T.panelSurfaceStrong,
    flexShrink: 0,
  },
  sidePanelTitle: { margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.15 },
  sidePanelSubline: { fontSize: 11, color: T.sec },
  sidePanelSection: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow },
  sidePanelSectionCompact: { display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow },
  sidePanelSectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  floatKicker: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: T.accent },
  floatTitle: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.15 },
  floatSubline: { fontSize: 12, color: T.sec },
  panelInset: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0 },
  panelInsetAccent: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, boxShadow: `inset 0 0 0 1px ${T.accent}1f`, borderRadius: 0 },
  panelInsetScroll: { overflowY: "auto", padding: "0 0 2px", minHeight: 0, flex: 1 },
  panelSectionLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", fontFamily: MONO },
  panelMetaGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  panelMetaCell: { display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow, borderRadius: 0 },
  panelChipRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  panelActionRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  panelActionColumn: { display: "flex", flexDirection: "column", gap: 8 },
  infoChip: { ...microChipBase, padding: "0 10px", fontSize: 11, fontWeight: 600, color: T.sec },
  detailHeroCard: { display: "grid", gap: 12, padding: "14px 16px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow },
  detailHeroMain: { display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 },
  detailHeroGlyph: { width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: T.accentBg, border: `1px solid ${T.accentBorder}`, boxShadow: `inset 0 0 0 1px ${T.accent}16`, color: T.accent, fontSize: 11, fontWeight: 700, fontFamily: MONO, flexShrink: 0 },
  detailHeroText: { display: "grid", gap: 8, minWidth: 0, flex: 1 },
  detailHeroTitleRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, minWidth: 0, flexWrap: "wrap" },
  detailHeroTitle: { fontSize: 16, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.2, color: T.text, minWidth: 0 },
  detailHeroSubline: { fontSize: 12, color: T.sec, lineHeight: 1.5 },
  detailMetaGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 },
  detailMetaCell: { display: "flex", flexDirection: "column", gap: 4, padding: "12px", background: T.panelSurfaceStrong, border: T.controlBorder, boxShadow: T.controlShadow, minWidth: 0 },
  detailMetaLabel: { fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em" },
  detailMetaValue: { fontSize: 13, fontWeight: 650, color: T.text, lineHeight: 1.35 },
  detailSectionCard: { display: "grid", gap: 8, padding: "12px 14px", background: T.panelSurface, border: T.controlBorder, boxShadow: T.controlShadow },
  detailSectionLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", fontFamily: MONO },
  detailSectionText: { fontSize: 13, color: T.text, lineHeight: 1.5, fontWeight: 600 },
  detailEquipmentRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  detailStatusBand: { display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", flexShrink: 0 },
  detailStatusDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  detailStatusLbl: { fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: ".07em" },
  detailDescBlock: { display: "grid", gap: 6 },
  detailDescText: { fontSize: 14, color: T.text, lineHeight: 1.65, fontWeight: 500 },
  detailMetaCellAccent: { display: "flex", flexDirection: "column", gap: 4, padding: "12px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, boxShadow: T.controlShadow, minWidth: 0 },

  // Search empty state
  emptySearchBlock: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", gap: 8, textAlign: "center" },
  emptySearchIcon: { opacity: 0.45, marginBottom: 2 },
  emptySearchTitle: { fontSize: 15, fontWeight: 700, color: T.sec },
  emptySearchSub: { fontSize: 12, color: T.muted, maxWidth: 260, lineHeight: 1.6 },

  // Route result summary card
  rrSummaryCard: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, flexWrap: "wrap" },
  rrSummaryMain: { display: "flex", alignItems: "baseline", gap: 8 },
  rrSummaryDist: { fontSize: 22, fontWeight: 800, fontFamily: MONO, letterSpacing: "-.02em", color: T.text },
  rrSummaryTime: { fontSize: 12, color: T.sec, fontWeight: 500 },
  rrSummaryMeta: { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" },
};

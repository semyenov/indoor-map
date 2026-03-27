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
import { ATLAS_THEME_VARS, CSS, MONO, S, ST, T } from "./atlasStyles";
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

function PersonRow({ person, onClick }: { person: AtlasPerson; onClick: (person: AtlasPerson) => void }) {
  return (
    <button style={S.personCard} className="hud-card card-anim" onClick={() => onClick(person)} type="button">
      <div style={S.routeChoiceTop}>
        <div style={S.personTitleRow}>
          <div style={S.personAv}>{person.name[0]}</div>
          <span style={S.personName}>{person.name}</span>
        </div>
        <span style={S.cardLevel}>{person.level}</span>
      </div>
      <div style={S.routeChoiceMeta}>
        <span style={S.routeChoiceMetaText}>{person.desk}</span>
      </div>
      <div style={S.routeChoiceFooter}>
        <span style={S.routeChoiceDept}>{person.dept}</span>
      </div>
    </button>
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
                      <span style={S.routeChoiceName}>{space.name}</span>
                      <span style={S.cardLevel}>{space.level}</span>
                    </div>
                    <div style={S.routeChoiceMeta}>
                      <span style={S.routeChoiceMetaText}>{space.kindLabel}</span>
                      {space.cap > 0 ? <span style={S.routeChoiceMetaText}>{space.cap}</span> : null}
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
  const browseStageComment = browseQ.trim()
    ? `Показываем результаты для «${browseQ.trim()}». Выберите удобную группировку справа.`
    : "Используйте верхний поиск или меняйте группировку справа.";

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
              <span style={S.topBrandText}>Atlas</span>
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
                    <span style={S.bottomMeta}>{selectedFeature.properties.department ?? "Общие"} · {selectedFeature.properties.level} · {selectedStatusLabel}</span>
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
                    <div style={{ ...S.rpStageControls, ...S.browseStageControls }}>
                      <div style={S.browseStageComment}>{browseStageComment}</div>
                      <div style={S.rpColToolbar}>
                        <span style={S.sectionGroupLabel}>ГРУППА</span>
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
                        <RouteCandidateGrid
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
                        <div style={S.rpStageMetaRow}>
                          <div style={S.rpColToolbar}>
                            <span style={S.sectionGroupLabel}>ГРУППА</span>
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
              <div style={S.drawerInfoPanel} className="oa-fade">
                <div style={S.sidePanelBody}>
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
                          const isHovered = hoveredStepIdx === index;
                          return (
                            <div
                              key={`${index}-${step}`}
                              style={{ ...S.rrStepCard, ...(isLast ? S.rrStepCardLast : {}), ...(isHovered ? S.rrStepCardHovered : {}) }}
                              onMouseEnter={() => setHoveredStepIdx(index)}
                              onMouseLeave={() => setHoveredStepIdx(null)}
                              onClick={() => setHoveredStepIdx(index)}
                            >
                              <div style={{ ...S.rrStepN, ...(isLast ? S.rrStepNLast : isHovered ? S.rrStepNHovered : {}) }}>
                                {isLast ? <Ic.Check /> : index + 1}
                              </div>
                              <div style={S.rrStepBody}>
                                <span style={{ ...S.rrStepT, ...(isHovered ? S.rrStepTHovered : {}) }}>{step}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
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
                  const isEmployeeCard = Boolean(selectedFeature.properties.employee);

                  return (
                    <div style={{ ...S.sidePanelBody, ...S.sidePanelBodyDetail }}>
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
                      {hasSubtitle && !isEmployeeCard ? (
                        <div style={S.detailSectionCard}>
                          <span style={S.detailSectionLabel}>Описание</span>
                          <span style={S.detailDescText}>{selectedFeature.properties.subtitle}</span>
                        </div>
                      ) : null}

                      {hasEquipment ? (
                        <div style={S.detailSectionCard}>
                          <span style={S.detailSectionLabel}>Оснащение</span>
                          <div style={S.detailEquipmentRow}>
                            {equipment.map((e: string) => (
                              <span key={e} style={S.infoChip}>{e}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {isEmployeeCard ? (
                        <div style={S.detailSectionCard}>
                          <span style={S.detailSectionLabel}>Рабочее место</span>
                          <span style={S.detailDescText}>{selectedFeature.properties.name}</span>
                        </div>
                      ) : null}
                    </div>
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
                          <span style={S.sectionGroupLabel}>ГРУППА</span>
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
                                  ...(active ? { background: cfg.bg, border: T.controlBorder, boxShadow: `inset 0 0 0 1px ${cfg.c}66`, color: cfg.c } : {}),
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
                                <span style={S.opsStatusPillContent}>
                                  <span style={{ ...S.opsStatusPillDot, background: cfg.c }} />
                                  <span>{cfg.label}</span>
                                </span>
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

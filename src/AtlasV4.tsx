import {
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
  { key: "level", label: "Floor" },
  { key: "kind", label: "Type" },
  { key: "dept", label: "Department" },
  { key: "status", label: "Status" },
];

const VIEW_MODES: Array<{ id: MapSceneMode; label: string }> = [
  { id: "plan", label: "Plan" },
  { id: "explore", label: "Explore" },
  { id: "theatre", label: "Theatre" },
];

const THEME_OPTIONS: Array<{ id: MapThemeVariant; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const ST: Record<RoomStatus, { c: string; bg: string; label: string }> = {
  available: { c: "#34d399", bg: "rgba(52,211,153,.12)", label: "Available" },
  occupied: { c: "#f87171", bg: "rgba(248,113,113,.12)", label: "Occupied" },
  focus: { c: "#fbbf24", bg: "rgba(251,191,36,.12)", label: "Focus" },
  offline: { c: "#64748b", bg: "rgba(100,116,139,.10)", label: "Offline" },
};

const KIND_L: Record<AtlasKind, string> = {
  room: "Workspace",
  meeting: "Meeting Room",
  amenity: "Amenity",
  connector: "Connector",
  workstation: "Workstation",
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
  return unique.length > 0 ? unique.join(" + ") : "flat";
};

const routeSteps = (
  route: RouteResult | null,
  fromLabel: string,
  toLabel: string,
) => {
  if (!route) {
    return [];
  }

  const steps = [`Leave ${fromLabel}`];

  if (route.summary.connectorTypes.length > 0) {
    route.summary.levels.slice(1).forEach((level, index) => {
      const connector = route.summary.connectorTypes[index] ?? route.summary.connectorTypes[0] ?? "connector";
      steps.push(`Take ${connector} to ${level}`);
    });
  }

  steps.push(`Continue toward ${toLabel}`);
  steps.push(`Arrive at ${toLabel}`);
  return steps;
};

const routeDurationLabel = (distance: number) => `~${Math.max(1, Math.round(distance / 60))} min walk`;

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
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1.5L1.5 5L7 8.5L12.5 5L7 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" opacity="0.06" />
      <path d="M1.5 8L7 11.5L12.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
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
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 11L7 7L11 5L9 9L5 11Z" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  ),
  Eye: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1.5 7S3.5 3 7 3S12.5 7 12.5 7S10.5 11 7 11S1.5 7 1.5 7Z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  Grid: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
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
      {!compact && space.dept !== "Shared" ? <span style={S.cardDept}>{space.dept}</span> : null}
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

export default function AtlasV4() {
  const [indoorData, setIndoorData] = useState<IndoorRuntimeData | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [activeLevel, setActiveLevel] = useState<LevelId>("L1");
  const [viewMode, setViewMode] = useState<MapSceneMode>("explore");
  const [themeVariant, setThemeVariant] = useState<MapThemeVariant>("dark");
  const [time, setTime] = useState(new Date());
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQ, setBrowseQ] = useState("");
  const [browseGroup, setBrowseGroup] = useState<GroupKey>("level");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>("room-l1-lobby");
  const [routeOpen, setRouteOpen] = useState(false);
  const [routeFromId, setRouteFromId] = useState("");
  const [routeToId, setRouteToId] = useState("");
  const [routeFromQ, setRouteFromQ] = useState("");
  const [routeToQ, setRouteToQ] = useState("");
  const [routeFromGroup, setRouteFromGroup] = useState<GroupKey>("level");
  const [routeToGroup, setRouteToGroup] = useState<GroupKey>("level");
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [roomStatuses, setRoomStatuses] = useState<RoomStatuses>({});
  const [occupancyUpdatedAt, setOccupancyUpdatedAt] = useState<Date | null>(null);
  const [zoomCommand, setZoomCommand] = useState<{ id: number; delta: 1 | -1 } | null>(null);
  const browseRef = useRef<HTMLInputElement | null>(null);
  const deferredBrowseQuery = useDeferredValue(browseQ);

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
          dept: feature.properties.department ?? "Shared",
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
          dept: feature.properties.department ?? "Shared",
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

  const selectedFeature = selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null;
  const selectedSpace = selectedFeatureId ? atlasSpaces.find((space) => space.featureId === selectedFeatureId) ?? null : null;
  const selectedRouteTarget = routeTargets.find((target) => target.featureId === selectedFeatureId) ?? null;
  const selectedStatus = featureStatus(featureById, selectedFeatureId, roomStatuses) ?? "offline";
  const routeSummaryDistance = route ? Math.round(route.summary.distance) : 0;
  const routeStepsList = routeSteps(route, routeFrom?.name ?? "Start", routeTo?.name ?? "Destination");
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

      if (nextLevel) {
        setActiveLevel(nextLevel);
      }
    });
  };

  const openBrowse = () => {
    setBrowseOpen(true);
    setBrowseQ("");
    window.setTimeout(() => browseRef.current?.focus(), 80);
  };

  const openRouteBuilder = (fromTargetId: string | null = null, toTargetId: string | null = null) => {
    setRouteOpen(true);
    setRouteFromId(fromTargetId ?? routeFromId);
    setRouteToId(toTargetId ?? routeToId);
    setRouteFromQ("");
    setRouteToQ("");
  };

  const closeRoute = () => {
    setRouteOpen(false);
  };

  const buildRoute = () => {
    const fromNodeIds = routeTargets.find((target) => target.id === routeFromId)?.routeNodeIds ?? [];
    const toNodeIds = routeTargets.find((target) => target.id === routeToId)?.routeNodeIds ?? [];

    if (fromNodeIds.length === 0 || toNodeIds.length === 0) {
      setRoute(null);
      setRouteError("Pick both endpoints.");
      return;
    }

    const result = computeShortestRoute(routingGraph, fromNodeIds, toNodeIds, { accessibleOnly });

    if (!result) {
      setRoute(null);
      setRouteError(accessibleOnly ? "No accessible route found." : "No route found.");
      return;
    }

    setRoute(result);
    setRouteError(null);
    setRouteOpen(false);
    const firstLevel = result.summary.levels[0];

    if (firstLevel) {
      setActiveLevel(firstLevel);
    }
  };

  const queueZoom = (delta: 1 | -1) => {
    setZoomCommand((current) => ({ id: (current?.id ?? 0) + 1, delta }));
  };

  if (datasetError) {
    return (
      <div style={S.shell}>
        <style>{CSS}</style>
        <div style={S.emptyState}>Dataset error: {datasetError}</div>
      </div>
    );
  }

  if (!indoorData || !dataset || !indexes) {
    return (
      <div style={S.shell}>
        <style>{CSS}</style>
        <div style={S.emptyState}>Loading indoor dataset…</div>
      </div>
    );
  }

  return (
    <div style={S.shell}>
      <style>{CSS}</style>

      <div style={S.mapBg}>
        <Suspense fallback={<div style={S.mapLoading}>Loading map…</div>}>
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
        <div style={S.topLeft}>
          <div style={S.logo} className="hud-glass">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1" y="1" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.9" />
              <rect x="10" y="1" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.45" />
              <rect x="1" y="10" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.25" />
              <rect x="10" y="10" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.65" />
            </svg>
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-.02em" }}>Atlas</span>
          </div>
          <button style={S.searchBtn} className="hud-glass hud-hover" onClick={openBrowse} type="button">
            <Ic.Search s={14} /> <span style={{ color: T.muted, fontWeight: 400 }}>Browse spaces & people…</span>
            <kbd style={S.kbd}>/</kbd>
          </button>
        </div>

        <div style={S.topCenter}>
          <div style={S.viewModes} className="hud-glass">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                style={{ ...S.vmBtn, ...(viewMode === mode.id ? S.vmActive : {}) }}
                className="hud-btn"
                onClick={() => setViewMode(mode.id)}
                type="button"
              >
                {mode.id === "plan" ? <Ic.Floor /> : mode.id === "explore" ? <Ic.Compass /> : <Ic.Eye />}
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={S.topRight}>
          <div style={S.themeSwitch} className="hud-glass">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                style={{ ...S.themeBtn, ...(themeVariant === option.id ? S.themeBtnActive : {}) }}
                className="hud-btn"
                onClick={() => setThemeVariant(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button style={S.opsBtn} className="hud-glass hud-hover" onClick={() => setOpsOpen((current) => !current)} type="button">
            <Ic.Grid />
            <span style={S.opsBadge}>
              <span style={{ ...S.liveDot, background: ST.available.c, width: 6, height: 6 }} /> {statusCounts.available} free
            </span>
          </button>
          <div style={S.syncChip} className="hud-glass">
            <span style={{ ...S.liveDot, background: "#34d399", width: 5, height: 5 }} />
            {(occupancyUpdatedAt ?? time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </header>

      <div style={S.bottomLeft}>
        <div style={S.floorPicker} className="hud-glass">
          {levels.map((level) => (
            <button
              key={level.id}
              style={{ ...S.floorBtn, ...(activeLevel === level.id ? S.floorBtnActive : {}) }}
              className="hud-btn"
              onClick={() => setActiveLevel(level.id)}
              type="button"
            >
              {level.id}
            </button>
          ))}
        </div>
      </div>

      <div style={S.bottomRight}>
        <div style={S.zoomStack} className="hud-glass">
          <button style={S.zoomBtn} className="hud-btn" onClick={() => queueZoom(1)} type="button">
            +
          </button>
          <div style={{ height: 1, background: "rgba(255,255,255,.06)", width: "60%", alignSelf: "center" }} />
          <button style={S.zoomBtn} className="hud-btn" onClick={() => queueZoom(-1)} type="button">
            −
          </button>
        </div>
      </div>

      {!routeOpen && !browseOpen ? (
        <button style={S.fab} className="hud-accent" onClick={() => openRouteBuilder()} type="button">
          <Ic.Route /> <span>Route</span>
        </button>
      ) : null}

      {browseOpen ? (
        <div style={S.overlay} onClick={() => setBrowseOpen(false)}>
          <div style={S.browsePanel} className="hud-glass-heavy oa-fade" onClick={(event) => event.stopPropagation()}>
            <div style={S.bpHeader}>
              <div style={S.bpSearchRow}>
                <Ic.Search s={16} />
                <input
                  ref={browseRef}
                  style={S.bpInput}
                  placeholder="Search spaces, people, departments…"
                  value={browseQ}
                  onChange={(event) => setBrowseQ(event.target.value)}
                />
                {browseQ ? (
                  <button style={S.iconBtn} className="hud-btn" onClick={() => setBrowseQ("")} type="button">
                    <Ic.X s={12} />
                  </button>
                ) : null}
                <div style={S.bpDivider} />
                <button style={S.iconBtn} className="hud-btn" onClick={() => setBrowseOpen(false)} type="button">
                  <Ic.X />
                </button>
              </div>
              <div style={S.bpToolbar}>
                <div style={S.bpGroupRow}>
                  <span style={S.bpGroupLabel}>Group by</span>
                  {GROUP_OPTIONS.map((group) => (
                    <button
                      key={group.key}
                      style={{ ...S.pill, ...(browseGroup === group.key ? S.pillActive : {}) }}
                      className="hud-btn"
                      onClick={() => setBrowseGroup(group.key)}
                      type="button"
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                <span style={S.bpCount}>
                  {browseQ.trim() ? `${matchedSearchResults.length} indexed hits` : `${browseSpaces.length} spaces`}
                  {browsePeople.length > 0 ? ` · ${browsePeople.length} people` : ""}
                </span>
              </div>
            </div>

            <div style={S.bpBody}>
              {browsePeople.length > 0 ? (
                <div style={S.bpPeopleSection}>
                  <div style={S.bpSectionTitle}>
                    <Ic.User /> People
                  </div>
                  <div style={S.bpPeopleGrid}>
                    {browsePeople.slice(0, 6).map((person) => (
                      <PersonRow key={person.featureId} person={person} onClick={(nextPerson) => {
                        onSelectFeature(nextPerson.featureId);
                        setBrowseOpen(false);
                      }} />
                    ))}
                  </div>
                </div>
              ) : null}

              <GroupedGrid
                spaces={browseQ.trim() ? matchedSearchResults : browseSpaces}
                groupKey={browseGroup}
                onSelect={(space) => {
                  onSelectFeature(space.featureId);
                  setBrowseOpen(false);
                }}
                selectedFeatureId={selectedFeatureId}
              />
            </div>
          </div>
        </div>
      ) : null}

      {routeOpen ? (
        <div style={S.overlay} onClick={closeRoute}>
          <div style={S.routePanel} className="hud-glass-heavy oa-fade" onClick={(event) => event.stopPropagation()}>
            <div style={S.rpHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Ic.Route />
                <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em" }}>Route Builder</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
                  <span>Accessible only</span>
                </label>
                <button
                  style={{ ...S.accentBtn, opacity: routeFrom && routeTo ? 1 : 0.35, pointerEvents: routeFrom && routeTo ? "auto" : "none" }}
                  className="hud-accent"
                  onClick={buildRoute}
                  type="button"
                >
                  <Ic.Nav /> Build route
                </button>
                <button style={S.iconBtn} className="hud-btn" onClick={closeRoute} type="button">
                  <Ic.X />
                </button>
              </div>
            </div>

            <div style={S.rpColumns}>
              <div style={S.rpCol}>
                <div style={S.rpColHeader}>
                  <div style={S.rpColDot}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", border: `2.5px solid ${T.accent}` }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={S.rpColLabel}>From — Starting point</div>
                    {routeFrom ? (
                      <div style={S.rpSelected}>
                        <span style={{ ...S.statusDot, background: ST[routeFrom.status].c }} />
                        <span style={S.rpSelectedName}>{routeFrom.name}</span>
                        <span style={S.rpSelectedLevel}>{routeFrom.level}</span>
                        <button style={S.rpClearBtn} className="hud-btn" onClick={() => setRouteFromId("")} type="button">
                          <Ic.X s={10} />
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: T.muted }}>Pick a starting room below</span>
                    )}
                  </div>
                </div>
                <div style={S.rpColSearch}>
                  <Ic.Search s={13} />
                  <input style={S.rpColInput} placeholder="Filter…" value={routeFromQ} onChange={(event) => setRouteFromQ(event.target.value)} />
                  {routeFromQ ? (
                    <button style={{ ...S.iconBtn, width: 22, height: 22 }} className="hud-btn" onClick={() => setRouteFromQ("")} type="button">
                      <Ic.X s={10} />
                    </button>
                  ) : null}
                </div>
                <div style={S.rpColToolbar}>
                  <span style={{ fontSize: 10, color: T.muted, fontWeight: 600 }}>GROUP</span>
                  {GROUP_OPTIONS.slice(0, 3).map((group) => (
                    <button
                      key={group.key}
                      style={{ ...S.pillSm, ...(routeFromGroup === group.key ? S.pillSmActive : {}) }}
                      className="hud-btn"
                      onClick={() => setRouteFromGroup(group.key)}
                      type="button"
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                <div style={S.rpColBody}>
                  <GroupedGrid
                    spaces={routeFromChoices}
                    groupKey={routeFromGroup}
                    onSelect={(space) => setRouteFromId(space.routeTargetId ?? "")}
                    selectedFeatureId={routeFrom?.featureId ?? null}
                    compact
                  />
                </div>
              </div>

              <div style={S.rpSwapCol}>
                <button
                  style={S.rpSwapBtn}
                  className="hud-btn"
                  onClick={() => {
                    const fromId = routeFromId;
                    setRouteFromId(routeToId);
                    setRouteToId(fromId);
                  }}
                  type="button"
                >
                  <Ic.Swap />
                </button>
              </div>

              <div style={{ ...S.rpCol, borderRight: "none" }}>
                <div style={S.rpColHeader}>
                  <div style={S.rpColDot}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: T.accent }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={S.rpColLabel}>To — Destination</div>
                    {routeTo ? (
                      <div style={S.rpSelected}>
                        <span style={{ ...S.statusDot, background: ST[routeTo.status].c }} />
                        <span style={S.rpSelectedName}>{routeTo.name}</span>
                        <span style={S.rpSelectedLevel}>{routeTo.level}</span>
                        <button style={S.rpClearBtn} className="hud-btn" onClick={() => setRouteToId("")} type="button">
                          <Ic.X s={10} />
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: T.muted }}>Pick a destination below</span>
                    )}
                  </div>
                </div>
                <div style={S.rpColSearch}>
                  <Ic.Search s={13} />
                  <input style={S.rpColInput} placeholder="Filter…" value={routeToQ} onChange={(event) => setRouteToQ(event.target.value)} />
                  {routeToQ ? (
                    <button style={{ ...S.iconBtn, width: 22, height: 22 }} className="hud-btn" onClick={() => setRouteToQ("")} type="button">
                      <Ic.X s={10} />
                    </button>
                  ) : null}
                </div>
                <div style={S.rpColToolbar}>
                  <span style={{ fontSize: 10, color: T.muted, fontWeight: 600 }}>GROUP</span>
                  {GROUP_OPTIONS.slice(0, 3).map((group) => (
                    <button
                      key={group.key}
                      style={{ ...S.pillSm, ...(routeToGroup === group.key ? S.pillSmActive : {}) }}
                      className="hud-btn"
                      onClick={() => setRouteToGroup(group.key)}
                      type="button"
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                <div style={S.rpColBody}>
                  <GroupedGrid
                    spaces={routeToChoices}
                    groupKey={routeToGroup}
                    onSelect={(space) => setRouteToId(space.routeTargetId ?? "")}
                    selectedFeatureId={routeTo?.featureId ?? null}
                    compact
                  />
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : null}

      {route && !routeOpen ? (
        <div style={S.routeResultFloat} className="hud-glass-heavy oa-slide-left">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: T.accent }}>
                Active Route
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.1 }}>
                {routeFrom?.name ?? "Start"} <span style={{ color: T.muted }}>→</span> {routeTo?.name ?? "Destination"}
              </div>
              <div style={{ fontSize: 12, color: T.sec }}>
                {routeSummaryDistance} m · {routeDurationLabel(route.summary.distance)}
              </div>
            </div>
            <button
              style={S.iconBtn}
              className="hud-btn"
              onClick={() => {
                setRoute(null);
                setRouteError(null);
              }}
              type="button"
            >
              <Ic.X />
            </button>
          </div>

          <div style={S.rrPath}>
            {routeFrom?.name ?? "Start"} <Ic.ArrowR /> {routeTo?.name ?? "Destination"}
          </div>

          <div style={S.rrStatsPanel}>
            {[
              { v: String(route.nodeIds.length), l: "Nodes" },
              { v: String(route.legs.length), l: "Legs" },
              { v: String(route.summary.levels.length), l: "Levels" },
              { v: routeConnectorLabel(route.summary.connectorTypes), l: "Via" },
            ].map((stat) => (
              <div key={stat.l} style={S.rrStatCard}>
                <span style={S.rrStatV}>{stat.v}</span>
                <span style={S.rrStatL}>{stat.l}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {routeStepsList.map((step, index) => (
              <div key={step} style={S.rrStep}>
                <div style={{ ...S.rrStepN, ...(index === routeStepsList.length - 1 ? { background: T.accent, color: "#0c1018", borderColor: T.accent } : {}) }}>
                  {index === routeStepsList.length - 1 ? <Ic.Check /> : index + 1}
                </div>
                <span style={S.rrStepT}>{step}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.accentBtn} className="hud-accent" onClick={() => setRouteOpen(true)} type="button">
              <Ic.Route /> Edit route
            </button>
            <button
              style={S.ghostBtn}
              className="hud-btn"
              onClick={() => {
                setRoute(null);
                setRouteError(null);
              }}
              type="button"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {selectedFeature && !browseOpen && !routeOpen && !route ? (
        <div style={S.detailFloat} className="hud-glass-heavy oa-slide-left">
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={S.iconBtn} className="hud-btn" onClick={() => setSelectedFeatureId(null)} type="button">
              <Ic.X />
            </button>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: T.accent }}>
            {KIND_L[getAtlasKind(selectedFeature)]}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", margin: 0, lineHeight: 1.2 }}>
            {selectedFeature.properties.employee ?? selectedFeature.properties.name}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...S.statusPill, color: ST[selectedStatus].c, background: ST[selectedStatus].bg }}>
              <Ic.Pulse /> {ST[selectedStatus].label}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: T.sec, background: "rgba(255,255,255,.05)", padding: "2px 8px", borderRadius: 5 }}>
              {selectedFeature.properties.level}
            </span>
            {(selectedFeature.properties.capacity ?? 0) > 0 ? <span style={{ fontSize: 11, color: T.sec }}>{selectedFeature.properties.capacity} seats</span> : null}
          </div>
          {selectedFeature.properties.employee ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 12 }}>
              <div style={S.personAv}>{selectedFeature.properties.employee[0]}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedFeature.properties.employee}</div>
                <div style={{ fontSize: 11, color: T.muted }}>{selectedFeature.properties.name}</div>
              </div>
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: T.border, borderRadius: 12, overflow: "hidden" }}>
            {[
              ["Department", selectedFeature.properties.department ?? "Shared"],
              ["Level", selectedFeature.properties.level],
              ["ID", selectedFeature.id],
              ["Route", selectedRouteTarget?.routeNodeId ?? "N/A"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px", background: "rgba(15,20,32,.5)" }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, ...(label === "ID" || label === "Route" ? { fontFamily: MONO, fontSize: 10 } : {}) }}>{value}</span>
              </div>
            ))}
          </div>
          {(selectedFeature.properties.equipment ?? []).length > 0 ? (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {(selectedFeature.properties.equipment ?? []).map((equipment) => (
                <span key={equipment} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 500, color: T.sec, background: "rgba(255,255,255,.04)", borderRadius: 6, border: `1px solid ${T.border}` }}>
                  {equipment}
                </span>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              style={{ ...S.accentBtn, opacity: selectedRouteTarget ? 1 : 0.45, pointerEvents: selectedRouteTarget ? "auto" : "none" }}
              className="hud-accent"
              onClick={() => openRouteBuilder(routeTargets.find((target) => target.featureId === "room-l1-lobby")?.id ?? null, selectedRouteTarget?.id ?? null)}
              type="button"
            >
              <Ic.Nav /> Navigate here
            </button>
            <button
              style={{ ...S.ghostBtn, opacity: selectedRouteTarget ? 1 : 0.45, pointerEvents: selectedRouteTarget ? "auto" : "none" }}
              className="hud-btn"
              onClick={() => openRouteBuilder(selectedRouteTarget?.id ?? null, routeToId)}
              type="button"
            >
              <Ic.Route /> Route from here
            </button>
          </div>
        </div>
      ) : null}

      {opsOpen ? (
        <div style={S.opsPanel} className="hud-glass-heavy oa-fade">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Ic.Grid />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Operations</span>
            </div>
            <button style={S.iconBtn} className="hud-btn" onClick={() => setOpsOpen(false)} type="button">
              <Ic.X />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderBottom: `1px solid ${T.border}` }}>
            {Object.entries(ST).map(([statusKey, config]) => (
              <div key={statusKey} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "12px 6px" }}>
                <span style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO, lineHeight: 1, color: config.c }}>{statusCounts[statusKey as RoomStatus]}</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{config.label}</span>
              </div>
            ))}
          </div>
          <div style={{ overflowY: "auto", padding: 6, maxHeight: 300 }}>
            {levelRooms.map((space) => {
              const config = ST[space.status];
              return (
                <button
                  key={space.id}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "none", border: "none", borderRadius: 10, fontFamily: FONT, color: T.text, textAlign: "left" }}
                  className="hud-card"
                  onClick={() => {
                    onSelectFeature(space.featureId);
                    setOpsOpen(false);
                  }}
                  type="button"
                >
                  <span style={{ ...S.statusDot, background: config.c, width: 8, height: 8 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{space.name}</span>
                    <span style={{ fontSize: 11, color: T.muted }}>{space.level} · {space.cap} seats</span>
                  </div>
                  <span style={{ ...S.statusPill, fontSize: 10, padding: "2px 8px", color: config.c, background: config.bg }}>{config.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const FONT = "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const T = {
  bg: "#0c1018",
  glass: "rgba(15,20,32,.72)",
  glassH: "rgba(12,16,26,.92)",
  border: "rgba(255,255,255,.07)",
  borderH: "rgba(255,255,255,.12)",
  text: "#e4e6ea",
  sec: "rgba(255,255,255,.50)",
  muted: "rgba(255,255,255,.28)",
  accent: "#38bdf8",
  accentBg: "rgba(56,189,248,.10)",
  accentBorder: "rgba(56,189,248,.22)",
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
  .hud-glass{background:${T.glass};backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid ${T.border}}
  .hud-glass-heavy{background:${T.glassH};backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);border:1px solid ${T.borderH}}
  .hud-hover{cursor:pointer;transition:background .12s,border-color .12s}.hud-hover:hover{background:${T.glassH}!important;border-color:${T.borderH}!important}
  .hud-btn{cursor:pointer;transition:background .1s,color .1s}.hud-btn:hover{background:rgba(255,255,255,.06)!important}
  .hud-accent{cursor:pointer;transition:background .15s,box-shadow .15s,transform .08s}.hud-accent:hover{background:#0ea5e9!important;box-shadow:0 4px 20px rgba(56,189,248,.3)!important}.hud-accent:active{transform:scale(.97)}
  .hud-card{cursor:pointer;transition:background .1s,border-color .1s,box-shadow .1s}.hud-card:hover{background:rgba(255,255,255,.05)!important;border-color:rgba(255,255,255,.12)!important}
`;

const S: Record<string, CSSProperties> = {
  shell: { position: "relative", width: "100%", height: "100vh", overflow: "hidden", fontFamily: FONT, color: T.text, fontSize: 13, background: T.bg, lineHeight: 1.5 },
  mapBg: { position: "absolute", inset: 0, zIndex: 0 },
  mapLoading: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.sec },
  emptyState: { width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, color: T.sec, fontFamily: FONT },
  topBar: { position: "absolute", top: 12, left: 12, right: 12, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  topLeft: { display: "flex", alignItems: "center", gap: 8 },
  logo: { display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 12, flexShrink: 0 },
  searchBtn: { display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderRadius: 12, fontFamily: FONT, fontSize: 13, fontWeight: 500, color: T.sec, background: "none", border: "none", minWidth: 280 },
  kbd: { marginLeft: "auto", padding: "2px 7px", fontSize: 10, fontWeight: 600, fontFamily: MONO, color: T.muted, background: "rgba(255,255,255,.04)", borderRadius: 4, border: `1px solid ${T.border}` },
  topCenter: {},
  topRight: { display: "flex", alignItems: "center", gap: 8 },
  themeSwitch: { display: "flex", gap: 2, padding: 3, borderRadius: 12 },
  themeBtn: { padding: "7px 12px", background: "none", border: "none", borderRadius: 9, fontSize: 12, fontWeight: 600, fontFamily: FONT, color: T.muted },
  themeBtnActive: { color: T.text, background: "rgba(255,255,255,.08)" },
  viewModes: { display: "flex", gap: 2, padding: 3, borderRadius: 12 },
  vmBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "none", border: "none", borderRadius: 9, fontSize: 12, fontWeight: 500, fontFamily: FONT, color: T.muted, whiteSpace: "nowrap" },
  vmActive: { color: T.text, background: "rgba(255,255,255,.08)" },
  opsBtn: { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 12, background: "none", border: "none", fontFamily: FONT, color: T.sec },
  opsBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600 },
  syncChip: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, fontSize: 10, color: T.sec },
  liveDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0, animation: "oa-pulse 2.5s ease infinite" },
  bottomLeft: { position: "absolute", bottom: 14, left: 14, zIndex: 10 },
  floorPicker: { display: "flex", gap: 2, padding: 3, borderRadius: 12 },
  floorBtn: { padding: "7px 16px", background: "none", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, fontFamily: MONO, color: T.muted },
  floorBtnActive: { color: T.accent, background: T.accentBg },
  bottomRight: { position: "absolute", bottom: 14, right: 14, zIndex: 10 },
  zoomStack: { display: "flex", flexDirection: "column", alignItems: "center", borderRadius: 12, overflow: "hidden" },
  zoomBtn: { width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", fontSize: 18, fontWeight: 300, fontFamily: FONT, color: T.sec },
  fab: { position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", zIndex: 10, display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", background: T.accent, color: "#0c1018", border: "none", borderRadius: 16, fontSize: 14, fontWeight: 700, fontFamily: FONT, boxShadow: "0 4px 24px rgba(56,189,248,.25)" },
  overlay: { position: "absolute", inset: 0, zIndex: 50, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  browsePanel: { width: "90%", maxWidth: 1100, height: "85vh", borderRadius: 20, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 32px 100px rgba(0,0,0,.5)" },
  bpHeader: { padding: "16px 20px 12px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 },
  bpSearchRow: { display: "flex", alignItems: "center", gap: 10, color: T.sec },
  bpInput: { flex: 1, background: "none", border: "none", outline: "none", color: T.text, fontSize: 15, fontWeight: 500, fontFamily: FONT },
  bpDivider: { width: 1, height: 20, background: T.border },
  bpToolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  bpGroupRow: { display: "flex", alignItems: "center", gap: 5 },
  bpGroupLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", marginRight: 4 },
  bpCount: { fontSize: 11, color: T.muted, fontWeight: 500 },
  bpBody: { flex: 1, overflowY: "auto", padding: 20 },
  bpPeopleSection: { marginBottom: 24 },
  bpSectionTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: T.sec, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 },
  bpPeopleGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 6 },
  pill: { padding: "5px 12px", fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,.04)", border: `1px solid ${T.border}`, borderRadius: 8, color: T.sec, fontFamily: FONT },
  pillActive: { background: T.accentBg, borderColor: T.accentBorder, color: T.accent },
  pillSm: { padding: "3px 9px", fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,.03)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontFamily: FONT },
  pillSmActive: { background: T.accentBg, borderColor: T.accentBorder, color: T.accent },
  groupedGrid: { display: "flex", flexDirection: "column", gap: 24 },
  group: {},
  groupHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  groupLabel: { fontSize: 12, fontWeight: 700, color: T.sec, textTransform: "uppercase", letterSpacing: ".04em" },
  groupCount: { fontSize: 10, fontWeight: 600, color: T.muted, background: "rgba(255,255,255,.04)", padding: "1px 7px", borderRadius: 10 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 6 },
  gridCompact: { gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 4 },
  card: { display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", background: "rgba(255,255,255,.02)", border: `1px solid ${T.border}`, borderRadius: 12, textAlign: "left", fontFamily: FONT, color: T.text },
  cardSelected: { borderColor: T.accent, background: T.accentBg, boxShadow: `0 0 0 1px ${T.accent}40` },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  cardNameRow: { display: "flex", alignItems: "center", gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  cardName: { fontSize: 13, fontWeight: 650, lineHeight: 1.3 },
  cardLevel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.accent, background: T.accentBg, padding: "2px 6px", borderRadius: 4, flexShrink: 0 },
  cardBottom: { display: "flex", alignItems: "center", gap: 8 },
  cardKind: { fontSize: 11, color: T.muted, fontWeight: 500 },
  cardCap: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: T.sec, fontWeight: 500 },
  cardDept: { fontSize: 10, color: T.muted, fontWeight: 500, marginTop: -2 },
  personRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "rgba(255,255,255,.02)", border: `1px solid ${T.border}`, borderRadius: 12, fontFamily: FONT, color: T.text, textAlign: "left" },
  personAv: { width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,rgba(56,189,248,.2),rgba(56,189,248,.05))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: T.accent, flexShrink: 0 },
  personInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  routePanel: { width: "92%", maxWidth: 1200, height: "88vh", borderRadius: 20, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 32px 100px rgba(0,0,0,.5)" },
  rpHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: `1px solid ${T.border}`, flexShrink: 0, gap: 12, flexWrap: "wrap" },
  rpColumns: { flex: 1, display: "flex", overflow: "hidden", minHeight: 0 },
  rpCol: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: `1px solid ${T.border}` },
  rpColHeader: { display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 },
  rpColDot: { paddingTop: 2, flexShrink: 0 },
  rpColLabel: { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 },
  rpSelected: { display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 8, marginTop: 4 },
  rpSelectedName: { fontSize: 13, fontWeight: 650 },
  rpSelectedLevel: { fontSize: 10, fontWeight: 700, fontFamily: MONO, color: T.accent, marginLeft: "auto" },
  rpClearBtn: { width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.06)", border: "none", borderRadius: 5, color: T.muted, marginLeft: 4, flexShrink: 0 },
  rpColSearch: { display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderBottom: `1px solid ${T.border}`, color: T.muted, flexShrink: 0 },
  rpColInput: { flex: 1, background: "none", border: "none", outline: "none", color: T.text, fontSize: 12, fontFamily: FONT },
  rpColToolbar: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 },
  rpColBody: { flex: 1, overflowY: "auto", padding: 12 },
  rpSwapCol: { display: "flex", alignItems: "center", paddingTop: 60, flexShrink: 0 },
  rpSwapBtn: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.04)", border: `1px solid ${T.border}`, borderRadius: 10, color: T.muted, margin: "-1px" },
  rpResult: { padding: "16px 20px", borderTop: `1px solid ${T.border}`, flexShrink: 0, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" },
  rrHero: { display: "flex", alignItems: "center", gap: 14, flex: "1 1 400px", flexWrap: "wrap" },
  rrIcon: { width: 42, height: 42, borderRadius: 12, background: T.accent, color: "#0c1018", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rrMain: { display: "flex", flexDirection: "column" },
  rrDist: { fontSize: 22, fontWeight: 800, fontFamily: MONO, letterSpacing: "-.02em" },
  rrTime: { fontSize: 11, color: T.sec },
  rrPath: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.sec, fontWeight: 500, width: "100%" },
  rrStats: { display: "flex", gap: 16, marginTop: 4, width: "100%" },
  rrStat: { display: "flex", flexDirection: "column", alignItems: "center", gap: 1 },
  rrStatV: { fontSize: 15, fontWeight: 800, fontFamily: MONO, lineHeight: 1, display: "flex", alignItems: "center" },
  rrStatL: { fontSize: 9, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: ".05em" },
  rrDirections: { flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 0 },
  rrStep: { display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0" },
  rrStepN: { width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,.05)", border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, color: T.sec },
  rrStepT: { fontSize: 12, color: T.sec, lineHeight: 1.5, paddingTop: 2 },
  accentBtn: { display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", background: T.accent, color: "#0c1018", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, fontFamily: FONT },
  ghostBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 14px", background: "none", color: T.sec, border: `1px solid ${T.border}`, borderRadius: 12, fontSize: 12, fontWeight: 600, fontFamily: FONT },
  iconBtn: { width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.04)", border: "none", borderRadius: 8, color: T.sec, flexShrink: 0 },
  detailFloat: { position: "absolute", top: 68, right: 14, zIndex: 20, width: 300, borderRadius: 18, padding: 18, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 16px 60px rgba(0,0,0,.35)", maxHeight: "calc(100vh - 90px)", overflowY: "auto" },
  routeResultFloat: { position: "absolute", top: 68, right: 14, zIndex: 22, width: 340, borderRadius: 18, padding: 18, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 16px 60px rgba(0,0,0,.35)", maxHeight: "calc(100vh - 90px)", overflowY: "auto" },
  statusPill: { display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 20 },
  opsPanel: { position: "absolute", top: 60, right: 14, zIndex: 40, width: 340, borderRadius: 18, boxShadow: "0 16px 60px rgba(0,0,0,.4)", maxHeight: "calc(100vh - 80px)", overflow: "hidden", display: "flex", flexDirection: "column" },
  checkRow: { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none", fontSize: 12, color: T.sec, fontWeight: 500 },
  checkBox: { width: 15, height: 15, borderRadius: 4, border: "1.5px solid rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all .12s", color: "#0c1018", flexShrink: 0 },
  checkBoxOn: { background: T.accent, borderColor: T.accent },
  rrStatsPanel: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 },
  rrStatCard: { display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: `1px solid ${T.border}` },
};

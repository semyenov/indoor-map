import { lazy, Suspense, startTransition, useDeferredValue, useEffect, useState } from "react";
import { featureById, levels, routeTargets, routingGraph, searchEntries, statusRoomIds } from "./data/generated/office-data";
import { MockOccupancyProvider } from "./lib/occupancy";
import { computeShortestRoute, summarizeRoute } from "./lib/routing";
import { searchOffice } from "./lib/search";
import type { LevelId, RoomStatus, RoomStatuses, RouteLeg, RouteResult } from "./lib/types";

const LazyMapCanvas = lazy(() =>
  import("./components/MapCanvas").then((module) => ({ default: module.MapCanvas })),
);

const occupancyProvider = new MockOccupancyProvider();
const indexedFeatures = [...featureById.values()];
const spatialKinds = new Set(["room", "meeting_room", "amenity"]);
type LevelMetrics = {
  objects: number;
  spaces: number;
  workstations: number;
  targets: number;
};

const featureMetricsByLevel = levels.reduce<Record<LevelId, LevelMetrics>>((metricsByLevel, level) => {
  const levelFeatures = indexedFeatures.filter((feature) => feature.properties.level === level.id);

  metricsByLevel[level.id] = {
    objects: levelFeatures.length,
    spaces: levelFeatures.filter((feature) => spatialKinds.has(feature.properties.kind)).length,
    workstations: levelFeatures.filter((feature) => feature.properties.kind === "workstation").length,
    targets: routeTargets.filter((target) => target.level === level.id).length,
  };

  return metricsByLevel;
}, { L1: { objects: 0, spaces: 0, workstations: 0, targets: 0 }, L2: { objects: 0, spaces: 0, workstations: 0, targets: 0 } });

const roomStatusLabel: Record<string, string> = {
  available: "Available",
  occupied: "Occupied",
  focus: "Focus",
  offline: "Offline",
};

const featureStatus = (featureId: string | null, roomStatuses: RoomStatuses) => {
  if (!featureId) {
    return null;
  }

  const feature = featureById.get(featureId);

  if (!feature) {
    return null;
  }

  const status = roomStatuses[featureId] ?? feature.properties.status;
  return status ? roomStatusLabel[status] ?? status : null;
};

const featureLevel = (featureId: string | null): LevelId | null => {
  if (!featureId) {
    return null;
  }

  return featureById.get(featureId)?.properties.level ?? null;
};

const routeNodesForTarget = (targetId: string) => routeTargets.find((target) => target.id === targetId)?.routeNodeIds ?? [];

const routeNodeById = new Map(routingGraph.nodes.map((node) => [node.id, node]));

const routeLegDescription = (leg: RouteLeg) => {
  const fromNode = routeNodeById.get(leg.fromNodeId);
  const toNode = routeNodeById.get(leg.toNodeId);
  const fromName = fromNode?.featureRef ? featureById.get(fromNode.featureRef)?.properties.name : null;
  const toName = toNode?.featureRef ? featureById.get(toNode.featureRef)?.properties.name : null;

  if (leg.connectorType === "elevator") {
    return `Take the elevator from ${fromNode?.level ?? leg.level} to ${toNode?.level ?? leg.level}.`;
  }

  if (leg.connectorType === "stairs") {
    return `Take the stairs from ${fromNode?.level ?? leg.level} to ${toNode?.level ?? leg.level}.`;
  }

  if (toName) {
    return `Continue on ${leg.level} toward ${toName}.`;
  }

  if (fromName) {
    return `Leave ${fromName} and continue through the corridor on ${leg.level}.`;
  }

  return `Continue on ${leg.level} for about ${leg.distance.toFixed(0)} m.`;
};

const featureKindLabel = (kind: string) => kind.replace("_", " ");
const routeConnectorLabel = (connectorTypes: readonly ("stairs" | "elevator")[]) => {
  const uniqueConnectors = [...new Set(connectorTypes)];
  return uniqueConnectors.length > 0 ? uniqueConnectors.join(" + ") : "flat path";
};

const defaultRouteFromId =
  routeTargets.find((target) => target.featureId === "room-l1-lobby")?.id ??
  routeTargets[0]?.id ??
  "";

const defaultRouteToId =
  routeTargets.find((target) => target.featureId === "room-l2-cedar")?.id ??
  routeTargets[1]?.id ??
  defaultRouteFromId;

export default function App() {
  const [activeLevel, setActiveLevel] = useState<LevelId>("L1");
  const [activePanel, setActivePanel] = useState<"search" | "selection" | "route" | "ops">("search");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>("room-l1-lobby");
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [routeFromId, setRouteFromId] = useState(defaultRouteFromId);
  const [routeToId, setRouteToId] = useState(defaultRouteToId);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [roomStatuses, setRoomStatuses] = useState<RoomStatuses>({});
  const [occupancyUpdatedAt, setOccupancyUpdatedAt] = useState<Date | null>(null);
  const deferredQuery = useDeferredValue(searchQuery);
  const selectedFeature = selectedFeatureId ? featureById.get(selectedFeatureId) ?? null : null;
  const searchResults = searchOffice(searchEntries, deferredQuery);
  const selectedStatus = featureStatus(selectedFeatureId, roomStatuses);
  const routeSummaryText = routeError ?? summarizeRoute(route?.summary ?? null);
  const routeFromTarget = routeTargets.find((target) => target.id === routeFromId) ?? null;
  const routeToTarget = routeTargets.find((target) => target.id === routeToId) ?? null;
  const selectedRouteTarget = routeTargets.find((target) => target.featureId === selectedFeatureId) ?? null;
  const selectedRouteNodeId = selectedFeature?.properties.routeNodeId ?? selectedRouteTarget?.routeNodeId ?? "None";
  const selectedIndexHits = selectedFeatureId ? searchEntries.filter((entry) => entry.featureId === selectedFeatureId).length : 0;
  const selectedDetailTags = selectedFeature
    ? [
        selectedFeature.properties.employee ? `owner:${selectedFeature.properties.employee}` : null,
        ...(selectedFeature.properties.equipment ?? []).map((item) => `eq:${item}`),
      ].filter((tag): tag is string => Boolean(tag))
    : [];
  const roomStatusCounts = statusRoomIds.reduce<Record<RoomStatus, number>>(
    (counts, featureId) => {
      const feature = featureById.get(featureId);

      if (!feature) {
        return counts;
      }

      const status = roomStatuses[featureId] ?? feature.properties.status ?? "offline";
      counts[status] += 1;
      return counts;
    },
    {
      available: 0,
      occupied: 0,
      focus: 0,
      offline: 0,
    },
  );
  const activeLevelMetrics = featureMetricsByLevel[activeLevel];
  const syncLabel = occupancyUpdatedAt ? `Synced ${occupancyUpdatedAt.toLocaleTimeString()}` : "Syncing live room status";
  const workspaceTitle = selectedFeature?.properties.name ?? "Office workspace";
  const workspaceSubtitle = route
    ? routeSummaryText
    : selectedFeature?.properties.subtitle ?? `Current level ${activeLevel}`;
  const visibleStatusIds = statusRoomIds.slice(0, 3);

  useEffect(() => {
    let cancelled = false;

    const refreshStatuses = async () => {
      const statuses = await occupancyProvider.getRoomStatuses();

      if (cancelled) {
        return;
      }

      setRoomStatuses(statuses);
      setOccupancyUpdatedAt(new Date());
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

  const onSelectFeature = (featureId: string) => {
    const nextLevel = featureLevel(featureId);

    startTransition(() => {
      setActivePanel("selection");
      setSelectedFeatureId(featureId);
      setFocusRequestId((current) => current + 1);

      if (nextLevel) {
        setActiveLevel(nextLevel);
      }
    });
  };

  const buildRoute = () => {
    const fromNodeIds = routeNodesForTarget(routeFromId);
    const toNodeIds = routeNodesForTarget(routeToId);

    if (fromNodeIds.length === 0 || toNodeIds.length === 0) {
      setRouteError("Select both route endpoints.");
      setRoute(null);
      return;
    }

    const result = computeShortestRoute(routingGraph, fromNodeIds, toNodeIds, { accessibleOnly });

    if (!result) {
      setRouteError(accessibleOnly ? "No accessible route found for the selected points." : "No route found for the selected points.");
      setRoute(null);
      return;
    }

    setRouteError(null);
    setRoute(result);
    setActivePanel("route");

    const firstLevel = result.summary.levels[0];

    if (firstLevel) {
      setActiveLevel(firstLevel);
    }
  };

  const useSelectedAs = (mode: "from" | "to") => {
    if (!selectedFeatureId) {
      return;
    }

    const match = routeTargets.find((target) => target.featureId === selectedFeatureId);

    if (!match) {
      return;
    }

    if (mode === "from") {
      setRouteFromId(match.id);
      return;
    }

    setRouteToId(match.id);
  };

  const clearRoute = () => {
    setRoute(null);
    setRouteError(null);
  };

  return (
    <div className="app-shell">
      <main className="workspace workspace-console">
        <aside className="control-rail">
          <div className="rail-summary">
            <p className="eyebrow">Indoor Operations</p>
            <div className="rail-title-row">
              <div className="rail-title-copy">
                <strong className="rail-title">Office Atlas</strong>
                <span className="rail-subtitle">{workspaceTitle}</span>
              </div>
              <span className="workspace-code">{selectedFeatureId ?? "no-selection"}</span>
            </div>
            <p className="rail-summary-text">{workspaceSubtitle}</p>
            <div className="rail-badges">
              <span className="dock-badge">level {activeLevel}</span>
              <span className="dock-badge">{selectedFeature ? featureKindLabel(selectedFeature.properties.kind) : "idle"}</span>
              <span className="dock-badge">{route ? `${route.summary.distance.toFixed(0)} m` : "route idle"}</span>
              <span className="dock-badge">{syncLabel}</span>
            </div>
          </div>

          <div className="rail-panels">
            <div className="rail-tabs" role="tablist" aria-label="Workspace panels">
              <button className={activePanel === "search" ? "rail-tab rail-tab-active" : "rail-tab"} onClick={() => setActivePanel("search")} type="button">
                Search
              </button>
              <button className={activePanel === "selection" ? "rail-tab rail-tab-active" : "rail-tab"} onClick={() => setActivePanel("selection")} type="button">
                Selection
              </button>
              <button className={activePanel === "route" ? "rail-tab rail-tab-active" : "rail-tab"} onClick={() => setActivePanel("route")} type="button">
                Route
              </button>
              <button className={activePanel === "ops" ? "rail-tab rail-tab-active" : "rail-tab"} onClick={() => setActivePanel("ops")} type="button">
                Ops
              </button>
            </div>

            <div className="rail-panel-stage">
            {activePanel === "search" ? (
            <section className="panel panel-search panel-compact">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Index / Query</p>
                  <h2>Search</h2>
                </div>
                <span className="panel-meta">IDX {searchEntries.length}</span>
              </div>
              <input
                className="search-input"
                onChange={(event) => {
                  const value = event.target.value;
                  startTransition(() => setSearchQuery(value));
                }}
                placeholder="room, desk, or employee"
                type="search"
                value={searchQuery}
              />
              <div className="result-list result-list-compact">
                {searchResults.length === 0 && deferredQuery ? <p className="muted">No matches for this query.</p> : null}
                {!deferredQuery ? <p className="muted">Lookup across rooms, desks, amenities, and staff records.</p> : null}
                {searchResults.slice(0, 3).map((result) => (
                  <button className="result-card" key={result.id} onClick={() => onSelectFeature(result.featureId)} type="button">
                    <span className="result-topline">
                      <strong>{result.label}</strong>
                      <span className="result-level">{result.level}</span>
                    </span>
                    <span>{result.description}</span>
                  </button>
                ))}
              </div>
            </section>
            ) : null}

            {activePanel === "selection" ? (
            <section className="panel panel-selection panel-compact">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Object / Inspect</p>
                  <h2>Selection</h2>
                </div>
                <span className="panel-meta">{selectedFeature?.id ?? "Idle"}</span>
              </div>
              {selectedFeature ? (
                <div className="detail-card">
                  <div className="selection-hero">
                    <div className="selection-copy">
                      <p className="selection-kicker">
                        {featureKindLabel(selectedFeature.properties.kind)} / {selectedFeature.properties.level}
                      </p>
                      <strong>{selectedFeature.properties.name}</strong>
                      <span>{selectedFeature.properties.subtitle ?? "Spatial entity mounted in current workspace"}</span>
                    </div>
                    <span className={`status-pill status-${roomStatuses[selectedFeature.id] ?? selectedFeature.properties.status ?? "offline"}`}>
                      {selectedStatus ?? "Offline"}
                    </span>
                  </div>
                  <dl className="detail-grid detail-grid-compact">
                    <div>
                      <dt>Route Node</dt>
                      <dd>{selectedRouteNodeId}</dd>
                    </div>
                    <div>
                      <dt>Department</dt>
                      <dd>{selectedFeature.properties.department ?? "Shared"}</dd>
                    </div>
                    <div>
                      <dt>Capacity</dt>
                      <dd>{selectedFeature.properties.capacity ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Indexed</dt>
                      <dd>{selectedIndexHits || "0"}</dd>
                    </div>
                  </dl>
                  {selectedDetailTags.length > 0 ? (
                    <div className="detail-tags">
                      {selectedDetailTags.slice(0, 3).map((tag) => (
                        <span className="detail-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="detail-actions">
                    <button onClick={() => useSelectedAs("from")} type="button">
                      Use as start
                    </button>
                    <button onClick={() => useSelectedAs("to")} type="button">
                      Use as destination
                    </button>
                  </div>
                </div>
              ) : (
                <p className="muted">Select a room or desk on the map to inspect details and route actions.</p>
              )}
            </section>
            ) : null}

            {activePanel === "route" ? (
            <section className="panel panel-route panel-compact">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Path / Graph</p>
                  <h2>Route</h2>
                </div>
                <span className="panel-meta">{accessibleOnly ? "A11Y" : "STD"}</span>
              </div>
              <div className="route-shell">
                <div className="drawer-form-grid">
                  <label className="field">
                    <span>From</span>
                    <select onChange={(event) => setRouteFromId(event.target.value)} value={routeFromId}>
                      {routeTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label} · {target.level}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>To</span>
                    <select onChange={(event) => setRouteToId(event.target.value)} value={routeToId}>
                      {routeTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label} · {target.level}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="toggle-row">
                  <input
                    checked={accessibleOnly}
                    onChange={(event) => setAccessibleOnly(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Accessible route only</span>
                </label>
                <div className="button-row">
                  <button className="primary-button" onClick={buildRoute} type="button">
                    Build route
                  </button>
                  <button className="secondary-button" onClick={clearRoute} type="button">
                    Clear route
                  </button>
                </div>
                <p className={routeError ? "route-summary route-summary-error" : "route-summary"}>{routeSummaryText}</p>
                <div className="micro-grid">
                  <div className="micro-stat">
                    <span>nodes</span>
                    <strong>{route?.nodeIds.length ?? 0}</strong>
                  </div>
                  <div className="micro-stat">
                    <span>legs</span>
                    <strong>{route?.legs.length ?? 0}</strong>
                  </div>
                  <div className="micro-stat">
                    <span>levels</span>
                    <strong>{route?.summary.levels.length ?? 0}</strong>
                  </div>
                  <div className="micro-stat">
                    <span>connectors</span>
                    <strong>{route ? routeConnectorLabel(route.summary.connectorTypes) : "idle"}</strong>
                  </div>
                </div>
              </div>
            </section>
            ) : null}

            {activePanel === "ops" ? (
            <section className="panel panel-dock panel-compact">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Live / Floors</p>
                  <h2>Ops</h2>
                </div>
                <span className="panel-meta">{roomStatusCounts.occupied}/{statusRoomIds.length} occupied</span>
              </div>
              <div className="chips chips-segmented">
                {levels.map((level) => (
                  <button
                    className={level.id === activeLevel ? "chip chip-active" : "chip"}
                    key={level.id}
                    onClick={() => setActiveLevel(level.id)}
                    type="button"
                  >
                    {level.label}
                  </button>
                ))}
              </div>
              <div className="micro-grid">
                <div className="micro-stat">
                  <span>objects</span>
                  <strong>{activeLevelMetrics.objects}</strong>
                </div>
                <div className="micro-stat">
                  <span>spaces</span>
                  <strong>{activeLevelMetrics.spaces}</strong>
                </div>
                <div className="micro-stat">
                  <span>available</span>
                  <strong>{roomStatusCounts.available}</strong>
                </div>
                <div className="micro-stat">
                  <span>occupied</span>
                  <strong>{roomStatusCounts.occupied}</strong>
                </div>
              </div>
              <div className="status-list status-list-compact">
                {visibleStatusIds.map((featureId) => {
                  const feature = featureById.get(featureId);

                  if (!feature) {
                    return null;
                  }

                  return (
                    <div className="status-row" key={featureId}>
                      <div>
                        <strong>{feature.properties.name}</strong>
                        <span>{feature.properties.level}</span>
                      </div>
                      <span className={`status-pill status-${roomStatuses[featureId] ?? feature.properties.status ?? "offline"}`}>
                        {featureStatus(featureId, roomStatuses) ?? "Offline"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
            ) : null}
            </div>
          </div>
        </aside>

        <section className="map-stage">
          <section className="map-pane">
            <Suspense fallback={<div className="map-loading">Loading map renderer...</div>}>
              <LazyMapCanvas
                activeLevel={activeLevel}
                focusRequestId={focusRequestId}
                onSelectFeature={onSelectFeature}
                route={route}
                selectedFeatureId={selectedFeatureId}
              />
            </Suspense>
          </section>
        </section>
      </main>
    </div>
  );
}

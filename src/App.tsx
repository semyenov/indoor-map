import { lazy, Suspense, startTransition, useDeferredValue, useEffect, useState } from "react";
import { featureById, levels, routeTargets, routingGraph, searchEntries, statusRoomIds } from "./data/generated/office-data";
import { MockOccupancyProvider } from "./lib/occupancy";
import { computeRoute, summarizeRoute } from "./lib/routing";
import { searchOffice } from "./lib/search";
import type { LevelId, RoomStatuses, RouteLeg, RouteResult } from "./lib/types";

const LazyMapCanvas = lazy(() =>
  import("./components/MapCanvas").then((module) => ({ default: module.MapCanvas })),
);

const occupancyProvider = new MockOccupancyProvider();

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

const routeNodeForTarget = (targetId: string) => routeTargets.find((target) => target.id === targetId)?.routeNodeId ?? null;

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

export default function App() {
  const [activeLevel, setActiveLevel] = useState<LevelId>("L1");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>("room-l1-lobby");
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [routeFromId, setRouteFromId] = useState("target-lobby");
  const [routeToId, setRouteToId] = useState("target-cedar");
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
  const searchSummary = deferredQuery
    ? `${searchResults.length} match${searchResults.length === 1 ? "" : "es"}`
    : "Search rooms, desks, and employees";
  const syncLabel = occupancyUpdatedAt ? `Synced ${occupancyUpdatedAt.toLocaleTimeString()}` : "Syncing live room status";
  const workspaceTitle = selectedFeature?.properties.name ?? "Office workspace";
  const workspaceSubtitle = route
    ? routeSummaryText
    : selectedFeature?.properties.subtitle ?? `Current level ${activeLevel}`;

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
      setSelectedFeatureId(featureId);
      setFocusRequestId((current) => current + 1);

      if (nextLevel) {
        setActiveLevel(nextLevel);
      }
    });
  };

  const buildRoute = () => {
    const fromNodeId = routeNodeForTarget(routeFromId);
    const toNodeId = routeNodeForTarget(routeToId);

    if (!fromNodeId || !toNodeId) {
      setRouteError("Select both route endpoints.");
      setRoute(null);
      return;
    }

    const result = computeRoute(routingGraph, fromNodeId, toNodeId, { accessibleOnly });

    if (!result) {
      setRouteError(accessibleOnly ? "No accessible route found for the selected points." : "No route found for the selected points.");
      setRoute(null);
      return;
    }

    setRouteError(null);
    setRoute(result);

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
      <aside className="control-rail">
        <header className="rail-header">
          <div className="rail-brand">
            <p className="eyebrow">Indoor Operations Map</p>
            <div className="brand-row">
              <h1>Office Atlas</h1>
              <span className="console-badge">Ops Console</span>
            </div>
            <p className="lead">Search, inspect, and route through the office in one operational workspace.</p>
          </div>
          <div className="sync-pill">
            <span className="sync-dot" />
            <span>{syncLabel}</span>
          </div>
        </header>

        <section className="panel panel-search">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Primary Workflow</p>
              <h2>Search</h2>
            </div>
            <span className="panel-meta">{searchSummary}</span>
          </div>
          <input
            className="search-input"
            onChange={(event) => {
              const value = event.target.value;
              startTransition(() => setSearchQuery(value));
            }}
            placeholder="Find a room, desk, or employee"
            type="search"
            value={searchQuery}
          />
          <div className="result-list">
            {searchResults.length === 0 && deferredQuery ? <p className="muted">No matches for this query.</p> : null}
            {!deferredQuery ? <p className="muted">Start typing to jump straight to a room, workstation, or team member.</p> : null}
            {searchResults.map((result) => (
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

        <section className="panel panel-selection">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Active Object</p>
              <h2>Selection</h2>
            </div>
            <span className="panel-meta">{selectedFeature?.properties.level ?? "No selection"}</span>
          </div>
          {selectedFeature ? (
            <div className="detail-card">
              <div className="selection-hero">
                <div className="selection-copy">
                  <p className="selection-kicker">{featureKindLabel(selectedFeature.properties.kind)}</p>
                  <strong>{selectedFeature.properties.name}</strong>
                  <span>{selectedFeature.properties.subtitle ?? "Map object"}</span>
                </div>
                <span className={`status-pill status-${roomStatuses[selectedFeature.id] ?? selectedFeature.properties.status ?? "offline"}`}>
                  {selectedStatus ?? "Offline"}
                </span>
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>Floor</dt>
                  <dd>{selectedFeature.properties.level}</dd>
                </div>
                <div>
                  <dt>Department</dt>
                  <dd>{selectedFeature.properties.department ?? "Shared"}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{featureKindLabel(selectedFeature.properties.kind)}</dd>
                </div>
                <div>
                  <dt>Capacity</dt>
                  <dd>{selectedFeature.properties.capacity ?? "N/A"}</dd>
                </div>
              </dl>
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

        <section className="panel panel-floors">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Navigation</p>
              <h2>Floors</h2>
            </div>
            <span className="panel-meta">Current {activeLevel}</span>
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
        </section>

        <section className="panel panel-route">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Wayfinding</p>
              <h2>Route Builder</h2>
            </div>
            <span className="panel-meta">{route ? "Active route" : "Standby"}</span>
          </div>
          <div className="route-shell">
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
            {route ? (
              <>
                <div className="chips route-levels">
                  {route.summary.levels.map((level) => (
                    <button
                      className={level === activeLevel ? "chip chip-active" : "chip"}
                      key={level}
                      onClick={() => setActiveLevel(level)}
                      type="button"
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <div className="route-steps">
                  {route.legs.map((leg) => (
                    <div className="route-step" key={leg.id}>
                      <strong>{leg.connectorType ? "Transition" : leg.level}</strong>
                      <span>{routeLegDescription(leg)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>

        <section className="panel panel-status">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Live Monitoring</p>
              <h2>Meeting Room Status</h2>
            </div>
            <span className="panel-meta">{occupancyUpdatedAt ? occupancyUpdatedAt.toLocaleTimeString() : "Syncing..."}</span>
          </div>
          <div className="status-list">
            {statusRoomIds.map((featureId) => {
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
      </aside>

      <main className="workspace">
        <section className="workspace-header">
          <div className="workspace-copy">
            <p className="workspace-kicker">Map Workspace</p>
            <h2>{workspaceTitle}</h2>
            <p>{workspaceSubtitle}</p>
          </div>
          <div className="workspace-stats">
            <div className="workspace-stat">
              <span className="workspace-stat-label">Active floor</span>
              <strong className="workspace-stat-value">{activeLevel}</strong>
            </div>
            <div className="workspace-stat">
              <span className="workspace-stat-label">Selection</span>
              <strong className="workspace-stat-value">{selectedFeature ? featureKindLabel(selectedFeature.properties.kind) : "None"}</strong>
            </div>
            <div className="workspace-stat">
              <span className="workspace-stat-label">Route</span>
              <strong className="workspace-stat-value">{route ? `${route.summary.distance.toFixed(0)} m` : "Idle"}</strong>
            </div>
          </div>
        </section>

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
      </main>
    </div>
  );
}

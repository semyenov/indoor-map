import { useState, useEffect, useRef } from "react";

// ─── Mock data ────────────────────────────────────────────────
const ROUTE_TARGETS = [
  { id: "t1", label: "Lobby", level: "L1", featureId: "room-l1-lobby" },
  { id: "t2", label: "Engineering South", level: "L1", featureId: "room-l1-eng-south" },
  { id: "t3", label: "Summit Room", level: "L2", featureId: "room-l2-summit" },
  { id: "t4", label: "Cedar Room", level: "L2", featureId: "room-l2-cedar" },
  { id: "t5", label: "Kitchen", level: "L1", featureId: "room-l1-kitchen" },
  { id: "t6", label: "Huddle 1", level: "L1", featureId: "room-l1-huddle1" },
];

const SEARCH_RESULTS = [
  { id: "s1", label: "Engineering South", level: "L1", description: "Open workspace · 24 seats", kind: "room" },
  { id: "s2", label: "Alex Petrov", level: "L1", description: "Desk WS-14 · Engineering South", kind: "workstation" },
  { id: "s3", label: "Summit Room", level: "L2", description: "Meeting room · 12 seats · Display, Whiteboard", kind: "meeting_room" },
];

const STATUS_ROOMS = [
  { id: "r1", name: "Summit Room", level: "L2", status: "occupied", capacity: 12 },
  { id: "r2", name: "Cedar Room", level: "L2", status: "available", capacity: 8 },
  { id: "r3", name: "Huddle 1", level: "L1", status: "focus", capacity: 4 },
  { id: "r4", name: "Phone Booth A", level: "L1", status: "available", capacity: 1 },
  { id: "r5", name: "Wellness Room", level: "L1", status: "offline", capacity: 6 },
  { id: "r6", name: "Operations Bay", level: "L1", status: "occupied", capacity: 16 },
];

const SELECTED_FEATURE = {
  id: "room-l1-eng-south",
  name: "Engineering South",
  kind: "room",
  level: "L1",
  subtitle: "Open plan workspace for the engineering department",
  department: "Engineering",
  capacity: 24,
  status: "occupied",
  employee: null,
  equipment: ["Displays", "Whiteboard", "Video conf"],
  routeNodeId: "rn-eng-south-01",
};

// ─── Icons (inline SVG) ────────────────────────────────────────
const Icons = {
  Search: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.5"/><path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
  ),
  Selection: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
  ),
  Route: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L7 3L10 9L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Ops: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="8" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.5"/><rect x="6.5" y="4" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.7"/><rect x="11" y="2" width="3" height="12" rx="0.5" fill="currentColor"/></svg>
  ),
  ArrowRight: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Swap: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5H11M11 5L9 3M11 5L9 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 9H3M3 9L5 7M3 9L5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Focus: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 1V3M7 11V13M1 7H3M11 7H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
  ),
  Pin: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M6 7.5V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
  ),
  Elevator: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1"/><path d="M4 7L6 4L8 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Check: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  ChevronDown: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  Plan: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.3"/><line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1"/><line x1="7" y1="7" x2="7" y2="13" stroke="currentColor" strokeWidth="1"/></svg>
  ),
  Explore: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 5.5L7 9L10.5 10.5L9 7L5.5 5.5Z" fill="currentColor" opacity="0.6"/></svg>
  ),
  Theatre: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 6C2 6 5 2 8 2C11 2 14 6 14 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M2 6C2 6 5 10 8 10C11 10 14 6 14 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="8" cy="6" r="2" fill="currentColor" opacity="0.6"/></svg>
  ),
  RotateLeft: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2L2 4L4 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 4H8C10.2 4 12 5.8 12 8C12 10.2 10.2 12 8 12H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
  ),
  RotateRight: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L10 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 4H6C3.8 4 2 5.8 2 8C2 10.2 3.8 12 6 12H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
  ),
  Orbit: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><ellipse cx="7" cy="7" rx="6" ry="3" stroke="currentColor" strokeWidth="1.2" transform="rotate(-30 7 7)"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>
  ),
};


// ─── Status helpers ───────────────────────────────────────────
const statusConfig = {
  available: { color: "#34d399", bg: "rgba(52,211,153,0.12)", label: "Available" },
  occupied:  { color: "#f87171", bg: "rgba(248,113,113,0.12)", label: "Occupied" },
  focus:     { color: "#fbbf24", bg: "rgba(251,191,36,0.12)", label: "Focus" },
  offline:   { color: "#6b7280", bg: "rgba(107,114,128,0.12)", label: "Offline" },
};


export default function OfficeAtlasRedesign() {
  const [activePanel, setActivePanel] = useState("route");
  const [activeLevel, setActiveLevel] = useState("L1");
  const [searchQuery, setSearchQuery] = useState("");
  const [routeFrom, setRouteFrom] = useState("t1");
  const [routeTo, setRouteTo] = useState("t4");
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [routeBuilt, setRouteBuilt] = useState(true);
  const [selectedFeature, setSelectedFeature] = useState(SELECTED_FEATURE);
  const [sceneMode, setSceneMode] = useState("explore");
  const [controlsOpen, setControlsOpen] = useState(true);
  const [pitch, setPitch] = useState(58);
  const [bearing, setBearing] = useState(342);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const panels = [
    { id: "search", label: "Search", icon: Icons.Search },
    { id: "selection", label: "Selection", icon: Icons.Selection },
    { id: "route", label: "Route", icon: Icons.Route },
    { id: "ops", label: "Ops", icon: Icons.Ops },
  ];

  const filteredResults = searchQuery
    ? SEARCH_RESULTS.filter(r => r.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : SEARCH_RESULTS;

  const filteredRooms = STATUS_ROOMS.filter(r => r.level === activeLevel);
  const occupied = STATUS_ROOMS.filter(r => r.status === "occupied").length;

  return (
    <div style={styles.shell}>
      <style>{globalCSS}</style>

      {/* ═══ LEFT SIDEBAR ═══ */}
      <aside style={styles.sidebar}>
        {/* Header */}
        <div style={styles.sidebarHeader}>
          <div style={styles.logoRow}>
            <div style={styles.logoMark}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="1" width="7" height="7" rx="2" fill="#60a5fa"/>
                <rect x="10" y="1" width="7" height="7" rx="2" fill="#60a5fa" opacity="0.5"/>
                <rect x="1" y="10" width="7" height="7" rx="2" fill="#60a5fa" opacity="0.3"/>
                <rect x="10" y="10" width="7" height="7" rx="2" fill="#60a5fa" opacity="0.7"/>
              </svg>
            </div>
            <div>
              <div style={styles.logoTitle}>Office Atlas</div>
              <div style={styles.logoSub}>Indoor Operations</div>
            </div>
          </div>
          <div style={styles.headerMeta}>
            <span style={styles.headerBadge}>{activeLevel}</span>
            <span style={styles.headerBadge}>{selectedFeature ? selectedFeature.kind.replace("_", " ") : "idle"}</span>
            <span style={{...styles.headerBadge, ...styles.headerBadgeAccent}}>
              <span style={styles.liveDot} />
              Synced {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <nav style={styles.tabs}>
          {panels.map(p => (
            <button
              key={p.id}
              onClick={() => setActivePanel(p.id)}
              style={{
                ...styles.tab,
                ...(activePanel === p.id ? styles.tabActive : {}),
              }}
            >
              <p.icon />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        {/* Panel content */}
        <div style={styles.panelScroll}>
          {/* ─── SEARCH ─── */}
          {activePanel === "search" && (
            <div style={styles.panelContent}>
              <div style={styles.searchBox}>
                <Icons.Search />
                <input
                  style={styles.searchInput}
                  placeholder="Room, desk, or employee…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button style={styles.searchClear} onClick={() => setSearchQuery("")}>×</button>
                )}
              </div>
              <div style={styles.resultCount}>
                {searchQuery ? `${filteredResults.length} results` : `${SEARCH_RESULTS.length} indexed entries`}
              </div>
              <div style={styles.resultList}>
                {filteredResults.map(r => (
                  <button key={r.id} style={styles.resultCard} onClick={() => {
                    setSelectedFeature({ ...SELECTED_FEATURE, name: r.label, kind: r.kind });
                    setActivePanel("selection");
                  }}>
                    <div style={styles.resultTop}>
                      <span style={styles.resultName}>{r.label}</span>
                      <span style={styles.resultLevel}>{r.level}</span>
                    </div>
                    <span style={styles.resultDesc}>{r.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── SELECTION ─── */}
          {activePanel === "selection" && (
            <div style={styles.panelContent}>
              {selectedFeature ? (
                <>
                  <div style={styles.selectionHero}>
                    <div style={styles.selectionNameRow}>
                      <div>
                        <div style={styles.selectionKicker}>
                          {selectedFeature.kind.replace("_", " ")} · {selectedFeature.level}
                        </div>
                        <div style={styles.selectionName}>{selectedFeature.name}</div>
                      </div>
                      <span style={{
                        ...styles.statusPill,
                        color: statusConfig[selectedFeature.status]?.color,
                        background: statusConfig[selectedFeature.status]?.bg,
                      }}>
                        {statusConfig[selectedFeature.status]?.label}
                      </span>
                    </div>
                    <div style={styles.selectionSub}>{selectedFeature.subtitle}</div>
                  </div>

                  <div style={styles.detailGrid}>
                    <div style={styles.detailCell}>
                      <span style={styles.detailLabel}>Department</span>
                      <span style={styles.detailValue}>{selectedFeature.department}</span>
                    </div>
                    <div style={styles.detailCell}>
                      <span style={styles.detailLabel}>Capacity</span>
                      <span style={styles.detailValue}>{selectedFeature.capacity}</span>
                    </div>
                    <div style={styles.detailCell}>
                      <span style={styles.detailLabel}>Route Node</span>
                      <span style={styles.detailValue}>{selectedFeature.routeNodeId}</span>
                    </div>
                    <div style={styles.detailCell}>
                      <span style={styles.detailLabel}>Feature ID</span>
                      <span style={{...styles.detailValue, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{selectedFeature.id}</span>
                    </div>
                  </div>

                  {selectedFeature.equipment && (
                    <div style={styles.tagRow}>
                      {selectedFeature.equipment.map(eq => (
                        <span key={eq} style={styles.tag}>{eq}</span>
                      ))}
                    </div>
                  )}

                  <div style={styles.actionRow}>
                    <button style={styles.btnSecondary} onClick={() => { setRouteFrom("t2"); setActivePanel("route"); }}>
                      <Icons.Pin /> Use as start
                    </button>
                    <button style={styles.btnSecondary} onClick={() => { setRouteTo("t2"); setActivePanel("route"); }}>
                      <Icons.Pin /> Use as end
                    </button>
                  </div>
                </>
              ) : (
                <div style={styles.emptyState}>
                  <Icons.Selection />
                  <p>Select a room or desk on the map to inspect details.</p>
                </div>
              )}
            </div>
          )}

          {/* ─── ROUTE ─── */}
          {activePanel === "route" && (
            <div style={styles.panelContent}>
              <div style={styles.routeEndpoints}>
                <div style={styles.routeField}>
                  <label style={styles.routeLabel}>From</label>
                  <div style={styles.selectWrap}>
                    <select style={styles.select} value={routeFrom} onChange={e => setRouteFrom(e.target.value)}>
                      {ROUTE_TARGETS.map(t => <option key={t.id} value={t.id}>{t.label} · {t.level}</option>)}
                    </select>
                    <Icons.ChevronDown />
                  </div>
                </div>
                <button style={styles.swapBtn} onClick={() => { const tmp = routeFrom; setRouteFrom(routeTo); setRouteTo(tmp); }}>
                  <Icons.Swap />
                </button>
                <div style={styles.routeField}>
                  <label style={styles.routeLabel}>To</label>
                  <div style={styles.selectWrap}>
                    <select style={styles.select} value={routeTo} onChange={e => setRouteTo(e.target.value)}>
                      {ROUTE_TARGETS.map(t => <option key={t.id} value={t.id}>{t.label} · {t.level}</option>)}
                    </select>
                    <Icons.ChevronDown />
                  </div>
                </div>
              </div>

              <label style={styles.checkboxRow}>
                <div style={{
                  ...styles.checkbox,
                  ...(accessibleOnly ? styles.checkboxChecked : {}),
                }} onClick={() => setAccessibleOnly(!accessibleOnly)}>
                  {accessibleOnly && <Icons.Check />}
                </div>
                <span style={styles.checkboxLabel}>Accessible route only</span>
              </label>

              <div style={styles.routeActions}>
                <button style={styles.btnPrimary} onClick={() => setRouteBuilt(true)}>
                  Build route
                </button>
                <button style={styles.btnGhost} onClick={() => setRouteBuilt(false)}>
                  Clear
                </button>
              </div>

              {routeBuilt && (
                <>
                  <div style={styles.routeSummary}>
                    <Icons.Route />
                    <span>118 m · L1 → L2 · elevator</span>
                  </div>
                  <div style={styles.statsGrid}>
                    <div style={styles.statCell}>
                      <span style={styles.statValue}>26</span>
                      <span style={styles.statLabel}>Nodes</span>
                    </div>
                    <div style={styles.statCell}>
                      <span style={styles.statValue}>25</span>
                      <span style={styles.statLabel}>Legs</span>
                    </div>
                    <div style={styles.statCell}>
                      <span style={styles.statValue}>2</span>
                      <span style={styles.statLabel}>Levels</span>
                    </div>
                    <div style={styles.statCell}>
                      <span style={styles.statValue}>
                        <Icons.Elevator />
                      </span>
                      <span style={styles.statLabel}>Connector</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── OPS ─── */}
          {activePanel === "ops" && (
            <div style={styles.panelContent}>
              <div style={styles.opsHeader}>
                <span style={styles.opsOccupancy}>{occupied}/{STATUS_ROOMS.length} occupied</span>
              </div>

              <div style={styles.levelTabs}>
                {["L1", "L2"].map(lvl => (
                  <button
                    key={lvl}
                    onClick={() => setActiveLevel(lvl)}
                    style={{
                      ...styles.levelTab,
                      ...(activeLevel === lvl ? styles.levelTabActive : {}),
                    }}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              <div style={styles.statsGrid}>
                <div style={styles.statCell}>
                  <span style={styles.statValue}>{STATUS_ROOMS.filter(r => r.level === activeLevel).length}</span>
                  <span style={styles.statLabel}>Spaces</span>
                </div>
                <div style={styles.statCell}>
                  <span style={{...styles.statValue, color: "#34d399"}}>{STATUS_ROOMS.filter(r => r.level === activeLevel && r.status === "available").length}</span>
                  <span style={styles.statLabel}>Available</span>
                </div>
                <div style={styles.statCell}>
                  <span style={{...styles.statValue, color: "#f87171"}}>{STATUS_ROOMS.filter(r => r.level === activeLevel && r.status === "occupied").length}</span>
                  <span style={styles.statLabel}>Occupied</span>
                </div>
                <div style={styles.statCell}>
                  <span style={{...styles.statValue, color: "#fbbf24"}}>{STATUS_ROOMS.filter(r => r.level === activeLevel && r.status === "focus").length}</span>
                  <span style={styles.statLabel}>Focus</span>
                </div>
              </div>

              <div style={styles.statusList}>
                {filteredRooms.map(room => (
                  <div key={room.id} style={styles.statusRow}>
                    <div style={styles.statusRowLeft}>
                      <span style={styles.statusRoomName}>{room.name}</span>
                      <span style={styles.statusRoomMeta}>{room.capacity} seats</span>
                    </div>
                    <span style={{
                      ...styles.statusPill,
                      color: statusConfig[room.status]?.color,
                      background: statusConfig[room.status]?.bg,
                    }}>
                      {statusConfig[room.status]?.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ═══ MAP AREA (placeholder) ═══ */}
      <main style={styles.mapArea}>
        <div style={styles.mapPlaceholder}>
          <div style={styles.mapGrid}>
            {/* Simplified floor plan placeholder */}
            <svg width="100%" height="100%" viewBox="0 0 800 500" fill="none" style={{ opacity: 0.12 }}>
              <rect x="40" y="40" width="720" height="420" rx="4" stroke="currentColor" strokeWidth="1"/>
              <rect x="40" y="240" width="200" height="220" rx="2" stroke="currentColor" strokeWidth="1"/>
              <rect x="280" y="240" width="140" height="220" rx="2" stroke="currentColor" strokeWidth="1"/>
              <rect x="460" y="240" width="140" height="220" rx="2" stroke="currentColor" strokeWidth="1"/>
              <rect x="640" y="240" width="120" height="220" rx="2" stroke="currentColor" strokeWidth="1"/>
              <rect x="40" y="40" width="360" height="180" rx="2" stroke="currentColor" strokeWidth="1"/>
              <rect x="440" y="40" width="180" height="180" rx="2" stroke="currentColor" strokeWidth="1"/>
              <rect x="660" y="40" width="100" height="180" rx="2" stroke="currentColor" strokeWidth="1"/>
              <text x="400" y="270" textAnchor="middle" fill="currentColor" fontSize="14" fontFamily="sans-serif">Map renders here</text>
            </svg>
          </div>

          {/* ═══ MAP TOOLBAR (floating) ═══ */}
          <div style={styles.toolbar}>
            <div style={styles.toolbarHeader}>
              <div style={styles.toolbarTitle}>
                <span style={styles.toolbarKicker}>View Control</span>
                <strong>Scene Deck</strong>
              </div>
              <div style={styles.toolbarHeaderRight}>
                <span style={styles.toolbarBadge}>{activeLevel}</span>
                <button
                  style={styles.toolbarToggle}
                  onClick={() => setControlsOpen(!controlsOpen)}
                >
                  {controlsOpen ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {controlsOpen && (
              <div style={styles.toolbarBody}>
                {/* Scene presets */}
                <div style={styles.toolbarSection}>
                  <span style={styles.toolbarSectionLabel}>Scene Preset</span>
                  <div style={styles.toolbarBtnGroup}>
                    {[
                      { id: "plan", icon: Icons.Plan, label: "Plan" },
                      { id: "explore", icon: Icons.Explore, label: "Explore" },
                      { id: "theatre", icon: Icons.Theatre, label: "Theatre" },
                    ].map(mode => (
                      <button
                        key={mode.id}
                        style={{
                          ...styles.toolbarBtn,
                          ...(sceneMode === mode.id ? styles.toolbarBtnActive : {}),
                        }}
                        onClick={() => setSceneMode(mode.id)}
                      >
                        <mode.icon />
                        <span>{mode.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation */}
                <div style={styles.toolbarSection}>
                  <span style={styles.toolbarSectionLabel}>Orientation</span>
                  <div style={styles.readoutRow}>
                    <div style={styles.readout}>
                      <span style={styles.readoutLabel}>Bearing</span>
                      <span style={styles.readoutValue}>{bearing}°</span>
                    </div>
                    <div style={styles.readout}>
                      <span style={styles.readoutLabel}>Tilt</span>
                      <span style={styles.readoutValue}>{pitch}°</span>
                    </div>
                  </div>
                  <div style={styles.toolbarBtnGroup}>
                    <button style={styles.toolbarBtn} onClick={() => setBearing(b => b - 20)}>
                      <Icons.RotateLeft /> <span>−20°</span>
                    </button>
                    <button style={styles.toolbarBtn} onClick={() => setBearing(b => b + 20)}>
                      <Icons.RotateRight /> <span>+20°</span>
                    </button>
                    <button style={styles.toolbarBtn}>
                      <Icons.Orbit /> <span>Orbit</span>
                    </button>
                  </div>
                </div>

                {/* Tilt slider */}
                <div style={styles.toolbarSection}>
                  <span style={styles.toolbarSectionLabel}>Camera Tilt</span>
                  <input
                    type="range"
                    min="0"
                    max="75"
                    value={pitch}
                    onChange={e => setPitch(Number(e.target.value))}
                    style={styles.slider}
                  />
                </div>

                {/* Selection focus */}
                {selectedFeature && (
                  <div style={styles.toolbarFocus}>
                    <div>
                      <span style={styles.toolbarFocusLabel}>Selection</span>
                      <strong style={styles.toolbarFocusName}>{selectedFeature.name}</strong>
                    </div>
                    <button style={styles.focusBtn}>
                      <Icons.Focus /> Focus
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Zoom controls */}
          <div style={styles.zoomControls}>
            <button style={styles.zoomBtn}>+</button>
            <button style={styles.zoomBtn}>−</button>
          </div>
        </div>
      </main>
    </div>
  );
}


// ─── STYLES ───────────────────────────────────────────────────

const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: #60a5fa;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid #1a1f2e;
  }

  select {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }

  ::placeholder {
    color: rgba(255,255,255,0.3);
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

const surface = {
  bg: "#0f1219",
  card: "#161b27",
  cardHover: "#1c2233",
  border: "rgba(255,255,255,0.06)",
  borderLight: "rgba(255,255,255,0.1)",
};

const text = {
  primary: "#e8eaed",
  secondary: "rgba(255,255,255,0.5)",
  muted: "rgba(255,255,255,0.3)",
  accent: "#60a5fa",
};

const font = "'DM Sans', -apple-system, sans-serif";
const mono = "'JetBrains Mono', monospace";

const styles = {
  shell: {
    display: "flex",
    height: "100vh",
    width: "100%",
    background: surface.bg,
    fontFamily: font,
    color: text.primary,
    fontSize: 13,
    overflow: "hidden",
  },

  // ─── Sidebar ───
  sidebar: {
    width: 320,
    minWidth: 320,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: surface.card,
    borderRight: `1px solid ${surface.border}`,
    zIndex: 10,
  },
  sidebarHeader: {
    padding: "20px 20px 16px",
    borderBottom: `1px solid ${surface.border}`,
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  logoMark: {
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(96,165,250,0.08)",
    borderRadius: 8,
  },
  logoTitle: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: text.primary,
  },
  logoSub: {
    fontSize: 11,
    color: text.muted,
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  headerMeta: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  headerBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 8px",
    fontSize: 10,
    fontWeight: 500,
    color: text.secondary,
    background: "rgba(255,255,255,0.04)",
    borderRadius: 4,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  headerBadgeAccent: {
    color: "#34d399",
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#34d399",
    animation: "pulse 2s ease infinite",
  },

  // ─── Tabs ───
  tabs: {
    display: "flex",
    padding: "0 8px",
    borderBottom: `1px solid ${surface.border}`,
  },
  tab: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "12px 0 10px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: text.muted,
    fontSize: 10,
    fontWeight: 500,
    fontFamily: font,
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  tabActive: {
    color: text.accent,
    borderBottomColor: text.accent,
  },

  // ─── Panel scroll area ───
  panelScroll: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
  },
  panelContent: {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    animation: "fadeIn 0.2s ease",
  },

  // ─── Search ───
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 12px",
    height: 40,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${surface.border}`,
    borderRadius: 8,
    color: text.secondary,
    transition: "border-color 0.15s",
  },
  searchInput: {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: text.primary,
    fontSize: 13,
    fontFamily: font,
  },
  searchClear: {
    background: "none",
    border: "none",
    color: text.muted,
    cursor: "pointer",
    fontSize: 16,
    padding: "0 2px",
    fontFamily: font,
  },
  resultCount: {
    fontSize: 11,
    color: text.muted,
    fontWeight: 500,
  },
  resultList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  resultCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
    border: `1px solid ${surface.border}`,
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.12s, border-color 0.12s",
    textAlign: "left",
    fontFamily: font,
    color: text.primary,
  },
  resultTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultName: {
    fontWeight: 600,
    fontSize: 13,
  },
  resultLevel: {
    fontSize: 10,
    fontWeight: 600,
    fontFamily: mono,
    color: text.accent,
    background: "rgba(96,165,250,0.1)",
    padding: "2px 6px",
    borderRadius: 3,
  },
  resultDesc: {
    fontSize: 12,
    color: text.secondary,
    lineHeight: 1.4,
  },

  // ─── Selection ───
  selectionHero: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 14px 16px",
    background: `linear-gradient(135deg, rgba(96,165,250,0.06) 0%, rgba(96,165,250,0.02) 100%)`,
    border: `1px solid rgba(96,165,250,0.12)`,
    borderRadius: 10,
  },
  selectionNameRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  selectionKicker: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: text.accent,
    fontWeight: 600,
    marginBottom: 4,
  },
  selectionName: {
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  selectionSub: {
    fontSize: 12,
    color: text.secondary,
    lineHeight: 1.4,
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 20,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  detailCell: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
  },
  detailLabel: {
    fontSize: 10,
    color: text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 500,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: 600,
    color: text.primary,
  },
  tagRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  tag: {
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 500,
    color: text.secondary,
    background: "rgba(255,255,255,0.04)",
    borderRadius: 4,
    border: `1px solid ${surface.border}`,
  },
  actionRow: {
    display: "flex",
    gap: 8,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "40px 20px",
    color: text.muted,
    textAlign: "center",
    fontSize: 12,
  },

  // ─── Route ───
  routeEndpoints: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
  },
  routeField: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  routeLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: text.muted,
    fontWeight: 600,
  },
  selectWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  select: {
    width: "100%",
    padding: "8px 28px 8px 10px",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${surface.border}`,
    borderRadius: 6,
    color: text.primary,
    fontSize: 12,
    fontFamily: font,
    fontWeight: 500,
    cursor: "pointer",
    outline: "none",
  },
  swapBtn: {
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${surface.border}`,
    borderRadius: 6,
    color: text.secondary,
    cursor: "pointer",
    flexShrink: 0,
    marginBottom: 1,
    transition: "color 0.15s, background 0.15s",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    userSelect: "none",
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    border: `1.5px solid rgba(255,255,255,0.2)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background 0.12s, border-color 0.12s",
    color: "#fff",
    flexShrink: 0,
  },
  checkboxChecked: {
    background: text.accent,
    borderColor: text.accent,
  },
  checkboxLabel: {
    fontSize: 12,
    color: text.secondary,
    fontWeight: 500,
  },
  routeActions: {
    display: "flex",
    gap: 8,
  },
  routeSummary: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    background: "rgba(96,165,250,0.06)",
    border: `1px solid rgba(96,165,250,0.12)`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: text.accent,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  statCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    padding: "12px 8px",
    background: "rgba(255,255,255,0.02)",
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    fontFamily: mono,
    lineHeight: 1,
    color: text.primary,
    display: "flex",
    alignItems: "center",
  },
  statLabel: {
    fontSize: 10,
    color: text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 500,
  },

  // ─── Buttons ───
  btnPrimary: {
    flex: 1,
    padding: "10px 16px",
    background: "#60a5fa",
    color: "#0f1219",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: font,
    cursor: "pointer",
    transition: "background 0.15s",
  },
  btnSecondary: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "8px 12px",
    background: "rgba(255,255,255,0.04)",
    color: text.secondary,
    border: `1px solid ${surface.border}`,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: font,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  },
  btnGhost: {
    padding: "10px 16px",
    background: "none",
    color: text.muted,
    border: `1px solid ${surface.border}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: font,
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
  },

  // ─── Ops ───
  opsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  opsOccupancy: {
    fontSize: 12,
    fontWeight: 600,
    color: text.secondary,
  },
  levelTabs: {
    display: "flex",
    gap: 4,
    padding: 3,
    background: "rgba(255,255,255,0.03)",
    borderRadius: 8,
  },
  levelTab: {
    flex: 1,
    padding: "7px 0",
    background: "none",
    border: "none",
    borderRadius: 6,
    color: text.muted,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: font,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
    textAlign: "center",
  },
  levelTabActive: {
    background: "rgba(96,165,250,0.12)",
    color: text.accent,
  },
  statusList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
    borderRadius: 6,
    transition: "background 0.12s",
  },
  statusRowLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statusRoomName: {
    fontWeight: 600,
    fontSize: 13,
  },
  statusRoomMeta: {
    fontSize: 11,
    color: text.muted,
  },

  // ─── Map Area ───
  mapArea: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  mapPlaceholder: {
    width: "100%",
    height: "100%",
    background: `radial-gradient(ellipse at 50% 30%, #151a28 0%, #0f1219 100%)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    color: text.muted,
  },
  mapGrid: {
    width: "70%",
    maxWidth: 800,
  },

  // ─── Map Toolbar (floating) ───
  toolbar: {
    position: "absolute",
    top: 16,
    left: 16,
    width: 300,
    background: "rgba(22,27,39,0.92)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: `1px solid ${surface.border}`,
    borderRadius: 12,
    overflow: "hidden",
  },
  toolbarHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 14px",
    borderBottom: `1px solid ${surface.border}`,
  },
  toolbarTitle: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  toolbarKicker: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: text.muted,
    fontWeight: 500,
  },
  toolbarHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  toolbarBadge: {
    padding: "2px 7px",
    fontSize: 10,
    fontWeight: 600,
    fontFamily: mono,
    color: text.accent,
    background: "rgba(96,165,250,0.1)",
    borderRadius: 4,
  },
  toolbarToggle: {
    padding: "4px 10px",
    background: "rgba(255,255,255,0.06)",
    border: "none",
    borderRadius: 4,
    color: text.secondary,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: font,
    cursor: "pointer",
  },
  toolbarBody: {
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    animation: "fadeIn 0.15s ease",
  },
  toolbarSection: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  toolbarSectionLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: text.muted,
    fontWeight: 600,
  },
  toolbarBtnGroup: {
    display: "flex",
    gap: 4,
  },
  toolbarBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "7px 8px",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${surface.border}`,
    borderRadius: 6,
    color: text.secondary,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: font,
    cursor: "pointer",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
    whiteSpace: "nowrap",
  },
  toolbarBtnActive: {
    background: "rgba(96,165,250,0.12)",
    borderColor: "rgba(96,165,250,0.25)",
    color: text.accent,
  },
  readoutRow: {
    display: "flex",
    gap: 8,
  },
  readout: {
    flex: 1,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 10px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: 6,
  },
  readoutLabel: {
    fontSize: 10,
    color: text.muted,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  readoutValue: {
    fontSize: 13,
    fontFamily: mono,
    fontWeight: 600,
    color: text.primary,
  },
  slider: {
    width: "100%",
    cursor: "pointer",
  },
  toolbarFocus: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: 8,
    borderTop: `1px solid ${surface.border}`,
  },
  toolbarFocusLabel: {
    display: "block",
    fontSize: 10,
    color: text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 500,
    marginBottom: 2,
  },
  toolbarFocusName: {
    fontSize: 13,
    fontWeight: 600,
    display: "block",
  },
  focusBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    background: "rgba(96,165,250,0.1)",
    border: `1px solid rgba(96,165,250,0.2)`,
    borderRadius: 6,
    color: text.accent,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: font,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  // ─── Zoom ───
  zoomControls: {
    position: "absolute",
    top: 16,
    right: 16,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  zoomBtn: {
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(22,27,39,0.92)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: `1px solid ${surface.border}`,
    color: text.secondary,
    fontSize: 18,
    fontWeight: 400,
    fontFamily: font,
    cursor: "pointer",
  },
};

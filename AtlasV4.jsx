import { useState, useEffect, useRef, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════════ */
const SPACES = [
  { id: "room-l1-lobby", name: "Lobby", level: "L1", kind: "amenity", dept: "Shared", cap: 0, status: "available" },
  { id: "room-l1-eng-south", name: "Engineering South", level: "L1", kind: "room", dept: "Engineering", cap: 24, status: "occupied" },
  { id: "room-l1-eng-north", name: "Engineering North", level: "L1", kind: "room", dept: "Engineering", cap: 18, status: "available" },
  { id: "room-l1-ops", name: "Operations Bay", level: "L1", kind: "room", dept: "Operations", cap: 16, status: "occupied" },
  { id: "room-l2-summit", name: "Summit Room", level: "L2", kind: "meeting", dept: "Shared", cap: 12, status: "occupied" },
  { id: "room-l2-cedar", name: "Cedar Room", level: "L2", kind: "meeting", dept: "Shared", cap: 8, status: "available" },
  { id: "room-l1-huddle1", name: "Huddle 1", level: "L1", kind: "meeting", dept: "Shared", cap: 4, status: "focus" },
  { id: "room-l1-kitchen", name: "Kitchen", level: "L1", kind: "amenity", dept: "Shared", cap: 0, status: "available" },
  { id: "room-l1-phone-a", name: "Phone Booth A", level: "L1", kind: "meeting", dept: "Shared", cap: 1, status: "available" },
  { id: "room-l1-wellness", name: "Wellness Room", level: "L1", kind: "amenity", dept: "HR", cap: 6, status: "offline" },
  { id: "room-l1-itbar", name: "IT Bar", level: "L1", kind: "amenity", dept: "IT", cap: 4, status: "available" },
  { id: "room-l1-reception", name: "Reception Desk", level: "L1", kind: "amenity", dept: "Admin", cap: 2, status: "occupied" },
  { id: "room-l2-birch", name: "Birch Room", level: "L2", kind: "meeting", dept: "Shared", cap: 6, status: "available" },
  { id: "room-l2-maple", name: "Maple Room", level: "L2", kind: "meeting", dept: "Shared", cap: 10, status: "focus" },
  { id: "room-l2-exec", name: "Executive Suite", level: "L2", kind: "room", dept: "Management", cap: 8, status: "occupied" },
  { id: "room-l2-lounge", name: "Sky Lounge", level: "L2", kind: "amenity", dept: "Shared", cap: 20, status: "available" },
  { id: "room-l1-print", name: "Print Room", level: "L1", kind: "amenity", dept: "Shared", cap: 0, status: "available" },
  { id: "room-l1-server", name: "Server Room", level: "L1", kind: "room", dept: "IT", cap: 0, status: "offline" },
];
const PEOPLE = [
  { name: "Alex Petrov", desk: "WS-14", spaceId: "room-l1-eng-south" },
  { name: "Maria Volkova", desk: "WS-22", spaceId: "room-l1-eng-north" },
  { name: "Pavel Smirnov", desk: "WS-08", spaceId: "room-l1-ops" },
  { name: "Nina Pavlova", desk: "WS-31", spaceId: "room-l1-ops" },
  { name: "Daria Kozlova", desk: "WS-05", spaceId: "room-l1-eng-south" },
  { name: "Oleg Ivanov", desk: "WS-41", spaceId: "room-l2-exec" },
  { name: "Svetlana Moroz", desk: "WS-19", spaceId: "room-l1-eng-north" },
];
const EQ = {
  "room-l2-summit": ["75\" Display", "Video conf", "Whiteboard", "Speakers"],
  "room-l2-cedar": ["55\" Display", "Whiteboard"],
  "room-l1-huddle1": ["32\" Display"],
  "room-l1-eng-south": ["Displays ×4", "Whiteboard", "Video conf"],
  "room-l2-maple": ["65\" Display", "Video conf"],
  "room-l2-exec": ["75\" Display", "Video conf", "Sound system"],
};
const ST = {
  available: { c: "#34d399", bg: "rgba(52,211,153,.12)", label: "Available" },
  occupied:  { c: "#f87171", bg: "rgba(248,113,113,.12)", label: "Occupied" },
  focus:     { c: "#fbbf24", bg: "rgba(251,191,36,.12)", label: "Focus" },
  offline:   { c: "#64748b", bg: "rgba(100,116,139,.10)", label: "Offline" },
};
const KIND_L = { room: "Workspace", meeting: "Meeting Room", amenity: "Amenity" };
const GROUP_OPTIONS = [
  { key: "level", label: "Floor" },
  { key: "kind", label: "Type" },
  { key: "dept", label: "Department" },
  { key: "status", label: "Status" },
];

/* ═══════════════════════════════════════════════════════════════
   ICONS
   ═══════════════════════════════════════════════════════════════ */
const Ic = {
  Search: ({s=15}={}) => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="6.8" cy="6.8" r="5" stroke="currentColor" strokeWidth="1.6"/><path d="M10.5 10.5L14.5 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  X: ({s=13}={}) => <svg width={s} height={s} viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  Nav: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 6L12 2L8 11.5L6.5 7.5L2.5 6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="currentColor" opacity="0.15"/></svg>,
  Route: () => <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.4"/><circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.4" fill="currentColor" opacity="0.15"/><path d="M5.8 5.8L10.2 10.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2.5 2.5"/></svg>,
  Pin: () => <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5C4.5 1.5 2.5 3.5 2.5 6C2.5 9.5 7 13 7 13S11.5 9.5 11.5 6C11.5 3.5 9.5 1.5 7 1.5Z" stroke="currentColor" strokeWidth="1.3"/><circle cx="7" cy="6" r="1.5" fill="currentColor" opacity="0.4"/></svg>,
  User: () => <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M2.5 12.5C2.5 10 4.5 8 7 8S11.5 10 11.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  Floor: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L1.5 5L7 8.5L12.5 5L7 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" opacity="0.06"/><path d="M1.5 8L7 11.5L12.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"/></svg>,
  Back: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 2.5L4 6L7.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Check: () => <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Swap: () => <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M10 3V11M10 11L8 9M10 11L12 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 11V3M4 3L2 5M4 3L6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Compass: () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 11L7 7L11 5L9 9L5 11Z" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  Eye: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 7S3.5 3 7 3S12.5 7 12.5 7S10.5 11 7 11S1.5 7 1.5 7Z" stroke="currentColor" strokeWidth="1.2"/><circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>,
  Grid: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1.5" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>,
  Walk: () => <svg width="15" height="15" viewBox="0 0 14 14" fill="none"><circle cx="8" cy="2.5" r="1.5" fill="currentColor" opacity="0.7"/><path d="M6 5.5L5 9L6.5 9L7.5 12.5M9 5.5L10.5 9L9 9L8 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 5.5H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  Elev: () => <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 8L7 5L9 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  ArrowR: () => <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Pulse: () => <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="3" fill="currentColor" opacity="0.3"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/></svg>,
  Seats: () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="5" width="8" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.1"/><path d="M4 5V3.5C4 2.7 4.7 2 5.5 2H6.5C7.3 2 8 2.7 8 3.5V5" stroke="currentColor" strokeWidth="1.1"/><path d="M3 9V10.5M9 9V10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
};


/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
const groupBy = (arr, key) => {
  const map = {};
  arr.forEach(item => {
    const k = key === "kind" ? (KIND_L[item[key]] || item[key]) : item[key];
    if (!map[k]) map[k] = [];
    map[k].push(item);
  });
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
};

const filterSpaces = (q) => {
  if (!q.trim()) return SPACES;
  const lq = q.toLowerCase();
  return SPACES.filter(s => s.name.toLowerCase().includes(lq) || s.dept.toLowerCase().includes(lq) || (KIND_L[s.kind] || "").toLowerCase().includes(lq));
};

const filterPeople = (q) => {
  if (!q.trim()) return [];
  const lq = q.toLowerCase();
  return PEOPLE.filter(p => p.name.toLowerCase().includes(lq) || p.desk.toLowerCase().includes(lq));
};


/* ═══════════════════════════════════════════════════════════════
   SPACE CARD
   ═══════════════════════════════════════════════════════════════ */
function SpaceCard({ space, onClick, selected, compact }) {
  const st = ST[space.status];
  const isSelected = selected?.id === space.id;
  return (
    <button
      onClick={() => onClick(space)}
      className="hud-card"
      style={{
        ...S.card,
        ...(isSelected ? S.cardSelected : {}),
        ...(compact ? { padding: '10px 12px' } : {}),
      }}
    >
      <div style={S.cardTop}>
        <div style={S.cardNameRow}>
          <span style={{...S.statusDot, background: st?.c}} />
          <span style={{...S.cardName, ...(compact ? {fontSize: 12} : {})}}>{space.name}</span>
        </div>
        <span style={S.cardLevel}>{space.level}</span>
      </div>
      <div style={S.cardBottom}>
        <span style={S.cardKind}>{KIND_L[space.kind] || space.kind}</span>
        {space.cap > 0 && (
          <span style={S.cardCap}><Ic.Seats /> {space.cap}</span>
        )}
      </div>
      {!compact && space.dept !== "Shared" && (
        <span style={S.cardDept}>{space.dept}</span>
      )}
    </button>
  );
}


/* ═══════════════════════════════════════════════════════════════
   PERSON ROW
   ═══════════════════════════════════════════════════════════════ */
function PersonRow({ person, onClick }) {
  const sp = SPACES.find(s => s.id === person.spaceId);
  return (
    <button style={S.personRow} className="hud-card" onClick={() => onClick(person)}>
      <div style={S.personAv}>{person.name[0]}</div>
      <div style={S.personInfo}>
        <span style={{fontSize: 13, fontWeight: 600}}>{person.name}</span>
        <span style={{fontSize: 11, color: T.sec}}>{person.desk} · {sp?.name}</span>
      </div>
      <span style={S.cardLevel}>{sp?.level}</span>
    </button>
  );
}


/* ═══════════════════════════════════════════════════════════════
   GROUPED GRID
   ═══════════════════════════════════════════════════════════════ */
function GroupedGrid({ spaces, groupKey, onSelect, selected, compact }) {
  const groups = groupBy(spaces, groupKey);
  return (
    <div style={S.groupedGrid}>
      {groups.map(([label, items]) => (
        <div key={label} style={S.group}>
          <div style={S.groupHeader}>
            <span style={S.groupLabel}>{label}</span>
            <span style={S.groupCount}>{items.length}</span>
          </div>
          <div style={{...S.grid, ...(compact ? S.gridCompact : {})}}>
            {items.map(s => (
              <SpaceCard key={s.id} space={s} onClick={onSelect} selected={selected} compact={compact} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════ */
export default function AtlasV4() {
  const [level, setLevel] = useState("L1");
  const [viewMode, setViewMode] = useState("explore");
  const [time, setTime] = useState(new Date());

  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQ, setBrowseQ] = useState("");
  const [browseGroup, setBrowseGroup] = useState("level");
  const browseRef = useRef(null);

  const [selected, setSelected] = useState(null);

  const [routeOpen, setRouteOpen] = useState(false);
  const [routeFrom, setRouteFrom] = useState(null);
  const [routeTo, setRouteTo] = useState(null);
  const [routeFromQ, setRouteFromQ] = useState("");
  const [routeToQ, setRouteToQ] = useState("");
  const [routeFromGroup, setRouteFromGroup] = useState("level");
  const [routeToGroup, setRouteToGroup] = useState("level");
  const [accessible, setAccessible] = useState(false);
  const [routeBuilt, setRouteBuilt] = useState(false);

  const [opsOpen, setOpsOpen] = useState(false);

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 30000); return () => clearInterval(t); }, []);

  // Browse
  const browseSpaces = filterSpaces(browseQ);
  const browsePeople = filterPeople(browseQ);
  const openBrowse = () => { setBrowseOpen(true); setBrowseQ(""); setTimeout(() => browseRef.current?.focus(), 80); };
  const selectFromBrowse = (s) => { setSelected(s); setBrowseOpen(false); };
  const selectPersonFromBrowse = (p) => {
    const sp = SPACES.find(s => s.id === p.spaceId);
    if (sp) setSelected({ ...sp, _person: p });
    setBrowseOpen(false);
  };

  // Route
  const routeFromSpaces = filterSpaces(routeFromQ);
  const routeToSpaces = filterSpaces(routeToQ);
  const openRouteBuilder = (from = null, to = null) => {
    setRouteOpen(true); setRouteFrom(from); setRouteTo(to);
    setRouteFromQ(""); setRouteToQ(""); setRouteBuilt(false); setAccessible(false);
  };
  const closeRoute = () => { setRouteOpen(false); setRouteFrom(null); setRouteTo(null); setRouteBuilt(false); };
  const buildRoute = () => { if (routeFrom && routeTo) setRouteBuilt(true); };

  // Counts
  const cts = { available: 0, occupied: 0, focus: 0, offline: 0 };
  SPACES.forEach(s => { if (cts[s.status] !== undefined) cts[s.status]++; });

  const equipment = selected ? (EQ[selected.id] || []) : [];

  return (
    <div style={S.shell}>
      <style>{CSS}</style>

      {/* ═══ MAP BG ═══ */}
      <div style={S.mapBg}>
        <svg width="100%" height="100%" viewBox="0 0 1200 700" fill="none" preserveAspectRatio="xMidYMid slice" style={{opacity:0.06}}>
          <rect x="80" y="60" width="1040" height="580" rx="4" stroke="currentColor" strokeWidth="0.8"/>
          <rect x="80" y="340" width="260" height="300" rx="2" stroke="currentColor" strokeWidth="0.6"/>
          <rect x="370" y="340" width="180" height="300" rx="2" stroke="currentColor" strokeWidth="0.6"/>
          <rect x="580" y="340" width="180" height="300" rx="2" stroke="currentColor" strokeWidth="0.6"/>
          <rect x="790" y="340" width="150" height="300" rx="2" stroke="currentColor" strokeWidth="0.6"/>
          <rect x="970" y="340" width="150" height="300" rx="2" stroke="currentColor" strokeWidth="0.6"/>
          <rect x="80" y="60" width="480" height="260" rx="2" stroke="currentColor" strokeWidth="0.6"/>
          <rect x="590" y="60" width="250" height="260" rx="2" stroke="currentColor" strokeWidth="0.6"/>
          <rect x="870" y="60" width="250" height="260" rx="2" stroke="currentColor" strokeWidth="0.6"/>
        </svg>
      </div>

      {/* ═══ TOP BAR ═══ */}
      <header style={S.topBar}>
        <div style={S.topLeft}>
          <div style={S.logo} className="hud-glass">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1" y="1" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.9"/><rect x="10" y="1" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.45"/><rect x="1" y="10" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.25"/><rect x="10" y="10" width="7" height="7" rx="2" fill="#38bdf8" opacity="0.65"/></svg>
            <span style={{fontWeight: 700, fontSize: 14, letterSpacing: '-.02em'}}>Atlas</span>
          </div>
          <button style={S.searchBtn} className="hud-glass hud-hover" onClick={openBrowse}>
            <Ic.Search s={14}/> <span style={{color: T.muted, fontWeight: 400}}>Browse spaces & people…</span>
            <kbd style={S.kbd}>/</kbd>
          </button>
        </div>

        <div style={S.topCenter}>
          <div style={S.viewModes} className="hud-glass">
            {[{id:"plan",ic:<Ic.Floor/>,l:"Plan"},{id:"explore",ic:<Ic.Compass/>,l:"Explore"},{id:"theatre",ic:<Ic.Eye/>,l:"Theatre"}].map(m => (
              <button key={m.id} style={{...S.vmBtn,...(viewMode===m.id?S.vmActive:{})}} className="hud-btn" onClick={() => setViewMode(m.id)}>{m.ic}<span>{m.l}</span></button>
            ))}
          </div>
        </div>

        <div style={S.topRight}>
          <button style={S.opsBtn} className="hud-glass hud-hover" onClick={() => setOpsOpen(!opsOpen)}>
            <Ic.Grid/>
            <span style={S.opsBadge}><span style={{...S.liveDot,background:ST.available.c,width:6,height:6}}/> {cts.available} free</span>
          </button>
          <div style={S.syncChip} className="hud-glass">
            <span style={{...S.liveDot,background:'#34d399',width:5,height:5}}/> {time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
          </div>
        </div>
      </header>

      {/* ═══ BOTTOM CONTROLS ═══ */}
      <div style={S.bottomLeft}>
        <div style={S.floorPicker} className="hud-glass">
          {["L1","L2"].map(l => (
            <button key={l} style={{...S.floorBtn,...(level===l?S.floorBtnActive:{})}} className="hud-btn" onClick={() => setLevel(l)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={S.bottomRight}>
        <div style={S.zoomStack} className="hud-glass">
          <button style={S.zoomBtn} className="hud-btn">+</button>
          <div style={{height:1,background:'rgba(255,255,255,.06)',width:'60%',alignSelf:'center'}}/>
          <button style={S.zoomBtn} className="hud-btn">−</button>
        </div>
      </div>

      {/* Route FAB */}
      {!routeOpen && !browseOpen && (
        <button style={S.fab} className="hud-accent" onClick={() => openRouteBuilder()}>
          <Ic.Route/> <span>Route</span>
        </button>
      )}


      {/* ═══════════════════════════════════════════════════════════
           BROWSE PANEL — large overlay
           ═══════════════════════════════════════════════════════════ */}
      {browseOpen && (
        <div style={S.overlay} onClick={() => setBrowseOpen(false)}>
          <div style={S.browsePanel} className="hud-glass-heavy oa-fade" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={S.bpHeader}>
              <div style={S.bpSearchRow}>
                <Ic.Search s={16}/>
                <input ref={browseRef} style={S.bpInput} placeholder="Search spaces, people, departments…" value={browseQ} onChange={e => setBrowseQ(e.target.value)} autoFocus/>
                {browseQ && <button style={S.iconBtn} className="hud-btn" onClick={() => setBrowseQ("")}><Ic.X s={12}/></button>}
                <div style={S.bpDivider}/>
                <button style={S.iconBtn} className="hud-btn" onClick={() => setBrowseOpen(false)}><Ic.X/></button>
              </div>
              <div style={S.bpToolbar}>
                <div style={S.bpGroupRow}>
                  <span style={S.bpGroupLabel}>Group by</span>
                  {GROUP_OPTIONS.map(g => (
                    <button key={g.key} style={{...S.pill,...(browseGroup===g.key?S.pillActive:{})}} className="hud-btn" onClick={() => setBrowseGroup(g.key)}>{g.label}</button>
                  ))}
                </div>
                <span style={S.bpCount}>{browseSpaces.length} spaces{browsePeople.length > 0 ? ` · ${browsePeople.length} people` : ''}</span>
              </div>
            </div>

            {/* Body */}
            <div style={S.bpBody}>
              {/* People section — only when searching */}
              {browsePeople.length > 0 && (
                <div style={S.bpPeopleSection}>
                  <div style={S.bpSectionTitle}><Ic.User/> People</div>
                  <div style={S.bpPeopleGrid}>
                    {browsePeople.slice(0, 6).map(p => (
                      <PersonRow key={p.name} person={p} onClick={selectPersonFromBrowse}/>
                    ))}
                  </div>
                </div>
              )}

              {/* Spaces grid */}
              <GroupedGrid spaces={browseSpaces} groupKey={browseGroup} onSelect={selectFromBrowse} selected={selected}/>
            </div>
          </div>
        </div>
      )}


      {/* ═══════════════════════════════════════════════════════════
           ROUTE BUILDER — large two-column overlay
           ═══════════════════════════════════════════════════════════ */}
      {routeOpen && (
        <div style={S.overlay} onClick={closeRoute}>
          <div style={S.routePanel} className="hud-glass-heavy oa-fade" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={S.rpHeader}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <Ic.Route/>
                <span style={{fontSize:16,fontWeight:700,letterSpacing:'-.02em'}}>Route Builder</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <label style={S.checkRow}>
                  <div style={{...S.checkBox,...(accessible?S.checkBoxOn:{})}} onClick={e => {e.preventDefault();setAccessible(!accessible);}}>
                    {accessible && <Ic.Check/>}
                  </div>
                  <span>Accessible only</span>
                </label>
                <button style={{...S.accentBtn, opacity: (routeFrom && routeTo) ? 1 : 0.35, pointerEvents: (routeFrom && routeTo) ? 'auto' : 'none'}} className="hud-accent" onClick={buildRoute}>
                  <Ic.Nav/> Build route
                </button>
                <button style={S.iconBtn} className="hud-btn" onClick={closeRoute}><Ic.X/></button>
              </div>
            </div>

            {/* Two columns */}
            <div style={S.rpColumns}>
              {/* FROM column */}
              <div style={S.rpCol}>
                <div style={S.rpColHeader}>
                  <div style={S.rpColDot}><div style={{width:10,height:10,borderRadius:'50%',border:`2.5px solid ${T.accent}`}}/></div>
                  <div style={{flex:1}}>
                    <div style={S.rpColLabel}>From — Starting point</div>
                    {routeFrom ? (
                      <div style={S.rpSelected}>
                        <span style={{...S.statusDot,background:ST[routeFrom.status]?.c}}/> 
                        <span style={S.rpSelectedName}>{routeFrom.name}</span>
                        <span style={S.rpSelectedLevel}>{routeFrom.level}</span>
                        <button style={S.rpClearBtn} className="hud-btn" onClick={() => setRouteFrom(null)}><Ic.X s={10}/></button>
                      </div>
                    ) : (
                      <span style={{fontSize:12,color:T.muted}}>Pick a starting room below</span>
                    )}
                  </div>
                </div>
                <div style={S.rpColSearch}>
                  <Ic.Search s={13}/>
                  <input style={S.rpColInput} placeholder="Filter…" value={routeFromQ} onChange={e => setRouteFromQ(e.target.value)}/>
                  {routeFromQ && <button style={{...S.iconBtn,width:22,height:22}} className="hud-btn" onClick={() => setRouteFromQ("")}><Ic.X s={10}/></button>}
                </div>
                <div style={S.rpColToolbar}>
                  <span style={{fontSize:10,color:T.muted,fontWeight:600}}>GROUP</span>
                  {GROUP_OPTIONS.slice(0,3).map(g => (
                    <button key={g.key} style={{...S.pillSm,...(routeFromGroup===g.key?S.pillSmActive:{})}} className="hud-btn" onClick={() => setRouteFromGroup(g.key)}>{g.label}</button>
                  ))}
                </div>
                <div style={S.rpColBody}>
                  <GroupedGrid spaces={filterSpaces(routeFromQ)} groupKey={routeFromGroup} onSelect={s => setRouteFrom(s)} selected={routeFrom} compact/>
                </div>
              </div>

              {/* SWAP button (center) */}
              <div style={S.rpSwapCol}>
                <button style={S.rpSwapBtn} className="hud-btn" onClick={() => {const t=routeFrom;setRouteFrom(routeTo);setRouteTo(t);}}>
                  <Ic.Swap/>
                </button>
              </div>

              {/* TO column */}
              <div style={S.rpCol}>
                <div style={S.rpColHeader}>
                  <div style={S.rpColDot}><div style={{width:10,height:10,borderRadius:'50%',background:T.accent}}/></div>
                  <div style={{flex:1}}>
                    <div style={S.rpColLabel}>To — Destination</div>
                    {routeTo ? (
                      <div style={S.rpSelected}>
                        <span style={{...S.statusDot,background:ST[routeTo.status]?.c}}/> 
                        <span style={S.rpSelectedName}>{routeTo.name}</span>
                        <span style={S.rpSelectedLevel}>{routeTo.level}</span>
                        <button style={S.rpClearBtn} className="hud-btn" onClick={() => setRouteTo(null)}><Ic.X s={10}/></button>
                      </div>
                    ) : (
                      <span style={{fontSize:12,color:T.muted}}>Pick a destination below</span>
                    )}
                  </div>
                </div>
                <div style={S.rpColSearch}>
                  <Ic.Search s={13}/>
                  <input style={S.rpColInput} placeholder="Filter…" value={routeToQ} onChange={e => setRouteToQ(e.target.value)}/>
                  {routeToQ && <button style={{...S.iconBtn,width:22,height:22}} className="hud-btn" onClick={() => setRouteToQ("")}><Ic.X s={10}/></button>}
                </div>
                <div style={S.rpColToolbar}>
                  <span style={{fontSize:10,color:T.muted,fontWeight:600}}>GROUP</span>
                  {GROUP_OPTIONS.slice(0,3).map(g => (
                    <button key={g.key} style={{...S.pillSm,...(routeToGroup===g.key?S.pillSmActive:{})}} className="hud-btn" onClick={() => setRouteToGroup(g.key)}>{g.label}</button>
                  ))}
                </div>
                <div style={S.rpColBody}>
                  <GroupedGrid spaces={filterSpaces(routeToQ)} groupKey={routeToGroup} onSelect={s => setRouteTo(s)} selected={routeTo} compact/>
                </div>
              </div>
            </div>

            {/* Route result */}
            {routeBuilt && (
              <div style={S.rpResult} className="oa-slide-up">
                <div style={S.rrHero}>
                  <div style={S.rrIcon}><Ic.Walk/></div>
                  <div style={S.rrMain}>
                    <span style={S.rrDist}>118 m</span>
                    <span style={S.rrTime}>~2 min walk</span>
                  </div>
                  <div style={S.rrPath}>{routeFrom?.name} <Ic.ArrowR/> {routeTo?.name}</div>
                  <div style={S.rrStats}>
                    {[{v:"26",l:"Nodes"},{v:"25",l:"Legs"},{v:"2",l:"Levels"},{v:"elev",l:"Via",ico:true}].map(s => (
                      <div key={s.l} style={S.rrStat}><span style={S.rrStatV}>{s.ico?<Ic.Elev/>:s.v}</span><span style={S.rrStatL}>{s.l}</span></div>
                    ))}
                  </div>
                </div>
                <div style={S.rrDirections}>
                  {[
                    `Leave ${routeFrom?.name} through main corridor`,
                    `Continue on ${routeFrom?.level} toward elevator`,
                    `Take elevator to ${routeTo?.level}`,
                    `Continue on ${routeTo?.level} toward ${routeTo?.name}`,
                    `Arrive at ${routeTo?.name}`,
                  ].map((txt,i) => (
                    <div key={i} style={S.rrStep}>
                      <div style={{...S.rrStepN,...(i===4?{background:T.accent,color:'#0c1018',borderColor:T.accent}:{})}}>{i===4?<Ic.Check/>:i+1}</div>
                      <span style={S.rrStepT}>{txt}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {/* ═══ DETAIL FLOAT (right) ═══ */}
      {selected && !browseOpen && !routeOpen && (
        <div style={S.detailFloat} className="hud-glass-heavy oa-slide-left">
          <div style={{display:'flex',justifyContent:'flex-end'}}>
            <button style={S.iconBtn} className="hud-btn" onClick={() => setSelected(null)}><Ic.X/></button>
          </div>
          <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:T.accent}}>{KIND_L[selected.kind]}</div>
          <h2 style={{fontSize:20,fontWeight:800,letterSpacing:'-.03em',margin:0,lineHeight:1.2}}>{selected.name}</h2>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span style={{...S.statusPill,color:ST[selected.status]?.c,background:ST[selected.status]?.bg}}><Ic.Pulse/> {ST[selected.status]?.label}</span>
            <span style={{fontSize:11,fontWeight:700,fontFamily:MONO,color:T.sec,background:'rgba(255,255,255,.05)',padding:'2px 8px',borderRadius:5}}>{selected.level}</span>
            {selected.cap > 0 && <span style={{fontSize:11,color:T.sec}}>{selected.cap} seats</span>}
          </div>
          {selected._person && (
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:T.accentBg,border:`1px solid ${T.accentBorder}`,borderRadius:12}}>
              <div style={S.personAv}>{selected._person.name[0]}</div>
              <div><div style={{fontSize:13,fontWeight:600}}>{selected._person.name}</div><div style={{fontSize:11,color:T.muted}}>Desk {selected._person.desk}</div></div>
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:T.border,borderRadius:12,overflow:'hidden'}}>
            {[["Department",selected.dept],["Level",selected.level],["ID",selected.id]].map(([l,v]) => (
              <div key={l} style={{display:'flex',flexDirection:'column',gap:3,padding:'10px 12px',background:'rgba(15,20,32,.5)'}}>
                <span style={{fontSize:9,fontWeight:600,color:T.muted,textTransform:'uppercase',letterSpacing:'.05em'}}>{l}</span>
                <span style={{fontSize:12,fontWeight:600,...(l==="ID"?{fontFamily:MONO,fontSize:10}:{})}}>{v}</span>
              </div>
            ))}
          </div>
          {equipment.length > 0 && <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{equipment.map(e => <span key={e} style={{padding:'4px 10px',fontSize:11,fontWeight:500,color:T.sec,background:'rgba(255,255,255,.04)',borderRadius:6,border:`1px solid ${T.border}`}}>{e}</span>)}</div>}
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <button style={S.accentBtn} className="hud-accent" onClick={() => {const lob=SPACES[0];setSelected(null);openRouteBuilder(lob,selected);}}><Ic.Nav/> Navigate here</button>
            <button style={S.ghostBtn} className="hud-btn" onClick={() => {setSelected(null);openRouteBuilder(selected);}}><Ic.Route/> Route from here</button>
          </div>
        </div>
      )}


      {/* ═══ OPS DROPDOWN ═══ */}
      {opsOpen && (
        <div style={S.opsPanel} className="hud-glass-heavy oa-fade">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 16px',borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}><Ic.Grid/><span style={{fontSize:14,fontWeight:700}}>Operations</span></div>
            <button style={S.iconBtn} className="hud-btn" onClick={() => setOpsOpen(false)}><Ic.X/></button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderBottom:`1px solid ${T.border}`}}>
            {Object.entries(ST).map(([k,cfg]) => (
              <div key={k} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'12px 6px'}}>
                <span style={{fontSize:20,fontWeight:800,fontFamily:MONO,lineHeight:1,color:cfg.c}}>{cts[k]}</span>
                <span style={{fontSize:9,fontWeight:600,color:T.muted,textTransform:'uppercase',letterSpacing:'.05em'}}>{cfg.label}</span>
              </div>
            ))}
          </div>
          <div style={{overflowY:'auto',padding:6,maxHeight:300}}>
            {SPACES.filter(s => s.cap > 0).map(s => {
              const cfg = ST[s.status];
              return (
                <button key={s.id} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:'none',border:'none',borderRadius:10,fontFamily:FONT,color:T.text,textAlign:'left'}} className="hud-card" onClick={() => {selectFromBrowse(s);setOpsOpen(false);}}>
                  <span style={{...S.statusDot,background:cfg?.c,width:8,height:8}}/>
                  <div style={{flex:1,display:'flex',flexDirection:'column',gap:1}}><span style={{fontSize:13,fontWeight:600}}>{s.name}</span><span style={{fontSize:11,color:T.muted}}>{s.level} · {s.cap} seats</span></div>
                  <span style={{...S.statusPill,fontSize:10,padding:'2px 8px',color:cfg?.c,background:cfg?.bg}}>{cfg?.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   TOKENS
   ═══════════════════════════════════════════════════════════════ */
const FONT = "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "'JetBrains Mono', 'SF Mono', monospace";
const T = {
  bg: "#0c1018", glass: "rgba(15,20,32,.72)", glassH: "rgba(12,16,26,.92)",
  border: "rgba(255,255,255,.07)", borderH: "rgba(255,255,255,.12)",
  text: "#e4e6ea", sec: "rgba(255,255,255,.50)", muted: "rgba(255,255,255,.28)",
  accent: "#38bdf8", accentBg: "rgba(56,189,248,.10)", accentBorder: "rgba(56,189,248,.22)",
};


/* ═══════════════════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════════════════ */
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


/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */
const S = {
  shell: { position:'relative',width:'100%',height:'100vh',overflow:'hidden',fontFamily:FONT,color:T.text,fontSize:13,background:T.bg,lineHeight:1.5 },
  mapBg: { position:'absolute',inset:0,zIndex:0,background:`radial-gradient(ellipse at 40% 35%,#141c2e 0%,#0c1018 60%,#080b12 100%)`,display:'flex',alignItems:'center',justifyContent:'center',color:T.sec },

  // Top bar
  topBar: { position:'absolute',top:12,left:12,right:12,zIndex:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12 },
  topLeft: { display:'flex',alignItems:'center',gap:8 },
  logo: { display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderRadius:12,flexShrink:0 },
  searchBtn: { display:'flex',alignItems:'center',gap:10,padding:'9px 16px',borderRadius:12,fontFamily:FONT,fontSize:13,fontWeight:500,color:T.sec,background:'none',border:'none',minWidth:280 },
  kbd: { marginLeft:'auto',padding:'2px 7px',fontSize:10,fontWeight:600,fontFamily:MONO,color:T.muted,background:'rgba(255,255,255,.04)',borderRadius:4,border:`1px solid ${T.border}` },
  topCenter: { },
  topRight: { display:'flex',alignItems:'center',gap:8 },
  viewModes: { display:'flex',gap:2,padding:3,borderRadius:12 },
  vmBtn: { display:'flex',alignItems:'center',gap:5,padding:'7px 12px',background:'none',border:'none',borderRadius:9,fontSize:12,fontWeight:500,fontFamily:FONT,color:T.muted,whiteSpace:'nowrap' },
  vmActive: { color:T.text,background:'rgba(255,255,255,.08)' },
  opsBtn: { display:'flex',alignItems:'center',gap:8,padding:'9px 14px',borderRadius:12,background:'none',border:'none',fontFamily:FONT,color:T.sec },
  opsBadge: { display:'flex',alignItems:'center',gap:5,fontSize:11,fontWeight:600 },
  syncChip: { display:'flex',alignItems:'center',gap:6,padding:'8px 12px',borderRadius:10,fontSize:10,color:T.sec },
  liveDot: { width:7,height:7,borderRadius:'50%',flexShrink:0,animation:'oa-pulse 2.5s ease infinite' },

  // Bottom
  bottomLeft: { position:'absolute',bottom:14,left:14,zIndex:10 },
  floorPicker: { display:'flex',gap:2,padding:3,borderRadius:12 },
  floorBtn: { padding:'7px 16px',background:'none',border:'none',borderRadius:9,fontSize:13,fontWeight:700,fontFamily:MONO,color:T.muted },
  floorBtnActive: { color:T.accent,background:T.accentBg },
  bottomRight: { position:'absolute',bottom:14,right:14,zIndex:10 },
  zoomStack: { display:'flex',flexDirection:'column',alignItems:'center',borderRadius:12,overflow:'hidden' },
  zoomBtn: { width:38,height:38,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',fontSize:18,fontWeight:300,fontFamily:FONT,color:T.sec },
  fab: { position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',zIndex:10,display:'flex',alignItems:'center',gap:8,padding:'12px 24px',background:T.accent,color:'#0c1018',border:'none',borderRadius:16,fontSize:14,fontWeight:700,fontFamily:FONT,boxShadow:'0 4px 24px rgba(56,189,248,.25)' },

  // Overlay
  overlay: { position:'absolute',inset:0,zIndex:50,background:'rgba(0,0,0,.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:24 },

  // ─── Browse panel ───
  browsePanel: { width:'90%',maxWidth:1100,height:'85vh',borderRadius:20,display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 32px 100px rgba(0,0,0,.5)' },
  bpHeader: { padding:'16px 20px 12px',borderBottom:`1px solid ${T.border}`,flexShrink:0 },
  bpSearchRow: { display:'flex',alignItems:'center',gap:10,color:T.sec },
  bpInput: { flex:1,background:'none',border:'none',outline:'none',color:T.text,fontSize:15,fontWeight:500,fontFamily:FONT },
  bpDivider: { width:1,height:20,background:T.border },
  bpToolbar: { display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:12 },
  bpGroupRow: { display:'flex',alignItems:'center',gap:5 },
  bpGroupLabel: { fontSize:10,fontWeight:700,color:T.muted,textTransform:'uppercase',letterSpacing:'.06em',marginRight:4 },
  bpCount: { fontSize:11,color:T.muted,fontWeight:500 },
  bpBody: { flex:1,overflowY:'auto',padding:20 },
  bpPeopleSection: { marginBottom:24 },
  bpSectionTitle: { display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:700,color:T.sec,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10 },
  bpPeopleGrid: { display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:6 },

  pill: { padding:'5px 12px',fontSize:11,fontWeight:600,background:'rgba(255,255,255,.04)',border:`1px solid ${T.border}`,borderRadius:8,color:T.sec,fontFamily:FONT },
  pillActive: { background:T.accentBg,borderColor:T.accentBorder,color:T.accent },
  pillSm: { padding:'3px 9px',fontSize:10,fontWeight:600,background:'rgba(255,255,255,.03)',border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontFamily:FONT },
  pillSmActive: { background:T.accentBg,borderColor:T.accentBorder,color:T.accent },

  // Grouped grid
  groupedGrid: { display:'flex',flexDirection:'column',gap:24 },
  group: {},
  groupHeader: { display:'flex',alignItems:'center',gap:8,marginBottom:10 },
  groupLabel: { fontSize:12,fontWeight:700,color:T.sec,textTransform:'uppercase',letterSpacing:'.04em' },
  groupCount: { fontSize:10,fontWeight:600,color:T.muted,background:'rgba(255,255,255,.04)',padding:'1px 7px',borderRadius:10 },
  grid: { display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:6 },
  gridCompact: { gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))',gap:4 },

  // Card
  card: { display:'flex',flexDirection:'column',gap:6,padding:'12px 14px',background:'rgba(255,255,255,.02)',border:`1px solid ${T.border}`,borderRadius:12,textAlign:'left',fontFamily:FONT,color:T.text },
  cardSelected: { borderColor:T.accent,background:T.accentBg,boxShadow:`0 0 0 1px ${T.accent}40` },
  cardTop: { display:'flex',justifyContent:'space-between',alignItems:'flex-start' },
  cardNameRow: { display:'flex',alignItems:'center',gap:7 },
  statusDot: { width:7,height:7,borderRadius:'50%',flexShrink:0 },
  cardName: { fontSize:13,fontWeight:650,lineHeight:1.3 },
  cardLevel: { fontSize:10,fontWeight:700,fontFamily:MONO,color:T.accent,background:T.accentBg,padding:'2px 6px',borderRadius:4,flexShrink:0 },
  cardBottom: { display:'flex',alignItems:'center',gap:8 },
  cardKind: { fontSize:11,color:T.muted,fontWeight:500 },
  cardCap: { display:'flex',alignItems:'center',gap:4,fontSize:11,color:T.sec,fontWeight:500 },
  cardDept: { fontSize:10,color:T.muted,fontWeight:500,marginTop:-2 },

  // Person
  personRow: { display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'rgba(255,255,255,.02)',border:`1px solid ${T.border}`,borderRadius:12,fontFamily:FONT,color:T.text,textAlign:'left' },
  personAv: { width:30,height:30,borderRadius:'50%',background:`linear-gradient(135deg,rgba(56,189,248,.2),rgba(56,189,248,.05))`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:T.accent,flexShrink:0 },
  personInfo: { flex:1,display:'flex',flexDirection:'column',gap:1,minWidth:0 },

  // ─── Route panel ───
  routePanel: { width:'92%',maxWidth:1200,height:'88vh',borderRadius:20,display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 32px 100px rgba(0,0,0,.5)' },
  rpHeader: { display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',borderBottom:`1px solid ${T.border}`,flexShrink:0,gap:12,flexWrap:'wrap' },
  rpColumns: { flex:1,display:'flex',overflow:'hidden',minHeight:0 },
  rpCol: { flex:1,display:'flex',flexDirection:'column',overflow:'hidden',borderRight:`1px solid ${T.border}` },
  rpColHeader: { display:'flex',alignItems:'flex-start',gap:10,padding:'14px 16px',borderBottom:`1px solid ${T.border}`,flexShrink:0 },
  rpColDot: { paddingTop:2,flexShrink:0 },
  rpColLabel: { fontSize:10,fontWeight:700,color:T.muted,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4 },
  rpSelected: { display:'flex',alignItems:'center',gap:7,padding:'6px 10px',background:T.accentBg,border:`1px solid ${T.accentBorder}`,borderRadius:8,marginTop:4 },
  rpSelectedName: { fontSize:13,fontWeight:650 },
  rpSelectedLevel: { fontSize:10,fontWeight:700,fontFamily:MONO,color:T.accent,marginLeft:'auto' },
  rpClearBtn: { width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,.06)',border:'none',borderRadius:5,color:T.muted,marginLeft:4,flexShrink:0 },
  rpColSearch: { display:'flex',alignItems:'center',gap:7,padding:'8px 14px',borderBottom:`1px solid ${T.border}`,color:T.muted,flexShrink:0 },
  rpColInput: { flex:1,background:'none',border:'none',outline:'none',color:T.text,fontSize:12,fontFamily:FONT },
  rpColToolbar: { display:'flex',alignItems:'center',gap:5,padding:'8px 14px',borderBottom:`1px solid ${T.border}`,flexShrink:0 },
  rpColBody: { flex:1,overflowY:'auto',padding:12 },
  rpSwapCol: { display:'flex',alignItems:'center',paddingTop:60,flexShrink:0 },
  rpSwapBtn: { width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,.04)',border:`1px solid ${T.border}`,borderRadius:10,color:T.muted,margin:'-1px' },

  // Route result
  rpResult: { padding:'16px 20px',borderTop:`1px solid ${T.border}`,flexShrink:0,display:'flex',gap:20,alignItems:'flex-start',flexWrap:'wrap' },
  rrHero: { display:'flex',alignItems:'center',gap:14,flex:'1 1 400px',flexWrap:'wrap' },
  rrIcon: { width:42,height:42,borderRadius:12,background:T.accent,color:'#0c1018',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 },
  rrMain: { display:'flex',flexDirection:'column' },
  rrDist: { fontSize:22,fontWeight:800,fontFamily:MONO,letterSpacing:'-.02em' },
  rrTime: { fontSize:11,color:T.sec },
  rrPath: { display:'flex',alignItems:'center',gap:6,fontSize:11,color:T.sec,fontWeight:500,width:'100%' },
  rrStats: { display:'flex',gap:16,marginTop:4,width:'100%' },
  rrStat: { display:'flex',flexDirection:'column',alignItems:'center',gap:1 },
  rrStatV: { fontSize:15,fontWeight:800,fontFamily:MONO,lineHeight:1,display:'flex',alignItems:'center' },
  rrStatL: { fontSize:9,fontWeight:600,color:T.muted,textTransform:'uppercase',letterSpacing:'.05em' },
  rrDirections: { flex:'1 1 300px',display:'flex',flexDirection:'column',gap:0 },
  rrStep: { display:'flex',alignItems:'flex-start',gap:10,padding:'6px 0' },
  rrStepN: { width:22,height:22,borderRadius:'50%',background:'rgba(255,255,255,.05)',border:`1px solid ${T.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0,color:T.sec },
  rrStepT: { fontSize:12,color:T.sec,lineHeight:1.5,paddingTop:2 },

  // Buttons
  accentBtn: { display:'inline-flex',alignItems:'center',gap:7,padding:'10px 18px',background:T.accent,color:'#0c1018',border:'none',borderRadius:12,fontSize:13,fontWeight:700,fontFamily:FONT },
  ghostBtn: { display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,padding:'9px 14px',background:'none',color:T.sec,border:`1px solid ${T.border}`,borderRadius:12,fontSize:12,fontWeight:600,fontFamily:FONT },
  iconBtn: { width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,.04)',border:'none',borderRadius:8,color:T.sec,flexShrink:0 },

  // Detail float
  detailFloat: { position:'absolute',top:68,right:14,zIndex:20,width:300,borderRadius:18,padding:18,display:'flex',flexDirection:'column',gap:12,boxShadow:'0 16px 60px rgba(0,0,0,.35)',maxHeight:'calc(100vh - 90px)',overflowY:'auto' },
  statusPill: { display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',fontSize:11,fontWeight:600,borderRadius:20 },

  // Ops
  opsPanel: { position:'absolute',top:60,right:14,zIndex:40,width:340,borderRadius:18,boxShadow:'0 16px 60px rgba(0,0,0,.4)',maxHeight:'calc(100vh - 80px)',overflow:'hidden',display:'flex',flexDirection:'column' },

  // Checkbox
  checkRow: { display:'flex',alignItems:'center',gap:7,cursor:'pointer',userSelect:'none',fontSize:12,color:T.sec,fontWeight:500 },
  checkBox: { width:15,height:15,borderRadius:4,border:`1.5px solid rgba(255,255,255,.15)`,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',transition:'all .12s',color:'#0c1018',flexShrink:0 },
  checkBoxOn: { background:T.accent,borderColor:T.accent },
};

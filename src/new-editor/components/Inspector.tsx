import type { CanonicalOpening, CanonicalRoom } from "../../lib/types";
import { useRef, useState } from "react";
import { useNewEditorStore } from "../state/editorStore";
import { prepareReferenceImage } from "../model/referenceImage";

interface Props {
  selectedRoom: CanonicalRoom | null;
  selectedOpening: CanonicalOpening | null;
}

export const Inspector = ({ selectedRoom, selectedOpening }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mergeDistance, setMergeDistance] = useState("0.2");
  const [alignDistance, setAlignDistance] = useState("0.2");
  const {
    activeLevel,
    guides,
    viewport,
    hoveredSnap,
    referenceImage,
    setSelection,
    setReferenceImage,
    updateRoomFields,
    updateOpeningFields,
    mergeNearbyVertices,
    alignVerticesToGuides,
    deleteOpening,
  } = useNewEditorStore();
  const roomOpenings = selectedRoom?.openings ?? [];

  const handleReferenceFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReferenceImage({
      isLoading: true,
      error: null,
      sourceName: file.name,
    });

    prepareReferenceImage(file)
      .then(({ url, naturalWidth, naturalHeight }) => {
        setReferenceImage({
          src: url,
          naturalWidth,
          naturalHeight,
          localX: 0,
          localY: 0,
          localWidth: 54,
          isLoading: false,
          error: null,
          sourceName: file.name,
        });
      })
      .catch((error) => {
        setReferenceImage({
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    event.target.value = "";
  };

  return (
    <aside className="ne-inspector">
      <div className="ne-panel-title">Selection</div>
      <div className="ne-panel-card">
        {selectedOpening && selectedRoom ? (
          <>
            <div className="ne-kv"><span>Room</span><strong>{selectedRoom.name}</strong></div>
            <div className="ne-kv"><span>Connects To</span><strong>{selectedOpening.connectsTo || "outside"}</strong></div>
            <label className="ne-field">
              <span>Type</span>
              <select
                className="ne-select"
                value={selectedOpening.kind}
                onChange={(event) =>
                  updateOpeningFields(selectedRoom.id, selectedOpening.id, {
                    kind: event.target.value as CanonicalOpening["kind"],
                  })
                }
              >
                <option value="door">door</option>
                <option value="opening">opening</option>
              </select>
            </label>
            <label className="ne-field">
              <span>Width</span>
              <input
                className="ne-input"
                type="number"
                step="0.1"
                min="0.2"
                value={selectedOpening.width}
                onChange={(event) =>
                  updateOpeningFields(selectedRoom.id, selectedOpening.id, {
                    width: Number(event.target.value),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="ne-btn-danger"
              onClick={() => deleteOpening(selectedRoom.id, selectedOpening.id)}
            >
              Delete opening
            </button>
          </>
        ) : selectedRoom ? (
          <>
            <label className="ne-field">
              <span>Name</span>
              <input
                className="ne-input"
                value={selectedRoom.name}
                onChange={(event) => updateRoomFields(selectedRoom.id, { name: event.target.value })}
              />
            </label>
            <label className="ne-field">
              <span>Kind</span>
              <select
                className="ne-select"
                value={selectedRoom.kind}
                onChange={(event) =>
                  updateRoomFields(selectedRoom.id, {
                    kind: event.target.value as CanonicalRoom["kind"],
                  })
                }
              >
                <option value="room">room</option>
                <option value="meeting_room">meeting_room</option>
                <option value="amenity">amenity</option>
              </select>
            </label>
            <div className="ne-kv"><span>Vertices</span><strong>{selectedRoom.polygon.length}</strong></div>
            <label className="ne-field">
              <span>Department</span>
              <input
                className="ne-input"
                value={selectedRoom.department}
                onChange={(event) => updateRoomFields(selectedRoom.id, { department: event.target.value })}
              />
            </label>
            <label className="ne-field">
              <span>Subtitle</span>
              <input
                className="ne-input"
                value={selectedRoom.subtitle}
                onChange={(event) => updateRoomFields(selectedRoom.id, { subtitle: event.target.value })}
              />
            </label>
          </>
        ) : (
          <div className="ne-empty">No selection yet. Click a room to inspect it. This panel will later host edge, opening, and document inspectors.</div>
        )}
      </div>
      {selectedRoom && (
        <>
          <div className="ne-panel-title">Doors</div>
          <div className="ne-panel-card">
            {roomOpenings.length > 0 ? (
              <div className="ne-opening-list">
                {roomOpenings.map((opening) => (
                  <div
                    key={opening.id}
                    role="button"
                    tabIndex={0}
                    className={
                      opening.id === selectedOpening?.id
                        ? "ne-opening-row is-selected"
                        : "ne-opening-row"
                    }
                    onClick={() => setSelection(selectedRoom.id, opening.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelection(selectedRoom.id, opening.id);
                      }
                    }}
                  >
                    <div className="ne-opening-main">
                      <strong>{opening.kind}</strong>
                      <span>{opening.width.toFixed(2)} m</span>
                    </div>
                    <div className="ne-opening-meta">
                      <span>{opening.connectsTo ? `to ${opening.connectsTo}` : "to outside"}</span>
                      <span>{opening.point[0].toFixed(2)}, {opening.point[1].toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ne-empty">No doors or openings in this room yet.</div>
            )}
          </div>
        </>
      )}
      <div className="ne-panel-title">Reference</div>
      <div className="ne-panel-card">
        <button
          type="button"
          className="ne-btn-secondary"
          onClick={() => fileRef.current?.click()}
          disabled={referenceImage.isLoading}
        >
          {referenceImage.src ? "Replace image" : "Upload image"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="ne-file-input"
          onChange={handleReferenceFile}
        />
        {referenceImage.isLoading && (
          <div className="ne-empty">Processing image...</div>
        )}
        {referenceImage.error && (
          <div className="ne-error">{referenceImage.error}</div>
        )}
        {referenceImage.src ? (
          <>
            <div className="ne-kv"><span>File</span><strong>{referenceImage.sourceName || "reference"}</strong></div>
            <div className="ne-kv"><span>Source size</span><strong>{referenceImage.naturalWidth} x {referenceImage.naturalHeight}</strong></div>
            <label className="ne-field">
              <span>Opacity</span>
              <input
                className="ne-range"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={referenceImage.opacity}
                onChange={(event) => setReferenceImage({ opacity: Number(event.target.value) })}
              />
            </label>
            <label className="ne-field">
              <span>Width</span>
              <input
                className="ne-input"
                type="number"
                min="1"
                step="0.5"
                value={referenceImage.localWidth}
                onChange={(event) => setReferenceImage({ localWidth: Number(event.target.value) })}
              />
            </label>
            <label className="ne-field">
              <span>X</span>
              <input
                className="ne-input"
                type="number"
                step="0.5"
                value={referenceImage.localX}
                onChange={(event) => setReferenceImage({ localX: Number(event.target.value) })}
              />
            </label>
            <label className="ne-field">
              <span>Y</span>
              <input
                className="ne-input"
                type="number"
                step="0.5"
                value={referenceImage.localY}
                onChange={(event) => setReferenceImage({ localY: Number(event.target.value) })}
              />
            </label>
            <button
              type="button"
              className="ne-btn-danger"
              onClick={() =>
                setReferenceImage({
                  src: null,
                  sourceName: null,
                  naturalWidth: 0,
                  naturalHeight: 0,
                  error: null,
                  isLoading: false,
                })
              }
            >
              Remove image
            </button>
          </>
        ) : (
          <div className="ne-empty">Reference image is rendered under the plan and follows the same zoom and pan.</div>
        )}
      </div>
      <div className="ne-panel-title">Cleanup</div>
      <div className="ne-panel-card">
        <div className="ne-empty">Merge close room vertices on {activeLevel}. All points within the distance threshold are collapsed to one averaged point.</div>
        <label className="ne-field">
          <span>Merge distance</span>
          <input
            className="ne-input"
            type="number"
            min="0.01"
            step="0.01"
            value={mergeDistance}
            onChange={(event) => setMergeDistance(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="ne-btn-secondary"
          onClick={() => mergeNearbyVertices(Number(mergeDistance))}
        >
          Merge nearby points
        </button>
        <div className="ne-empty">Align room vertices on {activeLevel} to nearby guides, guide endpoints, and guide intersections.</div>
        <div className="ne-kv"><span>Guides</span><strong>{guides.length}</strong></div>
        <label className="ne-field">
          <span>Align distance</span>
          <input
            className="ne-input"
            type="number"
            min="0.01"
            step="0.01"
            value={alignDistance}
            onChange={(event) => setAlignDistance(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="ne-btn-secondary"
          onClick={() => alignVerticesToGuides(Number(alignDistance))}
          disabled={guides.length === 0}
        >
          Align points to guides
        </button>
      </div>
      <div className="ne-panel-title">Viewport</div>
      <div className="ne-panel-card">
        <div className="ne-kv"><span>Zoom</span><strong>{viewport.zoom.toFixed(1)} px</strong></div>
        <div className="ne-kv"><span>Offset</span><strong>{viewport.offsetX.toFixed(0)}, {viewport.offsetY.toFixed(0)}</strong></div>
        <div className="ne-kv">
          <span>Hover snap</span>
          <strong>{hoveredSnap ? hoveredSnap.kind : "none"}</strong>
        </div>
      </div>
    </aside>
  );
};

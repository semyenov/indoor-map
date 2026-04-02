import { lazy, Suspense } from "react";

const AtlasV4 = lazy(() => import("./AtlasV4"));
const NewEditorApp = lazy(() =>
  import("./new-editor/NewEditorApp").then((m) => ({ default: m.NewEditorApp })),
);

export default function App() {
  const isEditor = window.location.pathname === "/editor" || window.location.pathname === "/new-editor";
  const isNewEditor = window.location.pathname === "/new-editor";
  return (
    <Suspense fallback={null}>
      {isEditor ? <NewEditorApp /> : isNewEditor ? <NewEditorApp /> : <AtlasV4 />}
    </Suspense>
  );
}

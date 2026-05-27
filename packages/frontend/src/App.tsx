import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.tsx";
import OnboardingDialog from "./components/OnboardingDialog.tsx";
import { ToastProvider } from "./components/Toast.tsx";

const CatalogView = lazy(() => import("./components/CatalogView.tsx"));
const ComicDetail = lazy(() => import("./components/ComicDetail.tsx"));
const DownloadManager = lazy(() => import("./components/DownloadManager.tsx"));
const SourceManager = lazy(() => import("./components/SourceManager.tsx"));
const LibraryView = lazy(() => import("./components/LibraryView.tsx"));
const ComicReader = lazy(() => import("./components/ComicReader.tsx"));

export default function App() {
  return (
    <ToastProvider>
      <OnboardingDialog />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<CatalogView />} />
          <Route path="/catalog/:id" element={<ComicDetail />} />
          <Route path="/downloads" element={<DownloadManager />} />
          <Route path="/sources" element={<SourceManager />} />
          <Route path="/library" element={<LibraryView />} />
          <Route path="/library/read/:id" element={<ComicReader />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

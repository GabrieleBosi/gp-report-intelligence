import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router";
import { ModeBanner } from "./components/mode-banner.tsx";
import { OwnerAccess } from "./components/owner-access.tsx";
import { DocumentsPage } from "./pages/documents.tsx";
import { PortfolioPage } from "./pages/portfolio.tsx";
import { ReviewQueuePage } from "./pages/review-queue.tsx";
import { RunPage } from "./pages/run.tsx";

// The showcase pages load on demand: the documents and reports they carry stay out of the main bundle.
const page = <K extends string>(load: () => Promise<Record<K, () => React.JSX.Element>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const AboutPage = page(() => import("./pages/about.tsx"), "AboutPage");
const TourPage = page(() => import("./pages/tour.tsx"), "TourPage");
const EvalsPage = page(() => import("./pages/evals.tsx"), "EvalsPage");
const DecisionsPage = page(() => import("./pages/decisions.tsx"), "DecisionsPage");
const ProcessPage = page(() => import("./pages/process.tsx"), "ProcessPage");
const DocPage = page(() => import("./pages/doc.tsx"), "DocPage");

// Links to a section ("/decisions#posting", "/docs/SPEC-evals.md#runner-and-gate") land on it, also on a fresh load;
// other navigations start at the top.
function ScrollToHash() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return; }
    // The section may not exist yet (a lazy page, a document still loading): wait for it to appear, for up to 10 s.
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* a malformed escape: look the raw hash up instead */ }
    const scroll = () => { const el = document.getElementById(id); el?.scrollIntoView(); return el !== null; };
    if (scroll()) return;
    const observer = new MutationObserver(() => { if (scroll()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), 10_000);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [pathname, hash]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToHash />
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <ModeBanner />
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 py-4">
            <div>
              <Link to="/" className="text-lg font-semibold hover:text-slate-700">GP Report Intelligence</Link>
              <p className="text-sm text-slate-500">
                Document intelligence for private equity fund reports · case-study prototype, synthetic data only
              </p>
              <div className="mt-1"><OwnerAccess /></div>
            </div>
            <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
              <NavLink to="/" end className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>Documents</NavLink>
              <NavLink to="/review" className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>Review queue</NavLink>
              <NavLink to="/portfolio" className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>Portfolio system</NavLink>
              <span aria-hidden="true" className="hidden text-slate-300 sm:inline">|</span>
              <NavLink to="/about" className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>How it works</NavLink>
              <NavLink to="/tour" className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>Tour</NavLink>
              <NavLink to="/evals" className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>Evals</NavLink>
              <NavLink to="/decisions" className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>Decisions</NavLink>
              <NavLink to="/process" className={({ isActive }) => (isActive ? "text-slate-900 underline underline-offset-4" : "text-slate-600 hover:text-slate-900")}>How it was built</NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">
          <Suspense fallback={<p role="status" className="text-sm text-slate-500">Loading the page…</p>}>
          <Routes>
            <Route path="/" element={<DocumentsPage />} />
            <Route path="/runs/:runId" element={<RunPage />} />
            <Route path="/review" element={<ReviewQueuePage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/tour" element={<TourPage />} />
            <Route path="/evals" element={<EvalsPage />} />
            <Route path="/decisions" element={<DecisionsPage />} />
            <Route path="/process" element={<ProcessPage />} />
            <Route path="/docs/*" element={<DocPage />} />
            <Route path="*" element={<p className="text-sm text-slate-600">Page not found. <Link className="underline" to="/">Back to documents</Link></p>} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}

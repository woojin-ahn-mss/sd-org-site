// Main app entry — router + sidebar + theme + tweaks
const { useState: useS, useEffect: useE } = React;
const SB = window.UI.Sidebar;

const TWEAKS_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark"
}/*EDITMODE-END*/;

function App() {
  // Hash-based routing for shareability
  const [active, setActive] = useS(() => {
    const h = location.hash.replace("#", "");
    return h && PAGES[h] ? h : "home";
  });
  const [theme, setTheme] = useS(TWEAKS_DEFAULTS.theme || "dark");
  const [tweaksOpen, setTweaksOpen] = useS(false);

  useE(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useE(() => {
    location.hash = active;
  }, [active]);

  // Listen for hash changes (back/forward)
  useE(() => {
    const onHash = () => {
      const h = location.hash.replace("#", "");
      if (h && PAGES[h]) setActive(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Tweaks panel host protocol
  useE(() => {
    const handler = (e) => {
      if (e?.data?.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e?.data?.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  const setT = (next) => {
    setTheme(next);
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { theme: next } }, "*");
  };

  const PageComp = PAGES[active] || PAGES.home;

  return (
    <div className="app">
      <SB active={active} onNav={setActive} theme={theme} setTheme={setT} />
      <main className="main">
        <PageComp onNav={setActive} />
      </main>

      {tweaksOpen && window.TweaksPanel && (
        <window.TweaksPanel title="Tweaks" onClose={() => {
          setTweaksOpen(false);
          window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*");
        }}>
          <window.TweakSection title="테마">
            <window.TweakRadio label="모드"
              options={[{ label: "다크", value: "dark" }, { label: "라이트", value: "light" }]}
              value={theme} onChange={setT}
            />
          </window.TweakSection>
        </window.TweaksPanel>
      )}
    </div>
  );
}

const PAGES = {
  home: window.HomePage,
  roadmap: window.RoadmapPage,
  progress: window.ProgressPage,
  resource: window.ResourcePage,
  performance: window.PerformancePage,
  "roadmap-plan": window.RoadmapPlanPage,
  fasttrack: window.FasttrackPage,
  etr: window.EtrPage,
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

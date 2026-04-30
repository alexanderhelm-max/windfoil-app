import Dashboard from '@/components/Dashboard';

export default function Page() {
  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌬️</span>
            <div>
              <h1 className="font-bold text-lg leading-tight text-white">
                Wind Foil Conditions
              </h1>
              <p className="text-slate-400 text-xs">Swedish West Coast · Varberg to Uddevalla</p>
            </div>
          </div>
          <div className="text-slate-500 text-xs hidden sm:block">Auto-refreshes every 5 min</div>
        </div>
      </header>

      <div className="bg-slate-800/50 border-b border-slate-700/50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
            Too little (&lt;4 m/s)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />
            OK (4–6 m/s)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
            Great (6–13 m/s)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" />
            Crazy fun (&gt;13 m/s)
          </span>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-slate-500 hidden sm:inline">Good direction: S–NW · Other directions: +1 m/s on all thresholds</span>
        </div>
      </div>

      <main>
        <Dashboard />
      </main>

      <footer className="border-t border-slate-800 mt-8 py-4 text-center text-slate-600 text-xs">
        Data: SMHI Open Data · VIVA Sjöfartsverket · Updates every 5 min
      </footer>
    </div>
  );
}

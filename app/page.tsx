import Dashboard from '@/components/Dashboard';

export default function Page() {
  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl shrink-0">🌬️</span>
            <h1 className="font-bold text-base sm:text-lg leading-tight text-white truncate">
              Swedish Wind Foil Opportunities
            </h1>
          </div>
          <div className="text-slate-500 text-xs hidden md:block shrink-0 ml-3">Auto-refreshes every 5 min</div>
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

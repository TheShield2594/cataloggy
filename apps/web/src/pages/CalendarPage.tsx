import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, List, LayoutGrid } from "lucide-react";
import { api, CalendarEntry, SearchResult } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { Poster } from "../components/Poster";
import { useToast } from "../hooks/useToast";

type ViewMode = "agenda" | "month";
const AGENDA_RANGES = [14, 30, 60, 90] as const;
const MAX_CALENDAR_DAYS = 90;

function toSearchResult(entry: CalendarEntry): SearchResult {
  return {
    imdbId: entry.seriesImdbId,
    type: "series",
    name: entry.seriesName,
    year: null,
    poster: entry.poster,
    description: entry.overview,
    genres: [],
    rating: null,
    inWatchlist: false,
    inCollection: false,
    lists: [],
  };
}

function parseAirDate(airDate: string): Date {
  const [y, m, d] = airDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabelFor(airDate: Date, today: Date): string {
  const diffDays = Math.round((startOfDay(airDate).getTime() - startOfDay(today).getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return airDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarPage() {
  const [view, setView] = useState<ViewMode>("agenda");
  const [agendaDays, setAgendaDays] = useState<(typeof AGENDA_RANGES)[number]>(30);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading } = useDetailPanel();

  const today = useMemo(() => startOfDay(new Date()), []);

  // How many days ahead to request from the API depends on the active view:
  // agenda uses the selected range directly, month view needs enough days to
  // cover the last day of the displayed month (capped at what the API allows).
  const daysNeeded = useMemo(() => {
    if (view === "agenda") return agendaDays;
    const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
    const diff = Math.round((startOfDay(monthEnd).getTime() - today.getTime()) / 86_400_000);
    return Math.min(Math.max(diff, 1), MAX_CALENDAR_DAYS);
  }, [view, agendaDays, monthCursor, today]);

  // The displayed month is entirely beyond what the API can return.
  const monthOutOfRange = useMemo(() => {
    if (view !== "month") return false;
    const monthStart = startOfMonth(monthCursor);
    const diff = Math.round((monthStart.getTime() - today.getTime()) / 86_400_000);
    return diff > MAX_CALENDAR_DAYS;
  }, [view, monthCursor, today]);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCalendar(days);
      setEntries(res.calendar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (monthOutOfRange) {
      setEntries([]);
      setLoading(false);
      return;
    }
    void load(daysNeeded);
  }, [daysNeeded, monthOutOfRange, load]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const key = dateKey(parseAirDate(entry.airDate));
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [entries]);

  const agendaGroups = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.airDate.localeCompare(b.airDate));
    const groups: { label: string; date: Date; entries: CalendarEntry[] }[] = [];
    for (const entry of sorted) {
      const airDate = parseAirDate(entry.airDate);
      const label = dateLabelFor(airDate, today);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.entries.push(entry);
      else groups.push({ label, date: airDate, entries: [entry] });
    }
    return groups;
  }, [entries, today]);

  const monthWeeks = useMemo(() => {
    const first = monthCursor;
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const lastDayOfMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const gridEnd = new Date(lastDayOfMonth);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

    const weeks: Date[][] = [];
    const cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  }, [monthCursor]);

  const handleSelect = (entry: CalendarEntry) => setSelectedItem(toSearchResult(entry));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-6 w-6" style={{ color: "var(--text-dim)" }} />
          <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Calendar</h2>
        </div>

        <div className="relative inline-flex rounded-full p-0.5" style={{ background: "var(--surface-strong)", border: "1px solid var(--border)" }}>
          {([
            { key: "agenda" as const, label: "Agenda", icon: List },
            { key: "month" as const, label: "Month", icon: LayoutGrid },
          ]).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setView(opt.key)}
              className="relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
              style={view === opt.key ? { background: "var(--accent)", color: "var(--on-accent)" } : { color: "var(--text-dim)" }}
            >
              <opt.icon className="h-3.5 w-3.5" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-rose-600 text-sm">{error}</p>
      )}

      {view === "agenda" ? (
        <>
          <div className="flex items-center gap-1.5">
            {AGENDA_RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setAgendaDays(d)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  agendaDays === d ? "bg-claw-500 text-claw-on" : "hover:text-[var(--text)]"
                }`}
                style={agendaDays === d ? undefined : { color: "var(--text-mute)", border: "1px solid var(--border)" }}
              >
                {d} Days
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-20 rounded-xl" />
              ))}
            </div>
          ) : agendaGroups.length === 0 ? (
            <div className="rounded-2xl p-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
              <CalendarDays className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
              <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
                No upcoming episodes in the next {agendaDays} days for your in-progress series.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {agendaGroups.map((group) => (
                <div key={group.label} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
                    {group.label}
                  </h3>
                  {group.entries.map((entry) => (
                    <button
                      key={`${entry.seriesImdbId}-s${entry.season}e${entry.episode}`}
                      type="button"
                      onClick={() => handleSelect(entry)}
                      className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
                      style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
                    >
                      <div className="h-16 w-11 flex-none overflow-hidden rounded-lg" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
                        <Poster src={entry.poster ?? undefined} alt={entry.seriesName} className="h-full w-full" sizes="44px" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{entry.seriesName}</p>
                        <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-dim)" }}>
                          S{entry.season}:E{entry.episode}{entry.episodeName ? ` — ${entry.episodeName}` : ""}
                        </p>
                        {entry.overview && (
                          <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-mute)" }}>{entry.overview}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMonthCursor((prev) => addMonths(prev, -1))}
                aria-label="Previous month"
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-strong)]"
                style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setMonthCursor((prev) => addMonths(prev, 1))}
                aria-label="Next month"
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-strong)]"
                style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setMonthCursor(startOfMonth(new Date()))}
                className="ml-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-strong)]"
                style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
              >
                Today
              </button>
            </div>
            <p className="text-lg font-bold" style={{ color: "var(--text)" }}>
              {monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </p>
          </div>

          {monthOutOfRange ? (
            <div className="rounded-2xl p-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
              <CalendarDays className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
              <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
                This month is too far out — the calendar only looks {MAX_CALENDAR_DAYS} days ahead.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid var(--border)" }}>
              <div className="grid grid-cols-7" style={{ borderBottom: "1px solid var(--border)" }}>
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="px-2 py-2 text-center text-2xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
                    {label}
                  </div>
                ))}
              </div>
              {loading ? (
                <div className="p-4">
                  <div className="skeleton h-64 rounded-lg" />
                </div>
              ) : (
                <div>
                  {monthWeeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7" style={{ borderTop: wi > 0 ? "1px solid var(--border)" : undefined }}>
                      {week.map((day) => {
                        const inMonth = day.getMonth() === monthCursor.getMonth();
                        const isToday = startOfDay(day).getTime() === today.getTime();
                        const dayEntries = entriesByDate.get(dateKey(day)) ?? [];
                        return (
                          <div
                            key={day.toISOString()}
                            className="min-h-[6.5rem] p-1.5"
                            style={{
                              borderLeft: "1px solid var(--border)",
                              background: inMonth ? undefined : "var(--surface)",
                              opacity: inMonth ? 1 : 0.5,
                            }}
                          >
                            <span
                              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-2xs font-semibold ${isToday ? "bg-claw-500 text-claw-on" : ""}`}
                              style={isToday ? undefined : { color: "var(--text-mute)" }}
                            >
                              {day.getDate()}
                            </span>
                            <div className="mt-1 space-y-1">
                              {dayEntries.slice(0, 2).map((entry) => (
                                <button
                                  key={`${entry.seriesImdbId}-s${entry.season}e${entry.episode}`}
                                  type="button"
                                  onClick={() => handleSelect(entry)}
                                  title={`${entry.seriesName} S${entry.season}:E${entry.episode}`}
                                  className="block w-full truncate rounded px-1 py-0.5 text-left text-2xs font-medium transition-colors hover:opacity-80"
                                  style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}
                                >
                                  {entry.seriesName}
                                </button>
                              ))}
                              {dayEntries.length > 2 && (
                                <p className="px-1 text-2xs" style={{ color: "var(--text-mute)" }}>+{dayEntries.length - 2} more</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
          onHistoryChange={(events) => setPanelHistory(events)}
          onSelectItem={setSelectedItem}
        />
      )}

    </div>
  );
}

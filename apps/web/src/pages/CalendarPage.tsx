import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, List, LayoutGrid, X } from "lucide-react";
import { api, CalendarEntry, SearchResult } from "../api";
import { DetailPanel, useDetailPanel } from "../components/MediaDetailPanel";
import { Poster } from "../components/Poster";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useScrollLock } from "../hooks/useScrollLock";
import { useToast } from "../hooks/useToast";
import { useCachedState } from "../hooks/useCachedState";

type ViewMode = "agenda" | "month";
const AGENDA_RANGES = [14, 30, 60, 90] as const;
const MAX_CALENDAR_DAYS = 90;
// Tailwind's `sm`. Below it a seven-column grid gives each day ~50px, which
// holds nothing legible, so the month view isn't offered at all.
const COMPACT_QUERY = "(max-width: 639px)";
// Entries a month cell shows before collapsing the rest into "+N more".
const MONTH_CELL_ENTRIES = 2;

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

function entryKey(entry: CalendarEntry): string {
  return `${entry.seriesImdbId}-s${entry.season}e${entry.episode}`;
}

function EntryRow({ entry, onSelect }: { entry: CalendarEntry; onSelect: (entry: CalendarEntry) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className="glass-row flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
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
  );
}

/**
 * The month grid can only show a couple of episodes per cell. This is where the
 * rest of them live — without it "+N more" names episodes with no way to reach
 * them.
 */
function DayEntriesModal({
  date,
  entries,
  onSelect,
  onClose,
}: {
  date: Date;
  entries: CalendarEntry[];
  onSelect: (entry: CalendarEntry) => void;
  onClose: () => void;
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>();
  useScrollLock();
  useEscapeKey(onClose);

  const heading = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="overlay-scrim overlay-fade fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-day-modal-title"
        tabIndex={-1}
        className="glass-surface overlay-dialog w-full max-w-md rounded-2xl shadow-sm"
        style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <h2 id="calendar-day-modal-title" className="truncate text-base font-bold" style={{ color: "var(--text)" }}>{heading}</h2>
            <p className="text-xs" style={{ color: "var(--text-mute)" }}>
              {entries.length} {entries.length === 1 ? "episode" : "episodes"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="ml-3 rounded-lg p-1.5 hover:bg-[var(--surface)] hover:text-[var(--text)]"
            style={{ color: "var(--text-mute)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
          {entries.map((entry) => (
            <EntryRow key={entryKey(entry)} entry={entry} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const [view, setView] = useState<ViewMode>("agenda");
  const [agendaDays, setAgendaDays] = useState<(typeof AGENDA_RANGES)[number]>(30);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const { showToast } = useToast();
  const { selectedItem, setSelectedItem, panelHistory, setPanelHistory, panelHistoryLoading, detail: panelDetail, detailLoading: panelDetailLoading } = useDetailPanel();

  const today = useMemo(() => startOfDay(new Date()), []);
  // The month grid needs width the phone doesn't have, so on narrow screens
  // agenda is the only view — the toggle isn't offered either.
  const compact = useMediaQuery(COMPACT_QUERY);
  const activeView: ViewMode = compact ? "agenda" : view;

  // How many days ahead to request from the API depends on the active view:
  // agenda uses the selected range directly, month view needs enough days to
  // cover the last day of the displayed month (capped at what the API allows).
  const daysNeeded = useMemo(() => {
    if (activeView === "agenda") return agendaDays;
    const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
    const diff = Math.round((startOfDay(monthEnd).getTime() - today.getTime()) / 86_400_000);
    return Math.min(Math.max(diff, 1), MAX_CALENDAR_DAYS);
  }, [activeView, agendaDays, monthCursor, today]);

  // Keyed by the range, because the range is part of the question: the agenda's
  // selector and the month grid ask for different spans, and seeding a 7-day
  // answer into a 30-day view would paint the wrong thing for a frame.
  const [entries, setEntries, entriesMeta] = useCachedState<CalendarEntry[]>(
    `calendar:entries:${daysNeeded}`,
    []
  );
  const [loading, setLoading] = useState(!entriesMeta.hadCachedValue);

  // The displayed month is entirely beyond what the API can return.
  const monthOutOfRange = useMemo(() => {
    if (activeView !== "month") return false;
    const monthStart = startOfMonth(monthCursor);
    const diff = Math.round((monthStart.getTime() - today.getTime()) / 86_400_000);
    return diff > MAX_CALENDAR_DAYS;
  }, [activeView, monthCursor, today]);

  // The API only ever returns upcoming episodes, so stepping back past the
  // current month can only ever produce an empty grid.
  const atEarliestMonth = startOfMonth(monthCursor).getTime() <= startOfMonth(today).getTime();

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
    // `setEntries` is bound to the current day range's cache key, so it has to
    // be a dependency — capturing the first range's setter would file every
    // later range's results under the wrong key.
  }, [setEntries]);

  useEffect(() => {
    if (monthOutOfRange) {
      setEntries([]);
      setLoading(false);
      return;
    }
    void load(daysNeeded);
  }, [daysNeeded, monthOutOfRange, load, setEntries]);

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

  // The day list belongs to one month cell; leaving that grid — by paging
  // months, switching view, or narrowing to a phone — leaves it behind too.
  useEffect(() => {
    setOpenDay(null);
  }, [activeView, monthCursor]);

  const handleSelect = (entry: CalendarEntry) => setSelectedItem(toSearchResult(entry));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-6 w-6" style={{ color: "var(--text-dim)" }} />
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Calendar</h1>
        </div>

        {!compact && (
          <div className="relative inline-flex rounded-full p-0.5" style={{ background: "var(--surface-strong)", border: "1px solid var(--border)" }}>
            {([
              { key: "agenda" as const, label: "Agenda", icon: List },
              { key: "month" as const, label: "Month", icon: LayoutGrid },
            ]).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setView(opt.key)}
                aria-pressed={activeView === opt.key}
                className="relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
                style={activeView === opt.key ? { background: "var(--accent)", color: "var(--on-accent)" } : { color: "var(--text-dim)" }}
              >
                <opt.icon className="h-3.5 w-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-rose-600 text-sm">{error}</p>
      )}

      {activeView === "agenda" ? (
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
            <div className="glass-panel rounded-2xl p-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
              <CalendarDays className="mx-auto h-10 w-10" style={{ color: "var(--text-mute)" }} />
              <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
                No upcoming episodes in the next {agendaDays} days.
              </p>
              {/* Which is the expected state for a new install, not a fault —
                  but nothing on screen said so, leaving no way to tell an empty
                  calendar from a broken one. */}
              <p className="mt-1 text-xs" style={{ color: "var(--text-mute)" }}>
                The calendar only tracks series you have already started watching.
              </p>
              <Link to="/search" className="mt-2 inline-block text-sm font-medium text-claw-text underline-offset-2 transition-colors hover:underline">
                Find a series to follow &rarr;
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {agendaGroups.map((group) => (
                <div key={group.label} className="space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
                    {group.label}
                  </h2>
                  {group.entries.map((entry) => (
                    <EntryRow key={entryKey(entry)} entry={entry} onSelect={handleSelect} />
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
                disabled={atEarliestMonth}
                onClick={() => setMonthCursor((prev) => addMonths(prev, -1))}
                aria-label="Previous month"
                aria-describedby={atEarliestMonth ? "calendar-forward-only" : undefined}
                title={atEarliestMonth ? "The calendar only shows upcoming episodes" : undefined}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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

          {atEarliestMonth && (
            <p id="calendar-forward-only" className="-mt-3 text-xs" style={{ color: "var(--text-mute)" }}>
              The calendar is forward-looking — it only lists episodes that haven't aired yet, so earlier months aren't
              available.
            </p>
          )}

          {monthOutOfRange ? (
            <div className="glass-panel rounded-2xl p-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}>
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
                              {dayEntries.slice(0, MONTH_CELL_ENTRIES).map((entry) => (
                                <button
                                  key={entryKey(entry)}
                                  type="button"
                                  onClick={() => handleSelect(entry)}
                                  title={`${entry.seriesName} S${entry.season}:E${entry.episode}`}
                                  className="block w-full truncate rounded px-1 py-0.5 text-left text-2xs font-medium transition-colors hover:opacity-80"
                                  style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}
                                >
                                  {entry.seriesName}
                                </button>
                              ))}
                              {dayEntries.length > MONTH_CELL_ENTRIES && (
                                <button
                                  type="button"
                                  onClick={() => setOpenDay(day)}
                                  aria-label={`Show all ${dayEntries.length} episodes on ${day.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`}
                                  className="block w-full rounded px-1 py-0.5 text-left text-2xs font-medium underline-offset-2 transition-colors hover:bg-[var(--surface-strong)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400"
                                  style={{ color: "var(--text-mute)" }}
                                >
                                  +{dayEntries.length - MONTH_CELL_ENTRIES} more
                                </button>
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

      {openDay && (
        <DayEntriesModal
          date={openDay}
          entries={entriesByDate.get(dateKey(openDay)) ?? []}
          // One overlay at a time: the detail panel replaces the day list
          // rather than stacking on top of it.
          onSelect={(entry) => { setOpenDay(null); handleSelect(entry); }}
          onClose={() => setOpenDay(null)}
        />
      )}

      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          history={panelHistory}
          historyLoading={panelHistoryLoading}
          detail={panelDetail}
          detailLoading={panelDetailLoading}
          onClose={() => setSelectedItem(null)}
          onShowToast={showToast}
          onHistoryChange={(events) => setPanelHistory(events)}
          onSelectItem={setSelectedItem}
        />
      )}

    </div>
  );
}

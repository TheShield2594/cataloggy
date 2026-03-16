import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { Trash2, Film, FolderOpen } from "lucide-react";
import { api, CatalogList } from "../api";

function ListsIndex({ lists, onCreate }: { lists: CatalogList[]; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    await onCreate(name.trim());
    setName("");
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Create custom list"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500">
          Create list
        </button>
      </form>

      {lists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg className="mb-4 h-24 w-24 text-slate-700" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="16" y="20" width="64" height="56" rx="8" stroke="currentColor" strokeWidth="2" />
            <path d="M16 36h64" stroke="currentColor" strokeWidth="2" />
            <rect x="28" y="46" width="40" height="4" rx="2" fill="currentColor" opacity="0.3" />
            <rect x="28" y="56" width="28" height="4" rx="2" fill="currentColor" opacity="0.3" />
            <rect x="28" y="66" width="16" height="4" rx="2" fill="currentColor" opacity="0.3" />
          </svg>
          <p className="text-lg font-medium text-slate-400">No lists yet</p>
          <p className="mt-1 text-sm text-slate-500">Create your first list to start organizing your media.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {lists.map((list) => {
            const posterItems = list.items.slice(0, 4);
            return (
              <Link
                key={list.id}
                to={list.id}
                className="group rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-700 hover:bg-slate-800/80"
              >
                {/* 2x2 poster collage */}
                <div className="mb-3 grid grid-cols-2 gap-1 overflow-hidden rounded-lg" style={{ aspectRatio: "1" }}>
                  {Array.from({ length: 4 }).map((_, i) => {
                    const item = posterItems[i];
                    return (
                      <div key={i} className="bg-slate-800 overflow-hidden">
                        {item ? (
                          <div className="h-full w-full bg-slate-700 flex items-center justify-center">
                            <Film className="h-6 w-6 text-slate-500" />
                          </div>
                        ) : (
                          <div className="h-full w-full bg-slate-800" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="font-medium text-sky-300 group-hover:text-sky-200 font-heading">{list.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {list.kind} &bull; {list.items.length} {list.items.length === 1 ? "item" : "items"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListDetails({
  lists,
  reload,
  onError
}: {
  lists: CatalogList[];
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { listId } = useParams();
  const list = useMemo(() => lists.find((entry) => entry.id === listId), [lists, listId]);

  if (!list) {
    return <p className="text-slate-400">List not found.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-xl font-semibold font-heading">{list.name}</h2>
        <Link to="/lists" className="text-sm text-sky-400 hover:text-sky-300">&larr; Back</Link>
      </div>
      {list.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="mb-3 h-12 w-12 text-slate-600" />
          <p className="text-lg font-medium text-slate-400">This list is empty</p>
          <p className="mt-1 text-sm text-slate-500">Search for titles to add them to this list.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {list.items.map((item) => {
            const title = item.imdbId.replace(/^tt/, "Title ").replace(/(\d+)/, " #$1");
            return (
              <div
                key={`${item.type}:${item.imdbId}`}
                className="group flex gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3"
              >
                {/* Poster placeholder */}
                <div className="flex h-20 w-14 flex-none items-center justify-center rounded-lg bg-slate-800 ring-1 ring-white/5">
                  <Film className="h-6 w-6 text-slate-600" />
                </div>
                <div className="flex flex-1 flex-col justify-between min-w-0">
                  <div>
                    <p className="truncate text-sm font-medium text-slate-200">{title}</p>
                    <p className="text-2xs text-slate-500">{item.type} &bull; {item.imdbId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.removeFromList(list.id, { type: item.type, imdbId: item.imdbId });
                        await reload();
                      } catch (err) {
                        console.error(err);
                        onError(err instanceof Error ? err.message : "Failed to remove list item");
                      }
                    }}
                    className="self-start rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"
                    aria-label="Remove from list"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ListsPage() {
  const [lists, setLists] = useState<CatalogList[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadLists = async () => {
    try {
      const response = await api.getLists();
      setLists(response.lists);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lists");
      throw err;
    }
  };

  useEffect(() => {
    void loadLists().catch((err) => {
      console.error(err);
    });
  }, []);

  const createList = async (name: string) => {
    try {
      await api.createList(name);
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create list");
      throw err;
    }
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-2 text-rose-300">{error}</p>}
      <Routes>
        <Route index element={<ListsIndex lists={lists} onCreate={createList} />} />
        <Route path=":listId" element={<ListDetails lists={lists} reload={loadLists} onError={setError} />} />
      </Routes>
    </div>
  );
}

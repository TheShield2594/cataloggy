import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
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
      <form onSubmit={submit} className="flex gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Create custom list"
          className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
        <button type="submit" className="rounded bg-emerald-600 px-4 py-2">
          Create list
        </button>
      </form>

      <ul className="space-y-2">
        {lists.map((list) => (
          <li key={list.id} className="rounded border border-slate-800 bg-slate-900 p-3">
            <Link to={list.id} className="font-medium text-sky-300">
              {list.name}
            </Link>
            <p className="text-xs text-slate-400">
              {list.kind} • {list.items.length} items
            </p>
          </li>
        ))}
      </ul>
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
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-xl font-semibold">{list.name}</h2>
      {list.items.length === 0 ? (
        <p className="text-sm text-slate-400">No items in this list.</p>
      ) : (
        <ul className="space-y-2">
          {list.items.map((item) => (
            <li key={`${item.type}:${item.imdbId}`} className="flex items-center justify-between rounded bg-slate-800/60 px-3 py-2">
              <span className="text-sm">
                {item.imdbId} ({item.type})
              </span>
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
                className="rounded bg-rose-600 px-2 py-1 text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
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
      {error && <p className="text-rose-300">{error}</p>}
      <Routes>
        <Route index element={<ListsIndex lists={lists} onCreate={createList} />} />
        <Route path=":listId" element={<ListDetails lists={lists} reload={loadLists} onError={setError} />} />
      </Routes>
    </div>
  );
}

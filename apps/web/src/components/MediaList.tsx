import { CatalogMeta } from "../api";

type Props = {
  title: string;
  items: CatalogMeta[];
};

export function MediaList({ title, items }: Props) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No items yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.type}:${item.id}`} className="flex items-center gap-3 rounded bg-slate-800/60 px-3 py-2 text-sm">
              {item.poster ? (
                <img
                  src={item.poster}
                  alt={`${item.name} poster`}
                  className="h-14 w-10 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-14 w-10 shrink-0 rounded bg-slate-700" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-100">{item.name}</p>
                {item.year ? <p className="text-xs text-slate-400">{item.year}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

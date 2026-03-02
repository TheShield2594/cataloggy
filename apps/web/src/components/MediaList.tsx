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
            <li key={`${item.type}:${item.id}`} className="rounded bg-slate-800/60 px-3 py-2 text-sm">
              {item.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

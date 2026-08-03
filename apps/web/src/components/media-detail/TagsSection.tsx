import { useEffect, useState } from "react";
import { Tag as TagIcon, X } from "lucide-react";
import { api } from "../../api";

type Tag = { id: string; name: string; createdAt: string };

export function TagsSection({
  imdbId,
  type,
  onError,
}: {
  imdbId: string;
  type: "movie" | "series" | "episode";
  onError?: (msg: string) => void;
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getItemTags(type, imdbId)
      .then((res) => {
        if (!cancelled) setTags(res.tags);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imdbId, type]);

  const addTag = async () => {
    const name = input.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await api.assignTag(name, type, imdbId);
      const res = await api.getItemTags(type, imdbId);
      setTags(res.tags);
      setInput("");
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to add tag");
    } finally {
      setSaving(false);
    }
  };

  const removeTag = async (tagId: string) => {
    try {
      await api.removeTag(tagId, type, imdbId);
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to remove tag");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-strong)] px-3 py-1.5 text-xs font-medium"
            style={{ color: "var(--text-dim)" }}
          >
            <TagIcon className="h-3 w-3" />
            {tag.name}
            <button type="button" onClick={() => void removeTag(tag.id)} aria-label={`Remove tag ${tag.name}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addTag();
            }
          }}
          placeholder="Add tag..."
          aria-label="Add tag"
          className="w-28 rounded-full bg-transparent px-3 py-1.5 text-xs outline-none"
          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </div>
    </div>
  );
}

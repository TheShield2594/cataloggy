function largestUnit(absSeconds: number): { value: number; unit: "m" | "h" | "d" | "mo" | "y" } | null {
  if (absSeconds < 60) return null;
  const minutes = Math.floor(absSeconds / 60);
  if (minutes < 60) return { value: minutes, unit: "m" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: hours, unit: "h" };
  const days = Math.floor(hours / 24);
  if (days < 30) return { value: days, unit: "d" };
  const months = Math.floor(days / 30);
  if (months < 12) return { value: months, unit: "mo" };
  const years = Math.floor(months / 12);
  return { value: years, unit: "y" };
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  const bucket = largestUnit(seconds);
  return bucket ? `${bucket.value}${bucket.unit} ago` : "just now";
}

export function timeUntil(dateStr: string): string {
  const seconds = Math.floor((new Date(dateStr).getTime() - Date.now()) / 1000);
  const bucket = largestUnit(seconds);
  return bucket ? `in ${bucket.value}${bucket.unit}` : "soon";
}

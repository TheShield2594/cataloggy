import { useEffect, useState } from "react";
import { getGradient, getInitials } from "./carousel-utils";

export function Poster({
  src,
  alt,
  className = "",
}: {
  src?: string;
  alt: string | null | undefined;
  className?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { setLoadFailed(false); }, [src]);

  if (!src || loadFailed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br ${getGradient(alt)} ${className}`}>
        <span className="text-xl font-bold text-white/60 select-none">
          {getInitials(alt)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? "Poster"}
      className={`object-cover ${className}`}
      loading="lazy"
      onError={() => setLoadFailed(true)}
    />
  );
}

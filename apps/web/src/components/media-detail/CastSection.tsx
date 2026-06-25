import { User } from "lucide-react";

export interface CastMember {
  name: string;
  character: string;
  photo: string | null;
}

export function CastSection({ cast, loading }: { cast: CastMember[]; loading: boolean }) {
  if (loading) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>Cast</h3>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-none w-16 space-y-1">
              <div className="skeleton h-16 w-16 rounded-full" />
              <div className="skeleton h-2.5 w-14 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (cast.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
        <User className="h-3.5 w-3.5" /> Cast
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {cast.map((member, i) => (
          <div key={`${i}-${member.name}`} className="flex-none w-16 text-center">
            {member.photo ? (
              <img
                src={member.photo}
                alt={member.name}
                className="h-16 w-16 rounded-full object-cover mx-auto"
                style={{ boxShadow: "0 0 0 1px var(--border)" }}
                loading="lazy"
              />
            ) : (
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center mx-auto"
                style={{ background: "var(--surface-strong)", boxShadow: "0 0 0 1px var(--border)" }}
              >
                <User className="h-6 w-6" style={{ color: "var(--text-mute)" }} />
              </div>
            )}
            <p className="mt-1.5 text-2xs font-medium leading-tight truncate" style={{ color: "var(--text-dim)" }}>{member.name}</p>
            <p className="text-2xs truncate" style={{ color: "var(--text-mute)" }}>{member.character}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

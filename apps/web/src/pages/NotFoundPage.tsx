import { Link } from "react-router";
import { Clapperboard } from "lucide-react";
import { PAGE_TITLE } from "../components/typography";

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Clapperboard className="h-12 w-12" style={{ color: "var(--text-mute)" }} />
      <h1 className={`mt-4 ${PAGE_TITLE}`} style={{ color: "var(--text)" }}>
        Page not found
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        to="/"
        className="btn-primary mt-6"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}

/**
 * The stand-in a poster rail renders while its request is in flight.
 *
 * Continue Watching and Recently Watched each had their own copy, identical
 * except for how many cards they drew and the width of the two caption bars —
 * differences nobody chose and nobody could see, since the bars are grey
 * rectangles.
 */
export function CarouselSkeleton({ count = 5 }: { count?: number | undefined }) {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-none">
          <div className="skeleton aspect-poster w-poster-card rounded-xl" />
          <div className="skeleton mt-2.5 h-4 w-32 rounded" />
          <div className="skeleton mt-1.5 h-3 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

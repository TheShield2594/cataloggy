export function ImdbLogo() {
  return (
    <span
      className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-black leading-none text-black"
      style={{ background: "#F5C518", fontFamily: "Arial Black, Arial, sans-serif" }}
    >
      IMDb
    </span>
  );
}

export function RtLogo({ score }: { score: number }) {
  const isFresh = score >= 60;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Rotten Tomatoes">
      {isFresh ? (
        <>
          <circle cx="9" cy="11" r="6.5" fill="#FA320A" />
          <ellipse cx="9" cy="4.5" rx="1" ry="2" fill="#00C300" transform="rotate(-15 9 4.5)" />
          <ellipse cx="11" cy="3.5" rx="0.8" ry="1.8" fill="#00C300" transform="rotate(15 11 3.5)" />
          <ellipse cx="7" cy="3.5" rx="0.8" ry="1.8" fill="#00C300" transform="rotate(-15 7 3.5)" />
          <circle cx="7" cy="9" r="1.5" fill="#FA6040" opacity="0.5" />
          <circle cx="11.5" cy="11.5" r="1" fill="#FA6040" opacity="0.4" />
        </>
      ) : (
        <>
          <circle cx="9" cy="10" r="6" fill="#69BE28" opacity="0.9" />
          <path d="M6 7 L12 13 M12 7 L6 13" stroke="#3a7a00" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="10" r="3" fill="#69BE28" />
        </>
      )}
    </svg>
  );
}

export function McIcon({ score }: { score: number }) {
  const color = score >= 61 ? "#6ac045" : score >= 40 ? "#ffbd3f" : "#ff4444";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Metacritic">
      <rect width="18" height="18" rx="3" fill={color} />
      <text x="9" y="13" textAnchor="middle" fontSize="11" fontWeight="900" fill="white" fontFamily="Arial Black, Arial, sans-serif">M</text>
    </svg>
  );
}

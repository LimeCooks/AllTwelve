import { brandMarkPaths } from '@/lib/brand-identity.mjs';

/** The shared AllTwelve identity. Geometry is independent of interface scaling. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="alltwelve-brand" aria-label="AllTwelve">
      <svg
        className="alltwelve-mark"
        viewBox="0 0 108 64"
        aria-hidden="true"
        focusable="false"
      >
        {brandMarkPaths.map((d) => (
          <path key={d} d={d} fill="currentColor" />
        ))}
      </svg>
      {!compact && <span className="alltwelve-wordmark">ALLTWELVE</span>}
    </span>
  );
}

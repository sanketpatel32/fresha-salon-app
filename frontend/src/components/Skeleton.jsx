import React from 'react';

/**
 * Skeleton placeholder — a quiet shimmer block matching the final layout.
 *
 *   <Skeleton />                 // a single line
 *   <Skeleton height="180px" />  // a card image area
 *   <Skeleton lines={3} />       // a paragraph
 *
 * The shimmer is driven by .skeleton in index.css (prefers-reduced-motion
 * disables it). Render several of these in the shape of the real content
 * so the layout doesn't jump when data arrives.
 */
export default function Skeleton({ height = '1em', width = '100%', lines = 1, radius = 'var(--radius-xs)', style }) {
  if (lines > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)', ...style }}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{
              height,
              width: i === lines - 1 ? '70%' : width, // last line shorter, like real text
              borderRadius: radius,
            }}
          />
        ))}
      </div>
    );
  }
  return <div className="skeleton" style={{ height, width, borderRadius: radius, ...style }} />;
}

/** A grid of card-shaped skeletons — matches the .grid-cards layout. */
export function SkeletonCardGrid({ count = 6 }) {
  return (
    <div className="grid-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <Skeleton height="132px" radius="0" />
          <div className="card-body">
            <Skeleton height="1.4em" width="60%" />
            <Skeleton height="0.9em" width="85%" />
            <Skeleton height="0.9em" width="70%" />
          </div>
          <div className="card-footer">
            <Skeleton height="2.2em" width="100%" radius="var(--radius-sm)" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Table-shaped skeletons — matches the .premium-table layout. */
export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="table-container">
      <table className="premium-table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}><Skeleton height="0.9em" width="60px" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}><Skeleton height="1em" width={c === 0 ? '120px' : '80px'} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Uploaded product photo for catalog cards, the cart and the quick view.
 *
 * - Loads lazily with low priority: photos never compete with the hero image
 *   for bandwidth, and React does not emit `<link rel="preload">` for them.
 * - A missing or broken file shows `fallback` (the tire illustration or the
 *   wheel placeholder) instead of the browser's broken-image icon. An error
 *   that happened before hydration has no React handler yet, so the image is
 *   checked once after mounting as well.
 */
export function ProductPhoto({
  src,
  alt,
  className,
  fallback,
}: {
  src: string;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  const imageReference = useRef<HTMLImageElement>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    const image = imageReference.current;
    // Only a finished request can be judged; a lazy image not loaded yet
    // reports its error through onError later. decode() rejects for broken
    // files and, unlike naturalWidth, accepts SVGs without intrinsic size.
    if (!image?.complete) return;
    if (typeof image.decode === "function") {
      image.decode().catch(() => setFailedSource(src));
    } else if (image.naturalWidth === 0) {
      setFailedSource(src);
    }
  }, [src]);

  if (failedSource === src) return <>{fallback}</>;
  return (
    <div className={className}>
      {/* User-uploaded data URL or configured CDN URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageReference}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onError={() => setFailedSource(src)}
      />
    </div>
  );
}

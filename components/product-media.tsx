"use client";
import { useEffect, useRef, useState } from "react";
import type { ProductDetails } from "@/lib/types";
import { TireIllustration } from "./tire-illustration";
import styles from "./product-details-page.module.css";

export type ProductMediaProduct = Pick<
  ProductDetails,
  | "kind"
  | "name"
  | "image"
  | "brand"
  | "model"
  | "season"
  | "studded"
  | "runflat"
  | "width"
  | "profile"
  | "diameter"
  | "xl"
  | "tags"
>;

function Illustration({ product }: { product: ProductMediaProduct }) {
  if (product.kind === "tire") {
    return (
      <div className={styles.media}>
        <TireIllustration product={product} className={styles.illustration} />
        <span className={styles.mediaCaption} aria-hidden="true">Иллюстрация</span>
      </div>
    );
  }
  // Wheel without a photo: the same neutral drawing as in the catalog cards.
  return (
    <div className={styles.media}>
      <div className={`product-art wheel ${styles.wheelArt}`} aria-hidden="true">
        <span className="art-shadow" />
        <span className="art-wheel">
          <span className="art-rim">
            {Array.from({ length: 8 }).map((_, index) => (
              <i key={index} style={{ transform: `rotate(${index * 45}deg)` }} />
            ))}
            <b />
          </span>
        </span>
      </div>
      <span className={styles.mediaCaption} aria-hidden="true">Иллюстрация</span>
    </div>
  );
}

/**
 * Product photo with a fallback: when the photo cannot be loaded (404, broken
 * file) the tire illustration or the wheel drawing is shown instead of a
 * broken-image icon.
 */
export function ProductMedia({ product }: { product: ProductMediaProduct }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const photo = product.image && product.image !== failedSource ? product.image : null;

  useEffect(() => {
    // A server-rendered <img> can fail before hydration attaches onError:
    // check an already finished load once after mount.
    const image = imageRef.current;
    if (!image || !image.complete || !photo) return;
    if (typeof image.decode === "function") {
      image.decode().catch(() => setFailedSource(photo));
    } else if (image.naturalWidth === 0) {
      setFailedSource(photo);
    }
  }, [photo]);

  if (!photo) return <Illustration product={product} />;
  return (
    <div className={styles.media}>
      {/* Product photo: configured CDN URL or a site path. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        className={styles.photo}
        src={photo}
        alt={product.name}
        onError={() => setFailedSource(photo)}
      />
    </div>
  );
}

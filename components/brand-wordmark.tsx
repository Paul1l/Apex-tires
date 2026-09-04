import { businessConfig } from "@/config/business";

export function BrandWordmark() {
  if (businessConfig.branding.logoSource) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="brand-wordmark-image" src={businessConfig.branding.logoSource} alt={businessConfig.brandName} />;
  }

  const [primaryWord, ...remainingWords] = businessConfig.brandName.split(/\s+/);

  return (
    <span>
      {primaryWord}
      {remainingWords.length > 0 && <small>{remainingWords.join(" ")}</small>}
    </span>
  );
}

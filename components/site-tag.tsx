import { MapPin } from "lucide-react";

// The site a solution or proposal belongs to, by its Site name, under the
// title of its panel.
export function SiteTag({ name }: { name: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-slate-500">
      <MapPin aria-hidden className="size-3" />
      {name}
    </span>
  );
}

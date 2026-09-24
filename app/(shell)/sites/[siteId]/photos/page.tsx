import { HubEmpty, HubSection } from "@/components/hub-section";

// Photos of the site, seen only by the owner. Taking and keeping them comes
// next; until then the tab says so.
export default function Page() {
  return (
    <HubSection
      title="Photos"
      description="Pictures of this site, taken here on your phone. Only you see them."
    >
      <HubEmpty>Photos come in the next update.</HubEmpty>
    </HubSection>
  );
}

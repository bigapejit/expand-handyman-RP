import Image from "next/image";
export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <Image
        src="/logo.svg"
        alt="Expand Handyman"
        width={36}
        height={31}
        priority
      />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-wide">EXPAND</div>
        <div className="text-[10px] font-medium tracking-[.18em] text-muted-foreground">
          HANDYMAN
        </div>
      </div>
    </div>
  );
}

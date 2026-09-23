import { RenderPaper } from "@/components/render-paper";
import { RendererFooterParam } from "@/lib/pdf-copy";

// `/paper/<pass>`: the one page the PDF renderer opens. The renderer asks for
// it with `?footer=renderer` and draws the sheets' footer itself; opened any
// other way the paper foots its own, as it does everywhere else.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ pass: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { pass } = await params;
  const footer =
    (await searchParams)[RendererFooterParam.name] === RendererFooterParam.value
      ? "renderer"
      : "page";
  return <RenderPaper pass={pass} footer={footer} />;
}

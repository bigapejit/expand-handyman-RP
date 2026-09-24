// PROTOTYPE (#112): throwaway. A sketch framed at a phone's width, for the
// headless screenshots in docs/prototypes/pay-now/shoot.sh: Chrome will not
// open a window that narrow, and the app refuses to be framed from a file.
// `?u=` names the path to frame, under /prototype/pay-now.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { u } = await searchParams;
  const path = typeof u === "string" && u.startsWith("/prototype/pay-now/") ? u : "/prototype/pay-now";
  return (
    <div style={{ margin: 0, background: "#222", minHeight: "100vh" }}>
      <iframe
        src={path}
        title="Phone-sized sketch"
        style={{ border: 0, width: 390, height: 844, display: "block" }}
      />
    </div>
  );
}

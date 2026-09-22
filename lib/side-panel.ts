// The list-plus-side-panel pattern the Proposals arc is built on: a tab is a
// list, and the row being edited slides in over it. Which row that is lives in
// the URL and nowhere else, so a reload, a copied link, and the browser's back
// button all mean the same thing — the reason Change Sets had to become pages
// (issue #195), solved here without giving up the list behind the panel.
//
// Pure on purpose: the whole of "which row is open" is one search parameter,
// and this module is the only thing that writes or reads it. Solutions (#207)
// is the first tab to use it; Proposals (#208) is the second.

// The row the URL says is open, or none. An empty value is no row: "?solution="
// is what a half-written link looks like, not a Solution.
export function openPanelId(search: string, param: string): string | null {
  return new URLSearchParams(search).get(param) || null;
}

// Where the tab points once a row is opened, or closed with `null`. Every
// other parameter on the URL is carried across untouched: the panel is one
// thing about the page, never the whole of it.
export function panelHref(
  pathname: string,
  search: string,
  param: string,
  openId: string | null,
): string {
  const params = new URLSearchParams(search);
  if (openId === null) params.delete(param);
  else params.set(param, openId);

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

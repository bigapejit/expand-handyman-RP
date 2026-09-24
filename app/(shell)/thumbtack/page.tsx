import { redirect } from "next/navigation";

// The Thumbtack board grew into the **Pipeline**. An old link, bookmarked or
// copied, lands there; a `?lead=` it names has no deal id to open.
export default function ThumbtackPage() {
  redirect("/pipeline");
}

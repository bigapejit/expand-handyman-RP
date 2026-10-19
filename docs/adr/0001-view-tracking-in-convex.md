# View tracking lives in Convex, not a third-party analytics tool

_2026-09-23: the uploaded documents this was written for were removed, and the decision stood for proposals, whose log is `proposalViews`. 2026-10-05: uploaded documents are back (docs/deployment.md, **Uploaded documents**) and log to `documentViews` again, the same way._

We need to know whether a customer has opened a document, distinguish those opens from the owner's own previews, and show this in the staff app. A product analytics tool such as PostHog was considered, but it cannot tell a customer from the owner any better than our backend can, and its data would sit outside Convex where the dashboard and the document's activity feed could not show it without extra plumbing. So every open of a signing link is written to a view log table in Convex, keyed to the document and the signing link token it came through, with a heartbeat while the tab is visible and a close beacon to an HTTP endpoint for duration. Each heartbeat adds only the time since the previous one, and a gap longer than one interval adds nothing, so time spent with the tab hidden is not counted as reading.

The owner is identified by their signed-in Clerk session inside the same Convex call, rather than by a separate preview URL. A preview URL is easy to forget, easy to send to a customer by mistake, and the signing page already runs inside the Clerk-aware Convex provider. The trade-off is that the owner opening a link in a logged-out browser is counted as a customer view.

## Consequences

- Opening a signing link never changes document status when the caller is the owner.
- Views on withdrawn links are kept and shown as belonging to a previous link.
- Opens after signing or declining are logged but do not change status or the first-viewed time.
- Only the user agent is stored per view. No IP address.
- Proposals keep their own log, `proposalViews`, keyed by proposal and signing link token, under the same rules. A proposal's views never change its state: Opened is read from the log, and counts only customer views of the current link.

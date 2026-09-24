# Photos are shrunk in the browser and stored as two Convex files

The owner takes photos of a site on the phone, from the site's Photos tab, and sees them in a grid and full size. A phone photo is 12 to 48 MP and several megabytes, which is slow to send from a job site, and Convex neither resizes images nor makes thumbnails. So the browser does it before anything is uploaded: `createImageBitmap` with its resize options brings the picture down to a 2000px long edge, a canvas encodes it as a JPEG at quality 0.85, and a 400px thumbnail is made the same way from that full image. Where the resize options are missing the picture is drawn from an image element instead. Both JPEGs go up through the owner-gated upload URL Documents already use, and one mutation then saves the photo row with both storage ids, the full image's size and the upload time. Nothing is saved until both files are up. We rejected storing the original: it costs storage and data for detail a handyman's site photo does not need. We rejected one file shown small in the grid: a grid of full images downloads megabytes to show thumbnails.

The camera time is read from the original file with `exifreader` before shrinking, because a canvas writes no metadata. It is kept as `takenAt` when the file had one; `addedAt`, the upload time, is always kept. An iPhone camera shot has no camera time: Safari re-encodes camera shots without EXIF. So a photo taken from the site page on an iPhone shows as Added, and one picked from the library usually shows as Taken.

Photos are served with `ctx.storage.getUrl` from owner-gated queries. Those URLs never expire, and anyone holding one can read the file. That is accepted: the URLs only ever leave through the owner's own queries, photos never reach a proposal, an invoice or any customer page, and deleting a photo deletes both its files, which kills its URLs.

## Consequences

- A photo is two `_storage` files and one `photos` row. Removing a photo, or deleting its site, deletes the row and both files.
- The save refuses a file that is missing or is not `image/jpeg`, so a stray upload never becomes a photo. A file uploaded and then never saved, because the save failed or the tab was closed, stays in storage unreferenced.
- The server never sees the original, so nothing can be re-shrunk larger later.
- A file the browser cannot decode fails before upload with a plain message. That is an HEIC photo on Android, since Chrome has no HEIC decoder; Safari decodes HEIC itself. No HEIC decoder is added.
- Photos are newest first by the time they show: the camera time when there is one, else the upload time. A library pick from last year lands where last year's photos are, not at the top.
- The browser pipeline is checked by hand on the owner's phone and a laptop, not by tests; the save, the reads and the deletes are tested through their Convex functions.

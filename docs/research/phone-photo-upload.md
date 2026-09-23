# Taking, shrinking and storing phone photos from the browser into Convex

Research for [issue #87](https://github.com/bigapejit/expand-handyman-RP/issues/87), part of map [#86](https://github.com/bigapejit/expand-handyman-RP/issues/86). Checked on 2026-09-23 against primary sources: MDN, the WHATWG and W3C specs, WebKit and Chromium source, caniuse, and docs.convex.dev.

## Short version

- `<input type="file" accept="image/*" capture="environment">` opens the camera straight away on iPhone and Android. There is no gallery option on that path. `multiple` is ignored: you get one photo per tap.
- Leave `capture` off and both phones show a chooser (camera or library) and `multiple` works.
- iOS always hands the page a JPEG when the photo comes from the camera. Library picks are JPEG by default too. The camera JPEG has no EXIF, so no taken-at time.
- Shrinking: `createImageBitmap(file, { resizeWidth })` into a 2000px canvas, then `toBlob("image/jpeg", 0.85)`. Safari 17+ and Chrome handle EXIF rotation for you. Not older Safari.
- Convex: reuse the `generateUploadUrl` rail Documents already use. No file size limit on that path, only a 2 minute upload timeout. Storage is 1 GB free / 100 GB on Pro. Convex does not resize; make the thumbnail yourself.
- Taken-at time: read `DateTimeOriginal` from the original file with `exifreader` before shrinking. When missing, use the upload time.

## 1. The file input on phones

**The spec makes `capture` a hint.** HTML Media Capture says the user agent "SHOULD invoke a file picker of the specific capture control type". `environment` means the rear camera. The spec says nothing about `multiple`. Source: [W3C HTML Media Capture](https://www.w3.org/TR/html-media-capture/). MDN says the same and adds "these work better on mobile devices; if your device is a desktop computer, you'll likely get a typical file picker". Source: [MDN capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture). Support: iOS Safari 10+, Chrome Android 25+, no desktop browser. Source: [MDN browser-compat-data input.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/html/elements/input.json).

**iOS Safari** (WebKit source, [WKFileUploadPanel.mm](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm)):

- With `capture` and a camera present, `_shouldMediaCaptureOpenMediaDevice` returns YES and WebKit calls `_showCamera` directly. Without it, `showDocumentPickerMenu` shows Take Photo or Video / Photo Library / Choose File.
- `multiple` + `capture`: the camera picker gets `_setAllowsMultipleSelection:_allowMultipleFiles`, but the multi-select delegate returns NO when `_usingCamera`, so the camera path always returns one item. Capture wins.
- The camera picker asks for confirmation and shows the iOS "choose size" sheet (`_setRequiresPickingConfirmation:YES`, `_setShowsFileSizePicker:YES`). The owner will see Use Photo and may be asked Actual Size / Large / Medium / Small.
- Without `capture`, `multiple` works through the Photo Library option.

**Android Chrome** (Chromium source, [SelectFileDialog.java](https://raw.githubusercontent.com/chromium/chromium/main/ui/android/java/src/org/chromium/ui/base/SelectFileDialog.java)):

- `captureImage()` is true when `capture` is set and `accept` is images only. Chrome then fires `ACTION_IMAGE_CAPTURE` and returns. No gallery. `shouldUsePhotoPicker()` requires `!captureImage()`.
- `EXTRA_ALLOW_MULTIPLE` is only attached to the fallback `ACTION_GET_CONTENT` chooser, not to the capture intent. So `multiple` is ignored on the camera path. One photo.
- Android ignores the `user` / `environment` value and opens the rear camera either way. Source: [mdn/browser-compat-data #19603](https://github.com/mdn/browser-compat-data/issues/19603). Google's own guide confirms the direct-launch behaviour: "on Android this means that the user will no longer have the option of choosing an existing picture. The system camera app will be started directly, instead." Source: [web.dev](https://web.dev/articles/media-capturing-images).

**Home screen (standalone) web app.** No primary source describes a different code path for `<input capture>` in standalone mode, and the WebKit upload code has no standalone branch. History: WebKit bug [206219](https://bugs.webkit.org/show_bug.cgi?id=206219) (camera showed a blank screen in home-screen apps after backgrounding, iOS 13.2 to 13.4, reported fixed in 13.5.1) and bug [185448](https://bugs.webkit.org/show_bug.cgi?id=185448) (`getUserMedia` in standalone, fixed in iOS 13.4; a commenter notes `<input file>` is separate). Nothing found for Android PWAs. Treat it as the same, and test once on the owner's phone.

## 2. What file iOS hands the page

**Camera path: always JPEG, no EXIF.** WebKit takes the `UIImage` from the camera and encodes it itself with `UIImageJPEGRepresentation(image, 0.8)` and names it `image.jpg`. The code carries the comment "FIXME: Should EXIF data be maintained?", so the JPEG has no camera metadata. This is true whatever the iPhone's Formats setting says (High Efficiency or Most Compatible) and whatever `accept` says. Source: [WKFileUploadPanel.mm](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm), `_uploadItemForJPEGRepresentationOfImage`.

**Photo Library path: JPEG by default, HEIC only if Safari opts in.** WebKit asks the system picker for the "compatible" representation (HEIC transcoded to JPEG) unless an internal preference `PhotoPickerPrefersOriginalImageFormat` is on. That preference defaults to false. When it is on, WebKit keeps the original format for `accept="image/*"` or an empty `accept`, and transcodes when `accept` names specific image types (for example `image/jpeg`). Sources: [WKFileUploadPanel.mm](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm), `_preferredAssetRepresentationMode`; [UnifiedWebPreferences.yaml](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml); WebKit change for bug 267277, "Transcoding to the compatible format for images is only performed if the accept attribute restricts the set of image types" ([webkit-changes](https://www.mail-archive.com/webkit-changes@lists.webkit.org/msg211341.html)); open follow-up [bug 270470](https://bugs.webkit.org/show_bug.cgi?id=270470). Whether the Safari app turns the preference on is not public. Since iOS 16.4 the picker keeps camera EXIF and timestamps but strips GPS by default ([bug 207088](https://bugs.webkit.org/show_bug.cgi?id=207088)).

**Apple's camera setting.** "High Efficiency" captures HEIF; "Most Compatible" uses JPEG. Apple says shared media "might automatically be shared in a more compatible format, such as JPEG". Apple says nothing about the Safari file input. Source: [Apple HT207022](https://support.apple.com/en-us/HT207022).

**Who can decode HEIC.** Safari 17+ on macOS and iOS. No version of Chrome, Edge or Firefox. Sources: [caniuse heif](https://caniuse.com/heif); [WebKit features in Safari 17.0](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/). `createImageBitmap` uses the same decoders as `<img>`, so the same table applies.

**What this means.** From an iPhone the page nearly always gets a JPEG, and if it ever gets HEIC, Safari can still decode it for resizing. From Android, Chrome hands over whatever the camera app saved and cannot decode HEIC. Detect a decode failure and tell the owner to switch the camera to JPEG. Do not add an HEIC decoder.

## 3. Shrinking to about 2000px and re-encoding as JPEG

**Simplest path.** `createImageBitmap(file, { resizeWidth: 2000, resizeQuality: "high" })` (or `resizeHeight` for portrait; the spec computes the other side from the aspect ratio), draw it into a 2000px canvas, then `canvas.toBlob(cb, "image/jpeg", 0.85)`. Sources: [WHATWG createImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap); [MDN toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob).

**Support.** `resizeWidth` / `resizeHeight` / `resizeQuality`: Chrome 54+, Safari 15+. `imageOrientation` option: Chrome 52+, Safari 15+. Source: [MDN browser-compat-data createImageBitmap.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/_globals/createImageBitmap.json). caniuse marks Safari 15 to 16.6 as partial only over `premultiplyAlpha` with `ImageData`, which we do not use ([caniuse createimagebitmap](https://caniuse.com/createimagebitmap)). `OffscreenCanvas` + `convertToBlob`: Chrome 69+, Safari 16.4+ per BCD, full in Safari 17 ([caniuse offscreencanvas](https://caniuse.com/offscreencanvas)). A plain `<canvas>` with `toBlob` works everywhere (Chrome 50+, Safari 11+), so use that and skip OffscreenCanvas.

**Safari canvas size limit.** WebKit limits canvas by area. On iOS `maxCanvasArea()` is `8192 * 8192` (67 MP); exceeding it logs "Canvas area exceeds the maximum limit (width * height > N)" and the canvas is unusable. Source: [CanvasBase.cpp](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/html/CanvasBase.cpp). It was 4096 * 4096 (16.7 MP) until March 2024 ([bug 271002 change](https://www.mail-archive.com/webkit-changes@lists.webkit.org/msg211769.html)). Drawing straight into the 2000px target canvas never touches this limit. Drawing the full 48 MP photo into a canvas first would.

**Fallback for old Safari.** If `createImageBitmap` with resize is missing (Safari under 15), load the file into an `<img>` via `URL.createObjectURL` and `drawImage` into the 2000px canvas. Same result, one more step.

## 4. EXIF orientation

- **`<img>` and CSS.** `image-orientation` defaults to `from-image`. Shipped in Chrome 81 and Safari 13.1. Sources: [MDN image-orientation](https://developer.mozilla.org/en-US/docs/Web/CSS/image-orientation); [chromestatus 6313474512650240](https://chromestatus.com/feature/6313474512650240); Chrome DevRel note "Chrome 81 will respect the image orientation from the files EXIF data" ([Paul Kinlan](https://paul.kinlan.me/correct-image-orientation-for-images-chrome-81/)).
- **`createImageBitmap`.** The spec default is `imageOrientation: "from-image"`, which applies EXIF rotation. `flipY` flips after that. `none` was renamed to `from-image` and no browser supports the new `none`. Sources: [WHATWG ImageBitmapOptions](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap); [MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap). WebKit fixed EXIF rotation for `createImageBitmap(Blob)` in August 2022 ([bug 223326, commit 8758b1b](https://github.com/WebKit/WebKit/commit/8758b1b9f85526f462e6edb74d5c85228e15d90d)), shipping in Safari 16. Support for the `from-image` value: Chrome 112, Safari 16 ([caniuse](https://caniuse.com/mdn-api_createimagebitmap_options_imageorientation_parameter_from-image)).
- **`drawImage`.** The HTML canvas spec never mentions orientation. MDN says only that "some older browser versions" ignore EXIF in `drawImage`, "especially troublesome on iOS". Source: [MDN drawImage](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage). In practice an `<img>` decoded with `from-image` draws upright in current Chrome and Safari.
- **Hand rotation needed?** Only on Safari older than 16 through `createImageBitmap(Blob)`. Nothing else documented. The iOS camera path produces a JPEG WebKit encoded itself, so it carries no EXIF orientation problem to begin with.

**Canvas output drops EXIF.** The spec's serialisation of a bitmap to a file writes pixels, 96 dpi and a colour profile, nothing from the source metadata. Source: [WHATWG serialising bitmaps to a file](https://html.spec.whatwg.org/multipage/canvas.html#serialising-bitmaps-to-a-file). So the resized JPEG has no orientation tag (fine, it is already upright) and no date. Read the date from the original file before resizing.

## 5. Convex file storage

All from docs.convex.dev, fetched 2026-09-23.

**Upload URL flow** ([upload-files](https://docs.convex.dev/file-storage/upload-files)): a mutation calls `ctx.storage.generateUploadUrl()`; the client POSTs the file body to that URL with a `Content-Type` header and receives `{ storageId }`; a second mutation saves the id, validated with `v.id("_storage")`. Without `Content-Type` the stored file has no `contentType`. The URL expires after 1 hour. "The file size is not limited, but upload POST request has a 2 minute timeout." Uploads through an HTTP action are capped at 20 MB and need your own CORS headers; upload URLs avoid both.

**Limits and pricing** ([limits](https://docs.convex.dev/production/state/limits), [pricing](https://convex.dev/pricing)): no documented maximum individual file size. File storage: Free 1 GB hard cap; Starter 1 GB then $0.033/GB/month; Professional 100 GB included then $0.03/GB. Egress, which includes serving files: Free 1 GB/month; Starter 1 GB then $0.132/GB; Professional 50 GB/month then $0.12/GB. A 2000px JPEG at quality 0.85 is typically a few hundred KB (our estimate, not from a source), so 1 GB holds well over a thousand photos.

**Serving** ([serve-files](https://docs.convex.dev/file-storage/serve-files)): `ctx.storage.getUrl(storageId)` from a query returns a URL that does not expire; anyone with it can read the file; revoke by deleting the file. The response carries a sha256 `Digest` header. Serving through an HTTP action is capped at 20 MB per response. Convex has no image transformation or thumbnail feature; its only resize story is third-party components (Transloadit, R2, Bunny).

**Metadata** ([file-metadata](https://docs.convex.dev/file-storage/file-metadata)): `_storage` rows are `{ _id, _creationTime, sha256, size, contentType? }`, read with `ctx.db.system.get("_storage", id)`. `ctx.storage.getMetadata` is deprecated.

**Deleting** ([delete-files](https://docs.convex.dev/file-storage/delete-files)): `ctx.storage.delete(storageId)`; old URLs then 404.

**Thumbnails.** Convex gives no guidance on one file versus two. Make them yourself, client side before upload, and store a second `_storage` id.

**How this repo already does it** (on `main`): `convex/documents.ts` exposes `uploadUrl` (a mutation gated by `requireOwner` that returns `ctx.storage.generateUploadUrl()`); `lib/files.ts` `uploadFile(url, blob)` POSTs with a `Content-Type` header and returns `storageId`; `components/document-dialogs.tsx` checks size and type client side, uploads, then calls an action that reads the blob back with `ctx.storage.get`, verifies it, and inserts the row. PDFs are served either through `ctx.storage.getUrl` (`convex/pdfCopies.ts`) or the `/file` HTTP route in `convex/http.ts` when a token check is needed. Photos are owner-only, so `getUrl` from an owner-gated query is enough. The `Content-Type` in `uploadFile` is hard-coded to `application/pdf` and needs a parameter.

## 6. Taken-at time

- **Where it lives.** EXIF `DateTimeOriginal` (tag 0x9003) in the original file. The resized JPEG will not have it (section 4).
- **iOS camera path has none.** WebKit re-encodes camera shots without EXIF (section 2), so a photo taken from the site page on an iPhone carries no date. Library picks keep their timestamps ([bug 207088](https://bugs.webkit.org/show_bug.cgi?id=207088)). Android hands over the camera app's file, which normally has EXIF.
- **Small libraries.** `exifreader` 4.45.2, published 2026-09-21, accepts a `File` or `ArrayBuffer` in the browser, reads JPEG and HEIC, and custom builds are about 9 KiB Brotli; read `tags.DateTimeOriginal.description`. Source: [ExifReader](https://github.com/mattiasw/ExifReader), [npm](https://registry.npmjs.org/exifreader). `exifr` 7.1.3 was last published 2021-08-05 and is effectively unmaintained ([npm](https://registry.npmjs.org/exifr)). `exif-reader` takes the raw APP1 segment as a Node `Buffer`, not a `File` ([npm](https://registry.npmjs.org/exif-reader)).
- **No dependency.** A JPEG-only parser that walks APP1 → `Exif\0\0` → IFD0 → ExifIFD → tag 0x9003 is roughly 60 to 90 lines. It does not cover HEIC. Not worth it against a 9 KiB library.
- **`File.lastModified`.** Milliseconds since the epoch; "Files without a known last modified date return the current date." Source: [MDN lastModified](https://developer.mozilla.org/en-US/docs/Web/API/File/lastModified). Whether iOS supplies the capture time here is undocumented. Chromium on Android reads the content provider's last-modified column, 0 if null ([ContentUriUtils.java](https://chromium.googlesource.com/chromium/src/+/main/base/android/java/src/org/chromium/base/ContentUriUtils.java)). Not reliable as a taken-at time.
- **Fallback.** When `DateTimeOriginal` is missing, store the upload time (the mutation's `Date.now()` or `_creationTime`) and mark the row so the UI can say "added" rather than "taken". For a photo taken from the site page the two are seconds apart anyway.

## Recommended approach

- Two buttons on the site's Photos tab: **Take photo** (`<input type="file" accept="image/*" capture="environment">`, one shot per tap) and **Add from library** (`accept="image/*" multiple`, no `capture`).
- In the browser: read `DateTimeOriginal` with `exifreader` from the original file, then `createImageBitmap(file, { resizeWidth or resizeHeight: 2000, resizeQuality: "high" })` into a `<canvas>` and `toBlob("image/jpeg", 0.85)`. Make a 400px thumbnail the same way. Fall back to `<img>` + `drawImage` if resize options are missing, and show a plain error if the file will not decode (HEIC on Android).
- Upload both blobs through the existing `generateUploadUrl` + `uploadFile` rail (add a `contentType` parameter), then one mutation saves `{ siteId, fullId, thumbId, width, height, takenAt?, addedAt }`.
- Serve with `ctx.storage.getUrl` from an owner-gated query: the thumbnail in the grid, the full image on tap. Delete both ids when a photo is removed.

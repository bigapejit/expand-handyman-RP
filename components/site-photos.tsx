"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Camera, Images, LoaderCircle, RotateCcw, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

import { HubEmpty, HubLoading, HubSection } from "@/components/hub-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { uploadFile } from "@/lib/files";
import { PhotoUnreadable, shrinkPhoto } from "@/lib/photo-files";
import { photoTimeLabel } from "@/lib/photos";
import { errorMessage } from "@/lib/utils";

type Photo = FunctionReturnType<typeof api.photos.forSite>[number];

// A picked file on its way to being a photo: a grey tile with a spinner until
// it is saved, or the reason it was not, with Retry and a cross to drop it.
export type Upload = { key: string; file: File; failure?: string };

// The Photos tab: pictures of the site the owner takes here on the phone,
// seen only by them (CONTEXT.md, **Photo**; ADR 0003). Take photo opens the
// camera straight away, one shot a tap; Add from library picks several. Each
// file shows at once as a tile and is shrunk and uploaded on its own, so the
// owner can keep shooting; once saved it leaves the tiles for the grid, which
// is newest first by the time each photo shows.
export function SitePhotos({ siteId }: { siteId: Id<"sites"> }) {
  const photos = useQuery(api.photos.forSite, { siteId });
  const { uploads, pick, retry, drop } = usePhotoUploads(siteId);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [openId, setOpenId] = useState<Id<"photos"> | null>(null);

  // A photo deleted elsewhere just closes.
  const openPhoto = photos?.find((photo) => photo._id === openId);

  const count = photos?.length ?? 0;

  return (
    <HubSection
      title="Photos"
      description={
        count
          ? `${count === 1 ? "1 photo" : `${count} photos`} of this site. Only you see them.`
          : "Pictures of this site, taken here on your phone. Only you see them."
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={() => libraryRef.current?.click()}>
            <Images data-icon="inline-start" aria-hidden /> Add from library
          </Button>
          <Button size="lg" onClick={() => cameraRef.current?.click()}>
            <Camera data-icon="inline-start" aria-hidden /> Take photo
          </Button>
        </div>
      }
    >
      {/* The camera path yields one file a tap whatever `multiple` says, so
          only the library asks for several. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = "";
        }}
      />
      {photos === undefined ? (
        <HubLoading label="Loading photos" />
      ) : photos.length === 0 && uploads.length === 0 ? (
        <HubEmpty>No photos yet. Take one on the phone and it lands here.</HubEmpty>
      ) : (
        <ul className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4 lg:grid-cols-6">
          {uploads.map((pending) => (
            <UploadTile
              key={pending.key}
              upload={pending}
              retry={() => retry(pending)}
              drop={() => drop(pending)}
            />
          ))}
          {photos.map((photo) => (
            <PhotoTile key={photo._id} photo={photo} onOpen={() => setOpenId(photo._id)} />
          ))}
        </ul>
      )}
      {openPhoto ? (
        <PhotoDialog key={openPhoto._id} photo={openPhoto} onClose={() => setOpenId(null)} />
      ) : null}
    </HubSection>
  );
}

// The whole pipeline for a picked file, from the camera time to the save, and
// again from the start on Retry: shrunk, both files uploaded, then saved to
// `siteId`. Nothing is saved until both files are up. Shared by the Photos
// tab and a **Deal**'s Quick panel, which saves to the deal's site.
export function usePhotoUploads(siteId: Id<"sites"> | null) {
  const getUploadUrl = useMutation(api.photos.uploadUrl);
  const add = useMutation(api.photos.add);
  const picked = useRef(0);
  const [uploads, setUploads] = useState<Upload[]>([]);
  // A new site starts with an empty list, so a failed upload shown for the
  // last one is never retried into this one. One still in flight finishes on
  // the site it began on.
  const [uploadsFor, setUploadsFor] = useState(siteId);
  if (uploadsFor !== siteId) {
    setUploadsFor(siteId);
    setUploads([]);
  }

  const upload = async ({ key, file }: Upload) => {
    if (!siteId) return;
    setUploads((list) => list.map((u) => (u.key === key ? { key, file } : u)));
    try {
      const shrunk = await shrinkPhoto(file);
      const [fullId, thumbId] = await Promise.all(
        [shrunk.full, shrunk.thumb].map(
          async (blob) =>
            (await uploadFile(await getUploadUrl(), blob, "image/jpeg")) as Id<"_storage">,
        ),
      );
      await add({
        siteId,
        fullId,
        thumbId,
        width: shrunk.width,
        height: shrunk.height,
        takenAt: shrunk.takenAt,
      });
      setUploads((list) => list.filter((u) => u.key !== key));
    } catch (err) {
      const failure = err instanceof PhotoUnreadable ? err.message : "Didn't upload";
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, failure } : u)));
    }
  };

  return {
    uploads,
    pick: (files: FileList | null) => {
      if (!siteId || !files?.length) return;
      const fresh = Array.from(files, (file) => ({ key: String(picked.current++), file }));
      // The latest pick at the top, the first of several leading.
      setUploads((list) => [...fresh, ...list]);
      for (const next of fresh) void upload(next);
    },
    retry: (pending: Upload) => void upload(pending),
    drop: (pending: Upload) => setUploads((list) => list.filter((u) => u.key !== pending.key)),
  };
}

/** One saved photo in a grid, its thumbnail opening it full size. */
export function PhotoTile({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  return (
    <li className="aspect-square overflow-hidden rounded-md bg-slate-100">
      <button
        type="button"
        onClick={onOpen}
        className="block size-full"
        aria-label={`Open photo, ${photoTimeLabel(photo)}`}
      >
        {photo.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL, already shrunk
          <img src={photo.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : null}
      </button>
    </li>
  );
}

export function UploadTile({
  upload,
  retry,
  drop,
}: {
  upload: Upload;
  retry: () => void;
  drop: () => void;
}) {
  return (
    <li className="relative aspect-square overflow-hidden rounded-md bg-slate-100">
      {upload.failure === undefined ? (
        <div className="grid size-full place-items-center">
          <LoaderCircle aria-label="Uploading photo" className="size-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 p-2 text-center">
          <span role="alert" className="text-xs leading-tight text-slate-600">
            {upload.failure}
          </span>
          <Button size="sm" variant="outline" onClick={retry}>
            <RotateCcw data-icon="inline-start" aria-hidden /> Retry
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={drop}
            aria-label="Drop this photo"
            className="absolute top-1 right-1 text-slate-500"
          >
            <X aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

// The photo full size, when it shows as taken or added, and Delete, which
// asks once and then removes the photo and both its files for good.
export function PhotoDialog({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const remove = useMutation(api.photos.remove);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  return (
    <>
      <Dialog open onOpenChange={(open) => open || onClose()}>
        <DialogContent className="gap-3 p-2 pt-10 sm:max-w-3xl sm:p-3 sm:pt-10">
          <DialogTitle className="sr-only">Photo</DialogTitle>
          {photo.fullUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL, already shrunk
            <img
              src={photo.fullUrl}
              alt=""
              width={photo.width}
              height={photo.height}
              className="max-h-[75vh] w-full rounded-md bg-slate-100 object-contain"
            />
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-sm text-slate-600">{photoTimeLabel(photo)}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => setConfirming(true)}
            >
              <Trash2 data-icon="inline-start" aria-hidden /> {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription>It goes for good.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirming(false);
                setDeleting(true);
                setError("");
                try {
                  await remove({ photoId: photo._id });
                  onClose();
                } catch (err) {
                  setError(errorMessage(err));
                  setDeleting(false);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

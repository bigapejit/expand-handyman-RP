"use client";

import { Camera, Images, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { HubEmpty, HubSection } from "@/components/customer-hub-shell";
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

// PROTOTYPE (#90): the Photos tab as issue #89 decided it, with the upload
// stubbed. Photos live in memory for the session (per site), shrunk in the
// browser exactly as the research says, and vanish on reload. Nothing here
// touches Convex.

type Photo = {
  id: string;
  siteId: string;
  takenAt: number;
  // "added" when the file had no camera time, which is every iPhone camera shot.
  timeKind: "taken" | "added";
  status: "uploading" | "ready" | "failed";
  thumbUrl?: string;
  fullUrl?: string;
  file: File;
};

// A module-level store so switching tabs and variants keeps the photos.
let photos: Photo[] = [];
const listeners = new Set<() => void>();
function setPhotos(next: Photo[]) {
  photos = next;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function patch(id: string, changes: Partial<Photo>) {
  setPhotos(photos.map((p) => (p.id === id ? { ...p, ...changes } : p)));
}

async function shrink(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file, {
    ...(await isPortrait(file) ? { resizeHeight: size } : { resizeWidth: size }),
    resizeQuality: "high",
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("no blob");
  return URL.createObjectURL(blob);
}

async function isPortrait(file: File) {
  const probe = await createImageBitmap(file);
  const portrait = probe.height > probe.width;
  probe.close();
  return portrait;
}

async function process(photo: Photo) {
  patch(photo.id, { status: "uploading", thumbUrl: undefined, fullUrl: undefined });
  try {
    const [thumbUrl, fullUrl] = await Promise.all([
      shrink(photo.file, 400),
      shrink(photo.file, 2000),
    ]);
    // Stand in for the round trip to Convex.
    await new Promise((r) => setTimeout(r, 900));
    patch(photo.id, { status: "ready", thumbUrl, fullUrl });
  } catch {
    patch(photo.id, { status: "failed" });
  }
}

function addFiles(siteId: string, files: FileList | null) {
  if (!files) return;
  const now = Date.now();
  const fresh: Photo[] = Array.from(files).map((file, i) => ({
    id: `${now}-${i}-${Math.random().toString(36).slice(2)}`,
    siteId,
    // The iPhone camera JPEG has no EXIF, so this is "added"; a library pick
    // usually has one, which the real build reads with exifreader.
    takenAt: now,
    timeKind: "added",
    status: "uploading",
    file,
  }));
  setPhotos([...fresh, ...photos]);
  fresh.forEach((p) => void process(p));
}

export function SitePhotos({ siteId }: { siteId: string }) {
  const all = useSyncExternalStore(subscribe, () => photos, () => photos);
  const mine = all.filter((p) => p.siteId === siteId);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const open = mine.find((p) => p.id === openId);

  // Variant B's floating button lives in the shell; it asks for the camera here.
  useEffect(() => {
    const onTake = () => cameraRef.current?.click();
    window.addEventListener("proto-take-photo", onTake);
    return () => window.removeEventListener("proto-take-photo", onTake);
  }, []);

  return (
    <HubSection
      title="Photos"
      description={
        mine.length
          ? `${mine.length === 1 ? "1 photo" : `${mine.length} photos`} of this site. Only you see them.`
          : "Pictures of this site, taken here on your phone. Only you see them."
      }
      action={
        <div className="flex gap-2">
          <Button variant="outline" size="lg" onClick={() => libraryRef.current?.click()}>
            <Images data-icon="inline-start" aria-hidden /> Add from library
          </Button>
          <Button size="lg" onClick={() => cameraRef.current?.click()}>
            <Camera data-icon="inline-start" aria-hidden /> Take photo
          </Button>
        </div>
      }
    >
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(siteId, e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(siteId, e.target.files);
          e.target.value = "";
        }}
      />
      {mine.length === 0 ? (
        <HubEmpty>No photos yet. Take one on the phone and it lands here.</HubEmpty>
      ) : (
        <ul className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4 lg:grid-cols-6">
          {mine.map((photo) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-md bg-slate-100">
              {photo.status === "ready" ? (
                <button
                  type="button"
                  onClick={() => setOpenId(photo.id)}
                  className="block size-full"
                  aria-label={`Open photo ${timeLabel(photo)}`}
                >
                  <img src={photo.thumbUrl} alt="" className="size-full object-cover" />
                </button>
              ) : photo.status === "uploading" ? (
                <div className="grid size-full place-items-center">
                  <LoaderCircle aria-label="Uploading" className="size-6 animate-spin text-slate-400" />
                </div>
              ) : (
                <div className="grid size-full place-items-center gap-1 p-2 text-center">
                  <span className="text-xs text-slate-500">Didn&rsquo;t upload</span>
                  <Button size="sm" variant="outline" onClick={() => void process(photo)}>
                    <RotateCcw data-icon="inline-start" aria-hidden /> Retry
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open !== undefined} onOpenChange={(o) => o || setOpenId(null)}>
        <DialogContent className="max-w-3xl gap-3 p-2 sm:p-3">
          <DialogTitle className="sr-only">Photo</DialogTitle>
          {open ? (
            <>
              <img
                src={open.fullUrl}
                alt=""
                className="max-h-[75vh] w-full rounded-md object-contain"
              />
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="text-sm text-slate-600">{timeLabel(open)}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeletingId(open.id)}
                >
                  <Trash2 data-icon="inline-start" aria-hidden /> Delete
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deletingId !== null} onOpenChange={(o) => o || setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription>It goes for good.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setPhotos(photos.filter((p) => p.id !== deletingId));
                setDeletingId(null);
                setOpenId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </HubSection>
  );
}

function timeLabel(photo: Photo) {
  const when = new Date(photo.takenAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${photo.timeKind === "taken" ? "Taken" : "Added"} ${when}`;
}

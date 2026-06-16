"use client";

// Renders a Message attachment (image, video, PDF, generic file). Because
// the backend serves uploads behind AuthGuard, we can't drop the URL on a
// plain <img src> — that won't carry the Bearer header. Instead we fetch
// the binary through `apiClient` (which already wires auth) and pass a
// blob URL into the appropriate element.

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

interface Props {
  url: string;
  name: string;
  mime: string;
  size?: number | null;
  /** Tints icons to match an outbound (light text) bubble vs inbound. */
  variant?: "light" | "dark";
}

function formatBytes(b: number | null | undefined): string {
  if (!b || b <= 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function iconForMime(mime: string, variant: "light" | "dark") {
  const cls = variant === "light" ? "text-white/90" : "text-slate-700";
  if (mime.startsWith("image/")) return <ImageOutlinedIcon sx={{ fontSize: 22 }} className={cls} />;
  if (mime === "application/pdf") return <PictureAsPdfIcon sx={{ fontSize: 22 }} className={variant === "light" ? "text-white/90" : "text-rose-600"} />;
  if (mime.startsWith("video/")) return <VideocamOutlinedIcon sx={{ fontSize: 22 }} className={variant === "light" ? "text-white/90" : "text-violet-600"} />;
  return <InsertDriveFileOutlinedIcon sx={{ fontSize: 22 }} className={cls} />;
}

export function AttachmentView({ url, name, mime, size, variant = "dark" }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setBlobUrl(null);
    setError(null);

    apiClient
      .get(url, { responseType: "blob" })
      .then((r) => {
        if (cancelled) return;
        created = URL.createObjectURL(r.data as Blob);
        setBlobUrl(created);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "no se pudo cargar");
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const sizeLabel = formatBytes(size);

  if (isImage) {
    return (
      <div className="overflow-hidden rounded-xl">
        {blobUrl ? (
          <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={blobUrl}
              alt={name}
              className="block max-h-80 w-auto max-w-full rounded-xl"
            />
          </a>
        ) : (
          <div className="flex h-32 w-48 items-center justify-center rounded-xl bg-black/5 text-xs text-slate-500">
            {error ? "No se pudo cargar" : "Cargando…"}
          </div>
        )}
        {sizeLabel && <p className="mt-1 text-[10px] opacity-70">{sizeLabel}</p>}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="overflow-hidden rounded-xl">
        {blobUrl ? (
          <video src={blobUrl} controls className="block max-h-80 w-auto max-w-full rounded-xl" />
        ) : (
          <div className="flex h-32 w-48 items-center justify-center rounded-xl bg-black/5 text-xs text-slate-500">
            {error ? "No se pudo cargar" : "Cargando…"}
          </div>
        )}
        {sizeLabel && <p className="mt-1 text-[10px] opacity-70">{sizeLabel}</p>}
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="min-w-[240px] max-w-[360px]">
        {blobUrl ? (
          <audio src={blobUrl} controls className="block w-full" preload="metadata" />
        ) : (
          <div className="flex h-10 w-full items-center justify-center rounded-xl bg-black/5 text-xs text-slate-500">
            {error ? "No se pudo cargar" : "Cargando audio…"}
          </div>
        )}
        <p className="mt-1 truncate text-[10px] opacity-70">
          {name}{sizeLabel ? ` · ${sizeLabel}` : ""}
        </p>
      </div>
    );
  }

  // PDFs and everything else — file pill that opens the blob in a new tab
  // when ready. Looks like the WhatsApp document chip.
  return (
    <a
      href={blobUrl ?? "#"}
      target={blobUrl ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={(e) => { if (!blobUrl) e.preventDefault(); }}
      className={
        variant === "light"
          ? "inline-flex max-w-full items-center gap-2.5 rounded-xl bg-white/15 px-3 py-2 hover:bg-white/25"
          : "inline-flex max-w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:border-blue-300 hover:bg-blue-50"
      }
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/5">
        {iconForMime(mime, variant)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{name}</span>
        <span className="block text-[10px] opacity-70">
          {sizeLabel ? `${sizeLabel} · ` : ""}{mime}
        </span>
      </span>
      <OpenInNewIcon sx={{ fontSize: 14 }} className="shrink-0 opacity-60" />
    </a>
  );
}

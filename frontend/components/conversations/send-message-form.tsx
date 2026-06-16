"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CloseIcon from "@mui/icons-material/Close";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import type { SendMessageFormData } from "@/types";
import { ContentType } from "@/types";
import { api } from "@/lib/api/endpoints";
import { QuickReplyPicker, type QuickReplyOption } from "./quick-reply-picker";
import { SendPdfButton } from "./send-pdf-button";
import { RegisterOrderDialog } from "./register-order-dialog";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";

const sendMessageSchema = z.object({
  content: z.string(),
  contentType: z.nativeEnum(ContentType),
});

interface SendMessageFormProps {
  conversationId: string;
  // Powers the Send-PDF picker (lists this contact's quotes). May be null
  // for legacy conversations without a linked contact — in that case the
  // picker still offers the transcript option.
  contactId?: string | null;
  // Optional contact name for prefill in the order-registration dialog.
  contactName?: string | null;
  onMessageSent: () => void;
  onSendMessage: (content: string) => Promise<void>;
  // When true, every control inside the composer is disabled and the
  // textarea shows `lockedReason` as the placeholder. Used when the
  // viewer can read the conversation but isn't the assigned operator
  // (e.g. ATENCION on an unassigned conv before takeover).
  locked?: boolean;
  lockedReason?: string;
}

const ACCEPTED_MIME = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
  "video/mp4", "video/quicktime", "video/webm",
  // Audio shapes — the recorder path always handled audio, but the file
  // picker was MIME-gated to media types only, so the operator couldn't
  // attach an existing voice note from disk. Marcos 2026-06-06: parity
  // between recorded + picked audio is part of the Fase 1 closing scope.
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm",
].join(",");

function iconForMime(mime: string) {
  if (mime.startsWith("image/")) return <ImageOutlinedIcon sx={{ fontSize: 18 }} className="text-blue-600" />;
  if (mime === "application/pdf") return <PictureAsPdfIcon sx={{ fontSize: 18 }} className="text-rose-600" />;
  if (mime.startsWith("video/")) return <VideocamOutlinedIcon sx={{ fontSize: 18 }} className="text-violet-600" />;
  if (mime.startsWith("audio/")) return <VolumeUpOutlinedIcon sx={{ fontSize: 18 }} className="text-amber-600" />;
  return <InsertDriveFileOutlinedIcon sx={{ fontSize: 18 }} className="text-slate-600" />;
}

// Picks the best audio container the browser can record. Falls back through
// the spec's typical support matrix; everything we list is on our backend
// allow-list.
function pickAudioMime(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function SendMessageForm({
  conversationId,
  contactId,
  contactName,
  onMessageSent,
  onSendMessage,
  locked = false,
  lockedReason,
}: SendMessageFormProps) {
  const [isSending, setIsSending] = useState(false);
  const [isRedacting, setIsRedacting] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReplyOption[]>([]);
  // Picker stays open while textarea starts with "/" — query is whatever
  // follows the slash, used for fuzzy filtering inside QuickReplyPicker.
  const [pickerQuery, setPickerQuery] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);

  // Tear down any active recorder + timer when the component unmounts so we
  // don't leave the microphone reserved.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Load templates once per mount — small list, no need for pagination.
  useEffect(() => {
    let cancelled = false;
    api.conversations.listQuickReplies()
      .then((rows) => { if (!cancelled) setQuickReplies(rows); })
      .catch(() => { /* feature degrades silently if backend unreachable */ });
    return () => { cancelled = true; };
  }, []);

  // We keep a manual `value` state because the picker programmatically
  // overwrites the textarea — react-hook-form's uncontrolled mode would
  // require a remount to reflect that. Validation still goes through rhf
  // via `handleSubmit` + zod.
  const [contentValue, setContentValue] = useState<string>("");
  const {
    handleSubmit,
    reset,
    setValue: rhfSetValue,
    formState: { errors },
  } = useForm<SendMessageFormData>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      content: "",
      contentType: ContentType.TEXT,
    },
  });

  // Mirror local state into RHF whenever the operator types or we
  // programmatically inject a quick reply.
  useEffect(() => {
    rhfSetValue("content", contentValue, { shouldDirty: true });
  }, [contentValue, rhfSetValue]);

  const onSubmit = async (data: SendMessageFormData) => {
    // If a file is staged, this is an attachment send; the textarea content
    // becomes the (optional) caption. Otherwise it's a plain text message
    // and content must not be empty.
    if (pending) {
      setIsSending(true);
      try {
        await api.conversations.uploadAttachment(conversationId, pending, data.content || "");
        setPending(null);
        setContentValue("");
        reset();
        onMessageSent();
      } catch (err: any) {
        toast.error(err?.response?.data?.message || err?.message || "Error al enviar adjunto");
      } finally {
        setIsSending(false);
      }
      return;
    }

    if (!data.content || data.content.trim().length === 0) {
      // Same UX as before — silently no-op so an accidental Enter on an
      // empty textarea doesn't surface a noisy error.
      return;
    }
    setIsSending(true);
    try {
      await onSendMessage(data.content);
      setContentValue("");
      reset();
      // Don't call onMessageSent() for text messages — the parent's
      // handleSendMessage already swaps the optimistic temp for the
      // server row in place, so a full loadConversation() here would
      // flash the skeleton (Marcos's "se recarga la página" UX bug).
      // Attachment / register-order / send-PDF branches DO still call
      // onMessageSent() above because they don't have an in-place
      // optimistic path.
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Picker eats Enter / Esc / Arrows when it's open, so don't double-handle.
    if (pickerQuery !== null) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(onSubmit)();
    }
  };

  // Watch the textarea for the slash-trigger. We only open the picker
  // when "/" is the FIRST character of the input — keeps random "/" inside
  // a sentence from popping the menu.
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    if (v.startsWith("/")) {
      setPickerQuery(v.slice(1));
    } else if (pickerQuery !== null) {
      setPickerQuery(null);
    }
  };

  const handlePick = (opt: QuickReplyOption) => {
    setContentValue(opt.content);
    setPickerQuery(null);
    // Best-effort usage tracking — never blocks the operator.
    api.conversations.markQuickReplyUsed(opt.id).catch(() => {});
  };

  const handlePickerDismiss = () => {
    // Strip the leading "/" so dismissing leaves a clean textarea.
    if (contentValue.startsWith("/")) setContentValue("");
    setPickerQuery(null);
  };

  const handleFilePick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPending(file);
    // Reset the input so picking the same file twice still triggers a change.
    e.target.value = "";
  };
  const clearPending = () => setPending(null);

  const startRecording = async () => {
    if (isRecording || isSending) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Tu navegador no soporta grabación de audio");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recordChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        // Tear down the mic stream the moment the recorder reports done.
        recordStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;

        const blob = new Blob(recordChunksRef.current, { type: mime });
        recordChunksRef.current = [];
        if (blob.size === 0) return;

        const ext = mime.includes("ogg") ? ".ogg" : mime.includes("mp4") ? ".m4a" : ".webm";
        const ts = new Date();
        const stamp =
          ts.getFullYear().toString() +
          String(ts.getMonth() + 1).padStart(2, "0") +
          String(ts.getDate()).padStart(2, "0") + "-" +
          String(ts.getHours()).padStart(2, "0") +
          String(ts.getMinutes()).padStart(2, "0") +
          String(ts.getSeconds()).padStart(2, "0");
        const name = `audio-${stamp}${ext}`;
        // Some browsers report audio/webm;codecs=opus — strip the codec
        // qualifier so it matches the backend's MIME allow-list.
        const baseMime = mime.split(";")[0];
        setPending(new File([blob], name, { type: baseMime }));
      };
      rec.start();
      recorderRef.current = rec;
      setRecordSeconds(0);
      setIsRecording(true);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      // Common cause: user denied mic access. Don't spam logs — just toast.
      toast.error(err?.message?.includes("denied") || err?.name === "NotAllowedError"
        ? "Permiso de micrófono denegado"
        : "No se pudo iniciar la grabación");
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try { recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    setIsRecording(false);
  };

  const handleRedact = async () => {
    if (isRedacting || isSending || isRecording) return;
    setIsRedacting(true);
    const draft = contentValue;
    const mode: 'improve' | 'suggest' = draft.trim().length === 0 ? 'suggest' : 'improve';
    try {
      const r = await api.conversations.redactWithAi(conversationId, draft, mode);
      if (r.success) {
        setContentValue(r.data.text);
      } else {
        // Friendly reason — usually "CLAUDE_API_KEY no está configurada".
        toast.message('Redactar con IA no disponible', { description: r.reason });
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Error al redactar');
    } finally {
      setIsRedacting(false);
    }
  };

  const cancelRecording = () => {
    if (!isRecording) return;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    // Drop chunks before stopping so onstop sees an empty blob and exits.
    recordChunksRef.current = [];
    try { recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
    setIsRecording(false);
    setRecordSeconds(0);
  };

  const placeholder = locked
    ? (lockedReason || 'Tomá la conversación para responder')
    : pending
      ? "Caption (opcional) — Enter para enviar"
      : 'Escribe aquí... (/ para respuestas rápidas, Enter para enviar)';

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-2" data-locked={locked || undefined}>
      {locked && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span>{lockedReason || 'Tomá la conversación para responder.'}</span>
        </div>
      )}
      {isRecording && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-rose-100 text-rose-600">
            <GraphicEqIcon sx={{ fontSize: 14 }} />
          </span>
          <span className="min-w-0 flex-1 text-xs font-medium text-rose-800">
            Grabando audio…
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-rose-700">
            {String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:
            {String(recordSeconds % 60).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancelar grabación"
            className="grid h-6 w-6 place-items-center rounded-full text-rose-400 transition-colors hover:bg-rose-100 hover:text-rose-700"
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </button>
        </div>
      )}
      {pending && !isRecording && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          {iconForMime(pending.type)}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
            {pending.name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
            {formatBytes(pending.size)}
          </span>
          <button
            type="button"
            onClick={clearPending}
            aria-label="Quitar adjunto"
            className="grid h-6 w-6 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MIME}
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Left-side action buttons. On mobile they share their own row above the
            textarea so 6 controls don't crush horizontally. On sm+ the wrapper
            uses display:contents so its children become direct flex siblings of
            the outer row, restoring the original single-row layout. */}
        <div className="flex items-center gap-2 sm:contents">
          <button
            type="button"
            onClick={handleFilePick}
            disabled={locked || isSending || isRecording}
            aria-label="Adjuntar archivo"
            title={locked ? (lockedReason || 'Tomá la conversación para responder') : 'Adjuntar foto, PDF o video'}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
          >
            <AttachFileIcon sx={{ fontSize: 18 }} />
          </button>

          <SendPdfButton
            conversationId={conversationId}
            contactId={contactId}
            disabled={locked || isSending || isRecording}
            disabledReason={lockedReason}
            onSent={onMessageSent}
          />

          <button
            type="button"
            onClick={() => contactId && setShowOrderDialog(true)}
            disabled={locked || isSending || isRecording || !contactId}
            aria-label="Registrar pedido"
            title={
              !contactId
                ? "Esta conversación todavía no tiene un contacto asociado"
                : locked
                  ? (lockedReason || "Tomá la conversación para responder")
                  : "Registrar pedido vinculado a esta conversación"
            }
            data-testid="register-order-button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
          >
            <ReceiptLongIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        <div className="relative min-w-0 flex-1">
          {pickerQuery !== null && quickReplies.length > 0 && (
            <QuickReplyPicker
              options={quickReplies}
              query={pickerQuery}
              onPick={handlePick}
              onDismiss={handlePickerDismiss}
            />
          )}
          <Textarea
            name="content"
            data-testid="composer-message-input"
            value={contentValue}
            onChange={(e) => {
              setContentValue(e.target.value);
              handleContentChange(e);
            }}
            placeholder={placeholder}
            rows={pending ? 1 : 2}
            disabled={locked || isSending}
            onKeyDown={handleKeyDown}
            className={`resize-none rounded-xl border-slate-200 text-sm leading-relaxed placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-4 focus-visible:ring-blue-500/15 sm:[--rows:3] ${
              errors.content ? "border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500/15" : ""
            }`}
          />
          {errors.content && (
            <p className="mt-1 text-xs text-red-600">{errors.content.message}</p>
          )}
        </div>

        {/* Right-side action buttons (redact/mic/send). Same display:contents trick —
            on mobile they share the textarea row, on sm+ they collapse to direct flex siblings. */}
        <div className="flex items-end gap-2 sm:contents">
        <button
          type="button"
          onClick={handleRedact}
          disabled={locked || isRedacting || isSending || isRecording}
          aria-label="Redactar con IA"
          title={locked ? (lockedReason || 'Tomá la conversación para responder') : 'Redactar con IA — mejora tu borrador o sugiere una respuesta'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:bg-slate-50"
        >
          {isRedacting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-300 border-t-violet-700" />
          ) : (
            <AutoAwesomeIcon sx={{ fontSize: 18 }} />
          )}
        </button>

        {isRecording ? (
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Detener grabación"
            title="Detener grabación"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-600 text-white shadow-[0_8px_20px_-6px_rgb(244_63_94/0.5)] hover:bg-rose-700"
          >
            <StopIcon sx={{ fontSize: 18 }} />
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            disabled={locked || isSending || !!pending}
            aria-label="Grabar audio"
            title={locked ? (lockedReason || 'Tomá la conversación para responder') : 'Grabar mensaje de voz'}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
          >
            <MicIcon sx={{ fontSize: 18 }} />
          </button>
        )}

        <button
          type="submit"
          disabled={locked || isSending || isRecording}
          aria-label="Enviar mensaje"
          title={locked ? (lockedReason || 'Tomá la conversación para responder') : 'Enviar mensaje'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)] hover:from-blue-700 hover:to-cyan-600 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:opacity-70"
        >
          {isSending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <SendIcon sx={{ fontSize: 18 }} />
          )}
        </button>
        </div>
      </div>

      {contactId && (
        <RegisterOrderDialog
          open={showOrderDialog}
          onOpenChange={setShowOrderDialog}
          conversationId={conversationId}
          contactId={contactId}
          contactName={contactName}
          onRegistered={onMessageSent}
        />
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Textarea } from "@/components/ui/textarea";
import SendIcon from "@mui/icons-material/Send";
import type { SendMessageFormData } from "@/types";
import { ContentType } from "@/types";

const sendMessageSchema = z.object({
  content: z.string().min(1, "El mensaje no puede estar vacío"),
  contentType: z.nativeEnum(ContentType),
});

interface SendMessageFormProps {
  conversationId: string;
  onMessageSent: () => void;
  onSendMessage: (content: string) => Promise<void>;
}

export function SendMessageForm({
  onMessageSent,
  onSendMessage,
}: SendMessageFormProps) {
  const [isSending, setIsSending] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SendMessageFormData>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      content: "",
      contentType: ContentType.TEXT,
    },
  });

  const onSubmit = async (data: SendMessageFormData) => {
    setIsSending(true);
    try {
      await onSendMessage(data.content);
      reset();
      onMessageSent();
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(onSubmit)();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Textarea
          {...register("content")}
          placeholder="Escribe un mensaje... (Enter para enviar, Shift+Enter para nueva línea)"
          rows={3}
          disabled={isSending}
          onKeyDown={handleKeyDown}
          className={`resize-none rounded-xl border-slate-200 text-sm leading-relaxed placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-4 focus-visible:ring-blue-500/15 ${
            errors.content ? "border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500/15" : ""
          }`}
        />
        {errors.content && (
          <p className="mt-1 text-xs text-red-600">{errors.content.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSending}
        aria-label="Enviar mensaje"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)] hover:from-blue-700 hover:to-cyan-600 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSending ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <SendIcon sx={{ fontSize: 18 }} />
        )}
      </button>
    </form>
  );
}

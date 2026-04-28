"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
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
  conversationId,
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex gap-2">
      <div className="flex-1">
        <Textarea
          {...register("content")}
          placeholder="Escribe un mensaje... (Enter para enviar, Shift+Enter para nueva línea)"
          rows={3}
          disabled={isSending}
          onKeyDown={handleKeyDown}
          className={errors.content ? "border-destructive" : ""}
        />
        {errors.content && (
          <p className="text-sm text-destructive mt-1">{errors.content.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSending} size="icon" className="self-end">
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}

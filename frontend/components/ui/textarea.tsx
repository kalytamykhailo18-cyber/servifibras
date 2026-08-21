import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          // Layout & shape
          "flex field-sizing-content min-h-20 w-full rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
          // Surface
          "border border-slate-200 bg-white text-slate-900",
          "placeholder:text-slate-400",
          // Hover & focus
          "outline-none transition-colors duration-200",
          "hover:border-slate-300",
          "focus-visible:border-blue-500 focus-visible:ring-4 focus-visible:ring-blue-500/15",
          // Invalid
          "aria-invalid:border-red-400 aria-invalid:focus-visible:border-red-500 aria-invalid:focus-visible:ring-red-500/15",
          // Disabled
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200",
          className
        )}
        {...props}
      />
    )
  }
)

export { Textarea }

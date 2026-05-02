import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Layout & shape
        "h-11 w-full min-w-0 rounded-xl px-3.5 text-sm",
        // Surface
        "border border-slate-200 bg-white text-slate-900",
        "placeholder:text-slate-400",
        // Hover & focus
        "outline-none transition-colors duration-200",
        "hover:border-slate-300",
        "focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15",
        // Invalid
        "aria-invalid:border-red-400 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/15",
        // Disabled
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200",
        // File input affordance
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-slate-700",
        className
      )}
      {...props}
    />
  )
}

export { Input }

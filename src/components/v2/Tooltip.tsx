/**
 * Tooltip simples para explicar opções técnicas.
 *
 * Uso:
 *   <Tooltip content="O número que aparece no WhatsApp do cliente">
 *     <Info className="w-3.5 h-3.5 text-slate-400" />
 *   </Tooltip>
 */
import React, { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, position = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);

  const positionClass = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[position];

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.12 }}
            className={`absolute z-50 ${positionClass} whitespace-normal max-w-[240px] bg-slate-800 text-white text-[11px] leading-snug px-2.5 py-1.5 rounded-md shadow-lg pointer-events-none`}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

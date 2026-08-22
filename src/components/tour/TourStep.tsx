import React from 'react';
import { motion } from 'framer-motion';
import { useTour } from '@reactour/tour';
import { SPRING } from '@/components/onboarding/motion-presets';

// Presentational step body for the product tour — keeps every popover
// consistent with the dark, dense UI. Re-keyed on the current step so the
// content replays its entrance each time the tour advances, with an animated
// progress bar tying the steps together.
export function TourStep({ title, body }: { title: string; body: React.ReactNode }) {
  const { currentStep, steps } = useTour();
  const total = steps?.length ?? 1;
  const progress = Math.min(1, (currentStep + 1) / total);

  return (
    <motion.div
      key={currentStep}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="px-1 py-0.5"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--border))]">
          <motion.div
            className="h-full rounded-full bg-[hsl(var(--primary))]"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: progress }}
            style={{ originX: 0 }}
            transition={SPRING}
          />
        </div>
        <span className="shrink-0 font-mono text-[9px] tabular-nums text-[hsl(var(--text-secondary))]">
          {currentStep + 1}/{total}
        </span>
      </div>
      <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-[hsl(var(--text-primary))]">{title}</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[hsl(var(--text-secondary))]">{body}</p>
    </motion.div>
  );
}

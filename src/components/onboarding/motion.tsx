import React from 'react';
import {
  motion,
  MotionConfig,
  type HTMLMotionProps,
} from 'framer-motion';
import {
  staggerContainer,
  fadeInUp,
} from './motion-presets';

/**
 * Shared motion language for every onboarding surface (setup wizard, product
 * tour, welcome empty state, bridge setup). The springs/variants/press presets
 * live in ./motion-presets; this file holds only the component wrappers.
 *
 * Direction: "refined & on-brand" — quick, purposeful, never bouncy. Springs
 * are stiff with high damping so things settle fast with minimal overshoot,
 * matching the dark/dense "Warp meets Linear" aesthetic. All of it is wrapped
 * in <MotionConfig reducedMotion="user">, so the OS "reduce motion" setting
 * collapses transforms to simple opacity automatically.
 */

/**
 * Wrap an onboarding surface so all descendant framer-motion animations honor
 * the OS reduced-motion preference. Place it at the root of each surface.
 */
export function OnboardingMotionConfig({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

type StaggerProps = HTMLMotionProps<'div'> & { children: React.ReactNode };

/** A container that cascades its <StaggerItem> children in on mount. */
export function Stagger({ children, ...props }: StaggerProps) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" {...props}>
      {children}
    </motion.div>
  );
}

/** A single staggered child (rise + fade). */
export function StaggerItem({ children, ...props }: StaggerProps) {
  return (
    <motion.div variants={fadeInUp} {...props}>
      {children}
    </motion.div>
  );
}

import { motion } from 'framer-motion';

const ease = [0.22, 1, 0.36, 1] as const;

export function FinaleScene() {
  return (
    <motion.section className="film-scene finale-scene" initial={{ opacity: 0, clipPath: 'circle(0% at 50% 50%)' }} animate={{ opacity: 1, clipPath: 'circle(150% at 50% 50%)' }} transition={{ duration: 0.45, ease }} exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.28 } }}>
      <div className="finale-orbit orbit-one" /><div className="finale-orbit orbit-two" />
      <div className="finale-corner-mark">PHA <span>·</span> 2025</div>
      <div className="finale-copy-stage">
        <motion.div className="finale-outline" initial={{ opacity: 0, clipPath: 'inset(0 50% 0 50%)' }} animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0%)' }} transition={{ delay: 0.12, duration: 0.44, ease }}>EVIDENCE</motion.div>
        <motion.div className="finale-solid" initial={{ opacity: 0, scale: 0.84, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.56, duration: 0.5, ease }}>NOT VERDICT</motion.div>
      </div>
      <motion.div className="finale-lockup" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.28, duration: 0.52, ease }}>
        <div className="lockup-icon"><span /><span /><span /></div>
        <span>Phish Intake <b>Analyzer</b></span>
        <motion.div className="lockup-underline" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.58, duration: 0.65, ease }} />
      </motion.div>
      <motion.p className="finale-tagline" initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.02, duration: 0.42, ease }}>A defensible triage note, for human review.</motion.p>
      <div className="finale-tags" aria-label="Summary themes">
        <motion.span initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.2, duration: 0.32 }}>SIGNALS</motion.span>
        <motion.span initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.46, duration: 0.32 }}>CONTEXT</motion.span>
        <motion.span initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.72, duration: 0.32 }}>REVIEW</motion.span>
      </div>
      <motion.p className="finale-caution" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 4.9, duration: 0.42 }}>Use findings as supporting evidence, not a standalone verdict.</motion.p>
      <motion.div className="loop-understroke" initial={{ scaleX: 0.78, rotate: 0, x: 0, opacity: 0.9 }} animate={{ scaleX: [0.78, 1, 1, 0.8], rotate: [0, 0, -22, -22], x: [0, 0, -34, -34], y: [0, 0, -24, -24] }} transition={{ times: [0, 0.54, 0.88, 1], duration: 7.85, ease: 'easeInOut' }} />
      <motion.div className="loop-message-fragment" initial={{ opacity: 0, x: 20, y: 12 }} animate={{ opacity: [0, 0, 1, 0], x: [20, 20, 0, -24], y: [12, 12, 0, -14] }} transition={{ times: [0, 0.83, 0.95, 1], duration: 7.85, ease: 'easeInOut' }}>parcel-update-check.example</motion.div>
      <div className="finale-safe-note">HEURISTIC ANALYSIS <span>·</span> HUMAN REVIEW</div>
    </motion.section>
  );
}

import { motion } from 'framer-motion';

const ease = [0.22, 1, 0.36, 1] as const;

export function LinkScene() {
  return (
    <motion.section className="film-scene link-scene" initial={{ opacity: 0, clipPath: 'inset(0 0 0 100%)' }} animate={{ opacity: 1, clipPath: 'inset(0 0 0 0%)' }} exit={{ opacity: 0, clipPath: 'inset(0 100% 0 0)', transition: { duration: 0.25 } }} transition={{ duration: 0.48, ease }}>
      <div className="link-paper-fold" />
      <div className="scene-index ink-index">TRACE <b>02 / 04</b></div>
      <motion.div className="destination-label" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.3 }}>DESTINATION <span>URL / EXTRACTED</span></motion.div>
      <motion.div className="destination-domain" initial={{ opacity: 0, scale: 0.88, x: -22 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ delay: 0.32, duration: 0.54, ease }}>
        <span className="domain-prefix">https://</span>parcel-update-check<span className="domain-suffix">.example</span>
      </motion.div>
      <svg className="trace-svg" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
        <motion.path d="M94 494 C350 494 390 494 570 494 S730 494 794 548 C870 612 912 606 1012 606 S1236 606 1505 606" fill="none" stroke="#b75943" strokeWidth="3" strokeDasharray="11 12" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.72, duration: 2.1, ease: 'easeInOut' }} />
        <motion.circle cx="794" cy="548" r="9" fill="#b75943" initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }} transition={{ delay: 1.65, duration: 0.32, ease }} />
      </svg>
      <motion.div className="mismatch-pair" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.15, duration: 0.42, ease }}>
        <span className="mismatch-chip">DISPLAYED AS</span><span className="mismatch-copy">delivery tracking</span><span className="mismatch-not-equal">≠</span><span className="mismatch-chip actual-chip">ACTUAL DESTINATION</span>
      </motion.div>
      <motion.div className="redirect-note" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 2.05, duration: 0.46, ease }}>
        <span className="redirect-nodes"><i /><i /><i /></span><span>redirect chain detected</span>
      </motion.div>
      <motion.div className="signal-tags" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.0, duration: 0.35 }}>
        <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.02 }}>DESTINATION MISMATCH</motion.span>
        <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.3 }}>REDIRECT PATH</motion.span>
      </motion.div>
      <motion.p className="link-caution" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 3.9, duration: 0.4, ease }}>One signal is not the whole story.</motion.p>
      <motion.div className="score-carrier" initial={{ scale: 0.15, rotate: -36, opacity: 0 }} animate={{ scale: [0.15, 1, 1, 1.8], rotate: [ -36, 0, 18, 18], opacity: [0, 1, 1, 0] }} transition={{ times: [0, 0.28, 0.8, 1], duration: 5.8, ease: 'easeInOut' }} />
      <div className="scene-footnote ink-footnote">LINK TEXT <span>≠</span> DESTINATION</div>
    </motion.section>
  );
}

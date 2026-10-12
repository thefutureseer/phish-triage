import { motion } from 'framer-motion';

const ease = [0.22, 1, 0.36, 1] as const;

export function MessageScene() {
  return (
    <motion.section className="film-scene message-scene" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.025, transition: { duration: 0.26 } }}>
      <div className="scene-grain" />
      <div className="scene-index">FIELD NOTE <b>001 / 004</b></div>
      <motion.div
        className="message-card"
        style={{ transformOrigin: '64% 72%' }}
        initial={{ opacity: 0.4, rotate: -4, x: -35, scale: 0.94 }}
        animate={{ opacity: [0.4, 1, 1, 0], rotate: [-4, -2.2, -2.2, -2.2], x: [-35, 0, 0, 0], scale: [0.94, 1, 1, 2.8] }}
        transition={{ times: [0, 0.18, 0.78, 1], duration: 4.55, ease: 'easeInOut' }}
      >
        <div className="message-meta"><span className="signal-dot" /> UNKNOWN SENDER <span className="message-time">08:42 AM</span></div>
        <motion.div className="message-rule" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.12, duration: 0.35, ease }} />
        <motion.p className="message-main" initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)' }} transition={{ delay: 0.22, duration: 0.5, ease }}>Your package is<br />on hold.</motion.p>
        <motion.p className="message-fee" initial={{ opacity: 0, scale: 0.72, x: -15 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ delay: 0.7, duration: 0.34, type: 'spring', stiffness: 280, damping: 16 }}>Unpaid $1.82 customs fee.</motion.p>
        <motion.p className="message-deadline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.14, duration: 0.35, ease }}>Confirm within 12 hours:</motion.p>
        <motion.div className="message-url" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.48, duration: 0.4, ease }}>
          parcel-update-check.example
          <motion.span className="url-underline" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.72, duration: 0.5, ease }} />
        </motion.div>
        <div className="message-bottom"><span>Reply STOP to opt out</span><span className="message-bubble-mark">SMS / UNVERIFIED</span></div>
      </motion.div>
      <motion.div className="magnifier-ring" initial={{ scale: 0.25, opacity: 0 }} animate={{ scale: [0.25, 1, 1.06, 2.8], opacity: [0, 0.9, 0.9, 0] }} transition={{ times: [0, 0.28, 0.83, 1], duration: 4.55, ease: ['easeOut', 'linear', 'easeIn'] }} />
      <motion.div className="message-focus-line" initial={{ scaleX: 0 }} animate={{ scaleX: [0, 1, 1, 0] }} transition={{ times: [0, 0.58, 0.85, 1], duration: 4.55, ease: 'easeInOut' }} />
      <div className="scene-footnote">SUSPICIOUS SMS <span>·</span> UNTRUSTED LINK</div>
    </motion.section>
  );
}

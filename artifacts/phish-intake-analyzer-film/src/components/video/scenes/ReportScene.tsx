import { motion } from 'framer-motion';

const ease = [0.22, 1, 0.36, 1] as const;

export function ReportScene() {
  return (
    <motion.section className="film-scene report-scene" initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.07, transition: { duration: 0.24 } }} transition={{ duration: 0.42, ease }}>
      <div className="report-ambient-grid" />
      <div className="scene-index">ANALYST WORKBENCH <b>03 / 04</b></div>
      <motion.div className="report-kicker" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12, duration: 0.34 }}>TRIAGE ASSESSMENT <span>SMS / HEURISTIC</span></motion.div>
      <motion.div className="report-card" initial={{ opacity: 0, rotateY: 14, rotateZ: 1.6, x: 55, scale: 0.88 }} animate={{ opacity: 1, rotateY: 0, rotateZ: 0, x: 0, scale: 1 }} transition={{ delay: 0.12, duration: 0.78, ease }}>
        <div className="report-card-top"><span>INTAKE / 01</span><span className="report-online"><i /> REVIEW READY</span></div>
        <div className="report-main">
          <div className="score-dial">
            <svg viewBox="0 0 180 180" aria-hidden="true">
              <circle cx="90" cy="90" r="72" fill="none" stroke="#e8e4d9" strokeWidth="7" />
              <motion.circle cx="90" cy="90" r="72" fill="none" stroke="#b75943" strokeWidth="7" strokeLinecap="round" transform="rotate(-90 90 90)" strokeDasharray="452" initial={{ strokeDashoffset: 452 }} animate={{ strokeDashoffset: 126.5 }} transition={{ delay: 0.5, duration: 0.92, ease }} />
            </svg>
            <motion.div className="score-value" initial={{ opacity: 0, scale: 0.68 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.68, duration: 0.34, type: 'spring', stiffness: 250, damping: 18 }}>
              <strong>72</strong><span>/100</span>
            </motion.div>
          </div>
          <div className="report-score-copy">
            <div className="risk-badge">HIGH RISK</div>
            <div className="score-description">Heuristic score<br />not a guarantee</div>
            <div className="score-caption">ASSESSMENT</div>
          </div>
          <div className="report-summary">
            <span>SUMMARY</span>
            <p>Urgent payment language and a mismatched destination warrant careful review.</p>
          </div>
        </div>
        <div className="report-divider" />
        <div className="report-findings-title">KEY FINDINGS <span>02</span></div>
        <motion.div className="finding-row" initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.72, duration: 0.35, ease }}><i /> Link destination mismatch <b>+24</b></motion.div>
        <motion.div className="finding-row" initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 2.08, duration: 0.35, ease }}><i /> Unusual urgency language <b>+18</b></motion.div>
        <motion.div className="indicator-row" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.52, duration: 0.38, ease }}>
          <span className="indicator-label">EXTRACTED INDICATOR</span><code>parcel-update-check.example</code><span className="indicator-reputation">UNKNOWN</span>
        </motion.div>
        <motion.div className="report-auth" initial={{ opacity: 0, scaleX: 0.82 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: 3.35, duration: 0.42, ease }}>
          <span className="auth-title">EMAIL CONTEXT <small>SEPARATE EXAMPLE</small></span>
          <span><b>SPF</b> PASS</span><span><b>DKIM</b> PASS</span><span className="auth-fail"><b>DMARC</b> FAIL</span>
        </motion.div>
        <motion.div className="report-foot">Illustrative assessment · human review required</motion.div>
      </motion.div>
      <motion.div className="report-side-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: [0, 1, 1, 0], y: [12, 0, 0, -18] }} transition={{ times: [0, 0.15, 0.86, 1], duration: 5.8, ease: 'easeInOut' }}>
        <span>FROM MESSAGE</span>
        <strong>TO EVIDENCE</strong>
        <div className="side-rule" />
        <p>Signals, context,<br />and a clear trail.</p>
      </motion.div>
      <motion.div className="report-ring-carrier" initial={{ scale: 0.2, opacity: 0, rotate: 0 }} animate={{ scale: [0.2, 1, 1, 3.3], opacity: [0, 0.68, 0.68, 0], rotate: [0, 0, 10, 10] }} transition={{ times: [0, 0.18, 0.8, 1], duration: 5.8, ease: 'easeInOut' }} />
      <div className="scene-footnote report-footnote">EXAMPLE VISUALIZATION <span>·</span> NOT LIVE CASE DATA</div>
    </motion.section>
  );
}

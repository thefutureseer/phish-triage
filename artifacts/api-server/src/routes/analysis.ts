import { Router, type IRouter } from "express";
import {
  AnalyzeContentBody,
  AnalyzeContentResponse,
  GetAnalysisProvidersResponse,
} from "@workspace/api-zod";
import { analyzeMessage } from "../lib/phishing-analysis";

const router: IRouter = Router();

router.get("/analysis/providers", (_req, res): void => {
  const provider = process.env.VIRUSTOTAL_API_KEY
    ? "virustotal"
    : process.env.GOOGLE_SAFE_BROWSING_API_KEY
      ? "google_safe_browsing"
      : null;
  res.json(
    GetAnalysisProvidersResponse.parse({
      configured: provider !== null,
      provider,
    }),
  );
});

router.post("/analysis", async (req, res): Promise<void> => {
  const parsed = AnalyzeContentBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid analysis request");
    res.status(400).json({ error: "Provide SMS or email content to analyze." });
    return;
  }

  try {
    const result = await analyzeMessage(parsed.data.source, parsed.data.content);
    res.json(AnalyzeContentResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Message analysis failed");
    res.status(500).json({ error: "Analysis could not be completed." });
  }
});

export default router;

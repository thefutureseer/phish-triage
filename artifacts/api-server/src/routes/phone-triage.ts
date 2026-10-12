import { Router, type IRouter } from "express";
import {
  TriagePhoneNumberBody,
  TriagePhoneNumberResponse,
} from "@workspace/api-zod";
import {
  analyzePhoneNumber,
  PhoneNumberInputError,
} from "../lib/phone-triage";

const router: IRouter = Router();

router.post("/triage/phone", async (req, res): Promise<void> => {
  const parsed = TriagePhoneNumberBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid phone triage request");
    res.status(400).json({ error: "Provide a phone number and a valid default country." });
    return;
  }

  try {
    const result = await analyzePhoneNumber(
      parsed.data,
      process.env.ABSTRACT_PHONE_KEY,
    );
    if (result.externalLookupStatus === "unavailable") {
      req.log.warn(
        { provider: "abstract_phone" },
        "External phone lookup unavailable; returning local analysis",
      );
    }
    res.json(TriagePhoneNumberResponse.parse(result));
  } catch (error) {
    if (error instanceof PhoneNumberInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Phone number triage failed",
    );
    res.status(502).json({ error: "Phone number analysis could not be completed." });
  }
});

export default router;

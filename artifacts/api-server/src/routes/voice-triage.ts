import multer from "multer";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  TriageVoiceBody,
  TriageVoiceResponse,
} from "@workspace/api-zod";
import {
  analyzeVoiceTranscript,
  getMockAudioTranscript,
  transcribeWithWhisper,
  VoiceTranscriptionError,
} from "../lib/voice-triage";

const router: IRouter = Router();
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MIME_TYPES_BY_EXTENSION: Record<string, readonly string[]> = {
  ".mp3": ["audio/mpeg", "audio/mp3", "application/octet-stream"],
  ".wav": ["audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"],
  ".m4a": ["audio/mp4", "audio/x-m4a", "audio/m4a", "application/octet-stream"],
};

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter(_req, file, callback) {
    const extension = file.originalname.toLowerCase().match(/\.(mp3|wav|m4a)$/)?.[0];
    const acceptedTypes = extension ? MIME_TYPES_BY_EXTENSION[extension] : undefined;
    if (!acceptedTypes || !acceptedTypes.includes(file.mimetype.toLowerCase())) {
      callback(new Error("Upload an MP3, WAV, or M4A audio file."));
      return;
    }
    callback(null, true);
  },
});

const parseAudioUpload: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }

  audioUpload.single("audio")(req, res, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "Audio must be 24 MiB or smaller." });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: "Upload exactly one audio file in the audio field." });
      return;
    }
    res.status(415).json({ error: "Upload an MP3, WAV, or M4A audio file." });
  });
};

router.post(
  "/triage/voice",
  parseAudioUpload,
  async (req, res): Promise<void> => {
    if (req.is("application/json")) {
      const parsed = TriageVoiceBody.safeParse(req.body);
      if (!parsed.success || !parsed.data.transcript.trim()) {
        res.status(400).json({
          error: "Provide a call transcript between 1 and 100,000 characters.",
        });
        return;
      }

      res.json(
        TriageVoiceResponse.parse(
          analyzeVoiceTranscript(parsed.data.transcript, "provided"),
        ),
      );
      return;
    }

    if (!req.is("multipart/form-data")) {
      res.status(415).json({
        error: "Submit a transcript as JSON or audio as multipart form data.",
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "Select an MP3, WAV, or M4A audio file." });
      return;
    }

    let transcript: string;
    let transcriptionMode: "openai_whisper" | "mock_fallback";
    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey) {
      try {
        transcript = await transcribeWithWhisper(req.file, apiKey);
        transcriptionMode = "openai_whisper";
      } catch (error) {
        if (error instanceof VoiceTranscriptionError) {
          req.log.warn(
            { upstreamStatus: error.upstreamStatus },
            "Whisper transcription failed",
          );
          res.status(502).json({ error: error.message });
          return;
        }
        req.log.error({ err: error }, "Unexpected voice transcription failure");
        res.status(502).json({
          error: "Audio transcription failed. Try again or paste a transcript.",
        });
        return;
      }
    } else {
      transcript = getMockAudioTranscript();
      transcriptionMode = "mock_fallback";
      req.log.info("OPENAI_API_KEY is not configured; using labelled mock transcript");
    }

    res.json(
      TriageVoiceResponse.parse(
        analyzeVoiceTranscript(transcript, transcriptionMode),
      ),
    );
  },
);

export default router;

import OpenAI from "openai";
import { HttpError } from "./http";
import type { AppEnv } from "./types";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function transcribeAudio(client: OpenAI, env: AppEnv, object: R2ObjectBody, fileName: string, mime: string): Promise<string> {
  if (!mime.startsWith("audio/")) throw new HttpError("O arquivo informado não é um áudio válido.", 422);
  if (object.size > MAX_AUDIO_BYTES) throw new HttpError("O áudio excede o limite de 10 MB para transcrição.", 413);
  const bytes = await object.arrayBuffer();
  const file = new File([bytes], fileName || "audio", { type: mime });
  const result = await client.audio.transcriptions.create({
    file,
    model: env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    language: "pt",
    response_format: "json",
  });
  const transcript = result.text.trim();
  if (!transcript) throw new HttpError("Não foi possível obter uma transcrição do áudio.", 422);
  return transcript.slice(0, 12_000);
}

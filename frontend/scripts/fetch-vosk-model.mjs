import fs from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..");

const MODEL_ID = "vosk-model-small-es-0.42";
const MODEL_URL =
  process.env.VOICE_MODEL_URL?.trim() || "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
const outputDir = path.join(frontendRoot, "public", "models");
const outputFile = path.join(outputDir, `${MODEL_ID}.zip`);
const tmpFile = `${outputFile}.tmp`;

async function fileExistsWithContent(target) {
  try {
    const details = await stat(target);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(downloadFile(response.headers.location, destination));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`No pude descargar el modelo (HTTP ${statusCode}).`));
        return;
      }

      const fileStream = fs.createWriteStream(destination);
      response.pipe(fileStream);
      fileStream.on("finish", () => fileStream.close(resolve));
      fileStream.on("error", (error) => reject(error));
    });

    request.on("error", (error) => reject(error));
  });
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  if (await fileExistsWithContent(outputFile)) {
    console.log(`[voice:model] Modelo existente en ${outputFile}`);
    return;
  }

  if (await fileExistsWithContent(tmpFile)) {
    await unlink(tmpFile);
  }

  console.log(`[voice:model] Descargando ${MODEL_URL}`);
  await downloadFile(MODEL_URL, tmpFile);
  await rename(tmpFile, outputFile);
  const details = await stat(outputFile);
  console.log(`[voice:model] Modelo listo (${details.size} bytes): ${outputFile}`);
}

main().catch(async (error) => {
  try {
    if (await fileExistsWithContent(tmpFile)) {
      await unlink(tmpFile);
    }
  } catch {
    // No-op.
  }
  console.error(`[voice:model] Error: ${String(error?.message || error)}`);
  process.exitCode = 1;
});


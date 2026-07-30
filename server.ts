import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT ?? 3000);

  app.use(express.json());

  // Mint an OpenAI Realtime ephemeral client secret — never exposes the real key to the browser
  app.post("/api/realtime/session", async (req, res) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    try {
      const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        // GA Realtime API: the session config must be nested under a `session`
        // object with `type: "realtime"`. (Older/beta shape put these at the top
        // level of the body, which the GA client_secrets endpoint rejects.)
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: req.body?.model ?? "gpt-realtime-2",
            instructions: req.body?.instructions,
            tools: (req.body?.tools ?? []).map((t: any) => ({
              type: "function",
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
            output_modalities: ["audio", "text"],
            audio: {
              input: {
                transcription: { model: "gpt-4o-transcribe" },
                turn_detection: { type: "server_vad" },
              },
              output: {
                voice: req.body?.voice ?? "marin",
              },
            },
          },
        }),
      });
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "token request failed" });
    }
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, "public")));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve built files
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

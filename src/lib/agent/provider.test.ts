import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {afterEach, describe, expect, it} from "vitest";
import type {LlmModelConfig, LlmRequestConfig} from "./config";
import {
  ChatTransportError,
  awaitChannelEnd,
  cancelChatRun,
  runChat,
  type ChatTransport,
  type ChatTransportRequest,
} from "./provider";

const REQUEST_CONFIG: LlmRequestConfig = {
  timeoutMs: 5000,
  retries: 2,
  retryBackoffMs: 1,
};

const MESSAGES = [{role: "user" as const, content: "hi"}];

function model(baseUrl: string, overrides: Partial<LlmModelConfig> = {}): LlmModelConfig {
  return {
    label: "Test",
    baseUrl,
    model: "test-model",
    apiKey: "crypto__TEST__token",
    temperature: 0.1,
    maxTokens: 100,
    contextLimit: 1000,
    timeoutMs: 5000,
    capabilities: {streaming: true, jsonMode: true, tools: false},
    dataScope: "perimeter",
    ...overrides,
  };
}

/** Транспорт для тестов: тот же контракт, что у Tauri, но через fetch. */
function fetchTransport(): ChatTransport {
  return {
    async send(req: ChatTransportRequest): Promise<void> {
      const controller = new AbortController();
      const poll = setInterval(() => {
        if (req.isCancelled()) controller.abort();
      }, 5);

      try {
        const url = `${req.baseUrl.replace(/\/+$/, "")}/chat/completions`;
        const response = await fetch(url, {
          method: "POST",
          headers: {"content-type": "application/json", authorization: "Bearer test"},
          body: JSON.stringify(req.body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new ChatTransportError(`HTTP ${response.status}: ${text}`, {
            status: response.status,
            retryable: response.status >= 500 || response.status === 429,
          });
        }
        if (!response.body) throw new ChatTransportError("empty body", {retryable: true});

        const reader = response.body.getReader();
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          if (!req.onBytes(value)) {
            controller.abort();
            break;
          }
        }
      } catch (e) {
        if (req.isCancelled()) {
          throw new ChatTransportError("cancelled", {cancelled: true});
        }
        throw e;
      } finally {
        clearInterval(poll);
      }
    },
  };
}

const servers: Server[] = [];

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer((req, res) => {
    req.resume();
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}/v1`;
}

function sse(res: ServerResponse, chunks: string[]): void {
  res.writeHead(200, {"content-type": "text/event-stream", "cache-control": "no-cache"});
  for (const chunk of chunks) res.write(chunk);
  res.end();
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("provider streaming", () => {
  it("streams SSE deltas and joins the text", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, {"content-type": "text/event-stream"});
      res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
      }, 10);
    });

    const deltas: string[] = [];
    const result = await runChat({
      model: model(baseUrl),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      transport: fetchTransport(),
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Hello");
    expect(result.streaming).toBe(true);
    expect(result.attempts).toBe(1);
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("decodes UTF-8 split across transport chunks", async () => {
    const text = "Привет";
    const bytes = Buffer.from(text, "utf8");
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, {"content-type": "text/event-stream"});
      // Разрезаем multibyte-символ между первым и вторым чанком.
      const payload = Buffer.concat([
        Buffer.from('data: {"choices":[{"delta":{"content":"'),
        bytes,
        Buffer.from('"}}]}\n\ndata: [DONE]\n\n'),
      ]);
      res.write(payload.subarray(0, 45));
      res.write(payload.subarray(45));
      res.end();
    });

    const result = await runChat({
      model: model(baseUrl),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      transport: fetchTransport(),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe(text);
  });

  it("supports a non-stream JSON response and calls onDelta once", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify({choices: [{message: {content: "Hello"}}]}));
    });

    const deltas: string[] = [];
    const result = await runChat({
      model: model(baseUrl),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      stream: false,
      transport: fetchTransport(),
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Hello");
    expect(result.streaming).toBe(false);
    expect(deltas).toEqual(["Hello"]);
  });

  it("returns an error payload from a 200 response", async () => {
    const baseUrl = await startServer((_req, res) => {
      sse(res, ['data: {"error":{"message":"bad request"}}\n\n']);
    });

    const result = await runChat({
      model: model(baseUrl),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      transport: fetchTransport(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("bad request");
  });
});

describe("provider HTTP errors and retry", () => {
  it("does not retry 4xx errors", async () => {
    let requests = 0;
    const baseUrl = await startServer((_req, res) => {
      requests++;
      res.writeHead(401, {"content-type": "application/json"});
      res.end('{"error":"unauthorized"}');
    });

    const result = await runChat({
      model: model(baseUrl),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      transport: fetchTransport(),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/401/);
    expect(result.attempts).toBe(1);
    expect(requests).toBe(1);
  });

  it("retries 5xx and succeeds on the next attempt", async () => {
    let requests = 0;
    const baseUrl = await startServer((_req, res) => {
      requests++;
      if (requests === 1) {
        res.writeHead(503, {"content-type": "text/plain"});
        res.end("temporarily unavailable");
        return;
      }
      sse(res, [
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    });

    const retries: number[] = [];
    const result = await runChat({
      model: model(baseUrl),
      requestConfig: {...REQUEST_CONFIG, retryBackoffMs: 1},
      messages: MESSAGES,
      transport: fetchTransport(),
      onRetry: (attempt) => retries.push(attempt),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe("ok");
    expect(result.attempts).toBe(2);
    expect(retries).toEqual([1]);
    expect(requests).toBe(2);
  });

  it("gives up after configured retries", async () => {
    let requests = 0;
    const baseUrl = await startServer((_req, res) => {
      requests++;
      res.writeHead(500, {"content-type": "text/plain"});
      res.end("boom");
    });

    const result = await runChat({
      model: model(baseUrl),
      requestConfig: {...REQUEST_CONFIG, retries: 1, retryBackoffMs: 1},
      messages: MESSAGES,
      transport: fetchTransport(),
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(requests).toBe(2);
    expect(result.error).toMatch(/500/);
  });
});

describe("provider capabilities", () => {
  it("does not request streaming or JSON mode when capabilities are off", async () => {
    let body: Record<string, unknown> | null = null;
    const baseUrl = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify({choices: [{message: {content: "ok"}}]}));
      });
    });

    const result = await runChat({
      model: model(baseUrl, {
        capabilities: {streaming: false, jsonMode: false, tools: false},
      }),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      jsonMode: true,
      transport: fetchTransport(),
    });

    expect(result.ok).toBe(true);
    expect(result.streaming).toBe(false);
    expect(result.jsonMode).toBe(false);
    expect(body).toMatchObject({stream: false});
    expect(body).not.toHaveProperty("response_format");
  });

  it("sends response_format when JSON mode is supported and requested", async () => {
    let body: Record<string, unknown> | null = null;
    const baseUrl = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        sse(res, [
          'data: {"choices":[{"delta":{"content":"{}"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      });
    });

    const result = await runChat({
      model: model(baseUrl, {
        capabilities: {streaming: true, jsonMode: true, tools: false},
      }),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      jsonMode: true,
      transport: fetchTransport(),
    });

    expect(result.ok).toBe(true);
    expect(result.jsonMode).toBe(true);
    expect(body).toMatchObject({stream: true, response_format: {type: "json_object"}});
  });
});

describe("provider cancellation", () => {
  it("stops a stream after cancelChatRun", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, {"content-type": "text/event-stream"});
      res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) return;
        res.write('data: {"choices":[{"delta":{"content":"more"}}]}\n\n');
      }, 10);
      res.on("close", () => clearInterval(timer));
    });

    const runId = "cancel-test-run";
    const deltas: string[] = [];
    const result = await runChat({
      model: model(baseUrl),
      requestConfig: REQUEST_CONFIG,
      messages: MESSAGES,
      runId,
      transport: fetchTransport(),
      onDelta: (delta) => {
        deltas.push(delta);
        if (deltas.length === 1) cancelChatRun(runId);
      },
    });

    expect(result.cancelled).toBe(true);
    expect(result.ok).toBe(false);
    expect(deltas[0]).toBe("first");
  });
});

describe("awaitChannelEnd (T4, D-4)", () => {
  it("возвращается, когда маркер конца пришёл", async () => {
    let markEnd: () => void = () => {};
    const endSeen = new Promise<void>((resolve) => {
      markEnd = resolve;
    });
    setTimeout(markEnd, 10);
    const started = Date.now();
    await awaitChannelEnd(endSeen, 2000);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("не зависает, если маркер не пришёл (таймаут)", async () => {
    const never = new Promise<void>(() => {});
    const started = Date.now();
    await awaitChannelEnd(never, 50);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

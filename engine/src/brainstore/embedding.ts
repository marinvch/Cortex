/**
 * Embedding provider interface + impls (follow-up to #282, part of #272).
 *
 * `embed(texts) -> vectors` is the SINGLE variable-cost seam (per #272: "the main
 * variable-cost center — keep it isolated so it's measurable and swappable").
 * Core code never names a provider; it resolves one through `resolveEmbeddingProvider`.
 *
 * - HashingEmbeddingProvider: deterministic, zero-dependency, offline. A real
 *   lexical baseline and the default so semantic indexing works out of the box.
 * - OllamaEmbeddingProvider: true semantic vectors via a local Ollama server
 *   (HTTP, no hard dependency). Additive — only used when explicitly selected.
 */

export interface EmbeddingProvider {
  /** Stable id (e.g. 'hashing', 'ollama'). Stored alongside vectors so a dimension/model change is detectable. */
  readonly id: string;
  /** Fixed output dimensionality. Vectors of different dimensions are never compared. */
  readonly dimensions: number;
  /** Embed a batch of texts → unit-normalized vectors (one per input, same order). */
  embed(texts: string[]): Promise<Float32Array[]>;
}

function l2normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Deterministic 32-bit FNV-1a hash → bucket index. */
function hashToken(token: string, dim: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % dim;
}

export interface HashingEmbeddingOptions {
  dimensions?: number;
}

/**
 * Hashed bag-of-words embedding: term frequencies projected into a fixed-dim space
 * via FNV-1a, then L2-normalized. Deterministic and dependency-free. Captures
 * lexical overlap (a useful baseline); not true contextual semantics — use Ollama
 * (or a cloud provider) for that.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'hashing';
  readonly dimensions: number;

  constructor(opts: HashingEmbeddingOptions = {}) {
    this.dimensions = opts.dimensions && opts.dimensions > 0 ? Math.floor(opts.dimensions) : 256;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vec = new Float32Array(this.dimensions);
      for (const token of tokenize(text)) {
        vec[hashToken(token, this.dimensions)] += 1;
      }
      return l2normalize(vec);
    });
  }
}

export interface OllamaEmbeddingOptions {
  /** Base URL of the Ollama server. Default: http://127.0.0.1:11434 */
  baseUrl?: string;
  /** Embedding model. Default: nomic-embed-text (dimensions 768). */
  model?: string;
  dimensions?: number;
  /** Per-request timeout (ms). Default 30000. */
  timeoutMs?: number;
}

/**
 * Real semantic embeddings from a local Ollama server. No hard dependency — uses
 * global fetch (Node >=22). Throws a clear, actionable error if Ollama is not
 * reachable, so callers can fall back to the hashing provider.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: OllamaEmbeddingOptions = {}) {
    this.baseUrl = (opts.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = opts.model || 'nomic-embed-text';
    this.dimensions = opts.dimensions && opts.dimensions > 0 ? Math.floor(opts.dimensions) : 768;
    this.timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
    this.id = `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const text of texts) {
      const vec = await this.embedOne(text);
      out.push(vec);
    }
    return out;
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `OllamaEmbeddingProvider: cannot reach Ollama at ${this.baseUrl} (${(err as Error).message}). ` +
          `Is 'ollama serve' running and is the model '${this.model}' pulled?`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`OllamaEmbeddingProvider: HTTP ${res.status} from Ollama for model '${this.model}'`);
    }
    const data = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error('OllamaEmbeddingProvider: response had no embedding array');
    }
    return l2normalize(Float32Array.from(data.embedding));
  }
}

export interface EmbeddingProviderConfig {
  provider?: string;
  dimensions?: number;
  ollama?: OllamaEmbeddingOptions;
}

type ProviderFactory = (config: EmbeddingProviderConfig) => EmbeddingProvider;

/** id -> factory. Adding a provider = one registry entry; no core code names a provider. */
const REGISTRY: Record<string, ProviderFactory> = {
  hashing: (c) => new HashingEmbeddingProvider({ dimensions: c.dimensions }),
  ollama: (c) => new OllamaEmbeddingProvider({ ...c.ollama, dimensions: c.dimensions }),
};

/** Resolve a provider by config. Unknown/absent id → the zero-dep hashing default. */
export function resolveEmbeddingProvider(config: EmbeddingProviderConfig = {}): EmbeddingProvider {
  const id = (config.provider || 'hashing').toLowerCase();
  const factory = REGISTRY[id] ?? REGISTRY.hashing;
  return factory(config);
}

/** The provider ids the registry knows about (for help text / validation). */
export function availableEmbeddingProviders(): string[] {
  return Object.keys(REGISTRY);
}

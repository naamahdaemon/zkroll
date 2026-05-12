type RemoteJob = {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  progress: { label: string; progress: number };
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const proverUrl = process.env.ZKROLL_PROVER_URL?.replace(/\/+$/, "") || null;
const proverRequestTimeoutMs = Number(process.env.ZKROLL_PROVER_REQUEST_TIMEOUT_MS ?? 30_000);

function localProver() {
  return import("./serverProver.js");
}

async function remoteRequest<T>(path: string, init?: RequestInit, options: { notFound?: T } = {}): Promise<T> {
  if (!proverUrl) throw new Error("Remote prover URL is not configured.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), proverRequestTimeoutMs);
  try {
    const response = await fetch(`${proverUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...init?.headers
      }
    });
    const payload = (await response.json()) as T | { error?: string };
    if (response.status === 404 && "notFound" in options) return options.notFound as T;
    if (!response.ok) {
      throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Remote prover request failed.");
    }
    return payload as T;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`Remote prover request timed out after ${proverRequestTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function usesRemoteServerProver() {
  return Boolean(proverUrl);
}

export async function serverPseudoHash(pseudo: string) {
  if (proverUrl) return (await remoteRequest<{ pseudoHash: string }>("/internal/prover/pseudo-hash", {
    method: "POST",
    body: JSON.stringify({ pseudo })
  })).pseudoHash;
  return (await localProver()).serverPseudoHash(pseudo);
}

export async function serverCommitment(secret: string, publicKey: string, gameIdField: string) {
  if (proverUrl) return (await remoteRequest<{ commitment: string }>("/internal/prover/commitment", {
    method: "POST",
    body: JSON.stringify({ secret, publicKey, gameIdField })
  })).commitment;
  return (await localProver()).serverCommitment(secret, publicKey, gameIdField);
}

export async function serverGameKey() {
  if (proverUrl) return remoteRequest<{ privateKey: string; address: string }>("/internal/prover/keygen", {
    method: "POST",
    body: "{}"
  });
  return (await localProver()).serverGameKey();
}

export async function createProverJob(type: string, input: unknown) {
  if (proverUrl) return remoteRequest<RemoteJob>("/internal/prover/jobs", {
    method: "POST",
    body: JSON.stringify({ type, input })
  });
  return (await localProver()).createProverJob(type, input);
}

export async function getProverJob(id: string) {
  if (proverUrl) return remoteRequest<RemoteJob | null>(`/internal/prover/jobs/${encodeURIComponent(id)}`, undefined, { notFound: null });
  return (await localProver()).getProverJob(id);
}

export async function serverProverInfo() {
  if (proverUrl) {
    const info = await remoteRequest<Record<string, unknown>>("/internal/prover/info");
    return { ...info, isolated: true, proverUrl };
  }
  return { ...(await (await localProver()).serverProverInfo()), isolated: false };
}

export async function clearServerProverCache() {
  if (proverUrl) return remoteRequest<Record<string, unknown>>("/internal/prover/cache/clear", {
    method: "POST",
    body: "{}"
  });
  return (await localProver()).clearServerProverCache();
}

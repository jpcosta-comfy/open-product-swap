import type { ComfyOutputFile, ComfyWorkflow, JobStatus } from "./types";

const DEFAULT_BASE = "https://cloud.comfy.org";

export function comfyConfig() {
  const apiKey = process.env.COMFY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "COMFY_API_KEY is not set. Copy .env.example and export a key from https://platform.comfy.org/profile/api-keys",
    );
  }
  const baseUrl = (process.env.COMFY_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  return { apiKey, baseUrl };
}

function authHeaders(apiKey: string, json = false): HeadersInit {
  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; type?: string } | string;
      message?: string;
      node_errors?: unknown;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
    if (parsed.node_errors) return JSON.stringify(parsed.node_errors).slice(0, 800);
    return text.slice(0, 800) || `HTTP ${res.status}`;
  } catch {
    return text.slice(0, 800) || `HTTP ${res.status}`;
  }
}

export type UploadedAsset = {
  filename: string;
  subfolder: string;
  type: string;
};

export async function uploadInput(
  file: File | Blob,
  filename: string,
): Promise<UploadedAsset> {
  const { apiKey, baseUrl } = comfyConfig();
  const body = new FormData();
  body.append("image", file, filename);
  body.append("type", "input");
  body.append("overwrite", "true");

  const endpoints = [`${baseUrl}/api/upload/image`, `${baseUrl}/api/upload/video`];
  let lastError = "upload failed";

  for (const url of endpoints) {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(apiKey),
      body,
    });
    if (res.ok) {
      const json = (await res.json()) as {
        name?: string;
        filename?: string;
        subfolder?: string;
        type?: string;
      };
      const name = json.name || json.filename || filename;
      return {
        filename: name,
        subfolder: json.subfolder || "",
        type: json.type || "input",
      };
    }
    lastError = await readError(res);
    if (res.status !== 404 && res.status !== 405) {
      throw new Error(`Comfy upload failed: ${lastError}`);
    }
  }

  throw new Error(`Comfy upload failed: ${lastError}`);
}

export async function submitWorkflow(workflow: ComfyWorkflow): Promise<string> {
  const { apiKey, baseUrl } = comfyConfig();
  const extraData = { api_key_comfy_org: apiKey };

  const v2 = await fetch(`${baseUrl}/api/v2/jobs`, {
    method: "POST",
    headers: authHeaders(apiKey, true),
    body: JSON.stringify({
      workflow,
      extra_data: extraData,
    }),
  });

  if (v2.ok || v2.status === 201) {
    const json = (await v2.json()) as { id?: string; prompt_id?: string };
    const id = json.id || json.prompt_id;
    if (id) return id;
  }

  const v1 = await fetch(`${baseUrl}/api/prompt`, {
    method: "POST",
    headers: authHeaders(apiKey, true),
    body: JSON.stringify({
      prompt: workflow,
      extra_data: extraData,
    }),
  });

  if (!v1.ok) {
    const v2Err = v2.ok ? "" : await readError(v2);
    const v1Err = await readError(v1);
    const err = new Error(`Comfy submit failed: ${v1Err || v2Err}`) as Error & {
      status?: number;
    };
    err.status = v1.status === 402 || v2.status === 402 ? 402 : 500;
    throw err;
  }

  const json = (await v1.json()) as {
    prompt_id?: string;
    node_errors?: Record<string, unknown>;
  };
  if (json.node_errors && Object.keys(json.node_errors).length > 0) {
    throw new Error(`Workflow rejected: ${JSON.stringify(json.node_errors).slice(0, 800)}`);
  }
  if (!json.prompt_id) throw new Error("Comfy submit returned no prompt_id");
  return json.prompt_id;
}

type StatusPayload = {
  status?: string;
  state?: string;
  progress?: number | { value?: number; message?: string };
  error?: { message?: string } | string;
  message?: string;
};

const TERMINAL_SUCCESS = new Set(["success", "succeeded", "completed", "complete"]);
const TERMINAL_ERROR = new Set([
  "error",
  "failed",
  "non_retryable_error",
  "lost",
  "expired",
]);
const TERMINAL_CANCEL = new Set(["cancelled", "canceled"]);

export function normalizeStatus(raw: string | undefined): JobStatus {
  const s = (raw || "").toLowerCase();
  if (TERMINAL_SUCCESS.has(s)) return "success";
  if (TERMINAL_ERROR.has(s)) return "error";
  if (TERMINAL_CANCEL.has(s)) return "cancelled";
  if (s.includes("queue") || s === "submitted" || s === "pending") return "queued";
  return "running";
}

export type JobSnapshot = {
  status: JobStatus;
  progress?: number;
  message?: string;
  error?: string;
  outputs: ComfyOutputFile[];
  rawStatus?: string;
};

function collectOutputs(payload: unknown): ComfyOutputFile[] {
  const files: ComfyOutputFile[] = [];
  const seen = new Set<string>();

  const push = (item: ComfyOutputFile) => {
    if (!item.filename) return;
    const key = `${item.type || "output"}:${item.subfolder || ""}:${item.filename}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(item);
  };

  const walk = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    if (typeof rec.filename === "string") {
      push({
        filename: rec.filename,
        subfolder: typeof rec.subfolder === "string" ? rec.subfolder : "",
        type: typeof rec.type === "string" ? rec.type : "output",
        format: typeof rec.format === "string" ? rec.format : undefined,
      });
    }
    if (typeof rec.name === "string" && rec.type && rec.url) {
      push({
        filename: rec.name,
        subfolder: "",
        type: "output",
        format: typeof rec.content_type === "string" ? rec.content_type : undefined,
      });
    }
    for (const nested of Object.values(rec)) {
      if (nested && typeof nested === "object") walk(nested);
    }
  };

  walk(payload);
  return files;
}

export async function getJob(id: string): Promise<JobSnapshot> {
  const { apiKey, baseUrl } = comfyConfig();

  const v2 = await fetch(`${baseUrl}/api/v2/jobs/${id}`, {
    headers: authHeaders(apiKey),
    cache: "no-store",
  });
  if (v2.ok) {
    const json = (await v2.json()) as StatusPayload & {
      outputs?: unknown;
      error?: { message?: string } | string | null;
      progress?: { value?: number; message?: string } | number;
    };
    const status = normalizeStatus(json.status);
    const progress =
      typeof json.progress === "number"
        ? json.progress
        : json.progress?.value;
    const message =
      typeof json.progress === "object" ? json.progress?.message : json.message;
    const error =
      typeof json.error === "string"
        ? json.error
        : json.error?.message;
    return {
      status,
      progress,
      message,
      error: status === "error" ? error : undefined,
      outputs: collectOutputs(json),
      rawStatus: json.status,
    };
  }

  const statusRes = await fetch(`${baseUrl}/api/job/${id}/status`, {
    headers: authHeaders(apiKey),
    cache: "no-store",
  });
  let rawStatus: string | undefined;
  let progress: number | undefined;
  let message: string | undefined;
  let error: string | undefined;

  if (statusRes.ok) {
    const json = (await statusRes.json()) as StatusPayload;
    rawStatus = json.status || json.state;
    progress =
      typeof json.progress === "number"
        ? json.progress
        : json.progress?.value;
    message =
      (typeof json.progress === "object" ? json.progress?.message : undefined) ||
      json.message;
    error = typeof json.error === "string" ? json.error : json.error?.message;
  }

  const historyRes = await fetch(`${baseUrl}/api/history_v2/${id}`, {
    headers: authHeaders(apiKey),
    cache: "no-store",
  });
  let historyJson: unknown = null;
  if (historyRes.ok) {
    historyJson = await historyRes.json();
  } else {
    const fallback = await fetch(`${baseUrl}/api/history/${id}`, {
      headers: authHeaders(apiKey),
      cache: "no-store",
    });
    if (fallback.ok) historyJson = await fallback.json();
  }

  const outputs = collectOutputs(historyJson);
  const status = normalizeStatus(rawStatus);
  const histRec = historyJson as Record<string, unknown> | null;
  const histStatus =
    histRec && typeof histRec === "object"
      ? (histRec.status as { status_str?: string; completed?: boolean } | undefined)
      : undefined;
  const completed =
    histStatus?.completed === true || histStatus?.status_str === "success";

  return {
    status: completed && outputs.length ? "success" : status,
    progress,
    message,
    error: status === "error" ? error : undefined,
    outputs,
    rawStatus,
  };
}

export async function viewUrl(file: ComfyOutputFile): Promise<string> {
  const { apiKey, baseUrl } = comfyConfig();
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || "output",
  });
  const url = `${baseUrl}/api/view?${params.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(apiKey),
    redirect: "manual",
  });
  const location = res.headers.get("location");
  if (location) return location;
  return url;
}

export async function downloadOutput(file: ComfyOutputFile): Promise<{
  bytes: ArrayBuffer;
  contentType: string;
}> {
  const { apiKey, baseUrl } = comfyConfig();
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || "output",
  });
  const url = `${baseUrl}/api/view?${params.toString()}`;
  const head = await fetch(url, {
    method: "GET",
    headers: authHeaders(apiKey),
    redirect: "manual",
  });
  const location = head.headers.get("location");
  if (location && (head.status === 301 || head.status === 302 || head.status === 307)) {
    const signed = await fetch(location);
    if (!signed.ok) throw new Error(`Download failed: HTTP ${signed.status}`);
    return {
      bytes: await signed.arrayBuffer(),
      contentType: signed.headers.get("content-type") || "application/octet-stream",
    };
  }
  if (!head.ok) throw new Error(await readError(head));
  return {
    bytes: await head.arrayBuffer(),
    contentType: head.headers.get("content-type") || "application/octet-stream",
  };
}

export async function pingComfy(): Promise<{ ok: boolean; cloudVersion?: string }> {
  const { apiKey, baseUrl } = comfyConfig();
  const res = await fetch(`${baseUrl}/api/system_stats`, {
    headers: authHeaders(apiKey),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false };
  const json = (await res.json()) as { system?: { cloud_version?: string } };
  return { ok: true, cloudVersion: json.system?.cloud_version };
}

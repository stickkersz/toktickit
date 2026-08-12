const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Category {
  id: number;
  name: string;
}

export interface SystemStatus {
  online: boolean;
}

// Issue 2 — call the backend health check.
// TODO(Issue 4): extend this to also fetch /api/categories.
export async function checkSystem(): Promise<SystemStatus> {
  try {
    const healthRes = await fetch(`${API_URL}/api/health`);
    if (!healthRes.ok) {
      throw new Error("Unable to connect to TokTickIT API");
    }
    return { online: true };
  } catch {
    throw new Error("Unable to connect to TokTickIT API");
  }
}

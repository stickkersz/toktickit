const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Category {
  id: number;
  name: string;
}

export interface SystemStatus {
  online: boolean;
  categories: Category[];
}

// Issue 2 + Issue 4 — call the backend.
// Throwing on failure lets the UI show a single Offline/error state.
export async function checkSystem(): Promise<SystemStatus> {
  try {
    const healthRes = await fetch(`${API_URL}/api/health`);
    if (!healthRes.ok) {
      throw new Error("Unable to connect to TokTickIT API");
    }

    const categoriesRes = await fetch(`${API_URL}/api/categories`);
    if (!categoriesRes.ok) {
      throw new Error("Unable to load request categories");
    }

    const categories: Category[] = await categoriesRes.json();
    return { online: true, categories };
  } catch {
    throw new Error("Unable to connect to TokTickIT API");
  }
}

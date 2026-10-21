export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export const int = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

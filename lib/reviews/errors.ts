export class ReviewError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) { super(message); }
}

export const notFound = () => new ReviewError(404, "not_found", "Resource not found.");

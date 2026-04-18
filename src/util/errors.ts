export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function isNotFoundError(err: unknown): boolean {
  return err instanceof ToolError && err.message.startsWith("not found:");
}

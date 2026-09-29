export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, details);
  }

  static notFound(message = "Not found") {
    return new HttpError(404, message);
  }

  static badGateway(message: string, details?: unknown) {
    return new HttpError(502, message, details);
  }

  static unavailable(message: string) {
    return new HttpError(503, message);
  }
}

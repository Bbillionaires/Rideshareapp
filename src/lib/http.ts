import { NextFunction, Request, Response } from "express";

/** Wraps an async Express handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

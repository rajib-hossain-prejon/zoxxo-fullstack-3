/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextFunction, Request, Response } from 'express';

import { resolveStatus } from './HttpException';

const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next?: NextFunction,
) => {
  res.status(resolveStatus(err)).json({ message: err.message });
};

export default errorMiddleware;

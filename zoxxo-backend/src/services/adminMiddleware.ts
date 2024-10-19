// adminMiddleware.ts

import { Response, NextFunction } from 'express';

import IRequest from '../interfaces/IRequest';

export default function adminMiddleware(req: IRequest, res: Response, next: NextFunction) {
  if (!req.user || (!req.user.isAdmin && !req.user.isSuperAdmin)) {
    return res.status(403).json({ message: req.t('access-denied-admin-only') });
  }
  next();
}
import { Request, Express } from 'express';

export default interface IRequest extends Request {
  user?: {
    _id: string;
    email: string;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
  };
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
}
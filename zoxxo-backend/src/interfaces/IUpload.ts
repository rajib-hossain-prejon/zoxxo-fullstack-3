import { ObjectId } from 'mongoose';
import IUser from './IUser';
import IWorkspace from './IWorkspace';

export interface IUpload {
  _id: ObjectId;
  user: IUser;
  workspace: IWorkspace;
  name: string;
  files: { filename: string; size: number }[];
  zipLocation: string;
  downloads: number;
  color: string;
  coverImage: string;
  bucket: string;
  sizeInBytes: number;
  isValid: boolean; // indicates files are successfully uploaded for new upload
  createdAt: Date;
}

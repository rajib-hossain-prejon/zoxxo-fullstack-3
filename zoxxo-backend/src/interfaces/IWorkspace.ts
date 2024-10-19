import { ObjectId } from 'mongoose';
import { IUpload } from './IUpload';
import IUser from './IUser';

export default interface IWorkspace {
  _id: ObjectId;
  user: IUser;
  name: string;
  coverImage?: string;
  color?: string;
  uploads?: IUpload[];
}

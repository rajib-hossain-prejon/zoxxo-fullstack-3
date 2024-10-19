import mongoose from 'mongoose';

import { IUpload } from '../interfaces/IUpload';

type TUploadModal = IUpload & mongoose.Document;

const UploadSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: [],
    },
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: [],
    },
    name: {
      type: String,
      default: `Upload-${new Date().getDate()}-${new Date().getMonth()}-${new Date().getFullYear()}`,
      minlength: 3,
      required: true,
      unique: true,
      trim: true,
    },
    files: [
      {
        filename: String,
        size: Number,  
      },
    ],
    zipLocation: {
      type: String,
      default: '',
    },
    downloads: {
      type: Number,
      default: 0,
    },
    color: {
      type: String,
      default: '#f21a5d',
    },
    coverImage: {
      type: String,
      default: '',
    },
    bucket: {
      type: String,
      default: '',
    },
    sizeInBytes: {
      type: Number,
      default: 0,
    },
    isValid: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

const Upload = mongoose.model<TUploadModal>('Upload', UploadSchema);

export default Upload;

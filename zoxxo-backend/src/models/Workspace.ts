import mongoose from 'mongoose';

import IWorkspace from '../interfaces/IWorkspace';

type TWorkspaceModel = IWorkspace & mongoose.Document;

const workspaceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: [],
  },
  name: {
    type: String,
    trim: true,
    required: true,
  },
  coverImage: {
    type: String,
  },
  color: {
    type: String,
    default: '#f21a5d',
  },
  uploads: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Upload',
    default: [],
  },
},{ timestamps: true });

const Workspace = mongoose.model<TWorkspaceModel>('Workspace', workspaceSchema);

export default Workspace;

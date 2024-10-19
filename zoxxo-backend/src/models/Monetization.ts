import { Schema, model, Document } from 'mongoose';
import mongoose from 'mongoose';


interface IMonetization extends Document {
  uploadId: Schema.Types.ObjectId;
  usersId: Schema.Types.ObjectId[];  
  workspaceId: Schema.Types.ObjectId;  
  invoiceIds: Schema.Types.ObjectId[];
  ownerId: Schema.Types.ObjectId;  
  price: number;
}


const monetizationSchema = new Schema<IMonetization>({
  usersId: { type: [Schema.Types.ObjectId], ref: 'User'}, 
  uploadId: { type: Schema.Types.ObjectId, ref: 'Upload', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  invoiceIds: { type: [Schema.Types.ObjectId], ref: 'Invoice' }, 
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },  
  price: { type: Number, required: true },  
}, {
  timestamps: true,  
});

 
 const MonetizationModel = mongoose.model<IMonetization>('Monetization', monetizationSchema);

export default MonetizationModel;

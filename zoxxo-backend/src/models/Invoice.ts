import mongoose from 'mongoose';

import IInvoice from '../interfaces/IInvoice';

interface IInvoiceModal
  extends mongoose.Document,
    IInvoice {}

const InvoiceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    serviceId: {
      type: String,
      required: true,
      unique: true,
    },
    service: {
      type: String,
      enum: ['paypal', 'stripe'],
      required: true,
    },
    plan: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['monthly', 'yearly','one-time'],
    },
    billing: {
      type: {
        name: String,
        address: String,
        postalCode: String,
        city: String,
        country: String,
        vatNumber: String,
      },
      required: true,
    },
    amount: {
      type: Number,
      default: 0,
      required: true,
    },
    currency: {
      type: String,
      default: '',
    },
    datePaid: {
      type: Date,
      required: true,
      default: Date.now(),
    },
    metadata: {
      type: Object,
      required: true,
    },
  },
  { timestamps: true },
);

const Invoice = mongoose.model<IInvoiceModal>(
  'Invoice',
  InvoiceSchema,
);

export default Invoice;

import mongoose from 'mongoose';

import ISubscriptionProduct from '../interfaces/ISubscriptionProduct';

interface ISubscriptionProductModal
  extends mongoose.Document,
    ISubscriptionProduct {}

const SubscriptionProductSchema = new mongoose.Schema(
  {
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
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true },
);

const SubscriptionProduct = mongoose.model<ISubscriptionProductModal>(
  'SubscriptionProduct',
  SubscriptionProductSchema,
);

export default SubscriptionProduct;

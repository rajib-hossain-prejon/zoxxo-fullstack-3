import mongoose from 'mongoose';

import IUser from '../interfaces/IUser';

export type IUserModel = IUser & mongoose.Document;

const UserSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  avatar: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  isAdmin: {
    type: Boolean,
    required: true,
    default: false,
  },
  isSuperAdmin: {
    type: Boolean,
    required: true,
    default: false,
  },  isDeleted: {
    type: Boolean,
    default: false
  },
  language: {
    type: String,
    default: 'en',
  },
  zoxxoUrl: {
    type: String,
  },
  defaultWorkspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    default: '',
  },
  workspaces: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Workspace',
    default: [],
  },
  campaigns: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Campaign',
    default: [],
  },
  maxWorkspaces: {
    type: Number,
    default: 1,
  },
  storageSizeInBytes: {
    type: Number,
    default: 4 * 1000 * 1000 * 1000, // 4GB
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
  },
  paymentMethod: {
    type: {
      service: {
        type: String,
        enum: ['stripe', 'paypal'],
      },
      stripeCustomerId: String,
      PaymentId: String,
      status: String,  
      verificationLink: String,  
      stripeCardData: {
        stripeId: String,
        nameOnCard: String,
        last4: String,
        brand: {
          type: String,
          enum: ['visa', 'mastercard'],
        },
      },
      stripeWebhookEventKey: String,
    },
  },
  subscription: {
    service: {
      type: String,
      enum: ['stripe', 'paypal'],
    },
    type: {
      type: String,
      enum: ['monthly', 'yearly'],
    },
    subscriptionId: String,
    status: {
      type: String,
      lowercase: true,
      default: '',
    },
    extraStorageInBytes: {
      type: Number,
    },
    extraWorkspaces: {
      type: Number,
    },
    price: {
      type: Number,
    },
    stripeWebhookEventKey: String,
    invoiceLink: String,
    isEligibleForProratedDiscount: {
      type: Boolean,
      default: true,
    },
    downgradesAt: String,
  },
});

const User = mongoose.model<IUserModel>('User', UserSchema);

export default User;

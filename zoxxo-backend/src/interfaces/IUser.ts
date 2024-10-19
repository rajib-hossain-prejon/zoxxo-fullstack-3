import { ObjectId } from 'mongoose';
import ICampaign from './ICampaign';
import IWorkspace from './IWorkspace';

export default interface IUser {
  _id: ObjectId;
  fullName: string;
  username: string;
  avatar: string;
  email: string;
  password: string;
  isEmailVerified: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  language: string;
  zoxxoUrl: string;
  workspaces: IWorkspace[];
  campaigns: ICampaign[];
  maxWorkspaces: number;
  defaultWorkspace: IWorkspace;
  storageSizeInBytes: number;
  billing?: {
    name: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    vatNumber: string;
  };
  paymentMethod?: {
    service: 'stripe' | 'paypal';
    stripeCustomerId?: string;
    status: string;
    verificationLink: string; // for handling verification manually by user interaction
    stripeCardData?: {
      stripeId: string;
      nameOnCard: string;
      brand: 'visa' | 'mastercard';
      last4: string;
    };
    stripeWebhookEventKey: string; // to guard against duplicate events
  };
  // subscription represents TORNADO plan
  subscription?: {
    service: 'stripe' | 'paypal';
    type: 'monthly' | 'yearly';
    subscriptionId?: string;
    status: string;
    extraWorkspaces: number;
    extraStorageInBytes: number;
    price: number;
    invoiceLink: string; // for handling invoices manually by user interaction
    stripeWebhookEventKey: string; // to guard against duplicate events
    isEligibleForProratedDiscount: boolean;
    downgradesAt: string;
  };
}

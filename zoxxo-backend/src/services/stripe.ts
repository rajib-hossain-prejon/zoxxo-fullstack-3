import Stripe from 'stripe';
import SubscriptionProduct from '../models/SubscriptionProduct';
import { calculatePrice } from './calculatePrice';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-08-16',
});

export const createTestPaymentLink = async (options: {
  userId: string;
  stripeCustomerId: string;
}) => {
  const paymentLink = await stripe.checkout.sessions.create({
    line_items: [
      {
        price: 'price_1Ny2rFJCJtpVCkr8kSqbi6PS', // test charge product id
        quantity: 1,
      },
    ],
    mode: 'payment',
    currency: 'usd',
    payment_method_types: ['card'],
    payment_intent_data: {
      metadata: options,
      setup_future_usage: 'off_session',
    },
    metadata: options,
    customer: options.stripeCustomerId,
    success_url: process.env.FRONTEND_URL,
  });
  return paymentLink;
};

interface CustomerResponse {
  customerId: string | null;
  error?: string;
}

export const createCustomer = async (email: string, name: string): Promise<CustomerResponse> => {
  try {
    const customer = await stripe.customers.create({
      email,
      name,
    });
    console.log('Customer ID:', customer.id);
    return { customerId: customer.id };
  } catch (error) {
    console.error('Error creating customer:', error);
    return { customerId: null, error: (error as Error).message };  
  }
};
 
export const getProductId = async (data: {
  extraStorage: number;
  extraWorkspaces: number;
  subscription: 'monthly' | 'yearly';
}) => {
  const name = `Tornado ${data.extraStorage}TB-${data.extraWorkspaces}WS-${data.subscription}`;
  const description = `${data.subscription.toUpperCase()} Tornado plan with extra ${
    data.extraStorage
  } TB of storage and ${data.extraWorkspaces} workspaces.`;
  // find one if already created
  const foundProduct = await SubscriptionProduct.findOne({
    name,
    service: 'stripe',
  });
  if (foundProduct) return foundProduct.serviceId;
  // create a product item
  const product = await stripe.products.create({
    name,
    description,
    metadata: data,
  });
  const stripeProd = await SubscriptionProduct.create({
    serviceId: product.id,
    service: 'stripe',
    name,
    description,
    metada: data,
  });
  return stripeProd.serviceId;
};

export const getCampaignProductId = async (data: {
  isABTesting: boolean;
  days: number;
  display: ('upload-screen' | 'download-screen')[];
}) => {
  const name = `Campaign ${data.days}Days-${data.display.join()}-${
    data.isABTesting ? 'ABTesting' : 'No ABTesting'
  }`;
  const description = `Campaign of ${data.days} days and ${data.display.join(
    ',',
  )} screens along with ${data.isABTesting ? 'ABTesting' : 'No ABTesting'}.`;
  // find one if already created
  const foundProduct = await SubscriptionProduct.findOne({
    name,
    service: 'stripe',
  });
  if (foundProduct) return foundProduct.serviceId;
  // create a product item
  const product = await stripe.products.create({
    name,
    description,
    metadata: {
      days: data.days,
      display: data.display.join(','),
      isABTesting: data.isABTesting ? 'true' : undefined,
    },
  });
  const stripeProd = await SubscriptionProduct.create({
    serviceId: product.id,
    service: 'stripe',
    name,
    description,
    metada: data,
  });
  return stripeProd.serviceId;
};

export const getCouponId = async (data: {
  extraStorage: number;
  extraWorkspaces: number;
  subscription: 'monthly' | 'yearly';
}) => {
  const priceData = calculatePrice(data);
  const amount = Math.floor(
    Number.parseFloat(
      (priceData.proratedDiscount + priceData.total / 2).toFixed(2),
    ) * 100,
  );
  const coupon = await stripe.coupons.create({
    name: 'Prorated Discount',
    amount_off: amount,
    currency: 'usd',
    duration: 'once',
    max_redemptions: 1,
  });
  return coupon.id;
};

interface CreateInvoiceData {
  user: mongoose.Types.ObjectId;
  serviceId: string;
  service:string ;
  plan: string;
  type:string ;
  billing: {
    name: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    vatNumber?: string;
  };
  amount: number;
  currency: string;
  metadata: object;
}

export const createInvoice = async (invoiceData: CreateInvoiceData) => {
  try {
    const invoice = new Invoice({
      user: invoiceData.user,
      serviceId: invoiceData.serviceId,
      service: invoiceData.service,
      plan: invoiceData.plan,
      type: invoiceData.type,
      billing:{
          name: invoiceData.billing.name || '',  
          address: invoiceData.billing.address || '',
          postalCode: invoiceData.billing.postalCode || '',
          city: invoiceData.billing.city || '',
          country: invoiceData.billing.country || '',
          vatNumber: invoiceData.billing.vatNumber || '',
      
      },
      amount: invoiceData.amount,
      currency: invoiceData.currency,
      metadata: invoiceData.metadata,
    });

    
    const savedInvoice = await invoice.save();
    return savedInvoice;
  } catch (error) {
    console.error('Error creating invoice:', error);
    throw new Error('Unable to create invoice');
  }
};

export default stripe;

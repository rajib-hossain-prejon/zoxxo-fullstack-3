import axios from 'axios';
import SubscriptionProduct from '../models/SubscriptionProduct';
import calculateCampaignPrice from './calculateCampaignPrice';

const auth = Buffer.from(
  `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
).toString('base64');

const paypalApi = axios.create({
  baseURL: process.env.PAYPAL_API,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Basic ${auth}`,
  },
});

export const getProductId = async (data?: {
  extraStorage: number;
  extraWorkspaces: number;
  subscription: 'monthly' | 'yearly';
}) => {
  const name = `TORNADO ${data.extraStorage}TB-${
    data.extraWorkspaces
  }WS-${data.subscription.toUpperCase()}`;
  const description = `Tornado ${data.subscription} plan; extra ${data.extraStorage} TB and ${data.extraWorkspaces} WS`;
  // check if product already exists
  const foundProduct = await SubscriptionProduct.findOne({
    name,
    service: 'paypal',
  });
  if (foundProduct) return foundProduct.serviceId;
  // create the product
  const response = await paypalApi.post(`/v1/catalogs/products`, {
    name,
    description,
    type: 'DIGITAL',
    category: 'COMPUTER_AND_DATA_PROCESSING_SERVICES',
  });
  const prod = await SubscriptionProduct.create({
    serviceId: response.data.id,
    service: 'paypal',
    name,
    description,
    metadata: data,
  });
  return prod.serviceId;
};

export const createSubscriptionPlan = async (data?: {
  extraStorage: number;
  extraWorkspaces: number;
  subscription: 'monthly' | 'yearly';
  totalPrice: number;
  proratedDiscount: number;
}) => {
  const productId = await getProductId(data);
  // check if plan already exists
  const name = `TORNADO ${data.extraStorage}TB-${
    data.extraWorkspaces
  }WS-${data.subscription.toUpperCase()}`;
  // get list of all plans
  const allPlans = await paypalApi.get('/v1/billing/plans', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
  });
  const foundPlan = allPlans.data.plans.find((p: any) => p.name === name);
  if (foundPlan) return foundPlan;
  const response = await paypalApi.post('/v1/billing/plans', {
    product_id: productId,
    name, // plan name is same as that of product for easy retrieval
    description: `Tornado ${data.subscription} plan; extra ${data.extraStorage} TB and ${data.extraWorkspaces} WS`,
    status: 'ACTIVE',
    billing_cycles: [
      /* { // trial period is not used because discount is applied on all of the payment cycles
        frequency: {
          interval_unit: data.subscription === 'monthly' ? 'MONTH' : 'YEAR',
          interval_count: 1,
        },
        tenure_type: 'TRIAL',
        sequence: 1,
        total_cycles: 1,
        pricing_scheme: {
          fixed_price: {
            value: data.totalPrice.toFixed(2),
            currency_code: 'USD',
          },
        },
      }, */
      {
        frequency: {
          interval_unit: data.subscription === 'monthly' ? 'MONTH' : 'YEAR',
          interval_count: 1,
        },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // infinite cycles until canceled
        pricing_scheme: {
          fixed_price: {
            value: (data.totalPrice).toFixed(2),
            currency_code: 'USD',
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CANCEL',  
      payment_failure_threshold: 0,
    },
  });
  console.log(response.data)
  return response.data;
};

export const getProductFromPlanId = async (id: string) => {
  const { data: plan } = await paypalApi.get<{
    id: string;
    name: string;
    product_id: string;
  }>(`/v1/billing/plans/${id}`);
  const product = await SubscriptionProduct.findOne({
    serviceId: plan.product_id,
    service: 'paypal',
  }).lean();
  return product;
};

export const getSubscription = async (id: string) => {
  const response = await paypalApi.get<ISubscriptionResource>(
    '/v1/billing/subscriptions/' + id,
  );
  return response.data;
};

export const cancelSubscription = async (id: string) => {
  const subs = await getSubscription(id);
  // get cancel url
  const lnk = subs.links.find((lnk) => lnk.rel === 'cancel');
  await paypalApi.post(lnk.href, { reason: 'Canceled by user' });
  return subs;
};

interface ICheckoutOrder {
  id: string;
  status: string;
  payment_source: Record<string, any>;
  links: {
    href: string;
    rel: string;
    method: 'GET' | 'PATCH' | 'POST' | 'OPTIONS';
  }[];
}

export const createCampaingOrder = async (data: {
  days: number;
  isABTesting: boolean;
  display: ('upload-screen' | 'download-screen')[];
  campaignId: string;
}) => {
  const total = calculateCampaignPrice({
    days: data.days,
    isABTesting: data.isABTesting,
    display:
      data.display.includes('upload-screen') &&
      data.display.includes('download-screen')
        ? 'upload-download-screen'
        : data.display[0],
  });
  const response = await paypalApi.post<ICheckoutOrder>('/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          currency_code: 'USD',
          value: total.toFixed(2),
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          brand_name: 'Zoxxo',
          landing_page: 'LOGIN',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: `${process.env.FRONTEND_URL}/dashboard/advertisement?campaignId=${data.campaignId}`,         
          cancel_url: process.env.FRONTEND_URL,
        },
      },
    },
  });
  console.log('order', response.data);
  return response.data;
};

export const captureOrder = async (orderId: string,tokenId:string) => {
  const response = await paypalApi.post<ICheckoutOrder>(
    `/v2/checkout/orders/${orderId}/capture`, {
      payer_id: tokenId,
    },
  );
  return response.data;
};

interface IEvent {
  id: string;
  event_type: string;
  resource_type: string;
  resource: Record<string, any>;
}
interface ISubscriptionEvent extends IEvent {
  resource_type: 'subscription';
  event_type:
    | 'BILLING.SUBSCRIPTION.CREATED'
    | 'BILLING.SUBSCRIPTION.UPDATED'
    | 'BILLING.SUBSCRIPTION.ACTIVATED'
    | 'BILLING.SUBSCRIPTION.RE-ACTIVATED'
    | 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
    | 'BILLING.SUBSCRIPTION.SUSPENDED'
    | 'BILLING.SUBSCRIPTION.CANCELLED';
  resource: ISubscriptionResource;
}

interface ISubscriptionResource {
  id: string;
  plan_id: string;
  custom_id: string;
  auto_renewal: string;
  status: string;
  quantity: string;
  links: {
    href: string;
    rel: string;
    method: 'GET' | 'POST' | 'PATCH';
  }[];
  billing_info: {
    outstanding_balance: {
      currency_code: string;
      value: string;
    };
    last_payment: {
      amount: {
        currency_code: string;
        value: string;
      };
      time: string;
    };
    last_failed_payment?: {
      amount: {
        currency_code: string;
        value: string;
      };
      time: string;
      reason_code: string;
    };
    next_billing_time: string;
    final_payment_time: string;
    failed_payments_count: number;
  };
}

type WebhookEvent = IEvent | ISubscriptionEvent;
export const verifyWebhook = async (data: {
  transmission_id: string;
  transmission_time: string;
  cert_url: string;
  auth_algo: string;
  transmission_sig: string;
  webhook_id: string;
  webhook_event: string;
}) => {
  /* const response = await paypalApi.post<{ verification_status: string }>(
    '/v1/notifications/verify-webhook-signature',
    JSON.stringify(data),
  );
  if (response.data.verification_status !== 'SUCCESS')
    throw Error('Webhook verification failed'); */
  return JSON.parse(data.webhook_event) as WebhookEvent;
};

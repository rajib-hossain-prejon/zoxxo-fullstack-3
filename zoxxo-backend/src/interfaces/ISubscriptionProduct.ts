export default interface ISubscriptionProduct {
  serviceId: string;
  service: 'paypal' | 'stripe';
  name: string;
  description: string;
  metadata: Record<string, any> & {
    extraStorage: number;
    extraWorkspaces: number;
    subscription: 'monthly' | 'yearly';
  };
}

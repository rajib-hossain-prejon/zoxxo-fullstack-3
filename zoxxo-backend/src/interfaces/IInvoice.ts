import IUser from "./IUser";

export default interface IInvoice {
  user: IUser;
  serviceId: string;
  service: 'paypal' | 'stripe';
  plan: string;
  type: 'monthly' | 'yearly',
  amount: number;
  currency: string;
  datePaid: Date;
  billing: {
    name: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    vatNumber: string;
  };
  metadata: Record<string, any> & {
    extraStorage: string;
    extraStoragePrice: number;
    extraWorkspaces: number;
    extraWorkspacesPrice: number;
    proratedDiscount: number;
    taxPercent: number;
    taxValue: number;
  };
}

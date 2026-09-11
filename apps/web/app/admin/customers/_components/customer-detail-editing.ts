import type { CustomerDetail, MarketingStatus } from './customer-types';

export type ContactDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
};

export type AddressDraft = {
  countryCode: string;
  line1: string;
  line2: string;
  city: string;
  stateCode: string;
  postalCode: string;
};

export function contactDraftFrom(customer: CustomerDetail): ContactDraft {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone ?? '',
    emailMarketingStatus: customer.emailMarketingStatus,
    smsMarketingStatus: customer.smsMarketingStatus,
  };
}

export function addressDraftFrom(customer: CustomerDetail): AddressDraft {
  const address = customer.addresses[0];
  return {
    countryCode: address?.countryCode ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    stateCode: address?.stateCode ?? '',
    postalCode: address?.postalCode ?? '',
  };
}

export function contactUpdatePayload(customer: CustomerDetail, draft: ContactDraft) {
  return {
    ...draft,
    address: addressDraftFrom(customer),
  };
}

export function addressUpdatePayload(customer: CustomerDetail, draft: AddressDraft) {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone ?? '',
    emailMarketingStatus: customer.emailMarketingStatus,
    smsMarketingStatus: customer.smsMarketingStatus,
    address: draft,
  };
}

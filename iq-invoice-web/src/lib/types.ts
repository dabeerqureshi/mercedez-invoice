/** Shared UI/domain types for the POS. */

export interface CartLine {
  partNumber: string;
  designation: string;
  unitPrice: number;
  currency: string;
  retrievedAt: string;
  quantity: number;
}

export interface Vehicle {
  make: string;
  model: string;
  regNo: string;
  mileage: string;
}

export interface Customer {
  name: string;
  phone: string;
  email: string;
}

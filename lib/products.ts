export type PurchaseType = "one-time" | "subscription";

/** How often a subscription re-ships, in days - mirrors GNC's "Subscribe & Save" options. */
export const SUBSCRIPTION_FREQUENCIES = [30, 45, 60, 90] as const;
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];
export const DEFAULT_SUBSCRIPTION_FREQUENCY: SubscriptionFrequency = 30;

export type Product = {
  code: string;
  name: string;
  description: string;
  /** Product image shown in the popup, scan list, and checkout summary. */
  image: string;
  /** One-time purchase price, in USD. */
  price: number;
  /**
   * Whether "Subscribe & Save" is offered for this item. Some GNC products
   * (e.g. single-use or promo items) are one-time-purchase only - when this
   * is false the popup hides the subscription option entirely.
   */
  subscriptionAvailable: boolean;
  /** Subscribe & save price, in USD. Present only when subscriptionAvailable. */
  subscriptionPrice?: number;
};

// Demo catalog: since this scanner isn't wired to GNC's real product API,
// every successful scan resolves to one of these two real GNC items at random.
export const DUMMY_PRODUCTS: Product[] = [
  {
    code: "619400",
    name: "GNC Prostate & Nitric Oxide Bundle",
    description:
      "Supports prostate health alongside healthy blood flow and nitric oxide production.",
    image: "/products/prostate-nitric-oxide-bundle.avif",
    price: 59.99,
    subscriptionAvailable: true,
    subscriptionPrice: 53.99,
  },
  {
    code: "442851",
    name: "GNC Mega Men Mars Multivitamin Bundle",
    description:
      "A complete multivitamin bundle built to support men's energy, immunity, and performance.",
    image: "/products/mars-multi-bundle.avif",
    price: 49.99,
    subscriptionAvailable: false,
  },
];

export function pickRandomProduct(): Product {
  return DUMMY_PRODUCTS[Math.floor(Math.random() * DUMMY_PRODUCTS.length)];
}

export function priceForPurchaseType(product: Product, type: PurchaseType) {
  if (type === "subscription" && product.subscriptionAvailable) {
    return product.subscriptionPrice ?? product.price;
  }
  return product.price;
}

export function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const ORDERS = {
  "ORD-101": {
    order_id: "ORD-101",
    customer: "Priya Sharma",
    product: "Vitamin C Serum (30ml)",
    value: 699,
    status: "Out for Delivery",
    notes: "BlueDart - BD-982103. Expected by 6 PM today",
    can_cancel: false,
  },
  "ORD-102": {
    order_id: "ORD-102",
    customer: "Rahul Verma",
    product: "Hydrating Sunscreen SPF 50",
    value: 499,
    status: "Delivered",
    notes: "Delhivery - DL-441029. Delivered 14 days ago",
    can_cancel: false,
    return_window_open: false, // delivered 14 days ago, policy is 7 days
  },
  "ORD-103": {
    order_id: "ORD-103",
    customer: "Ananya Patel",
    product: "Green Tea Face Wash + Toner",
    value: 850,
    status: "Processing",
    notes: "Ordered 3 hours ago. Eligible for cancellation",
    can_cancel: true,
  },
};

export function getOrderDetails(orderId) {
  if (!orderId) {
    return { found: false, error: "No order ID provided." };
  }
  const normalized = String(orderId).toUpperCase().replace(/\s+/g, "");
  const order = ORDERS[normalized];
  if (!order) {
    return { found: false, error: `No order found with ID ${orderId}.` };
  }
  return { found: true, ...order };
}

export const ALL_ORDERS = Object.values(ORDERS);
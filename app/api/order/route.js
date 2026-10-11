import { getOrderDetails } from "../../../lib/orders";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  return Response.json(getOrderDetails(searchParams.get("id")));
}
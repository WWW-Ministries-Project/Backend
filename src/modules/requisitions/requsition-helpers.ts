import { requested_item } from "@prisma/client";
import { RequisitionInterface } from "../../interfaces/requisitions-interface";

export const mapProducts = (products: RequisitionInterface["products"]) =>
  products?.map((product) => ({
    where: { id: product.id },
    update: {
      name: product.name,
      unitPrice: product.unitPrice,
      quantity: product.quantity,
    },
    create: {
      name: product.name,
      unitPrice: product.unitPrice,
      quantity: product.quantity,
    },
  }));

export const mapAttachments = (
  attachments: RequisitionInterface["attachmentLists"]
) =>
  attachments?.map((attachment) => ({
    where: { id: attachment.id },
    update: {
      URL: attachment.URL,
    },
    create: {
      URL: attachment.URL,
    },
  }));

export const calculateTotalCost = (
  products: requested_item[] | undefined
): number =>
  products?.reduce(
    (sum, product) => sum + product.unitPrice * product.quantity,
    0
  ) || 0;
